import type { OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { Logger } from 'pino';
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE,
  QUEUE_OPTIONS,
  type DomainEventJobData,
  type TryOnJobData,
} from '../queues.js';
import type { DomainEventHandler } from './domain-event.fanout.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SANAL DENEME — OLAYDAN KUYRUĞA GEÇİŞ.
 *
 *  ⚠️ VARLIK SEBEBİ: BU HALKA HİÇ YAZILMAMIŞTI VE ZİNCİR ORADA KOPUYORDU.
 *
 *  Ölçüldü (canlı, 2026-08-14). Kullanıcı "Üzerimde Dene" akışını tamamladı:
 *
 *      POST /me/photos          201  bilet
 *      PUT  <imzalı R2 adresi>  200  dosya yüklendi
 *      POST /me/photos/:id/confirm  201  kalite geçti
 *      POST /tryon              202  iş kabul edildi
 *
 *  ve sonra hiçbir şey olmadı. Veritabanı:
 *
 *      status = QUEUED · startedAt = NULL · attempts = 0
 *
 *  Redis:
 *
 *      redis-cli --scan --pattern 'bull:tryon*'   →  TEK ANAHTAR YOK
 *
 *  Yani iş kuyruğa HİÇ KONMAMIŞTI. `tryon.service.ts` bir outbox olayı
 *  yazıyor (`tryon.requested`) — bu doğru bir tasarım, transaction ile
 *  kuyruğun atomik olmamasını çözüyor. Ama o olayı TÜKETEN kimse yoktu:
 *
 *      grep -rn "tryon.requested" apps/ packages/
 *      → apps/api/src/modules/ai/tryon.service.ts:338   (YAZAN)
 *      → başka HİÇBİR eşleşme yok                        (OKUYAN yok)
 *
 *  `DomainEventHandlerName` yalnızca 'notification' | 'wardrobe' idi. Olay
 *  fanout'a giriyor, iki işleyici de onunla ilgilenmiyor, olay "işlendi" diye
 *  işaretleniyor ve try-on işi sonsuza kadar QUEUED kalıyordu.
 *
 *  ⚠️ HİÇBİR TEST BUNU GÖREMEZDİ: yazan taraf test edilmiş, kuyruk tüketicisi
 *     test edilmiş, ikisinin ARASINDA kimsenin olmadığını ölçen bir test
 *     yoktu. Deponun yedi kez yaşadığı "yazıldı, derlendi, test edildi — ama
 *     hiçbir çağırandan ulaşılamadı" sınıfının yedincisi.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * ⚠️ BAYAT OLAY SINIRI YOK (`null`) VE BU BİLİNÇLİ BİR KARAR.
 *
 *    Bildirimde sınır var, çünkü üç saat gecikmiş bir "kargonuz yola çıktı"
 *    SMS'i kullanıcıyı yanıltır. Burada tersi geçerli: kullanıcı fotoğrafını
 *    yükledi, bekledi ve sonucu HÂLÂ istiyor. Worker bir saat kapalı kalıp
 *    geri döndüğünde birikmiş işleri ÜRETMEK doğru olan; onları "bayat" diye
 *    atmak, kullanıcının parasını ve emeğini çöpe atmaktır.
 *
 *    ⚠️ Sınırsızlık bedava değil: fotoğraf `PHOTO_RETENTION.oneTimeHours` (24
 *       saat) sonra siliniyor. O süreden sonra iş kuyruğa girse bile
 *       `tryon.processor` fotoğrafı bulamayıp KALICI hata döner — yani gerçek
 *       sınırı saklama süresi koyuyor, burada ikinci bir sayı tutmuyoruz.
 *       İki yerde iki sayı tutmak, ayrıştıkları gün sessizce yanlış davranır.
 */
const MAX_EVENT_AGE_MS = null;

/** `tryon.requested` yükü — `tryon.service.ts` → `enqueue()` ile aynı şekil. */
interface TryOnRequestedPayload {
  tryOnJobId: string;
  userPhotoId: string;
  variantId: string;
  mode: 'FAST' | 'QUALITY';
  cacheKey: string;
}

