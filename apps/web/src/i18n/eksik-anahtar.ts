import { IntlErrorCode, type IntlError } from 'next-intl';

/**
 * ÇEVİRİ BOŞLUĞUNUN ÜÇÜNCÜ KAPISI — ÇALIŞMA ZAMANI.
 *
 * İlk iki kapı derleme ve testtir:
 *   1. `en.ts` `satisfies Sozluk` → eksik/fazla ANAHTAR derlemeyi kırar.
 *   2. `sozluk.test.ts` → yer tutucu farkı ve çevrilmemiş kopya.
 *
 * ⚠️ İKİSİ DE YETMEZ ve neden yetmediği somut: `t('urun.sepeteEkle')` yerine
 *    `t('urun.sepeteEkl')` yazarsan tip kontrolü YAKALAR — ama `t(degisken)`
 *    biçiminde dinamik anahtar kullanan bir çağrı, ya da sunucudan gelen bir
 *    durum kodunu anahtar yapan bir tablo, tipin göremediği yollardır.
 *    Orada eksik anahtar ekrana ham metin olarak düşer ve 200 döner.
 *
 * ⚠️ GELİŞTİRMEDE FIRLATIR, ÜRETİMDE FIRLATMAZ. Bu ayrım bilinçli:
 *      - Geliştirme/test: eksik anahtar DERHAL görünür olmalı. Konsola bir
 *        satır daha eklemek yetmez — bu depoda konsol uyarıları defalarca
 *        gözden kaçtı ("kimse fark etmedi" deseni).
 *      - Üretim: bir çeviri eksiği yüzünden sayfayı düşürmek, arızayı
 *        büyütmektir. Kullanıcı ham anahtarlı ama ÇALIŞAN bir sayfa görsün.
 */
export function eksikAnahtarKapisi(error: IntlError): void {
  const eksik =
    error.code === IntlErrorCode.MISSING_MESSAGE || error.code === IntlErrorCode.INSUFFICIENT_PATH;

  if (eksik && process.env.NODE_ENV !== 'production') {
    throw new Error(
      `[i18n] Çeviri anahtarı eksik: ${error.message}\n` +
        'Sözlüğe (src/i18n/sozluk/tr.ts ve en.ts) ekleyin. ' +
        'Bu hata ÜRETİMDE fırlatılmaz; orada ham anahtar basılır.',
    );
  }

  console.error('[i18n]', error.code, error.message);
}
