import { z } from 'zod';

/** UUID v7 — sıralanabilir olduğu için birincil anahtar olarak kullanılır. */
export const idSchema = z.string().uuid({ message: 'Geçersiz kimlik.' });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'Geçerli bir e-posta adresi girin.' })
  .max(254);

/** TR cep telefonu — E.164 biçiminde normalize edilir: +905321234567 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .refine((value) => /^(\+90|0)?5\d{9}$/.test(value), {
    message: 'Geçerli bir cep telefonu numarası girin.',
  })
  .transform((value) => {
    const digits = value.replace(/^\+90/, '').replace(/^0/, '');
    return `+90${digits}`;
  });

export const passwordSchema = z
  .string()
  .min(10, 'Şifre en az 10 karakter olmalı.')
  .max(128, 'Şifre en fazla 128 karakter olabilir.')
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), {
    message: 'Şifre en az bir harf ve bir rakam içermeli.',
  });

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Doğrulama kodu 6 haneli olmalı.');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Geçersiz bağlantı adresi.');

/** Tutarlar API sınırında string olarak taşınır (JSON bigint desteklemez). */
export const minorAmountSchema = z
  .string()
  .regex(/^-?\d{1,18}$/, 'Geçersiz tutar.')
  .transform((v) => BigInt(v));

export const currencySchema = z.literal('TRY');

export const moneySchema = z.object({
  amountMinor: minorAmountSchema,
  currency: currencySchema,
});

/** 1250 = %12,50 */
export const basisPointsSchema = z
  .number()
  .int('Komisyon oranı tam sayı basis point olmalı.')
  .min(0)
  .max(10_000);

export const quantitySchema = z.number().int().min(1).max(50);

// ── Sayfalama ─────────────────────────────────────────────────────────────
export const cursorPaginationSchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export type CursorPagination = z.infer<typeof cursorPaginationSchema>;

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

// ── Türkiye'ye özgü doğrulayıcılar ───────────────────────────────────────

/** T.C. Kimlik No — resmî kontrol algoritması. */
export function isValidTckn(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = value.split('').map(Number) as number[];
  const oddSum = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const evenSum = d[1]! + d[3]! + d[5]! + d[7]!;
  const digit10 = (oddSum * 7 - evenSum) % 10;
  const digit11 = (oddSum + evenSum + d[9]!) % 10;
  return d[9] === digit10 && d[10] === digit11;
}

export const tcknSchema = z
  .string()
  .trim()
  .refine(isValidTckn, { message: 'Geçerli bir T.C. kimlik numarası girin.' });

/** Vergi kimlik no: 10 hane (tüzel kişi) veya 11 hane TCKN (şahıs şirketi). */
export const taxNumberSchema = z
  .string()
  .trim()
  .refine((v) => /^\d{10}$/.test(v) || isValidTckn(v), {
    message: 'Geçerli bir vergi kimlik numarası veya T.C. kimlik numarası girin.',
  });

/** IBAN — ISO 13616 mod-97 kontrolü, TR için 26 karakter. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('TR') && iban.length !== 26) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));

  // Büyük sayıyı parça parça mod 97
  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export const ibanSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, '').toUpperCase())
  .refine(isValidIban, { message: 'Geçerli bir IBAN girin.' });

export const postalCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{5}$/, 'Posta kodu 5 haneli olmalı.');

// ── Adres ─────────────────────────────────────────────────────────────────
export const addressSchema = z.object({
  title: z.string().trim().min(2).max(60), // "Ev", "İş"
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().min(2).max(60),
  phone: phoneSchema,
  city: z.string().trim().min(2).max(60),
  district: z.string().trim().min(2).max(60),
  neighbourhood: z.string().trim().max(80).optional(),
  line1: z.string().trim().min(10, 'Adres en az 10 karakter olmalı.').max(300),
  postalCode: postalCodeSchema.optional(),
  /** Kurumsal fatura için */
  companyName: z.string().trim().max(160).optional(),
  taxOffice: z.string().trim().max(80).optional(),
  taxNumber: taxNumberSchema.optional(),
});
export type AddressInput = z.infer<typeof addressSchema>;

// ── Ortak enum'lar (Prisma enum'larıyla eş tutulur) ───────────────────────
export const genderSchema = z.enum(['WOMAN', 'MAN', 'UNISEX', 'KIDS']);
export const fitPrefSchema = z.enum(['SLIM', 'REGULAR', 'OVERSIZE']);
export const imageAngleSchema = z.enum(['FRONT', 'BACK', 'SIDE', 'DETAIL', 'MODEL', 'FLATLAY']);
export const tryOnModeSchema = z.enum(['FAST', 'QUALITY']);
export const photoPurposeSchema = z.enum(['ONE_TIME', 'SAVED_PROFILE']);

/**
 * Sanal deneme kategorisi — Prisma `TryOnCategory` enum'ının aynası.
 *
 * ⚠️ Aynanın TEK yeri burasıdır. `wardrobe.schema.ts` ve `admin.schema.ts`
 *    kendi listelerini YAZMAZ, bunu içe aktarır. Aynı dört dize daha önce
 *    dört ayrı dosyada elle yazılıydı ve hiçbiri diğerini haberdar etmiyordu.
 *
 * ⚠️ `z.enum` seçildi çünkü çalışma zamanı listesi ile TypeScript tipi AYNI
 *    ifadeden türer. Elle yazılmış `type` + ayrı `const LIST` çifti kendi
 *    içinde sapabilirdi: biri güncellenip diğeri unutulunca derleme hiçbir şey
 *    söylemezdi.
 *
 * ⚠️ Prisma enum'ıyla sapma yorumla değil, DERLEMEYLE yakalanır ve iddia yük
 *    taşıyan kodun üzerindedir: `apps/worker/src/jobs/wardrobe.auto-add.job.ts`
 *    → `TRYON_CATEGORY` (`as const satisfies Record<PrismaTryOnCategory,
 *    TryOnCategory>`, okuma yolunda KULLANILIR).
 */
