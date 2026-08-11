import { z } from 'zod';

/**
 * ORTAM DEĞİŞKENİ DOĞRULAMASI
 *
 * Kural: uygulama açılırken doğrulanır. Bir anahtar eksik veya bozuksa
 * süreç BAŞLAMAZ. Üç hafta sonra üretimde "neden SMS gitmiyor" aramaktan iyidir.
 *
 * Üretim ortamında zorunlu olan alanlar `superRefine` ile ayrıca kontrol edilir —
 * geliştirmede boş bırakılabilen sağlayıcı anahtarları üretimde zorunludur.
 */

const nodeEnvSchema = z.enum(['development', 'test', 'staging', 'production']);

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const hexKey = (bytes: number, label: string) =>
  z
    .string()
    .regex(
      new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`),
      `${label} tam ${bytes} bayt hex olmalı (openssl rand -hex ${bytes}).`,
    );

export const envSchema = z
  .object({
    // ── Çalışma zamanı ────────────────────────────────────────────────
    NODE_ENV: nodeEnvSchema.default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),

    APP_URL: z.string().url(),
    API_URL: z.string().url(),
    CORS_ORIGINS: z.string().transform(csv).pipe(z.array(z.string().url()).min(1)),

    // ── Veri katmanı ──────────────────────────────────────────────────
    DATABASE_URL: z.string().url().startsWith('postgres'),
    REDIS_URL: z.string().url().startsWith('redis'),

    // ── Kimlik ────────────────────────────────────────────────────────
    // 64 bayt = 128 hex karakter. HS512 için yeterli entropi.
    JWT_ACCESS_SECRET: hexKey(64, 'JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: hexKey(64, 'JWT_REFRESH_SECRET'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('30d'),

    // AES-256-GCM anahtarı — IBAN, vergi no gibi alanların şifrelenmesi için.
    // ⚠️ Rotasyonu veri yeniden şifreleme gerektirir; runbook'a bak.
    FIELD_ENCRYPTION_KEY: hexKey(32, 'FIELD_ENCRYPTION_KEY'),

    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),

    // ── Ödeme ─────────────────────────────────────────────────────────
    IYZICO_BASE_URL: z.string().url().default('https://sandbox-api.iyzipay.com'),
    IYZICO_API_KEY: z.string().default(''),
    IYZICO_SECRET_KEY: z.string().default(''),
    IYZICO_WEBHOOK_SECRET: z.string().default(''),

    // ── Depolama ──────────────────────────────────────────────────────
    R2_ENDPOINT: z.string().default(''),
    R2_ACCESS_KEY_ID: z.string().default(''),
    R2_SECRET_ACCESS_KEY: z.string().default(''),
    R2_BUCKET_PUBLIC: z.string().default('vt-public-products'),
    /** ⚠️ Kullanıcı fotoğrafları — public bucket'tan AYRI olmalı. */
    R2_BUCKET_PRIVATE: z.string().default('vt-private-user-photos'),
    R2_PUBLIC_URL: z.string().default(''),

    // ── AI sağlayıcıları ──────────────────────────────────────────────
    FAL_KEY: z.string().default(''),
    FAL_TRYON_MODEL: z.string().default('fal-ai/idm-vton'),
    GOOGLE_AI_API_KEY: z.string().default(''),
    GOOGLE_AI_IMAGE_MODEL: z.string().default('gemini-2.5-flash-image'),
    ANTHROPIC_API_KEY: z.string().default(''),
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),

    // ── AI bütçe guardrail'leri ───────────────────────────────────────
    AI_DAILY_BUDGET_USD: z.coerce.number().positive().default(50),
    AI_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(1200),
    AI_TRYON_DAILY_PER_USER: z.coerce.number().int().positive().default(10),
    AI_TRYON_DAILY_PER_GUEST: z.coerce.number().int().positive().default(2),
    AI_STYLIST_DAILY_PER_USER: z.coerce.number().int().positive().default(30),

    // ── Bildirim ──────────────────────────────────────────────────────
    NETGSM_USER: z.string().default(''),
    NETGSM_PASS: z.string().default(''),
    NETGSM_HEADER: z.string().default(''),
    RESEND_API_KEY: z.string().default(''),
    MAIL_FROM: z.string().email().default('noreply@example.com'),

    // ── Kargo ─────────────────────────────────────────────────────────
    SHIPPING_PROVIDER: z.enum(['mock', 'geliver', 'aras']).default('mock'),
    SHIPPING_API_KEY: z.string().default(''),
    SHIPPING_CUSTOMER_CODE: z.string().default(''),

    // ── Gözlemlenebilirlik ────────────────────────────────────────────
    SENTRY_DSN: z.string().default(''),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default(''),

    INTERNAL_API_TOKEN: z.string().min(16, 'INTERNAL_API_TOKEN en az 16 karakter olmalı.'),

    /**
     * Worker prosesinin rolü.
     *
     *  core  → outbox, bildirim, zamanlanmış işler. Hafif ve GECİKMEYE DUYARLI.
     *  media → görüntü işleme, sanal deneme, embedding. Ağır ve CPU/IO yoğun.
     *  all   → ikisi birden (yalnızca yerel geliştirme).
     *
     * ⚠️ Üretimde ayrı proseslerde çalışırlar: ağır görsel işleme, 10 saniyede
     *    bir çalışması gereken outbox dağıtıcısını aç bırakmasın. İkisi aynı
     *    proseste olduğunda ödeme bildirimi görsel kuyruğunun arkasında bekler.
     */
    WORKER_ROLE: z.enum(['core', 'media', 'all']).default('all'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    /** Üretimde boş bırakılamayacak anahtarlar. */
    const requiredInProduction: Array<[keyof typeof env, string]> = [
      ['IYZICO_API_KEY', 'ödeme alınamaz'],
      ['IYZICO_SECRET_KEY', 'ödeme alınamaz'],
      ['IYZICO_WEBHOOK_SECRET', 'webhook imzası doğrulanamaz — sahte ödeme bildirimi riski'],
      ['R2_ENDPOINT', 'görsel yüklenemez'],
      ['R2_ACCESS_KEY_ID', 'görsel yüklenemez'],
      ['R2_SECRET_ACCESS_KEY', 'görsel yüklenemez'],
      ['FAL_KEY', 'sanal deneme çalışmaz'],
      ['ANTHROPIC_API_KEY', 'stil danışmanı çalışmaz'],
      ['RESEND_API_KEY', 'e-posta gönderilemez'],
      ['SENTRY_DSN', 'hatalar görünmez'],
    ];

    for (const [key, consequence] of requiredInProduction) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Üretim ortamında zorunlu — eksikse: ${consequence}.`,
        });
      }
    }

    if (env.IYZICO_BASE_URL.includes('sandbox')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['IYZICO_BASE_URL'],
        message: 'Üretim ortamında sandbox ödeme adresi kullanılamaz.',
      });
    }

    if (env.R2_BUCKET_PUBLIC === env.R2_BUCKET_PRIVATE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['R2_BUCKET_PRIVATE'],
        message:
          'Kullanıcı fotoğrafları ürün görselleriyle aynı bucket’ta tutulamaz (KVKK — özel nitelikli veri).',
      });
    }

    if (env.CORS_ORIGINS.some((origin) => origin.includes('localhost'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'Üretim ortamında localhost CORS kaynağı bırakılamaz.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Env'i doğrular. Hata varsa okunabilir bir mesajla süreci sonlandırır —
 * yığın izi yerine "hangi değişken, neden" listesi basar.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join('.') || '(kök)'}: ${issue.message}`)
      .join('\n');

    // İçerik secret olabileceği için DEĞERLER basılmaz, sadece anahtar adları.
    const message = [
      '',
      '═══════════════════════════════════════════════════════════════',
      ' ORTAM DEĞİŞKENİ DOĞRULAMASI BAŞARISIZ — uygulama başlatılmadı',
      '═══════════════════════════════════════════════════════════════',
      issues,
      '',
      ' .env.example dosyasını referans alın. Anahtar sahipliği: docs/secrets.md',
      '',
    ].join('\n');

    throw new Error(message);
  }

  return result.data;
}

let cached: Env | undefined;

/** Doğrulanmış env — ilk çağrıda hesaplanır, sonra önbellekten döner. */
export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Yalnızca test için — önbelleği temizler. */
export function resetEnvCache(): void {
  cached = undefined;
}

export const isProduction = (e: Env): boolean => e.NODE_ENV === 'production';
export const isDevelopment = (e: Env): boolean => e.NODE_ENV === 'development';
