import type {
  MinorString,
  OutfitLayerCategoryWire,
  ProductDetailWire,
  ProductVariantWire,
} from '@vt/contracts';

/**
 * DENEME PARÇASI — karuselin ve kombinin taşıdığı tek birim.
 *
 * ⚠️ Birim ÜRÜN değil VARYANTtır. `POST /tryon` `variantId` istiyor ve önbellek
 *    anahtarı da onunla kuruluyor; ürün kimliğiyle çalışan bir arayüz, rengi
 *    değiştiren kullanıcıya eski görseli gösterirdi.
 *
 * ⚠️ `kategori` NULL OLAMAZ: denenemeyen bir parça karusele hiç girmez.
 *    Nullable bırakılsaydı her kullanım yerinde bir `if` gerekirdi ve o `if`i
 *    atlayan yol, kullanıcıyı basınca hata veren bir düğmeye götürürdü.
 */
export interface Parca {
  variantId: string;
  urunSlug: string;
  baslik: string;
  markaAdi: string;
  renk: string;
  beden: string;
  /** R2 nesne anahtarı; tam adresi `mediaUrl()` kurar. */
  gorselAnahtari: string | null;
  fiyatMinor: MinorString;
  kategori: OutfitLayerCategoryWire;
}

/**
 * ⚠️ `kategori` çağıran taraftan gelir çünkü kapı ORADA açılır:
 *    `isTryOnSupported()` tip daraltıcıdır ve dönüşünü burada tekrar
 *    daraltmaya çalışmak kapıyı ikinci bir yere kopyalamak olurdu.
 */
export function parcaKur(
  urun: Pick<ProductDetailWire, 'slug' | 'title' | 'brandName' | 'images'>,
  varyant: ProductVariantWire,
  kategori: OutfitLayerCategoryWire,
): Parca {
  const kapak = urun.images.find((gorsel) => gorsel.isPrimary) ?? urun.images[0] ?? null;

  return {
    variantId: varyant.id,
    urunSlug: urun.slug,
    baslik: urun.title,
    markaAdi: urun.brandName,
    renk: varyant.color,
    beden: varyant.size,
    gorselAnahtari: kapak?.storageKey ?? null,
    fiyatMinor: varyant.priceMinor,
    kategori,
  };
}

/**
 * KOMBİNİN KİMLİĞİ — istemci önbelleğinin anahtarı.
 *
 * ⚠️ Varyant kimlikleri SIRALANIR. Sunucu da sıralıyor (önce katman, sonra
 *    kimlik — bkz. @vt/adapters → orderOutfitPieces) çünkü sıra önbellek
 *    anahtarını etkiliyor. İstemcide dokunma sırasını korusaydık aynı kombin
 *    iki farklı yerel anahtara düşer, kullanıcı geri döndüğünde hazır sonuç
 *    varken yeniden üretim başlatırdık — parası ödenmiş olarak.
 *
 * ⚠️ `localeCompare` KULLANILMAZ: sonucu tarayıcının yerel ayarına bağlıdır.
 */
export function denemeImzasi(
  fotografId: string,
  parcalar: readonly Parca[],
  mod: 'FAST' | 'QUALITY',
): string {
  const kimlikler = parcalar.map((parca) => parca.variantId).sort();
  return `${fotografId}|${mod}|${kimlikler.join(',')}`;
}
