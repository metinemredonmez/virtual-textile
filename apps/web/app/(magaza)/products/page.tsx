import type { Metadata } from 'next';
import { sorguyuOku, type AramaParametreleri } from './_liste/liste-sorgusu';
import { UrunListesi } from './_liste/urun-listesi';

/**
 * ÜRÜN LİSTESİ.
 *
 * Ekranın tüm durumu URL'dedir: filtre, sıralama, imleç ve doğal dil cümlesi.
 * Bu bir tercih değil, kuralın sonucu — global durum kütüphanesi yok ve liste
 * SSR olmak zorunda (SEO).
 */
export const metadata: Metadata = { title: 'Ürünler' };

/**
 * ⚠️ `force-dynamic`: `serverFetch(..., { forwardClientIp: true })` zaten
 *    `headers()` okuyup rotayı dinamik yapıyor. Açıkça yazmak, bir gün birinin
 *    "neden statik değil" diye aramasını önler. Gerekçe: `/products` ucu
 *    `scope:'ip'` ve 60/dk; IP taşınmazsa TÜM ziyaretçiler tek kovaya düşer.
 */
export const dynamic = 'force-dynamic';

export default async function UrunlerPage({
  searchParams,
}: {
  searchParams: Promise<AramaParametreleri>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const sorgu = sorguyuOku(params);

  return <UrunListesi sorgu={sorgu} yol="/products" baslik="Ürünler" />;
}
