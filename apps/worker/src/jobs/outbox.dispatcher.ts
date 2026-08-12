import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { PrismaClient } from '@vt/db';
import type { Logger } from 'pino';
import { DEFAULT_JOB_OPTIONS, QUEUE, type DomainEventJobData } from '../queues.js';

const BATCH_SIZE = 100;
/** Bu yaşı geçmiş yayınlanmamış olay = bir şeyler bozuk, alarm üret. */
const STALE_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * OUTBOX DAĞITICI
 *
 * Domain event'ler iş verisiyle AYNI transaction'da `OutboxEvent` tablosuna
 * yazılır. Bu döngü onları kuyruğa taşır.
 *
 * Neden doğrudan kuyruğa yazılmıyor:
 *  - Sipariş transaction'ı içinde kuyruğa yazarsak ve transaction geri alınırsa,
 *    var olmayan bir sipariş için bildirim gider.
 *  - Transaction'dan sonra yazarsak ve arada süreç ölürse, sipariş oluşur ama
 *    bildirim hiç gitmez.
 * Outbox ikisini de çözer: yazma atomiktir, teslimat en az bir kez garantidir.
 *
 * ⚠️ EN AZ BİR KEZ teslimat. Tüketiciler idempotent olmalıdır.
 *
 * ⚠️⚠️ GARANTİNİN SINIRI: "EN AZ BİR KEZ" yalnızca KUYRUĞA KADAR geçerlidir.
 *      Olay kuyruğa girdiği an `publishedAt` doldurulur ve bu döngü onu bir daha
 *      görmez. Tüketici 3 denemede de başarısız olursa iş BullMQ'nun `failed`
 *      kümesinde kalır, outbox satırı ise "yayınlandı" görünür — yani olay
 *      SESSİZCE ve KALICI olarak kaybolur: ne bildirim gider, ne gardıroba satır
 *      düşer, ne de bunu gören bir kayıt olur.
 *
 *      `auditDeadLetters()` bu kör noktayı kapatır: deneme hakkı biten her işi
 *      OUTBOX SATIRINA yazar (`attempts`, `lastError`). Kayıp hâlâ kayıptır ama
 *      artık GÖRÜNÜRDÜR ve tek bir SQL sorgusuyla listelenebilir.
 */
@Injectable()
export class OutboxDispatcher implements OnModuleDestroy {
  private readonly queue: Queue<DomainEventJobData>;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    connection: Redis,
    private readonly logger: Logger,
  ) {
    this.queue = new Queue<DomainEventJobData>(QUEUE.DOMAIN_EVENT, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }

  /**
   * Bir turda en fazla BATCH_SIZE olay taşır.
   *
   * Eşzamanlı çalışan iki worker olsa bile aynı olay iki kez kuyruğa girerse
   * sorun olmaz: BullMQ iş kimliği outbox kimliğidir, ikinci ekleme yok sayılır.
   */
  async dispatch(): Promise<{ published: number; stale: number }> {
    if (this.running) return { published: 0, stale: 0 };
    this.running = true;

    try {
      const pending = await this.prisma.outboxEvent.findMany({
        where: { publishedAt: null },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
      });

      if (pending.length === 0) return { published: 0, stale: 0 };

      let published = 0;
      let stale = 0;
      const now = Date.now();

      for (const event of pending) {
        if (now - event.createdAt.getTime() > STALE_THRESHOLD_MS) stale += 1;

        try {
          await this.queue.add(
            event.type,
            {
              outboxEventId: event.id,
              aggregate: event.aggregate,
              aggregateId: event.aggregateId,
              type: event.type,
              payload: event.payload,
            },
            {
              // ⚠️ İş kimliği = outbox kimliği. Aynı olay iki kez taşınırsa
              // BullMQ ikincisini sessizce yok sayar.
              jobId: event.id,
            },
          );

          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { publishedAt: new Date() },
          });
          published += 1;
        } catch (error) {
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              attempts: { increment: 1 },
              lastError: error instanceof Error ? error.message.slice(0, 500) : 'bilinmeyen',
            },
          });
          this.logger.error(
            { outboxEventId: event.id, type: event.type, err: error },
            'Outbox olayı kuyruğa alınamadı',
          );
        }
      }

      if (stale > 0) {
        // Bir saatten uzun süredir yayınlanmamış olay var — dağıtıcı durmuş
        // veya Redis erişilemiyor olabilir. Sessizce geçilmemeli.
        this.logger.error({ stale }, 'Bekleyen eski outbox olayları var');
      }

      return { published, stale };
    } finally {
      this.running = false;
    }
  }

  /**
   * ÖLÜ MEKTUP DENETİMİ — deneme hakkı bitmiş domain olaylarını görünür kılar.
   *
   * ⚠️ NEDEN OTOMATİK YENİDEN DENEME YOK: burada `job.retry()` çağırmak, kalıcı
   *    olarak bozuk tek bir olayın (zehirli mesaj) kuyruğu sonsuza kadar meşgul
   *    etmesi demekti. Karar insana bırakılır; kaydın işi kararı MÜMKÜN kılmak.
   *    Elle canlandırma artık güvenlidir: dağıtıcı başarmış işleyicileri işin
   *    verisine yazıyor, yani tekrar denemede yalnızca DÜŞEN işleyici koşar
   *    (bkz. domain-event.fanout.ts → DispatchContext).
   *
   * ⚠️ AYNI SATIR İKİ KEZ ALARM ÜRETMEZ: yalnızca `lastError` HENÜZ BOŞ olan
   *    satırlar yazılır. Aksi hâlde bu iş her turda aynı ölü olay için hata
   *    logu basar ve gerçek alarmı gürültüye boğardı.
   *
   * ⚠️ `removeOnFail` başarısız işleri 7 gün tutuyor (queues.ts); denetimin
   *    penceresi budur. Süre kısaltılırsa burası kör kalır.
   */
  async auditDeadLetters(): Promise<{ dead: number }> {
    const failed = await this.queue.getFailed(0, BATCH_SIZE - 1);
    if (failed.length === 0) return { dead: 0 };

    // Hâlâ deneme hakkı olan iş ölü değildir; kuyruk onu yeniden alacak.
    const exhausted = failed.filter((job) => job.attemptsMade >= (job.opts.attempts ?? 1));

    // ⚠️ İş kimliği = outbox kimliği (bkz. `dispatch`). Bağ bu eşitlikten ibaret;
    //    kimlik üretimi değişirse burası sessizce hiçbir satır bulamaz olur.
    const byId = new Map(
      exhausted.filter((job) => typeof job.id === 'string').map((job) => [job.id as string, job]),
    );
    if (byId.size === 0) return { dead: 0 };

    const rows = await this.prisma.outboxEvent.findMany({
      where: { id: { in: [...byId.keys()] }, lastError: null },
      select: { id: true, type: true },
    });

    for (const row of rows) {
      const job = byId.get(row.id)!;
      const reason = job.failedReason ?? 'bilinmeyen';

      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: {
          attempts: job.attemptsMade,
          // ⚠️ Ön ek KAYNAĞI ayırır: 'kuyruk:' tüketici tarafındaki kalıcı
          //    hatadır, ön eksiz kayıt bu döngünün kuyruğa yazamadığı hatadır.
          lastError: `kuyruk: ${reason}`.slice(0, 500),
        },
      });

      this.logger.error(
        { outboxEventId: row.id, type: row.type, attempts: job.attemptsMade, reason },
        '⚠️ Domain olayı KALICI olarak kaybedildi — yan etkileri hiç çalışmadı',
      );
    }

    return { dead: rows.length };
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
