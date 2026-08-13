import { INTL_ETIKET, VARSAYILAN_LOCALE, type Locale } from '@vt/contracts';
import type { TryOnCategoryName } from '@vt/config/constants';
import { sozluk } from '@/i18n/sozluk';

/**
 * SANAL DENEME KATEGORİSİ → TÜRKÇE ETİKET. TEK TABLO.
 *
 * ⚠️ BU DEPODA ÜÇ KOPYASI VARDI ve üçü de aynı sekiz anahtarı çeviriyordu:
 *      `(magaza)/calculator/page.tsx`        (küçük harf, cümle içi)
 *      `(magaza)/account/_lib/etiketler.ts`   (`GARDIROP_KATEGORISI`)
 *      `(yonetim)/yonetim/kategoriler/_etiketler.ts`
 *    Üçü de bugün aynı metni yazıyordu; kopyanın bedeli metinler ayrıştığı gün
 *    ödenirdi — kullanıcı gardırobuna "Dış giyim" diye eklediği parçayı
 *    hesaplayıcıda başka bir adla görürdü. `AGENTS.md` §0: ikinci kopya bu
 *    depoda ÖLÇÜLMÜŞ bir arıza kaynağı.
 *
 * ⚠️ `Record<TryOnCategoryName, string>` — TAM kapsam ZORUNLU, `satisfies`
 *    değil açık tip annotasyonu. Sağlayıcı yetenek matrisine yeni bir kategori
 *    eklendiği gün eksik anahtar TAM BU SATIRDA derlemeyi kırsın diye.
 *
 * ⚠️ `WardrobeCategoryWire` ile `TryOnCategoryName` bugün AYNI sekiz değer ve
 *    gardırop ekranı bu tabloyu o tiple okuyor. Ayrıştıkları gün derleme
 *    kırılır — istenen davranış budur; sessizce `undefined` etiket basmaktansa.
 */
export function tryonKategoriEtiketi(
  locale: Locale = VARSAYILAN_LOCALE,
): Record<TryOnCategoryName, string> {
  return sozluk(locale).tryonKategori;
}

/**
 * Türkçe görünüm — İKİNCİ BİR TABLO DEĞİL, sözlükten türetilmiş.
 *
 * ⚠️ Onlarca çağrı yeri bu adı okuyor ve hepsi şu anda taşınmakta olan
 *    dosyalarda. Sabit duruyor ki bu turda tek satırları bile değişmesin;
 *    dile duyarlı çağrılar fonksiyonu kullanıyor ve ikisi AYNI sözlükten
 *    besleniyor — ayrışmaları imkânsız.
 */
export const TRYON_KATEGORI_ETIKETI: Record<TryOnCategoryName, string> = tryonKategoriEtiketi();

/**
 * Cümle içinde kullanılacak hâli: "bugün üst giyim, alt giyim ve elbise
 * destekleniyor".
 *
 * ⚠️ `toLocaleLowerCase` ARGÜMANI ZORUNLU ve artık DİLDEN geliyor. Argümansız
 *    `toLowerCase()` çalışma zamanının yereline bakar ve Türkçe'de `I`/`İ`
 *    çiftini yanlış çevirir ("İç giyim" → "i̇ç giyim"). Sabit `'tr'` yazmak da
 *    aynı hatanın tersi olurdu: İngilizce etiketler Türkçe kurallarıyla küçültülür
 *    ve bir gün "Item" → "ıtem" çıkardı. Harf küçültme her zaman METNİN dilinde
 *    yapılır, arayüzün değil — ve burada ikisi aynı.
 *
 * ⚠️ İkinci bir küçük harfli TABLO yazılmaz. Tabloyu ikiye bölmek, tam olarak
 *    bu dosyanın kapattığı kopya problemini geri getirirdi.
 */
export function kategoriCumlesi(
  kategoriler: readonly TryOnCategoryName[],
  locale: Locale = VARSAYILAN_LOCALE,
): string {
  const tablo = tryonKategoriEtiketi(locale);
  const ayrac = INTL_ETIKET[locale];
  return kategoriler.map((k) => tablo[k].toLocaleLowerCase(ayrac)).join(', ');
}
