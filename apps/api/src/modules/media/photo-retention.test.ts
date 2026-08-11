import { describe, expect, it } from 'vitest';
import { PHOTO_RETENTION } from '@vt/config';
import { photoExpiresAt, requiresStorageConsent } from './photo-retention.js';

const now = new Date('2026-08-11T12:00:00.000Z');

describe('photoExpiresAt — KVKK saklama süresi', () => {
  it('tek seferlik fotoğraf sabitteki saat kadar yaşar', () => {
    const expires = photoExpiresAt('ONE_TIME', now);
    const hours = (expires.getTime() - now.getTime()) / (60 * 60 * 1000);
    expect(hours).toBe(PHOTO_RETENTION.oneTimeHours);
  });

  it('profilde saklanan fotoğraf sabitteki gün kadar yaşar', () => {
    const expires = photoExpiresAt('SAVED_PROFILE', now);
    const days = (expires.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(PHOTO_RETENTION.savedProfileDays);
  });

  it('tek seferlik saklama her zaman profilden kısadır', () => {
    expect(photoExpiresAt('ONE_TIME', now).getTime()).toBeLessThan(
      photoExpiresAt('SAVED_PROFILE', now).getTime(),
    );
  });

  it('bitiş tarihi her zaman gelecektedir — aksi hâlde kayıt hiç silinmez', () => {
    for (const purpose of ['ONE_TIME', 'SAVED_PROFILE'] as const) {
      expect(photoExpiresAt(purpose, now).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it('verilen anı değiştirmez (saf fonksiyon)', () => {
    const reference = new Date(now);
    photoExpiresAt('ONE_TIME', reference);
    expect(reference.toISOString()).toBe(now.toISOString());
  });
});

describe('requiresStorageConsent', () => {
  it('yalnızca profilde saklama ayrı rıza ister', () => {
    expect(requiresStorageConsent('SAVED_PROFILE')).toBe(true);
    expect(requiresStorageConsent('ONE_TIME')).toBe(false);
  });
});
