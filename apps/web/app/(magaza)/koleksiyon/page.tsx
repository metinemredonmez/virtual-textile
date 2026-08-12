import Link from 'next/link';
import type { Metadata } from 'next';
import { KOLEKSIYON_LISTESI } from './koleksiyonlar';

/**
 * KOLEKSİYON DİZİNİ.
 *
 * ⚠️ Bu sayfa bir vitrin değil, İÇ BAĞLANTI sayfasıdır. Dört iniş sayfası
 *    yalnızca arama sonuçlarından girilirse site içinden hiçbir yere bağlı
 *    kalmaz; tarayıcılar da, kullanıcılar da onları yalnızca dışarıdan bulur.
 *    (Bu deponun klasik hatası: modül yazıldı, derlendi, hiçbir yerden
 *    çağrılmadı.) `(magaza)/layout.tsx` gezinme çubuğu artık buraya bağlanıyor;
 *    o satır silinirse dört iniş sayfası yeniden site içinden erişilemez olur.
 */
export const metadata: Metadata = {
  title: 'Koleksiyonlar',
  description: 'Denim, gelinlik, spor giyim ve elbise koleksiyonlarını sanal deneme ile keşfedin.',
  alternates: { canonical: '/koleksiyon' },
};

export default function KoleksiyonDiziniPage() {
  return (
    <section className="py-8">
      <h1 className="text-xl font-semibold tracking-tight">Koleksiyonlar</h1>
      <p className="mt-3 max-w-xl text-metin-soluk">
        Her koleksiyon aynı katalogdan beslenir; farkı, o kategoride denemenin neyi değiştirdiğini
        anlatmasıdır.
      </p>

      <ul className="mt-10 grid gap-px overflow-hidden rounded-md border border-kenar bg-kenar md:grid-cols-2">
        {KOLEKSIYON_LISTESI.map((kayit) => (
          <li key={kayit.slug} className="bg-zemin">
            <Link href={`/koleksiyon/${kayit.slug}`} className="block p-6 hover:bg-yuzey">
              <h2 className="text-sm font-semibold">{kayit.h1}</h2>
              <p className="mt-2 text-sm text-metin-soluk">{kayit.aciklama}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
