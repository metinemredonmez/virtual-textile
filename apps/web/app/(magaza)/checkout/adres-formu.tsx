'use client';

import * as React from 'react';
import { useLocale } from 'next-intl';
import type { ApiFailure, Locale } from '@vt/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fieldErrorMap } from '@/components/hata/alan-hatalari';

/**
 * TESLİMAT ADRESİ + İLETİŞİM.
 *
 * ⚠️ KAYITLI ADRES SEÇİCİ YOK ve bu bir eksik değil, ÖLÇÜLMÜŞ bir gerçek:
 *    API'de adres CRUD ucu HİÇ YOK. Denetleyici önekleri (`admin auth cart
 *    health logistics me me/photos orders outfits seller seller/products
 *    stylist wardrobe`) tarandı; `/me` altında yalnızca `consents`,
 *    `data-export` ve hesap silme var. `checkoutInitSchema` `addressId` kabul
 *    ediyor ama o kimliği kullanıcıya LİSTELEYECEK bir uç bulunmadığı için
 *    bugün kullanılamaz. Bu yüzden adres HER SEFERİNDE gövdede gönderiliyor
 *    (`{ address: {...} }`). Adres uçları açıldığında buraya seçici eklenir.
 *
 * ⚠️ MİSAFİR ÖDEMESİ DESTEKLİ: `checkout/init` `@Public()`. Kayıt zorunlu
 *    tutulmuyor, çünkü zorunluluk dönüşümü ölçülebilir biçimde düşürüyor
 *    (denetleyici yorumu). Form giriş yapmış kullanıcıdan da e-posta ister —
 *    access token e-posta taşımıyor ve sipariş bildirimi/fatura o adrese gidiyor.
 *
 * ⚠️ Alan hataları `fieldErrorMap` üzerinden GÖSTERİLEN DİLE çevrilir (bu yüzden
 *    `locale` geçilir, varsayılana bırakılmaz): `zodBody` pipe'ı
 *    Zod'un İngilizce varsayılanını ham geçirebiliyor ("Required"). Bu, "mesajı
 *    yeniden yazma" kuralının TEK istisnası ve gerekçesi
 *    `components/hata/alan-hatalari.ts` başında yazılı.
 */

export interface AdresDegerleri {
  title: string;
  firstName: string;
  lastName: string;
  phone: string;
  city: string;
  district: string;
  neighbourhood: string;
  line1: string;
  postalCode: string;
}

export interface OdemeFormDegerleri {
  email: string;
  adres: AdresDegerleri;
}

const BOS_ADRES: AdresDegerleri = {
  title: 'Ev',
  firstName: '',
  lastName: '',
  phone: '',
  city: '',
  district: '',
  neighbourhood: '',
  line1: '',
  postalCode: '',
};

