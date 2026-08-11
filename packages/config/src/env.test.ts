import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const hex = (bytes: number) => 'a'.repeat(bytes * 2);

const validBase = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
  CORS_ORIGINS: 'http://localhost:3000,http://localhost:3002',
  DATABASE_URL: 'postgresql://vt:vt@localhost:5432/virtual_textile',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: hex(64),
  JWT_REFRESH_SECRET: hex(64),
  FIELD_ENCRYPTION_KEY: hex(32),
  INTERNAL_API_TOKEN: 'a'.repeat(32),
} satisfies NodeJS.ProcessEnv;

const productionBase = {
  ...validBase,
  NODE_ENV: 'production',
  APP_URL: 'https://example.com',
  API_URL: 'https://api.example.com',
  CORS_ORIGINS: 'https://example.com',
  IYZICO_BASE_URL: 'https://api.iyzipay.com',
  IYZICO_API_KEY: 'k',
  IYZICO_SECRET_KEY: 's',
  IYZICO_WEBHOOK_SECRET: 'w',
  R2_ENDPOINT: 'https://r2.example.com',
  R2_ACCESS_KEY_ID: 'a',
  R2_SECRET_ACCESS_KEY: 'b',
  FAL_KEY: 'f',
  ANTHROPIC_API_KEY: 'c',
  RESEND_API_KEY: 'r',
  SENTRY_DSN: 'https://sentry.example.com/1',
} satisfies NodeJS.ProcessEnv;

describe('geliştirme ortamı', () => {
  it('sağlayıcı anahtarları boşken de açılır', () => {
    expect(() => loadEnv(validBase)).not.toThrow();
  });

  it('varsayılanları uygular', () => {
    const env = loadEnv(validBase);
    expect(env.PORT).toBe(3001);
    expect(env.AI_TRYON_DAILY_PER_USER).toBe(10);
    expect(env.SHIPPING_PROVIDER).toBe('mock');
  });

  it('CORS listesini diziye çevirir', () => {
    expect(loadEnv(validBase).CORS_ORIGINS).toEqual([
      'http://localhost:3000',
      'http://localhost:3002',
    ]);
  });
});

describe('anahtar uzunluğu', () => {
  it('kısa JWT secret reddedilir', () => {
    expect(() => loadEnv({ ...validBase, JWT_ACCESS_SECRET: 'kisa' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('şifreleme anahtarı tam 32 bayt olmalı', () => {
    expect(() => loadEnv({ ...validBase, FIELD_ENCRYPTION_KEY: hex(16) })).toThrow(
      /FIELD_ENCRYPTION_KEY/,
    );
  });
});

describe('üretim ortamı ek kontrolleri', () => {
  it('tam yapılandırma ile geçer', () => {
    expect(() => loadEnv(productionBase)).not.toThrow();
  });

  it('eksik ödeme anahtarını sonucuyla birlikte bildirir', () => {
    expect(() => loadEnv({ ...productionBase, IYZICO_API_KEY: '' })).toThrow(/ödeme alınamaz/);
  });

  it('webhook secret eksikse sahte bildirim riskini söyler', () => {
    expect(() => loadEnv({ ...productionBase, IYZICO_WEBHOOK_SECRET: '' })).toThrow(
      /sahte ödeme bildirimi/,
    );
  });

  it('sandbox ödeme adresini üretimde reddeder', () => {
    expect(() =>
      loadEnv({ ...productionBase, IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com' }),
    ).toThrow(/sandbox/);
  });

  it('kullanıcı fotoğrafı ile ürün görselini aynı bucket’ta tutmayı engeller', () => {
    expect(() =>
      loadEnv({ ...productionBase, R2_BUCKET_PUBLIC: 'same', R2_BUCKET_PRIVATE: 'same' }),
    ).toThrow(/KVKK/);
  });

  it('localhost CORS kaynağını üretimde reddeder', () => {
    expect(() =>
      loadEnv({ ...productionBase, CORS_ORIGINS: 'https://example.com,http://localhost:3000' }),
    ).toThrow(/localhost/);
  });

  it('hata mesajı secret DEĞERLERİNİ sızdırmaz', () => {
    try {
      loadEnv({ ...productionBase, FAL_KEY: '', IYZICO_SECRET_KEY: 'cok-gizli-deger' });
      expect.unreachable('hata bekleniyordu');
    } catch (error) {
      expect(String(error)).not.toContain('cok-gizli-deger');
      expect(String(error)).toContain('FAL_KEY');
    }
  });
});
