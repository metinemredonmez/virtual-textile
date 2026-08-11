import { describe, expect, it } from 'vitest';
import {
  formatDayKey,
  formatDocumentNumber,
  parseSequence,
  ORDER_NUMBER_PREFIX,
  RETURN_NUMBER_PREFIX,
} from './order-number.js';
import { orderNumberSchema } from './order.schema.js';

describe('formatDayKey', () => {
  it('Türkiye saatine göre gün üretir', () => {
    expect(formatDayKey(new Date('2026-08-11T09:00:00.000Z'))).toBe('260811');
  });

  it('UTC’de dün olan gece saatlerinde bile doğru günü verir', () => {
    // 11 Ağustos 00:30 (TR) = 10 Ağustos 21:30 (UTC). Müşteri için gün 11'dir.
    expect(formatDayKey(new Date('2026-08-10T21:30:00.000Z'))).toBe('260811');
  });
});

describe('belge numarası biçimi', () => {
  it('VT-YYMMDD-NNNN üretir', () => {
    expect(formatDocumentNumber(ORDER_NUMBER_PREFIX, '260811', 42)).toBe('VT-260811-0042');
    expect(formatDocumentNumber(RETURN_NUMBER_PREFIX, '260811', 1)).toBe('VT-R-260811-0001');
  });

  it('9999’u aşınca dolgu genişler, kesilmez', () => {
    expect(formatDocumentNumber(ORDER_NUMBER_PREFIX, '260811', 12_345)).toBe('VT-260811-12345');
  });

  it('şema üretilen numarayı kabul eder', () => {
    expect(orderNumberSchema.parse('vt-260811-0042')).toBe('VT-260811-0042');
    expect(orderNumberSchema.safeParse('VT-260811-12345').success).toBe(true);
    expect(orderNumberSchema.safeParse('VT-2608-0042').success).toBe(false);
  });

  it('sıra numarasını geri okur', () => {
    expect(parseSequence('VT-260811-0042')).toBe(42);
    expect(parseSequence('VT-R-260811-0001')).toBe(1);
    expect(parseSequence(null)).toBeNull();
    expect(parseSequence('bozuk')).toBeNull();
  });
});
