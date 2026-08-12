import { RESILIENCE, env } from '@vt/config';
import { AppError, appError } from '@vt/contracts';
import { CircuitOpenError, type CircuitBreaker } from '../resilience/circuit-breaker.js';
import { TimeoutError, resilient } from '../resilience/resilient.js';
import { anthropicPrice, meterCost, tokenCostMicroUsd, type CostMetering } from './ai-cost.js';
import {
  AiHttpError,
  asRecord,
  bodyPreview,
  readArray,
  readNumber,
  readPath,
  readSseStream,
  readString,
} from './http.js';
import type {
  LlmContentPart,
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmStopReason,
  LlmStreamEvent,
  LlmToolCall,
  LlmToolDefinition,
  LlmUsage,
} from './llm.provider.js';

/**
 * ANTHROPIC (Claude) ADAPTER'I — stil danışmanı
 *
 * ⚠️ SDK YERİNE DÜZ FETCH — KARAR VERİLDİ, beklemede değil.
 *
 * Eski gerekçelerden biri ("yeni paket kurulamıyor") artık geçerli değil:
 * `@anthropic-ai/sdk` kurulabilir. Buna rağmen KURULMADI, çünkü asıl gerekçe
 * kurulabilirlik değildi:
 *
 *  1. SDK kendi retry (varsayılan 2) ve timeout (10 dk) mantığını getirir.
 *     Bizim `resilient()` katmanımızla üst üste binerse gerçek deneme sayısı
 *     çarpılır: 3 × 2 = 6 faturalanabilir çağrı. AI'da bu doğrudan paradır ve
 *     `ai-budget` sayaçları bu çarpanı görmez — bütçe sessizce aşılır.
 *  2. İhtiyacımız olan yüzey dar: tek uç nokta, araç çağrısı ve SSE. SSE
 *     ayrıştırma ~40 satır ve `http.ts` içinde zaten paylaşılıyor.
 *  3. `tryon.error-map.test.ts` sağlayıcı yanıtlarını HTTP seviyesinde sahte
 *     `fetch` ile kuruyor. SDK'ya geçiş bu testlerin kurulum yüzeyini de
 *     değiştirir; kazanç yokken üstlenilecek bir risk değil.
 *
 * Geçilmek istenirse: `resilient()` sarmalayıcısı ile SDK'nın `maxRetries: 0`
 * ayarı BİRLİKTE verilmeli. `LlmProvider` arayüzü ve çağıran kod değişmez.
 */

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Varsayılan çıktı sınırı. Ürün kararı: stil danışmanı yanıtları kısadır;
 * sınırı yüksek tutmak maliyeti değil ama kaçak bir döngüde riski büyütür.
 * Yarım yanıt riskine karşı yine de rahat bir tavan bırakılır.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

export interface AnthropicConfig {
  apiKey: string;
  /** env().ANTHROPIC_MODEL */
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  circuitBreaker?: CircuitBreaker;
  now?: () => number;
  /** Tek çağrı için üst sınır. Akışta yalnızca BAĞLANTI kurulumunu kapsar. */
  timeoutMs?: number;
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic';

  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly baseUrl: string;

  constructor(private readonly config: AnthropicConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.now = config.now ?? Date.now;
    this.baseUrl = config.baseUrl ?? ANTHROPIC_BASE_URL;
  }

  get model(): string {
    return this.config.model;
  }

  costOf(usage: LlmUsage): bigint {
    return tokenCostMicroUsd(usage, anthropicPrice(this.config.model));
  }

  // ── Tek seferlik yanıt ──────────────────────────────────────────────────

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const startedAt = this.now();