/**
 * ⚠️ BU LİSTE "DENENEBİLİR KATEGORİLER" DEĞİLDİR. Katalogdaki try-on
 *    kategorisinin tamamıdır; hangilerinde gerçekten deneme yapılabildiğine
 *    `@vt/config` → `TRYON_PROVIDER_CAPABILITIES` karar verir. Son dört değer
 *    bugün KAPALIdır (sağlayıcıda model yok) ama kataloğa girer: mağazada
 *    ayakkabı ve çanta satılıyor ve bunlar kullanıcının gardırobuna da girer —
 *    kombin önerisi giysiyle ayakkabıyı birlikte düşünür, üretemese bile.
 */
export const tryOnCategorySchema = z.enum([
  'UPPER_BODY',
  'LOWER_BODY',
  'DRESS',
  'OUTERWEAR',
  'SHOES',
  'JEWELRY',
  'BAG',
  'ACCESSORY',
]);
export type TryOnCategory = z.infer<typeof tryOnCategorySchema>;

export const consentTypeSchema = z.enum([
  'PHOTO_PROCESSING',
  'CROSS_BORDER_TRANSFER',
  'PHOTO_STORAGE',
  'MODEL_TRAINING',
  'MARKETING',
]);
export type ConsentType = z.infer<typeof consentTypeSchema>;

/** Sanal deneme için zorunlu rızalar — biri eksikse istek reddedilir. */
export const REQUIRED_TRYON_CONSENTS = [
  'PHOTO_PROCESSING',
  'CROSS_BORDER_TRANSFER',
] as const satisfies readonly ConsentType[];

// ── Vücut ölçüleri ────────────────────────────────────────────────────────
/**
 * OKUMA / öneri gövdesi. `POST /v1/size/recommend` bunu alıyor ve
 * `apps/web` → `beden-onerisi.tsx:80` onu kullanıyor.
 *
 * ⚠️ SINIRLAR BİR VÜCUT MODELİ DEĞİL, GİRDİ HATASI SINIRLARIDIR. Hiçbirinin
 *    arkasında antropometrik bir kaynak İDDİA EDİLMİYOR; amaç birim
 *    karışıklığını (inç→cm) ve basamak kaymasını yakalamaktır.
 */
export const bodyProfileSchema = z.object({
  heightCm: z.number().int().min(100).max(230).optional(),
  weightKg: z.number().int().min(30).max(250).optional(),
  chestCm: z.number().int().min(50).max(200).optional(),
  waistCm: z.number().int().min(40).max(200).optional(),
  hipCm: z.number().int().min(50).max(200).optional(),
  /**
   * Omuz genişliği (cm). Alt sınır 25 çocuk bedenini kapsar — seed'de
   * `cocuk-ust-giyim` altında 6 ürün var; üst sınır 70, 5XL merdiven ucundan
   * geniştir. ⚠️ Kaynak iddia edilmiyor, girdi hatası sınırıdır.
   */
  shoulderCm: z.number().int().min(25).max(70).optional(),
  /**
   * İç bacak boyu (cm). Alt sınır 40 çocuk alt giyimini kapsar; üst sınır 110
   * seed `ALT_BEDEN_TABLOSU`ndaki en uzun `icBoy`un (79) çok üstünde kalır ama
   * tipik hatayı — boy değerini (172) buraya yazmak — yakalar.
   * ⚠️ Kaynak iddia edilmiyor, girdi hatası sınırıdır.
   */
  inseamCm: z.number().int().min(40).max(110).optional(),
  usualSize: z.string().trim().max(10).optional(),
  fitPref: fitPrefSchema.optional(),
});
export type BodyProfileInput = z.infer<typeof bodyProfileSchema>;

/**
 * YAZMA şeması — `PUT /v1/me/body-profile`, TAM DEĞİŞİM.
 * Gönderilmeyen alan NULL'a düşer.
 *
 * ⚠️ HER ALAN `.nullable()` ve bu ŞART: kullanıcının bir kez girdiği ölçüyü
 *    SİLEBİLMESİ gerekir. Yalnızca `.optional()` olsaydı "bu alanı gönderme"
 *    ile "bu alanı sil" telde AYIRT EDİLEMEZDİ ve girilen bir ölçü asla geri
 *    alınamazdı.
 *
 * ⚠️ `bodyProfileSchema` ile SINIRLARI AYNI, şekli değil. İkisi tek şemadan
 *    türetilmedi çünkü okuma tarafının `null` kabul etmesi gereksiz; sınırlar
 *    değişirse İKİSİ BİRDEN güncellenir.
 */
export const bodyProfileWriteSchema = z.object({
  heightCm: z.number().int().min(100).max(230).nullable().optional(),
  weightKg: z.number().int().min(30).max(250).nullable().optional(),
  chestCm: z.number().int().min(50).max(200).nullable().optional(),
  waistCm: z.number().int().min(40).max(200).nullable().optional(),
  hipCm: z.number().int().min(50).max(200).nullable().optional(),
  shoulderCm: z.number().int().min(25).max(70).nullable().optional(),
  inseamCm: z.number().int().min(40).max(110).nullable().optional(),
  usualSize: z.string().trim().max(10).nullable().optional(),
  fitPref: fitPrefSchema.nullable().optional(),
});
export type BodyProfileWriteInput = z.infer<typeof bodyProfileWriteSchema>;
