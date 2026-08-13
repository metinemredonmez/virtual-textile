/**
 * TİCARET YAZIMI — sipariş, paket, kalem, ledger, ödeme, iade, payout, kupon.
 *
 * ⚠️ APPEND-ONLY TABLOLARDA "YOKSA YAZ", ASLA "HER KOŞUDA YAZ".
 *    `LedgerEntry`, `OrderEvent`, `ConsentRecord`, `PriceHistory` güncellenmez.
 *    İkinci koşuda mükerrer satır açılmaması bir varlık kontrolüne bağlı ve o
 *    kontrolün anahtarı doğal olmalı: ledger için (orderItemId, type), sipariş
 *    olayı için (orderId, type). Rastgele bir kimliğe dayansaydı ikinci koşu
 *    bakiyeleri ikiye katlardı.
 *
 * ⚠️ TARİHLER ÇALIŞMA ANINA GÖRE HESAPLANIR. Yönetim panelindeki
 *    dolandırıcılık uyarıları VARSAYILAN OLARAK SON 7 GÜNE bakıyor
 *    (`fraudQuerySchema`); sabit tarih yazılsaydı seed birkaç gün sonra o
 *    ekranı sessizce boşaltırdı. Sipariş SATIRI güncellenir, YENİSİ AÇILMAZ —
 *    idempotentlik bozulmaz, yalnızca demo verisi tazelenir.
 */
import type {
  OrderStatus,
  PackageStatus,
  PaymentStatus,
  PrismaClient,
  Prisma,
  ReturnReason,
  ReturnStatus,
} from '../../generated/client/index.js';
import { applyBps, demoSiparisNo, tl } from './para.js';
import { KATEGORILER, URUNLER } from './veri.js';
import { VARSAYILAN_KOMISYON } from './katalog.js';

const GUN = 24 * 60 * 60 * 1000;
/** İade penceresi — `FINANCE.payoutEligibleAfterDays` ile aynı. */
const HAKEDIS_GUN = 14;
const KARGO_PAKET_BASI = tl(49.9);

/**
 * Sipariş sonrası bir olayın (kargo, teslimat, iade kararı) zamanı.
 *
 * ⚠️ GELECEĞE TAŞMAZ. Sipariş 3 gün önceyse "teslim edildi = +3 gün" BUGÜNÜN
 *    ÖTESİNE düşer; `deliveredAt`i gelecekte olan bir paket, tarihe göre
 *    sıralayan her ekranda en üste çıkar ve raporlarda ileri tarihli bir satır
 *    üretir. Tavan "1 saat önce": olayın olduğu belli, ama saati henüz
 *    gelmemiş bir şey yok. Sipariş tarihleri çalışma anına göre hesaplandığı
 *    için bu kırpma SABİT tarihli bir seed'de gerekmeyen, burada ZORUNLU olan
 *    bir düzeltme.
 */
function olayAni(olusturma: Date, gunSonra: number, simdi: number): Date {
  const tavan = simdi - 60 * 60 * 1000;
  return new Date(Math.min(olusturma.getTime() + gunSonra * GUN, tavan));
}

interface KalemTanimi {
  readonly sku: string;
  readonly adet: number;
}

interface SiparisTanimi {
  readonly sira: number;
  readonly eposta: string;
  readonly durum: OrderStatus;
  readonly gunOnce: number;
  readonly kalemler: readonly KalemTanimi[];
  readonly paketDurumu: PackageStatus;
  /** Satıcı slug'ına göre paket durumu istisnası (kısmi kargo senaryosu). */
  readonly paketIstisna?: Readonly<Record<string, PackageStatus>>;
  readonly kargo?: { readonly firma: string; readonly takipNo: string };
  readonly iade?: {
    readonly durum: ReturnStatus;
    readonly sebep: ReturnReason;
    readonly not: string;
  };
  readonly kuponKodu?: string;
  readonly odeme: PaymentStatus;
  /** `CARD_TESTING` sinyalini besleyen başarısız deneme sayısı. */
  readonly basarisizDeneme?: number;
}

/**
 * ⚠️ ON SİPARİŞ DURUMUNUN ONU DA KAPSANIYOR. Eksik bırakılan her durum,
 *    `lib/durum-etiketleri.ts` içindeki karşılığının ekranda HİÇ görülmemesi
 *    demek — ve görülmeyen etiketin yanlış olduğu ancak müşteri şikâyetiyle
 *    anlaşılır.
 */
