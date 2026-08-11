import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Logger } from 'pino';
import { PHOTO_RETENTION, env } from '@vt/config';
import { WORKER_LOGGER } from './infra.module.js';
import { OutboxDispatcher } from './jobs/outbox.dispatcher.js';
import { PhotoRetentionJob, ReservationReleaseJob } from './jobs/photo-retention.job.js';

/**
 * ZAMANLANMIŞ İŞLER
 *
 * ⚠️ Her iş kendi son çalışma zamanını `lastRunAt` içine yazar. Sağlık ucu bunu
 *    yayınlar; izleme, beklenen aralığın belirgin biçimde üstündeyse alarm üretir.
 *    Sessizce duran bir cron, çalışmayan bir crondan daha tehlikelidir — özellikle
 *    fotoğraf temizliği için, çünkü orada saklama süresi taahhüdü ihlal edilir.
 */
@Injectable()
export class SchedulerService {
  private readonly lastRunAt = new Map<string, Date>();
  private readonly lastError = new Map<string, string>();

  /**
   * ⚠️ Zamanlanmış işler YALNIZCA 'core' rolünde çalışır.
   * 'media' prosesi de çalıştırsaydı, iki proses aynı anda aynı fotoğrafı
   * silmeye ve aynı rezervasyonu serbest bırakmaya kalkardı — stok iki kez
   * artardı. Rol ayrımı bunun tek savunması.
   */
  private readonly runsCronJobs = env().WORKER_ROLE !== 'media';

  constructor(
    private readonly outbox: OutboxDispatcher,
    private readonly photoRetention: PhotoRetentionJob,
    private readonly reservations: ReservationReleaseJob,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  private async guard(name: string, fn: () => Promise<unknown>): Promise<void> {
    if (!this.runsCronJobs) return;
    try {
      await fn();
      this.lastRunAt.set(name, new Date());
      this.lastError.delete(name);
    } catch (error) {
      // Bir turun patlaması zamanlayıcıyı durdurmamalı.
      this.lastError.set(name, error instanceof Error ? error.message : 'bilinmeyen');
      this.logger.error({ job: name, err: error }, 'Zamanlanmış iş başarısız');
    }
  }

  /** Outbox: sipariş oluştuktan sonra bildirimin gecikmemesi için sık. */
  @Cron(CronExpression.EVERY_10_SECONDS, { name: 'outbox' })
  async dispatchOutbox(): Promise<void> {
    await this.guard('outbox', () => this.outbox.dispatch());
  }

  /** Stok rezervasyonu güvenlik ağı. */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'reservations' })
  async releaseReservations(): Promise<void> {
    await this.guard('reservations', () => this.reservations.run());
  }

  /** ⚠️ KVKK: süresi dolmuş kullanıcı fotoğraflarının silinmesi. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'photo-retention' })
  async cleanupPhotos(): Promise<void> {
    await this.guard('photo-retention', () => this.photoRetention.run());
  }

  /**
   * Sağlık raporu — izleme servisi bunu okur.
   * `staleJobs` boş değilse bir cron beklenenden uzun süredir çalışmıyor demektir.
   */
  health(): {
    role: string;
    jobs: Array<{ name: string; lastRunAt: string | null; lastError: string | null }>;
    staleJobs: string[];
  } {
    // 'media' rolü cron çalıştırmaz; bayat iş raporu üretmesi yanıltıcı olur.
    if (!this.runsCronJobs) {
      return { role: env().WORKER_ROLE, jobs: [], staleJobs: [] };
    }
    const expectedIntervalMs: Record<string, number> = {
      outbox: 60_000,
      reservations: 5 * 60_000,
      'photo-retention': PHOTO_RETENTION.cleanupIntervalMinutes * 60_000 * 2,
    };

    const now = Date.now();
    const staleJobs: string[] = [];
    const jobs = Object.keys(expectedIntervalMs).map((name) => {
      const last = this.lastRunAt.get(name);
      if (!last || now - last.getTime() > expectedIntervalMs[name]!) {
        staleJobs.push(name);
      }
      return {
        name,
        lastRunAt: last?.toISOString() ?? null,
        lastError: this.lastError.get(name) ?? null,
      };
    });

    return { role: env().WORKER_ROLE, jobs, staleJobs };
  }
}
