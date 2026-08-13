import type { Locale } from '@vt/contracts';
import type { tr } from './sozluk/tr';

/**
 * next-intl TİP TÜRETİMİ — AÇIKÇA YAPILANDIRILMAK ZORUNDA.
 *
 * ⚠️ BU DOSYA OLMADAN KORUMANIN TAMAMI KAYBOLUR, ve kaybı sessizdir.
 *    `AppConfig` boş bırakılırsa next-intl'in kendi tanımları gereği:
 *      `Messages` → `Record<string, any>`  ve  `Locale` → `string`.
 *    Yani `t('kesinlikle.olmayan.anahtar')` DERLENİR, `tsc --noEmit` TEMİZ
 *    geçer, `next build` temiz geçer ve kullanıcı ekranda ham anahtar görür.
 *    Bu, `typedRoutes`un ölü bağlantı için yaptığının çeviri eksenindeki
 *    aynısıdır: var sanılan ama olmayan bir kapı.
 *
 * ⚠️ Doğrulaması kolay: `Messages` satırını yoruma alıp `t('yok.boyle')` yazın;
 *    tip kontrolü geçmeye başlarsa koruma kapanmış demektir.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    /**
     * ⚠️ `Sozluk` (yapısal tip) DEĞİL, `typeof tr` (literal tip). next-intl
     *    `t()` ÇAĞRISININ ARGÜMANLARINI mesajın literal metnini tip düzeyinde
     *    ayrıştırarak çıkarıyor. Değerler `string`e genişletilseydi anahtar
     *    denetimi kalır ama argüman denetimi kaybolurdu:
     *    `t('hata.geriSayim')` — `{dakika}` verilmeden — derlenir ve kullanıcı
     *    ham yer tutucu görür. `Sozluk` yalnızca `en.ts`in `satisfies`i için.
     */
    Messages: typeof tr;
  }
}
