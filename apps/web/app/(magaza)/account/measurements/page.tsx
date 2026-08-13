import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { BodyProfileWire } from '@vt/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { hesapFetch } from '@/lib/api/server-authed';
import { OlcuFormu } from './olcu-formu';

export const metadata: Metadata = { title: 'Ölçülerim' };

export const dynamic = 'force-dynamic';

const YOL = '/account/measurements';

/**
 * ÖLÇÜLERİM.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ VARLIK SEBEBİ: BEDEN MOTORUNUN EN GÜÇLÜ GİRDİSİ HİÇ DOLMUYORDU.
 *
 *  Ölçüldü: `BodyProfile` tablosuna yazan tek bir uç yoktu. Kullanıcı ölçüsünü
 *  yalnızca ürün sayfasındaki kutuya giriyordu ve `useBedenOnerisi`nin kendi
 *  docblock'u şunu yazıyordu: "⚠️ bu ölçüler sunucuda saklanmaz". Yani her
 *  ürün sayfasında aynı ölçüler yeniden isteniyor, hiçbiri kalmıyordu.
 *
 *  Motor `profile`ı okuyordu — ama o satır hiç yazılmadığı için okuduğu şey
 *  her zaman boştu. Beden önerisi, en iyi girdisi olmadan çalışıyordu.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ URL İNGİLİZCE (`/account/measurements`). Bu depoda kural: rotalar
 *    İngilizce, ekran metni Türkçe. `/hesap/olculerim` yazmak, var olan
 *    `/account/*` ailesini ikiye bölerdi.
 *
 * ⚠️ ÖLÇÜ SUNUCUDAN GETİRİLİYOR, İSTEMCİDE ÇEKİLMİYOR. Sayfa açılır açılmaz
 *    dolu geliyor; istemcide çekilseydi form bir kare boş görünür ve kullanıcı
 *    ölçülerinin kaybolduğunu sanardı.
 */
export default async function OlculerimPage() {
  const t = await getTranslations('olculerim');
  let profil: BodyProfileWire | null = null;
  let hata: unknown = null;

  try {
    const sonuc = await hesapFetch<BodyProfileWire | null, '/me/body-profile'>(
      '/me/body-profile',
      YOL,
    );
    profil = sonuc.data;
  } catch (e) {
    hata = e;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{t('baslik')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-metin-soluk">{t('girisMetni')}</p>
      </header>

      {/*
        ⚠️ BU KUTU BİR YASAL UYARI DEĞİL, DÜRÜSTLÜK NOTU. Motorun ne yaptığını
           ve NE YAPMADIĞINI söylüyor. Boy/kilodan beden türetmediğimizi
           yazmasaydık kullanıcı onları girip "neden hâlâ öneri yok" derdi.
      */}
      <Card>
        <CardHeader>
          <CardTitle>{t('nasilKullanilirBaslik')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-metin-soluk">
          <p>{t('nasilKullanilir1')}</p>
          <p>{t('nasilKullanilir2')}</p>
          <p>{t('nasilKullanilir3')}</p>
        </CardContent>
      </Card>

      {hata ? <SunucuHatasi govde={hataYuku(hata)} /> : <OlcuFormu baslangic={profil} />}
    </div>
  );
}
