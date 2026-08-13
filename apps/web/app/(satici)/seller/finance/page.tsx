import type { Metadata } from 'next';
import { list } from '@/lib/api/core';
import { hesapFetch } from '@/lib/api/server-authed';
import { readMinor } from '@/lib/money';
import {
  BosSonuc,
  ImlecSayfalama,
  OzetSeridi,
  SayfaBasligi,
  Sekmeler,
} from '@/components/panel/duzen';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Fiyat } from '@/components/fiyat/fiyat';
import { gecmisMi, tarih, tarihSaat } from '@/lib/tarih';
import { BAKIYE_ETIKETI } from '../_lib/bakiye-etiketleri';
import { DEFTER_TURU, DEFTER_TURU_SIRASI, PAYOUT_DURUMU } from './_lib/etiketler';
import type {
  SellerLedgerEntryWire,
  LedgerTypeWire,
  SellerPayoutWire,
  SellerBalanceWire,
} from '@vt/contracts';
import { PayoutFormu } from './payout-formu';

export const metadata: Metadata = { title: 'Finans' };

export const dynamic = 'force-dynamic';

const YOL = '/seller/finance';

/** Varsayılan görünümde 5–9 öğe (design-system.md → finansal tablo). */
const DEFTER_BOYU = 9;
const PAYOUT_BOYU = 5;

function turOku(ham: string | undefined): LedgerTypeWire | null {
  if (!ham) return null;
  return DEFTER_TURU_SIRASI.find((tur) => tur === ham) ?? null;
}

/**
 * SATICI FİNANS EKRANI.
 *
 * ⚠️ BU EKRAN BİR "HESAP BAKİYESİ" GÖSTERMİYOR, DEFTER TOPLAMI GÖSTERİYOR.
 *    Ayrım kozmetik değil: veritabanında `balance` diye bir kolon YOK ve
 *    olmaması bilinçli (`seller-balance.ts` başlığı). Her rakam, append-only
 *    `finance_ledger_entries` satırlarının o andaki toplamıdır. Ekranın dili de
 *    buna uymak zorunda — "bakiyeniz şu kadar" cümlesi, arkasında saklanan bir
 *    sayı varmış izlenimi verir ve iade sonrası rakam değiştiğinde satıcı
 *    "bakiyem eksildi, kim düşürdü" diye sorar. Doğru cümle: satır eklendi.
 *
 * ⚠️ ÜÇ UÇ PARALEL ÇEKİLİYOR (bakiye + defter + talepler). Sırayla çekilseydi
 *    ekran üç tur beklerdi; hepsi aynı isteğin içinde, aynı jetonla gidiyor.
 *
 * ⚠️ SATIR İÇİ 7 GÜNLÜK MİNİ GRAFİK ÇİZİLMEDİ ve bu bir atlama değil:
 *    çizilebilmesi için günlük toplam gerekir, günlük toplam ise ya sunucudan
 *    gelmeli ya burada hesaplanmalı. Sunucuda satıcı için günlük seri veren uç
 *    YOK (`analytics/funnel` gün kırılımı taşımıyor, GMV raporu ADMIN'e kapalı).
 *    Burada hesaplamak iki kuralı birden kırardı: (1) toplamlar frontend'de
 *    hesaplanmaz, (2) defter İMLEÇLE sayfalanıyor — elimizdeki dokuz satır
 *    "son 7 gün" değil, "son dokuz hareket". O dokuz satırdan çizilen grafik
 *    doğru görünen, yanlış bir grafik olurdu. Eksik uç raporlandı.
 */
