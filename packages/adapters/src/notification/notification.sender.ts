import { AppError, IntegrationError } from '@vt/contracts';
import { CircuitOpenError } from '../resilience/circuit-breaker.js';
import { TimeoutError } from '../resilience/resilient.js';
import {
  DEDUPE_INFLIGHT_TTL_SECONDS,
  DEDUPE_TTL_SECONDS,
  type EmailProvider,
  type NotificationChannel,
  type NotificationDedupeStore,
  type NotificationOutcome,
  type SmsProvider,
} from './notification.provider.js';
import {
  renderNotification,
  type TemplateKey,
  type TemplateRegistry,
  type TemplateVariables,
} from './template.js';
import { TR_TEMPLATE_REGISTRY } from './templates/index.js';

/**
 * BİLDİRİM GÖNDERİCİSİ — şablon + tekilleştirme + sağlayıcı
 *
 * API (OTP, senkron) ve worker (kuyruk, asenkron) AYNI nesneyi kullanır.
 * İki ayrı yol yazılsaydı tekilleştirme kuralı iki yerde yaşar ve zamanla
 * ayrışırdı; ayrışan bir idempotency kuralı, hiç olmayan bir idempotency
 * kuralıdır.
 */

export interface NotificationRequest {
  channel: NotificationChannel;
  /** Telefon (SMS) veya e-posta adresi. */
  to: string;
  template: TemplateKey;
  variables: TemplateVariables;
  /**
   * ⚠️ TEKİLLEŞTİRME ANAHTARI. Aynı olay için ÜRETİLMESİ DETERMİNİSTİK
   *    olmalıdır (ör. `${outboxEventId}:${template}:${channel}`). Rastgele
   *    üretilirse — `randomUUID()` gibi — tekilleştirme hiçbir şey yapmaz,
   *    yalnızca Redis'e çöp yazar.
   */
  messageId: string;
}

/** pino'nun ihtiyacımız olan yüzeyi (bkz. WiringLogger — aynı gerekçe). */
export interface NotificationLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface NotificationSenderDeps {
  sms: SmsProvider;
  email: EmailProvider;
  dedupe: NotificationDedupeStore;
  logger: NotificationLogger;
  /** Varsayılan: Türkçe şablonlar. Test kendi kaydını geçebilir. */
  templates?: TemplateRegistry;
}

/**
 * ALICI MASKELEME
 *
 * ⚠️ Telefon ve e-posta kişisel veridir; her gönderim satırında düz yazılırsa
 *    log toplama sistemi fiilen bir iletişim listesine dönüşür. Maskeleme
 *    destek ekibinin kaydı eşleştirmesine yetecek kadar bilgi bırakır.
 */
