/**
 * AI SAĞLAYICILARI İÇİN ORTAK HTTP KATMANI
 *
 * Neden SDK yok: bu paketin çalışma zamanı bağımlılığı YOK (yalnızca @vt/config
 * ve @vt/contracts). Sağlayıcı SDK'ları kendi fetch/retry/timeout mantıklarını
 * getirir ve `resilient()` sarmalayıcımızla çakışır — iki katman birbirinin
 * zaman aşımını ve yeniden denemesini görmez, sonuçta ödediğimiz fatura
 * öngörülemez hâle gelir. Düz fetch ile tek bir dayanıklılık katmanı kalır.
 */

/**
 * HTTP seviyesinde sağlayıcı hatası.
 * `status` alanı `defaultIsRetryable` tarafından okunur — alan adı sözleşmedir.
 */
export class AiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly provider: string,
    /** Gövdenin ilk parçası. ⚠️ Loglanır; kullanıcı fotoğrafı/PII içermemesi için kısaltılır. */
    readonly bodyPreview: string,
    readonly providerCode?: string,
  ) {
    super(`${provider} HTTP ${status}`);
    this.name = 'AiHttpError';
  }
}

/** Sağlayıcı 200 döndürdü ama gövde işe yaramaz (görsel yok, JSON değil vb.). */
export class AiBodyError extends Error {
  constructor(
    readonly provider: string,
    readonly bodyPreview: string,
  ) {
    super(`${provider} beklenen gövdeyi döndürmedi`);
    this.name = 'AiBodyError';
  }
}

/**
 * Log'a giren gövde parçası. Uzunluk sınırı yalnızca yer kazanmak için değil:
 * sağlayıcılar hata gövdesinde bazen isteğin tamamını (yani imzalı fotoğraf
 * URL'ini) yankılar; tamamını loglamak KVKK açısından sızıntıdır.
 */
export function bodyPreview(text: string, limit = 300): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

export interface JsonRequestInput {
  url: string;
  method?: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  provider: string;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}

/**
 * JSON POST — hata durumunda `AiHttpError` fırlatır.
 * Fırlatmak bilinçli: sınıflandırma tek yerde (`tryon.error-map.ts`) yapılsın
 * diye taşıma katmanı karar vermez, sadece olguyu taşır.
 */
export async function requestJson(input: JsonRequestInput): Promise<{
  json: unknown;
  headers: Headers;
  status: number;
}> {
  const response = await input.fetchImpl(input.url, {
    method: input.method ?? 'POST',
    headers: input.headers,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new AiHttpError(response.status, input.provider, bodyPreview(text));
  }

  try {
    return {
      json: JSON.parse(text) as unknown,
      headers: response.headers,
      status: response.status,
    };
  } catch {
    // Gövde JSON değilse araya proxy/bakım sayfası girmiştir; bu geçici bir
    // durumdur ve 502 olarak işaretlenip yeniden denenebilir sayılır.
    throw new AiHttpError(502, input.provider, bodyPreview(text));
  }
}

/**
 * Üretilen görselin ham baytları.
 *
 * ⚠️ Bu indirme BAŞARISIZ OLSA BİLE üretim ücreti çoktan tahakkuk etmiştir.
 * Çağıran taraf maliyeti yine kaydetmelidir, yoksa fatura ile kayıtlarımız
 * sessizce ayrışır.
 */
export async function downloadBinary(
  url: string,
  provider: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await fetchImpl(url, { method: 'GET' });

  if (!response.ok) {
    throw new AiHttpError(response.status, provider, `görsel indirilemedi: ${url.slice(0, 80)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.byteLength > maxBytes) {
    // Sağlayıcı beklenmedik boyutta içerik döndürdüyse belleğe almak yerine
    // reddederiz; kuyruk işçisi tek bir yanıtla şişmemelidir.
    throw new AiBodyError(provider, `görsel ${buffer.byteLength} bayt, sınır ${maxBytes}`);
  }

  return {
    bytes: buffer,
    contentType: response.headers.get('content-type') ?? 'image/png',
  };
}

// ── SSE (Server-Sent Events) ───────────────────────────────────────────────

export interface SseMessage {
  event?: string;
  data: string;
}

/**
 * SSE akışını olay olay çözer.
 *
 * Neden elle: streaming yanıtta kullanıcı ilk kelimeyi ~300 ms içinde görür;
 * gövdeyi tamamen bekleyip parse etmek stil danışmanını "donmuş" gösterir.
 * Tampon sınır kontrolü şart — bir olay iki TCP paketine bölünebilir ve
 * yarım JSON parse edilirse akış ortasında çöker.
 */
export async function* readSseStream(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<SseMessage> {
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const message = parseSseBlock(block);
        if (message) yield message;
        boundary = buffer.indexOf('\n\n');
      }
    }

    const tail = parseSseBlock(buffer);
    if (tail) yield tail;
  } finally {
    // Tüketici erken çıkarsa (ör. kullanıcı sekmeyi kapattı) bağlantıyı
    // serbest bırakmazsak sağlayıcı token üretmeye ve fatura kesmeye devam eder.
    await reader.cancel().catch(() => undefined);
  }
}

function parseSseBlock(block: string): SseMessage | undefined {
  const dataLines: string[] = [];
  let event: string | undefined;

  for (const line of block.split('\n')) {
    if (line.startsWith(':') || line.trim() === '') continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }

  if (dataLines.length === 0) return undefined;
  return event === undefined
    ? { data: dataLines.join('\n') }
    : { event, data: dataLines.join('\n') };
}

// ── Küçük okuma yardımcıları (bilinmeyen JSON için) ───────────────────────

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readString(source: unknown, key: string): string | undefined {
  const record = asRecord(source);
  const value = record?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function readNumber(source: unknown, key: string): number | undefined {
  const record = asRecord(source);
  const value = record?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

export function readArray(source: unknown, key: string): unknown[] {
  const record = asRecord(source);
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

/** İç içe yolu güvenle okur: readPath(json, 'candidates', 0, 'content'). */
export function readPath(source: unknown, ...path: Array<string | number>): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      const record = asRecord(current);
      if (!record) return undefined;
      current = record[segment];
    }
  }
  return current;
}