const SIPARISLER: readonly SiparisTanimi[] = [
  {
    sira: 1,
    eposta: 'demo@example.com',
    durum: 'PAID',
    gunOnce: 2,
    kalemler: [
      { sku: 'keten-gomlek-oversize-bej-m', adet: 1 },
      { sku: 'yuksek-bel-palazzo-pantolon-siyah-m', adet: 1 },
    ],
    paketDurumu: 'PREPARING',
    odeme: 'CAPTURED',
  },
  {
    sira: 2,
    eposta: 'demo@example.com',
    durum: 'DELIVERED',
    gunOnce: 26,
    kalemler: [{ sku: 'yuksek-bel-mom-jean-indigo-28', adet: 1 }],
    paketDurumu: 'DELIVERED',
    kargo: { firma: 'Yurtiçi Kargo', takipNo: 'YK260712001' },
    odeme: 'CAPTURED',
  },
  {
    sira: 3,
    eposta: 'demo@example.com',
    durum: 'COMPLETED',
    gunOnce: 41,
    kalemler: [{ sku: 'kapusonlu-sweatshirt-gri-melanj-m', adet: 2 }],
    paketDurumu: 'DELIVERED',
    kargo: { firma: 'Aras Kargo', takipNo: 'AR260628114' },
    odeme: 'CAPTURED',
  },
  {
    sira: 4,
    eposta: 'ayse@example.com',
    durum: 'SHIPPED',
    gunOnce: 4,
    kalemler: [{ sku: 'midi-saten-elbise-sampanya-s', adet: 1 }],
    paketDurumu: 'SHIPPED',
    kargo: { firma: 'MNG Kargo', takipNo: 'MNG260809442' },
    odeme: 'CAPTURED',
  },
  {
    sira: 5,
    eposta: 'ayse@example.com',
    durum: 'PARTIALLY_SHIPPED',
    gunOnce: 3,
    kalemler: [
      { sku: 'yun-karisimli-trenckot-bej-m', adet: 1 },
      { sku: 'duz-paca-straight-jean-indigo-28', adet: 1 },
    ],
    paketDurumu: 'PREPARING',
    paketIstisna: { 'atolye-nord': 'SHIPPED' },
    kargo: { firma: 'Yurtiçi Kargo', takipNo: 'YK260810907' },
    odeme: 'CAPTURED',
  },
  {
    sira: 6,
    eposta: 'ayse@example.com',
    durum: 'DELIVERED',
    gunOnce: 19,
    kalemler: [{ sku: 'pileli-midi-etek-haki-m', adet: 1 }],
    paketDurumu: 'RETURN_REQUESTED',
    kargo: { firma: 'Aras Kargo', takipNo: 'AR260725330' },
    iade: {
      durum: 'REQUESTED',
      sebep: 'SIZE_TOO_LARGE',
      not: 'Bel kısmı bir beden büyük geldi, S ile değişim talep ediyorum.',
    },
    odeme: 'CAPTURED',
  },
  {
    sira: 7,
    eposta: 'mehmet@example.com',
    durum: 'CANCELLED',
    gunOnce: 9,
    kalemler: [{ sku: 'erkek-chino-pantolon-haki-32', adet: 1 }],
    paketDurumu: 'CANCELLED',
    odeme: 'FAILED',
  },
  {
    sira: 8,
    eposta: 'mehmet@example.com',
    durum: 'PENDING_PAYMENT',
    gunOnce: 0,
    kalemler: [{ sku: 'erkek-basic-tisort-beyaz-l', adet: 3 }],
    paketDurumu: 'AWAITING_APPROVAL',
    odeme: 'THREEDS_PENDING',
  },
  {
    sira: 9,
    eposta: 'mehmet@example.com',
    durum: 'PAYMENT_FAILED',
    gunOnce: 1,
    kalemler: [{ sku: 'erkek-slim-jean-siyah-32', adet: 1 }],
    paketDurumu: 'AWAITING_APPROVAL',
    odeme: 'FAILED',
    // ⚠️ 10 ≥ 2 × FRAUD_THRESHOLDS.failedPaymentAttempts (5) → HIGH önem.
    //    5-9 arası MEDIUM verirdi; iki eşiğin de gerçekten ayrı çalıştığını
    //    görebilmek için HIGH tarafı seçildi.
    basarisizDeneme: 10,
  },
  {
    sira: 10,
    eposta: 'zeynep@example.com',
    durum: 'REFUNDED',
    /*
     * ⚠️ ZEYNEP'İN DÖRT SİPARİŞİ DE SON 7 GÜN İÇİNDE ve bu ZORUNLU:
     *    `fraudQuerySchema` varsayılan pencereyi son 7 gün olarak kuruyor,
     *    `HIGH_RETURN_RATE` sinyali ise o pencerede EN AZ 3 ödenmiş sipariş
     *    (`minOrdersForReturnRate`) ve %60 iade oranı istiyor. Siparişler
     *    haftalar öncesine yazılsaydı uyarı hiç doğmaz ve `/admin/alerts`
     *    ekranındaki üç sinyalden biri ölçülemez kalırdı.
     */
    gunOnce: 4,
    kalemler: [{ sku: 'kruvaze-ofis-elbisesi-lacivert-m', adet: 1 }],
    paketDurumu: 'RETURNED',
    kargo: { firma: 'MNG Kargo', takipNo: 'MNG260710218' },
    iade: {
      durum: 'REFUNDED',
      sebep: 'NOT_AS_DESCRIBED',
      not: 'Kumaş görseldeki gibi mat değil, parlak geldi.',
    },
    odeme: 'REFUNDED',
  },
  {
    sira: 11,
    eposta: 'zeynep@example.com',
    durum: 'DELIVERED',
    gunOnce: 3,
    kalemler: [{ sku: 'yuksek-bel-tayt-siyah-s', adet: 2 }],
    paketDurumu: 'DELIVERED',
    kargo: { firma: 'Yurtiçi Kargo', takipNo: 'YK260720555' },
    odeme: 'CAPTURED',
  },
  {
    sira: 12,
    eposta: 'zeynep@example.com',
    durum: 'DELIVERED',
    gunOnce: 6,
    kalemler: [{ sku: 'wide-leg-denim-pantolon-acik-indigo-28', adet: 1 }],
    paketDurumu: 'RETURN_REQUESTED',
    kargo: { firma: 'Aras Kargo', takipNo: 'AR260806771' },
    iade: {
      durum: 'APPROVED',
      sebep: 'SIZE_TOO_SMALL',
      not: 'Bel dar geldi, 30 beden ile değişim istiyorum.',
    },
    odeme: 'CAPTURED',
  },
  {
    sira: 13,
    eposta: 'zeynep@example.com',
    durum: 'DELIVERED',
    gunOnce: 5,
    kalemler: [{ sku: 'oversize-denim-ceket-acik-indigo-m', adet: 1 }],
    paketDurumu: 'RETURN_REQUESTED',
    kargo: { firma: 'MNG Kargo', takipNo: 'MNG260807664' },
    iade: {
      durum: 'RECEIVED',
      sebep: 'CHANGED_MIND',
      not: 'Vazgeçtim, kargoya verdim.',
    },
    odeme: 'CAPTURED',
  },
  {
    sira: 14,
    eposta: 'demo@example.com',
    durum: 'PAID',
    gunOnce: 1,
    // ⚠️ 3 × 18.900 = 56.700 ₺ > FRAUD_THRESHOLDS.unusualOrderValueMinor
    //    (50.000 ₺) → UNUSUAL_ORDER_VALUE (LOW) uyarısı.
    kalemler: [{ sku: 'dantel-a-kesim-gelinlik-fildisi-m', adet: 3 }],
    paketDurumu: 'PREPARING',
    odeme: 'CAPTURED',
  },
  {
    sira: 15,
    eposta: 'ayse@example.com',
    durum: 'EXPIRED',
    gunOnce: 12,
    kalemler: [{ sku: 'triko-kazak-antrasit-m', adet: 1 }],
    paketDurumu: 'CANCELLED',
    odeme: 'CREATED',
  },
  {
    sira: 16,
    eposta: 'mehmet@example.com',
    durum: 'COMPLETED',
    gunOnce: 48,
    kalemler: [
      { sku: 'keten-erkek-gomlek-lacivert-l', adet: 1 },
      { sku: 'erkek-slim-jean-indigo-32', adet: 1 },
    ],
    paketDurumu: 'DELIVERED',
    kargo: { firma: 'Yurtiçi Kargo', takipNo: 'YK260621100' },
    kuponKodu: 'HOSGELDIN10',
    odeme: 'CAPTURED',
  },
];

