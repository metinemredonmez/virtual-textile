/**
 * DESTEKLENEN DİLLER — TEK LİSTE.
 *
 * Bu dosya `packages/contracts` içinde çünkü dil listesini BEŞ paket birden
 * okuyor: `apps/web` (rota öneki + sözlük), `apps/api` (hata metni yedeği),
 * `apps/worker` (bildirim şablonu seçimi), `packages/adapters` (şablon kaydı)
 * ve `packages/db` (`User.locale` sütununun kabul ettiği değerler). İkinci bir
 * listede tutulsaydı, bir dil eklendiği gün dördü güncellenir biri unutulurdu
 * ve unutulan yerde dil sessizce Türkçeye düşerdi.
 *
 * ⚠️ `Locale` bir DİL kodudur, bir BÖLGE değil. Para birimi buna BAĞLI DEĞİL:
 *    dil İngilizce olsa da tutar TRY kalır (bkz. `money.ts` → `formatMoney`).
 *    İkisini birbirine bağlamak, dili değiştiren kullanıcıya farklı bir fiyat
 *    göstermek olurdu.
 */
export const LOCALES = ['tr', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * ⚠️ Varsayılan TÜRKÇE ve bu bir tercih değil, bir GÜVENLİK AĞI: bilinmeyen
 *    bir dil koduyla gelen istek boş ekran değil, bugünkü davranışı görür.
 */
export const VARSAYILAN_LOCALE: Locale = 'tr';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Bilinmeyen/eksik değeri varsayılana indirger. Fırlatmaz — çağıran her yerde `??` yazmasın. */
export function localeCoz(value: unknown): Locale {
  return isLocale(value) ? value : VARSAYILAN_LOCALE;
}

/**
 * `Locale` → `Intl` etiketi. TARİH, SAYI ve PARA biçimi BURADAN okunur.
 *
 * ⚠️ `en` için `en-GB` seçildi, `en-US` DEĞİL — ve gerekçe ölçülebilir:
 *    `en-GB` tarihi "12 August 2026" yazar, `en-US` "August 12, 2026". Türkçe
 *    biçim ("12 Ağustos 2026") gün-ay-yıl olduğu için `en-GB` aynı sütunda aynı
 *    genişlikte durur; sipariş tablolarında iki dil arasında geçiş yapan bir
 *    yönetici sütun kaymasıyla karşılaşmaz. Para tarafında ikisi de aynı çıktıyı
 *    verir ("TRY 1,290.00"), yani bu seçim bir para kararı DEĞİLDİR.
 *
 * ⚠️ Bu haritaya `en-CA` GİRMEZ. `lib/tarih.ts` içindeki `en-CA` bir DİL
 *    seçimi değil, `<input type="date">`in beklediği `YYYY-MM-DD`yi üreten tek
 *    yerleşik ayardır ve locale'e BAĞLANMAZ; bağlanırsa form alanı bozulur.
 */
export const INTL_ETIKET: Readonly<Record<Locale, string>> = {
  tr: 'tr-TR',
  en: 'en-GB',
};
