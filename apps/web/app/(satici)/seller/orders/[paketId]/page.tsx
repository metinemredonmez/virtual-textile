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
import { kalanSaat, tarihSaat } from '@/lib/tarih';
import { yuzdeBps } from '@/lib/sayi-bicim';
import { SayfaBasligi } from '@/components/panel/duzen';
import { PAKET_DURUMU } from '../_lib/etiketler';
import { SLA_UYARI_SAATI } from '../_lib/sorgu';
import type { SellerPackageDetailWire } from '@vt/contracts';
import { KargoFormu } from './kargo-formu';

export const dynamic = 'force-dynamic';

type Params = Promise<{ paketId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { paketId } = await params;
  void paketId;
  // ⚠️ Başlıkta paket kimliği YAZILMIYOR: sekme başlığı kullanıcıya bir şey
  //    söylemeli, uuid söylemiyor. Sipariş numarası için ikinci bir istek atmak
  //    ise aynı veriyi iki kez çekmek olurdu.
  return { title: 'Sipariş detayı' };
}

/**
 * SATICI PAKET DETAYI.
 *
 * ⚠️ YOL PARAMETRESİ PAKET KİMLİĞİDİR, sipariş numarası değil. Müşteri
 *    tarafındaki `/account/orders/[siparisNo]` ile karıştırılmamalı: orada
 *    numara, burada kimlik. `GET /v1/seller/packages/:id` kimlik bekliyor.
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
 * ⚠️ GÜVENLİK TARAFI DEĞİŞMEDİ: başka satıcının paketi için sunucu 403 değil
 *    `PACKAGE_NOT_FOUND` döndürüyor (sahiplik `where` koşulunda) ve ekran o
 *    zarfı olduğu gibi basıyor. "Yok" ile "senin değil" ekranda ayırt edilemez;
 *    kimlik deneyerek başka mağazaların paket varlığı öğrenilemez.
 */