// ── Kuponlar ───────────────────────────────────────────────────────────────

interface KuponTanimi {
  readonly kod: string;
  readonly saticiSlug: string | null;
  readonly tur: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';
  readonly deger: bigint;
  readonly azamiIndirimMinor?: bigint;
  readonly asgariSepetMinor: bigint;
  readonly kullanimSiniri: number | null;
  readonly aktif: boolean;
  readonly gecerlilikGun: number;
}

export const KUPONLAR: readonly KuponTanimi[] = [
  {
    kod: 'HOSGELDIN10',
    saticiSlug: null,
    tur: 'PERCENTAGE',
    deger: 1000n, // %10,00
    azamiIndirimMinor: tl(200),
    asgariSepetMinor: tl(500),
    kullanimSiniri: 1000,
    aktif: true,
    gecerlilikGun: 90,
  },
  {
    kod: 'DENIM250',
    saticiSlug: 'denim-atolyesi',
    tur: 'FIXED_AMOUNT',
    deger: tl(250),
    asgariSepetMinor: tl(1500),
    kullanimSiniri: 200,
    aktif: true,
    gecerlilikGun: 30,
  },
  {
    kod: 'KARGOBEDAVA',
    saticiSlug: null,
    tur: 'FREE_SHIPPING',
    deger: 0n,
    asgariSepetMinor: tl(1000),
    kullanimSiniri: null,
    aktif: true,
    gecerlilikGun: 14,
  },
  {
    // ⚠️ Süresi DOLMUŞ kupon bilerek var: kupon listesindeki "pasif" rozetinin
    //    gerçekten çizildiği ancak böyle görülür.
    kod: 'YAZ2025',
    saticiSlug: 'mavra',
    tur: 'PERCENTAGE',
    deger: 1500n,
    azamiIndirimMinor: tl(500),
    asgariSepetMinor: tl(2000),
    kullanimSiniri: 100,
    aktif: false,
    gecerlilikGun: -30,
  },
];

// ── Yazım ──────────────────────────────────────────────────────────────────

export interface TicaretSonucu {
  readonly siparisSayisi: number;
  readonly paketSayisi: number;
  readonly kalemSayisi: number;
  readonly ledgerSayisi: number;
  readonly iadeSayisi: number;
  readonly payoutSayisi: number;
  readonly kuponSayisi: number;
  readonly bakiye: ReadonlyMap<string, bigint>;
}

