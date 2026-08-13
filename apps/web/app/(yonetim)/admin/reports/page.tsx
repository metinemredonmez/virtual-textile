import type { Metadata } from 'next';
import { hesapFetch } from '@/lib/api/server-authed';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { Fiyat } from '@/components/fiyat/fiyat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { isoGun, tarih } from '@/lib/tarih';
import { BosSonuc, OzetSeridi, SayfaBasligi } from '@/components/panel/duzen';
import { sayi, yuzdeBps } from '@/lib/sayi-bicim';
import { RaporSekmeleri } from './sekmeler';
import type { GmvGranularityWire, GmvReportWire } from '@vt/contracts';

export const metadata: Metadata = { title: 'GMV raporu' };
export const dynamic = 'force-dynamic';

const KIRILIMLAR: readonly GmvGranularityWire[] = ['day', 'week', 'month'];

const KIRILIM_ADI: Record<GmvGranularityWire, string> = {
  day: 'Gün',
  week: 'Hafta',
  month: 'Ay',
};

/**
 * ⚠️ VARSAYILAN KIRILIM `week`, SUNUCUNUNKİ `day`.
 *    Sunucunun varsayılan aralığı son 30 gün; `day` ile bu 30 satır demek ve
 *    `design-system.md` finans tablosu için "varsayılan görünümde 5-9 öğe"
 *    diyor. 30 satırlık bir açılış ekranında hiçbir satır okunmuyor, yani
 *    tablo olmamasıyla aynı kapıya çıkıyor. Gün kırılımı bir tık uzakta ve
 *    o zaman KULLANICININ seçimi.
 */
const VARSAYILAN_KIRILIM: GmvGranularityWire = 'week';

/**
 * GMV RAPORU.
 *
 * ⚠️ `effectiveCommissionBps` ve `returnRateBps` PARA DEĞİL, basis point.
 *    `<Fiyat>` ile basılsalardı `1250` ekrana `12,50 ₺` diye çıkardı — doğru
 *    görünen, tamamen yanlış bir rakam. Biçimleme `bicim.ts` → `yuzdeBps()`.
 *
 * ⚠️ TABLODAKİ HİÇBİR SÜTUN BURADA TOPLANMIYOR. `totals` sunucudan geliyor ve
 *    bigint aritmetiğiyle hesaplanmış; kovaları frontend'de toplamak ikinci bir
 *    hesap üretir ve iade kovalarının ayrı sorgulanması (fan-out önlemi)
 *    yüzünden sonuç KOLAYCA ayrışır.
 */
