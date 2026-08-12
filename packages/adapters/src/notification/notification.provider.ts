/**
 * BİLDİRİM SAĞLAYICI SÖZLEŞMELERİ
 *
 * ⚠️ VARLIK SEBEBİ: OTP kodu bugün yalnızca `console.warn` ile yazılıyor
 *    (auth.controller.ts). Üretimde kullanıcı kodunu ALAMIYOR, yani kayıt akışı
 *    fiilen çalışmıyor. Bu dosya o akışın sözleşmesidir.
 *
 * ⚠️ `messageId` IDEMPOTENCY ANAHTARIDIR. Aynı `messageId` ile ikinci bir
 *    gönderim İSTENMEZ: kullanıcıya iki kez OTP gitmesi hem para (segment
 *    başına ücret) hem güven kaybıdır — "kodu ben mi istedim?" sorusu doğrudan
 *    destek kaydına dönüşür.
 *
 * Sağlayıcı uygulamaları (Netgsm, Resend) bu dosyaya bağlıdır; NestJS'e değil.
 * `@vt/adapters` çerçeveden bağımsızdır — DI tanımları `apps/api` tarafındadır.
 */

export type NotificationChannel = 'SMS' | 'EMAIL';

/** Sağlayıcıya giden ortak alanlar. */
interface SendInputBase {
  /**
   * ⚠️ Tekilleştirme anahtarı. Sağlayıcıya iletilebildiği yerde iletilir
   *    (Resend `Idempotency-Key` başlığı), iletilemediği yerde bizim
   *    tarafımızda zorlanır (bkz. NotificationDedupeStore).
   */
  messageId: string;
}

export interface SmsSendInput extends SendInputBase {
  /** Normalize edilmiş numara — bkz. `normalizeTrPhone`. */
  to: string;
  /** ⚠️ OTP içerebilir. LOGLANMAZ. */
  body: string;
}

export interface EmailSendInput extends SendInputBase {
  to: string;
  subject: string;
  html: string;
  /** Düz metin alternatifi — HTML engelleyen istemcilerde tek görünen içerik. */
  text: string;
}

/**
 * Sağlayıcının verdiği takip kimliği (Netgsm bulkid, Resend id).
 *
 * Neden sonuç bu kadar dar: teslim raporu ASENKRONDUR. "Gönderdim" ile
 * "ulaştı" aynı şey değildir; sağlayıcıya sorulacak tek şey bu referanstır.
 */
export interface SendResult {
  providerRef: string;
}

export interface SmsProvider {
  /** Log ve alarmlarda görünür: 'netgsm', 'console', 'unconfigured'. */
  readonly name: string;
  send(input: SmsSendInput): Promise<SendResult>;
}

export interface EmailProvider {
  readonly name: string;
  send(input: EmailSendInput): Promise<SendResult>;
}

// ── Tekilleştirme (idempotency) deposu ────────────────────────────────────

/**
 * Bir `messageId` için kaydın durumu.
 *
 *  fresh     : bu mesaj ilk kez görülüyor, gönderim hakkı BU çağrıda.
 *  in-flight : önceki bir deneme gönderime başladı ama BİTİRMEDİ. Sağlayıcının
 *              mesajı alıp almadığı BİLİNMİYOR.
 *  sent      : gönderildi, `providerRef` elimizde.
 */
export type DedupeState = 'fresh' | 'in-flight' | 'sent';

export interface DedupeClaim {
  readonly state: DedupeState;
  /** Yalnızca `sent` durumunda dolu. */
  readonly providerRef?: string;
}

/**
 * TEKİLLEŞTİRME DEPOSU
 *
 * ⚠️ Kuyruk teslimatı EN AZ BİR KEZ'dir (outbox → BullMQ) ve QUEUE.NOTIFICATION
 *    5 deneme yapar. Bildirimleri idempotent yapan şey bu depodur; retry sayısı
 *    cömert olabiliyorsa sebebi burasıdır.
 *
 * Uygulaması `apps/api` / `apps/worker` tarafında Redis ile yapılır: bu paketin
 * çalışma zamanı bağımlılığı yalnızca @vt/config ve @vt/contracts'tır.
 */
export interface NotificationDedupeStore {
  /**
   * Gönderim hakkını atomik olarak talep eder (SET NX).
   * `fresh` dönen TEK çağrı gönderim yapar; diğerleri gönderim yapmaz.
   */
  claim(messageId: string, ttlSeconds: number): Promise<DedupeClaim>;

  /** Gönderim başarılı — kayıt uzun TTL ile `sent` durumuna geçer. */
  complete(messageId: string, providerRef: string, ttlSeconds: number): Promise<void>;

  /**
   * ⚠️ YALNIZCA mesajın sağlayıcıya ULAŞMADIĞINDAN EMİN olunan hatalarda
   *    çağrılır (bağlantı reddi, devre açık, şablon/doğrulama hatası).
   *    Zaman aşımında ÇAĞRILMAZ — bkz. NotificationSender.
   */
  release(messageId: string): Promise<void>;
}

/**
 * Bir talebin ne kadar süre "işlenmiş" sayılacağı.
 *
 * 24 saat: aynı olayın (outbox tekrarları, kuyruk retry'ları, kullanıcının
 * yeniden tetiklemesi) bir gün içinde tekrar gelmesi olağandır. Daha kısa bir
 * pencere, gece yarısı sıkışan bir kuyruğun sabah ikinci kez SMS atması demek
 * olurdu.
 */
export const DEDUPE_TTL_SECONDS = 24 * 3600;

/**
 * Gönderim başlarken konan geçici kaydın ömrü.
 *
 * Sağlayıcı zaman aşımından (en fazla 15 sn) belirgin biçimde uzun tutulur ki
 * yanıt beklerken paralel bir tüketici aynı mesajı ikinci kez göndermesin.
 */
export const DEDUPE_INFLIGHT_TTL_SECONDS = 120;

// ── Gönderim sonucu ───────────────────────────────────────────────────────

export type NotificationOutcome =
  /** Bu çağrıda gönderildi. */
  | { status: 'sent'; providerRef: string; templateVersion: number }
  /** Daha önce gönderilmişti — tekrar gönderilmedi. */
  | { status: 'duplicate'; providerRef?: string }
  /**
   * Önceki bir deneme yarıda kaldı; sağlayıcının mesajı alıp almadığı belirsiz.
   * ⚠️ Tekrar GÖNDERİLMEZ — bkz. NotificationSender'daki asimetri notu.
   */
  | { status: 'uncertain' };
