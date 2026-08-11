/**
 * Demo veri.
 *
 * Amaç yalnızca "ekranda bir şey görünsün" değil: komisyon versiyonlama ve
 * append-only ledger'ın doğru kurulduğunu gösteren gerçek bir çok satıcılı
 * sipariş üretir. Seed sonunda satıcı bakiyeleri ledger'dan hesaplanıp basılır.
 *
 * Çalıştır:  pnpm db:seed
 */
import { PrismaClient, Prisma } from '../generated/client/index.js';

const prisma = new PrismaClient();

/** 1250 = %12,50 */
function applyBps(amountMinor: bigint, bps: number): bigint {
  const numerator = amountMinor * BigInt(bps);
  const quotient = numerator / 10_000n;
  const remainder = numerator % 10_000n;
  return remainder * 2n >= 10_000n ? quotient + 1n : quotient;
}

const tl = (lira: number): bigint => BigInt(Math.round(lira * 100));

function orderNumber(seq: number): string {
  const d = new Date();
  const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `VT-${stamp}-${String(seq).padStart(4, '0')}`;
}

async function main(): Promise<void> {
  console.log('🌱 Demo veri yükleniyor...\n');

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed üretim ortamında çalıştırılamaz.');
  }

  // Seed tekrar çalıştırılabilir olmalı ama İKİNCİ BİR SİPARİŞ ÜRETMEMELİ —
  // ledger'a mükerrer kayıt girerse bakiyeler anlamsızlaşır.
  // Bu yüzden var olan veriyi silmiyoruz, sessizce çıkıyoruz.
  const existing = await prisma.store.findUnique({ where: { slug: 'atolye-nord' } });
  if (existing) {
    console.log('ℹ️  Demo veri zaten yüklü, hiçbir şey yapılmadı.\n');
    console.log(
      '   Sıfırdan yüklemek için:  pnpm infra:reset && pnpm db:migrate && pnpm db:seed\n',
    );
    return;
  }

  // ── 1. Kategori ağacı ───────────────────────────────────────────────────
  const kadin = await prisma.category.upsert({
    where: { slug: 'kadin' },
    update: {},
    create: { slug: 'kadin', name: 'Kadın', sortOrder: 1 },
  });

  const ustGiyim = await prisma.category.upsert({
    where: { slug: 'kadin-ust-giyim' },
    update: {},
    create: {
      slug: 'kadin-ust-giyim',
      name: 'Üst Giyim',
      parentId: kadin.id,
      tryOnCategory: 'UPPER_BODY',
      sortOrder: 1,
    },
  });

  const altGiyim = await prisma.category.upsert({
    where: { slug: 'kadin-alt-giyim' },
    update: {},
    create: {
      slug: 'kadin-alt-giyim',
      name: 'Alt Giyim',
      parentId: kadin.id,
      tryOnCategory: 'LOWER_BODY',
      sortOrder: 2,
    },
  });

  console.log('  ✓ kategoriler');

  // ── 2. Komisyon kuralları (versiyonlu) ──────────────────────────────────
  // Üst giyim %12, alt giyim %14. Her kural bir VERSİYON taşır; sipariş kalemi
  // bu versiyonun kimliğini snapshot alır.
  async function createCommissionRule(
    categoryId: string,
    label: string,
    rateBps: number,
  ): Promise<{ versionId: string; rateBps: number }> {
    // upsert kullanılmaz: benzersizlik NULLS NOT DISTINCT ile veritabanında
    // tanımlı, Prisma'nın compound-unique arayüzüyle ifade edilemiyor.
    const rule =
      (await prisma.commissionRule.findFirst({ where: { categoryId, sellerId: null } })) ??
      (await prisma.commissionRule.create({ data: { categoryId, label } }));

    const existing = await prisma.commissionRuleVersion.findFirst({
      where: { ruleId: rule.id, validTo: null },
    });
    if (existing) return { versionId: existing.id, rateBps: existing.rateBps };

    const version = await prisma.commissionRuleVersion.create({
      data: {
        ruleId: rule.id,
        rateBps,
        validFrom: new Date('2026-01-01'),
        createdBy: 'seed',
      },
    });
    return { versionId: version.id, rateBps };
  }

  const ustKomisyon = await createCommissionRule(ustGiyim.id, 'Üst giyim', 1200);
  const altKomisyon = await createCommissionRule(altGiyim.id, 'Alt giyim', 1400);

  console.log('  ✓ komisyon kuralları (üst %12,00 · alt %14,00)');

  // ── 3. Satıcılar ────────────────────────────────────────────────────────
  // ⚠️ Gerçekte taxNumberEnc/ibanEnc uygulama katmanında AES-256-GCM ile
  //    şifrelenir. Seed'de şifreleme yapılmaz — demo değerler kullanılır.
  async function createSeller(
    slug: string,
    legalName: string,
    displayName: string,
  ): Promise<string> {
    const seller = await prisma.seller.create({
      data: {
        legalName,
        displayName,
        taxNumberEnc: 'demo:not-encrypted',
        taxOffice: 'Demo VD',
        ibanEnc: 'demo:not-encrypted',
        contactEmail: `${slug}@example.com`,
        contactPhone: '+905320000000',
        status: 'APPROVED',
        approvedAt: new Date(),
        qualityScore: 78,
        store: { create: { slug, name: displayName } },
      },
    });
    return seller.id;
  }

  const atolyeId = await createSeller('atolye-nord', 'Atölye Nord Tekstil A.Ş.', 'Atölye Nord');
  const mavraId = await createSeller('mavra', 'Mavra Moda Ltd. Şti.', 'Mavra');

  console.log('  ✓ 2 satıcı onaylandı');

  // ── 4. Ürünler ve varyantlar ────────────────────────────────────────────
  async function createProduct(input: {
    sellerId: string;
    categoryId: string;
    slug: string;
    title: string;
    brandName: string;
    description: string;
    aiTags: Prisma.InputJsonValue;
    tryOnScore: number;
    sizes: string[];
    colors: Array<{ name: string; hex: string }>;
    priceLira: number;
    stock: number;
  }): Promise<string> {
    const product = await prisma.product.create({
      data: {
        sellerId: input.sellerId,
        categoryId: input.categoryId,
        slug: input.slug,
        title: input.title,
        brandName: input.brandName,
        description: input.description,
        gender: 'WOMAN',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        aiTags: input.aiTags,
        aiTagsApproved: true,
        tryOnScore: input.tryOnScore,
        sizeChart: {
          S: { chest: 88, waist: 70, length: 62 },
          M: { chest: 94, waist: 76, length: 64 },
          L: { chest: 100, waist: 82, length: 66 },
        },
        popularityScore: 50,
        images: {
          create: [
            {
              storageKey: `demo/${input.slug}/front.webp`,
              angle: 'FRONT',
              isPrimary: true,
              widthPx: 1200,
              heightPx: 1600,
              sortOrder: 0,
            },
            {
              storageKey: `demo/${input.slug}/back.webp`,
              angle: 'BACK',
              widthPx: 1200,
              heightPx: 1600,
              sortOrder: 1,
            },
          ],
        },
      },
    });

    for (const color of input.colors) {
      for (const size of input.sizes) {
        const variant = await prisma.variant.create({
          data: {
            productId: product.id,
            sku: `${input.slug}-${color.name.toLowerCase()}-${size.toLowerCase()}`,
            color: color.name,
            colorHex: color.hex,
            size,
            priceMinor: tl(input.priceLira),
            listPriceMinor: tl(input.priceLira * 1.3),
          },
        });
        await prisma.inventory.create({
          data: { variantId: variant.id, onHand: input.stock },
        });
      }
    }

    return product.id;
  }

  await createProduct({
    sellerId: atolyeId,
    categoryId: ustGiyim.id,
    slug: 'keten-gomlek-oversize',
    title: 'Keten Oversize Gömlek',
    brandName: 'Atölye Nord',
    description:
      'Yıkanmış keten kumaştan üretilen, düşük omuzlu oversize gömlek. Sıcak havalarda rahat kullanım için tasarlandı.',
    aiTags: { color: 'Bej', pattern: 'Düz', fabric: 'Keten', neckline: 'Klasik', fit: 'Oversize' },
    tryOnScore: 86,
    sizes: ['S', 'M', 'L'],
    colors: [
      { name: 'Bej', hex: '#D9CBB3' },
      { name: 'Beyaz', hex: '#FFFFFF' },
    ],
    priceLira: 1290,
    stock: 12,
  });

  await createProduct({
    sellerId: mavraId,
    categoryId: altGiyim.id,
    slug: 'yuksek-bel-palazzo-pantolon',
    title: 'Yüksek Bel Palazzo Pantolon',
    brandName: 'Mavra',
    description: 'Akışkan dokulu, yüksek belli, bol paçalı palazzo pantolon.',
    aiTags: { color: 'Siyah', pattern: 'Düz', fabric: 'Viskon', fit: 'Wide leg' },
    tryOnScore: 71,
    sizes: ['S', 'M', 'L'],
    colors: [{ name: 'Siyah', hex: '#111111' }],
    priceLira: 1750,
    stock: 8,
  });

  // Try-On skoru düşük ürün — satıcı paneli uyarı akışını göstermek için
  await createProduct({
    sellerId: mavraId,
    categoryId: ustGiyim.id,
    slug: 'triko-kazak',
    title: 'Yumuşak Dokulu Triko Kazak',
    brandName: 'Mavra',
    description: 'İnce triko, günlük kullanım için yumuşak dokulu kazak.',
    aiTags: { color: 'Antrasit', pattern: 'Düz', fabric: 'Akrilik karışım', fit: 'Regular' },
    tryOnScore: 42, // düşük — "arka açı eksik, arka plan karışık"
    sizes: ['M', 'L'],
    colors: [{ name: 'Antrasit', hex: '#3A3A3A' }],
    priceLira: 890,
    stock: 5,
  });

  console.log('  ✓ 3 ürün, 15 varyant');

  // ── 5. Müşteri ──────────────────────────────────────────────────────────
  const customer = await prisma.user.create({
    data: {
      email: 'demo@example.com',
      phone: '+905321112233',
      firstName: 'Demo',
      lastName: 'Kullanıcı',
      role: 'CUSTOMER',
      emailVerifiedAt: new Date(),
      bodyProfile: {
        create: {
          heightCm: 168,
          weightKg: 60,
          chestCm: 90,
          waistCm: 72,
          usualSize: 'M',
          fitPref: 'REGULAR',
        },
      },
      consents: {
        create: [
          {
            type: 'PHOTO_PROCESSING',
            granted: true,
            documentVersion: 'v1.0',
            ipAddress: '127.0.0.1',
            userAgent: 'seed',
          },
          {
            type: 'CROSS_BORDER_TRANSFER',
            granted: true,
            documentVersion: 'v1.0',
            ipAddress: '127.0.0.1',
            userAgent: 'seed',
          },
          // Model eğitimi varsayılan olarak KAPALI.
          {
            type: 'MODEL_TRAINING',
            granted: false,
            documentVersion: 'v1.0',
            ipAddress: '127.0.0.1',
            userAgent: 'seed',
          },
        ],
      },
    },
  });

  console.log('  ✓ demo müşteri (rıza kayıtlarıyla)');

  // ── 6. ÇOK SATICILI SİPARİŞ ─────────────────────────────────────────────
  // İki farklı satıcıdan birer ürün → tek sipariş, İKİ paket.
  const gomlek = await prisma.variant.findFirstOrThrow({
    where: { sku: 'keten-gomlek-oversize-bej-m' },
    include: { product: true },
  });
  const pantolon = await prisma.variant.findFirstOrThrow({
    where: { sku: 'yuksek-bel-palazzo-pantolon-siyah-m' },
    include: { product: true },
  });

  const address = {
    title: 'Ev',
    firstName: 'Demo',
    lastName: 'Kullanıcı',
    phone: '+905321112233',
    city: 'İstanbul',
    district: 'Kadıköy',
    line1: 'Demo Mahallesi, Örnek Sokak No: 1 Daire 2',
    postalCode: '34710',
  };

  const kargoPerPaket = tl(49.9);

  const gomlekLine = gomlek.priceMinor;
  const pantolonLine = pantolon.priceMinor;
  const gomlekKomisyon = applyBps(gomlekLine, ustKomisyon.rateBps);
  const pantolonKomisyon = applyBps(pantolonLine, altKomisyon.rateBps);

  const itemsTotal = gomlekLine + pantolonLine;
  const shippingTotal = kargoPerPaket * 2n;

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNumber: orderNumber(1),
        userId: customer.id,
        email: customer.email!,
        phone: customer.phone!,
        status: 'PAID',
        itemsTotalMinor: itemsTotal,
        shippingTotalMinor: shippingTotal,
        discountMinor: 0n,
        grandTotalMinor: itemsTotal + shippingTotal,
        shippingAddress: address,
        billingAddress: address,
        paidAt: new Date(),
      },
    });

    // Her satıcı için ayrı paket
    const paketler = [
      {
        sellerId: atolyeId,
        variant: gomlek,
        line: gomlekLine,
        komisyon: gomlekKomisyon,
        rateBps: ustKomisyon.rateBps,
        versionId: ustKomisyon.versionId,
        label: 'Bej / M',
      },
      {
        sellerId: mavraId,
        variant: pantolon,
        line: pantolonLine,
        komisyon: pantolonKomisyon,
        rateBps: altKomisyon.rateBps,
        versionId: altKomisyon.versionId,
        label: 'Siyah / M',
      },
    ];

    // İade penceresi kapandıktan sonra hakediş ödenebilir olur.
    const availableAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    for (const p of paketler) {
      const paket = await tx.orderPackage.create({
        data: {
          orderId: created.id,
          sellerId: p.sellerId,
          status: 'PREPARING',
          itemsTotalMinor: p.line,
          shippingMinor: kargoPerPaket,
          slaDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000),
        },
      });

      const item = await tx.orderItem.create({
        data: {
          orderId: created.id,
          packageId: paket.id,
          variantId: p.variant.id,
          productId: p.variant.productId,
          productTitle: p.variant.product.title,
          brandName: p.variant.product.brandName,
          variantLabel: p.label,
          sku: p.variant.sku,
          imageKey: `demo/${p.variant.product.slug}/front.webp`,
          unitPriceMinor: p.variant.priceMinor,
          quantity: 1,
          lineTotalMinor: p.line,
          // ⚠️ KOMİSYON SNAPSHOT — kural sonradan değişse bile bu kayıt sabit
          commissionRuleVersionId: p.versionId,
          commissionRateBps: p.rateBps,
          commissionAmountMinor: p.komisyon,
          sellerNetMinor: p.line - p.komisyon,
        },
      });

      // ── APPEND-ONLY LEDGER ──
      await tx.ledgerEntry.createMany({
        data: [
          {
            sellerId: p.sellerId,
            type: 'SALE',
            amountMinor: p.line,
            orderItemId: item.id,
            description: `Satış — ${created.orderNumber}`,
            availableAt,
          },
          {
            sellerId: p.sellerId,
            type: 'COMMISSION',
            amountMinor: -p.komisyon,
            orderItemId: item.id,
            description: `Komisyon %${(p.rateBps / 100).toFixed(2)} — ${created.orderNumber}`,
            availableAt,
          },
        ],
      });

      // Stok düş
      await tx.inventory.update({
        where: { variantId: p.variant.id },
        data: { onHand: { decrement: 1 }, version: { increment: 1 } },
      });
    }

    await tx.orderEvent.create({
      data: {
        orderId: created.id,
        type: 'payment.captured',
        actorType: 'SYSTEM',
        payload: { amountMinor: (itemsTotal + shippingTotal).toString(), provider: 'seed' },
      },
    });

    // Transactional outbox — worker bunu kuyruğa taşır
    await tx.outboxEvent.create({
      data: {
        aggregate: 'order',
        aggregateId: created.id,
        type: 'order.paid',
        payload: { orderId: created.id, orderNumber: created.orderNumber },
      },
    });

    return created;
  });

  console.log(`  ✓ çok satıcılı sipariş: ${order.orderNumber} (2 paket)`);

  // ── 7. Doğrulama: bakiyeler ledger'dan hesaplanır ───────────────────────
  console.log('\n📊 Satıcı bakiyeleri (ledger toplamı):');
  for (const [ad, id] of [
    ['Atölye Nord', atolyeId],
    ['Mavra', mavraId],
  ] as const) {
    const agg = await prisma.ledgerEntry.aggregate({
      where: { sellerId: id },
      _sum: { amountMinor: true },
    });
    const balance = agg._sum.amountMinor ?? 0n;
    const lira = (Number(balance) / 100).toLocaleString('tr-TR', {
      style: 'currency',
      currency: 'TRY',
    });
    console.log(`   ${ad.padEnd(14)} ${lira}`);
  }

  const toplamKomisyon = gomlekKomisyon + pantolonKomisyon;
  console.log(
    `\n   Platform komisyonu  ${(Number(toplamKomisyon) / 100).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}`,
  );
  console.log('\n✅ Demo veri hazır.\n');
  console.log('   Müşteri : demo@example.com');
  console.log('   Mağazalar: /magaza/atolye-nord · /magaza/mavra\n');
}

main()
  .catch((error: unknown) => {
    console.error('❌ Seed başarısız:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
