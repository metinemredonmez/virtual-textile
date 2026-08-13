import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { isApiFailure, type ProductDetailWire } from '@vt/contracts';
import { isTryOnSupported, type TryOnCategoryName } from '@vt/config/constants';
import { serverFetch } from '@/lib/api/server';

/**
 * ÜRÜN OKUMA — iki sayfanın (detay ve deneme) ortak kapısı.
 *
 * ⚠️ `cache()` ZORUNLU: aynı istek içinde hem `generateMetadata` hem sayfa
 *    gövdesi çağırıyor. Sarılmazsa her sayfa görüntülemede API'ye İKİ kez
 *    gidilir ve bunu hiçbir test göstermez — yalnızca fatura gösterir.
 *
 * ⚠️ Katalog ucu `@Public()`; Sunucu Bileşeninden DOĞRUDAN API'ye gidilir,
 *    vekilden geçirilmez (frontend-mimari.md §5). `/products/:slug` üzerinde
 *    `@RateLimit` YOK — `forwardClientIp` bu yüzden gereksiz; ürün LİSTESİ
 *    ucunda ise zorunludur.
 */
export const urunGetir = cache(async (slug: string): Promise<ProductDetailWire> => {
  try {
    const { data } = await serverFetch<ProductDetailWire, `/products/${string}`>(
      `/products/${slug}`,
    );
    return data;
  } catch (error) {
    // 404'ü hata sınırına taşımak beyaz ekran üretirdi; Next'in 404'ü doğrudur.
    if (isApiFailure(error) && error.httpStatus === 404) notFound();
    throw error;
  }
});

/**
 * DENEME KAPISININ TAMAMI.
 *
 * ⚠️ İKİ YARIM: `tryOnable` yalnızca "kategorinin bir try-on karşılığı var mı"
 *    diyor (`catalog.service.ts`: `c."tryOnCategory" IS NOT NULL`), yani AYAKKABI
 *    için de `true` döner. İkinci yarı bugünkü SAĞLAYICI YETENEĞİdir. Yalnız
 *    ilk yarıya bakan bir ekran, ayakkabıda deneme düğmesi çıkarır ve düğme
 *    `PRODUCT_NOT_TRYONABLE` ile geri döner.
 */
export function denenebilir(urun: ProductDetailWire): boolean {
  const kategori = urun.category.tryOnCategory as TryOnCategoryName | null;
  return urun.tryOnable && isTryOnSupported(kategori);
}
