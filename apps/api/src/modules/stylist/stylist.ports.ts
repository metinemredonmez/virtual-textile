/**
 * STİL DANIŞMANI MODÜLÜNÜN DIŞARIYA BAĞIMLILIKLARI
 *
 * Bu modül yalnızca kendi tablolarına sahiptir: StylistConversation ve
 * StylistMessage. Katalog ve sepet verisine ilgili modüllerin SERVİSLERİ
 * üzerinden erişir (bkz. stylist.tools.ts); henüz servisi yayımlanmamış
 * alanlar (kullanıcı profili, sanal deneme, AI maliyet defteri) için burada
 * dar arayüzler tanımlanır.
 *
 * Neden arayüz: o modüller kendi servislerini yayımladığında `index.ts`
 * içindeki tek bir provider satırı değişir; servis ve araç kodu dokunulmadan
 * kalır. Bağımlılık yönü de doğru kalır — danışman, başka bir modülün Prisma
 * şemasına değil, kendi ihtiyacına ait bir sözleşmeye bağlıdır.
 */

export const LLM_PROVIDER = 'STYLIST_LLM_PROVIDER';
export const USER_PROFILE_PORT = 'STYLIST_USER_PROFILE_PORT';
export const TRYON_PORT = 'STYLIST_TRYON_PORT';
export const AI_USAGE_PORT = 'STYLIST_AI_USAGE_PORT';

// ── LLM sağlayıcısı ────────────────────────────────────────────────────────

export interface LlmTextBlock {
  type: 'text';
  text: string;
}

export interface LlmToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  /** Araç çıktısı — modele metin olarak verilir (JSON serileştirilmiş). */
  content: string;
  isError: boolean;
}

export type LlmContentBlock = LlmTextBlock | LlmToolUseBlock | LlmToolResultBlock;

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: LlmContentBlock[];
}

/** Araç şeması — sağlayıcının beklediği JSON Schema biçimine adapte edilir. */
export interface LlmToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmTurnRequest {
  system: string;
  messages: LlmMessage[];
  tools: LlmToolSpec[];
  maxTokens: number;
  /** İptal edildiğinde sağlayıcı çağrısı da kesilir (istemci bağlantıyı kapattı). */
  signal?: AbortSignal;
}

export type LlmStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface LlmTurnResult {
  stopReason: LlmStopReason;
  /** Asistanın bu turda ürettiği bloklar — geçmişe aynen eklenir. */
  content: Array<LlmTextBlock | LlmToolUseBlock>;
  usage: { inputTokens: number; outputTokens: number };
  /** Gerçek maliyet (mikro-dolar). Tahmin değil, sağlayıcının bildirdiği. */
  costMicroUsd: bigint;
  model: string;
  latencyMs: number;
}

export type LlmStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; block: LlmToolUseBlock }
  | { type: 'end'; result: LlmTurnResult };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** Sağlayıcı yapılandırılmadıysa false — çağrı yapılmadan STYLIST_UNAVAILABLE. */
  readonly isConfigured: boolean;
  /**
   * Tek bir model turunu akıtır. Araç döngüsünü BU METOT ÇALIŞTIRMAZ;
   * `stopReason === 'tool_use'` ile döner, döngüyü servis yönetir — araçlar
   * sunucuda, bizim yetki ve kota kontrollerimizin arkasında çalışmalı.
   */
  streamTurn(request: LlmTurnRequest): AsyncIterable<LlmStreamEvent>;
}

// ── Kullanıcı profili ──────────────────────────────────────────────────────

/**
 * ⚠️ KVKK — VERİ MİNİMİZASYONU
 *
 * Bu şekil kasıtlı olarak dar: boy, kilo ve vücut ölçüleri (göğüs/bel/kalça)
 * yurt dışındaki LLM sağlayıcısına GÖNDERİLMEZ. Bunlar sağlık verisine komşu,
 * hassas alanlardır ve öneri kalitesine katkıları, taşıdıkları riski
 * karşılamaz: bedeni "genelde M alıyor" bilgisi zaten belirliyor.
 *
 * Ölçü tabanlı beden hesabı gerektiğinde bu modül değil, beden öneri motoru
 * çalışır ve sonucu ölçü değil, BEDEN olarak döner.
 */
export interface StylistUserProfile {
  /** Kullanıcının genelde aldığı beden (ör. "M"). */
  usualSize: string | null;
  /** Kalıp tercihi: dar / normal / bol. */
  fitPref: 'SLIM' | 'REGULAR' | 'OVERSIZE' | null;
  /** Favorilerden okunan stil sinyali — ürün başlığı ve rengi. */
  favorites: Array<{ title: string; brandName: string; colors: string[] }>;
  /** Teslim edilmiş siparişlerden beden/renk geçmişi. */
  recentPurchases: Array<{ title: string; size: string; color: string }>;
}

export interface UserProfilePort {
  findByUserId(userId: string): Promise<StylistUserProfile | null>;
}

// ── Sanal deneme ───────────────────────────────────────────────────────────

export interface TryOnHandoff {
  /** Deneme başlatılabilir mi (ürün destekli, kullanıcı uygun). */
  available: boolean;
  /** Uygun değilse kullanıcıya gösterilebilir Türkçe gerekçe. */
  reason?: string;
  /** İstemcinin sanal deneme akışını açması için gereken bağlam. */
  action?: { type: 'OPEN_TRYON'; variantId: string; productTitle: string };
}

export interface TryOnPort {
  /**
   * ⚠️ Sanal deneme İŞİNİ BAŞLATMAZ, yalnızca devreder.
   *
   * Deneme için kullanıcı fotoğrafı ve açık KVKK rızası (yurt dışına aktarım
   * dâhil) gerekir. Rıza, kullanıcının onu verdiği ekranda alınır; bir sohbet
   * mesajının yan etkisi olarak alınmış sayılamaz. Bu yüzden danışman yalnızca
   * "şu varyantla denemeyi aç" sinyali üretir.
   */
  prepare(input: { variantId: string; userId: string }): Promise<TryOnHandoff>;
}

// ── AI maliyet defteri ─────────────────────────────────────────────────────

export interface AiUsageEntry {
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: bigint;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
}

export interface AiUsagePort {
  /** Başarılı da başarısız da yazılır: başarısız çağrı da para harcar. */
  record(entry: AiUsageEntry): Promise<void>;
  /** Platform bütçesi ön kontrolü için harcama toplamları (mikro-dolar). */
  spent(): Promise<{ todayMicroUsd: bigint; thisMonthMicroUsd: bigint }>;
}
