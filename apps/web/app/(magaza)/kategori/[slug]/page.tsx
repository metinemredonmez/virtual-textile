import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { sorguyuOku, type AramaParametreleri } from '../../urunler/_liste/liste-sorgusu';
import { UrunListesi } from '../../urunler/_liste/urun-listesi';
import { kategoriAgaci, kategoriBul } from '@/lib/kategori';

/**
 * KATEGORİ LİSTESİ — `/urunler` ile AYNI liste bileşeni, kategori sabitlenmiş.
 *
 * Ayrı bir ekran değil, aynı ekranın kapısı: iki kopya yazılsaydı biri
 * diğerinden sessizce ayrışırdı (fasetleri birinde düzeltip diğerinde
 * unutmak).
 */
export const dynamic = 'force-dynamic';

type Ctx = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<AramaParametreleri>;
};

/**
 * ⚠️ BU ROTAYA `loading.tsx` EKLENMEZ. Buradaki 404 bir zamanlar "yumuşak"tı —
 *    ÖLÇÜLDÜ: `/kategori/yok-boyle` HTTP **200** + `NEXT_HTTP_ERROR_FALLBACK;404`
 *    döndürüyordu. Sebep bu dosya değildi: `(magaza)/loading.tsx` bir Suspense
 *    sınırı kuruyor, Next kabuğu 200 ile HEMEN gönderiyor ve akış başladıktan
 *    sonra durum kodu DEĞİŞTİRİLEMİYOR. Kararı `generateMetadata`ya taşımak da
 *    yetmedi (ölçüldü, yine 200). O `loading.tsx` kaldırıldı; gerekçesi ve
 *    kural `(magaza)/not-found.tsx` başlığında yazılı.
 *
 *    Tarama botu için yumuşak 404'ün karşılığı "sayfa var ama boş"tur; yani
 *    uydurma her kategori adresi indekslenebilir bir sayfa olurdu.
 *
 * ⚠️ `notFound()` HEM burada HEM gövdede çağrılıyor. Buradaki, uydurma bir
 *    adres için gerçekmiş gibi bir `<title>` üretilmesini engelliyor; gövdedeki
 *    ise metadata bir gün önbellekten geldiğinde kapının kapalı kalmasını.
 */
export async function generateMetadata({ params }: Ctx): Promise<Metadata> {
  const { slug } = await params;
  const kategori = kategoriBul(await kategoriAgaci(), slug);
  if (!kategori) notFound();
  return { title: kategori.name };
}

export default async function KategoriPage({
  params,
  searchParams,
}: Ctx): Promise<React.ReactElement> {
  const { slug } = await params;
  const kategori = kategoriBul(await kategoriAgaci(), slug);

  /**
   * ⚠️ 404 BURADA ÜRETİLİR, API'de DEĞİL. ÖLÇÜLDÜ:
   *      GET /v1/products?category=yok-boyle-kategori → HTTP 200, total 0
   *    Yani uydurma her kategori adresi "ürün bulunamadı" diyen geçerli bir
   *    sayfa üretiyordu. Tarama botu bunları indeksler, kullanıcı da kategoriyi
   *    boş sanır. Var olmayan kategori bir boş sonuç değil, YOK OLAN BİR
   *    ADRESTİR.
   */
  if (!kategori) notFound();

  const sorgu = sorguyuOku(await searchParams, { sabitKategori: slug });

  return (
    <div>
      <nav aria-label="İçerik haritası" className="mb-4 text-sm text-metin-soluk">
        <Link href="/kategori" className="hover:text-metin hover:underline">
          Kategoriler
        </Link>
        <span aria-hidden> / </span>
        <span className="text-metin">{kategori.name}</span>
      </nav>

      {kategori.children.length > 0 ? (
        <nav aria-label="Alt kategoriler" className="mb-6 flex flex-wrap gap-2">
          {kategori.children.map((alt) => (
            <Link
              key={alt.id}
              href={`/kategori/${alt.slug}`}
              className="rounded-sm border border-kenar px-3 py-1 text-sm text-metin hover:bg-yuzey-vurgulu"
            >
              {alt.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <UrunListesi
        sorgu={sorgu}
        yol={`/kategori/${slug}`}
        baslik={kategori.name}
        secenekler={{ sabitKategori: slug }}
        aramaKutusuGoster={false}
      />
    </div>
  );
}
