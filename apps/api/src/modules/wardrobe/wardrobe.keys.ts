/**
 * GARDIROP FOTOĞRAFI DEPOLAMA ANAHTARLARI
 *
 * ⚠️ ÖNEK `wardrobe/` PRIVATE KOVAYA AİTTİR.
 *
 * ✅ ENTEGRASYON KAPATILDI — ÜÇ KATMANLI KORUMA.
 *
 *    Önceki tur şunu bildirmişti: `visibilityForKey()` (adapters) bilinmeyen
 *    her öneki 'public' sayıyor ve `wardrobe/` listede yok; yani bu yolu
 *    kullanan bir çağrı kullanıcının dolabının fotoğrafını PUBLIC kovaya
 *    yazabilirdi. Bu tur kapatıldı:
 *
 *      1) `visibilityForKey()` artık `'wardrobe/'` önekini PRIVATE biliyor.
 *         Dolayısıyla `publicUrl('wardrobe/…')` çağrısı FIRLATIR
 *         (bkz. r2.provider.ts → publicUrl).
 *      2) `KNOWN_KEY_PREFIXES` (r2.config.ts) da `'wardrobe/'` taşıyor, yani
 *         `put({ key: 'wardrobe/…', visibility: 'public' })` "kova karışması"
 *         hatasıyla reddedilir.
 *      3) Bu modülün portu `visibilityForKey()`i zaten HİÇ ÇAĞIRMAZ ve
 *         `publicUrl()` YAYIMLAMAZ; yalnızca private kovaya bakar
 *         (bkz. wardrobe.ports.ts → WardrobePhotoStoragePort ve
 *         wardrobe.gateway.ts → WardrobePhotoStorage.assertWardrobeKey).
 *
 *    Üçü de gereklidir: 3. katman bu modülü korur, 1. ve 2. katman ilerideki
 *    BAŞKA bir çağıranı korur.
 */

export const WARDROBE_KEY_PREFIX = 'wardrobe/';

export const wardrobeKeys = {
  /**
   * ⚠️ private kova.
   *
   * Anahtar `userId` İÇERİR ve OTURUMDAN üretilir; istemciden gelen bir
   * anahtar ASLA kullanılmaz. `user-photos/` ile aynı gerekçe: böylece
   * "başkasının fotoğrafını oku/sil" saldırısında istemcinin çevirebileceği
   * bir alan kalmaz — yanlış kimlik var olmayan bir anahtara işaret eder.
   */
  photo: (userId: string, itemId: string): string => `${WARDROBE_KEY_PREFIX}${userId}/${itemId}`,
} as const;

/** Bir anahtarın gardırop fotoğrafı olup olmadığı — silme akışları için. */
export function isWardrobeKey(key: string): boolean {
  return key.startsWith(WARDROBE_KEY_PREFIX);
}

/**
 * Anahtarın sahibi bu kullanıcı mı?
 *
 * Silme ve imzalama akışlarında SON savunma. Depo anahtarı her zaman
 * sunucuda üretilse de, bir gün bir yol istemciden anahtar almaya başlarsa
 * bu kontrol yanlış sahibi yakalar.
 */
export function isOwnWardrobeKey(key: string, userId: string): boolean {
  return key.startsWith(`${WARDROBE_KEY_PREFIX}${userId}/`);
}
