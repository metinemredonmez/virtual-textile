/**
 * GARDIROP UÇLARININ GİRDİ ŞEMALARI
 *
 * ⚠️ `userId` HİÇBİR ŞEMADA YOKTUR ve olmamalıdır. Kullanıcı kimliği her
 *    zaman oturumdan (`user.sub`) okunur. Gövdede kabul edilseydi, kimliği
 *    değiştiren biri başkasının gardırobuna parça ekleyebilir ya da
 *    başkasının fotoğrafını silebilirdi (bkz. me.controller.ts'deki aynı kural).
 *
 * ⚠️ `photoKey` de şemada YOKTUR. İstemci depo anahtarı GÖNDEREMEZ; anahtar
 *    sunucuda `wardrobeKeys.photo(userId, itemId)` ile üretilir. İstemciden
 *    alınsaydı `user-photos/<başkası>/...` yazıp başka birinin özel
 *    fotoğrafını kendi gardırobunda imzalı URL ile okuyabilirdi.
 */

import { z } from 'zod';

/** Şemadaki `TryOnCategory` enum'ı ile birebir. */
export const wardrobeCategorySchema = z.enum(['UPPER_BODY', 'LOWER_BODY', 'DRESS', 'OUTERWEAR']);

/** Yalnızca fotoğraf formatları — SVG kabul edilmez (içinde script taşır). */
export const wardrobePhotoContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Kullanıcının kendi parçasını eklemesi.
 *
 * Akış İKİ ADIMDIR: bu uç imzalı bir yükleme adresi döner, istemci fotoğrafı
 * doğrudan private kovaya yükler, sonra onay ucu çağrılır. Fotoğraf gövdede
 * taşınsaydı API sunucusu her yüklemede tam dosyayı belleğe alırdı.
 */
export const wardrobeCreateSchema = z.object({
  category: wardrobeCategorySchema,
  /** Renk uyumu motorunun sözlüğüyle eşleşir; serbest metin. */
  color: z.string().trim().min(2).max(40),
  label: z.string().trim().min(1).max(120).nullable().default(null),
  contentType: wardrobePhotoContentTypeSchema,
  /** İmzalı URL'e yazılacak azami boyut — depoda da zorlanır. */
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
});

export type WardrobeCreateInput = z.infer<typeof wardrobeCreateSchema>;

/** Yükleme tamamlandıktan sonra kaydı kalıcılaştıran onay. */
export const wardrobeConfirmSchema = z.object({
  itemId: z.string().uuid(),
});

export type WardrobeConfirmInput = z.infer<typeof wardrobeConfirmSchema>;

/**
 * Kombin önerisi sorgusu.
 *
 * `limit` küçük tutulur: öneri üretimi stil danışmanı modülünü çalıştırır ve
 * orada kota/bütçe kapıları vardır. Büyük bir limit tek istekte kullanıcının
 * günlük hakkını yakardı.
 */
export const outfitSuggestionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(3),
});

export type OutfitSuggestionQuery = z.infer<typeof outfitSuggestionQuerySchema>;