export default async function SaticiPaketDetayPage({ params }: { params: Params }) {
  const { paketId } = await params;
  const yol = `/seller/orders/${paketId}`;

  let paket: SellerPackageDetailWire;
  try {
    const sonuc = await hesapFetch<SellerPackageDetailWire, `/seller/packages/${string}`>(
      `/seller/packages/${encodeURIComponent(paketId)}`,
      yol,
    );
    paket = sonuc.data;
  } catch (error) {
    return <SunucuHatasi govde={hataYuku(error)} className="max-w-xl" />;
  }

  const durum = PAKET_DURUMU[paket.status];
  const bekleyen = paket.status === 'AWAITING_APPROVAL' || paket.status === 'PREPARING';
  const kalan = kalanSaat(paket.slaDeadline);

  return (
    <section className="flex flex-col gap-8">
      {/*
        ⚠️ BAŞLIK `SayfaBasligi`DAN. Elle yazılmış bir `<h1>` vardı ve bu ekran,
           panelin `border-b border-kenar pb-4` ayracını taşımayan beş
           sayfasından biriydi — aynı panelde başlığın iki farklı görünümü.
      */}
      <SayfaBasligi
        ustBaglanti={
          <Link
            href="/seller/orders"
            className="inline-flex items-center gap-1 text-sm text-metin-soluk hover:text-metin"
          >
            <ChevronLeft className="size-4 text-ikon" />
            Siparişler
          </Link>
        }
        baslik={
          <span className="flex flex-wrap items-center gap-3">
            <span className="rakam">{paket.orderNumber}</span>
            <Badge durum={durum.rozet}>{durum.metin}</Badge>
          </span>
        }
        eylem={
          <p className="text-sm text-metin-soluk">
            {tarihSaat(paket.createdAt)} tarihinde oluşturuldu
          </p>
        }
        aciklama={
          /*
            SLA UYARISI — üç ayrı cümle, çünkü üç ayrı durum.
            ⚠️ "Süre aşıldı" kararı sunucunun (`slaBreached`); "az kaldı" yalnızca
               gösterim için burada hesaplanıyor. İkisi tek cümlede birleştirilseydi
               satıcı hangi durumda olduğunu ayırt edemezdi.
          */
          paket.slaBreached ? (
            <p className="rounded-md bg-tehlike-zemin p-3 text-sm text-tehlike">
              Hazırlık süresi {tarihSaat(paket.slaDeadline)} tarihinde doldu. Paketi en kısa sürede
              kargoya verin; geciken siparişler mağaza puanınızı etkiler.
            </p>
          ) : bekleyen && kalan <= SLA_UYARI_SAATI ? (
            <p className="rounded-md bg-uyari-zemin p-3 text-sm text-uyari">
              Hazırlık süresinin dolmasına <span className="rakam">{kalan}</span> saat kaldı — son
              tarih {tarihSaat(paket.slaDeadline)}.
            </p>
          ) : bekleyen ? (
            <p>
              Hazırlık son tarihi: <span className="rakam">{tarihSaat(paket.slaDeadline)}</span>
            </p>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Paket işlemleri</CardTitle>
        </CardHeader>
        <CardContent>
          <KargoFormu paketId={paket.id} durum={paket.status} />

          {/*
            ⚠️ EYLEM YOKSA SEBEBİ YAZILIR. Boş bir kart, satıcıya "burada bir şey
               bozuk" dedirtir. Teslim ve iade kapanışı satıcının elinde değil:
               teslim kargo entegrasyonundan, iade kapanışı iade akışından gelir.
          */}
          {paket.status === 'SHIPPED' ? (
            <p className="text-sm text-metin-soluk">
              Paket kargoya verildi. Teslim bilgisi kargo entegrasyonundan gelir; bu ekrandan
              &quot;teslim edildi&quot; işaretlenemez.
              {paket.shippedAt ? <> Kargoya veriliş: {tarihSaat(paket.shippedAt)}.</> : null}
            </p>
          ) : null}

          {paket.status === 'DELIVERED' ? (
            <p className="text-sm text-metin-soluk">
              Paket teslim edildi
              {paket.deliveredAt ? <> ({tarihSaat(paket.deliveredAt)})</> : null}. Hakediş, iade
              penceresi kapandıktan sonra çekilebilir hâle gelir; tarihi Finans ekranında
              görebilirsiniz.
            </p>
          ) : null}

          {paket.status === 'RETURN_REQUESTED' ? (
            <p className="text-sm text-metin-soluk">
              Bu paket için bir iade talebi açık. Karar İadeler ekranından verilir.{' '}
              <Link
                href="/seller/returns"
                className="text-vurgu underline-offset-4 hover:underline"
              >
                İadeler
              </Link>
            </p>
          ) : null}

          {paket.status === 'RETURNED' || paket.status === 'CANCELLED' ? (
            <p className="text-sm text-metin-soluk">
              Bu paket kapandı; üzerinde yapılabilecek bir işlem kalmadı.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-metin">Kalemler</h2>

        <Table>
          <THead>
            <TR>
              <TH scope="col">Ürün</TH>
              <TH scope="col">SKU</TH>
              <TH scope="col" sayisal>
                Adet
              </TH>
              <TH scope="col" sayisal>
                Birim fiyat
              </TH>
              <TH scope="col" sayisal>
                Satır tutarı
              </TH>
              <TH scope="col" sayisal>
                Komisyon
              </TH>
              <TH scope="col" sayisal>
                Hakedişiniz
              </TH>
            </TR>
          </THead>
          <TBody>
            {paket.items.map((kalem) => (
              <TR key={kalem.id}>
                <TD>
                  <span className="text-metin">{kalem.productTitle}</span>
                  <span className="text-metin-soluk"> · {kalem.variantLabel}</span>
                </TD>
                <TD className="rakam text-metin-soluk">{kalem.sku}</TD>
                <TD sayisal>{kalem.quantity}</TD>
                <TD sayisal>
                  <Fiyat value={kalem.unitPriceMinor} className="text-sm" />
                </TD>
                <TD sayisal>
                  <Fiyat value={kalem.lineTotalMinor} className="text-sm" />
                </TD>
                <TD sayisal>
                  <span className="flex flex-col items-end">
                    <Fiyat value={kalem.commissionAmountMinor} className="text-sm" />
                    {/* ⚠️ `commissionRateBps` PARA DEĞİL (1250 = %12,50);
                        `<Fiyat>` ile basılamaz, ama sayı olduğu için `rakam`
                        sınıfını KENDİ taşımak zorunda.
                        ⚠️ Biçim `yuzdeBps`ten gelir, ELLE yazılmaz. Burada
                        `(bps / 100).toFixed(2).replace('.', ',')` duruyordu:
                        deponun ÜÇÜNCÜ bps çeviricisi ve `sayi-bicim.ts`
                        başlığının açıkça reddettiği kayan noktalı bölme.
                        Çıktılar bugün örtüşüyor (bps ≤ 3500), yani ayrışma
                        görünmez — `yuzdeBps` bir gün değiştiğinde (binlik
                        ayraç, negatif işaret) sessizce doğardı. */}
                    <span className="rakam text-xs text-metin-soluk">
                      {yuzdeBps(kalem.commissionRateBps)} — o günkü oran
                    </span>
                  </span>
                </TD>
                <TD sayisal>
                  <Fiyat value={kalem.sellerNetMinor} className="text-sm" />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>

        {/*
          ⚠️ PAKET TOPLAMI YAZILMIYOR ve bu bir eksiklik değil, kural:
             toplamlar frontend'de hesaplanmaz. Sunucu paket başına hakediş
             toplamı GÖNDERMİYOR (`SellerPackageDetail` yalnız kalem başına
             `sellerNetMinor` taşıyor). Burada `reduce` ile toplamak, sunucunun
             `Money.allocate()` ile yaptığı kuruş dağıtımını ikinci kez ve farklı
             şekilde yapmak olurdu; 1 kuruşluk fark bile mutabakatı bozar.
             Eksik alan raporlandı.
        */}
        <p className="text-xs text-metin-soluk">
          Komisyon oranı sipariş anında dondurulur; sonradan yapılan oran değişiklikleri bu siparişe
          uygulanmaz. Hakedişin bakiyenize ne zaman geçtiğini Finans ekranından izleyebilirsiniz.
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Teslimat bilgisi</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm text-metin-soluk">
          <p className="text-metin">{paket.shipping.contactName}</p>
          <p className="rakam">{paket.shipping.phone}</p>
          <p>{paket.shipping.line1}</p>
          <p>
            {[paket.shipping.neighbourhood, paket.shipping.district, paket.shipping.city]
              .filter(Boolean)
              .join(' / ')}
          </p>
          {paket.shipping.postalCode ? <p className="rakam">{paket.shipping.postalCode}</p> : null}

          {/* ⚠️ Müşterinin e-postası ve fatura bilgisi BİLEREK gelmiyor (KVKK
              m.4 veri minimizasyonu). Eksik sanılıp "iletişim" alanı eklenmesin
              diye sebebi ekranda yazılı. */}
          <p className="mt-2 text-xs">
            Kargo için gereken alanlar gösterilir. Müşterinin e-posta ve fatura bilgisi satıcıyla
            paylaşılmaz.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
