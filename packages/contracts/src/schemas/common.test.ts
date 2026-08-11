import { describe, expect, it } from 'vitest';
import { ibanSchema, isValidIban, isValidTckn, phoneSchema, taxNumberSchema } from './common.js';

describe('T.C. kimlik no doğrulaması', () => {
  it('kontrol algoritmasını uygular', () => {
    // Algoritmaya uygun üretilmiş örnek değer (gerçek bir kişiye ait değildir)
    expect(isValidTckn('10000000146')).toBe(true);
  });

  it('geçersiz değerleri reddeder', () => {
    expect(isValidTckn('12345678901')).toBe(false);
    expect(isValidTckn('00000000000')).toBe(false); // 0 ile başlayamaz
    expect(isValidTckn('1234567890')).toBe(false); // 10 hane
    expect(isValidTckn('abcdefghijk')).toBe(false);
  });
});

describe('IBAN doğrulaması', () => {
  it('mod-97 kontrolünü uygular', () => {
    expect(isValidIban('GB82 WEST 1234 5698 7654 32')).toBe(true);
  });

  it('geçersiz kontrol hanesini reddeder', () => {
    expect(isValidIban('GB82 WEST 1234 5698 7654 33')).toBe(false);
  });

  it('TR IBAN uzunluğunu zorlar', () => {
    expect(isValidIban('TR33 0006 1005 1978 6457 8413')).toBe(false); // 24 hane
  });

  it('şemada boşlukları temizler ve büyük harfe çevirir', () => {
    const result = ibanSchema.safeParse('gb82 west 1234 5698 7654 32');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('GB82WEST12345698765432');
  });
});

describe('telefon normalizasyonu', () => {
  it.each([
    ['05321234567', '+905321234567'],
    ['5321234567', '+905321234567'],
    ['+90 532 123 45 67', '+905321234567'],
    ['(0532) 123-4567', '+905321234567'],
  ])('%s → %s', (input, expected) => {
    const result = phoneSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(expected);
  });

  it('sabit hat ve geçersiz numaraları reddeder', () => {
    expect(phoneSchema.safeParse('02121234567').success).toBe(false);
    expect(phoneSchema.safeParse('532123').success).toBe(false);
  });
});

describe('vergi kimlik no', () => {
  it('10 haneli VKN kabul eder', () => {
    expect(taxNumberSchema.safeParse('1234567890').success).toBe(true);
  });

  it('11 hanede TCKN algoritması arar', () => {
    expect(taxNumberSchema.safeParse('10000000146').success).toBe(true);
    expect(taxNumberSchema.safeParse('12345678901').success).toBe(false);
  });
});
