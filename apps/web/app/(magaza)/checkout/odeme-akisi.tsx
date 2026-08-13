'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  isApiFailure,
  type ApiFailure,
  type CartWire,
  type CheckoutInitResultWire,
  type CheckoutPayResultWire,
} from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { AdresFormu, type OdemeFormDegerleri } from './adres-formu';
import { RezervasyonSayaci } from './rezervasyon-sayaci';
import { SiparisOzeti } from './siparis-ozeti';
import { UcDs } from './uc-d-s';
import { odemeAnahtari, odemeyiKaydet, odemeyiTemizle } from './eylemler';
import type { BekleyenOdeme } from '@/lib/session/bekleyen-odeme';

/**
 * ÖDEME AKIŞI — üç adım, tek yönlü.
 *
 *   adres → (checkout/init) → odeme → (checkout/pay) → 3ds → banka → /checkout/result
 *
 * ⚠️ `init` GERİ ALINAMAZ: sipariş oluşturur ve stoğu rezerve eder. Bu yüzden
 *    adım geriye gitmez; kullanıcı adresi değiştirmek isterse sepete döner.
 *    "Geri" düğmesi koyup formu yeniden göndertmek, her düzeltmede yeni bir
 *    sipariş ve yeni bir rezervasyon açardı.
 */

type Adim =
  | { ad: 'adres' }
  | { ad: 'odeme'; siparis: BekleyenOdeme }
  | { ad: 'ucds'; siparis: BekleyenOdeme; html: string };