    return resilient<LlmResponse>(
      {
        provider: this.name,
        operation: 'complete',
        errorCode: 'STYLIST_UNAVAILABLE',
        ...(this.config.timeoutMs === undefined ? {} : { timeoutMs: this.config.timeoutMs }),
        ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
        retryAttempts: 2,
        // ⚠️ Zaman aşımı TEKRAR DENENMEZ: model çıktıyı üretmiş ve faturalamış
        //    olabilir. 429/5xx ise istek işlenmeden reddedilmiştir, ucuzdur.
        isRetryable: isLlmRetryable,
        ...(this.config.circuitBreaker ? { circuitBreaker: this.config.circuitBreaker } : {}),
        // Hata katalog koduna burada çevrilir; `resilient` tek bir kodla
        // sarmalasaydı 429 ile gerçek kesinti ayırt edilemezdi.
        fallback: (error) => {
          throw mapLlmError(error);
        },
      },
      async () => {
        // ⚠️ `resilient()` zaman aşımında yarışı kaybeden isteği TERK EDER,
        //    iptal etmez. Terk edilen bir LLM isteği sunucu tarafında token
        //    üretmeye ve faturalanmaya devam eder. Kendi kontrolörümüzü
        //    fetch'e vererek bağlantıyı gerçekten kapatıyoruz; burada kapsam
        //    gövdenin tamamını okumayı da içerir.
        const cancel = this.startCancellation(request);
        try {
          const response = await this.send(request, false, cancel.signal);
          const text = await response.text();

          if (!response.ok) {
            throw new AiHttpError(response.status, this.name, bodyPreview(text));
          }

          let json: unknown;
          try {
            json = JSON.parse(text) as unknown;
          } catch {
            throw new AiHttpError(502, this.name, bodyPreview(text));
          }

          return this.toResponse(json, startedAt);
        } finally {
          cancel.dispose();
        }
      },
    );
  }

  // ── Akış ────────────────────────────────────────────────────────────────

  /**
   * ⚠️ AKIŞTA YENİDEN DENEME YOK.
   *
   * İlk token kullanıcıya gittikten sonra isteği tekrarlamak, kullanıcıya
   * cümlenin bir kısmını iki kez göstermek (ve iki kez ödemek) demektir.
   * Bağlantı kurulumu başarısız olursa çağıran taraf yeni bir tur başlatabilir;
   * karar orada, burada değil.
   */
  async *stream(request: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    const startedAt = this.now();
    const cancel = this.startCancellation(request);

    try {
      let response: Response;
      try {
        response = await this.send(request, true, cancel.signal);
      } catch (error) {
        throw mapLlmError(error);
      } finally {
        // ⚠️ Zaman aşımı sayacı yalnızca BAĞLANTI KURULUMUNU kapsar. Başlıklar
        //    geldikten sonra sayacı durdurmazsak uzun ama sağlıklı bir yanıtın
        //    ortasında akışı kendimiz keseriz.
        cancel.stopTimer();
      }

      if (!response.ok) {
        const text = await response.text();
        throw mapLlmError(new AiHttpError(response.status, this.name, bodyPreview(text)));
      }

      const state = new StreamAccumulator();

      for await (const message of readSseStream(response.body)) {
        if (message.data === '[DONE]') break;

        let event: unknown;
        try {
          event = JSON.parse(message.data) as unknown;
        } catch {
          // Bozuk tek bir olay akışın tamamını düşürmemeli.
          continue;
        }

        const type = readString(event, 'type');

        if (type === 'error') {
          const detail =
            readString(readPath(event, 'error'), 'message') ?? 'bilinmeyen akış hatası';
          throw appError('STYLIST_UNAVAILABLE', {
            internalMessage: `anthropic akış hatası: ${bodyPreview(detail)}`,
          });
        }

        for (const emitted of state.consume(event, type)) {
          yield emitted;
        }
      }

      yield {
        type: 'DONE',
        response: this.buildResponse({
          text: state.text,
          toolCalls: state.toolCalls,
          stopReason: state.stopReason,
          usage: state.usage,
          startedAt,
        }),
      };
    } finally {
      // Tüketici erken çıkarsa (kullanıcı sekmeyi kapattı) isteği iptal ederiz;
      // aksi hâlde kimsenin okumadığı token üretilmeye ve faturalanmaya devam eder.
      cancel.abort();
    }
  }

  /**
   * İptal kontrolü: zaman aşımı sayacı + çağıranın sinyali tek bir
   * AbortController'da toplanır.
   */
  private startCancellation(request: LlmRequest): {
    signal: AbortSignal;
    stopTimer: () => void;
    abort: () => void;
    dispose: () => void;
  } {
    const controller = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? RESILIENCE.defaultTimeoutMs;

    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    const stopTimer = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const onCallerAbort = (): void => {
      controller.abort();
    };
    request.signal?.addEventListener('abort', onCallerAbort, { once: true });

    const dispose = (): void => {
      stopTimer();
      request.signal?.removeEventListener('abort', onCallerAbort);
    };

    return {
      signal: controller.signal,
      stopTimer,
      abort: () => {
        controller.abort();
        dispose();
      },
      dispose,
    };
  }

  // ── İç yardımcılar ──────────────────────────────────────────────────────

  private async send(request: LlmRequest, stream: boolean, signal: AbortSignal): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        // ⚠️ Anahtar başlıkta; sorgu dizesinde ASLA (proxy loglarına düşer).
        'x-api-key': this.config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(this.buildBody(request, stream)),
      signal,
    });
  }

  private buildBody(request: LlmRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      messages: request.messages.map(toAnthropicMessage),
      // Uyarlanabilir düşünme AÇIK bırakılır.
      // ⚠️ Kapatmak (`disabled`) cazip görünür (daha ucuz) ama araç çağıran bir
      //    akışta model araç çağrısını YAPISAL blok yerine düz metin olarak
      //    yazabiliyor: tur başarıyla biter, araç hiç çalışmaz, hata da oluşmaz.
      //    Stil danışmanı ürün aramayı araçla yaptığı için bu sessiz bozulma
      //    demektir. Maliyeti `effort` ile kısarız, düşünmeyi kapatarak değil.
      thinking: { type: 'adaptive' },
      output_config: { effort: request.effort ?? 'low' },
      stream,
    };

    if (request.system !== undefined && request.system !== '') {
      body['system'] = request.cacheSystemPrompt
        ? [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }]
        : request.system;
    }

    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools.map(toAnthropicTool);
      if (request.toolChoice) body['tool_choice'] = toAnthropicToolChoice(request.toolChoice);
    }

    return body;
  }

  private toResponse(json: unknown, startedAt: number): LlmResponse {
    const stopReason = mapStopReason(readString(json, 'stop_reason'));

    // ⚠️ `stop_reason` İÇERİKTEN ÖNCE okunur. Reddedilen bir istekte içerik
    //    boş gelir; `content[0].text` okumaya çalışan kod burada patlar.
    const blocks = readArray(json, 'content');
    const text = blocks
      .filter((block) => readString(block, 'type') === 'text')
      .map((block) => readString(block, 'text') ?? '')
      .join('');

    const toolCalls: LlmToolCall[] = blocks
      .filter((block) => readString(block, 'type') === 'tool_use')
      .map((block) => ({
        id: readString(block, 'id') ?? '',
        name: readString(block, 'name') ?? '',
        input: asRecord(readPath(block, 'input')) ?? {},
      }))
      .filter((call) => call.id !== '' && call.name !== '');

    return this.buildResponse({
      text,
      toolCalls,
      stopReason,
      usage: readUsage(readPath(json, 'usage')),
      startedAt,
    });
  }

  private buildResponse(input: {
    text: string;
    toolCalls: LlmToolCall[];
    stopReason: LlmStopReason;
    usage: LlmUsage;
    startedAt: number;
  }): LlmResponse {
    // Anthropic parasal maliyet döndürmez; token sayımı ölçüm, fiyat bizim
    // varsayımımız → basis `PROVIDER_USAGE`.
    const metering = meterCost({
      estimatedMicroUsd: this.costOf(input.usage),
      fromUsage: true,
    });

    return {
      text: input.text,
      toolCalls: input.toolCalls,
      stopReason: input.stopReason,
      usage: input.usage,
      costMicroUsd: metering.costMicroUsd,
      model: this.config.model,
      latencyMs: this.now() - input.startedAt,
      ...meteringFields(metering),
    };
  }
}

