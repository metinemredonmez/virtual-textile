import { z } from 'zod';
import { MEDIA } from '@vt/config';
import { imageAngleSchema, photoPurposeSchema } from '@vt/contracts';

/**
 * MEDYA UÇLARININ GİRDİ ŞEMALARI
 *
 * ⚠️ Burada doğrulanan `contentType` ve `sizeBytes` İSTEMCİNİN BEYANIDIR.
 *    Dosya imzalı URL ile doğrudan depoya gittiği için sunucu yükleme anında
 *    içeriği görmez. Beyan iki işe yarar: (a) imzaya gömülür, yalan söyleyen
 *    yükleme depo tarafında reddedilir, (b) daha URL üretilmeden bariz
 *    hataları eler. GERÇEK doğrulama onay adımında baytlara bakılarak yapılır
 *    (bkz. image-format.ts).
 */

/** Kabul edilen görsel tipleri — tek doğruluk kaynağı @vt/config. */
export const mediaContentTypeSchema = z.enum(MEDIA.allowedMimeTypes, {
  errorMap: () => ({ message: 'Yalnızca JPG, PNG veya WebP yükleyebilirsiniz.' }),
});

const sizeBytesSchema = z
  .number()
  .int('Dosya boyutu tam sayı olmalı.')
  .positive('Dosya boyutu sıfırdan büyük olmalı.')
  .max(MEDIA.maxUploadBytes, `Dosya boyutu en fazla ${MEDIA.maxUploadBytes} bayt olabilir.`);

// ── Ürün görseli ──────────────────────────────────────────────────────────

export const productImageUploadSchema = z.object({
  angle: imageAngleSchema,
  contentType: mediaContentTypeSchema,
  sizeBytes: sizeBytesSchema,
});
export type ProductImageUploadInput = z.infer<typeof productImageUploadSchema>;

export const productImageConfirmSchema = z.object({
  /**
   * Açı onay adımında TEKRAR alınır: satıcı yükleme sırasında "ön" seçip
   * sonra fikir değiştirebilir ve iki istek arasında sunucu tarafında
   * tutulan bir taslak kayıt YOKTUR (bilinçli — yarım kalan yükleme veri
   * bırakmasın).
   */
  angle: imageAngleSchema,
  isPrimary: z.boolean().optional().default(false),
  sortOrder: z.number().int().min(0).max(100).optional().default(0),
});
export type ProductImageConfirmInput = z.infer<typeof productImageConfirmSchema>;

// ── Kullanıcı fotoğrafı ───────────────────────────────────────────────────

export const userPhotoUploadSchema = z.object({
  contentType: mediaContentTypeSchema,
  sizeBytes: sizeBytesSchema,
  /**
   * Saklama amacı burada da alınır çünkü onay adımındaki amaç, saklama
   * süresini belirler ve KVKK rıza kontrolü buna göre yapılır.
   */
  purpose: photoPurposeSchema,
});
export type UserPhotoUploadInput = z.infer<typeof userPhotoUploadSchema>;

export const userPhotoConfirmSchema = z.object({
  /**
   * ⚠️ Amaç onayda TEKRAR alınır ve saklama süresi bundan hesaplanır.
   *    Yükleme isteğinde veritabanına satır yazılmadığı için sunucunun
   *    hatırladığı bir "amaç" yoktur; kullanıcı fikrini değiştirdiyse
   *    (ör. "profilimde saklama") o karar burada geçerlidir.
   */
  purpose: photoPurposeSchema,
});
export type UserPhotoConfirmInput = z.infer<typeof userPhotoConfirmSchema>;