export function AdresFormu({
  hata,
  calisiyor,
  onGonder,
}: {
  hata: ApiFailure | null;
  calisiyor: boolean;
  onGonder: (degerler: OdemeFormDegerleri) => void;
}): React.ReactElement {
  const locale = useLocale() as Locale;
  const [email, setEmail] = React.useState('');
  const [adres, setAdres] = React.useState<AdresDegerleri>(BOS_ADRES);

  /**
   * ⚠️ Sunucunun alan hataları `address.line1` gibi NOKTALI yollarla geliyor
   *    (gövde şekli `{ shipping: { address: {...} } }`). Eşleme yolun SON
   *    parçasına bakıyor: tam yolu beklemek, `shipping.address.line1` ile
   *    `billing.address.line1` arasındaki farkı ekrana taşımak demek olurdu ve
   *    formda tek adres var.
   */
  const alanHatalari = React.useMemo(
    () => (hata ? sonParcayaIndir(fieldErrorMap(hata.fields, locale)) : {}),
    [hata, locale],
  );

  const yaz = (alan: keyof AdresDegerleri) => (olay: React.ChangeEvent<HTMLInputElement>) =>
    setAdres((onceki) => ({ ...onceki, [alan]: olay.target.value }));

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(olay) => {
        olay.preventDefault();
        onGonder({ email, adres });
      }}
    >
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">İletişim</h2>
        <Alan
          id="email"
          etiket="E-posta"
          hata={alanHatalari.email}
          ipucu="Sipariş bildirimi, fatura ve kargo takibi bu adrese gider."
        >
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(olay) => setEmail(olay.target.value)}
            aria-invalid={alanHatalari.email !== undefined}
            autoComplete="email"
            required
          />
        </Alan>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Teslimat adresi</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <Alan id="firstName" etiket="Ad" hata={alanHatalari.firstName}>
            <Input
              id="firstName"
              value={adres.firstName}
              onChange={yaz('firstName')}
              aria-invalid={alanHatalari.firstName !== undefined}
              autoComplete="given-name"
              minLength={2}
              required
            />
          </Alan>
          <Alan id="lastName" etiket="Soyad" hata={alanHatalari.lastName}>
            <Input
              id="lastName"
              value={adres.lastName}
              onChange={yaz('lastName')}
              aria-invalid={alanHatalari.lastName !== undefined}
              autoComplete="family-name"
              minLength={2}
              required
            />
          </Alan>
        </div>

        <Alan
          id="phone"
          etiket="Cep telefonu"
          hata={alanHatalari.phone}
          ipucu="0555 111 22 33 ya da +90 555 111 22 33"
        >
          <Input
            id="phone"
            type="tel"
            value={adres.phone}
            onChange={yaz('phone')}
            aria-invalid={alanHatalari.phone !== undefined}
            autoComplete="tel"
            // ⚠️ `pattern` sunucudaki `phoneSchema` ile AYNI kabul aralığını
            //    tarifliyor (0/+90 önekli, 5 ile başlayan 10 hane). Daha darını
            //    yazmak sunucunun kabul ettiği bir numarayı formda reddetmek
            //    olurdu.
            required
          />
        </Alan>

        <div className="grid gap-3 sm:grid-cols-2">
          <Alan id="city" etiket="İl" hata={alanHatalari.city}>
            <Input
              id="city"
              value={adres.city}
              onChange={yaz('city')}
              aria-invalid={alanHatalari.city !== undefined}
              autoComplete="address-level1"
              minLength={2}
              required
            />
          </Alan>
          <Alan id="district" etiket="İlçe" hata={alanHatalari.district}>
            <Input
              id="district"
              value={adres.district}
              onChange={yaz('district')}
              aria-invalid={alanHatalari.district !== undefined}
              autoComplete="address-level2"
              minLength={2}
              required
            />
          </Alan>
        </div>

        <Alan id="neighbourhood" etiket="Mahalle (isteğe bağlı)" hata={alanHatalari.neighbourhood}>
          <Input
            id="neighbourhood"
            value={adres.neighbourhood}
            onChange={yaz('neighbourhood')}
            aria-invalid={alanHatalari.neighbourhood !== undefined}
            autoComplete="address-level3"
          />
        </Alan>

        <Alan
          id="line1"
          etiket="Adres"
          hata={alanHatalari.line1}
          ipucu="Cadde, sokak, bina ve daire numarası."
        >
          <Input
            id="line1"
            value={adres.line1}
            onChange={yaz('line1')}
            aria-invalid={alanHatalari.line1 !== undefined}
            autoComplete="street-address"
            minLength={10}
            required
          />
        </Alan>

        <div className="grid gap-3 sm:grid-cols-2">
          <Alan id="postalCode" etiket="Posta kodu (isteğe bağlı)" hata={alanHatalari.postalCode}>
            <Input
              id="postalCode"
              value={adres.postalCode}
              onChange={yaz('postalCode')}
              aria-invalid={alanHatalari.postalCode !== undefined}
              autoComplete="postal-code"
              inputMode="numeric"
              pattern="\d{5}"
            />
          </Alan>
          <Alan id="title" etiket="Adres başlığı" hata={alanHatalari.title}>
            <Input
              id="title"
              value={adres.title}
              onChange={yaz('title')}
              aria-invalid={alanHatalari.title !== undefined}
              minLength={2}
              required
            />
          </Alan>
        </div>
      </section>

      {/*
        ⚠️ TEK GÖNDERİM. `checkout/init` idempotent DEĞİL (ÖLÇÜLDÜ: iki çağrı,
           iki sipariş, iki rezervasyon). `calisiyor` bayrağı düğmeyi kapatan
           tek şey değil; asıl koruma akıştaki tek-uçuş kilidi
           (`odeme-akisi.tsx`), çünkü `disabled` klavye/otomasyon karşısında
           yeterli değil.
      */}
      <Button type="submit" size="lg" disabled={calisiyor}>
        {calisiyor ? 'Sipariş hazırlanıyor…' : 'Devam et'}
      </Button>
    </form>
  );
}

function Alan({
  id,
  etiket,
  hata,
  ipucu,
  children,
}: {
  id: string;
  etiket: string;
  hata?: string;
  ipucu?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{etiket}</Label>
      {children}
      {ipucu && !hata ? <p className="text-xs text-metin-soluk">{ipucu}</p> : null}
      {/* Renk burada DURUM taşıyor: alan gerçekten geçersiz. */}
      {hata ? <p className="text-xs text-tehlike">{hata}</p> : null}
    </div>
  );
}

/** `shipping.address.line1` → `line1` */
function sonParcayaIndir(kayit: Record<string, string>): Record<string, string> {
  const sonuc: Record<string, string> = {};
  for (const [yol, metin] of Object.entries(kayit)) {
    const son = yol.split('.').at(-1);
    if (son) sonuc[son] = metin;
  }
  return sonuc;
}
