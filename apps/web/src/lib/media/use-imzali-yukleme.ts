'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { MEDIA } from '@vt/config/constants';
import type { UploadTicketWire } from '@vt/contracts';
import { newIdempotencyKey } from '@/lib/api/client';

/**
 * İMZALI ÜÇ ADIMLI YÜKLEME — ADIM YÖNETİMİ, TEK YER.
 *
 *   1. bilet     → `POST <uç>`            (vekilden, imzalı adres döner)
 *   2. PUT       → `PUT <uploadUrl>`      (DOĞRUDAN R2, vekilden GEÇMEZ)
 *   3. onay      → `POST <uç>/confirm`    (vekilden, satır + türevler)
 *
 * ⚠️ 2. ADIM VEKİLE ALINAMAZ: 10 MB'a kadar her dosya Next sürecinin belleğine
 *    tamponlanırdı (`proxy.ts` gövdeyi 401 tekrarı için tampona alıyor). Aynı
 *    gerekçe `wire/media.ts` başlığında da yazılı.
 *
 * ⚠️ `GorselYukleme` BİLEŞENİ GENELLEŞTİRİLMEDİ, YALNIZ AKIŞ ÇIKARILDI. O
 *    bileşen prop olarak yalnız `productId` alıyor; ürün uçları, açı listesi,
 *    birincil/sıra alanları ve `tryOnScore` gösterimi içinde SABİT. Onu
 *    genelleştirmek üç çalışan çağıranı birden refactor etmek demekti. Burada
 *    paylaşılan şey ADIMLAR; uç yolları ve gövdeler ÇAĞIRANDA kalıyor.
 *
 * ⚠️ UÇ YOLU PARAMETRE DEĞİL, GERİ ÇAĞRI. Yol dizgisi parametre olsaydı
 *    `apiFetch`in tip kapısı KAYBOLURDU: `IdempotentPath` listesindeki bir yola
 *    anahtarsız istek atmayı DERLEME zamanında engelleyen şey, çağrının somut
 *    yol tipiyle yapılması. Kanca yalnızca anahtarı üretip veriyor.
 */

/** Adım adı ekranda düğme metnini seçiyor; `bekliyor` = boşta. */
export type YuklemeAdimi = 'bekliyor' | 'bilet' | 'yukleme' | 'onay';

export interface ImzaliYuklemeSecenekleri<TOnay> {
  /** 1. adım — imzalı bilet. `@Idempotent` DEĞİL, anahtar geçilmez. */
  bileti: (dosya: File) => Promise<UploadTicketWire>;
  /** 3. adım — onay. Anahtar kanca tarafından üretilir ve tekrarlarda KORUNUR. */
  onayla: (uploadId: string, idempotencyKey: string) => Promise<TOnay>;
}

export interface ImzaliYukleme<TOnay> {
  adim: YuklemeAdimi;
  calisiyor: boolean;
  /** Zarf hatası ya da ham `Error` — `HataGosterimi`ye olduğu gibi verilir. */
  hata: unknown;
  /** İstek hiç gitmeden, istemcide yakalanan kural ihlali. */
  yerelHata: string | null;
  sonuc: TOnay | null;
  calistir: (dosya: File | null) => Promise<void>;
  temizle: () => void;
}

