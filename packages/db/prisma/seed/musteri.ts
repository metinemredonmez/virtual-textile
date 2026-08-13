/**
 * MÜŞTERİ TARAFI — yorum, favori, sepet, dijital gardırop.
 *
 * ⚠️ Gardırop kayıtları TESLİM EDİLMİŞ sipariş kalemlerinden türetilir ve
 *    doğal anahtarı `sourceOrderItemId`. Şema bunu açıkça söylüyor:
 *    `@@unique([userId, sourceOrderItemId])` — "mükerrer otomatik eklemeyi
 *    engelleyen doğal anahtar". Seed aynı anahtarı kullanıyor, yani seed'in
 *    yazdığı satır ile `wardrobe.auto-add.ts`in yazacağı satır ÇAKIŞIR ve
 *    ikinci kez eklenmez. Ayrı bir anahtar uydurulsaydı gerçek teslimat olayı
 *    ikinci bir kopya açardı.
 */
import type { PrismaClient, TryOnCategory } from '../../generated/client/index.js';
import { KATEGORILER, URUNLER } from './veri.js';

interface YorumTanimi {
  readonly urunSlug: string;
  readonly eposta: string;
  readonly puan: number;
  readonly baslik: string;
  readonly govde: string;
  readonly bedenGeriBildirimi: 'TOO_SMALL' | 'TRUE_TO_SIZE' | 'TOO_LARGE';
  readonly onayli: boolean;
}

const YORUMLAR: readonly YorumTanimi[] = [
  {
    urunSlug: 'keten-gomlek-oversize',
    eposta: 'demo@example.com',
    puan: 5,
    baslik: 'Keten beklediğimden yumuşak',
    govde:
      'İlk yıkamadan sonra dökümü daha da iyi oldu. Oversize kalıp beden büyütmeyi gerektirmiyor.',
    bedenGeriBildirimi: 'TRUE_TO_SIZE',
    onayli: true,
  },
  {
    urunSlug: 'keten-gomlek-oversize',
    eposta: 'ayse@example.com',
    puan: 4,
    baslik: 'Güzel ama kollar uzun',
    govde: 'Kumaş çok iyi. 1.62 boy için kol boyu biraz uzun kaldı, katlayarak kullanıyorum.',
    bedenGeriBildirimi: 'TOO_LARGE',
    onayli: true,
  },
  {
    urunSlug: 'yuksek-bel-mom-jean',
    eposta: 'zeynep@example.com',
    puan: 5,
    baslik: 'Kalıp tam oturdu',
    govde:
      'Rijit denim ilk gün biraz sert, iki kullanımda oturuyor. Deneme görseli gerçeğe yakındı.',
    bedenGeriBildirimi: 'TRUE_TO_SIZE',
    onayli: true,
  },
  {
    urunSlug: 'yuksek-bel-mom-jean',
    eposta: 'mehmet@example.com',
    puan: 3,
    baslik: 'Bel dar',
    govde: 'Normalde 28 giyiyorum, bu modelde 30 almak gerekiyor.',
    bedenGeriBildirimi: 'TOO_SMALL',
    onayli: true,
  },
  {
    urunSlug: 'midi-saten-elbise',
    eposta: 'ayse@example.com',
    puan: 5,
    baslik: 'Davet için ideal',
    govde: 'Saten ağır ve dökümlü, ucuz durmuyor. Şampanya rengi fotoğraftakiyle aynı.',
    bedenGeriBildirimi: 'TRUE_TO_SIZE',
    onayli: true,
  },
  {
    urunSlug: 'kapusonlu-sweatshirt',
    eposta: 'demo@example.com',
    puan: 4,
    baslik: 'Kalın ve rahat',
    govde: 'Şardon iç yüzey gerçekten kalın. Oversize olduğu için bir beden küçük alınabilir.',
    bedenGeriBildirimi: 'TOO_LARGE',
    onayli: true,
  },
  {
    urunSlug: 'yuksek-bel-tayt',
    eposta: 'zeynep@example.com',
    puan: 5,
    baslik: 'Opaklığı iyi',
    govde: 'Squat testinden geçti, transparanlık yok. Bel yüksekliği kaymıyor.',
    bedenGeriBildirimi: 'TRUE_TO_SIZE',
    onayli: true,
  },
  {
    urunSlug: 'yun-karisimli-trenckot',
    eposta: 'ayse@example.com',
    puan: 4,
    baslik: 'Boy uzun',
    govde: 'Diz altı deniyor ama 1.60 boyda neredeyse baldır ortası. Kumaşı çok iyi.',
    bedenGeriBildirimi: 'TRUE_TO_SIZE',
    onayli: true,
  },
  {
    urunSlug: 'triko-kazak',
    eposta: 'mehmet@example.com',
    puan: 2,
    baslik: 'Pilling yaptı',
    govde: 'İki kullanımda kollarda tüylenme başladı.',
    bedenGeriBildirimi: 'TRUE_TO_SIZE',
    // ⚠️ ONAYSIZ bilerek: yorum moderasyonunun gerçekten bir şeyi gizlediği
    //    ancak onaysız bir yorum varken görülür.
    onayli: false,
  },
  {
    urunSlug: 'oversize-denim-ceket',
    eposta: 'demo@example.com',
    puan: 4,
    baslik: 'Omuzlar geniş',
    govde: 'Oversize kalıp abartısız. Metal düğmeler sağlam duruyor.',
    bedenGeriBildirimi: 'TRUE_TO_SIZE',
    onayli: true,
  },
];

