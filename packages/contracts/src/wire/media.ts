/**
 * KULLANICI FOTOĞRAFI — telde görünen şekil.
 *
 * Alanlar çalışan API'den okundu: `POST /v1/me/photos` ve
 * `POST /v1/me/photos/:id/confirm` (ikisi de gerçek bir R2 yüklemesiyle
 * denendi, PUT 200).
 *
 * ⚠️ YÜKLEME VEKİLDEN GEÇMEZ. Dosya imzalı adrese DOĞRUDAN PUT edilir; ara
 *    katman koysaydık 10 MB'a kadar her fotoğraf Next sürecinin belleğinden
 *    geçerdi. Vekilden geçen yalnızca bilet isteği ve onaydır.
 */

export type PhotoPurposeWire = 'ONE_TIME' | 'SAVED_PROFILE';

export interface UploadTicketWire {
  /** ⚠️ Onay çağrısında YOL parametresi: `POST /me/photos/:uploadId/confirm`. */
  uploadId: string;
  /** İmzalı R2 adresi, ömrü `MEDIA.uploadUrlTtlSeconds`. */
  uploadUrl: string;
  /**
   * ⚠️ PUT ederken AYNEN gönderilmeli. İstemcinin beyanı imzaya gömülüyor;
   *    farklı bir tip göndermek depoda reddedilir.
   */
  requiredContentType: string;
  maxSizeBytes: number;
  expiresInSeconds: number;
}

/**
 * Onay yanıtı.
 *
 * ⚠️ Kalite BURADA ölçülür, yüklemede değil: sunucu yükleme anında baytları
 *    görmez. `qualityScore` eşiğin altındaysa uç `PHOTO_QUALITY_LOW` FIRLATIR
 *    ve bu nesne hiç dönmez — yani elde bir `UserPhotoWire` varsa fotoğraf
 *    denemeye uygundur. `qualityIssues` yine de dolu olabilir (ölçüldü:
 *    skor 66, sorun `["blurry"]`), bu bir uyarıdır, engel değil.
 */
export interface UserPhotoWire {
  id: string;
  qualityScore: number | null;
  qualityIssues: string[];
  widthPx: number;
  heightPx: number;
  sizeBytes: number;
  purpose: PhotoPurposeWire;
  /** Saklama süresi sonu — `ONE_TIME` için 24 saat. */
  expiresAt: string;
  /** ⚠️ İmzalı, ömrü 300 sn (`SIGNED_URL_TTL_SECONDS.userPhoto`). */
  viewUrl: string | null;
  createdAt: string;
}
