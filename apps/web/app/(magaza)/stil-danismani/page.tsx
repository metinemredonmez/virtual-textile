import type { Metadata } from 'next';
import { girisGerekli } from '@/lib/api/server-authed';
import { Danisman } from './_bilesenler/danisman';

/**
 * STİL DANIŞMANI.
 *
 * ⚠️ BU EKRAN GÖREVİN ÜÇ PARÇASINDAN BİRİYDİ ve bir dönem HİÇ YAZILMADI: akış
 *    vekili (`app/api/stylist/conversations/[id]/messages/route.ts`) hazırdı,
 *    `text/event-stream` taşıyordu ve ÖKSÜZDÜ — onu çağıran tek bir satır
 *    yoktu. Bu deponun "yazıldı, derlendi, hiçbir yerden çağrılmadı" hatasının
 *    dördüncü örneğiydi; üstelik akışın çalışıp çalışmadığı denenemiyordu bile,
 *    çünkü deneyecek ekran yoktu.
 *
 * ⚠️ SUNUCUDA HİÇBİR ŞEY ÇEKİLMİYOR ve bu bilinçli: konuşma İLK MESAJDA
 *    açılıyor (gerekçe `_bilesenler/danisman.tsx` başlığında). Yine de kapı
 *    burada: `girisGerekli` oturumsuz ziyaretçiyi `/giris?next=` ile
 *    yönlendiriyor. Yönlendirilmeseydi ziyaretçi boş bir sohbet kutusuna yazar
 *    ve ancak GÖNDERDİKTEN sonra girişe atılırdı — yazdığı da kaybolurdu.
 *    ⚠️ Danışman uçlarının hiçbiri `@Public()` DEĞİL (kota kullanıcı başına
 *       tanımlı); yani bu kapı arayüzü sunucuyla hizalıyor, ona vekâlet
 *       etmiyor.
 *
 * ⚠️ `loading.tsx` EKLENMEDİ: bu rota `notFound()` çağırmıyor ama `(magaza)`
 *    grubunun kendi `loading.tsx`i zaten üstünde. İkinci bir iskelet aynı
 *    geçişte iki kez şekil değiştiren bir ekran üretirdi (AGENTS.md §8).
 *
 * ⚠️ `robots: noindex`: sohbet ekranı girişin arkasında ve indekslenecek
 *    içeriği yok; arama motoruna boş bir kabuk göstermek yalnızca zayıf bir
 *    sayfa üretir.
 */
export const metadata: Metadata = {
  title: 'Stil danışmanı',
  description: 'Kataloğu tarayan, kombin uyumunu değerlendiren yapay zekâ destekli stil danışmanı.',
  alternates: { canonical: '/stil-danismani' },
  robots: { index: false, follow: false },
};

/** ⚠️ Kimlikli ve akışlı; önbelleklenecek hiçbir şey yok. */
export const dynamic = 'force-dynamic';

export default async function StilDanismaniPage(): Promise<React.ReactElement> {
  await girisGerekli('/stil-danismani');

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Stil danışmanı</h1>
        <p className="mt-2 max-w-prose text-sm text-metin-soluk">
          Ne aradığınızı anlatın; danışman kataloğu arar, renk uyumunu değerlendirir ve beden
          profiliniz varsa ona göre öneri yapar. Günlük kullanım hakkı sınırlıdır.
        </p>
      </header>

      <Danisman />
    </section>
  );
}
