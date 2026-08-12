/**
 * URL SORGUSU — yönetim tablolarının TEK durum kaynağı.
 *
 * ⚠️ Filtre, arama ve imleç URL'de tutulur; `useState`te değil. Gerekçe vitrin
 *    listesindekiyle aynı ve burada daha da güçlü: yönetici bir kuyruk
 *    görünümünü ("askıdaki satıcılar") meslektaşına yapıştırabilmeli ve F5'e
 *    bastığında aynı ekranı görmeli. İstemci durumunda tutulsaydı ikisi de
 *    kaybolurdu.
 */

export type AramaParametreleri = Record<string, string | string[] | undefined>;

/**
 * ⚠️ `searchParams` AYNI ANAHTARI DİZİ OLARAK verebilir (`?durum=A&durum=B`).
 *    Doğrudan `params.durum` okumak o durumda `string[]` döndürür ve API'ye
 *    dizi gitmesi 400 üretirdi. İlk değer alınır — çoklu seçim desteklenmiyor.
 */
export function tekil(deger: string | string[] | undefined): string | null {
  if (Array.isArray(deger)) return deger[0]?.trim() || null;
  const kirpilmis = deger?.trim();
  return kirpilmis ? kirpilmis : null;
}

/**
 * Yol + sorgu dizesi. `null` değerler YAZILMAZ: varsayılan görünümün tek bir
 * adresi olsun ki paylaşılan bağlantılar birbirinin aynısı olsun.
 */
export function baglanti(yol: string, sorgu: Record<string, string | null>): string {
  const params = new URLSearchParams();
  for (const [anahtar, deger] of Object.entries(sorgu)) {
    if (deger !== null && deger !== '') params.set(anahtar, deger);
  }
  const qs = params.toString();
  return qs ? `${yol}?${qs}` : yol;
}
