import { describe, expect, it } from 'vitest';
import { PHOTO_RETENTION } from '@vt/config';
import {
  DELETION_GRACE_DAYS,
  deletionPurgeAt,
  evaluateDeletionCancellation,
  remainingGraceDays,
} from './account-deletion.js';

/**
 * ⚠️ GERİ ALMA PENCERESİ BU DOSYADA KORUNUYOR.
 *
 * Hesap silme geri alınamaz bir işlemdir; kullanıcıların önemli bir kısmı
 * öfkeyle, yanlışlıkla ya da ele geçirilmiş bir oturumdan siler. Pencerenin
 * sessizce daralması ya da kapanması, geri dönüşü olmayan veri kaybı demektir.
 *
 * Sınanan asıl şey SINIR DAVRANIŞIDIR: penceresi dolmuş bir talebin geri
 * alınabilir görünmesi, worker'ın yarısını sildiği bir hesabı kullanıcıya
 * "geri verdik" diye teslim etmek olurdu.
 */

const at = (iso: string): Date => new Date(iso);
const DAY_MS = 24 * 60 * 60 * 1000;

describe('deletionPurgeAt', () => {
  it('yapılandırmadaki geri alma penceresini kullanır (30 gün)', () => {
    expect(DELETION_GRACE_DAYS).toBe(PHOTO_RETENTION.accountDeletionGraceDays);

    const requestedAt = at('2026-08-01T00:00:00Z');
    expect(deletionPurgeAt(requestedAt).toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('pencere dışarıdan verilebilir — kural değişirse test saat beklemez', () => {
    expect(deletionPurgeAt(at('2026-08-01T00:00:00Z'), 7).toISOString()).toBe(
      '2026-08-08T00:00:00.000Z',
    );
  });
});

describe('evaluateDeletionCancellation — silme talebinin GERİ ALINMASI', () => {
  it('talep yoksa geri alınacak bir şey de yoktur', () => {
    const decision = evaluateDeletionCancellation(null, at('2026-08-12T00:00:00Z'));

    expect(decision.cancellable).toBe(false);
    expect(decision).toMatchObject({ reason: 'NO_REQUEST', purgeAt: null });
  });

  it('pencere içinde talep geri alınabilir', () => {
    const requestedAt = at('2026-08-01T00:00:00Z');
    // Talepten 1 gün sonra giriş yapıldı.
    const decision = evaluateDeletionCancellation(requestedAt, at('2026-08-02T00:00:00Z'));

    expect(decision).toMatchObject({ cancellable: true, remainingMs: 29 * DAY_MS });
    expect(decision.cancellable && decision.purgeAt.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('pencerenin SON ANINDA hâlâ geri alınabilir', () => {
    const requestedAt = at('2026-08-01T00:00:00Z');
    // Silme anından 1 saniye önce.
    const decision = evaluateDeletionCancellation(requestedAt, at('2026-08-30T23:59:59Z'));

    expect(decision.cancellable, 'Süre dolmadan geri alma reddedilemez').toBe(true);
  });

  it('⚠️ TAM SINIRDA geri alma REDDEDİLİR (fail-closed)', () => {
    const requestedAt = at('2026-08-01T00:00:00Z');
    // now === purgeAt: worker silme turunu başlatmış OLABİLİR.
    const decision = evaluateDeletionCancellation(requestedAt, at('2026-08-31T00:00:00Z'));

    expect(
      decision.cancellable,
      '⚠️ Sınırda "geri aldın" demek, yarısı silinmiş bir hesabı geri vermek olur',
    ).toBe(false);
    expect(decision).toMatchObject({ reason: 'GRACE_EXPIRED' });
  });

  it('pencere dolduktan sonra geri alınamaz', () => {
    const decision = evaluateDeletionCancellation(
      at('2026-08-01T00:00:00Z'),
      at('2026-09-15T00:00:00Z'),
    );

    expect(decision.cancellable).toBe(false);
    expect(decision).toMatchObject({ reason: 'GRACE_EXPIRED' });
    // Silme anı yine de bildiriliyor: destek ekibi "ne zaman silindi"
    // sorusunu cevaplayabilmeli.
    expect(decision.cancellable === false && decision.purgeAt?.toISOString()).toBe(
      '2026-08-31T00:00:00.000Z',
    );
  });
});

describe('remainingGraceDays', () => {
  it('kullanıcı lehine YUKARI yuvarlanır', () => {
    const requestedAt = at('2026-08-01T00:00:00Z');

    // 29 gün 12 saat kaldı → "30 gün" değil ama "29" da değil: 30'a yuvarlanır.
    expect(remainingGraceDays(requestedAt, at('2026-08-01T12:00:00Z'))).toBe(30);
    // Son 6 saat: "0 gün kaldı" yazan bir arayüzde kimse hakkı olduğunu anlamaz.
    expect(remainingGraceDays(requestedAt, at('2026-08-30T18:00:00Z'))).toBe(1);
  });

  it('talep yoksa veya pencere dolduysa sıfırdır', () => {
    expect(remainingGraceDays(null, at('2026-08-12T00:00:00Z'))).toBe(0);
    expect(remainingGraceDays(at('2026-01-01T00:00:00Z'), at('2026-08-12T00:00:00Z'))).toBe(0);
  });
});
