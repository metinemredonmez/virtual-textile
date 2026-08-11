import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * iyzico İMZALAMA VE WEBHOOK DOĞRULAMA
 *
 * İki ayrı imza vardır ve karıştırılmaz:
 *  1. GİDEN istek imzası (IYZWSv2) → `secretKey` ile. Bizim iyzico'ya kim
 *     olduğumuzu kanıtlar.
 *  2. GELEN webhook imzası → `webhookSecret` ile. iyzico'nun bize kim
 *     olduğunu kanıtlar. Bu doğrulanmazsa herkes "ödeme başarılı" bildirimi
 *     gönderip bedava sipariş oluşturabilir — en pahalı güvenlik açığı budur.
 */

/** 5 dakikadan eski webhook reddedilir — yakalanan bir istek sonsuza kadar tekrar oynatılamasın. */
export const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Webhook başlıkları.
 * iyzico sürümler arasında başlık adını değiştirdi; ikisi de kabul edilir,
 * ama İMZASIZ istek ASLA kabul edilmez.
 */
export const WEBHOOK_SIGNATURE_HEADERS = ['x-iyz-signature-v3', 'x-iyz-signature'] as const;
export const WEBHOOK_TIMESTAMP_HEADERS = ['x-iyz-timestamp', 'x-iyz-event-time'] as const;

/**
 * IYZWSv2 kimlik doğrulama başlığı.
 *
 * İmza girdisi: randomKey + istek YOLU + istek GÖVDESİ.
 * ⚠️ Gövde, gönderilecek string'in TAM KENDİSİ olmalı. Burada `JSON.stringify`
 *    ikinci kez çağrılırsa (anahtar sırası değişebilir) imza tutmaz; bu yüzden
 *    çağıran taraf gövdeyi bir kez serileştirir ve aynı string'i hem imzaya hem
 *    `fetch`'e verir.
 */
export function buildAuthHeaders(input: {
  apiKey: string;
  secretKey: string;
  uriPath: string;
  body: string;
  /** Test için sabitlenebilir. */
  randomKey?: string;
}): Record<string, string> {
  const randomKey = input.randomKey ?? `${Date.now()}${randomBytes(8).toString('hex')}`;
  const signature = createHmac('sha256', input.secretKey)
    .update(`${randomKey}${input.uriPath}${input.body}`)
    .digest('hex');

  const authString = `apiKey:${input.apiKey}&randomKey:${randomKey}&signature:${signature}`;

  return {
    Authorization: `IYZWSv2 ${Buffer.from(authString).toString('base64')}`,
    'x-iyzi-rnd': randomKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * SABİT ZAMANLI KARŞILAŞTIRMA
 *
 * `a === b` erken çıkar; saldırgan yanıt süresini ölçerek imzayı bayt bayt
 * tahmin edebilir. `timingSafeEqual` eşit uzunluk ister ve uzunluk farkı da
 * bilgi sızdırır — bu yüzden iki taraf da ÖNCE sha256'dan geçirilir: uzunluk
 * her zaman 32 bayttır, karşılaştırma her zaman aynı sürer.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

function pickHeader(
  headers: Record<string, string | undefined>,
  names: readonly string[],
): string | undefined {
  // Başlık adları büyük/küçük harf duyarsızdır; Express küçültür ama
  // adapter'ı başka bir sunucu da çağırabilir.
  const lower = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) lower.set(key.toLowerCase(), value);
  }
  for (const name of names) {
    const found = lower.get(name);
    if (found !== undefined && found !== '') return found;
  }
  return undefined;
}

export interface WebhookSignatureCheck {
  ok: boolean;
  /** Neden reddedildi — LOGLANIR, istemciye dönmez. */
  reason?: 'signature_missing' | 'timestamp_missing' | 'timestamp_expired' | 'signature_mismatch';
}

/**
 * HAM gövde üzerinden HMAC-SHA256 doğrulaması.
 *
 * ⚠️ `rawBody` Buffer'dır ve JSON.parse'tan ÖNCE gelir. Parse edilmiş nesneden
 *    yeniden serileştirme (anahtar sırası, sayı biçimi, unicode kaçışları)
 *    imzayı bozar — doğrulama sessizce her zaman başarısız olur.
 *
 * İmza girdisi `${timestamp}.${rawBody}` şeklindedir: zaman damgası imzanın
 * İÇİNDE olmazsa saldırgan eski bir imzayı yeni bir zaman damgasıyla tekrar
 * oynatabilir ve 5 dakika kuralı işlevsiz kalır.
 */
export function verifyWebhookSignature(input: {
  rawBody: Buffer;
  headers: Record<string, string | undefined>;
  webhookSecret: string;
  now?: () => number;
  maxAgeMs?: number;
}): WebhookSignatureCheck {
  const provided = pickHeader(input.headers, WEBHOOK_SIGNATURE_HEADERS);
  if (!provided) return { ok: false, reason: 'signature_missing' };

  const timestampRaw = pickHeader(input.headers, WEBHOOK_TIMESTAMP_HEADERS);
  if (!timestampRaw) return { ok: false, reason: 'timestamp_missing' };

  const timestampMs = normalizeTimestamp(timestampRaw);
  if (timestampMs === null) return { ok: false, reason: 'timestamp_missing' };

  const now = (input.now ?? Date.now)();
  const maxAge = input.maxAgeMs ?? WEBHOOK_MAX_AGE_MS;
  // Mutlak fark: geleceğe ait zaman damgası da reddedilir, aksi hâlde
  // saldırgan çok ileri bir tarih vererek imzayı süresiz kullanabilir.
  if (Math.abs(now - timestampMs) > maxAge) return { ok: false, reason: 'timestamp_expired' };

  const expected = createHmac('sha256', input.webhookSecret)
    .update(`${timestampRaw}.`)
    .update(input.rawBody)
    .digest('hex');

  // Sağlayıcı base64 de gönderebilir; ikisi de sabit zamanda denenir.
  const expectedBase64 = Buffer.from(expected, 'hex').toString('base64');
  const candidate = provided.trim();

  const matched = safeEqual(candidate, expected) || safeEqual(candidate, expectedBase64);
  return matched ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

/** Saniye veya milisaniye cinsinden gelebilir; ikisini de milisaniyeye çeker. */
function normalizeTimestamp(raw: string): number | null {
  if (!/^\d{1,20}$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) return null;
  // 10 hane = saniye (yaklaşık 2001–2286 arası), 13 hane = milisaniye.
  return raw.trim().length <= 10 ? value * 1000 : value;
}
