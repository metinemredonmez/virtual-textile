/**
 * KATALOG YAZIMI — kategori, komisyon, satıcı, ürün, varyant, stok, görsel.
 *
 * ⚠️ HER YAZIM MUTLAK DEĞER YAZAR, ARTIRIM YAZMAZ.
 *    Eski seed stok düşerken `{ decrement: 1 }` kullanıyordu; ikinci
 *    çalıştırmada stok bir kez daha düşerdi. Bu dosyadaki (ve ticaret.ts'teki)
 *    her yazım hedef DURUMU yazar — `onHand` doğrudan hesaplanmış nihai değere
 *    set edilir. İdempotentliğin nöbetçi bayrağından değil, YAZIM BİÇİMİNDEN
 *    gelmesinin sebebi bu: yarım kalmış bir koşu ikinci koşuda kendini onarır.
 */
import { randomUUID } from 'node:crypto';
import type { StorageProvider } from '@vt/adapters';
import type { PrismaClient, Prisma } from '../../generated/client/index.js';
import { gorselYukle, KAYNAK_GENISLIK, KAYNAK_YUKSEKLIK } from './gorsel.js';
import { tl } from './para.js';
import { ACILAR, KATEGORILER, SATICILAR, URUNLER, type UrunTanimi } from './veri.js';

export interface KatalogSonucu {
  readonly kategoriId: ReadonlyMap<string, string>;
  readonly saticiId: ReadonlyMap<string, string>;
  readonly urunId: ReadonlyMap<string, string>;
  readonly urunGorselAnahtari: ReadonlyMap<string, string>;
  /** kategoriSlug → { versionId, rateBps } */
  readonly komisyon: ReadonlyMap<string, { versionId: string; rateBps: number }>;
  readonly yuklenenGorsel: number;
  readonly atlananGorsel: number;
  readonly varyantSayisi: number;
  readonly depolamaAnahtarlari: readonly string[];
}

/** Kategori ağacında karşılığı bulunamayan ürünlerin düştüğü anahtar. */
export const VARSAYILAN_KOMISYON = '(varsayılan)';

/** Kategori bazlı komisyon oranları (bps). Kategori listede yoksa varsayılan. */
const KOMISYON_BPS: Readonly<Record<string, number>> = {
  'kadin-ust-giyim': 1200,
  'kadin-alt-giyim': 1400,
  'kadin-elbise': 1500,
  'kadin-dis-giyim': 1300,
  'kadin-spor-giyim': 1100,
  erkek: 1200,
  unisex: 1000,
  cocuk: 900,
};

