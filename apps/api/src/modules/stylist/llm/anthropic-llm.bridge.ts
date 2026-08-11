import {
  AnthropicLlmProvider,
  circuitFor,
  type LlmContentPart,
  type LlmMessage as UpstreamMessage,
  type LlmResponse as UpstreamResponse,
  type LlmStopReason as UpstreamStopReason,
  type LlmToolDefinition as UpstreamTool,
} from '@vt/adapters';
import type {
  LlmMessage,
  LlmProvider,
  LlmStopReason,
  LlmStreamEvent,
  LlmToolSpec,
  LlmToolUseBlock,
  LlmTurnRequest,
  LlmTurnResult,
  LlmTextBlock,
} from '../stylist.ports.js';

/**
 * ANTHROPIC ADAPTER'I → STİL DANIŞMANI PORTU
 *
 * `stylist.ports.ts` bu modülün ihtiyaç duyduğu DAR sözleşmedir; adapter ise
 * genel amaçlı bir LLM yüzeyidir (tek seferlik yanıt, araç seçimi, maliyet
 * hesabı, görsel parçalar). İkisi bilinçli olarak ayrı: sağlayıcıya özgü hiçbir
 * tip servis koduna sızmasın diye. Bu dosya aradaki TEK çeviri katmanıdır.
 *
 * ⚠️ Bu modülde İKİNCİ BİR FİYAT TABLOSU TUTULMAZ. Maliyet adapter'ın
 *    `costMicroUsd` alanından aynen aktarılır; iki tablo kaçınılmaz olarak
 *    ayrışır ve hangisinin doğru olduğu faturaya bakılmadan bilinemez.
 */

/**
 * DURMA NEDENİ EŞLEMESİ.
 *
 * ⚠️ `PAUSE_TURN` 'end_turn'e EŞLENMEZ. Model sözünü bitirmemiştir; 'end_turn'
 *    denseydi yarım kalmış bir yanıt kullanıcıya tamamlanmış gibi gösterilirdi.
 *    'other' olarak dönünce servis turu bitirir ve elindeki metni kaydeder —
 *    eksik ama yanlış değil.
 */
function toPortStopReason(reason: UpstreamStopReason): LlmStopReason {
  switch (reason) {
    case 'END_TURN':
      return 'end_turn';
    case 'TOOL_USE':
      return 'tool_use';
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'REFUSAL':
      return 'refusal';
    default:
      return 'other';
  }
}

/**
 * Port mesajı → adapter mesajı.
 *
 * Blok şekilleri (text / tool_use / tool_result) zaten yapısal olarak aynı;
 * çeviri yalnızca tip genişletmesidir. Adapter ayrıca `image` parçasını
 * destekler ama bu port ONU HİÇ ÜRETMEZ ve üretmemelidir: kullanıcı fotoğrafı
 * stil danışmanı sohbetinden GEÇMEZ, o ayrı bir rızaya bağlıdır (KVKK).
 */
function toUpstreamMessage(message: LlmMessage): UpstreamMessage {
  return { role: message.role, content: message.content as LlmContentPart[] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Port araç şeması → adapter araç şeması.
 *
 * Port `inputSchema`'yı serbest bir JSON Schema nesnesi olarak taşır; adapter
 * ise `type: 'object'` ve `properties` alanlarını ADIYLA ister. Şemanın geri
 * kalanı (`additionalProperties` gibi) yayılarak KORUNUR — düşürülseydi model,
 * tanımlı olmayan alanları uydurmakta serbest kalırdı.
 */
function toUpstreamTool(tool: LlmToolSpec): UpstreamTool {
  const schema = tool.inputSchema;
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  const required = Array.isArray(schema['required'])
    ? schema['required'].filter((name): name is string => typeof name === 'string')
    : undefined;

  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      ...schema,
      type: 'object',
      properties,
      ...(required === undefined ? {} : { required }),
    },
  };
}

/**
 * Adapter yanıtı → portun tur sonucu.
 *
 * `content` geçmişe AYNEN eklenir (bkz. stylist.service.ts). Bu yüzden metin ve
 * araç çağrıları burada tek listede toplanır; boş metin bloğu eklenmez —
 * sağlayıcı boş `text` içerikli bir asistan mesajını reddeder.
 */
function toPortResult(response: UpstreamResponse): LlmTurnResult {
  const content: Array<LlmTextBlock | LlmToolUseBlock> = [];
  if (response.text !== '') content.push({ type: 'text', text: response.text });
  for (const call of response.toolCalls) {
    content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
  }

  return {
    stopReason: toPortStopReason(response.stopReason),
    content,
    usage: {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
    },
    costMicroUsd: response.costMicroUsd,
    model: response.model,
    latencyMs: response.latencyMs,
  };
}

/**
 * Gerçek LLM sağlayıcısı.
 *
 * ⚠️ `isConfigured` true'dur; çağrı yapılmadan önceki kapı bu alandır ve
 *    yalnızca anahtar VARKEN bu sınıf kurulur (bkz. stylist/index.ts).
 */
export class AnthropicStylistLlmProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly isConfigured = true;

  constructor(private readonly upstream: AnthropicLlmProvider) {
    this.name = upstream.name;
    this.model = upstream.model;
  }

  async *streamTurn(request: LlmTurnRequest): AsyncIterable<LlmStreamEvent> {
    const stream = this.upstream.stream({
      system: request.system,
      messages: request.messages.map(toUpstreamMessage),
      tools: request.tools.map(toUpstreamTool),
      maxOutputTokens: request.maxTokens,
      // Sohbet turu başına maliyet doğrudan kullanıcı kotasına yazılır;
      // danışman için düşük düşünme derinliği yeterli.
      effort: 'low',
      // ⚠️ Sistem promptu SABİT (versiyonlu .md) → sağlayıcı önek önbelleği
      //    tutar. Prompt'a tarih/kullanıcı adı enterpole edilirse önbellek hiç
      //    tutmaz ve maliyet ~10 katına çıkar.
      cacheSystemPrompt: true,
      ...(request.signal ? { signal: request.signal } : {}),
    });

    for await (const event of stream) {
      if (event.type === 'TEXT_DELTA') {
        yield { type: 'text_delta', text: event.text };
      } else if (event.type === 'TOOL_CALL_END') {
        // ⚠️ Yalnızca TOOL_CALL_END aktarılır. TOOL_CALL_START girdiyi henüz
        //    taşımaz, TOOL_CALL_INPUT_DELTA ise YARIM JSON'dur — parse
        //    edilemez ve edilmeye çalışılırsa araç yanlış argümanla çalışır.
        yield {
          type: 'tool_use',
          block: {
            type: 'tool_use',
            id: event.call.id,
            name: event.call.name,
            input: event.call.input,
          },
        };
      } else if (event.type === 'DONE') {
        yield { type: 'end', result: toPortResult(event.response) };
      }
    }
  }
}

export interface AnthropicStylistOptions {
  apiKey: string;
  model: string;
}

/** Anahtarı doğrulanmış bir ortamdan gerçek sağlayıcıyı kurar. */
export function createAnthropicStylistProvider(options: AnthropicStylistOptions): LlmProvider {
  return new AnthropicStylistLlmProvider(
    new AnthropicLlmProvider({
      apiKey: options.apiKey,
      model: options.model,
      // Devre kesici sağlayıcı ADIYLA paylaşılır: aynı süreçteki her danışman
      // çağrısı aynı devreyi görsün, biri açıkken diğeri ısrar etmesin.
      circuitBreaker: circuitFor('anthropic'),
    }),
  );
}