const FAVORILER: readonly { eposta: string; urunSlug: string }[] = [
  { eposta: 'demo@example.com', urunSlug: 'midi-saten-elbise' },
  { eposta: 'demo@example.com', urunSlug: 'yun-karisimli-trenckot' },
  { eposta: 'demo@example.com', urunSlug: 'yuksek-bel-mom-jean' },
  { eposta: 'demo@example.com', urunSlug: 'kapusonlu-sweatshirt' },
  { eposta: 'ayse@example.com', urunSlug: 'tul-detayli-abiye' },
  { eposta: 'zeynep@example.com', urunSlug: 'yuksek-bel-tayt' },
];

/** Demo müşterinin AÇIK sepeti — `/cart` ekranı boş açılmasın diye. */
const SEPET: readonly { eposta: string; sku: string; adet: number }[] = [
  { eposta: 'demo@example.com', sku: 'poplin-beyaz-gomlek-beyaz-m', adet: 1 },
  { eposta: 'demo@example.com', sku: 'yuksek-bel-tayt-siyah-m', adet: 2 },
];

export interface MusteriSonucu {
  readonly yorumSayisi: number;
  readonly favoriSayisi: number;
  readonly sepetKalemi: number;
  readonly gardiropSayisi: number;
}

export async function musteriYaz(
  prisma: PrismaClient,
  kullaniciId: ReadonlyMap<string, string>,
  urunId: ReadonlyMap<string, string>,
): Promise<MusteriSonucu> {
  let yorumSayisi = 0;
  for (const yorum of YORUMLAR) {
    const userId = kullaniciId.get(yorum.eposta);
    const productId = urunId.get(yorum.urunSlug);
    if (!userId || !productId) continue;
    await prisma.review.upsert({
      where: { productId_userId: { productId, userId } },
      update: {
        rating: yorum.puan,
        title: yorum.baslik,
        body: yorum.govde,
        fitFeedback: yorum.bedenGeriBildirimi,
        isApproved: yorum.onayli,
      },
      create: {
        productId,
        userId,
        rating: yorum.puan,
        title: yorum.baslik,
        body: yorum.govde,
        fitFeedback: yorum.bedenGeriBildirimi,
        isApproved: yorum.onayli,
      },
    });
    yorumSayisi += 1;
  }

  let favoriSayisi = 0;
  for (const favori of FAVORILER) {
    const userId = kullaniciId.get(favori.eposta);
    const productId = urunId.get(favori.urunSlug);
    if (!userId || !productId) continue;
    await prisma.favorite.upsert({
      where: { userId_productId: { userId, productId } },
      update: {},
      create: { userId, productId },
    });
    favoriSayisi += 1;
  }

  // ── Sepet ──
  let sepetKalemi = 0;
  const sepetSahipleri = [...new Set(SEPET.map((s) => s.eposta))];
  for (const eposta of sepetSahipleri) {
    const userId = kullaniciId.get(eposta);
    if (!userId) continue;
    const sepet = await prisma.cart.upsert({
      where: { userId },
      update: { expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      create: { userId, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });
    for (const kalem of SEPET.filter((s) => s.eposta === eposta)) {
      const varyant = await prisma.variant.findUnique({ where: { sku: kalem.sku } });
      if (!varyant) throw new Error(`Sepet kalemi SKU bulunamadı: ${kalem.sku}`);
      await prisma.cartItem.upsert({
        where: { cartId_variantId: { cartId: sepet.id, variantId: varyant.id } },
        update: { quantity: kalem.adet, addedPriceMinor: varyant.priceMinor },
        create: {
          cartId: sepet.id,
          variantId: varyant.id,
          quantity: kalem.adet,
          addedPriceMinor: varyant.priceMinor,
        },
      });
      sepetKalemi += 1;
    }
  }

  // ── Dijital gardırop: teslim edilmiş paketlerin kalemleri ──
  const teslimEdilenKalemler = await prisma.orderItem.findMany({
    where: {
      package: { status: { in: ['DELIVERED', 'RETURN_REQUESTED'] } },
      order: { orderNumber: { startsWith: 'VT-DEMO-' } },
    },
    include: { order: { select: { userId: true } }, variant: { select: { color: true } } },
  });

  let gardiropSayisi = 0;
  for (const kalem of teslimEdilenKalemler) {
    const userId = kalem.order.userId;
    if (!userId) continue;
    const kategori = tryOnKategorisiCoz(kalem.productId, urunId);
    if (!kategori) continue;

    await prisma.digitalWardrobeItem.upsert({
      where: { userId_sourceOrderItemId: { userId, sourceOrderItemId: kalem.id } },
      update: {
        category: kategori,
        color: kalem.variant.color,
        label: kalem.productTitle,
        productImageKey: kalem.imageKey,
        variantId: kalem.variantId,
      },
      create: {
        userId,
        source: 'PURCHASE',
        variantId: kalem.variantId,
        category: kategori,
        color: kalem.variant.color,
        label: kalem.productTitle,
        productImageKey: kalem.imageKey,
        sourceOrderItemId: kalem.id,
      },
    });
    gardiropSayisi += 1;
  }

  return { yorumSayisi, favoriSayisi, sepetKalemi, gardiropSayisi };
}

/**
 * `DigitalWardrobeItem.category` ZORUNLU ve `TryOnCategory`. Ürün kategorisi
 * üçüncü seviyede olabilir; ağaçta yukarı yürüyerek ilk dolu `tryOn` alanı
 * bulunur. Bulunamazsa kayıt hiç açılmaz — uydurma bir kategori yazmak
 * gardırobu yanlış filtrelerdi.
 */
function tryOnKategorisiCoz(
  productId: string,
  urunId: ReadonlyMap<string, string>,
): TryOnCategory | null {
  const slug = [...urunId.entries()].find(([, id]) => id === productId)?.[0];
  if (!slug) return null;
  const urun = URUNLER.find((u) => u.slug === slug);
  if (!urun) return null;

  let gecerli: string | null = urun.kategoriSlug;
  const gorulen = new Set<string>();
  while (gecerli && !gorulen.has(gecerli)) {
    gorulen.add(gecerli);
    const kategori = KATEGORILER.find((k) => k.slug === gecerli);
    if (kategori?.tryOn) return kategori.tryOn;
    gecerli = kategori?.ustSlug ?? null;
  }
  return null;
}