export async function ticaretYaz(
  prisma: PrismaClient,
  girdi: {
    readonly kullaniciId: ReadonlyMap<string, string>;
    readonly saticiId: ReadonlyMap<string, string>;
    readonly komisyon: ReadonlyMap<string, { versionId: string; rateBps: number }>;
  },
): Promise<TicaretSonucu> {
  const simdi = Date.now();

  const kuponId = await kuponlariYaz(prisma, girdi.saticiId, simdi);

  let paketSayisi = 0;
  let kalemSayisi = 0;
  let ledgerSayisi = 0;
  let iadeSayisi = 0;

  for (const siparis of SIPARISLER) {
    const userId = girdi.kullaniciId.get(siparis.eposta);
    if (!userId) throw new Error(`Sipariş ${siparis.sira} müşterisi yok: ${siparis.eposta}`);

    const olusturma = new Date(simdi - siparis.gunOnce * GUN);
    const odendi = siparis.odeme === 'CAPTURED' || siparis.odeme === 'REFUNDED';

    // ── Kalemleri çöz: SKU → varyant + ürün + satıcı + komisyon ──
    const cozulen = await Promise.all(
      siparis.kalemler.map(async (kalem) => {
        const varyant = await prisma.variant.findUnique({
          where: { sku: kalem.sku },
          include: {
            product: {
              include: { seller: true, category: true, images: { orderBy: { sortOrder: 'asc' } } },
            },
          },
        });
        if (!varyant) throw new Error(`Sipariş ${siparis.sira}: SKU bulunamadı → ${kalem.sku}`);
        const oran = komisyonCoz(girdi.komisyon, varyant.product.category.slug);
        const satirToplami = varyant.priceMinor * BigInt(kalem.adet);
        return {
          kalem,
          varyant,
          oran,
          satirToplami,
          komisyonTutari: applyBps(satirToplami, oran.rateBps),
        };
      }),
    );

    const saticilar = [...new Set(cozulen.map((c) => c.varyant.product.sellerId))];
    const kalemToplami = cozulen.reduce((acc, c) => acc + c.satirToplami, 0n);
    const kargoToplami = KARGO_PAKET_BASI * BigInt(saticilar.length);

    const kupon = siparis.kuponKodu ? kuponId.get(siparis.kuponKodu) : undefined;
    const indirim = kupon ? indirimHesapla(kalemToplami) : 0n;

    const adres = await prisma.address.findFirst({ where: { userId, title: 'Ev' } });
    const adresSnapshot = adres
      ? {
          title: adres.title,
          firstName: adres.firstName,
          lastName: adres.lastName,
          phone: adres.phone,
          city: adres.city,
          district: adres.district,
          line1: adres.line1,
          postalCode: adres.postalCode,
        }
      : {
          title: 'Ev',
          firstName: 'Demo',
          lastName: 'Kullanıcı',
          phone: '+905320000000',
          city: 'İstanbul',
          district: 'Kadıköy',
          line1: 'Demo Mahallesi 1',
          postalCode: '34710',
        };

    const kullanici = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, phone: true },
    });

    const siparisNo = demoSiparisNo(siparis.sira);
    const ortak = {
      userId,
      email: kullanici.email ?? siparis.eposta,
      phone: kullanici.phone ?? '+905320000000',
      status: siparis.durum,
      itemsTotalMinor: kalemToplami,
      shippingTotalMinor: kargoToplami,
      discountMinor: indirim,
      grandTotalMinor: kalemToplami + kargoToplami - indirim,
      shippingAddress: adresSnapshot as Prisma.InputJsonValue,
      billingAddress: adresSnapshot as Prisma.InputJsonValue,
      createdAt: olusturma,
      paidAt: odendi ? olusturma : null,
      completedAt: siparis.durum === 'COMPLETED' ? olayAni(olusturma, 15, simdi) : null,
      cancelledAt:
        siparis.durum === 'CANCELLED' || siparis.durum === 'EXPIRED'
          ? olayAni(olusturma, 1, simdi)
          : null,
      reservationExpiresAt:
        siparis.durum === 'PENDING_PAYMENT' ? new Date(simdi + 20 * 60 * 1000) : null,
    };

    const kayit = await prisma.order.upsert({
      where: { orderNumber: siparisNo },
      update: ortak,
      create: { orderNumber: siparisNo, ...ortak },
    });

    // ── Paketler ──
    const paketId = new Map<string, string>();
    for (const sellerId of saticilar) {
      const saticiSlug = cozulen.find((c) => c.varyant.product.sellerId === sellerId)?.varyant
        .product.seller.displayName;
      const magaza = await prisma.store.findUnique({ where: { sellerId } });
      const durum = (magaza && siparis.paketIstisna?.[magaza.slug]) ?? siparis.paketDurumu;
      const paketKalemleri = cozulen.filter((c) => c.varyant.product.sellerId === sellerId);
      const paketToplami = paketKalemleri.reduce((acc, c) => acc + c.satirToplami, 0n);

      const paketOrtak = {
        status: durum,
        itemsTotalMinor: paketToplami,
        shippingMinor: KARGO_PAKET_BASI,
        // ⚠️ İndirim payı paketlere kuruş kaybı olmadan dağıtılır. Tek paketli
        //    siparişte tamamı o pakete düşer; çok paketli demo siparişlerde
        //    kupon KULLANILMIYOR, o yüzden burada dağıtım gerekmiyor.
        discountShareMinor: saticilar.length === 1 ? indirim : 0n,
        carrier: siparis.kargo?.firma ?? null,
        trackingNo: siparis.kargo?.takipNo ?? null,
        slaDeadline: new Date(olusturma.getTime() + 2 * GUN),
        shippedAt: kargolandi(durum) ? olayAni(olusturma, 1, simdi) : null,
        deliveredAt: teslimEdildi(durum) ? olayAni(olusturma, 3, simdi) : null,
        cancelledAt: durum === 'CANCELLED' ? olayAni(olusturma, 1, simdi) : null,
        cancelReason:
          durum === 'CANCELLED'
            ? siparis.durum === 'EXPIRED'
              ? 'Ödeme süresi doldu, rezervasyon serbest bırakıldı.'
              : 'Müşteri talebiyle iptal edildi.'
            : null,
        createdAt: olusturma,
      };

      const paket = await prisma.orderPackage.upsert({
        where: { orderId_sellerId: { orderId: kayit.id, sellerId } },
        update: paketOrtak,
        create: { orderId: kayit.id, sellerId, ...paketOrtak },
      });
      paketId.set(sellerId, paket.id);
      paketSayisi += 1;
      void saticiSlug;
    }

    // ── Kalemler + ledger ──
    for (const c of cozulen) {
      const pid = paketId.get(c.varyant.product.sellerId);
      if (!pid) continue;

      const gorselAnahtari = c.varyant.product.images[0]?.storageKey ?? '';
      const kalemOrtak = {
        variantId: c.varyant.id,
        productId: c.varyant.productId,
        productTitle: c.varyant.product.title,
        brandName: c.varyant.product.brandName,
        variantLabel: `${c.varyant.color} / ${c.varyant.size}`,
        sku: c.varyant.sku,
        imageKey: gorselAnahtari,
        unitPriceMinor: c.varyant.priceMinor,
        quantity: c.kalem.adet,
        lineTotalMinor: c.satirToplami,
        // ⚠️ KOMİSYON SNAPSHOT — kural sonradan değişse bile bu satır sabit.
        commissionRuleVersionId: c.oran.versionId,
        commissionRateBps: c.oran.rateBps,
        commissionAmountMinor: c.komisyonTutari,
        sellerNetMinor: c.satirToplami - c.komisyonTutari,
        createdAt: olusturma,
      };

      const varOlanKalem = await prisma.orderItem.findFirst({
        where: { packageId: pid, sku: c.varyant.sku },
      });
      const kalemKaydi = varOlanKalem
        ? await prisma.orderItem.update({ where: { id: varOlanKalem.id }, data: kalemOrtak })
        : await prisma.orderItem.create({
            data: { orderId: kayit.id, packageId: pid, ...kalemOrtak },
          });
      kalemSayisi += 1;

      if (!odendi) continue;

      /*
       * ⚠️ HAKEDİŞ TARİHİ. İade penceresi (14 gün) kapanmadan ödenemez.
       *    Eski siparişlerde bu tarih GEÇMİŞTE, yeni siparişlerde GELECEKTE —
       *    "kullanılabilir bakiye" ile "bekleyen bakiye" ayrımı ancak ikisi
       *    birden varken ekranda görünür.
       */
      const availableAt = new Date(olusturma.getTime() + HAKEDIS_GUN * GUN);
      ledgerSayisi += await ledgerYaz(prisma, [
        {
          sellerId: c.varyant.product.sellerId,
          type: 'SALE',
          amountMinor: c.satirToplami,
          orderItemId: kalemKaydi.id,
          description: `Satış — ${siparisNo}`,
          availableAt,
          createdAt: olusturma,
        },
        {
          sellerId: c.varyant.product.sellerId,
          type: 'COMMISSION',
          amountMinor: -c.komisyonTutari,
          orderItemId: kalemKaydi.id,
          description: `Komisyon %${(c.oran.rateBps / 100).toFixed(2)} — ${siparisNo}`,
          availableAt,
          createdAt: olusturma,
        },
        {
          sellerId: c.varyant.product.sellerId,
          type: 'SHIPPING_SHARE',
          amountMinor: KARGO_PAKET_BASI,
          orderItemId: kalemKaydi.id,
          description: `Kargo payı — ${siparisNo}`,
          availableAt,
          createdAt: olusturma,
        },
      ]);

      // ── İade: ledger geri çevrimleri ──
      if (
        siparis.iade &&
        (siparis.iade.durum === 'REFUNDED' || siparis.iade.durum === 'RECEIVED')
      ) {
        const iadeAni = olayAni(olusturma, 10, simdi);
        ledgerSayisi += await ledgerYaz(prisma, [
          {
            sellerId: c.varyant.product.sellerId,
            type: 'REFUND',
            amountMinor: -c.satirToplami,
            orderItemId: kalemKaydi.id,
            description: `İade — ${siparisNo}`,
            availableAt: iadeAni,
            createdAt: iadeAni,
          },
          {
            sellerId: c.varyant.product.sellerId,
            type: 'COMMISSION_REVERSAL',
            amountMinor: c.komisyonTutari,
            orderItemId: kalemKaydi.id,
            description: `Komisyon iadesi — ${siparisNo}`,
            availableAt: iadeAni,
            createdAt: iadeAni,
          },
        ]);
      }
    }

    await odemeYaz(prisma, kayit.id, siparis, ortak.grandTotalMinor, olusturma);
    await olayYaz(prisma, kayit.id, siparis, olusturma, simdi);
    if (siparis.iade) iadeSayisi += await iadeYaz(prisma, kayit.id, siparis, olusturma, simdi);

    if (kupon) {
      await prisma.couponRedemption.upsert({
        where: { couponId_orderId: { couponId: kupon, orderId: kayit.id } },
        update: { amountMinor: indirim },
        create: { couponId: kupon, userId, orderId: kayit.id, amountMinor: indirim },
      });
    }
  }

  const payoutSayisi = await payoutYaz(prisma, girdi.saticiId, simdi);
  ledgerSayisi += await duzeltmeYaz(prisma, girdi.saticiId, simdi);

  // ── Bakiyeler ledger'dan HESAPLANIR, kolondan okunmaz (şema kural) ──
  const bakiye = new Map<string, bigint>();
  for (const [slug, sellerId] of girdi.saticiId) {
    const toplam = await prisma.ledgerEntry.aggregate({
      where: { sellerId },
      _sum: { amountMinor: true },
    });
    bakiye.set(slug, toplam._sum.amountMinor ?? 0n);
  }

  return {
    siparisSayisi: SIPARISLER.length,
    paketSayisi,
    kalemSayisi,
    ledgerSayisi,
    iadeSayisi,
    payoutSayisi,
    kuponSayisi: kuponId.size,
    bakiye,
  };
}

