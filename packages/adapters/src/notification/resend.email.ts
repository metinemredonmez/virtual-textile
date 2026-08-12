import { resilient } from '../resilience/resilient.js';
import type { CircuitBreaker } from '../resilience/circuit-breaker.js';
import type { EmailProvider, EmailSendInput, SendResult } from './notification.provider.js';

/**
 * RESEND E-POSTA ADAPTER'I
 *
 * ⚠️ SMS'TEN FARKLI OLARAK RETRY AÇIK. Resend `Idempotency-Key` başlığını
 *    destekler: aynı anahtarla gelen ikinci istek yeni bir e-posta üretmez,
 *    ilkinin sonucunu döner. Bu, `resilient()`in `idempotencyKey` alanının
 *    aradığı TAAHHÜDÜN ta kendisidir — dolayısıyla zaman aşımında tekrar
 *    denemek güvenlidir.
 *
 *    Netgsm'de bu garanti YOKTUR ve orada retry bilerek kapalıdır. İki
 *    adapter'ın farklı davranması bir tutarsızlık değil, sağlayıcı
 *    garantilerindeki farkın doğru yansımasıdır.
 */

export interface ResendConfig {
  /** RESEND_API_KEY */
  apiKey: string;
  /** MAIL_FROM — doğrulanmış alan adına ait olmalı, yoksa 403 döner. */
  from: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  circuitBreaker?: CircuitBreaker;
  timeoutMs?: number;
}

const RESEND_BASE_URL = 'https://api.resend.com';

/**
 * E-posta gecikmeye SMS'ten daha toleranslıdır (kullanıcı ekranda beklemez),
 * bu yüzden genel varsayılan bütçe korunur.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/** `status` alan adı sözleşmedir — `defaultIsRetryable` buradan okur. */
export class ResendHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodyPreview: string,
    readonly providerCode?: string,
  ) {
    super(`resend HTTP ${String(status)}`);
    this.name = 'ResendHttpError';
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ResendConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.baseUrl = config.baseUrl ?? RESEND_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(input: EmailSendInput): Promise<SendResult> {
    return resilient<SendResult>(
      {
        provider: this.name,
        operation: 'send',
        // TODO(hata-katalogu): `NOTIFICATION_PROVIDER_ERROR` kodu eklenmeli;
        //   katalog bu ajanın dosyası değil (bkz. netgsm.sms.ts'teki aynı not).
        errorCode: 'UPSTREAM_UNAVAILABLE',
        timeoutMs: this.timeoutMs,
        // ⚠️ Sağlayıcı tekilleştirme GARANTİSİ VERDİĞİ için retry açılabiliyor.
        idempotencyKey: input.messageId,
        retryAttempts: 3,
        extractProviderCode: (error) =>
          error instanceof ResendHttpError
            ? (error.providerCode ?? String(error.status))
            : undefined,
        ...(this.config.circuitBreaker ? { circuitBreaker: this.config.circuitBreaker } : {}),
      },
      () => this.call(input),
    );
  }

  private async call(input: EmailSendInput): Promise<SendResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        // ⚠️ Tekilleştirmenin ta kendisi. Bu başlık düşerse retry ikinci bir
        //    e-posta üretir.
        'Idempotency-Key': input.messageId,
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        // ⚠️ Düz metin alternatifi HER ZAMAN gönderilir: yalnızca HTML içeren
        //    e-postaların spam skoru belirgin biçimde yüksektir ve bazı
        //    kurumsal istemciler HTML'i hiç göstermez.
        text: input.text,
      }),
    });

    const raw = await response.text();

    if (!response.ok) {
      throw new ResendHttpError(response.status, raw.slice(0, 200), readErrorName(raw));
    }

    const id = readId(raw);
    if (!id) {
      // 200 ama kimlik yok: gövde beklenmedik. Geçici sayılır (502) — araya
      // proxy/bakım sayfası girmiş olabilir.
      throw new ResendHttpError(502, raw.slice(0, 200));
    }

    return { providerRef: id };
  }
}

function readId(raw: string): string | undefined {
  try {
    const json = JSON.parse(raw) as { id?: unknown };
    return typeof json.id === 'string' && json.id !== '' ? json.id : undefined;
  } catch {
    return undefined;
  }
}

/** Resend hata gövdesindeki `name` alanı ('validation_error' vb.). Loglanır. */
function readErrorName(raw: string): string | undefined {
  try {
    const json = JSON.parse(raw) as { name?: unknown };
    return typeof json.name === 'string' ? json.name : undefined;
  } catch {
    return undefined;
  }
}
