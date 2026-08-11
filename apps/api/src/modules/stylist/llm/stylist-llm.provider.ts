import { appError } from '@vt/contracts';
import type { LlmProvider, LlmStreamEvent, LlmTurnRequest } from '../stylist.ports.js';

/**
 * LLM SAĞLAYICISI — BAĞLAMA NOKTASI
 *
 * Gerçek Anthropic adapter'ı `packages/adapters/src/ai/anthropic.ts` içinde
 * HAZIR (`AnthropicLlmProvider`, `anthropicLlmProviderFromEnv`). Düz `fetch`
 * ile yazılmış, yeni npm paketi gerektirmiyor; timeout, retry, devre kesici ve
 * maliyet ölçümü orada.
 *
 * ⚠️ ŞU AN BAĞLANAMIYOR — iki eksik var ve ikisi de bu ajanın dokunamayacağı
 *    dosyalarda:
 *      1. `apps/api/package.json` → `"@vt/adapters": "workspace:*"` bağımlılığı
 *      2. `packages/adapters/src/index.ts` → `export * from './ai/index.js';`
 *
 *    Bu yüzden varsayılan sağlayıcı `UnavailableLlmProvider`: uygulama açılır,
 *    ticaret akışı çalışır, yalnızca /stylist uçları 503 döner. Yanlış olan
 *    seçenek "hazırım" deyip ilk kullanıcı mesajında patlamaktı.
 *
 * ENTEGRASYON — iki eksik giderildiğinde yapılacak tek iş bu dosyadaki
 * `createStylistLlmProvider` gövdesini aşağıdaki köprüyle değiştirmek. Port
 * sözleşmesi (`stylist.ports.ts`) değişmediği için servis, araç ve denetleyici
 * kodu dokunulmadan kalır.
 *
 *   import { anthropicLlmProviderFromEnv } from '@vt/adapters';
 *
 *   const upstream = anthropicLlmProviderFromEnv();
 *   return {
 *     name: upstream.name,
 *     model: upstream.model,
 *     isConfigured: true,
 *     async *streamTurn(request) {
 *       const stream = upstream.stream({
 *         system: request.system,
 *         messages: request.messages.map(toUpstreamMessage),
 *         tools: request.tools.map((tool) => ({ ...tool, inputSchema: tool.inputSchema })),
 *         maxOutputTokens: request.maxTokens,
 *         effort: 'low',
 *         // ⚠️ Sistem promptu SABİT (versiyonlu .md) → önek önbelleği tutar.
 *         cacheSystemPrompt: true,
 *         signal: request.signal,
 *       });
 *       for await (const event of stream) { ...  }
 *     },
 *   };
 *
 * OLAY EŞLEMESİ (adapter → bu portun olayları):
 *   TEXT_DELTA            → { type: 'text_delta', text }
 *   TOOL_CALL_END         → { type: 'tool_use', block: { type:'tool_use', ...call } }
 *   TOOL_CALL_START       → yok sayılır (girdi henüz tamam değil)
 *   TOOL_CALL_INPUT_DELTA → yok sayılır (YARIM JSON PARSE EDİLEMEZ)
 *   DONE                  → { type: 'end', result: { ...response } }
 *
 * DURMA NEDENİ EŞLEMESİ:
 *   END_TURN → 'end_turn' | TOOL_USE → 'tool_use' | MAX_TOKENS → 'max_tokens'
 *   REFUSAL  → 'refusal'  | STOP_SEQUENCE/PAUSE_TURN → 'other'
 *
 * ⚠️ PAUSE_TURN'ü 'end_turn'e eşlemeyin: yanıt yarım kalır ve kullanıcıya
 *    tamamlanmış gibi gösterilir. 'other' olarak dönerse servis turu bitirir
 *    ve elindeki metni kaydeder — eksik ama yanlış değil.
 *
 * ⚠️ Maliyet adapter'ın `costMicroUsd` alanından alınır; bu modülde İKİNCİ bir
 *    fiyat tablosu TUTULMAZ. İki tablo kaçınılmaz olarak ayrışır ve hangisinin
 *    doğru olduğu faturaya bakılmadan bilinemez.
 */

/**
 * Sağlayıcı yokken kullanılan yedek.
 *
 * ⚠️ ZARİF DÜŞÜŞ: danışman kapalıyken kullanıcı gezinmeye, sepete atmaya ve
 *    satın almaya devam eder. Buradaki hata ticaret akışına yayılmaz.
 */
export class UnavailableLlmProvider implements LlmProvider {
  readonly name = 'unavailable';
  readonly model = 'none';
  readonly isConfigured = false;

  streamTurn(_request: LlmTurnRequest): AsyncIterable<LlmStreamEvent> {
    throw appError('STYLIST_UNAVAILABLE', {
      internalMessage:
        'LLM sağlayıcısı bağlanmadı: @vt/adapters bağımlılığı ve ai/index dışa aktarımı bekleniyor',
    });
  }
}

/** Sağlayıcı seçimi tek yerde — StylistModule bu fabrikayı çağırır. */
export function createStylistLlmProvider(): LlmProvider {
  return new UnavailableLlmProvider();
}
