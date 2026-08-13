import type { Metadata } from 'next';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { KuponYonetimi } from './_bilesenler/kupon-yonetimi';
import { kuponlariGetir } from '../_lib/veri';
import { SayfaBasligi } from '@/components/panel/duzen';

export const metadata: Metadata = { title: 'Kuponlar · Satıcı paneli' };
export const dynamic = 'force-dynamic';

/**
 * KUPONLAR.
 *
 * ⚠️ Veri okuma yardımcıları panel KÖKÜNDEKİ `satici/_lib/veri.ts`te. Bir
 *    dönem `urunler/_lib/` altındaydı ve bu ekran ona komşu klasörden
 *    ulaşıyordu — okuma katmanının ürün ekranına ait olduğu izlenimini veren
 *    bir yerdi. `Okuma<T>` şekli `lib/api/okuma.ts`ten geliyor ve yönetim
 *    paneliyle AYNI.
 *
 * ⚠️ Varsayılan görünümde 5-9 öğe — kuponlar da 9 satırla açılıyor.
 */
const SAYFA_BOYU = 9;

export default async function SaticiKuponlarPage(): Promise<React.ReactElement> {
  const sonuc = await kuponlariGetir({ limit: SAYFA_BOYU }, '/seller/coupons');

  return (
    <section>
      <SayfaBasligi
        baslik="Kuponlar"
        aciklama="Kupon oluşturulduktan sonra kodu, tipi ve tutarı DEĞİŞTİRİLEMEZ; yalnızca aktiflik, bitiş tarihi ve kullanım sınırı düzenlenebilir."
      />
      {sonuc.tamam ? (
        <KuponYonetimi kuponlar={sonuc.veri.kuponlar} />
      ) : (
        <SunucuHatasi govde={sonuc.hata} className="max-w-xl" />
      )}
    </section>
  );
}