export function maskRecipient(to: string): string {
  if (to.includes('@')) {
    const [local = '', domain = ''] = to.split('@');
    const head = local.slice(0, 2);
    return `${head}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
  }
  return to.length <= 6 ? '***' : `${to.slice(0, 3)}***${to.slice(-2)}`;
}

/**
 * MESAJ SAĞLAYICIYA ULAŞMADIĞINDAN EMİN MİYİZ?
 *
 * ⚠️ BU FONKSİYON PARA HARCATIR. `true` dönerse tekilleştirme kaydı serbest
 *    bırakılır ve kuyruk yeniden dener; yanlış `true`, kullanıcıya İKİNCİ bir
 *    OTP SMS'i demektir. Bu yüzden yalnızca KANITLI durumlar sayılır:
 *
 *   • devre açık            → istek hiç kurulmadı
 *   • bağlantı reddi/DNS    → TCP oturumu hiç açılmadı
 *   • 4xx                   → sağlayıcı isteği açıkça REDDETTİ
 *   • kendi AppError'ımız   → ağa hiç çıkılmadı (yapılandırılmamış sağlayıcı,
 *                             şablon hatası)
 *
 * Zaman aşımı ve 5xx BİLEREK dışarıda: istek karşı tarafa ulaşmış ve mesaj
 * kuyruğa girmiş olabilir. Bu durumda "belki gönderildi" varsayılır ve tekrar
 * DENENMEZ. Asimetri kasıtlıdır: gönderilmeyen bir OTP'yi kullanıcı "tekrar
 * gönder" ile kendisi çözer (bize maliyeti sıfır); iki kez gönderilen bir
 * OTP'yi kimse geri alamaz.
 */
export function deliveryCertainlyFailed(error: unknown): boolean {
  for (let current = error, depth = 0; current !== undefined && depth < 5; depth += 1) {
    if (current instanceof CircuitOpenError) return true;
    if (current instanceof TimeoutError) return false;

    // Kendi hatamız (yapılandırılmamış sağlayıcı, şablon) — ağa çıkılmadı.
    // IntegrationError HARİÇ: o, dış çağrı denendikten sonra üretilir.
    if (current instanceof AppError && !(current instanceof IntegrationError)) return true;

    const code = (current as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && NEVER_CONNECTED.has(code)) return true;

    const status = (current as { status?: unknown } | null)?.status;
    if (typeof status === 'number') {
      // ⚠️ 429 dahil: hız limiti mesajın İŞLENMEDİĞİ anlamına gelir.
      if (status >= 400 && status < 500) return true;
      // 5xx → belirsiz. Karar burada biter, cause zincirine bakılmaz.
      return false;
    }

    current = (current as { cause?: unknown } | null)?.cause;
  }

  return false;
}

/** Bu kodlarda TCP oturumu hiç kurulmamıştır — mesaj karşı tarafa ulaşmadı. */
const NEVER_CONNECTED = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
]);

export class NotificationSender {
  private readonly templates: TemplateRegistry;

  constructor(private readonly deps: NotificationSenderDeps) {
    this.templates = deps.templates ?? TR_TEMPLATE_REGISTRY;
  }

  /**
   * Bildirimi gönderir. Tekilleştirme burada zorlanır.
   *
   * ⚠️ Fırlatabilir. Kuyruk tüketicisi hatayı görmeli ki iş başarısız yazılsın;
   *    yutulursa "gönderilmedi" bilgisi hiçbir yerde kalmaz.
   */
  async send(request: NotificationRequest): Promise<NotificationOutcome> {
    // ── 1. Şablon ÖNCE doldurulur ────────────────────────────────────────
    // ⚠️ Sıra önemli: bozuk bir şablonla tekilleştirme kaydı açılsaydı, şablon
    //    düzeltildikten sonra aynı mesaj "zaten gönderildi" sayılıp bir daha
    //    hiç gönderilemezdi.
    const rendered = renderNotification(
      this.templates,
      request.template,
      request.channel,
      request.variables,
    );

    const logContext = {
      messageId: request.messageId,
      channel: request.channel,
      template: request.template,
      templateVersion: rendered.templateVersion,
      // ⚠️ Alıcı MASKELİ, gövde HİÇ loglanmıyor — OTP kodu gövdededir.
      to: maskRecipient(request.to),
    };

    // ── 2. Gönderim hakkını al ───────────────────────────────────────────
    const claim = await this.deps.dedupe.claim(request.messageId, DEDUPE_INFLIGHT_TTL_SECONDS);

    if (claim.state === 'sent') {
      this.deps.logger.info(logContext, 'Bildirim zaten gönderilmiş — tekrar gönderilmedi');
      return claim.providerRef === undefined
        ? { status: 'duplicate' }
        : { status: 'duplicate', providerRef: claim.providerRef };
    }

    if (claim.state === 'in-flight') {
      // Önceki deneme yarıda kaldı. Gönderilip gönderilmediği BİLİNMİYOR.
      // Tekrar göndermemek bilinçli bir tercihtir (bkz. deliveryCertainlyFailed).
      this.deps.logger.warn(
        logContext,
        'Bildirim önceki denemede yarıda kaldı — belirsiz, tekrar gönderilmedi',
      );
      return { status: 'uncertain' };
    }

    // ── 3. Gönder ────────────────────────────────────────────────────────
    try {
      const result =
        rendered.channel === 'SMS'
          ? await this.deps.sms.send({
              to: request.to,
              body: rendered.body,
              messageId: request.messageId,
            })
          : await this.deps.email.send({
              to: request.to,
              subject: rendered.subject,
              html: rendered.html,
              text: rendered.text,
              messageId: request.messageId,
            });

      await this.deps.dedupe.complete(request.messageId, result.providerRef, DEDUPE_TTL_SECONDS);

      this.deps.logger.info(
        {
          ...logContext,
          provider: rendered.channel === 'SMS' ? this.deps.sms.name : this.deps.email.name,
          providerRef: result.providerRef,
        },
        'Bildirim gönderildi',
      );

      return {
        status: 'sent',
        providerRef: result.providerRef,
        templateVersion: rendered.templateVersion,
      };
    } catch (error) {
      const certainlyFailed = deliveryCertainlyFailed(error);

      if (certainlyFailed) {
        // Ulaşmadığı KANITLI: kaydı bırak ki kuyruk gerçekten yeniden denesin.
        await this.deps.dedupe.release(request.messageId).catch(() => {
          // Serbest bırakma başarısızsa mesaj bir gün boyunca "işlenmiş"
          // sayılır. Sessiz kalınmaz: bu, gönderilmeyen bildirim demektir.
          this.deps.logger.error(
            logContext,
            'Tekilleştirme kaydı serbest bırakılamadı — bu bildirim bir daha denenmeyecek',
          );
        });
      } else {
        this.deps.logger.error(
          logContext,
          'Bildirim sonucu BELİRSİZ — gönderilmiş olabilir, tekrar denenmeyecek',
        );
      }

      throw error;
    }
  }
}