// ── Yardımcılar ────────────────────────────────────────────────────────────

const kargolandi = (durum: PackageStatus): boolean =>
  durum === 'SHIPPED' ||
  durum === 'DELIVERED' ||
  durum === 'RETURN_REQUESTED' ||
  durum === 'RETURNED';

const teslimEdildi = (durum: PackageStatus): boolean =>
  durum === 'DELIVERED' || durum === 'RETURN_REQUESTED' || durum === 'RETURNED';

/**
 * Kategori ağacında YUKARI YÜRÜR. Ürünün kategorisi üçüncü seviye
 * (`kadin-gomlek`) ama komisyon kuralı ikinci seviyede (`kadin-ust-giyim`)
 * tanımlı; doğrudan arama her ürünü varsayılana düşürürdü.
 */
function komisyonCoz(
  komisyon: ReadonlyMap<string, { versionId: string; rateBps: number }>,
  kategoriSlug: string,
): { versionId: string; rateBps: number } {
  let gecerli: string | null = kategoriSlug;
  const gorulen = new Set<string>();
  while (gecerli && !gorulen.has(gecerli)) {
    gorulen.add(gecerli);
    const bulunan = komisyon.get(gecerli);
    if (bulunan) return bulunan;
    gecerli = KATEGORILER.find((k) => k.slug === gecerli)?.ustSlug ?? null;
  }
  const varsayilan = komisyon.get(VARSAYILAN_KOMISYON);
  if (!varsayilan) throw new Error('Varsayılan komisyon versiyonu yok.');
  return varsayilan;
}

