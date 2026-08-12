import { describe, expect, it, vi } from 'vitest';
import { runWithContext, type RequestContext } from '../../common/request-context.js';
import { MeService, ME_EVENT, type MeActor } from './me.service.js';
import { CONSENT_DOCUMENT_VERSION } from './me.schema.js';
import type { MeRetentionPort, MeSessionPort } from './me.ports.js';

/**
 * ⚠️ BU DOSYA İKİ KVKK GÜVENCESİNİ KORUR.
 *
 *  1. RIZA KAYDI APPEND-ONLY YAZILIR ve geri çekme yan etkisini AYNI
 *     transaction'da doğurur. "Rıza geri çekildi ama fotoğraf duruyor" durumu
 *     dışarıdan görünmez; ancak burada yakalanabilir.
 *
 *  2. HESAP SİLME TALEBİ GERİ ALINABİLİR ve geri alma penceresi bir sonraki
 *     talep tarafından sessizce uzatılamaz.
 */

const ACTOR: MeActor = { userId: 'user-1', role: 'CUSTOMER' };

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const CONTEXT: RequestContext = {
  requestId: 'req-1',
  userId: ACTOR.userId,
  role: 'CUSTOMER',
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (test)',
  startedAt: Date.now(),
};

function createPrisma(overrides: Record<string, unknown> = {}) {
  const tx = {
    // ⚠️ `update`/`upsert` KASITLI OLARAK YOK. Servis bir gün rıza satırını
    //    güncellemeye kalkarsa test "tx.consentRecord.update is not a function"
    //    ile düşer — append-only kuralı böylece kodla değil, ARAÇLA korunur.
    consentRecord: { create: vi.fn().mockResolvedValue({ id: 'consent-1' }) },
    outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'evt-1' }) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    user: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const prisma = {
    consentRecord: { findMany: vi.fn().mockResolvedValue([]) },
    outboxEvent: { findFirst: vi.fn().mockResolvedValue(null) },
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: ACTOR.userId, deletionRequestedAt: null }),
    },
    $transaction: vi.fn(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx)),
    ...overrides,
  };

  return { prisma, tx };
}

function build(prismaOverrides: Record<string, unknown> = {}) {
  const { prisma, tx } = createPrisma(prismaOverrides);
  const retention: MeRetentionPort = { expireUserPhotos: vi.fn().mockResolvedValue(3) };
  const sessions: MeSessionPort = { revokeAllSessions: vi.fn().mockResolvedValue(2) };

  const service = new MeService(prisma as never, retention, sessions, silentLogger as never);

  return { service, prisma, tx, retention, sessions };
}

/** Servis IP/UA'yı istek bağlamından okur — rıza kaydının delil değeri buna bağlı. */
const withContext = async <T>(fn: () => Promise<T>): Promise<T> =>
  runWithContext(CONTEXT, fn) as Promise<T>;

describe('MeService.recordConsent — APPEND-ONLY', () => {
  it('geri çekme YENİ SATIR yazar, mevcut satırı güncellemez', async () => {
    const { service, tx } = build({
      consentRecord: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { type: 'PHOTO_PROCESSING', granted: true, createdAt: new Date('2026-01-01') },
          ]),
      },
    });

    await withContext(() =>
      service.recordConsent(ACTOR, { type: 'PHOTO_PROCESSING', granted: false }),
    );

    expect(tx.consentRecord.create).toHaveBeenCalledTimes(1);
    expect(tx.consentRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: ACTOR.userId,
          type: 'PHOTO_PROCESSING',
          granted: false,
        }),
      }),
    );
  });

  it('kayda IP, tarayıcı ve ONAYLANAN METİN SÜRÜMÜ yazılır', async () => {
    // ⚠️ Bunlar süs değil DELİLDİR: metin bir gün değiştiğinde "kullanıcı neyi
    //    onaylamıştı" sorusunun tek cevabı `documentVersion`dır.
    const { service, tx } = build();

    await withContext(() => service.recordConsent(ACTOR, { type: 'MARKETING', granted: true }));

    expect(tx.consentRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ipAddress: '203.0.113.7',
          userAgent: 'Mozilla/5.0 (test)',
          documentVersion: CONSENT_DOCUMENT_VERSION,
        }),
      }),
    );
  });

  it('istek bağlamı yoksa rıza yine KAYDEDİLİR — iradenin kaybı daha kötüdür', async () => {
    const { service, tx } = build();

    // Bilinçli olarak bağlamsız çağrı (arka plan/iç çağrı senaryosu).
    const result = await service.recordConsent(ACTOR, { type: 'MARKETING', granted: true });

    expect(result.granted).toBe(true);
    expect(tx.consentRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ipAddress: 'bilinmiyor', userAgent: 'bilinmiyor' }),
      }),
    );
  });
});