// ── Akış durumu ────────────────────────────────────────────────────────────

interface PendingToolCall {
  id: string;
  name: string;
  json: string;
}

/**
 * SSE olaylarını yanıta biriktirir.
 *
 * Araç girdisi `input_json_delta` ile PARÇA PARÇA gelir; blok bitene kadar
 * JSON geçerli değildir. Parse yalnızca `content_block_stop` anında yapılır.
 */
class StreamAccumulator {
  text = '';
  toolCalls: LlmToolCall[] = [];
  stopReason: LlmStopReason = 'END_TURN';
  usage: LlmUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };

  private readonly pending = new Map<number, PendingToolCall>();

  *consume(event: unknown, type: string | undefined): Generator<LlmStreamEvent> {
    switch (type) {
      case 'message_start': {
        this.usage = readUsage(readPath(event, 'message', 'usage'));
        return;
      }

      case 'content_block_start': {
        const index = readNumber(event, 'index') ?? 0;
        const block = readPath(event, 'content_block');
        if (readString(block, 'type') !== 'tool_use') return;

        const id = readString(block, 'id') ?? '';
        const name = readString(block, 'name') ?? '';
        this.pending.set(index, { id, name, json: '' });
        yield { type: 'TOOL_CALL_START', id, name };
        return;
      }

      case 'content_block_delta': {
        const index = readNumber(event, 'index') ?? 0;
        const delta = readPath(event, 'delta');
        const deltaType = readString(delta, 'type');

        if (deltaType === 'text_delta') {
          const text = readString(delta, 'text') ?? '';
          this.text += text;
          if (text !== '') yield { type: 'TEXT_DELTA', text };
          return;
        }

        if (deltaType === 'input_json_delta') {
          const partial = readString(delta, 'partial_json') ?? '';
          const call = this.pending.get(index);
          if (!call) return;
          call.json += partial;
          yield { type: 'TOOL_CALL_INPUT_DELTA', id: call.id, partialJson: partial };
        }
        return;
      }

      case 'content_block_stop': {
        const index = readNumber(event, 'index') ?? 0;
        const call = this.pending.get(index);
        if (!call) return;
        this.pending.delete(index);

        const parsed = parseToolInput(call.json);
        const complete: LlmToolCall = { id: call.id, name: call.name, input: parsed };
        this.toolCalls.push(complete);
        yield { type: 'TOOL_CALL_END', call: complete };
        return;
      }

      case 'message_delta': {
        const stop = readString(readPath(event, 'delta'), 'stop_reason');
        if (stop) this.stopReason = mapStopReason(stop);
        // Çıkış tokenı yalnızca burada kesinleşir; `message_start`taki değer 0'dır.
        const output = readNumber(readPath(event, 'usage'), 'output_tokens');
        if (output !== undefined) this.usage.outputTokens = output;
        return;
      }

      default:
        return;
    }
  }
}

