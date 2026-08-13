import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { tarihSaat } from '@/lib/tarih';
import { BosSonuc, OzetSeridi, SayfaBasligi } from '@/components/panel/duzen';
import { listeOku } from '@/lib/api/okuma';
import { uyariSiddeti, uyariTuru } from '../_lib/durum';
import type { FraudAlertWire, FraudPayloadWire } from '@vt/contracts';

/**
 * DOLANDIRICILIK UYARILARI.
 *
 * ⚠️ BU LİSTE BİR KAYIT DEĞİL, BİR SORGUNUN SONUCU. Şemada `FraudAlert` tablosu
 *    YOK (`admin.ports.ts:441`); uyarılar her istekte mevcut sipariş/ödeme
 *    kayıtlarından TÜRETİLİYOR ve yanıt bunu `derived: true` ile söylüyor.
 *    Sonuçları:
 *      • "Okundu / kapatıldı" işaretlenemez — işareti tutacak bir yer yok.
 *      • Aynı uyarı her açılışta yeniden görünür.
 *      • Pencere dışına çıkan bir uyarı SESSİZCE kaybolur.
 *    Ekran bunu yazmazsa yönetici listeyi bir görev kuyruğu sanır ve
 *    "kapattığım uyarı neden geri geldi" diye sorar.
 *
 * ⚠️ Uyarı KONUSU tıklanabilir DEĞİL: `subjectId` bir kullanıcı ya da sipariş
 *    kimliği ve yönetim panelinde ikisinin de detay ekranı yok. Bağlantı
 *    koymak "basınca 404 veren düğme" üretirdi.
 */
export const metadata: Metadata = {
  title: 'Dolandırıcılık uyarıları',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** Uç azami 200 kabul ediyor; varsayılan 50. */
const LIMIT = 100;

export default async function UyarilarPage(): Promise<React.ReactElement> {
  const okuma = await listeOku<FraudAlertWire, '/admin/fraud/alerts'>(
    '/admin/fraud/alerts',
    '/admin/alerts',
    { query: { limit: LIMIT } },
  );

  if (!okuma.tamam) {
    return (
      <section>
        <SayfaBasligi baslik="Dolandırıcılık uyarıları" />
        <SunucuHatasi govde={okuma.hata} className="max-w-md" />
      </section>
    );
  }

  // ⚠️ `data` NESNE geldiği için `items` dışındaki alanlar `extra`da.
  const extra = okuma.veri.extra as Partial<FraudPayloadWire>;
  const sayimlar = extra.counts ?? { high: 0, medium: 0, low: 0 };
  const aralik = extra.range ?? null;
  const uyarilar = okuma.veri.items;

  return (
    <section>
      <SayfaBasligi
        baslik="Dolandırıcılık uyarıları"
        aciklama={
          aralik
            ? `Pencere: ${tarihSaat(aralik.from)} – ${tarihSaat(aralik.to)}. Uyarılar kalıcı bir kayıt değildir; her açılışta yeniden hesaplanır, bu yüzden “kapatıldı” diye işaretlenemez.`
            : 'Uyarılar kalıcı bir kayıt değildir; her açılışta yeniden hesaplanır.'
        }
      />

      {/*
        ⚠️ ÜÇ ÖZET RAKAM, DÖRT DEĞİL. Stripe kalıbı tablo üstünde 3–4 rakam
           istiyor; toplam sayı buraya dördüncü kart olarak konmadı çünkü zaten
           üçünün toplamı — ekranda bir şeyi iki kez göstermek bütçeyi harcar.
      */}
      {/*
        ⚠️ ŞERİT `panel/duzen.tsx`TEN. Burada `OzetKart` adlı yerel bir kopya
           vardı ve rakamı `text-3xl` çiziyordu; aynı kabuktaki payout ve
           komisyon şeritleri `text-lg`. Etiketin ROZET olması ise üslup değil
           bilgi — şiddet bir DURUM ve renk taşımaya hakkı var. Bu yüzden kopya
           silinirken `OzetRakami`ye `etiketRozeti` alanı eklendi.
      */}
      <div className="mb-6">
        <OzetSeridi
          rakamlar={[
            { etiket: 'Yüksek', etiketRozeti: 'tehlike', deger: <Sayac sayi={sayimlar.high} /> },
            { etiket: 'Orta', etiketRozeti: 'uyari', deger: <Sayac sayi={sayimlar.medium} /> },
            { etiket: 'Düşük', etiketRozeti: 'notr', deger: <Sayac sayi={sayimlar.low} /> },
          ]}
        />
      </div>

      {uyarilar.length === 0 ? (
        /* ⚠️ Boş durum `BosSonuc`tan geliyor: "panel ekranı elle iskelet
           çizmez" (AGENTS.md §7). Burada düz bir `<p>` vardı ve aynı panelin
           diğer yedi ekranının boş durumundan farklı görünüyordu. */
        <BosSonuc
          baslik="Bu pencerede türetilmiş uyarı yok."
          aciklama="Bu, “hiç şüpheli işlem olmadı” demek değildir: uyarılar yalnızca kart deneme, yüksek iade oranı, olağandışı sipariş tutarı ve hızlı sipariş iptali desenlerinden üretilir."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH scope="col">Şiddet</TH>
              <TH scope="col">Uyarı</TH>
              <TH scope="col">Konu</TH>
              <TH scope="col">Dayanak</TH>
              <TH scope="col">Zaman</TH>
            </TR>
          </THead>
          <TBody>
            {uyarilar.map((uyari) => {
              const siddet = uyariSiddeti(uyari.severity);
              return (
                <TR
                  key={`${uyari.type}-${uyari.subjectId}-${uyari.observedAt}`}
                  className="align-top"
                >
                  <TD className="py-2">
                    <Badge durum={siddet.rozet}>{siddet.metin}</Badge>
                  </TD>
                  <TD className="py-2">{uyariTuru(uyari.type)}</TD>
                  <TD className="py-2">
                    {uyari.subjectType === 'USER' ? 'Kullanıcı' : 'Sipariş'}
                    <span className="rakam block text-xs text-metin-soluk">{uyari.subjectId}</span>
                  </TD>
                  {/*
                    ⚠️ `metrics` ANAHTARLARI TÜRE GÖRE DEĞİŞİR (`Record<string,
                       number|string>`); sabit bir sütun listesi yazılamaz.
                       Anahtar adları İngilizce ve öyle basılıyor — çevirmek,
                       sunucu yeni bir ölçüt eklediğinde ekranın onu sessizce
                       gizlemesi demek olurdu.
                  */}
                  <TD className="py-2 text-metin-soluk">
                    <ul className="flex flex-col gap-0.5 text-xs">
                      {Object.entries(uyari.metrics).map(([anahtar, deger]) => (
                        <li key={anahtar} className="rakam">
                          {anahtar}: {String(deger)}
                        </li>
                      ))}
                    </ul>
                  </TD>
                  <TD className="whitespace-nowrap py-2 text-metin-soluk">
                    {tarihSaat(uyari.observedAt)}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </section>
  );
}

/**
 * ⚠️ `rakam` (tabular-nums) ÇAĞIRANDA: `OzetSeridi` sınıfı basmıyor çünkü para
 *    `<Fiyat>` ile gelir ve sınıfı kendi taşır. Buradaki değer bir SAYAÇ, yani
 *    hizayı çağıran kurmak zorunda — üç kart alt alta dizildiğinde rakamların
 *    hizası okumayı belirliyor.
 */
function Sayac({ sayi }: { sayi: number }): React.ReactElement {
  return <span className="rakam">{sayi}</span>;
}
