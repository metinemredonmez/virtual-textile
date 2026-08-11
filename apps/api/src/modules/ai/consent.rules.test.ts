import { describe, expect, it } from 'vitest';
import {
  evaluateTryOnConsent,
  latestConsentByType,
  type ConsentRecordLike,
} from './consent.rules.js';

const at = (iso: string): Date => new Date(iso);

function record(type: ConsentRecordLike['type'], granted: boolean, iso: string): ConsentRecordLike {
  return { type, granted, createdAt: at(iso) };
}

describe('latestConsentByType', () => {
  it('aynı türün en son kaydını seçer', () => {
    const latest = latestConsentByType([
      record('PHOTO_PROCESSING', true, '2026-01-01T10:00:00Z'),
      record('PHOTO_PROCESSING', false, '2026-02-01T10:00:00Z'),
    ]);

    expect(latest.get('PHOTO_PROCESSING')).toBe(false);
  });

  it('kayıtların geliş sırasından etkilenmez', () => {
    const latest = latestConsentByType([
      record('PHOTO_PROCESSING', false, '2026-02-01T10:00:00Z'),
      record('PHOTO_PROCESSING', true, '2026-01-01T10:00:00Z'),
    ]);

    expect(latest.get('PHOTO_PROCESSING')).toBe(false);
  });

  it('rıza geri çekilip yeniden verilirse son durum geçerlidir', () => {
    const latest = latestConsentByType([
      record('CROSS_BORDER_TRANSFER', true, '2026-01-01T10:00:00Z'),
      record('CROSS_BORDER_TRANSFER', false, '2026-02-01T10:00:00Z'),
      record('CROSS_BORDER_TRANSFER', true, '2026-03-01T10:00:00Z'),
    ]);

    expect(latest.get('CROSS_BORDER_TRANSFER')).toBe(true);
  });

  it('eşit zaman damgasında GERİ ÇEKME kazanır (fail-closed)', () => {
    // Aynı milisaniyede yazılmış iki kayıtta belirsizlik veri işleme
    // aleyhine çözülmeli — aksi hâlde rızasız işleme kapısı açılır.
    const latest = latestConsentByType([
      record('PHOTO_PROCESSING', false, '2026-01-01T10:00:00Z'),
      record('PHOTO_PROCESSING', true, '2026-01-01T10:00:00Z'),
    ]);

    expect(latest.get('PHOTO_PROCESSING')).toBe(false);
  });
});

describe('evaluateTryOnConsent', () => {
  const bothGranted = [
    record('PHOTO_PROCESSING', true, '2026-01-01T10:00:00Z'),
    record('CROSS_BORDER_TRANSFER', true, '2026-01-01T10:00:00Z'),
  ];

  it('iki rıza da açıksa izin verir', () => {
    expect(evaluateTryOnConsent(bothGranted)).toEqual({ allowed: true });
  });

  it('hiç kayıt yoksa reddeder (misafir kullanıcı durumu)', () => {
    const decision = evaluateTryOnConsent([]);

    expect(decision).toEqual({
      allowed: false,
      code: 'CONSENT_REQUIRED',
      missing: 'PHOTO_PROCESSING',
    });
  });

  it('fotoğraf işleme rızası yoksa CONSENT_REQUIRED döner', () => {
    const decision = evaluateTryOnConsent([
      record('PHOTO_PROCESSING', false, '2026-01-01T10:00:00Z'),
      record('CROSS_BORDER_TRANSFER', true, '2026-01-01T10:00:00Z'),
    ]);

    expect(decision).toMatchObject({ allowed: false, code: 'CONSENT_REQUIRED' });
  });

  it('yurt dışı aktarım rızası yoksa CONSENT_CROSS_BORDER_REQUIRED döner', () => {
    // ⚠️ Fotoğraf yurt dışındaki sağlayıcıya gider; bu ayrı bir rızadır
    // (KVKK md.9) ve fotoğraf işleme rızası onun yerine geçmez.
    const decision = evaluateTryOnConsent([
      record('PHOTO_PROCESSING', true, '2026-01-01T10:00:00Z'),
    ]);

    expect(decision).toEqual({
      allowed: false,
      code: 'CONSENT_CROSS_BORDER_REQUIRED',
      missing: 'CROSS_BORDER_TRANSFER',
    });
  });

  it('aktarım rızası sonradan geri çekilmişse reddeder', () => {
    const decision = evaluateTryOnConsent([
      record('PHOTO_PROCESSING', true, '2026-01-01T10:00:00Z'),
      record('CROSS_BORDER_TRANSFER', true, '2026-01-01T10:00:00Z'),
      record('CROSS_BORDER_TRANSFER', false, '2026-06-01T10:00:00Z'),
    ]);

    expect(decision).toMatchObject({ allowed: false, code: 'CONSENT_CROSS_BORDER_REQUIRED' });
  });

  it('ilgisiz rızalar (pazarlama) kararı etkilemez', () => {
    expect(
      evaluateTryOnConsent([...bothGranted, record('MARKETING', false, '2026-05-01T10:00:00Z')]),
    ).toEqual({ allowed: true });
  });

  it('ikisi de eksikse önce fotoğraf işleme rızası bildirilir', () => {
    // En temel eksik önce söylenmeli; bağlamsız bir "yurt dışı aktarımı"
    // mesajı kullanıcı için anlamsızdır.
    expect(evaluateTryOnConsent([])).toMatchObject({ missing: 'PHOTO_PROCESSING' });
  });
});
