import { icuBicimle, type IcuDeger } from '../i18n/icu.js';
import { VARSAYILAN_LOCALE, type Locale } from '../i18n/locale.js';
import { formatMoney, money } from '../money.js';
import { ERROR_MESSAGES } from './error-catalog.en.js';
import {
  getErrorDefinition,
  isErrorCode,
  type ErrorCode,
  type ErrorParamKind,
} from './error-catalog.js';

/**
 * HATA METNİNİ KURAN TEK FONKSİYON — sunucu da, tarayıcı da, worker da buradan geçer.
 *
 * "Mesajı frontend yeniden yazmaz" kuralının çok dilli hâli: metin hâlâ TEK
 * kaynaktan (`ERROR_CATALOG` + `ERROR_CATALOG_EN`) geliyor, yalnızca o kaynağın
 * artık iki dili var. Çağıran taraf KOD ve PARAMETRE verir, CÜMLE YAZMAZ.
 *
 * ⚠️ Bu fonksiyon `AppError` kurucusunun içine ALINMADI ve alınmamalı.
 *    `AppError.userMessage` `readonly` ve o alan sunucunun TEK dilli (Türkçe)
 *    log/telemetri metni; `api-failure.ts` başlığındaki yapısal koruma bunun
 *    üzerine kurulu. İnterpolasyon ayrı bir fonksiyonda kalırsa "doldurulmamış
 *    `{available}` ekrana çıkar" tuzağı yapısal olarak imkânsız kalmaya devam
 *    eder.
 */

export type ErrorParams = Readonly<Record<string, string | number>>;

export interface ErrorMessageSecenekleri {
  locale?: Locale;
  params?: ErrorParams;
}

/** Katalogdaki metni istenen dilde, parametreleri doldurulmuş olarak döndürür. */
export function errorMessage(code: ErrorCode, secenekler: ErrorMessageSecenekleri = {}): string {
  const locale = secenekler.locale ?? VARSAYILAN_LOCALE;
  const sablon = ERROR_MESSAGES[locale][code];
  return icuBicimle(sablon, degerleriHazirla(code, secenekler.params, locale), locale);
}

/**
 * TELDEN GELEN HATAYI METNE ÇEVİRİR — sürüm sapmasını da ele alır.
 *
 * ⚠️ BİLİNMEYEN KOD SESSİZCE DÜŞMEZ, SUNUCUNUN METNİNE DÜŞER. API bu
 *    derlemenin bilmediği yeni bir kod döndürdüğünde katalogda karşılık yok;
 *    o an gösterilecek en doğru şey sunucunun gönderdiği hazır cümledir.
 *    Alternatif — boş kutu ya da ham kod — kullanıcıyı çıkışsız bırakırdı.
 *    Bedeli açıkça: o tek cümle sunucunun dilinde (Türkçe) görünür. Bunu
 *    kabul ediyoruz çünkü alternatifi "İngilizce arayüzde hiçbir şey yazmayan
 *    bir hata kutusu".
 */
export function wireErrorMessage(
  govde: { code: string; message?: string; params?: ErrorParams },
  locale: Locale = VARSAYILAN_LOCALE,
): string {
  if (isErrorCode(govde.code)) return errorMessage(govde.code, { locale, params: govde.params });
  return govde.message ?? errorMessage('INTERNAL_ERROR', { locale, params: govde.params });
}

/**
 * Ham parametreleri TÜRÜNE göre biçimlenmiş ICU değerlerine çevirir.
 *
 * ⚠️ TÜRÜ BİLDİRİLMEMİŞ parametre OLDUĞU GİBİ geçer, sessizce atılmaz.
 *    Atılsaydı cümlede yer tutucu görünür kalır ve arıza "eksik çeviri" gibi
 *    okunurdu; oysa sorun kataloğun `params` bildirimindedir.
 */
function degerleriHazirla(
  code: ErrorCode,
  params: ErrorParams | undefined,
  locale: Locale,
): Record<string, IcuDeger> | undefined {
  if (!params) return undefined;

  // ⚠️ `ERROR_CATALOG[code]` DEĞİL: `define()` her kaydı kendi dar literal
  //    tipine daraltıyor ve `params` taşımayan kayıtlarda alan HİÇ yok, yani
  //    birleşim üzerinde okunamıyor. `getErrorDefinition` arayüz tipini döner.
  const turler: Readonly<Record<string, ErrorParamKind>> = getErrorDefinition(code).params ?? {};
  const hazir: Record<string, IcuDeger> = {};

  for (const [ad, ham] of Object.entries(params)) {
    hazir[ad] = degerBicimle(turler[ad], ham, locale);
  }

  return hazir;
}

function degerBicimle(
  tur: ErrorParamKind | undefined,
  ham: string | number,
  locale: Locale,
): IcuDeger {
  switch (tur) {
    case 'para':
      /**
       * ⚠️ `Number(ham)` YAZILMAZ — bu bir kuruş tutarı. Yol `money.ts`teki
       *    kuralın aynısı: dizgi → `BigInt` → biçim. `Number` üzerinden
       *    geçirmek 2^53 üstü tutarda SESSİZCE yanlış rakam üretir ve hata
       *    mesajı, yanlış rakamın en kolay fark edilmediği yerdir.
       */
      return formatMoney(money(BigInt(ham)), locale);

    case 'sayi': {
      /**
       * ⚠️ SAYISAL KALMAK ZORUNDA: `icuBicimle` çoğul kategorisini bu değerden
       *    seçiyor. Burada dizgeye çevrilseydi İngilizce metin her zaman
       *    `other` dalına düşer ve "1 units" yazardı.
       */
      const sayi = typeof ham === 'number' ? ham : Number(ham);
      return Number.isFinite(sayi) ? sayi : ham;
    }

    case 'metin':
      return String(ham);

    default:
      return ham;
  }
}
