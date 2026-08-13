'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { LOCALES, type Locale } from '@vt/contracts';
import { cn } from '@/lib/utils';
import { dilDegistir, LOCALE_CEREZI, LOCALE_CEREZ_OMRU_SN } from '@/i18n/muzakere';

/**
 * DİL DEĞİŞTİRİCİ.
 *
 * ⚠️ BUGÜN MENÜYE KONMUYOR ve bu bir eksik değil, plandaki bir KARAR. Arayüzün
 *    yalnız kabuğu ve durum tabloları çevrildi; JSX'e gömülü metinlerin büyük
 *    kısmı hâlâ Türkçe. Yarım çevrilmiş bir dili kullanıcıya açmak, bu deponun
 *    "derleniyor = çalışıyor" hatasının dil eksenindeki hâli olurdu. Bileşen
 *    HAZIR ve TEST EDİLEBİLİR duruyor; menüye eklenmesi kapsam sayacı sıfıra
 *    indiğinde (bkz. `docs/i18n.md`).
 *
 * ⚠️ `<select>` DEĞİL, iki `<button>`. İki seçenek için açılır liste, tek
 *    tıklamayla yapılabilecek bir şeyi iki tıklamaya çıkarır; ayrıca
 *    `<select>`in yerel görünümü koyu temada işletim sistemine bırakılır ve
 *    akromatik palet dışına çıkar.
 *
 * ⚠️ RENK YOK. `design-system.md`: renk yalnızca DURUM taşır. Seçili dil
 *    ZEMİN TONUYLA ayrılır (`bg-yuzey-vurgulu`), vurgu rengiyle değil — dil bir
 *    durum değildir.
 */
export interface DilDegistiriciProps {
  className?: string;
}

export function DilDegistirici({ className }: DilDegistiriciProps): React.ReactElement {
  const t = useTranslations('dil');
  const aktif = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();

  const sec = React.useCallback(
    (hedef: Locale) => {
      if (hedef === aktif) return;

      /**
       * ⚠️ ÇEREZ ÖNCE, GEZİNME SONRA — ve sıra önemli. Çerez yazılmadan
       *    gezinilirse `proxy.ts` sonraki isteklerde hâlâ eski tercihi okur;
       *    kullanıcı `/en/...` adresinde gezinirken `/` köküne döndüğü an
       *    Türkçeye düşer ve seçim "kalıcı olmamış" gibi görünür.
       *
       * ⚠️ `localStorage`a KOPYALANMAZ. Tek kaynak kuralı: iki kopyanın
       *    ayrışması bu depoda teorik değil, ölçülmüş bir olay. Ayrıca tercihi
       *    sunucunun okuması gerekiyor — `localStorage` sunucudan görünmez.
       *
       * ⚠️ `httpOnly` OLAMAZ ve bu sakıncasız: dil bir sır değil, ve Sunucu
       *    Bileşeninden çerez YAZILAMAZ (`lib/session/cookies.ts` başlığı).
       *    `SameSite=Lax` yeterli — çerez bir yetki taşımıyor.
       */
      document.cookie = [
        `${LOCALE_CEREZI}=${hedef}`,
        'path=/',
        `max-age=${LOCALE_CEREZ_OMRU_SN}`,
        'SameSite=Lax',
      ].join('; ');

      /**
       * ⚠️ `router.push` DEĞİL `router.replace`: dil değiştirmek bir GEZİNME
       *    değil, aynı sayfanın başka bir gösterimi. `push` olsaydı geri tuşu
       *    kullanıcıyı az önce reddettiği dile geri atardı ve iki dil arasında
       *    bir geçmiş yığını birikirdi.
       */
      router.replace(dilDegistir(pathname, hedef));

      // Sunucu Bileşenleri yeni dille yeniden çizilsin; yalnız URL değişimi
      // önbellekteki RSC yükünü tazelemeyebilir.
      router.refresh();
    },
    [aktif, pathname, router],
  );

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-sm border border-kenar p-0.5',
        className,
      )}
      role="group"
      aria-label={t('degistir')}
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => sec(locale)}
          aria-current={locale === aktif ? 'true' : undefined}
          /**
           * ⚠️ `lang` ÖZNİTELİĞİ ZORUNLU: düğmenin metni ("Türkçe") sayfanın
           *    dilinden FARKLI. Verilmezse ekran okuyucu İngilizce arayüzde
           *    "Türkçe"yi İngilizce sesletir ve okunmaz hâle getirir.
           */
          lang={locale}
          className={cn(
            'rounded-sm px-2 py-1 text-sm transition-colors',
            locale === aktif
              ? 'bg-yuzey-vurgulu text-metin'
              : 'text-metin-soluk hover:bg-yuzey hover:text-metin',
          )}
        >
          {t(locale)}
        </button>
      ))}
    </div>
  );
}