/**
 * ⚠️ YÜK DOĞRULANIYOR, `as` İLE GEÇİLMİYOR. Outbox `payload`ı `Json` kolonu;
 *    tip iddiası çalışma zamanında hiçbir şey garanti etmez. Şekil bozuksa
 *    işi kuyruğa koymak, hatayı bir katman ileri taşıyıp orada anlaşılmaz
 *    hâle getirirdi.
 */
function yukuCoz(payload: unknown): TryOnRequestedPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;

  const metinler = ['tryOnJobId', 'userPhotoId', 'variantId', 'cacheKey'] as const;
  for (const alan of metinler) {
    if (typeof p[alan] !== 'string' || p[alan] === '') return null;
  }
  if (p['mode'] !== 'FAST' && p['mode'] !== 'QUALITY') return null;

  return {
    tryOnJobId: p['tryOnJobId'] as string,
    userPhotoId: p['userPhotoId'] as string,
    variantId: p['variantId'] as string,
    mode: p['mode'],
    cacheKey: p['cacheKey'] as string,
  };
}

export class TryOnDispatchHandler implements DomainEventHandler, OnModuleDestroy {
  readonly maxEventAgeMs = MAX_EVENT_AGE_MS;

  private readonly queue: Queue<TryOnJobData>;

  constructor(
    connection: Redis,
    private readonly logger: Logger,
  ) {
    this.queue = new Queue<TryOnJobData>(QUEUE.TRYON, {
      connection,
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, ...QUEUE_OPTIONS[QUEUE.TRYON] },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }

  async process(event: DomainEventJobData): Promise<{ enqueued: number }> {
    // ⚠️ İlgilenmediğimiz olaylar SESSİZCE geçilir — fanout her işleyiciye
    //    HER olayı verir; burada tür süzgeci olmazsa her sipariş olayı için
    //    de bir try-on işi kuyruğa girerdi.
    if (event.type !== 'tryon.requested') return { enqueued: 0 };

    const yuk = yukuCoz(event.payload);
    if (!yuk) {
      /**
       * ⚠️ ATMIYOR, LOG BASIP GEÇİYOR. Atsaydı fanout bu olayı sonsuza kadar
       *    yeniden denerdi ve bozuk tek bir satır TÜM kuyruğu tıkardı. Bozuk
       *    yük bir VERİ hatasıdır, geçici bir arıza değil — tekrar denemek
       *    onu düzeltmez.
       */
      this.logger.error(
        { outboxEventId: event.outboxEventId, aggregateId: event.aggregateId },
        'tryon.requested yükü okunamadı — iş kuyruğa konmadı',
      );
      return { enqueued: 0 };
    }

    /**
     * ⚠️ `jobId` VERİLİYOR VE DEĞERİ `tryOnJobId`. Sebebi iki katlı:
     *
     *    1. TEKRAR GÖNDERİMDE ÇİFT ÜRETİM OLMAZ. Fanout en-az-bir-kez teslim
     *       ediyor; aynı olay iki kez gelirse BullMQ ikinci işi aynı `jobId`
     *       yüzünden reddeder. Onsuz kullanıcı bir kez istediği hâlde iki kez
     *       para yakardık.
     *
     *    2. `bull:tryon:<tryOnJobId>` anahtarı, veritabanı satırıyla AYNI
     *       kimliği taşır — arıza ayıklarken ikisini eşleştirmek için ek bir
     *       eşleme tablosu gerekmiyor.
     *
     * ⚠️ UUID'de `:` YOK, o yüzden `queueJobId()` dönüşümüne gerek YOK.
     *    (Bildirim tarafında mesaj kimliği `:` içeriyordu ve BullMQ onu
     *    reddediyordu — bkz. `queues.ts` → `queueJobId`.)
     */
    await this.queue.add(QUEUE.TRYON, yuk, { jobId: yuk.tryOnJobId });

    this.logger.info(
      { tryOnJobId: yuk.tryOnJobId, variantId: yuk.variantId, mode: yuk.mode },
      'Sanal deneme işi kuyruğa alındı',
    );
    return { enqueued: 1 };
  }
}
