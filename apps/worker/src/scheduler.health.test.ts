import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { Env } from '@vt/config';
import type { StorageStatus } from './infra.module.js';
import type { OutboxDispatcher } from './jobs/outbox.dispatcher.js';
import type { PhotoRetentionJob, ReservationReleaseJob } from './jobs/photo-retention.job.js';

/**
 * ⚠️ `env()` MOCK'LANIYOR — gerçek `env()` süreç ortamını doğrular ve eksik bir
 *    değişkende FIRLATIR. Testte bu, ölçmek istediğimiz şeyin (sağlık raporu)
 *    yerine ortam kurulumunu ölçmek olurdu.
 *
 * `importOriginal` ile gerçek modül korunuyor çünkü `SchedulerService`
 * `PHOTO_RETENTION` sabitini de okuyor; yalnızca `env` değiştiriliyor.
 * Servisin env'den okuduğu TEK alan `WORKER_ROLE`; şemanın tamamını kurmak
 * testi ölçtüğü şeyden uzaklaştırırdı.
 */
let role: Env['WORKER_ROLE'] = 'core';

vi.mock('@vt/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vt/config')>();
  return { ...actual, env: (): Env => ({ WORKER_ROLE: role }) as Env };
});

const GERCEK_DEPO: StorageStatus = {
  driver: 'r2',
  configured: true,
  deleteWorks: true,
  reason: null,
};

const YER_TUTUCU: StorageStatus = {
  driver: 'placeholder',
  configured: false,
  deleteWorks: false,
  reason: 'anahtar-yok',
};

function logger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

async function scheduler(storage: StorageStatus) {
  const { SchedulerService } = await import('./scheduler.service.js');
  const stub = {} as OutboxDispatcher & PhotoRetentionJob & ReservationReleaseJob;
  return new SchedulerService(stub, stub, stub, logger(), storage);
}

describe('SchedulerService.health — depo durumu', () => {
  it('⚠️ yer tutucu depoyu rapor eder — cron çalışsa bile fotoğraf SİLİNMİYOR', async () => {
    role = 'core';
    const health = (await scheduler(YER_TUTUCU)).health();

    // `staleJobs` bu durumu YAKALAYAMAZ: iş gerçekten çalışır, yalnızca
    // hiçbir nesne silinmez. Dışarıdan görünen tek işaret budur.
    expect(health.storage.deleteWorks).toBe(false);
    expect(health.storage.reason).toBe('anahtar-yok');
    expect(health.staleJobs).toContain('photo-retention');
  });

  it('gerçek depoyu rapor eder', async () => {
    role = 'core';
    const health = (await scheduler(GERCEK_DEPO)).health();

    expect(health.storage).toEqual(GERCEK_DEPO);
    expect(health.role).toBe('core');
  });

  it("⚠️ 'media' rolünün ERKEN DÖNÜŞÜNDE de depo raporlanır", async () => {
    role = 'media';
    const health = (await scheduler(YER_TUTUCU)).health();

    // 'media' prosesi cron çalıştırmaz ama fotoğraf YÜKLER; deposunun gerçek
    // olup olmadığı orada da anlamlıdır. Erken dönüş bunu düşürmemeli.
    expect(health.jobs).toEqual([]);
    expect(health.staleJobs).toEqual([]);
    expect(health.storage).toEqual(YER_TUTUCU);
  });
});
