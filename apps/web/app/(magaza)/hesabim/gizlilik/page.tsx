import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { hesapFetch } from '@/lib/api/server-authed';
import type { ConsentListWire, DataExportWire } from '@vt/contracts';
import { HesapSilme } from './hesap-silme';
import { RizaListesi } from './riza-listesi';
import { VeriIndirme } from './veri-indirme';

export const metadata: Metadata = { title: 'Gizlilik ve verilerim' };

export const dynamic = 'force-dynamic';

const YOL = '/hesabim/gizlilik';

/**
 * KVKK md.11 EKRANI — rıza, veri indirme, hesap silme.
 *
 * ⚠️ ÜÇ BÖLÜM AYRI AYRI GETİRİLİYOR ve biri düşerse diğerleri AYAKTA KALIYOR.
 *    Tek `try` içine alınsaydı `GET /me/consents` bir sebeple 500 döndüğünde
 *    kullanıcının hesap silme hakkı da ekrandan kaybolurdu — yani bir sunucu
 *    hatası, bir kanuni hakkın kullanılmasını engellerdi.
 *
 * ⚠️ `Promise.all` KULLANILMADI, sıralı bekleniyor. İki uç da aynı kullanıcı
 *    için ve ikisi de hızlı; paralelleştirme kazancı, "biri düşerse diğeri
 *    ayakta" davranışını yazmayı zorlaştırmaya değmez.
 */
export default async function GizlilikPage() {
  let rizalar: ConsentListWire | null = null;
  let rizaHatasi: ReturnType<typeof hataYuku> | null = null;
  try {
    const sonuc = await hesapFetch<ConsentListWire, '/me/consents'>('/me/consents', YOL);
    rizalar = sonuc.data;
  } catch (error) {
    rizaHatasi = hataYuku(error);
  }

  let indirme: DataExportWire | null = null;
  let indirmeHatasi: ReturnType<typeof hataYuku> | null = null;
  try {
    const sonuc = await hesapFetch<DataExportWire, '/me/data-export'>('/me/data-export', YOL);
    indirme = sonuc.data;
  } catch (error) {
    indirmeHatasi = hataYuku(error);
  }

  return (
    <section className="flex flex-col gap-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Gizlilik ve verilerim</h1>
        <p className="mt-1 text-sm text-metin-soluk">
          KVKK kapsamındaki haklarınız: hangi işlemelere rıza verdiğinizi görmek ve geri çekmek,
          verilerinizin bir kopyasını istemek, hesabınızın silinmesini talep etmek.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Rızalarım</CardTitle>
        </CardHeader>
        <CardContent>
          {rizaHatasi ? (
            <SunucuHatasi govde={rizaHatasi} />
          ) : rizalar ? (
            <RizaListesi rizalar={rizalar.consents} yururluktekiSurum={rizalar.documentVersion} />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verilerimin kopyası</CardTitle>
        </CardHeader>
        <CardContent>
          {indirmeHatasi ? (
            <SunucuHatasi govde={indirmeHatasi} />
          ) : indirme ? (
            <VeriIndirme durum={indirme} />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hesabımı sil</CardTitle>
        </CardHeader>
        <CardContent>
          <HesapSilme />
        </CardContent>
      </Card>
    </section>
  );
}
