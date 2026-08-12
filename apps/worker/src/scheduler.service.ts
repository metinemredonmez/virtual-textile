import { Inject, Injectable, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Logger } from 'pino';
import { PHOTO_RETENTION, env } from '@vt/config';
import { appError } from '@vt/contracts';
import { STORAGE_STATUS, WORKER_LOGGER, type StorageStatus } from './infra.module.js';
import { OutboxDispatcher } from './jobs/outbox.dispatcher.js';
import { PhotoRetentionJob, ReservationReleaseJob } from './jobs/photo-retention.job.js';
import { AccountDeletionJob } from './jobs/account-deletion.job.js';
import { DataExportJob } from './jobs/data-export.job.js';

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
    /**
     * ⚠️ Depo durumu sağlık raporunda YAYINLANIR. Yer tutucu depo `delete()`
     *    çağrısında sessizce başarılı döner ama nesneyi SİLMEZ: fotoğraf
     *    temizliği cron'u zamanında çalışmış görünürken saklama süresi
     *    taahhüdü fiilen yerine getirilmemiş olur. `staleJobs` bunu YAKALAYAMAZ
     *    — iş gerçekten çalışmıştır. Dışarıdan görünen tek işaret budur.
     */
    @Inject(STORAGE_STATUS) private readonly storage: StorageStatus,
    /**
     * ⚠️ KVKK İŞLERİ İSTEĞE BAĞLI ENJEKTE EDİLİR — ve bu bir gevşeklik DEĞİL,
     *    bilinçli bir alarm tasarımıdır.
     *
     *    Sağlayıcı kayıtları `infra.module.ts` içindedir ve o dosya bu görevin
     *    yazma kapsamı dışında (NEEDS-WIRING, bkz. görev raporu). Bağımlılık
     *    ZORUNLU olsaydı worker HİÇ AÇILMAZDI: outbox, bildirim ve fotoğraf
     *    temizliği de dururdu — yani eksik bir kayıt, çalışan her şeyi
     *    öldürürdü.
     *
     *    İsteğe bağlı olduğunda ise iş çalışmaz ama SESSİZ KALMAZ: `guard`
     *    her turda hata yazar, `health()` işi hem `staleJobs` içinde hem de
     *    `lastError` ile raporlar. İzleme bunu alarma çevirir — tam olarak
     *    fotoğraf temizliği için kurulan mekanizmanın aynısı.
     */
    @Optional() private readonly accountDeletion?: AccountDeletionJob,
    @Optional() private readonly dataExport?: DataExportJob,
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

  /**
   * ⚠️ ÖLÜ MEKTUP DENETİMİ — kaybolmuş domain olaylarını görünür kılar.
   *
   * Dağıtım turundan AYRI bir cron ve daha seyrek: `dispatch` on saniyede bir
   * koşuyor, `getFailed` ise Redis'te bir küme taramasıdır. Aynı guard'ın içine
   * konulsaydı ölü mektup taraması dağıtımın hızını belirlerdi.
   *
   * ⚠️ Ayrı isim = ayrı sağlık satırı: bu iş sessizce durursa kayıp olaylar
   *    yeniden görünmez olur ve DURDUĞU da görünmez olurdu.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'outbox-dead-letter' })
  async auditOutboxDeadLetters(): Promise<void> {
    await this.guard('outbox-dead-letter', () => this.outbox.auditDeadLetters());
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
   * ⚠️ KVKK: geri alma penceresi dolmuş hesapların anonimleştirilmesi.
   *
   * GÜNDE BİR KEZ ve gecenin ölü saatinde: iş hesap başına onlarca tabloya
   * yazar ve depo siler. Gündüz çalıştırılsaydı, alışverişin yoğun olduğu
   * saatlerde sipariş tablosunda uzun süren kilitler tutardı.
   *
   * ⚠️ Sıklığın artırılmasına gerek yok: 30 günlük pencerede bir günlük
   *    gecikme taahhüdü bozmaz, ama iki prosesin aynı hesabı işlemesi bozar
   *    (bkz. `runsCronJobs` — yalnızca 'core').
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'account-deletion' })
  async purgeDeletedAccounts(): Promise<void> {
    await this.guard('account-deletion', async () => {
      if (!this.accountDeletion) {
        throw appError('INTERNAL_ERROR', {
          internalMessage:
            'AccountDeletionJob sağlayıcısı kayıtlı değil — silme talepleri işlenmiyor',
        });
      }
      return this.accountDeletion.run();
    });
  }

  /**
   * ⚠️ KVKK: veri indirme taleplerinin hazırlanması.
   *
   * Fotoğraf temizliğinden SIK, hesap silmeden sık: kullanıcı bu talebin
   * karşısında BEKLİYOR ve bağlantının ömrü 48 saat. Saatte bir çalışsaydı
   * beklemenin yarısı kuyrukta geçerdi.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'data-export' })
  async prepareDataExports(): Promise<void> {
    await this.guard('data-export', async () => {
      if (!this.dataExport) {
        throw appError('INTERNAL_ERROR', {
          internalMessage:
            'DataExportJob sağlayıcısı kayıtlı değil — veri indirme talepleri işlenmiyor',
        });
      }
      return this.dataExport.run();
    });
  }

  /**
   * Sağlık raporu — izleme servisi bunu okur.
   * `staleJobs` boş değilse bir cron beklenenden uzun süredir çalışmıyor demektir.
   * `storage.deleteWorks` false ise cron'lar çalışsa bile fotoğraf SİLİNMİYOR.
   */
  health(): {
    role: string;
    jobs: Array<{ name: string; lastRunAt: string | null; lastError: string | null }>;
    staleJobs: string[];
    storage: StorageStatus;
  } {
    // 'media' rolü cron çalıştırmaz; bayat iş raporu üretmesi yanıltıcı olur.
    // ⚠️ Depo durumu bu erken dönüşte de raporlanır: 'media' prosesi fotoğraf
    //    YÜKLER, dolayısıyla deposunun gerçek olup olmadığı orada da anlamlıdır.
    if (!this.runsCronJobs) {
      return { role: env().WORKER_ROLE, jobs: [], staleJobs: [], storage: this.storage };
    }
    const expectedIntervalMs: Record<string, number> = {
      outbox: 60_000,
      // Dakikalık iş için iki tur + sapma payı.
      'outbox-dead-letter': 5 * 60_000,
      reservations: 5 * 60_000,
      'photo-retention': PHOTO_RETENTION.cleanupIntervalMinutes * 60_000 * 2,
      /**
       * ⚠️ KVKK işleri sağlık raporunun PARÇASIDIR ve olmaları şart.
       *    Silme işinin sessizce durması, "30 gün sonra sileceğiz" sözünün
       *    tutulmaması demektir ve bu dışarıdan HİÇBİR biçimde görünmez:
       *    kullanıcı arayüzde "silme talebiniz alındı" yazısını görmeye devam
       *    eder. Tek dış işaret bu satırdır.
       *
       *    Eşik iki tur: günlük iş için 48 saat, beş dakikalık iş için 15
       *    dakika. Tek tura eşit bir eşik, normal zamanlama sapmasında bile
       *    yanlış alarm üretir ve alarm gürültüsü alarmı öldürür.
       */
      'account-deletion': 48 * 60 * 60_000,
      'data-export': 15 * 60_000,
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

    return { role: env().WORKER_ROLE, jobs, staleJobs, storage: this.storage };
  }
}