/** %10, azami 200 ₺ — `HOSGELDIN10` kuponunun kuralı. */
function indirimHesapla(sepetMinor: bigint): bigint {
  const yuzde = applyBps(sepetMinor, 1000);
  const tavan = tl(200);
  return yuzde > tavan ? tavan : yuzde;
}

interface LedgerGirdisi {
  sellerId: string;
  type:
    | 'SALE'
    | 'COMMISSION'
    | 'SHIPPING_SHARE'
    | 'REFUND'
    | 'COMMISSION_REVERSAL'
    | 'PAYOUT'
    | 'ADJUSTMENT';
  amountMinor: bigint;
  orderItemId?: string;
  payoutId?: string;
  description: string;
  availableAt: Date | null;
  createdAt: Date;
}

/**
 * ⚠️ APPEND-ONLY: var olan satıra DOKUNULMAZ. Doğal anahtar
 *    (orderItemId, type) — bir sipariş kaleminin bir türden en fazla bir
 *    kaydı olur. `payoutId`li kayıtlarda anahtar (payoutId, type).
 */
async function ledgerYaz(prisma: PrismaClient, girdiler: LedgerGirdisi[]): Promise<number> {
  let yazilan = 0;
  for (const g of girdiler) {
    const varOlan = await prisma.ledgerEntry.findFirst({
      where: {
        sellerId: g.sellerId,
        type: g.type,
        ...(g.orderItemId ? { orderItemId: g.orderItemId } : {}),
        ...(g.payoutId ? { payoutId: g.payoutId } : {}),
        ...(!g.orderItemId && !g.payoutId ? { description: g.description } : {}),
      },
    });
    if (varOlan) continue;
    await prisma.ledgerEntry.create({ data: g });
    yazilan += 1;
  }
  return yazilan;
}