export async function katalogYaz(
  prisma: PrismaClient,
  storage: StorageProvider | null,
): Promise<KatalogSonucu> {
  // ── Kategori ağacı ───────────────────────────────────────────────────────
  const kategoriId = new Map<string, string>();
  // Liste ÜSTTEN ALTA sıralı; `ustSlug` her zaman daha önce işlenmiş olur.
  for (const kategori of KATEGORILER) {
    const parentId = kategori.ustSlug ? (kategoriId.get(kategori.ustSlug) ?? null) : null;
    if (kategori.ustSlug && parentId === null) {
      throw new Error(`Kategori ağacı bozuk: "${kategori.slug}" üstü "${kategori.ustSlug}" yok.`);
    }
    const satir = await prisma.category.upsert({
      where: { slug: kategori.slug },
      update: {
        name: kategori.ad,
        parentId,
        tryOnCategory: kategori.tryOn,
        sortOrder: kategori.sira,
        isActive: true,
      },
      create: {
        slug: kategori.slug,
        name: kategori.ad,
        parentId,
        tryOnCategory: kategori.tryOn,
        sortOrder: kategori.sira,
      },
    });
    kategoriId.set(kategori.slug, satir.id);
  }

  // ── Komisyon kuralları ve versiyonları ───────────────────────────────────
  const komisyon = new Map<string, { versionId: string; rateBps: number }>();

  /*
   * ⚠️ KATEGORİSİZ VARSAYILAN KURAL ŞART. `OrderItem.commissionRuleVersionId`
   *    ZORUNLU bir yabancı anahtar; kategori kuralı bulunamayan bir ürün
   *    sipariş edilemez. `FINANCE.defaultCommissionBps` (%12) burada gerçek bir
   *    satıra dönüşüyor, yoksa "varsayılan komisyon" yalnızca bir sabit olarak
   *    kalır ve hiçbir siparişte kullanılamaz.
   */
  const varsayilanKural =
    (await prisma.commissionRule.findFirst({ where: { categoryId: null, sellerId: null } })) ??
    (await prisma.commissionRule.create({
      data: { label: 'Varsayılan platform komisyonu' },
    }));
  const varsayilanVersiyon =
    (await prisma.commissionRuleVersion.findFirst({
      where: { ruleId: varsayilanKural.id, validTo: null },
    })) ??
    (await prisma.commissionRuleVersion.create({
      data: {
        ruleId: varsayilanKural.id,
        rateBps: 1200,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        createdBy: 'seed',
      },
    }));
  komisyon.set(VARSAYILAN_KOMISYON, {
    versionId: varsayilanVersiyon.id,
    rateBps: varsayilanVersiyon.rateBps,
  });

  for (const [slug, bps] of Object.entries(KOMISYON_BPS)) {
    const categoryId = kategoriId.get(slug);
    if (!categoryId) continue;

    /*
     * ⚠️ `upsert` KULLANILAMAZ: benzersizlik veritabanında
     *    `UNIQUE ... NULLS NOT DISTINCT` ile tanımlı ve Prisma'nın
     *    compound-unique arayüzüyle ifade edilemiyor (bkz. schema.prisma).
     */
    const kural =
      (await prisma.commissionRule.findFirst({ where: { categoryId, sellerId: null } })) ??
      (await prisma.commissionRule.create({
        data: { categoryId, label: `Kategori komisyonu — ${slug}` },
      }));

    const acikVersiyon = await prisma.commissionRuleVersion.findFirst({
      where: { ruleId: kural.id, validTo: null },
    });

    if (acikVersiyon) {
      komisyon.set(slug, { versionId: acikVersiyon.id, rateBps: acikVersiyon.rateBps });
      continue;
    }

    const versiyon = await prisma.commissionRuleVersion.create({
      data: {
        ruleId: kural.id,
        rateBps: bps,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        createdBy: 'seed',
      },
    });
    komisyon.set(slug, { versionId: versiyon.id, rateBps: bps });
  }

  /*
   * ⚠️ EN AZ BİR KURAL İKİ VERSİYON TAŞIMALI. Snapshot'ın ne işe yaradığı
   *    ancak "oran değişti ama eski sipariş eski oranı taşımaya devam ediyor"
   *    görülünce anlaşılır. Tek versiyonlu bir tabloda o ekran boş bir vaat.
   *    Kapanmış versiyon GERİYE dönük yazılır: validFrom 2025-01-01,
   *    validTo 2026-01-01 — açık versiyonun başladığı an.
   */
  const ustGiyimId = kategoriId.get('kadin-ust-giyim');
  if (ustGiyimId) {
    const kural = await prisma.commissionRule.findFirst({
      where: { categoryId: ustGiyimId, sellerId: null },
    });
    if (kural) {
      const eski = await prisma.commissionRuleVersion.findFirst({
        where: { ruleId: kural.id, validTo: { not: null } },
      });
      if (!eski) {
        await prisma.commissionRuleVersion.create({
          data: {
            ruleId: kural.id,
            rateBps: 1000,
            validFrom: new Date('2025-01-01T00:00:00Z'),
            validTo: new Date('2026-01-01T00:00:00Z'),
            createdBy: 'seed',
          },
        });
      }
    }
  }

  // ── Satıcılar ────────────────────────────────────────────────────────────
  const saticiId = new Map<string, string>();

  for (const satici of SATICILAR) {
    /*
     * ⚠️ `taxNumberEnc`/`ibanEnc` BURADA ŞİFRELENMİYOR ve bu bilinçli:
     *    gerçek yolda uygulama katmanı AES-256-GCM ile yazıyor. Buradaki
     *    değerler ÇÖZÜLEMEZ ve payout gönderimi denenirse orada PATLAR —
     *    patlaması da doğrudur. Sahte bir IBAN'ın çözülebilir görünmesi çok
     *    daha kötü olurdu.
     */
    const magaza = await prisma.store.findUnique({ where: { slug: satici.slug } });

    const ortak = {
      legalName: satici.unvan,
      displayName: satici.ad,
      taxNumberEnc: `demo:not-encrypted:${satici.slug}`,
      taxOffice: 'Demo VD',
      ibanEnc: `demo:not-encrypted:${satici.slug}`,
      contactEmail: `satici@${satici.slug}.example.com`,
      contactPhone: '+905320000000',
      status: satici.durum,
      statusReason: satici.durumGerekcesi ?? null,
      qualityScore: satici.kaliteSkoru,
      approvedAt: satici.durum === 'PENDING' ? null : new Date('2026-02-01T09:00:00Z'),
    } satisfies Prisma.SellerUncheckedUpdateInput;

    const id = magaza
      ? (await prisma.seller.update({ where: { id: magaza.sellerId }, data: ortak })).id
      : (
          await prisma.seller.create({
            data: { ...ortak, store: { create: { slug: satici.slug, name: satici.ad } } },
          })
        ).id;

    saticiId.set(satici.slug, id);

    for (const belge of satici.belgeler ?? []) {
      const varOlan = await prisma.sellerDocument.findFirst({
        where: { sellerId: id, type: belge.tur },
      });
      if (varOlan) continue;
      await prisma.sellerDocument.create({
        data: {
          sellerId: id,
          type: belge.tur,
          // ⚠️ private kova. Nesne YÜKLENMEZ: satıcı belgesi kişisel veridir ve
          //    demo için sahtesini private kovaya koymanın hiçbir faydası yok.
          //    Yönetim ekranı satırı gösterir, indirme imzalı URL üretir ve
          //    nesne olmadığı için 404 döner — beklenen davranış.
          storageKey: `seller-docs/${id}/${belge.tur.toLowerCase()}`,
          fileName: belge.dosyaAdi,
        },
      });
    }
  }

  // ── Ürünler ──────────────────────────────────────────────────────────────
  const urunId = new Map<string, string>();
  const urunGorselAnahtari = new Map<string, string>();
  const depolamaAnahtarlari: string[] = [];
  let yuklenenGorsel = 0;
  let atlananGorsel = 0;
  let varyantSayisi = 0;

  for (const urun of URUNLER) {
    const sellerId = saticiId.get(urun.saticiSlug);
    const categoryId = kategoriId.get(urun.kategoriSlug);
    if (!sellerId) throw new Error(`Ürün "${urun.slug}" satıcısı yok: ${urun.saticiSlug}`);
    if (!categoryId) throw new Error(`Ürün "${urun.slug}" kategorisi yok: ${urun.kategoriSlug}`);

    const saticiAdi = SATICILAR.find((s) => s.slug === urun.saticiSlug)?.ad ?? urun.saticiSlug;

    const ortak = {
      sellerId,
      categoryId,
      title: urun.baslik,
      description: urun.aciklama,
      brandName: saticiAdi,
      gender: urun.cinsiyet,
      season: urun.sezon ?? null,
      collection: urun.koleksiyon ?? null,
      status: urun.durum,
      aiTags: urun.etiketler as Prisma.InputJsonValue,
      aiTagsApproved: urun.durum === 'PUBLISHED',
      tryOnScore: urun.tryOnSkoru > 0 ? urun.tryOnSkoru : null,
      tryOnIssues: (urun.tryOnSorunlari ?? []) as Prisma.InputJsonValue,
      sizeChart: (urun.bedenTablosu ?? {}) as Prisma.InputJsonValue,
      viewCount: urun.goruntuleme,
      tryOnCount: urun.denemeSayisi,
      popularityScore: urun.populerlik,
      publishedAt: urun.durum === 'PUBLISHED' ? new Date('2026-03-01T10:00:00Z') : null,
    };

    const satir = await prisma.product.upsert({
      where: { slug: urun.slug },
      update: ortak,
      create: { slug: urun.slug, ...ortak },
    });
    urunId.set(urun.slug, satir.id);

    varyantSayisi += await varyantYaz(prisma, satir.id, urun);

    // ── Görseller ──
    for (const [sira, aci] of ACILAR.entries()) {
      const varOlan = await prisma.productImage.findFirst({
        where: { productId: satir.id, angle: aci },
      });
      const gorselId = varOlan?.id ?? randomUUID();

      const sonuc = await gorselYukle({
        storage,
        urunId: satir.id,
        gorselId,
        urunSlug: urun.slug,
        aci,
      });
      if (sonuc.yuklendi) yuklenenGorsel += 1;
      else atlananGorsel += 1;
      depolamaAnahtarlari.push(sonuc.anahtar);

      const gorselOrtak = {
        storageKey: sonuc.anahtar,
        angle: aci,
        isPrimary: sira === 0,
        widthPx: KAYNAK_GENISLIK,
        heightPx: KAYNAK_YUKSEKLIK,
        sortOrder: sira,
      };

      if (varOlan) {
        await prisma.productImage.update({ where: { id: varOlan.id }, data: gorselOrtak });
      } else {
        await prisma.productImage.create({
          data: { id: gorselId, productId: satir.id, ...gorselOrtak },
        });
      }

      if (sira === 0) urunGorselAnahtari.set(urun.slug, sonuc.anahtar);
    }
  }

  return {
    kategoriId,
    saticiId,
    urunId,
    urunGorselAnahtari,
    komisyon,
    yuklenenGorsel,
    atlananGorsel,
    varyantSayisi,
    depolamaAnahtarlari,
  };
}

