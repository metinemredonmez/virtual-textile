/**
 * GÖRSEL BİÇİMİ TESPİTİ — SİHİRLİ BAYTLARDAN
 *
 * ⚠️ İstemcinin bildirdiği `Content-Type` bir İDDİADIR, kanıt değil. Dosya
 *    doğrudan imzalı URL ile depoya gittiği için sunucu yükleme anında
 *    içeriği görmez; tek gerçek kontrol noktası, onay adımında baytlara
 *    bakmaktır. Bu kontrol olmadan `image/jpeg` diye bildirilmiş bir HTML
 *    veya SVG dosyası depoya girer ve CDN'den servis edildiğinde saklı XSS'e
 *    dönüşür.
 *
 * SVG bilerek DESTEKLENMEZ: script taşıyabilen tek görsel biçimidir ve
 * `MEDIA.allowedMimeTypes` listesinde de yoktur.
 */

export type DetectedImageFormat = 'image/jpeg' | 'image/png' | 'image/webp';

const startsWith = (buffer: Buffer, bytes: readonly number[], offset = 0): boolean =>
  buffer.length >= offset + bytes.length && bytes.every((byte, i) => buffer[offset + i] === byte);

/**
 * İçeriğin gerçek biçimi. Tanınmayan/desteklenmeyen biçimde `null`.
 * Çağıran taraf bunu PHOTO_INVALID_FORMAT'a çevirir.
 */
export function detectImageFormat(buffer: Buffer): DetectedImageFormat | null {
  // JPEG: FF D8 FF
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // WebP: "RIFF" .... "WEBP"
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * EXIF varlığının kaba tespiti — yalnızca GÖZLEMLENEBİLİRLİK için.
 *
 * ⚠️ Bu fonksiyon TEMİZLİK YAPMAZ ve temizliğin yerine geçmez. Metadata
 *    silme işi `ImageProcessor.sanitize()`'in sorumluluğudur; buradaki kontrol
 *    "temizleme çalışmamış olabilir" durumunu fark edebilmek içindir.
 */
export function looksLikeItHasExif(buffer: Buffer): boolean {
  // JPEG APP1 (FF E1) segmenti + "Exif\0\0"
  for (let i = 2; i < Math.min(buffer.length - 10, 65_536); i += 1) {
    if (buffer[i] === 0xff && buffer[i + 1] === 0xe1) {
      const marker = buffer.subarray(i + 4, i + 8).toString('latin1');
      if (marker === 'Exif') return true;
    }
  }
  return false;
}
