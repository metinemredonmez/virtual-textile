import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { HUKUKI_METINLER, HUKUKI_SLUGLAR, YURURLUKTEKI_SURUM } from '../metinler';

/**
 * HUKUKİ METİN EKRANI — iki belge, tek dosya.
 *
 * ⚠️ ROTA `/kullanim-kosullari` VE `/aydinlatma-metni` OLARAK GÖRÜNÜR, bu
 *    dizin adıyla değil: `next.config.ts` içinde iki `rewrite` var. Neden:
 *    adresler kayıt formunda ve (yarın) e-postalarda sabit yazılı, ama iki
 *    ayrı sayfa dosyası açmak aynı düzeni iki kez yazmak olurdu — ve bu
 *    depoda iki kopyanın ayrışması ölçülmüş bir olay.
 *
 * ⚠️ `loading.tsx` YOK ve eklenmemeli: bu sayfa `notFound()` çağırıyor, bir
 *    Suspense sınırının ardında o çağrı 200 döner (bkz. `(magaza)/not-found.tsx`).
 */
export const dynamicParams = false;

type Params = Promise<{ belge: string }>;

export function generateStaticParams(): Array<{ belge: string }> {
  return HUKUKI_SLUGLAR.map((belge) => ({ belge }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { belge } = await params;
  const metin = HUKUKI_METINLER[belge as keyof typeof HUKUKI_METINLER];
  if (!metin) return {};
  return {
    title: metin.baslik,
    description: metin.ozet,
    alternates: { canonical: `/${metin.slug}` },
    // ⚠️ Yayınlanmamış bir belgenin indekslenmesi, arama sonucunda "kullanım
    //    koşulları" diye boş bir sayfa çıkması demek. Metin yayınlandığında bu
    //    satır kaldırılır.
    robots: { index: false, follow: true },
  };
}

export default async function HukukiBelgePage({
  params,
}: {
  params: Params;
}): Promise<React.ReactElement> {
  const { belge } = await params;
  const metin = HUKUKI_METINLER[belge as keyof typeof HUKUKI_METINLER];
  if (!metin) notFound();

  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-6 py-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{metin.baslik}</h1>
        <p className="text-metin-soluk">{metin.ozet}</p>
      </header>

      {/*
        ⚠️ BU KUTU RENK TAŞIYOR VE TAŞIMALI: "metin henüz yayınlanmadı" bir
           DURUMdur — hem de kullanıcının onay verirken bilmesi gereken bir
           durum. Süs değil; renk kuralının tam olarak izin verdiği yer burası.
      */}
      <div
        role="status"
        className="rounded-md border border-kenar bg-uyari-zemin p-4 text-sm text-uyari"
      >
        <p className="font-medium">{metin.durum}</p>
        <p className="mt-2 text-metin">
          Bu adres bilerek boş değil: kayıt formu buraya bağlantı veriyor ve bağlantının 404
          dönmesi, alınan onayı da tartışmalı hale getirirdi. Metin hazır olduğunda bu sayfa onunla
          değiştirilecek — uydurulmuş bir sözleşme metni, eksik olandan daha zararlıdır.
        </p>
      </div>

      <dl className="flex flex-col gap-1 text-sm">
        <dt className="text-metin-soluk">Yürürlükteki metin sürümü</dt>
        {/* Sürüm bir SAYIDIR; `rakam` sınıfı olmadan listede hizası kayar. */}
        <dd className="rakam text-metin">{YURURLUKTEKI_SURUM}</dd>
      </dl>

      <p className="text-sm text-metin-soluk">
        Hangi rızaları verdiğinizi, ne zaman verdiğinizi ve hangi metin sürümünü onayladığınızı{' '}
        <Link href="/hesabim/gizlilik" className="text-vurgu hover:underline">
          Gizlilik ve verilerim
        </Link>{' '}
        ekranından görebilir, dilediğiniz zaman geri alabilirsiniz.
      </p>
    </article>
  );
}
