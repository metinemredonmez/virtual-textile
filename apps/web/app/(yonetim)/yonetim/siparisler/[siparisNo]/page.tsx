import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { hesapFetch } from '@/lib/api/server-authed';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { Fiyat } from '@/components/fiyat/fiyat';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { tarihSaat } from '@/lib/tarih';
import { SayfaBasligi } from '@/components/panel/duzen';
import {
  AKTOR_ADI,
  IADE_DURUMU,
  olayAdi,
  PAKET_DURUMU,
  SIPARIS_DURUMU,
} from '../../_finans/etiketler';
import { sayi, yuzdeBps } from '@/lib/sayi-bicim';
import type { AdminOrderDetailWire, AdminOrderPackageWire } from '@vt/contracts';
import { ManuelIadeFormu } from './manuel-iade';

export const dynamic = 'force-dynamic';

type Params = Promise<{ siparisNo: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { siparisNo } = await params;
  return { title: `Sipariş ${decodeURIComponent(siparisNo)}` };
}

/**
 * SİPARİŞ DETAYI (yönetim).
 *
 * ⚠️ YOL PARAMETRESİ SİPARİŞ NUMARASI, KİMLİK DEĞİL — uç
 *    `GET /admin/orders/:orderNumber`. Ama manuel iade ucu KİMLİK istiyor
 *    (`POST /admin/orders/:id/refund`). İkisi aynı sanılırsa her iade 404 alır.
 *    Kimlik yanıtın `id` alanından okunuyor.
 *
 * ⚠️ SİPARİŞ İPTALİ İÇİN DÜĞME YOK, çünkü UÇ YOK. `POST /v1/orders/:id/cancel`
 *    müşterinin kendi siparişi içindir (sahiplik `WHERE` koşulunda) ve yönetici
 *    başkasının siparişini oradan iptal edemez. Kırık bir düğme koymaktansa
 *    ekran bunu açıkça söylüyor — bu deponun yedi panel bağlantısını kaldırma
 *    ölçütünün aynısı.
 *
 * ⚠️ `notFound()` ÇAĞRILMIYOR: gerekçe `komisyon/[id]/page.tsx` başlığında —
 *    grup kökündeki `loading.tsx` yüzünden Suspense ardındaki `notFound()`
 *    HTTP 200 döner (AGENTS.md §8) ve o dosya başka bir ajanın alanında.
 */