export default async function GmvRaporuPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; kirilim?: string }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const kirilim = KIRILIMLAR.find((deger) => deger === params.kirilim) ?? VARSAYILAN_KIRILIM;

  let rapor: GmvReportWire;
  try {
    const sonuc = await hesapFetch<GmvReportWire, '/admin/reports/gmv'>(
      '/admin/reports/gmv',
      '/admin/reports',
      {
        query: {
          granularity: kirilim,
          ...(params.from ? { from: params.from } : {}),
          ...(params.to ? { to: params.to } : {}),
        },
      },
    );
    rapor = sonuc.data;
  } catch (error) {
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const { totals } = rapor;

  return (
    <section className="flex flex-col gap-6">
      <SayfaBasligi
        baslik="GMV raporu"
        aciklama={
          <>
            {tarih(rapor.range.from)} – {tarih(rapor.range.to)} · kovalar Türkiye saatine göre
            oluşturulur.
          </>
        }
      />

      <RaporSekmeleri aktif="gmv" />

      <AralikFormu
        from={params.from ?? isoGun(rapor.range.from)}
        to={params.to ?? isoGun(rapor.range.to)}
        kirilim={kirilim}
      />

      {/*
        ⚠️ DÖRT RAKAM, ON BİR DEĞİL. `totals` içinde on bir alan var ve hepsini
           kart yapmak `design-system.md`in "3-4 özet rakam (fazlası değil)"
           kuralının ihlali olurdu. Seçilenler bir soruyu cevaplıyor: ne kadar
           satıldı, ne kadarı bize kaldı, iadeden sonra ne kaldı, sepet ne kadar.
           Oranlar kartların altına ikinci satır olarak sıkıştırıldı — kendi
           kartlarını hak etmiyorlar, ama komisyon ve iade rakamının yanında
           anlam kazanıyorlar.
      */}
      <OzetSeridi
        rakamlar={[
          {
            etiket: 'Brüt GMV',
            deger: <Fiyat value={totals.gmvMinor} />,
            alt: `${sayi(totals.orderCount)} sipariş · ${sayi(totals.itemCount)} kalem`,
          },
          {
            etiket: 'Komisyon',
            deger: <Fiyat value={totals.commissionMinor} />,
            alt: `Efektif oran ${yuzdeBps(totals.effectiveCommissionBps)}`,
          },
          {
            etiket: 'Net GMV',
            deger: <Fiyat value={totals.netGmvMinor} />,
            alt: `İade oranı ${yuzdeBps(totals.returnRateBps)}`,
          },
          {
            etiket: 'Ortalama sepet',
            deger: <Fiyat value={totals.averageOrderValueMinor} />,
            alt: 'Kuruş altı temsil edilmez',
          },
        ]}
      />

      {rapor.buckets.length === 0 ? (
        <BosSonuc
          baslik="Bu aralıkta sipariş yok."
          aciklama="Tarih aralığını genişletin ya da kırılımı değiştirin."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{KIRILIM_ADI[rapor.granularity]}</TH>
              <TH sayisal>Sipariş</TH>
              <TH sayisal>Kalem</TH>
              <TH sayisal>Brüt GMV</TH>
              <TH sayisal>Komisyon</TH>
              <TH sayisal>Satıcı neti</TH>
              <TH sayisal>İade</TH>
              <TH sayisal>Net GMV</TH>
            </TR>
          </THead>
          <TBody>
            {rapor.buckets.map((kova) => (
              <TR key={kova.bucket}>
                <TD className="text-metin-soluk">{tarih(kova.bucket)}</TD>
                <TD sayisal>{sayi(kova.orderCount)}</TD>
                <TD sayisal>{sayi(kova.itemCount)}</TD>
                <TD sayisal>
                  <Fiyat value={kova.gmvMinor} />
                </TD>
                <TD sayisal>
                  <Fiyat value={kova.commissionMinor} />
                </TD>
                <TD sayisal>
                  <Fiyat value={kova.sellerNetMinor} />
                </TD>
                <TD sayisal>
                  <Fiyat value={kova.returnedMinor} />
                </TD>
                <TD sayisal>
                  <Fiyat value={kova.netGmvMinor} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <p className="text-xs text-metin-soluk">
        Net GMV, brütten iade tutarları düşülmüş hâldir. İadeler ayrı sorgulanır: tek sorguda
        birleştirilseydi çok kalemli siparişlerde satırlar çoğalır ve GMV olduğundan yüksek çıkardı.
      </p>
    </section>
  );
}

/**
 * ⚠️ DÜZ `<form method="get">`. Tarih aralığı ekranın DURUMU ve bu ekranda
 *    durum URL'de tutuluyor: paylaşılan bir rapor bağlantısı aynı aralığı
 *    açsın, tarayıcının geri tuşu gerçekten çalışsın. İstemci bileşeni
 *    yapılsaydı ikisi de kaybolurdu.
 */
function AralikFormu({
  from,
  to,
  kirilim,
}: {
  from: string;
  to: string;
  kirilim: GmvGranularityWire;
}): React.ReactElement {
  return (
    <form
      method="get"
      action="/admin/reports"
      className="grid gap-3 rounded-lg border border-kenar p-4 sm:grid-cols-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gmv-from">Başlangıç</Label>
        <Input id="gmv-from" type="date" name="from" className="rakam" defaultValue={from} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gmv-to">Bitiş</Label>
        <Input id="gmv-to" type="date" name="to" className="rakam" defaultValue={to} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gmv-kirilim">Kırılım</Label>
        <select
          id="gmv-kirilim"
          name="kirilim"
          defaultValue={kirilim}
          className="h-10 rounded-md border border-kenar bg-zemin px-3 text-sm text-metin"
        >
          {KIRILIMLAR.map((deger) => (
            <option key={deger} value={deger}>
              {KIRILIM_ADI[deger]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" size="sm">
          Uygula
        </Button>
      </div>
    </form>
  );
}