async function odemeYaz(
  prisma: PrismaClient,
  orderId: string,
  siparis: SiparisTanimi,
  tutar: bigint,
  olusturma: Date,
): Promise<void> {
  const conversationId = `demo-conv-${siparis.sira}`;
  const ortak = {
    provider: 'iyzico',
    providerRef: siparis.odeme === 'CREATED' ? null : `demo-ref-${siparis.sira}`,
    status: siparis.odeme,
    amountMinor: tutar,
    installment: 1,
    cardMask: siparis.odeme === 'CREATED' ? null : '552879******2334',
    cardBrand: siparis.odeme === 'CREATED' ? null : 'MasterCard',
    failureCode: siparis.odeme === 'FAILED' ? 'PROVIDER_DECLINED' : null,
    failureMessage: siparis.odeme === 'FAILED' ? 'Kart limiti yetersiz.' : null,
    authorizedAt: siparis.odeme === 'CAPTURED' || siparis.odeme === 'REFUNDED' ? olusturma : null,
    capturedAt: siparis.odeme === 'CAPTURED' || siparis.odeme === 'REFUNDED' ? olusturma : null,
    createdAt: olusturma,
  };

  const intent = await prisma.paymentIntent.upsert({
    where: { orderId },
    update: ortak,
    create: { orderId, conversationId, ...ortak },
  });

  /*
   * ⚠️ BAŞARISIZ DENEMELER YÖNETİM PANELİNİ BESLİYOR. `PrismaFraudSignalBridge`
   *    `payment_attempts` üzerinden CARD_TESTING sinyali türetiyor; deneme
   *    satırı yoksa o ekran her zaman boş açılır ve "uyarı yok" ile "uyarı
   *    üretilemiyor" ayırt edilemez.
   */
  const denemeSayisi = siparis.basarisizDeneme ?? (siparis.odeme === 'FAILED' ? 1 : 0);
  for (let no = 1; no <= denemeSayisi; no += 1) {
    await prisma.paymentAttempt.upsert({
      where: { intentId_attemptNo: { intentId: intent.id, attemptNo: no } },
      update: { createdAt: new Date(olusturma.getTime() + no * 60_000) },
      create: {
        intentId: intent.id,
        attemptNo: no,
        status: 'FAILED',
        providerCode: '10051',
        providerMessage: 'Insufficient funds',
        mappedErrorCode: 'PAYMENT_DECLINED',
        latencyMs: 780 + no * 13,
        createdAt: new Date(olusturma.getTime() + no * 60_000),
      },
    });
  }

  if (siparis.odeme === 'CAPTURED' && denemeSayisi === 0) {
    await prisma.paymentAttempt.upsert({
      where: { intentId_attemptNo: { intentId: intent.id, attemptNo: 1 } },
      update: { status: 'CAPTURED', createdAt: olusturma },
      create: {
        intentId: intent.id,
        attemptNo: 1,
        status: 'CAPTURED',
        providerCode: '00',
        providerMessage: 'Approved',
        latencyMs: 640,
        createdAt: olusturma,
      },
    });
  }
}

/** ⚠️ `OrderEvent` APPEND-ONLY — (orderId, type) doğal anahtar sayılıyor. */
async function olayYaz(
  prisma: PrismaClient,
  orderId: string,
  siparis: SiparisTanimi,
  olusturma: Date,
  simdi: number,
): Promise<void> {
  const olaylar: {
    type: string;
    actorType: 'SYSTEM' | 'CUSTOMER' | 'SELLER';
    payload: Prisma.InputJsonValue;
    gecikmeGun: number;
  }[] = [
    {
      type: 'order.created',
      actorType: 'CUSTOMER',
      payload: { orderNumber: demoSiparisNo(siparis.sira) },
      gecikmeGun: 0,
    },
  ];

  if (siparis.odeme === 'CAPTURED' || siparis.odeme === 'REFUNDED') {
    olaylar.push({
      type: 'payment.captured',
      actorType: 'SYSTEM',
      payload: { provider: 'iyzico' },
      gecikmeGun: 0,
    });
  }
  if (siparis.odeme === 'FAILED') {
    olaylar.push({
      type: 'payment.failed',
      actorType: 'SYSTEM',
      payload: { code: 'PROVIDER_DECLINED' },
      gecikmeGun: 0,
    });
  }
  if (kargolandi(siparis.paketDurumu)) {
    olaylar.push({
      type: 'package.shipped',
      actorType: 'SELLER',
      payload: { carrier: siparis.kargo?.firma ?? 'Yurtiçi Kargo' },
      gecikmeGun: 1,
    });
  }
  if (teslimEdildi(siparis.paketDurumu)) {
    olaylar.push({ type: 'package.delivered', actorType: 'SYSTEM', payload: {}, gecikmeGun: 3 });
  }
  if (siparis.iade) {
    olaylar.push({
      type: 'return.requested',
      actorType: 'CUSTOMER',
      payload: { reason: siparis.iade.sebep },
      gecikmeGun: 8,
    });
  }

  for (const olay of olaylar) {
    const varOlan = await prisma.orderEvent.findFirst({ where: { orderId, type: olay.type } });
    if (varOlan) continue;
    await prisma.orderEvent.create({
      data: {
        orderId,
        type: olay.type,
        actorType: olay.actorType,
        payload: olay.payload,
        createdAt: olayAni(olusturma, olay.gecikmeGun, simdi),
      },
    });
  }
}

async function iadeYaz(
  prisma: PrismaClient,
  orderId: string,
  siparis: SiparisTanimi,
  olusturma: Date,
  simdi: number,
): Promise<number> {
  if (!siparis.iade) return 0;
  const iadeNo = `IADE-DEMO-${String(siparis.sira).padStart(4, '0')}`;

  const kalemler = await prisma.orderItem.findMany({ where: { orderId } });
  const tutar = kalemler.reduce((acc, k) => acc + k.lineTotalMinor, 0n);
  const karar = siparis.iade.durum !== 'REQUESTED';

  const ortak = {
    orderId,
    status: siparis.iade.durum,
    reason: siparis.iade.sebep,
    note: siparis.iade.not,
    photoKeys: [],
    refundAmountMinor: siparis.iade.durum === 'REFUNDED' ? tutar : 0n,
    decidedBy: karar ? 'seed' : null,
    decidedAt: karar ? olayAni(olusturma, 9, simdi) : null,
    refundedAt: siparis.iade.durum === 'REFUNDED' ? olayAni(olusturma, 10, simdi) : null,
    createdAt: olayAni(olusturma, 8, simdi),
  };

  const iade = await prisma.returnRequest.upsert({
    where: { returnNumber: iadeNo },
    update: ortak,
    create: { returnNumber: iadeNo, ...ortak },
  });

  for (const kalem of kalemler) {
    await prisma.returnItem.upsert({
      where: { returnId_orderItemId: { returnId: iade.id, orderItemId: kalem.id } },
      update: { quantity: kalem.quantity, refundMinor: kalem.lineTotalMinor },
      create: {
        returnId: iade.id,
        orderItemId: kalem.id,
        quantity: kalem.quantity,
        refundMinor: kalem.lineTotalMinor,
      },
    });
  }

  return 1;
}

