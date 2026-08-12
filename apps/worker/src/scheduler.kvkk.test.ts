import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { Env } from '@vt/config';
import type { StorageStatus } from './infra.module.js';
import type { OutboxDispatcher } from './jobs/outbox.dispatcher.js';
import type { PhotoRetentionJob, ReservationReleaseJob } from './jobs/photo-retention.job.js';
import type { AccountDeletionJob } from './jobs/account-deletion.job.js';
import type { DataExportJob } from './jobs/data-export.job.js';

/**
 * ⚠️ `env()` MOCK'LANIYOR — gerçek `env()` süreç ortamını doğrular ve eksik bir
 *    değişkende FIRLATIR. Aynı gerekçe scheduler.health.test.ts'te de geçerli.
 */
let role: Env['WORKER_ROLE'] = 'core';

vi.mock('@vt/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vt/config')>();
  return { ...actual, env: (): Env => ({ WORKER_ROLE: role }) as Env };
});

const DEPO: StorageStatus = { driver: 'r2', configured: true, deleteWorks: true, reason: null };

function logger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

async function scheduler(options: { wired: boolean }) {
  const { SchedulerService } = await import('./scheduler.service.js');
  const stub = {} as OutboxDispatcher & PhotoRetentionJob & ReservationReleaseJob;

  const accountDeletion = { run: vi.fn().mockResolvedValue({}) };
  const dataExport = { run: vi.fn().mockResolvedValue({}) };

  const service = new SchedulerService(
    stub,
    stub,
    stub,
    logger(),
    DEPO,
    options.wired ? (accountDeletion as unknown as AccountDeletionJob) : undefined,
    options.wired ? (dataExport as unknown as DataExportJob) : undefined,
  );

  return { service, accountDeletion, dataExport };
}

function jobEntry(
  health: ReturnType<Awaited<ReturnType<typeof scheduler>>['service']['health']>,
  name: string,
) {
  return health.jobs.find((job) => job.name === name);
}

describe('SchedulerService — KVKK işleri sağlık raporunda', () => {
  it('⚠️ hiç çalışmamış KVKK işleri BAYAT raporlanır', async () => {
    role = 'core';
    const { service } = await scheduler({ wired: true });

    const health = service.health();

    // Silme işinin sessizce durması, "30 gün sonra sileceğiz" sözünün
    // tutulmaması demektir ve dışarıdan HİÇBİR biçimde görünmez: kullanıcı
    // arayüzde "talebiniz alındı" yazısını görmeye devam eder.
    expect(health.staleJobs).toContain('account-deletion');
    expect(health.staleJobs).toContain('data-export');
  });

  it('başarılı turdan sonra bayat listeden düşer', async () => {
    role = 'core';
    const { service, accountDeletion, dataExport } = await scheduler({ wired: true });

    await service.purgeDeletedAccounts();
    await service.prepareDataExports();

    expect(accountDeletion.run).toHaveBeenCalledTimes(1);
    expect(dataExport.run).toHaveBeenCalledTimes(1);

    const health = service.health();
    expect(health.staleJobs).not.toContain('account-deletion');
    expect(health.staleJobs).not.toContain('data-export');
    expect(jobEntry(health, 'account-deletion')?.lastError).toBeNull();
  });

  it('⚠️ sağlayıcı KAYITLI DEĞİLSE sessiz kalmaz — hata raporlanır', async () => {
    role = 'core';
    const { service } = await scheduler({ wired: false });

    await service.purgeDeletedAccounts();
    await service.prepareDataExports();

    const health = service.health();
    // Eksik bağlama, çalışmayan bir cron'la aynı sonucu doğurur; tek fark
    // sebebinin okunabilir olmasıdır. Her ikisi de alarm üretmelidir.
    expect(jobEntry(health, 'account-deletion')?.lastError).toBeTruthy();
    expect(jobEntry(health, 'data-export')?.lastError).toBeTruthy();
    expect(health.staleJobs).toContain('account-deletion');
    expect(health.staleJobs).toContain('data-export');
  });

  it("⚠️ 'media' rolünde KVKK cron'ları ÇALIŞMAZ", async () => {
    role = 'media';
    const { service, accountDeletion, dataExport } = await scheduler({ wired: true });

    await service.purgeDeletedAccounts();
    await service.prepareDataExports();

    // İki proses de çalıştırsaydı aynı hesabı iki kez silmeye kalkarlar,
    // ikinci tur depoda olmayan nesneleri silmeye çalışıp hata sayardı.
    expect(accountDeletion.run).not.toHaveBeenCalled();
    expect(dataExport.run).not.toHaveBeenCalled();
    expect(service.health().jobs).toEqual([]);
  });
});
