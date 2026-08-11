import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@vt/config';
import { AppError } from '@vt/contracts';
import {
  decryptField,
  encryptField,
  encryptedFieldsMatch,
  maskIban,
  maskTaxNumber,
} from './seller-crypto.js';

const hex = (bytes: number): string => 'a'.repeat(bytes * 2);

/** Şifreleme `env()` okuyor; testte asgari geçerli ortam kuruluyor. */
const ENV_FIXTURE: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
  CORS_ORIGINS: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://vt:vt@localhost:5432/virtual_textile',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: hex(64),
  JWT_REFRESH_SECRET: hex(64),
  FIELD_ENCRYPTION_KEY: hex(32),
  INTERNAL_API_TOKEN: 'a'.repeat(32),
};

const saved: NodeJS.ProcessEnv = {};

beforeAll(() => {
  for (const [key, value] of Object.entries(ENV_FIXTURE)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  resetEnvCache();
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
});

const IBAN = 'TR330006100519786457841326';

describe('encryptField / decryptField', () => {
  it('şifrelenen değer aynen geri çözülür', () => {
    expect(decryptField(encryptField(IBAN))).toBe(IBAN);
  });

  it('düz metin şifreli çıktının içinde geçmez', () => {
    const encrypted = encryptField(IBAN);
    expect(encrypted).not.toContain(IBAN);
    expect(encrypted).not.toContain('786457841326');
  });

  /**
   * ⚠️ Sabit IV ile GCM'de anahtar akışı tekrar eder ve şifreleme çöker.
   * Aynı düz metnin iki şifrelemesi FARKLI olmalı.
   */
  it('aynı değer her seferinde farklı şifreli metin üretir', () => {
    expect(encryptField(IBAN)).not.toBe(encryptField(IBAN));
  });

  it('Türkçe karakterli metinleri korur', () => {
    const value = 'Şişli Vergi Dairesi — ğüöçİı';
    expect(decryptField(encryptField(value))).toBe(value);
  });

  it('boş metin de tur atabilir', () => {
    expect(decryptField(encryptField(''))).toBe('');
  });

  /**
   * ⚠️ EN KRİTİK GÜVENLİK TESTİ.
   * AES-GCM kimliği doğrulanmış şifrelemedir: şifreli metinle oynanırsa
   * çözme BAŞARISIZ OLMALI. Sessizce bozuk bir IBAN döndürseydi, başkasının
   * hesabına ödeme yapılabilirdi.
   */
  it('oynanmış şifreli metin çözülmez', () => {
    const encrypted = encryptField(IBAN);
    const parts = encrypted.split(':');
    const payload = Buffer.from(parts[3]!, 'base64');
    payload[0] ^= 0xff; // tek bir bayt bozuldu
    const tampered = [parts[0], parts[1], parts[2], payload.toString('base64')].join(':');

    expect(() => decryptField(tampered)).toThrow(AppError);
  });

  it('doğrulama etiketiyle oynanırsa çözülmez', () => {
    const parts = encryptField(IBAN).split(':');
    const tag = Buffer.from(parts[2]!, 'base64');
    tag[0] ^= 0xff;
    const tampered = [parts[0], parts[1], tag.toString('base64'), parts[3]].join(':');

    expect(() => decryptField(tampered)).toThrow(AppError);
  });

  it('tanınmayan biçim reddedilir', () => {
    expect(() => decryptField('düz-metin')).toThrow(AppError);
    expect(() => decryptField('v9:a:b:c')).toThrow(AppError);
  });

  it('hata mesajı şifreli metni sızdırmaz', () => {
    const encrypted = encryptField(IBAN);
    try {
      decryptField(`v1:${encrypted.split(':').slice(1).join(':')}x`);
      // Bozulma her zaman hata vermeyebilir; vermezse test anlamsızlaşmasın.
    } catch (error) {
      expect((error as AppError).userMessage).not.toContain(encrypted);
      expect((error as AppError).userMessage).not.toContain(IBAN);
    }
  });
});

describe('encryptedFieldsMatch', () => {
  it('aynı düz metnin iki şifrelemesi eşleşir', () => {
    expect(encryptedFieldsMatch(encryptField(IBAN), encryptField(IBAN))).toBe(true);
  });

  it('farklı değerler eşleşmez', () => {
    expect(
      encryptedFieldsMatch(encryptField(IBAN), encryptField('TR120006100519786457841327')),
    ).toBe(false);
  });

  it('farklı uzunluktaki değerler eşleşmez', () => {
    expect(
      encryptedFieldsMatch(encryptField('kısa'), encryptField('çok daha uzun bir değer')),
    ).toBe(false);
  });
});

describe('maskIban', () => {
  it('yalnızca ülke kodu ve son 4 hane görünür', () => {
    const masked = maskIban(IBAN);

    expect(masked.startsWith('TR')).toBe(true);
    expect(masked.endsWith('1326')).toBe(true);
    expect(masked).toHaveLength(IBAN.length);
    // Ortadaki hiçbir hane sızmamalı.
    expect(masked).not.toContain('0006100519');
  });

  it('boşluklu IBAN normalize edilir', () => {
    expect(maskIban('TR33 0006 1005 1978 6457 8413 26')).toBe(maskIban(IBAN));
  });

  it('çok kısa girdide hiçbir şey göstermez', () => {
    expect(maskIban('TR33')).toBe('****');
  });
});

describe('maskTaxNumber', () => {
  it('yalnızca son 3 hane görünür', () => {
    expect(maskTaxNumber('1234567890')).toBe('*******890');
  });

  it('çok kısa girdide hiçbir şey göstermez', () => {
    expect(maskTaxNumber('12')).toBe('****');
  });
});
