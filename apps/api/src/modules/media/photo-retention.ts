import { PHOTO_RETENTION } from '@vt/config';
import type { PhotoPurpose } from '@vt/db';

/**
 * KULLANICI FOTOĞRAFI SAKLAMA SÜRESİ (KVKK)
 *
 * ⚠️ Kullanıcıya verilen söz burada koda dönüşür:
 *      "Yalnızca bu işlem için kullan" → 24 saat
 *      "Profilimde sakla"              → 90 gün
 *
 *    `expiresAt` yazılmadan bir fotoğraf satırı OLUŞTURULAMAZ (şemada
 *    zorunlu). Sebep: temizlik cron'u yalnızca bu alana bakar; boş kalsaydı
 *    fotoğraf hiç silinmez ve söz sessizce tutulmamış olurdu.
 *
 * Saf fonksiyon — `now` dışarıdan verilir ki test saat beklemesin.
 */
export function photoExpiresAt(purpose: PhotoPurpose, now: Date = new Date()): Date {
  const milliseconds =
    purpose === 'ONE_TIME'
      ? PHOTO_RETENTION.oneTimeHours * 60 * 60 * 1000
      : PHOTO_RETENTION.savedProfileDays * 24 * 60 * 60 * 1000;

  return new Date(now.getTime() + milliseconds);
}

/**
 * Bu amaç için ayrıca SAKLAMA rızası gerekiyor mu?
 *
 * Tek seferlik kullanımda fotoğraf işlenip kısa sürede siliniyor; "profilimde
 * sakla" ise ayrı ve daha ağır bir izindir (PHOTO_STORAGE). İkisini tek rızaya
 * bağlamak, kullanıcıyı denemek istediği için saklamaya da razı olmaya zorlardı.
 */
export function requiresStorageConsent(purpose: PhotoPurpose): boolean {
  return purpose === 'SAVED_PROFILE';
}
