import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { hesapFetch } from '@/lib/api/server-authed';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Fiyat } from '@/components/fiyat/fiyat';
import { tarihSaat } from '@/lib/tarih';
import { SayfaBasligi } from '@/components/panel/duzen';
import { IADE_DURUMU, IADE_SEBEBI } from '../_lib/etiketler';
import type { SellerReturnWire } from '@vt/contracts';
import { KararFormu } from './karar-formu';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'İade talebi' };

type Params = Promise<{ iadeId: string }>;

/**
 * SATICI İADE DETAYI VE KARARI.
 *
 * ⚠️ Bu ekranın varlık sebebi ek veri değil — liste ile detay AYNI şekli
 *    döndürüyor. Sebep KARARIN AĞIRLIĞI: onay geri alınamaz bir para
 *    hareketidir ve liste satırındaki bir düğmeden verilmemelidir.
 *
 * ⚠️ `notFound()` ÇAĞRILMIYOR — ve bu, panelin geri kalanıyla AYNI kararın
 *    burada da uygulanmasıdır. `(satici)/loading.tsx` grup kökünde duruyor,
 *    yani bu rota bir Suspense sınırının ARDINDA; AGENTS.md §8'de ÖLÇÜLMÜŞ
 *    kural gereği sınırın ardındaki `notFound()` HTTP **200** döndürür.
 *    Kullanıcı doğru ekranı görür ama durum kodu yalan söyler ve üstelik grup
 *    dışına düşen `app/not-found.tsx` panel kabuğunu da kaybettirir: bulunamayan
 *    bir pakette satıcı, sol menüsü olmayan bir vitrin 404'üne savrulurdu.
 *    Bunun yerine zarfın KENDİ Türkçe mesajı panel kabuğunun içinde gösteriliyor.
 *
 * ⚠️ GÜVENLİK TARAFI DEĞİŞMEDİ: sunucu, sahibi olunmayan kayıt için `NOT_FOUND`
 *    döndürüyor (kapsam `where` koşulunda) ve ekran o zarfı olduğu gibi
 *    basıyor. Yani başka mağazanın kaydının VAR olduğu bilgisi yine sızmıyor;
 *    "yok" ile "senin değil" ekranda ayırt edilemez.
 */
export default async function SaticiIadeDetayPage({ params }: { params: Params }) {
  const { iadeId } = await params;
  const yol = `/satici/iadeler/${iadeId}`;

  let iade: SellerReturnWire;
  try {
    const sonuc = await hesapFetch<SellerReturnWire, `/seller/returns/${string}`>(
      `/seller/returns/${encodeURIComponent(iadeId)}`,
      yol,
    );
    iade = sonuc.data;
  } catch (error) {
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const durum = IADE_DURUMU[iade.status];

  return (
    <section className="flex flex-col gap-8">
      {/*
        ⚠️ BAŞLIK `SayfaBasligi`DAN. Burada elle bir `<h1>` vardı ve bu ekran,
           panelin `border-b border-kenar pb-4` ayracını taşımayan beş
           sayfasından biriydi — aynı panelde başlığın iki farklı görünümü.
           Bileşenin `baslik` alanı `ReactNode` olduğu için numara + rozet
           birlikte geçebiliyor; `string` olması bu ekranın kopya yazmasının
           tek sebebiydi.
      */}
      <SayfaBasligi
        ustBaglanti={
          <Link
            href="/satici/iadeler"
            className="inline-flex items-center gap-1 text-sm text-metin-soluk hover:text-metin"
          >
            <ChevronLeft className="size-4 text-ikon" />
            İadeler
          </Link>
        }
        baslik={
          <span className="flex flex-wrap items-center gap-3">
            <span className="rakam">{iade.returnNumber}</span>
            <Badge durum={durum.rozet}>{durum.metin}</Badge>
          </span>
        }
        eylem={<Fiyat value={iade.refundAmountMinor} className="text-base" />}
        aciklama={
          <>
            <span className="rakam">{iade.orderNumber}</span> · {tarihSaat(iade.createdAt)}{' '}
            tarihinde talep edildi
            {iade.decidedAt ? <> · {tarihSaat(iade.decidedAt)} tarihinde karara bağlandı</> : null}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Müşterinin gerekçesi</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-metin">{IADE_SEBEBI[iade.reason]}</p>
          {iade.note ? <p className="text-metin-soluk">{iade.note}</p> : null}

          {/*
            ⚠️ KANIT FOTOĞRAFLARI BUGÜN GÖSTERİLEMİYOR. `photoKeys` ham depolama
               anahtarı; imzalı URL üreten bir uç yok ve bu dosyalar ürün
               görselleri gibi genel kovada değil. Kırık `<img>` çizmek
               eksikliği GİZLEMEZ, yalnız satıcıyı "resim yüklenmedi" diye
               yanıltırdı. Sayı gösteriliyor, sebep yazılıyor, eksik raporlandı.
          */}
          {iade.photoKeys.length > 0 ? (
            <p className="text-metin-soluk">
              Müşteri <span className="rakam">{iade.photoKeys.length}</span> kanıt fotoğrafı
              yükledi. Fotoğraflar bu ekrandan görüntülenemiyor; görüntüleme için imzalı adres
              üreten bir uç henüz yok.
            </p>
          ) : (
            <p className="text-metin-soluk">Müşteri kanıt fotoğrafı yüklemedi.</p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-metin">İade edilen kalemler</h2>

        <Table>
          <THead>
            <TR>
              <TH scope="col">Ürün</TH>
              <TH scope="col" sayisal>
                Adet
              </TH>
              <TH scope="col" sayisal>
                İade tutarı
              </TH>
            </TR>
          </THead>
          <TBody>
            {iade.items.map((kalem) => (
              <TR key={kalem.orderItemId}>
                <TD>
                  <span className="text-metin">{kalem.productTitle}</span>
                  <span className="text-metin-soluk"> · {kalem.variantLabel}</span>
                </TD>
                <TD sayisal>{kalem.quantity}</TD>
                <TD sayisal>
                  <Fiyat value={kalem.refundMinor} className="text-sm" />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>

        {/* ⚠️ Kalem tutarları burada TOPLANMIYOR: talebin toplamı zaten
            `refundAmountMinor` olarak sunucudan geliyor ve indirim payı
            dağıtımı orada `Money.allocate()` ile yapılıyor. */}
        <p className="text-xs text-metin-soluk">
          Listede yalnızca sizin kalemleriniz görünür; sipariş birden fazla satıcıya bölünmüş
          olabilir.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Karar</CardTitle>
        </CardHeader>
        <CardContent>
          {iade.status === 'REQUESTED' ? (
            <KararFormu iadeId={iade.id} iadeTutari={iade.refundAmountMinor} />
          ) : (
            /*
              ⚠️ Karar verilmiş taleplerde düğme YOK: sunucu `REQUESTED` dışında
                 her durumda `ORDER_INVALID_TRANSITION` döndürüyor. Düğmeyi açık
                 bırakmak, basınca hata veren bir düğme olurdu.

              ⚠️ Ret gerekçesi burada GÖSTERİLEMİYOR: `rejectReason` sütunu var
                 ama satıcı okuma seçiminde (`returnSelect`) YOK. Kendi yazdığı
                 gerekçeyi satıcı bir daha göremiyor — raporlandı.
            */
            <p className="text-sm text-metin-soluk">
              Bu talep karara bağlandı; üzerinde yapılabilecek bir işlem kalmadı.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