describe('MeService.recordConsent — geri çekmenin YAN ETKİSİ', () => {
  it('PHOTO_PROCESSING geri çekilince fotoğraflar silinmek üzere İŞARETLENİR', async () => {
    const { service, tx, retention } = build({
      consentRecord: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { type: 'PHOTO_PROCESSING', granted: true, createdAt: new Date('2026-01-01') },
          ]),
      },
    });

    const result = await withContext(() =>
      service.recordConsent(ACTOR, { type: 'PHOTO_PROCESSING', granted: false }),
    );

    expect(retention.expireUserPhotos).toHaveBeenCalledTimes(1);

    const [passedTx, userId, expiresAt] = vi.mocked(retention.expireUserPhotos).mock.calls[0] ?? [];
    // ⚠️ AYNI TRANSACTION: rıza satırı yazılıp fotoğraf işaretlenmezse
    //    "rıza geri çekildi ama veri duruyor" durumu oluşur ve dışarıdan
    //    görünmez.
    expect(passedTx, 'Fotoğraf işaretleme rıza satırıyla aynı transaction olmalı').toBe(tx);
    expect(userId).toBe(ACTOR.userId);
    expect(expiresAt?.getTime()).toBeLessThan(Date.now());

    expect(result.photosMarkedForDeletion).toBe(3);
    expect(result.changed).toBe(true);
  });

  it('CROSS_BORDER_TRANSFER geri çekilince de işaretlenir ve olay yayımlanır', async () => {
    const { service, tx, retention } = build({
      consentRecord: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { type: 'CROSS_BORDER_TRANSFER', granted: true, createdAt: new Date('2026-01-01') },
          ]),
      },
    });

    await withContext(() =>
      service.recordConsent(ACTOR, { type: 'CROSS_BORDER_TRANSFER', granted: false }),
    );

    expect(retention.expireUserPhotos).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: ME_EVENT.consentRevoked, aggregateId: ACTOR.userId }),
      }),
    );
  });

  it('rıza VERİLİRKEN fotoğrafa dokunulmaz', async () => {
    const { service, retention } = build();

    await withContext(() =>
      service.recordConsent(ACTOR, { type: 'PHOTO_PROCESSING', granted: true }),
    );

    expect(retention.expireUserPhotos).not.toHaveBeenCalled();
  });

  it('fotoğrafla ilgisiz rıza geri çekilince fotoğrafa dokunulmaz', async () => {
    const { service, retention } = build({
      consentRecord: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { type: 'MARKETING', granted: true, createdAt: new Date('2026-01-01') },
          ]),
      },
    });

    await withContext(() => service.recordConsent(ACTOR, { type: 'MARKETING', granted: false }));

    expect(retention.expireUserPhotos).not.toHaveBeenCalled();
  });

  it('zaten geri çekilmiş rıza tekrar çekilirse satır yazılır ama yan etki TEKRARLANMAZ', async () => {
    const { service, tx, retention } = build({
      consentRecord: {
        findMany: vi.fn().mockResolvedValue([
          { type: 'PHOTO_PROCESSING', granted: true, createdAt: new Date('2026-01-01') },
          { type: 'PHOTO_PROCESSING', granted: false, createdAt: new Date('2026-02-01') },
        ]),
      },
    });

    const result = await withContext(() =>
      service.recordConsent(ACTOR, { type: 'PHOTO_PROCESSING', granted: false }),
    );

    // Beyan yine kaydedilir: her irade beyanının kendi zamanı ve IP'si vardır.
    expect(tx.consentRecord.create).toHaveBeenCalledTimes(1);
    // Ama durum değişmediği için yan etki tetiklenmez.
    expect(result.changed).toBe(false);
    expect(retention.expireUserPhotos).not.toHaveBeenCalled();
    expect(result.photosMarkedForDeletion).toBe(0);
  });

  it('her rıza yazımı denetim izine geçer', async () => {
    const { service, tx } = build();

    await withContext(() => service.recordConsent(ACTOR, { type: 'MARKETING', granted: true }));

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('MeService.requestAccountDeletion', () => {
  it('ANINDA SİLMEZ: yalnızca deletionRequestedAt işaretlenir', async () => {
    const { service, tx } = build();
    const now = new Date('2026-08-12T10:00:00Z');

    const result = await withContext(() => service.requestAccountDeletion(ACTOR, null, now));

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: ACTOR.userId },
      data: { deletionRequestedAt: now },
    });

    // ⚠️ `status` DEĞİŞTİRİLMEZ: auth girişte `status !== 'ACTIVE'` olan hesabı
    //    reddediyor. Şimdi PENDING_DELETION yazılsaydı kullanıcı geri alma
    //    penceresi boyunca giriş yapamaz, dolayısıyla VAZGEÇEMEZDİ.
    const updateArgs = vi.mocked(tx.user.update).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(
      updateArgs.data.status,
      '⚠️ Durum değiştirilirse geri alma imkânsızlaşır',
    ).toBeUndefined();

    expect(result.status).toBe('PENDING_DELETION');
    expect(result.purgeAt.toISOString()).toBe('2026-09-11T10:00:00.000Z');
    expect(result.alreadyRequested).toBe(false);
  });

  it('TÜM OTURUMLAR aynı transaction içinde düşürülür', async () => {
    const { service, tx, sessions } = build();

    const result = await withContext(() => service.requestAccountDeletion(ACTOR));

    expect(sessions.revokeAllSessions).toHaveBeenCalledTimes(1);
    // ⚠️ Talep yazılıp oturumlar kalsaydı, hesabı ele geçiren kişi açık
    //    oturumundan talebi geri alıp erişimini sürdürebilirdi.
    expect(vi.mocked(sessions.revokeAllSessions).mock.calls[0]?.[0]).toBe(tx);
    expect(result.sessionsRevoked).toBe(2);
  });

  it('outbox olayı aynı transaction içinde yazılır — kuyruğa doğrudan yazılmaz', async () => {
    const { service, tx } = build();

    await withContext(() => service.requestAccountDeletion(ACTOR));

    expect(tx.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aggregate: 'user',
          aggregateId: ACTOR.userId,
          type: ME_EVENT.deletionRequested,
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('⚠️ İKİNCİ TALEP PENCEREYİ SIFIRLAMAZ', async () => {
    const originalRequest = new Date('2026-08-01T00:00:00Z');
    const { service, prisma, sessions } = build({
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: ACTOR.userId, deletionRequestedAt: originalRequest }),
      },
    });

    const result = await withContext(() =>
      service.requestAccountDeletion(ACTOR, null, new Date('2026-08-30T00:00:00Z')),
    );

    // 29 gün önce başlatılan silme, yeni bir talep yüzünden 30 gün daha
    // ertelenmemeli — kullanıcı beklediği tarihte silinmeli.
    expect(result.requestedAt).toEqual(originalRequest);
    expect(result.alreadyRequested).toBe(true);
    expect(result.purgeAt.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(sessions.revokeAllSessions).not.toHaveBeenCalled();
  });
});

