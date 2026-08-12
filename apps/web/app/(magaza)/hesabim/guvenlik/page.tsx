import type { Metadata } from 'next';
import type { SessionSummary } from '@vt/contracts';
import { list } from '@/lib/api/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { hesapFetch } from '@/lib/api/server-authed';
import { OturumListesi } from './oturum-listesi';
import { SifreFormu } from './sifre-formu';

export const metadata: Metadata = { title: 'Güvenlik' };

export const dynamic = 'force-dynamic';

const YOL = '/hesabim/guvenlik';

/**
 * GÜVENLİK EKRANI — şifre + açık oturumlar.
 *
 * ⚠️ Oturum listesi hatası ŞİFRE FORMUNU DÜŞÜRMEZ. İkisi ayrı kart ve ayrı
 *    `try`: `GET /auth/sessions` bir sebeple 500 dönerse kullanıcının şifresini
 *    değiştirme yolu da kapanırdı — yani güvenlik olayı yaşayan kullanıcı tam
 *    da ihtiyaç duyduğu anda çaresiz kalırdı.
 */
export default async function GuvenlikPage() {
  let oturumlar: SessionSummary[] | null = null;
  let oturumHatasi: ReturnType<typeof hataYuku> | null = null;

  try {
    const sonuc = await hesapFetch<unknown, '/auth/sessions'>('/auth/sessions', YOL);
    oturumlar = list<SessionSummary>(sonuc).items;
  } catch (error) {
    oturumHatasi = hataYuku(error);
  }

  return (
    <section className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold tracking-tight">Güvenlik</h1>

      <Card>
        <CardHeader>
          <CardTitle>Şifre değiştir</CardTitle>
        </CardHeader>
        <CardContent>
          <SifreFormu />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Açık oturumlar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-metin-soluk">
            Hesabınıza giriş yapılmış cihazlar. Tanımadığınız bir cihaz görürseniz önce o oturumu
            kapatın, ardından şifrenizi değiştirin.
          </p>

          {oturumHatasi ? (
            <SunucuHatasi govde={oturumHatasi} />
          ) : oturumlar && oturumlar.length > 0 ? (
            <OturumListesi oturumlar={oturumlar} />
          ) : (
            <p className="text-sm text-metin-soluk">Açık oturum bulunamadı.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
