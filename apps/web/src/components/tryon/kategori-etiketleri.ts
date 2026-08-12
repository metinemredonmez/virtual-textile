import type { TryOnCategoryName } from '@vt/config/constants';

/**
 * SANAL DENEME KATEGORİSİ → TÜRKÇE ETİKET. TEK TABLO.
 *
 * ⚠️ BU DEPODA ÜÇ KOPYASI VARDI ve üçü de aynı sekiz anahtarı çeviriyordu:
 *      `(magaza)/hesaplayici/page.tsx`        (küçük harf, cümle içi)
 *      `(magaza)/hesabim/_lib/etiketler.ts`   (`GARDIROP_KATEGORISI`)
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
export const TRYON_KATEGORI_ETIKETI: Record<TryOnCategoryName, string> = {
  UPPER_BODY: 'Üst giyim',
  LOWER_BODY: 'Alt giyim',
  DRESS: 'Elbise',
  OUTERWEAR: 'Dış giyim',
  SHOES: 'Ayakkabı',
  JEWELRY: 'Takı',
  BAG: 'Çanta',
  ACCESSORY: 'Aksesuar',
};

/**
 * Cümle içinde kullanılacak hâli: "bugün üst giyim, alt giyim ve elbise
 * destekleniyor".
 *
 * ⚠️ `toLocaleLowerCase('tr')` — ARGÜMAN ZORUNLU. Argümansız `toLowerCase()`
 *    çalışma zamanının yereline bakar ve Türkçe'de `I`/`İ` çiftini yanlış
 *    çevirir ("İç giyim" → "i̇ç giyim"). Bugünkü sekiz etikette o harf yok ama
 *    dokuzuncusu eklendiğinde hata sessiz olurdu.
 *
 * ⚠️ İkinci bir küçük harfli TABLO yazılmaz. Tabloyu ikiye bölmek, tam olarak
 *    bu dosyanın kapattığı kopya problemini geri getirirdi.
 */
export function kategoriCumlesi(kategoriler: readonly TryOnCategoryName[]): string {
  return kategoriler.map((k) => TRYON_KATEGORI_ETIKETI[k].toLocaleLowerCase('tr')).join(', ');
}
