import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { isApiFailure } from '@vt/contracts';
import { mediaUrl } from '@/lib/media';
import { UrunGorseli } from '@/components/urun/urun-gorseli';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Fiyat } from '@/components/fiyat/fiyat';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { hesapFetch } from '@/lib/api/server-authed';
import { IADE_DURUMU, IADE_SEBEBI, PAKET_DURUMU, SIPARIS_DURUMU } from '../../_lib/etiketler';
import { gecmisMi, tarih, tarihSaat } from '@/lib/tarih';
import type {
  OrderAddressWire,
  OrderDetailWire,
  OrderItemWire,
  OrderPackageWire,
} from '@vt/contracts';
import { IadeFormu } from './iade-formu';

export const dynamic = 'force-dynamic';

type Params = Promise<{ siparisNo: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { siparisNo } = await params;
  return { title: `Sipariş ${decodeURIComponent(siparisNo)}` };
}

/**
 * SİPARİŞ DETAYI.
 *
 * ⚠️ Yol parametresi SİPARİŞ NUMARASI, kimlik değil (`GET /v1/orders/:orderNumber`).
 *    Ama iptal/iade uçları KİMLİK istiyor (`POST /v1/orders/:id/returns`) —
 *    ikisi aynı sanılırsa iade talebi her seferinde 404 alır. Kimlik yanıtın
 *    `id` alanından okunur.
 *
 * ⚠️ Başkasının siparişi için sunucu 403 DEĞİL `ORDER_NOT_FOUND` döndürüyor
 *    (sahiplik koşulu `WHERE`de). Burada da `notFound()` gösteriliyor: farklı
 *    bir ekran göstermek, numara deneyerek sipariş varlığını öğrenmeye izin
 *    verirdi.
 */