async function kuponlariYaz(
  prisma: PrismaClient,
  saticiId: ReadonlyMap<string, string>,
  simdi: number,
): Promise<Map<string, string>> {
  const sonuc = new Map<string, string>();

  for (const kupon of KUPONLAR) {
    const sellerId = kupon.saticiSlug ? (saticiId.get(kupon.saticiSlug) ?? null) : null;
    const gecerlilikSonu = new Date(simdi + kupon.gecerlilikGun * GUN);
    const ortak = {
      sellerId,
      discountType: kupon.tur,
      discountValue: kupon.deger,
      maxDiscountMinor: kupon.azamiIndirimMinor ?? null,
      minCartMinor: kupon.asgariSepetMinor,
      usageLimit: kupon.kullanimSiniri,
      usageLimitPerUser: 1,
      validFrom: new Date(simdi - 60 * GUN),
      validTo: gecerlilikSonu,
      isActive: kupon.aktif,
    };
    const satir = await prisma.coupon.upsert({
      where: { code: kupon.kod },
      update: ortak,
      create: { code: kupon.kod, ...ortak },
    });
    sonuc.set(kupon.kod, satir.id);
  }

  // ⚠️ `usedCount` MUTLAK yazılır: gerçek kullanım sayısı redemption
  //    tablosundan sayılır. Artırım kullanılsaydı her koşuda şişerdi.
  for (const [kod, id] of sonuc) {
    const kullanim = await prisma.couponRedemption.count({ where: { couponId: id } });
    await prisma.coupon.update({ where: { id }, data: { usedCount: kullanim } });
    void kod;
  }

  return sonuc;
}

async function payoutYaz(
  prisma: PrismaClient,
  saticiId: ReadonlyMap<string, string>,
  simdi: number,
): Promise<number> {
  const talepler = [
    { slug: 'atolye-nord', tutar: tl(2500), durum: 'REQUESTED' as const, gunOnce: 2 },
    { slug: 'mavra', tutar: tl(1800), durum: 'REQUESTED' as const, gunOnce: 1 },
    { slug: 'denim-atolyesi', tutar: tl(1200), durum: 'SENT' as const, gunOnce: 20 },
  ];

  let sayi = 0;
  for (const talep of talepler) {
    const sellerId = saticiId.get(talep.slug);
    if (!sellerId) continue;
    const payoutRef = `PAYOUT-DEMO-${talep.slug}`;
    const olusturma = new Date(simdi - talep.gunOnce * GUN);

    const ortak = {
      sellerId,
      amountMinor: talep.tutar,
      status: talep.durum,
      // ⚠️ Çözülemez demo değeri — gerçek payout gönderimi burada PATLAR ve
      //    patlaması doğrudur (bkz. katalog.ts, satıcı yazımı).
      ibanEnc: `demo:not-encrypted:${talep.slug}`,
      approvedBy: talep.durum === 'SENT' ? 'seed' : null,
      approvedAt: talep.durum === 'SENT' ? olayAni(olusturma, 1, simdi) : null,
      providerRef: talep.durum === 'SENT' ? `demo-payout-${talep.slug}` : null,
      sentAt: talep.durum === 'SENT' ? olayAni(olusturma, 2, simdi) : null,
      createdAt: olusturma,
    };

    const payout = await prisma.payoutRequest.upsert({
      where: { payoutRef },
      update: ortak,
      create: { payoutRef, ...ortak },
    });
    sayi += 1;

    // Ödenen payout ledger'a EKSİ olarak düşer; bakiye böylece azalır.
    if (talep.durum === 'SENT') {
      await ledgerYaz(prisma, [
        {
          sellerId,
          type: 'PAYOUT',
          amountMinor: -talep.tutar,
          payoutId: payout.id,
          description: `Hakediş ödemesi — ${payoutRef}`,
          availableAt: null,
          createdAt: olayAni(olusturma, 2, simdi),
        },
      ]);
    }
  }
  return sayi;
}

/** Elle düzeltme kalemi — ADJUSTMENT türünün ekranda görülebilmesi için. */
async function duzeltmeYaz(
  prisma: PrismaClient,
  saticiId: ReadonlyMap<string, string>,
  simdi: number,
): Promise<number> {
  const sellerId = saticiId.get('kuzey-spor');
  if (!sellerId) return 0;
  return ledgerYaz(prisma, [
    {
      sellerId,
      type: 'ADJUSTMENT',
      amountMinor: -tl(50),
      description: 'Kargo SLA gecikmesi telafisi — yönetim düzeltmesi',
      availableAt: null,
      createdAt: new Date(simdi - 7 * GUN),
    },
  ]);
}
