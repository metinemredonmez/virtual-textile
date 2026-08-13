import { z } from 'zod';
import { MEDIA, SITE_IMAGE_SLOTS } from '@vt/config';
import { idSchema } from '@vt/contracts';

/**
 * SİTE GÖRSELİ UÇLARININ GİRDİ ŞEMALARI.
 *
 * ⚠️ `contentType` ve `sizeBytes` İSTEMCİNİN BEYANIDIR (medya modülüyle aynı
 *    gerekçe): dosya imzalı URL ile doğrudan depoya gider, sunucu yükleme
 *    anında baytları görmez. Beyan imzaya gömülür; GERÇEK doğrulama onay
 *    adımında baytlara bakılarak yapılır.
 */

/**
 * ⚠️ SLOT LİSTESİ BURADA YENİDEN YAZILMAZ, `@vt/config`ten TÜRETİLİR.
 *
 *    `z.enum(['HERO', ...])` yazmak iki listeyi ayrışmaya açardı: config'e
 *    dördüncü bir yüzey eklenir, uç onu 400'le reddeder, hata hiçbir yerde
 *    görünmez. Türetildiği için config'e eklenen değer aynı anda uçta da
 *    geçerli olur — ve `admin-site-image.controller.test.ts` bu bağın
 *    kopmadığını ayrıca ölçer.
 */
export const siteImageSlotSchema = z.enum(SITE_IMAGE_SLOTS);

const contentTypeSchema = z.enum(MEDIA.allowedMimeTypes, {
  errorMap: () => ({ message: 'Yalnızca JPG, PNG veya WebP yükleyebilirsiniz.' }),
});

const sizeBytesSchema = z
  .number()
  .int('Dosya boyutu tam sayı olmalı.')
  .positive('Dosya boyutu sıfırdan büyük olmalı.')
  .max(MEDIA.maxUploadBytes, `Dosya boyutu en fazla ${MEDIA.maxUploadBytes} bayt olabilir.`);

/**
 * Hedef anahtarı — HERO'da boş, kapaklarda dolu.
 *
 * ⚠️ ŞEKİL burada, VARLIK serviste doğrulanır. Zod dizeyi görebilir ama o
 *    kategorinin var olup olmadığını bilemez; o kontrol `SITE_IMAGE_TARGET_
 *    INVALID` ile serviste yapılır.
 */
const targetKeySchema = z.string().trim().min(1).max(200);

/**
 * Afişe tıklanınca gidilecek yer.
 *
 * ⚠️ YALNIZCA SİTE İÇİ YOL. `https://…` kabul edilseydi, afiş yönetimi bir
 *    açık yönlendirme (open redirect) yüzeyine dönerdi: vitrinin en büyük
 *    tıklanabilir alanı dış bir adrese bakardı. `//evil.com` de reddedilir —
 *    tarayıcı onu protokol-göreli MUTLAK adres olarak çözer, yani tek eğik
 *    çizgi kontrolü tek başına yetmez.
 */
const linkHrefSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^\/(?!\/)/, 'Bağlantı site içi bir yol olmalı (ör. /collection/denim).');

/** Yönetici metni — boş dize `null` sayılır, "yazıldı ama boş" hâli olmasın. */
const metinSchema = z.string().trim().max(200);

// ── Yükleme bileti ────────────────────────────────────────────────────────

export const siteImageUploadSchema = z.object({
  slot: siteImageSlotSchema,
  targetKey: targetKeySchema.nullish(),
  contentType: contentTypeSchema,
  sizeBytes: sizeBytesSchema,
});
export type SiteImageUploadInput = z.infer<typeof siteImageUploadSchema>;

// ── Yükleme onayı ─────────────────────────────────────────────────────────

/**
 * ⚠️ `slot` ve `targetKey` ONAYDA TEKRAR ALINIR ve bu bir kopya değil,
 *    zorunluluktur: bilet adımı VERİTABANINA YAZMAZ (bilinçli — yarım kalan
 *    yükleme veri bırakmasın), dolayısıyla sunucunun hatırladığı bir taslak
 *    yoktur. Ürün görselinin `angle`ı da aynı sebeple onayda tekrar alınıyor.
 *
 * ⚠️ `isActive` BURADA YOK. Yeni yüklenen afiş canlıya kendiliğinden çıkmaz;
 *    yönetici görseli görüp `PATCH` ile açar. Onayda açılabilseydi, yanlış
 *    kırpılmış bir deneme doğrudan vitrine düşerdi.
 */
export const siteImageConfirmSchema = z.object({
  slot: siteImageSlotSchema,
  targetKey: targetKeySchema.nullish(),
  title: metinSchema.nullish(),
  subtitle: metinSchema.nullish(),
  linkHref: linkHrefSchema.nullish(),
  sortOrder: z.number().int().min(0).max(1000).optional().default(0),
});
export type SiteImageConfirmInput = z.infer<typeof siteImageConfirmSchema>;

// ── Güncelleme ────────────────────────────────────────────────────────────

/**
 * ⚠️ `slot`, `targetKey` ve `storageKey` GÜNCELLENMEZ. Slot'u değiştirmek,
 *    16/7 oranında üretilmiş bir afişi kategori kapağı yerine koymak demek
 *    olurdu — türevler yeniden üretilmediği için görsel yanlış oranda
 *    görünürdü. Başka bir yüzey için yeni görsel yüklenir.
 *
 * ⚠️ Metin alanları `null` KABUL EDER: yönetici bir başlığı SİLEBİLMELİ.
 *    `.optional()` tek başına bunu ifade edemez — "gönderilmedi" ile
 *    "temizlensin" ayrımı kaybolurdu.
 */
export const siteImageUpdateSchema = z
  .object({
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    title: metinSchema.nullable().optional(),
    subtitle: metinSchema.nullable().optional(),
    linkHref: linkHrefSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Değiştirilecek en az bir alan gönderilmeli.',
  });
export type SiteImageUpdateInput = z.infer<typeof siteImageUpdateSchema>;

// ── Liste ─────────────────────────────────────────────────────────────────

export const siteImageListQuerySchema = z.object({
  slot: siteImageSlotSchema.optional(),
});
export type SiteImageListQuery = z.infer<typeof siteImageListQuerySchema>;

// ── Ürün kartı ────────────────────────────────────────────────────────────

export const siteImageCardSchema = z.object({
  productId: idSchema,
  sortOrder: z.number().int().min(0).max(100).optional().default(0),
});
export type SiteImageCardInput = z.infer<typeof siteImageCardSchema>;

// ── Genel (kimliksiz) okuma ───────────────────────────────────────────────

/**
 * ⚠️ `slot` ZORUNLU. İsteğe bağlı olsaydı uç, bütün site görsellerini tek
 *    seferde döndüren bir uca dönerdi; vitrin her sayfada ihtiyacı olmayan
 *    kapakları da indirirdi.
 */
export const siteImagePublicQuerySchema = z.object({
  slot: siteImageSlotSchema,
  targetKey: targetKeySchema.optional(),
});
export type SiteImagePublicQuery = z.infer<typeof siteImagePublicQuerySchema>;
