import type { JobsOptions } from 'bullmq';

/**
 * KUYRUK TANIMLARI
 *
 * Her kuyruk ayrı bir hata ve yeniden deneme profiline sahiptir; hepsini tek
 * kuyruğa koymak, yavaş bir işin (try-on) hızlı bir işi (bildirim) bloklamasına
 * yol açar.
 */
export const QUEUE = {
  /** Sanal deneme üretimi — yavaş, pahalı, GPU/API bağımlı. */
  TRYON: 'tryon',
  /** Ürün embedding üretimi — toplu, gecikmeye toleranslı. */
  EMBEDDING: 'embedding',
  /** AI içerik üretimi: etiketleme, açıklama. */
  AI_CONTENT: 'ai-content',
  /** SMS / e-posta / push. */
  NOTIFICATION: 'notification',
  /** Domain event dağıtımı (outbox'tan gelir). */
  DOMAIN_EVENT: 'domain-event',
  /** Görsel işleme: yeniden boyutlandırma, EXIF temizliği, blurhash. */
  MEDIA: 'media',
  /** Dış webhook teslimatı ve yeniden denemeleri. */
  WEBHOOK: 'webhook',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/**
 * Varsayılan iş seçenekleri.
 *
 * `removeOnComplete` sınırlıdır: Redis'te sonsuza kadar tamamlanmış iş
 * biriktirmek belleği doldurur. Başarısızlar daha uzun tutulur — hata ayıklama
 * için gerekir ve sayıları zaten az olmalıdır.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 1000, age: 24 * 3600 },
  removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
};

/** Kuyruğa özgü ayarlar — varsayılanların üzerine yazılır. */
export const QUEUE_OPTIONS: Partial<Record<QueueName, JobsOptions>> = {
  /**
   * ⚠️ Try-on işleri BURADA yeniden denenmez.
   * Sağlayıcı seçimi ve fallback zinciri işin İÇİNDE yürütülür
   * (generateWithFallback). BullMQ'ya da retry verirsek kalıcı hatalar —
   * "fotoğrafta kişi yok" gibi — üç kez daha denenip boşuna para yakar.
   */
  [QUEUE.TRYON]: { attempts: 1, removeOnComplete: { count: 500, age: 6 * 3600 } },

  // Bildirimler idempotent (messageId ile) — cömert retry güvenli.
  [QUEUE.NOTIFICATION]: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  },

  // Embedding gecikmeye toleranslı; hızlı işlerin önüne geçmesin.
  [QUEUE.EMBEDDING]: { attempts: 3, priority: 10 },
};

/** Kuyruk başına eşzamanlılık. */
export const CONCURRENCY: Record<QueueName, number> = {
  // Dış API hız limitine takılmamak için düşük.
  [QUEUE.TRYON]: 4,
  [QUEUE.EMBEDDING]: 2,
  [QUEUE.AI_CONTENT]: 2,
  [QUEUE.NOTIFICATION]: 10,
  [QUEUE.DOMAIN_EVENT]: 10,
  [QUEUE.MEDIA]: 4,
  [QUEUE.WEBHOOK]: 5,
};

// ── İş yükleri ────────────────────────────────────────────────────────────

export interface TryOnJobData {
  tryOnJobId: string;
  userPhotoId: string;
  variantId: string;
  mode: 'FAST' | 'QUALITY';
  cacheKey: string;
}

export interface DomainEventJobData {
  outboxEventId: string;
  aggregate: string;
  aggregateId: string;
  type: string;
  payload: unknown;
}

export interface NotificationJobData {
  channel: 'SMS' | 'EMAIL' | 'PUSH';
  to: string;
  template: string;
  variables: Record<string, string>;
  /** Idempotency: aynı mesaj iki kez gönderilmesin. */
  messageId: string;
}

/**
 * BULLMQ İŞ KİMLİĞİ — tekilleştirme anahtarından türetilir.
 *
 * ⚠️ BULLMQ `jobId` İÇİNDE İKİ NOKTA ÜST ÜSTE KABUL ETMEZ ("Custom Id cannot
 *    contain :"). Redis'te iş anahtarları `bull:<kuyruk>:<jobId>` biçiminde
 *    kurulduğu için ayırıcı karakterin kimliğin içinde geçmesi anahtar
 *    uzayını bozar; kütüphane bu yüzden ekleme anında REDDEDER.
 *
 * Bizim tekilleştirme anahtarlarımız (`notificationMessageId`, KVKK işlerinin
 * `kvkk:...` kimlikleri) okunabilir olsun diye iki nokta ile kurulmuştu.
 * Sonuç: `queue.add` HER ÇAĞRIDA fırlıyordu ve bildirim üretimi tamamen
 * durmuştu — sipariş onayı, kargo, satıcı bilgilendirmesi, payout, KVKK
 * e-postaları dahil. Hata outbox dağıtıcısında yakalanıp loglandığı için
 * süreç ayakta kalıyor, arıza yalnızca log'da görünüyordu.
 *
 * ÇÖZÜMÜN YÖNÜ ÖNEMLİ: `messageId`in KENDİSİ değiştirilmedi. O değer
 * gönderim tekilleştirmesinin anahtarıdır (bkz. redis-dedupe.store.ts) ve
 * biçimi değişirse daha önce gönderilmiş mesajlar "hiç gönderilmemiş" sayılıp
 * TEKRAR gönderilir. Yalnızca kuyruk katmanına giden kimlik dönüştürülür.
 *
 * Dönüşüm KAÇIŞLIDIR, düz değiştirme değil: önce `_` ikilenir, sonra `:`
 * tek `_` olur. Düz değiştirme (`:` → `_`) iki FARKLI anahtarı aynı iş
 * kimliğine düşürebilirdi — bu, ikinci mesajın BullMQ tarafından sessizce
 * yok sayılması, yani bir bildirimin HİÇ GİTMEMESİ demekti.
 */
export function queueJobId(messageId: string): string {
  return messageId.replace(/_/g, '__').replace(/:/g, '_');
}

export interface MediaJobData {
  kind: 'PRODUCT_IMAGE' | 'USER_PHOTO';
  storageKey: string;
  entityId: string;
}
