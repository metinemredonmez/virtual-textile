import { resilient } from '../resilience/resilient.js';
import type { CircuitBreaker } from '../resilience/circuit-breaker.js';
import type { SendResult, SmsProvider, SmsSendInput } from './notification.provider.js';

/**
 * NETGSM SMS ADAPTER'I
 *
 * ⚠️ EN ÖNEMLİ KARAR — RETRY KAPALI:
 *    `resilient()`e `idempotencyKey` VERİLMEZ. O alanın varlığı "bu çağrıyı
 *    tekrarlamak güvenlidir" TAAHHÜDÜDÜR (bkz. resilient.ts). Netgsm'in
 *    tekilleştirme garantisi yoktur: zaman aşımına uğrayan bir istek operatör
 *    tarafında tamamlanmış olabilir ve tekrar denemek kullanıcıya İKİNCİ bir
 *    OTP SMS'i gönderir — hem ücret hem güven kaybı. Anahtar verilmediği için
 *    sarmalayıcı retry'ı kendiliğinden kapatır; zaman aşımı ve devre kesici
 *    korumaları çalışmaya devam eder.
 *
 *    Tekrar deneme hakkı üst katmandadır ve BİZİM tekilleştirme depomuzla
 *    korunur (bkz. NotificationSender + NotificationDedupeStore).
 *
 * ⚠️ SDK yok, düz `fetch`. Gerekçe `ai/http.ts` ile aynı: sağlayıcı SDK'ları
 *    kendi retry/timeout mantığını getirir ve tek dayanıklılık katmanı
 *    varsayımını bozar.
 *
 * ⚠️ İYS (İleti Yönetim Sistemi): OTP ve sipariş bildirimleri "bilgilendirme"
 *    mesajıdır, ticari ileti değildir; İYS izin filtresine tabi değildir. Bu
 *    ayrım Netgsm hesabındaki BAŞLIK TÜRÜ ile kurulur (operasyonel kurulum),
 *    kodla değil. Ticari kampanya SMS'i bu adapter'dan GÖNDERİLMEZ.
 */

export interface NetgsmConfig {
  /** NETGSM_USER — abone numarası veya kullanıcı adı. */
  user: string;
  /** NETGSM_PASS */
  pass: string;
  /** NETGSM_HEADER — onaylı gönderici başlığı. Onaysız başlık 40 hatası döner. */
  header: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  circuitBreaker?: CircuitBreaker;
  timeoutMs?: number;
}

const NETGSM_BASE_URL = 'https://api.netgsm.com.tr';

/**
 * OTP gecikmeye DUYARLIDIR: kullanıcı kayıt ekranında bekliyor. 15 saniyelik
 * genel varsayılan burada uzun kalır — 10 saniyede yanıt gelmediyse zaten
 * kullanıcı "tekrar gönder"e basmıştır.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * NETGSM YANIT KODLARI
 *
 * ⚠️ Bu tablo sağlayıcı belgesine bağlı bir SÖZLEŞMEDİR; Netgsm kod eklerse
 *    bilinmeyen kod GEÇİCİ sayılır (aşağıdaki varsayılan). Bilinmeyeni kalıcı
 *    saymak, tek bir yeni kod yüzünden tüm bildirimlerin sessizce düşmesi
 *    demek olurdu.
 *
 * // TODO(doğrulama): kodlar Netgsm REST v2 belgesiyle karşılaştırılmalı;
 * //   yanlış eşleşme yalnızca ALARM ayrımını bozar, gönderimi değil.
 */
const PERMANENT_CODES: Readonly<Record<string, string>> = {
  '20': 'mesaj metni hatalı veya karakter sınırı aşıldı',
  '30': 'kullanıcı adı/şifre hatalı ya da API erişimi/IP izni yok',
  '40': 'gönderici başlığı (msgheader) onaylı değil',
  '50': 'İYS kontrollü gönderim reddedildi',
  '51': 'İYS marka bilgisi eksik',
  '70': 'hatalı veya eksik parametre',
  '85': 'aynı numaraya tekrar gönderim sınırı aşıldı',
};

/** Sağlayıcı reddetti — tekrar denemek aynı sonucu verir. */
export class NetgsmPermanentError extends Error {
  constructor(
    readonly providerCode: string,
    description: string,
  ) {
    super(`netgsm kalıcı hata ${providerCode}: ${description}`);
    this.name = 'NetgsmPermanentError';
  }
}

/**
 * HTTP seviyesi hata. `status` alan adı sözleşmedir — `defaultIsRetryable`
 * bu alandan okur (bkz. resilient.ts).
 */
export class NetgsmHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodyPreview: string,
  ) {
    super(`netgsm HTTP ${String(status)}`);
    this.name = 'NetgsmHttpError';
  }
}

/**
 * TÜRKİYE NUMARA NORMALİZASYONU
 *
 * Netgsm numarayı `5XXXXXXXXX` (10 hane, başında 0 yok) bekler. Kullanıcı
 * "0532...", "+90532...", "0 532 123 45 67" yazabilir.
 *
 * ⚠️ Normalizasyon yalnızca sağlayıcı isteği için değil, TEKİLLEŞTİRME için de
 *    gerekir: "+905321234567" ile "05321234567" farklı `messageId` üretirse
 *    aynı kişiye iki kez SMS gider.
 */
