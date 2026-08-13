import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { currentUser } from '@/lib/session/guard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Hesabım' };

export const dynamic = 'force-dynamic';

/**
 * HESAP GENEL BAKIŞ.
 *
 * ⚠️ Burada SAYI GÖSTERİLMİYOR ("3 sipariş", "12 parça"). Göstermek için her
 *    açılışta sipariş + gardırop + rıza uçlarının üçüne birden istek atmak
 *    gerekirdi; kullanıcının çoğu ziyarette tek bir alt sayfaya gittiği bir
 *    ekranda bu, üç isteğin ikisini çöpe atmak demek. Sayı bir gün gerekirse
 *    tek bir özet ucu açılır, üç ayrı çağrı değil.
 *
 * ⚠️ `currentUser()` layout'ta zaten çağrıldı; `cache()` sayesinde bu ikinci
 *    çağrı API'ye GİTMEZ. Kullanıcıyı layout'tan prop olarak indirmek, her alt
 *    sayfayı layout'un iç yapısına bağlardı.
 */
const KISAYOLLAR = [
  /**
   * ⚠️ EKRAN YAZILDIĞI TURDA BURAYA DA EKLENDİ. Bu depoda ALTI KEZ "ekran
   *    yazıldı, hiçbir menüde bağlantısı yok" yaşandı — sonuncusu satıcı
   *    panelindeki altı ekrandı. Ölçü ekranı da o listeye girmesin diye
   *    bağlantı, ekranla AYNI commit'te.
   */
  {
    href: '/account/measurements',
    baslik: 'Ölçülerim',
    aciklama: 'Beden önerisinin dayandığı ölçüler. Ne kadar çok ölçü, o kadar güvenilir öneri.',
  },
  {
    href: '/account/orders',
    baslik: 'Siparişlerim',
    aciklama: 'Sipariş durumu, kargo takibi ve iade talebi.',
  },
  {
    href: '/account/wardrobe',
    baslik: 'Gardırobum',
    aciklama: 'Satın aldığınız parçalar ve kendi eklediğiniz kıyafetler.',
  },
  {
    href: '/account/security',
    baslik: 'Güvenlik',
    aciklama: 'Şifre değiştirme ve açık oturumlar.',
  },
  {
    href: '/account/privacy',
    baslik: 'Gizlilik ve verilerim',
    aciklama: 'Rızalar, veri indirme talebi ve hesap silme.',
  },
] as const;

export default async function HesapPage() {
  const kullanici = await currentUser();
  // ⚠️ Layout zaten yönlendiriyor; bu satır tip daraltması için. Hesabı
  //    olmayan biri buraya ulaşamaz.
  if (!kullanici) return null;

  const adSoyad = [kullanici.firstName, kullanici.lastName].filter(Boolean).join(' ');

  return (
    <section className="flex flex-col gap-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          {adSoyad ? `Merhaba, ${adSoyad}` : 'Hesabım'}
        </h1>
        <p className="mt-1 text-sm text-metin-soluk">
          Hesap bilgileriniz, siparişleriniz ve verileriniz üzerindeki haklarınız burada.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Hesap bilgileri</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <Satir etiket="Ad soyad" deger={adSoyad || '—'} />
          <Satir
            etiket="E-posta"
            deger={kullanici.email ?? '—'}
            /* Doğrulama bir DURUMdur; rozetin renkli olmasına izin veren tek
               şey de budur. Doğrulanmamış e-posta bazı uçları kapatıyor. */
            rozet={
              kullanici.email ? (
                <Badge durum={kullanici.emailVerified ? 'olumlu' : 'uyari'}>
                  {kullanici.emailVerified ? 'Doğrulandı' : 'Doğrulanmadı'}
                </Badge>
              ) : null
            }
          />
          <Satir
            etiket="Telefon"
            deger={kullanici.phone ?? '—'}
            rozet={
              kullanici.phone ? (
                <Badge durum={kullanici.phoneVerified ? 'olumlu' : 'uyari'}>
                  {kullanici.phoneVerified ? 'Doğrulandı' : 'Doğrulanmadı'}
                </Badge>
              ) : null
            }
          />
        </CardContent>
      </Card>

      <ul className="grid gap-3 sm:grid-cols-2">
        {KISAYOLLAR.map((kisayol) => (
          <li key={kisayol.href}>
            <Link
              href={kisayol.href}
              className="flex h-full items-start justify-between gap-3 rounded-lg border border-kenar p-4 hover:bg-yuzey"
            >
              <span>
                <span className="block text-sm font-semibold text-metin">{kisayol.baslik}</span>
                <span className="mt-1 block text-sm text-metin-soluk">{kisayol.aciklama}</span>
              </span>
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-ikon" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Satir({ etiket, deger, rozet }: { etiket: string; deger: string; rozet?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-metin-soluk">{etiket}</span>
      <span className="flex items-center gap-2 text-metin">
        {deger}
        {rozet}
      </span>
    </div>
  );
}