/**
 * Araç girdisi boş string ise model parametresiz bir araç çağırmıştır — bu
 * geçerlidir ve `{}` demektir. Bozuk JSON ise boş nesne döneriz; çağıran taraf
 * şema doğrulamasında zaten reddedecektir ve akışı çökertmemiz gerekmez.
 */
function parseToolInput(json: string): Record<string, unknown> {
  const trimmed = json.trim();
  if (trimmed === '') return {};
  try {
    return asRecord(JSON.parse(trimmed)) ?? {};
  } catch {
    return {};
  }
}

// ── Eşlemeler ──────────────────────────────────────────────────────────────

function toAnthropicMessage(message: LlmMessage): Record<string, unknown> {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }
  return { role: message.role, content: message.content.map(toAnthropicBlock) };
}

function toAnthropicBlock(part: LlmContentPart): Record<string, unknown> {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image':
      return {
        type: 'image',
        source: { type: 'base64', media_type: part.mediaType, data: part.base64 },
      };
    case 'tool_use':
      return { type: 'tool_use', id: part.id, name: part.name, input: part.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: part.toolUseId,
        content: part.content,
        ...(part.isError ? { is_error: true } : {}),
      };
  }
}

function toAnthropicTool(tool: LlmToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object',
      properties: tool.inputSchema.properties,
      ...(tool.inputSchema.required ? { required: tool.inputSchema.required } : {}),
    },
  };
}

function toAnthropicToolChoice(choice: 'auto' | 'any' | { name: string }): Record<string, unknown> {
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'any') return { type: 'any' };
  return { type: 'tool', name: choice.name };
}