/**
 * Varyant + stok + fiyat geçmişi.
 *
 * ⚠️ Fiyat geçmişi APPEND-ONLY (şema kural 2): var olan satır güncellenmez,
 *    yoksa BİR kez yazılır. İkinci koşuda yeni satır açmamak için varlık
 *    kontrolü (variantId, priceMinor) üzerinden yapılıyor.
 */
async function varyantYaz(
  prisma: PrismaClient,
  productId: string,
  urun: UrunTanimi,
): Promise<number> {
  let sayi = 0;
  const fiyat = tl(urun.fiyatTl);
  const listeFiyati = urun.listeFiyatiTl === undefined ? null : tl(urun.listeFiyatiTl);

  for (const [renkSira, renk] of urun.renkler.entries()) {
    for (const [bedenSira, beden] of urun.bedenler.entries()) {
      const sku = `${urun.slug}-${slugla(renk.ad)}-${slugla(beden)}`;
      const varyant = await prisma.variant.upsert({
        where: { productId_color_size: { productId, color: renk.ad, size: beden } },
        update: {
          sku,
          colorHex: renk.hex,
          priceMinor: fiyat,
          listPriceMinor: listeFiyati,
          isActive: true,
          sortOrder: renkSira * 10 + bedenSira,
        },
        create: {
          productId,
          sku,
          color: renk.ad,
          colorHex: renk.hex,
          size: beden,
          priceMinor: fiyat,
          listPriceMinor: listeFiyati,
          sortOrder: renkSira * 10 + bedenSira,
        },
      });
      sayi += 1;

      // ⚠️ MUTLAK stok. `decrement` kullanılsaydı her koşu stoğu bir tur daha
      //    düşürür ve seed birkaç koşu sonra bütün vitrini tüketirdi.
      await prisma.inventory.upsert({
        where: { variantId: varyant.id },
        update: { onHand: urun.stok, reserved: 0 },
        create: { variantId: varyant.id, onHand: urun.stok, reserved: 0 },
      });

      if (listeFiyati !== null) {
        const gecmisVar = await prisma.priceHistory.findFirst({
          where: { variantId: varyant.id, priceMinor: listeFiyati },
        });
        if (!gecmisVar) {
          await prisma.priceHistory.create({
            data: {
              variantId: varyant.id,
              priceMinor: listeFiyati,
              listPriceMinor: listeFiyati,
              changedBy: 'seed',
              createdAt: new Date('2026-04-01T10:00:00Z'),
            },
          });
        }
      }

      const guncelGecmis = await prisma.priceHistory.findFirst({
        where: { variantId: varyant.id, priceMinor: fiyat },
      });
      if (!guncelGecmis) {
        await prisma.priceHistory.create({
          data: {
            variantId: varyant.id,
            priceMinor: fiyat,
            listPriceMinor: listeFiyati,
            changedBy: 'seed',
            createdAt: new Date('2026-05-15T10:00:00Z'),
          },
        });
      }
    }
  }

  return sayi;
}

/**
 * SKU üretimi için — Türkçe karakterler ASCII'ye indirgenir.
 *
 * ⚠️ HARİTA `toLowerCase()`TEN ÖNCE UYGULANIR ve bu bir tuzağın kapatılmasıdır.
 *    JavaScript'te `'İ'.toLowerCase()` tek bir `i` DEĞİL, `i` + U+0307
 *    (birleşen üstteki nokta) üretir; sonraki `[^a-z0-9]` temizliği o noktayı
 *    ayrı bir ayraca çevirir ve "İndigo" → `i-ndigo` olur. Ölçüldü: bu seed'in
 *    ilk koşusunda tam olarak bu oldu ve sipariş kalemleri SKU'yu bulamadı.
 *    NFD normalizasyonu artakalan birleşen işaretleri de siler.
 */
function slugla(metin: string): string {
  const harita: Record<string, string> = {
    ç: 'c',
    Ç: 'c',
    ğ: 'g',
    Ğ: 'g',
    ı: 'i',
    İ: 'i',
    ö: 'o',
    Ö: 'o',
    ş: 's',
    Ş: 's',
    ü: 'u',
    Ü: 'u',
  };
  return metin
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (h) => harita[h] ?? h)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