export function OdemeAkisi({
  sepet,
  bekleyen,
}: {
  sepet: CartWire;
  /** Sunucuda kayıtlı bekleyen sipariş — sayfa yenilendiğinde buradan gelir. */
  bekleyen: BekleyenOdeme | null;
}): React.ReactElement {
  const [adim, setAdim] = React.useState<Adim>(
    bekleyen ? { ad: 'odeme', siparis: bekleyen } : { ad: 'adres' },
  );
  const [hata, setHata] = React.useState<ApiFailure | null>(null);
  const [calisiyor, setCalisiyor] = React.useState(false);
  /**
   * ⚠️ BAŞLANGIÇ DEĞERİ KAYITTAN OKUNUR, sabit 1 DEĞİL.
   *
   *    3DS çerçevesindeyken sayfayı yenileyen kullanıcı `bekleyen` kaydıyla
   *    `odeme` adımına geri döner. Taksit sabit 1'e düşseydi `checkout/pay`
   *    gövdesi ilk çağrıdakinden FARKLI olurdu; API idempotency kaydını
   *    gövdeyle eşleştirdiği için istek kalıcı `IDEMPOTENCY_CONFLICT` alırdı
   *    (bkz. `eylemler.ts` → `odemeAnahtari`).
   *
   *    ⚠️ `?? 1` yalnızca alan eklenmeden ÖNCE yazılmış Redis kayıtları için;
   *    onlarda henüz `pay` çağrılmamış olabileceğinden 1 doğru varsayılan.
   */
  const [taksit, setTaksit] = React.useState(bekleyen?.installment ?? 1);
  const [rezervasyonDoldu, setRezervasyonDoldu] = React.useState(false);

  /**
   * ⚠️ TEK UÇUŞ KİLİDİ — `useRef`, `useState` DEĞİL.
   *
   *    `checkout/init` idempotent değil (ÖLÇÜLDÜ: iki çağrı → VT-260812-0040 ve
   *    VT-260812-0041, iki ayrı rezervasyon). Kilidi state'te tutmak yetmez:
   *    `setState` bir sonraki render'a kadar görünmez ve aynı olay döngüsünde
   *    gelen ikinci tıklama eski değeri okur. Ref eşzamanlı olarak yazılır.
   */
  const ucusta = React.useRef(false);

  /**
   * ⚠️ Fiyat onayı isteği AYNI gövdeyle tekrarlamak zorunda (`acceptPriceChange`
   *    dışında her şey aynı). Değerler tutulmasaydı kullanıcı adres formunu
   *    ikinci kez doldurmak zorunda kalırdı.
   */
  const sonDegerler = React.useRef<OdemeFormDegerleri | null>(null);

  const baslat = React.useCallback(
    async (degerler: OdemeFormDegerleri, fiyatiKabulEt: boolean): Promise<void> => {
      if (ucusta.current) return;
      ucusta.current = true;
      setCalisiyor(true);
      setHata(null);

      try {
        const { data } = await apiFetch<CheckoutInitResultWire, '/checkout/init'>(
          '/checkout/init',
          {
            method: 'POST',
            json: {
              shipping: { address: temizAdres(degerler) },
              email: degerler.email,
              // ⚠️ Varsayılanı `true` yapmak, kullanıcının ONAYLAMADIĞI bir
              //    tutarı çekmek demektir (sunucu şemasının kendi uyarısı).
              acceptPriceChange: fiyatiKabulEt,
            },
          },
        );

        const siparis: BekleyenOdeme = {
          orderId: data.orderId,
          orderNumber: data.orderNumber,
          email: degerler.email,
          itemsTotalMinor: data.itemsTotalMinor,
          shippingTotalMinor: data.shippingTotalMinor,
          discountMinor: data.discountMinor,
          grandTotalMinor: data.grandTotalMinor,
          reservationExpiresAt: data.reservationExpiresAt,
          installment: taksit,
        };

        // ⚠️ SIRA ÖNEMLİ: önce sunucuya not et, sonra ekranı ilerlet. Ters
        //    sırada, kayıt yazılmadan sayfayı yenileyen kullanıcı adres
        //    formuna döner ve İKİNCİ bir sipariş açar.
        await odemeyiKaydet(siparis).catch((sebep: unknown) => {
          // Sipariş ZATEN OLUŞTU; kaydı yazamamak ödemeyi durdurmaz.
          console.error('[odeme] bekleyen sipariş kaydedilemedi', sebep);
        });

        setAdim({ ad: 'odeme', siparis });
      } catch (error) {
        if (!isApiFailure(error)) throw error;
        setHata(error);
      } finally {
        ucusta.current = false;
        setCalisiyor(false);
      }
    },
    // ⚠️ `taksit` bağımlılıkta: `init` sonrası yazılan kayıt onu taşıyor ve
    //    bayat bir kapanış, ödeme gövdesiyle uyuşmayan bir kayıt yazardı.
    [taksit],
  );

  const ode = React.useCallback(
    async (siparis: BekleyenOdeme): Promise<void> => {
      if (ucusta.current) return;
      ucusta.current = true;
      setCalisiyor(true);
      setHata(null);

      try {
        /**
         * ⚠️ ANAHTAR SUNUCUDA TÜRETİLİR, burada üretilmez.
         *    `newIdempotencyKey()` her çağrıda yeni bir UUID verir; sayfa
         *    yenilendiğinde ref de öldüğü için ikinci bir ödeme oturumu açılır.
         *    Türetilmiş anahtar aynı sipariş için HER ZAMAN aynıdır
         *    (`eylemler.ts` → `odemeAnahtari`).
         */
        const idempotencyKey = await odemeAnahtari(siparis.orderId, taksit);

        /**
         * ⚠️ SIRA: gövdeyi göndermeden ÖNCE taksiti kayda yaz. Ters sırada,
         *    3DS ekranındayken sayfayı yenileyen kullanıcı taksiti kaybeder,
         *    gövde değişir ve aynı anahtar `IDEMPOTENCY_CONFLICT` alır.
         *    Kayıt yazılamazsa akış DURMAZ — `baslat`taki gerekçenin aynısı.
         */
        await odemeyiKaydet({ ...siparis, installment: taksit }).catch((sebep: unknown) => {
          console.error('[odeme] taksit kaydedilemedi', sebep);
        });

        const { data } = await apiFetch<CheckoutPayResultWire, '/checkout/pay'>('/checkout/pay', {
          method: 'POST',
          idempotencyKey,
          json: {
            orderId: siparis.orderId,
            installment: taksit,
            // ⚠️ Misafir siparişinde sipariş sahipliğinin kanıtı. Üye
            //    isteğinde sunucu zaten `order.userId`ye bakıyor ve bu alanı
            //    yok sayıyor; göndermek zararsız, göndermemek misafiri kırar.
            email: siparis.email,
          },
        });

        setAdim({ ad: 'ucds', siparis, html: data.threeDsHtml });
      } catch (error) {
        if (!isApiFailure(error)) throw error;
        setHata(error);
        // Rezervasyon düştüyse kayıt artık bir işe yaramaz: sipariş
        // ödenemez durumda ve kullanıcı sepetten yeniden başlamalı.
        if (error.code === 'ORDER_RESERVATION_EXPIRED') {
          setRezervasyonDoldu(true);
          await odemeyiTemizle().catch(() => undefined);
        }
      } finally {
        ucusta.current = false;
        setCalisiyor(false);
      }
    },
    [taksit],
  );

  const sureDoldu = React.useCallback(() => setRezervasyonDoldu(true), []);

  if (adim.ad === 'ucds') {
    return <UcDs html={adim.html} orderNumber={adim.siparis.orderNumber} />;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-start">
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold tracking-tight">Ödeme</h1>

        {adim.ad === 'odeme' ? (
          <RezervasyonSayaci bitis={adim.siparis.reservationExpiresAt} onDoldu={sureDoldu} />
        ) : null}

        {/*
          ⚠️ CART_PRICE_CHANGED bir HATA EKRANI DEĞİL, bir ONAY sorusudur.
             Sunucu isteği reddediyor ve `acceptPriceChange: true` ile
             tekrarlanmasını bekliyor. Genel hata kutusuna düşseydi kullanıcı
             "tekrar dene" diyerek aynı reddi sonsuza kadar alırdı.
        */}
        {hata?.code === 'CART_PRICE_CHANGED' ? (
          <FiyatOnayi
            mesaj={hata.userMessage}
            calisiyor={calisiyor}
            onOnayla={() => {
              const degerler = sonDegerler.current;
              if (degerler) void baslat(degerler, true);
            }}
          />
        ) : hata ? (
          <HataGosterimi error={hata} />
        ) : null}

        {adim.ad === 'adres' ? (
          <AdresFormu
            hata={hata}
            calisiyor={calisiyor}
            onGonder={(degerler) => {
              sonDegerler.current = degerler;
              void baslat(degerler, false);
            }}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Ödeme</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-metin-soluk">
                Sipariş numaranız{' '}
                <span className="rakam font-medium text-metin">{adim.siparis.orderNumber}</span>.
                Kart bilgileriniz bizim sunucumuzdan geçmez; doğrudan bankanızın 3D Secure ekranına
                girilir.
              </p>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="taksit" className="text-sm font-medium">
                  Taksit
                </label>
                <select
                  id="taksit"
                  value={taksit}
                  onChange={(olay) => setTaksit(Number(olay.target.value))}
                  className="h-10 w-full rounded-md border border-kenar bg-zemin px-3 text-sm"
                >
                  {/* ⚠️ Sunucu 1–12 kabul ediyor ama HANGİ taksitin gerçekten
                      mümkün olduğu karta (BIN) bağlı ve bunu soracak bir uç
                      YOK. Seçilen taksiti banka reddedebilir; o durumda
                      katalog mesajı gösterilir. */}
                  {[1, 3, 6, 9, 12].map((adet) => (
                    <option key={adet} value={adet}>
                      {adet === 1 ? 'Tek çekim' : `${adet} taksit`}
                    </option>
                  ))}
                </select>
              </div>

              {rezervasyonDoldu ? (
                <Button asChild variant="ikincil" size="lg">
                  <Link href="/cart">Sepete dön</Link>
                </Button>
              ) : (
                <Button size="lg" disabled={calisiyor} onClick={() => void ode(adim.siparis)}>
                  {calisiyor ? 'Bankaya bağlanılıyor…' : 'Ödemeyi tamamla'}
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <aside className="lg:sticky lg:top-6">
        <SiparisOzeti sepet={sepet} siparis={adim.ad === 'odeme' ? adim.siparis : null} />
      </aside>
    </div>
  );
}

/**
 * FİYAT DEĞİŞİMİ ONAYI.
 *
 * ⚠️ Modül düzeyinde tanımlı, `OdemeAkisi`'nin İÇİNDE değil. İçeride
 *    tanımlansaydı her render'da YENİ bir bileşen tipi doğar, React onu farklı
 *    bir bileşen sayıp ağacı söker ve yeniden kurardı; formun odağı her tuşta
 *    kaybolurdu.
 */
function FiyatOnayi({
  mesaj,
  calisiyor,
  onOnayla,
}: {
  mesaj: string;
  calisiyor: boolean;
  onOnayla: () => void;
}): React.ReactElement {
  return (
    <div role="alert" className="rounded-md border border-kenar bg-uyari-zemin p-4 text-sm">
      {/* ⚠️ Sunucunun Türkçe mesajı OLDUĞU GİBİ; hangi ürünün ne kadar
          değiştiğini o cümle söylüyor. */}
      <p className="text-metin">{mesaj}</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={calisiyor} onClick={onOnayla}>
          Yeni tutarı onaylıyorum
        </Button>
        <Button asChild variant="ikincil" size="sm">
          <Link href="/cart">Sepete dön</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * ⚠️ Boş isteğe bağlı alanlar GÖNDERİLMEZ. Zod şemasında `postalCode` ve
 *    `neighbourhood` `optional()`; boş string göndermek `.regex(/^\d{5}$/)`
 *    kuralına takılır ve kullanıcı doldurmadığı bir alandan hata alır.
 */
function temizAdres(degerler: OdemeFormDegerleri): Record<string, string> {
  const { adres } = degerler;
  const cikti: Record<string, string> = {
    title: adres.title,
    firstName: adres.firstName,
    lastName: adres.lastName,
    phone: adres.phone,
    city: adres.city,
    district: adres.district,
    line1: adres.line1,
  };
  if (adres.neighbourhood.trim()) cikti.neighbourhood = adres.neighbourhood.trim();
  if (adres.postalCode.trim()) cikti.postalCode = adres.postalCode.trim();
  return cikti;
}