function mapStopReason(value: string | undefined): LlmStopReason {
  switch (value) {
    case 'tool_use':
      return 'TOOL_USE';
    case 'max_tokens':
      return 'MAX_TOKENS';
    case 'refusal':
      return 'REFUSAL';
    case 'stop_sequence':
      return 'STOP_SEQUENCE';
    case 'pause_turn':
      return 'PAUSE_TURN';
    default:
      return 'END_TURN';
  }
}

function readUsage(source: unknown): LlmUsage {
  return {
    inputTokens: readNumber(source, 'input_tokens') ?? 0,
    outputTokens: readNumber(source, 'output_tokens') ?? 0,
    cacheReadInputTokens: readNumber(source, 'cache_read_input_tokens') ?? 0,
    cacheCreationInputTokens: readNumber(source, 'cache_creation_input_tokens') ?? 0,
  };
}

function meteringFields(metering: CostMetering): CostMetering {
  return {
    ...(metering.reportedCostMicroUsd === undefined
      ? {}
      : { reportedCostMicroUsd: metering.reportedCostMicroUsd }),
    ...(metering.estimatedCostMicroUsd === undefined
      ? {}
      : { estimatedCostMicroUsd: metering.estimatedCostMicroUsd }),
    costBasis: metering.costBasis,
  };
}

/** Bkz. `isTryOnRetryable` — aynı gerekçe: zaman aşımı faturalanmış olabilir. */
export function isLlmRetryable(error: unknown): boolean {
  if (error instanceof TimeoutError) return false;
  if (error instanceof CircuitOpenError) return false;
  if (error instanceof AiHttpError) {
    return error.status === 429 || (error.status >= 500 && error.status < 600);
  }
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string';
}

/**
 * Sağlayıcı hatasını katalog koduna çevirir.
 * Ham sağlayıcı mesajı YALNIZCA `internalMessage`e girer; kullanıcı katalogdaki
 * Türkçe metni görür.
 */
export function mapLlmError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof TimeoutError) {
    // Kesinti DEĞİL yavaşlık: sağlayıcı ayakta ama yetişemiyor. İkisi tek
    // kodda toplanınca alarm eşiği "çöktü mü, yavaşladı mı" ayrımını yapamaz.
    return appError('STYLIST_TIMEOUT', {
      cause: error,
      internalMessage: `anthropic zaman aşımı (${error.timeoutMs} ms)`,
    });
  }

  if (error instanceof CircuitOpenError) {
    return appError('STYLIST_UNAVAILABLE', {
      cause: error,
      internalMessage: 'anthropic devre kesici açık',
      retryAfterSeconds: Math.ceil(error.retryAfterMs / 1000),
    });
  }

  if (error instanceof AiHttpError) {
    if (error.status === 429) {
      return appError('STYLIST_RATE_LIMITED', {
        cause: error,
        internalMessage: `anthropic hız limiti: ${error.bodyPreview}`,
      });
    }
    if (error.status === 400 || error.status === 422) {
      return appError('VALIDATION_FAILED', {
        cause: error,
        internalMessage: `anthropic isteği reddetti: ${error.bodyPreview}`,
      });
    }
    if (error.status === 401 || error.status === 403) {
      // Sağlayıcı kesintisi DEĞİL: anahtar/izin bizde yanlış. Kesinti sanılırsa
      // "kendiliğinden düzelir" diye beklenir — oysa kimse anahtarı
      // düzeltmeden hizmet geri gelmez.
      return appError('AI_PROVIDER_MISCONFIGURED', {
        cause: error,
        internalMessage: `anthropic kimlik/izin reddi HTTP ${error.status}: ${error.bodyPreview}`,
      });
    }
    return appError('STYLIST_UNAVAILABLE', {
      cause: error,
      internalMessage: `anthropic HTTP ${error.status}: ${error.bodyPreview}`,
    });
  }

  return appError('STYLIST_UNAVAILABLE', {
    cause: error,
    internalMessage: error instanceof Error ? error.message : String(error),
  });
}

export function anthropicLlmProviderFromEnv(
  overrides: Partial<AnthropicConfig> = {},
): AnthropicLlmProvider {
  const environment = env();
  return new AnthropicLlmProvider({
    apiKey: environment.ANTHROPIC_API_KEY,
    model: environment.ANTHROPIC_MODEL,
    ...overrides,
  });
}