export function useImzaliYukleme<TOnay>(
  secenekler: ImzaliYuklemeSecenekleri<TOnay>,
): ImzaliYukleme<TOnay> {
  /**
   * ⚠️ METİNLER SÖZLÜKTEN, `ERROR_CATALOG`TAN DEĞİL — ve bu kataloğu delen bir
   *    istisna değil. Kataloğun anahtarı `ErrorCode`tur; buradaki üç durum
   *    SUNUCUYA HİÇ ULAŞMIYOR (ikisi istek atılmadan istemcide yakalanıyor,
   *    üçüncüsü tarayıcının ön uçuşta düşürdüğü istek). Sunucunun haberi
   *    olmayan bir arızanın katalog kodu da olamaz.
   */
  const t = useTranslations('medyaYukleme');

  /**
   * ⚠️ ANAHTAR `useRef`TE VE KULLANICI NİYETİ BAŞINA BİR KEZ. Onay adımı satır
   *    yaratıp public kovaya nesne yazıyor; büyük bir yüklemenin ardından gelen
   *    ağ zaman aşımında tekrar denenirse anahtar AYNI kalmalı, yoksa aynı
   *    görsel iki kez eklenir. `useState` olsaydı render sırasında yeni anahtar
   *    üretilir ve "tekrar dene" ikinci bir kayıt yaratırdı.
   */
  const anahtar = React.useRef<string | null>(null);

  const [adim, setAdim] = React.useState<YuklemeAdimi>('bekliyor');
  const [hata, setHata] = React.useState<unknown>(null);
  const [yerelHata, setYerelHata] = React.useState<string | null>(null);
  const [sonuc, setSonuc] = React.useState<TOnay | null>(null);

  function temizle(): void {
    setHata(null);
    setYerelHata(null);
    setSonuc(null);
  }

  /**
   * ⚠️ `useCallback` YOK VE GERİ ÇAĞRILAR REF'TE TUTULMUYOR. İlk yazımda
   *    `secenekler` bir ref'e kopyalanıyordu ki `calistir` kimliği sabit
   *    kalsın; `react-hooks/refs` bunu HATA olarak işaretledi ve haklı: render
   *    sırasında ref yazmak, eşzamanlı render'da sessizce yanlış değeri okumak
   *    demek. Kimlik sabitliğine ihtiyaç da yok — `calistir` yalnız
   *    `onSubmit`ten çağrılıyor, bir bağımlılık dizisine girmiyor.
   */
  async function calistir(dosya: File | null): Promise<void> {
    setHata(null);
    setYerelHata(null);
    setSonuc(null);

    if (!dosya) {
      setYerelHata(t('dosyaSecin'));
      return;
    }

    /*
      ⚠️ İSTEMCİ DENETİMİ SUNUCUYU DEĞİL KULLANICIYI KORUYOR: sunucu biçimi
         BAYTLARDAN okuyor (`detectImageFormat`) ve boyutu onay adımında yeniden
         ölçüyor. Buradaki amaç 9 MB'lık bir dosyayı yükledikten SONRA
         reddedilmemek. Sınırlar `@vt/config/constants`tan — ekrana rakam
         gömülmüyor.
    */
    if (!(MEDIA.allowedMimeTypes as readonly string[]).includes(dosya.type)) {
      setYerelHata(t('bicimGecersiz'));
      return;
    }
    if (dosya.size > MEDIA.maxUploadBytes) {
      setYerelHata(
        t('boyutAsildi', { mb: String(Math.floor(MEDIA.maxUploadBytes / (1024 * 1024))) }),
      );
      return;
    }

    anahtar.current ??= newIdempotencyKey();

    try {
      setAdim('bilet');
      const bilet = await secenekler.bileti(dosya);

      setAdim('yukleme');
      let yanit: Response;
      try {
        /**
         * ⚠️ `requiredContentType` AYNEN gönderiliyor: istemcinin beyanı imzaya
         *    gömülü, farklı bir tip depoda reddedilir.
         * ⚠️ `apiFetch` KULLANILMIYOR — bu adres bizim kökenimiz değil, R2.
         *    Zarf yok, `credentials` yok; ham `fetch`.
         */
        yanit = await fetch(bilet.uploadUrl, {
          method: 'PUT',
          headers: { 'content-type': bilet.requiredContentType },
          body: dosya,
        });
      } catch {
        // ⚠️ `fetch` CORS'ta ve ağ kopmasında AYNI şeyi fırlatıyor: gövdesiz
        //    `TypeError`. Ayırt edilemediği için metin ikisini de söylüyor.
        throw new Error(t('depoEngellendi'));
      }
      if (!yanit.ok) {
        // ⚠️ Durum kodu `String()` ile: sayı geçilseydi next-intl onu
        //    `Intl.NumberFormat` ile biçimlerdi.
        throw new Error(t('depoHatasi', { durum: String(yanit.status) }));
      }

      setAdim('onay');
      const onay = await secenekler.onayla(bilet.uploadId, anahtar.current);

      setSonuc(onay);
      // Sıradaki dosya YENİ bir niyettir; anahtar başarıdan sonra düşer.
      anahtar.current = null;
    } catch (istekHatasi) {
      /**
       * ⚠️ PUT adımının hatası ZARF DEĞİLDİR. `HataGosterimi` bunu "bilinmeyen
       *    hata" dalında gösterir ve "Tekrar dene" düğmesi çıkar — onay adımı
       *    için doğru davranış (aynı anahtarla tekrarlanabilir bir iş).
       */
      setHata(istekHatasi);
    } finally {
      setAdim('bekliyor');
    }
  }

  return {
    adim,
    calisiyor: adim !== 'bekliyor',
    hata,
    yerelHata,
    sonuc,
    calistir,
    temizle,
  };
}