describe('MeService.cancelAccountDeletion — TALEBİN GERİ ALINMASI', () => {
  it('pencere içinde talep geri alınır ve işaret temizlenir', async () => {
    const { service, tx } = build({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          deletionRequestedAt: new Date('2026-08-01T00:00:00Z'),
        }),
      },
    });

    const result = await service.cancelAccountDeletion(ACTOR, new Date('2026-08-10T00:00:00Z'));

    expect(result).toMatchObject({ cancelled: true });
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      // ⚠️ `deletionRequestedAt: { not: null }` koşulu: eşzamanlı iki geri alma
      //    (giriş + düğme) ikinci bir "iptal edildi" olayı yayımlamamalı.
      where: { id: ACTOR.userId, deletionRequestedAt: { not: null } },
      data: { deletionRequestedAt: null },
    });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: ME_EVENT.deletionCancelled }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('talep yoksa hiçbir şey yazılmaz ve HATA FIRLATILMAZ', async () => {
    // ⚠️ Bu metot başarılı GİRİŞTEN sonra çağrılıyor. Hata fırlatsaydı,
    //    silme talebi olmayan her kullanıcının girişi düşerdi.
    const { service, prisma } = build({
      user: { findUnique: vi.fn().mockResolvedValue({ deletionRequestedAt: null }) },
    });

    const result = await service.cancelAccountDeletion(ACTOR, new Date('2026-08-10T00:00:00Z'));

    expect(result).toEqual({ cancelled: false, reason: 'NO_REQUEST' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('pencere dolduysa geri alınmaz — hesap silinmiş olabilir', async () => {
    const { service, prisma } = build({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          deletionRequestedAt: new Date('2026-06-01T00:00:00Z'),
        }),
      },
    });

    const result = await service.cancelAccountDeletion(ACTOR, new Date('2026-08-10T00:00:00Z'));

    expect(result).toEqual({ cancelled: false, reason: 'GRACE_EXPIRED' });
    expect(
      prisma.$transaction,
      'Süresi dolmuş talep sessizce diriltilmemeli',
    ).not.toHaveBeenCalled();
  });

  it('yarışta ikinci geri alma OLAY YAYIMLAMAZ', async () => {
    const { service, tx } = build({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          deletionRequestedAt: new Date('2026-08-01T00:00:00Z'),
        }),
      },
    });

    // İlk istek satırı çoktan güncellemiş: updateMany 0 satır etkiliyor.
    tx.user.updateMany.mockResolvedValue({ count: 0 });

    await service.cancelAccountDeletion(ACTOR, new Date('2026-08-10T00:00:00Z'));

    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('MeService — veri indirme', () => {
  it('talep SENKRON çalışmaz: outbox yazılır, dosya üretilmez', async () => {
    const { service, tx } = build();
    const now = new Date('2026-08-12T10:00:00Z');

    const result = await withContext(() => service.requestDataExport(ACTOR, now));

    expect(tx.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: ME_EVENT.dataExportRequested }),
      }),
    );
    expect(result.status).toBe('PREPARING');
    // Bağlantı 48 saat geçerli: süresiz bir bağlantı, e-postası ele geçen
    // kullanıcının tüm verisini aylar sonra bile indirilebilir bırakırdı.
    expect(result.linkExpiresAt?.toISOString()).toBe('2026-08-14T10:00:00.000Z');
    expect(result.linkValidHours).toBe(48);
  });

  it('bekleyen talep varken İKİNCİSİ AÇILMAZ', async () => {
    const { service, tx } = build({
      outboxEvent: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ createdAt: new Date('2026-08-12T09:00:00Z'), publishedAt: null }),
      },
    });

    const result = await withContext(() =>
      service.requestDataExport(ACTOR, new Date('2026-08-12T10:00:00Z')),
    );

    expect(result.status).toBe('PREPARING');
    expect(result.requestedAt?.toISOString()).toBe('2026-08-12T09:00:00.000Z');
    expect(
      tx.outboxEvent.create,
      'Her istek yeni bir ağır iş kuyruğa koymamalı',
    ).not.toHaveBeenCalled();
  });

  it('bağlantısı ölmüş talep yeni talebi ENGELLEMEZ', async () => {
    const { service, tx } = build({
      outboxEvent: {
        findFirst: vi.fn().mockResolvedValue({
          createdAt: new Date('2026-08-01T00:00:00Z'),
          publishedAt: new Date('2026-08-01T00:05:00Z'),
        }),
      },
    });

    await withContext(() => service.requestDataExport(ACTOR, new Date('2026-08-12T10:00:00Z')));

    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);
  });

  it('hiç talep yoksa durum NONE', async () => {
    const { service } = build();

    const view = await service.getDataExport(ACTOR.userId, new Date('2026-08-12T10:00:00Z'));

    expect(view.status).toBe('NONE');
    expect(view.requestedAt).toBeNull();
  });
});

describe('MeService.listConsents', () => {
  it('tüm türleri geçmişiyle birlikte döndürür', async () => {
    const { service } = build({
      consentRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            type: 'PHOTO_PROCESSING',
            granted: false,
            createdAt: new Date('2026-04-01'),
            documentVersion: 'kvkk-2026-01',
          },
          {
            type: 'PHOTO_PROCESSING',
            granted: true,
            createdAt: new Date('2026-03-01'),
            documentVersion: 'kvkk-2025-06',
          },
        ]),
      },
    });

    const view = await service.listConsents(ACTOR.userId);
    const photo = view.consents.find((state) => state.type === 'PHOTO_PROCESSING');

    expect(photo?.granted).toBe(false);
    expect(photo?.lastGrantedAt).toEqual(new Date('2026-03-01'));
    expect(photo?.history).toHaveLength(2);
    expect(view.documentVersion).toBe(CONSENT_DOCUMENT_VERSION);
  });
});
