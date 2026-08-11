import type { CostMetering } from './ai-cost.js';

/**
 * DİL MODELİ SAĞLAYICISI ARAYÜZÜ
 *
 * Stil danışmanı için tasarlandı: kullanıcıyla çok turlu sohbet, ürün
 * kataloğuna araç çağrısıyla erişim ve akış (streaming) ile yanıt.
 *
 * Uygulama kodu YALNIZCA bu arayüzü konuşur. Sağlayıcıya özgü hiçbir tip
 * (Anthropic blok şemaları, SSE olayları) `apps/api` içine sızmaz.
 *
 * ⚠️ KVKK: bu arayüzden KULLANICI FOTOĞRAFI GEÇMEZ. `LlmImagePart` yalnızca
 *    ürün görselleri içindir. Fotoğraf gönderimi sanal denemeye özeldir ve
 *    ayrı rıza gerektirir; stil danışmanı sohbetine fotoğraf eklemek o rızayı
 *    sessizce genişletmek olur.
 */

export type LlmRole = 'user' | 'assistant';

export interface LlmTextPart {
  type: 'text';
  text: string;
}

/** ⚠️ Yalnızca ürün görselleri. Kullanıcı fotoğrafı için KULLANILMAZ. */
export interface LlmImagePart {
  type: 'image';
  mediaType: string;
  base64: string;
}

export interface LlmToolUsePart {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmToolResultPart {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type LlmContentPart = LlmTextPart | LlmImagePart | LlmToolUsePart | LlmToolResultPart;

export interface LlmMessage {
  role: LlmRole;
  content: string | LlmContentPart[];
}

/**
 * Araç tanımı.
 *
 * ⚠️ Açıklama alanı modelin aracı NE ZAMAN çağıracağını belirleyen en güçlü
 * sinyaldir. "Ne yaptığını" değil "hangi durumda çağrılacağını" yazın; eksik
 * açıklama modelin aracı hiç çağırmamasına ve kullanıcıya uydurma ürün
 * önermesine yol açar.
 */
export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type LlmToolChoice = 'auto' | 'any' | { name: string };

/**
 * Düşünme derinliği / maliyet kaldıracı.
 * Stil danışmanı için 'low' varsayılandır: sohbet turu başına maliyet
 * doğrudan bütçe guardrail'ine yazılır (AI_STYLIST_DAILY_PER_USER).
 */
export type LlmEffort = 'low' | 'medium' | 'high';

export interface LlmRequest {
  /** Sistem promptu. Sabit tutulursa önbelleklenir — bkz. `cacheSystemPrompt`. */
  system?: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  toolChoice?: LlmToolChoice;
  maxOutputTokens?: number;
  effort?: LlmEffort;
  /**
   * Sistem promptunu sağlayıcı önbelleğine yazar.
   * ⚠️ Önbellek ÖN EK eşleşmesidir: sistem promptuna tarih/kullanıcı adı gibi
   * her istekte değişen bir şey enterpole edilirse önbellek hiç tutmaz ve
   * maliyet ~10 katına çıkar. Sabit prompt + değişkenler mesajlarda.
   */
  cacheSystemPrompt?: boolean;
  /** Retry'da sağlayıcıya aynı anahtar gider. Verilmezse retry KAPALI kabul edilir. */
  idempotencyKey?: string;
  /** Kullanıcı bağlantıyı kapattığında akışı durdurmak için. */
  signal?: AbortSignal;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Önbellekten okunan token (~0,1x fiyat). */
  cacheReadInputTokens: number;
  /** Önbelleğe yazılan token (~1,25x fiyat). */
  cacheCreationInputTokens: number;
}

export type LlmStopReason =
  /** Model sözünü bitirdi. */
  | 'END_TURN'
  /** Araç çağrısı bekliyor — sonucu döndürüp tekrar çağırın. */
  | 'TOOL_USE'
  /** Çıktı sınırına takıldı; yanıt YARIM. Kullanıcıya tam sanılıp gösterilmemeli. */
  | 'MAX_TOKENS'
  /** Güvenlik sınıflandırıcısı reddetti. İçerik boş veya kısmi olabilir. */
  | 'REFUSAL'
  | 'STOP_SEQUENCE'
  /** Sunucu taraflı araç turu duraklattı; aynı geçmişle tekrar çağrılmalı. */
  | 'PAUSE_TURN';

export interface LlmResponse extends CostMetering {
  text: string;
  toolCalls: LlmToolCall[];
  stopReason: LlmStopReason;
  usage: LlmUsage;
  costMicroUsd: bigint;
  model: string;
  latencyMs: number;
}

/**
 * Akış olayları.
 *
 * `TOOL_CALL_INPUT_DELTA` bilinçli olarak ham JSON parçası taşır: araç girdisi
 * parça parça gelir ve yarım JSON parse EDİLEMEZ. Tam nesne yalnızca
 * `TOOL_CALL_END` ile verilir.
 */
export type LlmStreamEvent =
  | { type: 'TEXT_DELTA'; text: string }
  | { type: 'TOOL_CALL_START'; id: string; name: string }
  | { type: 'TOOL_CALL_INPUT_DELTA'; id: string; partialJson: string }
  | { type: 'TOOL_CALL_END'; call: LlmToolCall }
  | { type: 'DONE'; response: LlmResponse };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;

  /** Tek seferlik yanıt. Araç döngüsü çağıran tarafta yürütülür. */
  complete(request: LlmRequest): Promise<LlmResponse>;

  /**
   * Akışlı yanıt. Son olay her zaman `DONE`'dır ve toplam kullanım/maliyet
   * orada gelir — maliyet muhasebesi akışın sonunu beklemek zorundadır.
   */
  stream(request: LlmRequest): AsyncGenerator<LlmStreamEvent>;

  /** Token sayımından mikro-dolar. Bütçe ön kontrolü için. */
  costOf(usage: LlmUsage): bigint;
}