export default async function SiparisDetayPage({ params }: { params: Params }) {
  const { siparisNo } = await params;
  const numara = decodeURIComponent(siparisNo);
  const yol = `/account/orders/${siparisNo}`;

  let siparis: OrderDetailWire;
  try {
    const sonuc = await hesapFetch<OrderDetailWire, `/orders/${string}`>(
      `/orders/${encodeURIComponent(numara)}`,
      yol,
    );
    siparis = sonuc.data;
  } catch (error) {
    if (isApiFailure(error) && (error.code === 'ORDER_NOT_FOUND' || error.httpStatus === 404)) {
      notFound();
    }
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const durum = SIPARIS_DURUMU[siparis.status];

  /**
   * KALEM BAŞINA HÂLÂ İADE EDİLEBİLİR ADET.
   *
   * ⚠️ REJECTED ve CANCELLED iadeler adet TÜKETMEZ — müşteri tekrar talep
   *    edebilir (`order.service.ts` → `OPEN_RETURN_STATUSES`). Bunları da
   *    sayan bir arayüz, satıcının reddettiği bir talepten sonra kullanıcıyı
   *    kalıcı olarak kilitler.
   *
   * ⚠️ Bu hesap yalnızca ARAYÜZ İÇİNDİR. Gerçek kapı sunucudadır ve orada
   *    sipariş satırı kilitlenerek yapılıyor; burada ikinci bir "doğruluk
   *    kaynağı" yaratmıyoruz, yalnızca kullanıcıya reddedilecek bir form
   *    doldurtmuyoruz.
   */
  const tuketilen = new Map<string, number>();
  for (const iade of siparis.returns) {
    if (iade.status === 'REJECTED' || iade.status === 'CANCELLED') continue;
    for (const kalem of iade.items) {
      tuketilen.set(kalem.orderItemId, (tuketilen.get(kalem.orderItemId) ?? 0) + kalem.quantity);
    }
  }

  return (
    <section className="flex flex-col gap-8">
      <div>
        <Link
          href="/account/orders"
          className="inline-flex items-center gap-1 text-sm text-metin-soluk hover:text-metin"
        >
          <ChevronLeft className="size-4 text-ikon" />
          Siparişlerim
        </Link>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="rakam text-xl font-semibold tracking-tight">{siparis.orderNumber}</h1>
            <Badge durum={durum.rozet}>{durum.metin}</Badge>
          </div>
          <Fiyat value={siparis.grandTotalMinor} className="text-base" />
        </div>

        <p className="mt-1 text-sm text-metin-soluk">
          {tarihSaat(siparis.createdAt)} tarihinde oluşturuldu
        </p>

        {/* ⚠️ Rezervasyon süresi YALNIZCA ödeme beklerken anlamlı; ödenmiş
            siparişte göstermek kullanıcıya "siparişim düşecek mi" diye
            sordurur. */}
        {siparis.status === 'PENDING_PAYMENT' && siparis.reservationExpiresAt ? (
          <p className="mt-3 rounded-md bg-uyari-zemin p-3 text-sm text-uyari">
            Stok rezervasyonunuz {tarihSaat(siparis.reservationExpiresAt)} tarihine kadar geçerli.
            Ödeme tamamlanmazsa sipariş düşer.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-metin">
          Paketler
          {siparis.packages.length > 1 ? (
            <span className="ml-2 font-normal text-metin-soluk">
              Sipariş {siparis.packages.length} satıcıya bölündü; her paket ayrı kargolanır.
            </span>
          ) : null}
        </h2>

        {siparis.packages.map((paket) => (
          <PaketKarti key={paket.id} siparisId={siparis.id} paket={paket} tuketilen={tuketilen} />
        ))}
      </div>

      {siparis.returns.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>İade talepleri</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {siparis.returns.map((iade) => {
              const iadeDurum = IADE_DURUMU[iade.status];
              return (
                <div
                  key={iade.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="flex items-center gap-3">
                    <span className="rakam font-medium text-metin">{iade.returnNumber}</span>
                    <Badge durum={iadeDurum.rozet}>{iadeDurum.metin}</Badge>
                    <span className="text-metin-soluk">{IADE_SEBEBI[iade.reason]}</span>
                  </span>
                  <span className="flex items-center gap-3 text-metin-soluk">
                    {tarih(iade.createdAt)}
                    <Fiyat value={iade.refundAmountMinor} className="text-sm" />
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <AdresKarti baslik="Teslimat adresi" adres={siparis.shippingAddress} />
        <AdresKarti baslik="Fatura adresi" adres={siparis.billingAddress} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tutarlar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {/* ⚠️ Hiçbiri burada TOPLANMIYOR. Sunucu `Money.allocate()` ile kuruş
              kaybı olmadan dağıtıp gönderiyor; ikinci bir toplama yuvarlamayı
              farklı yapar ve 1 kuruşluk fark mutabakatı bozar. */}
          <TutarSatiri etiket="Ürünler" value={siparis.itemsTotalMinor} />
          <TutarSatiri etiket="Kargo" value={siparis.shippingTotalMinor} />
          <TutarSatiri etiket="İndirim" value={siparis.discountMinor} />
          <div className="mt-1 flex items-center justify-between border-t border-kenar pt-2">
            <span className="font-medium text-metin">Toplam</span>
            <Fiyat value={siparis.grandTotalMinor} className="text-sm" />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function PaketKarti({
  siparisId,
  paket,
  tuketilen,
}: {
  siparisId: string;
  paket: OrderPackageWire;
  tuketilen: Map<string, number>;
}) {
  const durum = PAKET_DURUMU[paket.status];

  /**
   * İADE PENCERESİ.
   *
   * ⚠️ `returnableUntil` SUNUCUDAN gelir (`ORDER.returnWindowDays`); burada
   *    gün sayısı hesaplanmaz. Hesaplansaydı sunucu penceresi değiştiğinde
   *    arayüz eski süreyi göstermeye devam eder ve kullanıcı son gün
   *    reddedilirdi.
   */
  const pencereAcik = paket.returnableUntil !== null && !gecmisMi(paket.returnableUntil);
  const iadeEdilebilirKalemler = paket.items
    .map((kalem) => ({
      ...kalem,
      kalanAdet: kalem.quantity - (tuketilen.get(kalem.id) ?? 0),
    }))
    .filter((kalem) => kalem.kalanAdet > 0);

  const iadeAcilabilir =
    paket.status === 'DELIVERED' && pencereAcik && iadeEdilebilirKalemler.length > 0;

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

      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-3">
          {paket.items.map((kalem) => (
            <KalemSatiri key={kalem.id} kalem={kalem} />
          ))}
        </ul>

        {paket.status === 'DELIVERED' && paket.deliveredAt ? (
          <p className="text-xs text-metin-soluk">
            {tarih(paket.deliveredAt)} tarihinde teslim edildi.
            {paket.returnableUntil ? (
              pencereAcik ? (
                <> İade hakkınız {tarih(paket.returnableUntil)} tarihine kadar geçerli.</>
              ) : (
                <> İade süresi {tarih(paket.returnableUntil)} tarihinde doldu.</>
              )
            ) : null}
          </p>
        ) : null}

        {paket.status === 'CANCELLED' && paket.cancelReason ? (
          <p className="text-xs text-metin-soluk">İptal sebebi: {paket.cancelReason}</p>
        ) : null}

        {iadeAcilabilir ? (
          <IadeFormu
            siparisId={siparisId}
            paketAdi={paket.seller.displayName}
            kalemler={iadeEdilebilirKalemler.map((kalem) => ({
              id: kalem.id,
              baslik: kalem.productTitle,
              varyant: kalem.variantLabel,
              kalanAdet: kalem.kalanAdet,
            }))}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function KalemSatiri({ kalem }: { kalem: OrderItemWire }) {
  const gorsel = mediaUrl(kalem.imageKey);

  return (
    <li className="flex items-start gap-3">
      <div className="relative aspect-urun w-14 shrink-0 overflow-hidden rounded-sm bg-urun-zemin">
        {/* ⚠️ Ham `next/image` DEĞİL — gerekçe `components/urun/urun-gorseli.tsx`te. */}
        <UrunGorseli src={gorsel} alt={kalem.productTitle} sizes="56px" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-metin">{kalem.productTitle}</p>
        <p className="text-sm text-metin-soluk">
          {kalem.brandName} · {kalem.variantLabel} · <span className="rakam">{kalem.quantity}</span>{' '}
          adet
        </p>
      </div>
      <Fiyat value={kalem.lineTotalMinor} className="text-sm" />
    </li>
  );
}

function TutarSatiri({
  etiket,
  value,
}: {
  etiket: string;
  value: OrderDetailWire['grandTotalMinor'];
}) {
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
 */
function AdresKarti({ baslik, adres }: { baslik: string; adres: OrderAddressWire }) {
  const satirlar = [
    [adres.firstName, adres.lastName].filter(Boolean).join(' '),
    adres.line1,
    adres.line2,
    [adres.district, adres.city].filter(Boolean).join(' / '),
    adres.postalCode,
    adres.phone,
  ].filter((satir): satir is string => Boolean(satir));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{baslik}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-metin-soluk">
        {satirlar.length === 0 ? (
          <p>Adres bilgisi bulunamadı.</p>
        ) : (
          satirlar.map((satir, index) => <p key={index}>{satir}</p>)
        )}
      </CardContent>
    </Card>
  );
}
