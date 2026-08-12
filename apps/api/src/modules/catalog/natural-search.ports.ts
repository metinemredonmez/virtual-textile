/**
 * DOĞAL DİLDE ARAMANIN DIŞARIYA BAĞIMLILIKLARI
 *
 * Bu dosya, arama servisinin ihtiyaç duyduğu DAR sözleşmeleri tanımlar.
 * Gerekçe `stylist.ports.ts` ile aynıdır: servis kodu Anthropic'e, Redis'e ya
 * da Prisma'ya değil, bu dosyadaki arayüzlere bağlıdır. Sağlayıcı değişince
 * `natural-search.module.ts` içindeki tek bir provider satırı değişir.
 */

export const SEARCH_INTENT_PROVIDER = 'CATALOG_SEARCH_INTENT_PROVIDER';
export const SEARCH_VOCABULARY_PORT = 'CATALOG_SEARCH_VOCABULARY_PORT';
export const SEARCH_QUOTA_PORT = 'CATALOG_SEARCH_QUOTA_PORT';
export const SEARCH_AI_USAGE_PORT = 'CATALOG_SEARCH_AI_USAGE_PORT';

// ── Katalog söz varlığı ────────────────────────────────────────────────────

/**
 * Modelin SEÇEBİLECEĞİ değerler kümesi.
 *
 * İki işi birden görür:
 *  1. İsteme konur → model kapalı bir kümeden seçer, uydurma olasılığı düşer.
 *  2. Yanıt doğrulanır → uydurduysa değer AYIKLANIR (bkz. `sanitizeIntent`).
 *
 * ⚠️ İkincisi vazgeçilmezdir. Birincisi olasılık azaltır, garanti vermez.
 *    Uydurma bir kategori adresi `listProducts` içinde özyinelemeli CTE'yi
 *    BOŞ küme yapar ve arama HATA VERMEDEN sıfır sonuç döner — kullanıcı
 *    "ürün yok" sanır. Sessiz sıfır, gürültülü hatadan çok daha kötüdür.
 */
export interface CatalogVocabulary {
  /** Yayındaki kategori bağlantı adresleri. */
  categorySlugs: readonly string[];
  /** Katalogdaki renk adları — veritabanındaki YAZIMIYLA (ör. "Siyah"). */
  colors: readonly string[];
  /** En çok ürünü olan markalar. */
  brands: readonly string[];
}

export interface CatalogVocabularyPort {
  load(): Promise<CatalogVocabulary>;
}

// ── Niyet çözümleyici (LLM) ────────────────────────────────────────────────

/**
 * ⚠️ KVKK — VERİ MİNİMİZASYONU, TİP DÜZEYİNDE ZORLANIR.
 *
 * Bu arayüzde `userId` YOKTUR, profil YOKTUR, sohbet geçmişi YOKTUR ve
 * bilinçli olarak EKLENMEMELİDİR. Yurt dışındaki sağlayıcıya giden tek veri
 * kullanıcının yazdığı cümle ile katalogun kendi söz varlığıdır. Kimlik
 * parametresi olmadığı için, bir gün biri "kişiselleştirelim" dediğinde bu
 * dosyayı değiştirmek zorunda kalır — yani karar görünür olur.
 *
 * Rıza kaydı ARANMAZ; gerekçe `natural-search.service.ts` başlığındadır.
 */
export interface IntentRequest {
  query: string;
  vocabulary: CatalogVocabulary;
  /** İstemci bağlantıyı kapattıysa sağlayıcı çağrısı da kesilir. */
  signal?: AbortSignal;
}

export interface IntentResponse {
  /**
   * Modelin ürettiği HAM nesne. Doğrulanmamıştır ve bilinçli olarak `unknown`
   * tipindedir: doğrulama tek yerde, `parseIntent` içinde yapılsın.
   */
  raw: unknown;
  usage: { inputTokens: number; outputTokens: number };
  /** Sağlayıcının bildirdiği gerçek maliyet (mikro-dolar). Tahmin değil. */
  costMicroUsd: bigint;
  latencyMs: number;
  model: string;
}

export interface SearchIntentProvider {
  readonly name: string;
  readonly model: string;
  /** Yapılandırılmadıysa false — çağrı YAPILMADAN anahtar kelime yoluna düşülür. */
  readonly isConfigured: boolean;
  interpret(request: IntentRequest): Promise<IntentResponse>;
}

// ── Kota ───────────────────────────────────────────────────────────────────

/**
 * Kota öznesi.
 *
 * Misafir de doğal dilde arama yapabilmelidir (katalog herkese açıktır), ama
 * kimliksiz kullanım kotasız kullanım olamaz; bu yüzden misafir IP ile sayılır
 * ve tavanı düşüktür. Aynı ayrımın karşılığı sanal denemede de var:
 * `perUserDailyTryOn` / `perGuestDailyTryOn` (bkz. `ai-budget.ts`).
 */
export type QuotaSubject = { kind: 'user'; id: string } | { kind: 'guest'; id: string };

export interface SearchQuotaPort {
  /**
   * Bir hak tüketir.
   *
   * ⚠️ `false` dönmek HATA DEĞİLDİR: çağıran anahtar kelime aramasına düşer.
   *    Sayaç okunamıyorsa da `false` döner — kota bilinmiyorken LLM'e gitmek
   *    sınırsız harcamaya açık kapı bırakır, düşmek ise yalnızca aramayı
   *    sadeleştirir.
   */
  consume(subject: QuotaSubject): Promise<boolean>;
  /** Çağrı YAPILMADAN vazgeçildiyse hakkı geri verir. */
  refund(subject: QuotaSubject): Promise<void>;
}

// ── AI maliyet defteri ─────────────────────────────────────────────────────

export interface SearchAiUsageEntry {
  /** Misafirde null — kayıt yine de yazılır, harcama harcamadır. */
  userId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: bigint;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
}

export interface SearchAiUsagePort {
  /** Başarılı da başarısız da yazılır: başarısız çağrı da para harcar. */
  record(entry: SearchAiUsageEntry): Promise<void>;
  /** Platform bütçesi ön kontrolü için harcama toplamları (mikro-dolar). */
  spent(): Promise<{ todayMicroUsd: bigint; thisMonthMicroUsd: bigint }>;
}
