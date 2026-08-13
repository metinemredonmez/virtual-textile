import type { Locale } from '@vt/contracts';
import { en } from './en';
import { tr, type Sozluk } from './tr';

export type { Sozluk };

/**
 * MESAJ TİPİ — next-intl'in `t()` argümanlarını çıkardığı tip.
 *
 * ⚠️ NEDEN `typeof tr`, NEDEN `Sozluk` DEĞİL: next-intl mesajın LİTERAL
 *    metnini tip düzeyinde ayrıştırıp `t()` çağrısının argümanlarını buradan
 *    çıkarıyor. `Sozluk` değerleri `string`e açıyor; o tip verilseydi
 *    `t('hata.geriSayim')` — zorunlu `{dakika}` verilmeden — DERLENİR ve
 *    kullanıcı ham yer tutucu görürdü.
 */
export type Mesajlar = typeof tr;

/**
 * DİL → SÖZLÜK. Tek harita.
 *
 * ⚠️ `Record<Locale, Sozluk>` açık tip annotasyonu, `satisfies` DEĞİL:
 *    `@vt/contracts`ın `LOCALES` listesine yeni bir dil eklendiği gün eksik
 *    anahtar TAM BU SATIRDA derlemeyi kırsın diye. `satisfies` yazılsaydı
 *    eksik dil burada değil, ilk `SOZLUKLER[locale]` okumasında `undefined`
 *    olarak görünürdü — yani çalışma zamanında.
 */
export const SOZLUKLER: Record<Locale, Sozluk> = { tr, en };

/**
 * ⚠️ DİNAMİK `import()` KULLANILMIYOR ve bu ölçülebilir bir tercih:
 *    iki sözlüğün toplamı bugün ~6 KB (gzip öncesi) ve ikisi de aynı paketle
 *    iniyor. Dil başına parçalama, kabuk çizilirken bir Promise beklemek
 *    demektir; o bekleme `NextIntlClientProvider`ın önüne geçerse ilk karede
 *    metinsiz bir düzen görünür — temanın FOUC'unun metin eksenindeki hâli.
 *    Sözlük büyüdüğünde (JSX'e gömülü 1 061 metin taşındığında) bu karar
 *    yeniden ölçülür; `docs/i18n.md`de not düşüldü.
 */
export function sozluk(locale: Locale): Mesajlar {
  /**
   * ⚠️ DÖNÜŞ TİPİ BİR TİP-DÜZEYİ KURGU, VE GÜVENLİ OLMASININ SEBEBİ YAZILI:
   *    `en` gerçekten `typeof tr` DEĞİL (metinleri farklı literaller). Ama
   *    `en.ts` `satisfies Sozluk` taşıdığı için YAPISI birebir aynı, ve
   *    `sozluk.test.ts` yer tutucu kümelerinin de aynı olduğunu doğruluyor —
   *    yani `t()` argüman çıkarımının dayandığı iki şey (anahtar ağacı + yer
   *    tutucular) iki dilde de garanti.
   *
   * ⚠️ Bu dönüştürme KALDIRILIRSA argüman denetimi kaybolur; `Sozluk`
   *    döndüren bir imza her mesajı `string` yapar. Yani buradaki `as`,
   *    korumayı zayıflatan değil AYAKTA TUTAN satırdır.
   */
  return SOZLUKLER[locale] as Mesajlar;
}