export default async function YonetimSiparisDetayPage({
  params,
}: {
  params: Params;
}): Promise<React.ReactElement> {
  const { siparisNo } = await params;
  const numara = decodeURIComponent(siparisNo);
  const yol = `/yonetim/siparisler/${siparisNo}`;

  let siparis: AdminOrderDetailWire;
  try {
    const sonuc = await hesapFetch<AdminOrderDetailWire, `/admin/orders/${string}`>(
      `/admin/orders/${encodeURIComponent(numara)}`,
      yol,
    );
    siparis = sonuc.data;
  } catch (error) {
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const durum = SIPARIS_DURUMU[siparis.status];
  const odeme = siparis.payment;

  /**
   * ⚠️ İADE FORMU YALNIZCA TAHSİLAT VARSA. Sunucu tahsil edilen tutarı ÖDEME
   *    kaydından okuyor; tahsilat yoksa `REFUND_NO_CAPTURED_PAYMENT` dönüyor ve
   *    o durumda doğru eylem iade değil sipariş iptalidir. Formu her siparişte
   *    göstermek, yöneticiyi yanlış eyleme davet ederdi.
   */
  const iadeEdilebilir =
    odeme !== null && (odeme.status === 'CAPTURED' || odeme.status === 'PARTIALLY_REFUNDED');

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Link
          href="/yonetim/siparisler"
          className="inline-flex items-center gap-1 text-sm text-metin-soluk hover:text-metin"
        >
          <ChevronLeft className="size-4 text-ikon" />
          Siparişler
        </Link>
      </div>

      <SayfaBasligi
        baslik={siparis.orderNumber}
        aciklama={
          <span className="flex flex-wrap items-center gap-3">
            <Badge durum={durum.rozet}>{durum.metin}</Badge>
            <span>{siparis.email}</span>
            <span>{tarihSaat(siparis.createdAt)}</span>
          </span>
        }
        eylem={<Fiyat value={siparis.grandTotalMinor} className="text-lg" />}
      />

      {/* ── Tutarlar · Ödeme · Adres ──────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Tutarlar</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {/* ⚠️ Hiçbiri burada TOPLANMIYOR. Sunucu `Money.allocate()` ile
                kuruş kaybı olmadan dağıtıp gönderiyor; ikinci bir toplama
                yuvarlamayı farklı yapar ve 1 kuruşluk fark mutabakatı bozar. */}
            <TutarSatiri etiket="Ürünler" value={siparis.itemsTotalMinor} />
            <TutarSatiri etiket="Kargo" value={siparis.shippingTotalMinor} />
            <TutarSatiri etiket="İndirim" value={siparis.discountMinor} />
            <div className="mt-1 flex items-center justify-between border-t border-kenar pt-2">
              <span className="font-medium text-metin">Toplam</span>
              <Fiyat value={siparis.grandTotalMinor} className="text-sm" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ödeme</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {odeme === null ? (
              <p className="text-metin-soluk">Bu siparişte ödeme kaydı yok.</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-metin-soluk">Tahsil edilen</span>
                  <Fiyat value={odeme.amountMinor} className="text-sm" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-metin-soluk">Durum</span>
                  {/* ⚠️ Ham enum adı gösteriliyor: `PaymentStatus` için
                      doğrulanmış bir Türkçe tablo yok ve uydurmak, yedi değerin
                      birini yanlış çevirdiğinde sessizce yanlış bilgi verirdi. */}
                  <span className="rakam text-metin">{odeme.status}</span>
                </div>
                {odeme.cardMask ? (
                  <div className="flex items-center justify-between">
                    <span className="text-metin-soluk">Kart</span>
                    <span className="rakam text-metin">
                      {[odeme.cardBrand, odeme.cardMask].filter(Boolean).join(' ')}
                    </span>
                  </div>
                ) : null}
                {odeme.installment > 1 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-metin-soluk">Taksit</span>
                    <span className="rakam text-metin">{sayi(odeme.installment)}</span>
                  </div>
                ) : null}
                {odeme.failureCode ? (
                  <div className="flex items-center justify-between">
                    <span className="text-metin-soluk">Hata kodu</span>
                    <span className="rakam text-tehlike">{odeme.failureCode}</span>
                  </div>
                ) : null}

                {odeme.refunds.length > 0 ? (
                  <div className="mt-2 border-t border-kenar pt-2">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-metin-soluk">
                      Kayıtlı iadeler
                    </p>
                    {/* ⚠️ Satırlar TEK TEK gösteriliyor, TOPLANMIYOR. "Kalan
                        iade edilebilir" tutarını burada hesaplamak, sunucunun
                        ödeme kayıtlarından yaptığı hesabın ikinci bir
                        uygulaması olurdu. O rakamın tek kaynağı iade yanıtı
                        (ve reddedilirse hata zarfı). */}
                    <ul className="flex flex-col gap-1">
                      {odeme.refunds.map((iade) => (
                        <li key={iade.id} className="flex items-center justify-between">
                          <span className="rakam text-metin-soluk">
                            {iade.refundRef} · {iade.status}
                          </span>
                          <Fiyat value={iade.amountMinor} className="text-sm" />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <AdresKarti adres={siparis.shippingAddress} telefon={siparis.phone} />
      </div>

      {/* ── Paketler ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-metin">
          Paketler
          {siparis.packages.length > 1 ? (
            <span className="ml-2 font-normal text-metin-soluk">
              Sipariş <span className="rakam">{sayi(siparis.packages.length)}</span> satıcıya
              bölündü; her paket ayrı kargolanır ve komisyonu ayrı kesilir.
            </span>
          ) : null}
        </h2>

        {siparis.packages.map((paket) => (
          <PaketKarti key={paket.id} paket={paket} />
        ))}
      </div>

      {/* ── İade talepleri ───────────────────────────────────────────── */}
      {siparis.returns.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>İade talepleri</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {siparis.returns.map((iade) => {
              const iadeDurum = IADE_DURUMU[iade.status];
              return (
                <div key={iade.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-3">
                    <span className="rakam font-medium text-metin">{iade.returnNumber}</span>
                    <Badge durum={iadeDurum.rozet}>{iadeDurum.metin}</Badge>
                    <span className="text-metin-soluk">{iade.reason}</span>
                  </span>
                  <span className="flex items-center gap-3 text-metin-soluk">
                    {tarihSaat(iade.createdAt)}
                    <Fiyat value={iade.refundAmountMinor} className="text-sm" />
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Manuel iade ──────────────────────────────────────────────── */}
      {iadeEdilebilir ? (
        <ManuelIadeFormu siparisId={siparis.id} siparisNo={siparis.orderNumber} />
      ) : (
        <p className="rounded-md border border-kenar bg-yuzey p-3 text-sm text-metin-soluk">
          Bu siparişte tahsil edilmiş ödeme olmadığı için manuel iade yapılamaz. Tahsilat yokken
          tutar iade etmek yerine siparişin iptal edilmesi gerekir — iptal ucu bugün yalnızca
          müşterinin kendi siparişi için var, yönetim panelinde karşılığı yok.
        </p>
      )}

      {/* ── Olay geçmişi ─────────────────────────────────────────────── */}
      {siparis.events.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Olay geçmişi</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            {siparis.events.map((olay, sira) => (
              <div key={`${olay.type}-${sira}`} className="flex items-center justify-between gap-3">
                <span className="text-metin">{olayAdi(olay.type)}</span>
                <span className="text-metin-soluk">
                  {AKTOR_ADI[olay.actorType]} · {tarihSaat(olay.createdAt)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

function PaketKarti({ paket }: { paket: AdminOrderPackageWire }): React.ReactElement {
  const durum = PAKET_DURUMU[paket.status];

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <CardTitle>{paket.seller.displayName}</CardTitle>
          <Badge durum={durum.rozet}>{durum.metin}</Badge>
        </div>
        {paket.trackingNo ? (
          <p className="text-xs text-metin-soluk">
            {paket.carrier ?? 'Kargo'} · <span className="rakam">{paket.trackingNo}</span>
          </p>
        ) : null}
      </CardHeader>

      <CardContent>
        <Table>
          <THead>
            <TR>
              <TH>Ürün</TH>
              <TH sayisal>Adet</TH>
              <TH sayisal>Birim</TH>
              <TH sayisal>Satır</TH>
              <TH sayisal>Oran</TH>
              <TH sayisal>Komisyon</TH>
              <TH sayisal>Satıcı neti</TH>
            </TR>
          </THead>
          <TBody>
            {paket.items.map((kalem) => (
              <TR key={kalem.id}>
                <TD>
                  <span className="text-metin">{kalem.productTitle}</span>
                  <span className="text-metin-soluk"> · {kalem.variantLabel}</span>
                </TD>
                <TD sayisal>{sayi(kalem.quantity)}</TD>
                <TD sayisal>
                  <Fiyat value={kalem.unitPriceMinor} />
                </TD>
                <TD sayisal>
                  <Fiyat value={kalem.lineTotalMinor} />
                </TD>
                {/*
                  ⚠️ "O GÜNKÜ ORAN". `OrderItem.commissionRateBps` sipariş
                     anında snapshot alınmış bir değerdir; komisyon kuralı o
                     tarihten sonra değiştiyse bu sayı bugünkü kuralla
                     UYUŞMAZ ve bu doğru davranıştır.
                */}
                <TD sayisal title="Sipariş anındaki oran — sonradan değişmez">
                  {yuzdeBps(kalem.commissionRateBps)}
                </TD>
                <TD sayisal>
                  <Fiyat value={kalem.commissionAmountMinor} />
                </TD>
                <TD sayisal>
                  <Fiyat value={kalem.sellerNetMinor} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>

        <p className="mt-2 text-xs text-metin-soluk">
          Oran sütunu sipariş anındaki komisyonu gösterir. Komisyon kuralında sonradan açılan
          versiyonlar bu satırları değiştirmez.
        </p>
      </CardContent>
    </Card>
  );
}

function TutarSatiri({
  etiket,
  value,
}: {
  etiket: string;
  value: AdminOrderDetailWire['grandTotalMinor'];
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-metin-soluk">{etiket}</span>
      <Fiyat value={value} className="text-sm" />
    </div>
  );
}

/**
 * ⚠️ Adres alanlarının hepsi opsiyonel okunuyor: sütun Prisma `Json` ve eski
 *    siparişlerin biçimi farklı olabilir. Zorunlu okunsaydı tek bir eksik alan
 *    tüm sipariş detayını beyaz ekrana düşürürdü.
 *
 * ⚠️ Adres yönetim görünümünde AÇIK — destek ekibi kargo sorununu ancak adresi
 *    görerek çözebilir. Uç `ADMIN`/`SUPPORT` ile sınırlı ve `@Public()` değil.
 */
function AdresKarti({
  adres,
  telefon,
}: {
  adres: AdminOrderDetailWire['shippingAddress'];
  telefon: string | null;
}): React.ReactElement {
  const satirlar = [
    [adres?.firstName, adres?.lastName].filter(Boolean).join(' '),
    adres?.line1,
    adres?.line2,
    [adres?.district, adres?.city].filter(Boolean).join(' / '),
    adres?.postalCode,
    adres?.phone ?? telefon,
  ].filter((satir): satir is string => Boolean(satir));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Teslimat adresi</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-metin-soluk">
        {satirlar.length === 0 ? (
          <p>Adres bilgisi bulunamadı.</p>
        ) : (
          satirlar.map((satir, sira) => <p key={sira}>{satir}</p>)
        )}
      </CardContent>
    </Card>
  );
}