export function normalizeTrPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');

  // 905321234567 → 5321234567
  const stripped =
    digits.length === 12 && digits.startsWith('90')
      ? digits.slice(2)
      : // 05321234567 → 5321234567
        digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits;

  // ⚠️ MOBİL ŞARTI: 10 hane olması yetmez, 5 ile BAŞLAMALI. Sabit hat numarası
  //    (0212…) da 11 hanedir ve baştaki sıfır atılınca geçerli görünür; oysa
  //    Netgsm sabit hatta SMS gönderemez. Kontrol olmasaydı her denemede
  //    ücret yakılır ve kullanıcı kodu neden almadığını asla öğrenemezdi.
  return stripped.length === 10 && stripped.startsWith('5') ? stripped : null;
}

interface NetgsmResponse {
  code: string;
  jobid?: string;
  description?: string;
}

/**
 * Yanıt gövdesini okur.
 *
 * Netgsm REST uçları JSON döner, eski uçlar `"00 1234567"` biçiminde düz metin.
 * İkisi de okunur: sağlayıcı uç değiştirdiğinde adapter'ın "anlamadım" deyip
 * her mesajı düşürmesi, en pahalı sessiz arıza olurdu.
 */
export function parseNetgsmResponse(raw: string): NetgsmResponse {
  const trimmed = raw.trim();

  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as Record<string, unknown>;
      const code = typeof json.code === 'string' ? json.code : String(json.code ?? '');
      return {
        code,
        ...(typeof json.jobid === 'string' ? { jobid: json.jobid } : {}),
        ...(typeof json.description === 'string' ? { description: json.description } : {}),
      };
    } catch {
      return { code: 'PARSE', description: raw.slice(0, 200) };
    }
  }

  // Düz metin: "00 1234567" ya da yalnızca "30".
  const [code = '', jobid] = trimmed.split(/\s+/);
  return { code, ...(jobid ? { jobid } : {}) };
}

export class NetgsmSmsProvider implements SmsProvider {
  readonly name = 'netgsm';

  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: NetgsmConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.baseUrl = config.baseUrl ?? NETGSM_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(input: SmsSendInput): Promise<SendResult> {
    return resilient<SendResult>(
      {
        provider: this.name,
        operation: 'send',
        // TODO(hata-katalogu): `NOTIFICATION_PROVIDER_ERROR` kodu katalogda yok.
        //   Katalog bu ajanın dosyası değil; eklenene kadar genel entegrasyon
        //   kodu kullanılıyor. Aile `integration` olduğu için alarm davranışı
        //   yine doğru.
        errorCode: 'UPSTREAM_UNAVAILABLE',
        timeoutMs: this.timeoutMs,
        // ⚠️ `idempotencyKey` BİLEREK verilmiyor → retry kapalı. Gerekçe için
        //    dosya başlığına bakın. Bu satırı "retry açalım" diye değiştirmek
        //    çifte OTP demektir.
        ...(this.config.circuitBreaker ? { circuitBreaker: this.config.circuitBreaker } : {}),
      },
      () => this.call(input),
    );
  }

  private async call(input: SmsSendInput): Promise<SendResult> {
    const to = normalizeTrPhone(input.to);
    if (!to) {
      // Kalıcı: aynı numarayla tekrar denemek aynı sonucu verir.
      throw new NetgsmPermanentError(
        '70',
        `geçersiz telefon numarası (${input.to.length} karakter)`,
      );
    }

    const response = await this.fetchImpl(`${this.baseUrl}/sms/rest/v2/send`, {
      method: 'POST',
      headers: {
        // ⚠️ Kimlik bilgisi BAŞLIKTA gider, sorgu dizesinde DEĞİL. Netgsm'in
        //    eski GET ucu kullanıcı adı ve şifreyi URL'e koyar; o URL proxy
        //    loglarına, hata izlerine ve tarayıcı geçmişine düşer.
        Authorization: `Basic ${Buffer.from(`${this.config.user}:${this.config.pass}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msgheader: this.config.header,
        // 'TR' kodlaması Türkçe karakterleri korur. Aksi hâlde operatör
        // harfleri düşürür ve kullanıcı "dogrulama" yerine bozuk metin görür.
        encoding: 'TR',
        messages: [{ msg: input.body, no: to }],
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      // 5xx/429 → `defaultIsRetryable` geçici sayar; ama retry kapalı olduğu
      // için sonuç yine hata olur. Ayrım üst katmanda önemlidir: geçici hatada
      // tekilleştirme kaydı serbest bırakılabilir mi sorusunu bu tip belirler.
      throw new NetgsmHttpError(response.status, text.slice(0, 200));
    }

    const parsed = parseNetgsmResponse(text);

    if (parsed.code !== '00') {
      const description = PERMANENT_CODES[parsed.code];
      if (description) throw new NetgsmPermanentError(parsed.code, description);

      // Bilinmeyen kod → geçici. HTTP 502 olarak işaretlenir ki
      // `defaultIsRetryable` bunu geçici saysın.
      throw new NetgsmHttpError(502, `bilinmeyen netgsm kodu: ${parsed.code}`);
    }

    return {
      // jobid teslim raporu sorgusunun tek anahtarıdır; yoksa gönderimi
      // sonradan kanıtlayamayız.
      providerRef: parsed.jobid ?? `netgsm:${input.messageId}`,
    };
  }
}

/** Hata sağlayıcı tarafından KALICI olarak reddedildi mi? */
export function isNetgsmPermanent(error: unknown): boolean {
  return error instanceof NetgsmPermanentError;
}