export default async function SaticiFinansPage({
  searchParams,
}: {
  searchParams: Promise<{ tur?: string; imlec?: string }>;
}) {
  const params = await searchParams;
  const tur = turOku(params.tur);
  const imlec = params.imlec ?? null;

  let sonuclar;
  try {
    sonuclar = await Promise.all([
      hesapFetch<SellerBalanceWire, '/seller/finance/balance'>('/seller/finance/balance', YOL),
      hesapFetch<unknown, '/seller/finance/ledger'>('/seller/finance/ledger', YOL, {
        query: { limit: DEFTER_BOYU, type: tur ?? undefined, cursor: imlec ?? undefined },
      }),
      hesapFetch<unknown, '/seller/finance/payouts'>('/seller/finance/payouts', YOL, {
        query: { limit: PAYOUT_BOYU },
      }),
    ]);
  } catch (error) {
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const [bakiyeSonucu, defterSonucu, payoutSonucu] = sonuclar;
  const bakiye = bakiyeSonucu.data;
  const { items: defter, nextCursor } = list<SellerLedgerEntryWire>(defterSonucu);
  const { items: payoutlar } = list<SellerPayoutWire>(payoutSonucu);

  /**
   * ⚠️ BU BİR TOPLAM HESABI DEĞİL, BİR YÜKLEM: "bakiye eksiye düştü mü?"
   *    Karşılaştırma `readMinor` üzerinden BigInt ile yapılıyor; `Number()`
   *    ile okumak 2^53 üstünde sessizce yanlış cevap verirdi. Gösterilen tutar
   *    her zaman sunucudan geldiği gibi basılıyor.
   */
  const borcluMu = readMinor(bakiye.availableMinor).amountMinor < 0n;

  /**
   * Onaylanmış ama henüz ödenmemiş talep var mı?
   * ⚠️ Gerekçe backend'in bugünkü hâli: onaylanan talep için `PAYOUT` defter
   *    satırı HİÇ oluşmuyor (`recordPayoutSettlement` yazılmış ama çağıran
   *    yok). Yani onaylı talebin tutarı satıcının bakiyesinde DURMAYA DEVAM
   *    EDER. Bu cümle konmazsa satıcı "talebim onaylandı ama bakiyem
   *    değişmedi" diye destek arar.
   */
  const onaylanmisTalep = payoutlar.find((payout) => payout.status === 'APPROVED') ?? null;

  const dokum = DEFTER_TURU_SIRASI.filter((deger) => bakiye.breakdown[deger] !== undefined);

  const defterYolu = (yeniTur: LedgerTypeWire | null): string =>
    yeniTur ? `${YOL}?tur=${yeniTur}` : YOL;

  return (
    <section className="flex flex-col gap-8">
      <SayfaBasligi
        baslik="Finans"
        aciklama="Aşağıdaki rakamlar defterinizdeki tüm hareketlerin toplamıdır; ayrı tutulan bir hesap bakiyesi yoktur. Her satış, komisyon, iade ve ödeme deftere yeni bir satır olarak yazılır ve hiçbir satır silinmez."
      />

      {/* ⚠️ ÜÇ ÖZET RAKAM — design-system.md finansal tabloda 3–4 diyor.
          Dördüncü bir kart (`minPayoutMinor`) eklenebilirdi ama o bir bakiye
          değil bir eşik; talep formunun yanında anlamlı, kart olarak değil.

          ⚠️ ŞERİT `panel/duzen.tsx`TEN GELİYOR. Burada `OzetKarti` adlı yerel
             bir kopya vardı ve kartları `<Card>/<CardHeader>` ile çiziyordu;
             satıcı panosu ayrık `border` kartlar, yönetim tarafı birleşik
             ızgara kullanıyordu — aynı ürünün üç farklı özet şeridi. Bu ekran
             design-system.md'deki "finans tabloları: tablo üstünde 3-4 özet
             rakam" kuralının yazıldığı ekran; kuralı TİPE alan bileşeni
             (`UcVeyaDort`) kullanmayan son yer olmamalıydı. */}
      <OzetSeridi
        rakamlar={[
          {
            // ⚠️ Etiketler ortak sabitten: aynı sunucu alanı panoda "Bakiye",
            //    burada "Defter toplamı" diye çıkıyordu (gerekçe
            //    `_lib/bakiye-etiketleri.ts` başlığında).
            etiket: BAKIYE_ETIKETI.toplam,
            deger: <Fiyat value={bakiye.totalMinor} className="text-lg" />,
            alt: 'Bekleyen hakedişler dâhil, bugüne kadarki tüm hareketlerin toplamı.',
          },
          {
            etiket: BAKIYE_ETIKETI.cekilebilir,
            deger: <Fiyat value={bakiye.withdrawableMinor} className="text-lg" />,
            alt: 'Ödeme talebi açabileceğiniz tutar.',
          },
          {
            etiket: BAKIYE_ETIKETI.bekleyen,
            deger: <Fiyat value={bakiye.pendingMinor} className="text-lg" />,
            alt: bakiye.nextAvailableAt
              ? `En yakın olgunlaşma: ${tarih(bakiye.nextAvailableAt)}.`
              : 'Olgunlaşmayı bekleyen hakedişiniz yok.',
          },
        ]}
      />

      {/*
        ⚠️ NEGATİF BAKİYE AYRI BİR HÂL. `withdrawableMinor` sunucuda 0'a
           kırpıldığı için ekranda "0,00 ₺ çekilebilir" yazar; gerçek
           `availableMinor` eksidedir. İkisi birden gösterilmezse satıcı
           borcunu HİÇ görmez ve neden hiç ödeme alamadığını anlamaz.
           Burada renk taşımak meşru: bu gerçek bir durum.
      */}
      {borcluMu ? (
        <p className="max-w-prose rounded-md bg-uyari-zemin p-3 text-sm text-uyari">
          İadeler sonrası defter bakiyeniz{' '}
          <Fiyat value={bakiye.availableMinor} className="text-sm" /> seviyesinde, yani eksidedir.
          Bu tutar yeni satışlarınızdan mahsup edilecek; kapanana kadar ödeme talebi açılamaz.
        </p>
      ) : null}

      {onaylanmisTalep ? (
        <p className="max-w-prose rounded-md border border-kenar p-3 text-sm text-metin-soluk">
          <Fiyat value={onaylanmisTalep.amountMinor} className="text-sm" /> tutarındaki onaylanan
          ödeme talebiniz henüz gönderilmedi ve bu tutar hâlâ yukarıdaki bakiyenin içindedir. Ödeme
          gönderildiğinde deftere bir &quot;Ödeme&quot; satırı yazılır ve bakiyeniz düşer.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Ödeme talebi</CardTitle>
        </CardHeader>
        <CardContent>
          <PayoutFormu
            cekilebilirMinor={bakiye.withdrawableMinor}
            asgariMinor={bakiye.minPayoutMinor}
            talepEdilebilir={bakiye.canRequestPayout}
            bekleyenTalepVar={bakiye.hasPendingPayout}
          />
        </CardContent>
      </Card>

      {dokum.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-metin">Tür bazında döküm</h2>

          {/* ⚠️ Yalnızca DEFTERDE OLAN türler listeleniyor. `breakdown` sekiz
              türün hepsini içermiyor; sabit sekiz satır çizen bir ekran
              yarısında boş hücre gösterirdi. */}
          <Table className="max-w-xl">
            <TBody>
              {dokum.map((deger) => {
                const tanim = DEFTER_TURU[deger];
                return (
                  <TR key={deger}>
                    <TD>
                      <span className="text-metin">{tanim.metin}</span>
                      {tanim.tersKayit ? (
                        <Badge durum="notr" className="ml-2">
                          ters kayıt
                        </Badge>
                      ) : null}
                    </TD>
                    <TD sayisal>
                      <Fiyat value={bakiye.breakdown[deger]!} className="text-sm" />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-metin">Defter</h2>

        {dokum.length > 0 ? (
          /* ⚠️ Sekmeler YALNIZCA defterde GERÇEKTEN bulunan türlerden kuruluyor
             (`dokum` = `breakdown` anahtarları). Sabit sekiz sekme çizilseydi
             yarısı boş liste gösteren düğme olurdu. */
          <Sekmeler
            etiket="Defter türü süzgeci"
            sekmeler={[
              { etiket: 'Tümü', yol: defterYolu(null), secili: tur === null },
              ...dokum.map((deger) => ({
                etiket: DEFTER_TURU[deger].metin,
                yol: defterYolu(deger),
                secili: tur === deger,
              })),
            ]}
          />
        ) : null}

        {defter.length === 0 ? (
          <BosSonuc
            baslik={tur ? 'Bu türde defter kaydı yok.' : 'Defterinizde henüz hareket yok.'}
            aciklama="İlk satışınız tamamlandığında satış, komisyon ve kargo payı satırları burada görünür."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH scope="col">Tarih</TH>
                <TH scope="col">Tür</TH>
                <TH scope="col">Açıklama</TH>
                <TH scope="col">Durum</TH>
                <TH scope="col" sayisal>
                  Tutar
                </TH>
              </TR>
            </THead>
            <TBody>
              {defter.map((satir) => (
                <DefterSatiri key={satir.id} satir={satir} />
              ))}
            </TBody>
          </Table>
        )}

        <ImlecSayfalama
          ilkSayfaHref={defterYolu(tur)}
          sonrakiHref={
            nextCursor
              ? `${defterYolu(tur)}${tur ? '&' : '?'}imlec=${encodeURIComponent(nextCursor)}`
              : null
          }
          ilkSayfada={imlec === null}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-metin">Ödeme talepleri</h2>

        {payoutlar.length === 0 ? (
          <p className="text-sm text-metin-soluk">Henüz bir ödeme talebi oluşturmadınız.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH scope="col">Talep no</TH>
                <TH scope="col">Tarih</TH>
                <TH scope="col">Durum</TH>
                <TH scope="col" sayisal>
                  Tutar
                </TH>
              </TR>
            </THead>
            <TBody>
              {payoutlar.map((payout) => {
                const durum = PAYOUT_DURUMU[payout.status];
                return (
                  <TR key={payout.id}>
                    <TD className="rakam text-metin-soluk">{payout.payoutRef}</TD>
                    <TD className="rakam text-metin-soluk">{tarih(payout.createdAt)}</TD>
                    <TD>
                      <span className="flex flex-col gap-0.5">
                        <Badge durum={durum.rozet} className="w-fit">
                          {durum.metin}
                        </Badge>
                        {/* ⚠️ `failureReason` varsa GÖSTERİLİR: "başarısız"
                            demek ama sebebini söylememek, satıcıyı düzeltemeyeceği
                            bir durumda bırakır. */}
                        {payout.failureReason ? (
                          <span className="text-xs text-metin-soluk">{payout.failureReason}</span>
                        ) : null}
                      </span>
                    </TD>
                    <TD sayisal>
                      <Fiyat value={payout.amountMinor} className="text-sm" />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}

        {/* ⚠️ MASKELİ IBAN LİSTEDE GÖSTERİLEMİYOR: uç `ibanEnc`i bilerek
            seçmiyor ve `/seller/me` son dört haneyi de vermiyor. "Kayıtlı
            hesabınıza" demek, olmayan veriyi uydurmamanın tek yolu. */}
        <p className="text-xs text-metin-soluk">
          Ödemeler satıcı başvurunuzda kayıtlı banka hesabınıza yapılır. Hesap bilgisi güvenlik
          nedeniyle bu ekranda gösterilmez.
        </p>
      </div>
    </section>
  );
}

/**
 * DEFTER SATIRI.
 *
 * ⚠️ TERS KAYIT SİLİNMİŞ GİBİ GÖSTERİLMEZ. Defter append-only: iade olduğunda
 *    satış satırı yerinde durur, karşısına ters işaretli yeni satırlar yazılır.
 *    Üstü çizili bir satış satırı ya da kaybolan bir kayıt, mutabakatı yapan
 *    kişiye yalan söylerdi.
 *
 * ⚠️ Sipariş numarası için ayrı bir kolon YOK çünkü alan yok: numara yalnızca
 *    `description` metninin içinde. Boş kalacak bir kolon açmak yerine
 *    açıklama olduğu gibi basılıyor.
 */
function DefterSatiri({ satir }: { satir: SellerLedgerEntryWire }) {
  const tanim = DEFTER_TURU[satir.type];
  const bekliyor = satir.availableAt !== null && !gecmisMi(satir.availableAt);

  return (
    <TR>
      <TD className="rakam text-metin-soluk">{tarih(satir.createdAt)}</TD>

      <TD>
        <span className="flex flex-col gap-0.5">
          <span className="text-metin">{tanim.metin}</span>
          {tanim.tersKayit ? (
            <Badge durum="notr" className="w-fit">
              ters kayıt
            </Badge>
          ) : null}
        </span>
      </TD>

      <TD>
        <span className="flex flex-col gap-0.5">
          <span className="text-metin">{satir.description}</span>
          <span className="text-xs text-metin-soluk">{tanim.aciklama}</span>
        </span>
      </TD>

      <TD className="text-metin-soluk">
        {bekliyor ? (
          <span className="rakam">{tarihSaat(satir.availableAt!)} tarihinde çekilebilir</span>
        ) : (
          'Bakiyeye işlendi'
        )}
      </TD>

      {/* ⚠️ Negatif tutarlar işaretiyle basılır ve gizlenmez; `<Fiyat>`
          `Money.formatMoney` üzerinden eksiyi de biçimlendirir. */}
      <TD sayisal>
        <Fiyat value={satir.amountMinor} className="text-sm" />
      </TD>
    </TR>
  );
}
