import Link from 'next/link';
import type { Metadata } from 'next';
import type { CategoryNodeWire } from '@vt/contracts';
import { kategoriAgaci } from '@/lib/kategori';

/**
 * TÜM KATEGORİLER.
 *
 * Vitrindeki şerit bilinçli olarak kırpık (ana sayfanın öğe bütçesi 3 bölüm);
 * kırpılan şeyin gidecek bir yeri olmalı, burası orası. Ağaç sınırsız çizilir
 * çünkü bu ekranın İŞİ ağacın tamamıdır.
 */
export const metadata: Metadata = { title: 'Kategoriler' };

/**
 * ⚠️ `force-dynamic` — VE BU, ÖNBELLEĞİ KAYBETMEK DEĞİLDİR.
 *
 *    Burada bir dönem "dinamik yapmak 46 KB'lık ağacı her ziyarette yeniden
 *    çekmek olurdu" yazıyordu. Gözlem doğru, ÇIKARIM YANLIŞTI: App Router'da
 *    önbellek SAYFADA değil `fetch` KATMANINDA durur ve `kategoriAgaci()`
 *    zaten `next: { revalidate: 600 }` veriyor. Sayfa dinamik olsa da API
 *    on dakikada bir çağrılır — kazanç aynen yerinde.
 *
 *    Statik bırakmanın GERÇEK bedeli şuydu: sayfa DERLEME ANINDA ön-render
 *    ediliyor, dolayısıyla `next build` AYAKTA BİR API İSTİYORDU.
 *      · CI'da API yok → derleme ECONNREFUSED ile düştü. Arıza böyle görüldü.
 *      · Sunucuda API VAR → derleme BAŞARILI olur ve kategori ağacı o anki
 *        hâliyle pakete GÖMÜLÜRDÜ. Yeni kategori eklendiğinde vitrinde
 *        görünmez, hiçbir yerde de hata çıkmazdı.
 *    Tehlikeli olan ikincisi: gürültülü arıza kendini gösterir, sessiz olan
 *    göstermez.
 */
export const dynamic = 'force-dynamic';

export default async function KategorilerPage(): Promise<React.ReactElement> {
  const agac = await kategoriAgaci();

  return (
    <section>
      <h1 className="mb-8 text-xl font-semibold tracking-tight">Kategoriler</h1>

      {agac.length === 0 ? (
        <p className="text-metin-soluk">Henüz kategori tanımlanmamış.</p>
      ) : (
        <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {agac.map((kok) => (
            <li key={kok.id}>
              <Link
                href={`/kategori/${kok.slug}`}
                className="text-sm font-semibold hover:underline"
              >
                {kok.name}
              </Link>
              <AltDal dugumler={kok.children} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * ⚠️ Özyineleme derinlik SINIRIYLA. Ağaç `parentId` üzerinden kuruluyor ve
 *    veritabanı düzeyinde bir döngüyü engelleyen kısıt yok; kendi kendisinin
 *    atası olan tek bir satır bu bileşeni sonsuz özyinelemeye ve sunucuda yığın
 *    taşmasına sokardı. Üç düzey gerçek taksonomi için fazlasıyla yeterli.
 */
const AZAMI_DERINLIK = 3;

function AltDal({
  dugumler,
  derinlik = 1,
}: {
  dugumler: CategoryNodeWire[];
  derinlik?: number;
}): React.ReactElement | null {
  if (dugumler.length === 0 || derinlik > AZAMI_DERINLIK) return null;

  return (
    <ul className="mt-2 flex flex-col gap-1 border-l border-kenar pl-3">
      {dugumler.map((dugum) => (
        <li key={dugum.id}>
          <Link
            href={`/kategori/${dugum.slug}`}
            className="text-sm text-metin-soluk hover:text-metin hover:underline"
          >
            {dugum.name}
          </Link>
          <AltDal dugumler={dugum.children} derinlik={derinlik + 1} />
        </li>
      ))}
    </ul>
  );
}
