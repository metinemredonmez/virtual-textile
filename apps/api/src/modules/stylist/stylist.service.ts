import { Inject, Injectable } from '@nestjs/common';
import { appError, toAppError } from '@vt/contracts';
import { aiBudgetFromEnv, checkBudget, env } from '@vt/config';
import { Prisma } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { RedisService } from '../../infra/redis.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { OutfitService } from '../cart/index.js';
import { ACTIVE_PROMPT_VERSION, loadSystemPrompt } from './prompts/index.js';
import {
  AI_USAGE_PORT,
  LLM_PROVIDER,
  TRYON_PORT,
  USER_PROFILE_PORT,
  type AiUsagePort,
  type LlmContentBlock,
  type LlmMessage,
  type LlmProvider,
  type LlmToolUseBlock,
  type LlmTurnResult,
  type TryOnPort,
  type UserProfilePort,
} from './stylist.ports.js';
import { STYLIST_TOOLS, StylistToolExecutor, type ToolContext } from './tools/stylist.tools.js';
import { findUnknownIdsInText, ProductLedger } from './tools/product-ledger.js';
import {
  suggestOutfitsFromWardrobe,
  type OutfitCandidatePiece,
  type OutfitSuggestion,
} from './tools/outfit-suggest.js';
import type { CreateConversationInput, SendMessageInput } from './stylist.schema.js';

/**
 * AI STİL DANIŞMANI
 *
 * Akış: kullanıcı mesajı → model turu → (araç çağrısı → araç sonucu → model
 * turu)* → nihai metin. Araç döngüsü SUNUCUDA döner; sağlayıcının kendi
 * "tool runner"ı kullanılmaz, çünkü araç yürütmesi kota, yetki ve
 * "uydurma ürün" denetimlerinin arkasında kalmalıdır.
 *
 * ⚠️ TİCARET AKIŞI BAĞIMSIZDIR. Bu servis çöktüğünde, kota dolduğunda veya
 *    sağlayıcı yanıt vermediğinde kullanıcı gezinmeye, sepete atmaya ve
 *    satın almaya devam eder. Buradaki hiçbir hata ödeme yoluna yayılmaz.
 */

/** Bir kullanıcı mesajına karşılık en fazla kaç model turu çalışır. */
const MAX_TOOL_ROUNDS = 5;

/** Tur başına azami çıktı — maliyet tavanı. Sohbet yanıtı için fazlasıyla yeter. */
const MAX_OUTPUT_TOKENS = 2048;

/** Modele verilen geçmiş mesaj sayısı — bağlam maliyeti sınırı. */
const HISTORY_LIMIT = 20;

export type StylistEvent =
  | { type: 'start'; data: { conversationId: string } }
  | { type: 'delta'; data: { text: string } }
  | { type: 'tool'; data: { name: string; status: 'running' | 'ok' | 'error' } }
  | { type: 'action'; data: { type: string; payload: unknown } }
  | {
      type: 'done';
      data: { messageId: string; suggestedProductIds: string[]; promptVersion: string };
    }
  | { type: 'error'; data: { code: string; message: string; retryable: boolean } };

export type StylistEmit = (event: StylistEvent) => void;

export interface ConversationView {
  id: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    suggestedProductIds: string[];
    createdAt: Date;
  }>;
}

@Injectable()
export class StylistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly catalog: CatalogService,
    private readonly outfits: OutfitService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(USER_PROFILE_PORT) private readonly profiles: UserProfilePort,
    @Inject(TRYON_PORT) private readonly tryOn: TryOnPort,
    @Inject(AI_USAGE_PORT) private readonly usage: AiUsagePort,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── Kombin önerisi (akış DIŞI, senkron) ──────────────────────────────────

  /**
   * Verilen parçalardan kombin önerir.
   *
   * ⚠️ BU METOT SOHBET AKIŞINDAN AYRIDIR ve kasten öyledir. Danışmanın geri
   *    kalanı SSE + LLM + kota üzerine kuruludur; gardırop ekranının ihtiyacı
   *    ise tek bir senkron cevaptır. `streamTurn` üzerinden geçirilseydi,
   *    kullanıcı dolabını her açtığında bir LLM turu ve bir kota birimi
   *    harcanırdı — üstelik cevap her seferinde değişerek.
   *
   * ⚠️ Kural motoru (`color-harmony.ts`) DEĞİŞTİRİLMEDEN kullanılıyor: sohbet
   *    ekranındaki uyum kararı ile gardırop ekranındakinin aynı olması, iki
   *    yerde iki farklı moda kuralı bulunmamasına bağlı.
   *
   * ⚠️ `userId` kota için DEĞİL, log/teşhis için alınır — burada sağlayıcıya
   *    çağrı yok, dolayısıyla harcanan bir şey de yok.
   */
  suggestOutfits(input: {
    userId: string;
    items: readonly OutfitCandidatePiece[];
    limit: number;
  }): OutfitSuggestion[] {
    return suggestOutfitsFromWardrobe({ items: input.items, limit: input.limit });
  }

  // ── Konuşma yönetimi ─────────────────────────────────────────────────────

  async createConversation(
    userId: string,
    input: CreateConversationInput,
  ): Promise<ConversationView> {
    const conversation = await this.prisma.stylistConversation.create({
      data: { userId, title: input.title ?? null },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
    return { ...conversation, messages: [] };
  }

  async getConversation(userId: string, conversationId: string): Promise<ConversationView> {
    const conversation = await this.loadOwnedConversation(userId, conversationId);

    const messages = await this.prisma.stylistMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        suggestedProductIds: true,
        createdAt: true,
      },
    });

    return { ...conversation, messages };
  }

  /**
   * Mesaj göndermeden ÖNCE çalışan kapılar.
   *
   * ⚠️ SSE gövdesi açılmadan çağrılır. Açıldıktan sonra HTTP durum kodu
   *    değiştirilemez; kota aşımını 200 gövdesi içinde bildirmek, istemcinin
   *    429'a göre davranmasını (Retry-After, geri çekilme) imkânsız kılardı.
   */
  async assertCanSend(userId: string, conversationId: string): Promise<void> {
    await this.loadOwnedConversation(userId, conversationId);

    if (!this.llm.isConfigured) {
      throw appError('STYLIST_UNAVAILABLE', {
        internalMessage: `LLM sağlayıcısı hazır değil: ${this.llm.name}`,
      });
    }

    await this.consumeQuota(userId);

    // Platform bütçesi: kullanıcı kotası dolmasa bile toplam harcama tavanı
    // aşıldıysa AI kapanır. Kota kullanıcıyı, bütçe şirketi korur.
    const budget = aiBudgetFromEnv(env());
    const decision = checkBudget(budget, await this.usage.spent());
    if (!decision.allowed) {
      await this.refundQuota(userId);
      this.logger.error({ reason: decision.reason }, 'AI bütçesi doldu, stil danışmanı kapalı');
      // Sağlayıcı kesintisi değil, BİZİM harcama tavanımız doldu. Katalog
      // mesajı artık özellik adı geçirmediği için bu akışta da doğru okunur.
      throw appError('AI_BUDGET_EXCEEDED', {
        internalMessage: `AI bütçesi aşıldı: ${decision.reason}`,
      });
    }
  }

  // ── Mesaj turu ───────────────────────────────────────────────────────────

  /**
   * Kullanıcı mesajını işler ve olayları `emit` ile akıtır.
   *
   * Hata durumunda FIRLATMAZ: SSE başlıkları çoktan gönderilmiştir, HTTP
   * hatası üretmenin yolu kalmamıştır. Hata `error` olayı olarak akıtılır ve
   * bağlantı düzgün kapatılır.
   */
  async streamTurn(
    userId: string,
    conversationId: string,
    input: SendMessageInput,
    emit: StylistEmit,
    signal?: AbortSignal,
  ): Promise<void> {
    emit({ type: 'start', data: { conversationId } });

    // Kullanıcı mesajı ÖNCE yazılır: model çökse bile kullanıcının yazdığı
    // kaybolmamalı, tekrar bağlandığında konuşmada durmalı.
    await this.persistUserMessage(conversationId, input.content);

    const history = await this.loadHistory(conversationId);
    const ledger = ProductLedger.hydrate(history.ledgerSnapshots);
    const executor = new StylistToolExecutor(this.catalog, this.outfits, this.profiles, this.tryOn);
    const ctx: ToolContext = { userId, ledger, preferredSize: null };

    const messages: LlmMessage[] = [...history.messages];
    const toolCalls: Array<{ name: string; isError: boolean }> = [];
    let answer = '';
    let totalCostMicroUsd = 0n;

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const turn = await this.runOneTurn(userId, messages, emit, signal);
        totalCostMicroUsd += turn.result.costMicroUsd;
        answer += turn.text;

        if (turn.result.stopReason === 'refusal') {
          // Güvenlik sınıflandırıcısı reddetti: içerik BOŞ gelir, `content[0]`
          // okunursa patlar. Bu bir sistem hatası değil, bir sonuçtur —
          // kullanıcıya hata kodu değil, cümle gösterilir.
          if (answer.trim().length === 0) {
            answer = 'Bu konuda yardımcı olamıyorum. Başka bir şey sorabilirsin.';
            emit({ type: 'delta', data: { text: answer } });
          }
          break;
        }

        if (turn.result.stopReason !== 'tool_use' || turn.toolUses.length === 0) break;

        messages.push({ role: 'assistant', content: turn.result.content });

        const results: LlmContentBlock[] = [];
        for (const toolUse of turn.toolUses) {
          emit({ type: 'tool', data: { name: toolUse.name, status: 'running' } });
          const outcome = await executor.execute(toolUse.name, toolUse.input, ctx);
          toolCalls.push({ name: toolUse.name, isError: outcome.isError });
          emit({
            type: 'tool',
            data: { name: toolUse.name, status: outcome.isError ? 'error' : 'ok' },
          });
          if (outcome.clientAction) {
            emit({ type: 'action', data: outcome.clientAction });
          }
          results.push({
            type: 'tool_result',
            toolUseId: toolUse.id,
            content: outcome.content,
            isError: outcome.isError,
          });
        }

        // ⚠️ Tüm araç sonuçları TEK kullanıcı mesajında döner. Ayrı mesajlara
        //    bölmek sağlayıcı tarafında eşleşme hatası üretir.
        messages.push({ role: 'user', content: results });
      }

      const messageId = await this.persistAssistantMessage({
        conversationId,
        answer,
        ledger,
        toolCalls,
        costMicroUsd: totalCostMicroUsd,
      });

      emit({
        type: 'done',
        data: {
          messageId,
          suggestedProductIds: ledger.suggestedProductIds(),
          promptVersion: ACTIVE_PROMPT_VERSION,
        },
      });
    } catch (error) {
      const appErr = toAppError(error, 'STYLIST_UNAVAILABLE');

      // Hata BİZDEN kaynaklanıyorsa kullanıcının hakkını yakmıyoruz.
      // ⚠️ Liste tek koda indirgenmemeli: zaman aşımı ve yanlış yapılandırma
      //    STYLIST_UNAVAILABLE'dan ayrıldı (bkz. anthropic.ts mapLlmError).
      //    Yalnızca eski kod kontrol edilseydi, sağlayıcı yavaşladığında
      //    kullanıcı hiç yanıt almadan günlük hakkını kaybederdi.
      const userNotAtFault: readonly string[] = [
        'STYLIST_UNAVAILABLE',
        'STYLIST_TIMEOUT',
        'AI_PROVIDER_MISCONFIGURED',
      ];
      if (userNotAtFault.includes(appErr.code)) await this.refundQuota(userId);

      this.logger.error({ ...appErr.toLogObject(), conversationId }, 'Stil danışmanı turu düştü');
      emit({
        type: 'error',
        data: { code: appErr.code, message: appErr.userMessage, retryable: appErr.retryable },
      });
    }
  }

  // ── Model turu ───────────────────────────────────────────────────────────

  private async runOneTurn(
    userId: string,
    messages: readonly LlmMessage[],
    emit: StylistEmit,
    signal?: AbortSignal,
  ): Promise<{ result: LlmTurnResult; text: string; toolUses: LlmToolUseBlock[] }> {
    const started = Date.now();
    const toolUses: LlmToolUseBlock[] = [];
    let text = '';
    let result: LlmTurnResult | undefined;

    try {
      const stream = this.llm.streamTurn({
        system: loadSystemPrompt(),
        messages: [...messages],
        tools: [...STYLIST_TOOLS],
        maxTokens: MAX_OUTPUT_TOKENS,
        signal,
      });

      for await (const event of stream) {
        if (event.type === 'text_delta') {
          text += event.text;
          emit({ type: 'delta', data: { text: event.text } });
        } else if (event.type === 'tool_use') {
          toolUses.push(event.block);
        } else {
          result = event.result;
        }
      }
    } catch (error) {
      const appErr = toAppError(error, 'STYLIST_UNAVAILABLE');
      // ⚠️ Başarısız çağrı da para harcamış olabilir; log yine yazılır.
      //    Yazılmazsa fatura ile panel arasındaki fark açıklanamaz.
      await this.recordUsage(userId, {
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0n,
        latencyMs: Date.now() - started,
        success: false,
        errorCode: appErr.code,
      });
      throw appErr;
    }

    if (!result) {
      throw appError('STYLIST_UNAVAILABLE', {
        internalMessage: 'Sağlayıcı akışı sonuç bloğu üretmeden kapandı',
      });
    }

    await this.recordUsage(userId, {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costMicroUsd: result.costMicroUsd,
      latencyMs: result.latencyMs,
      success: true,
    });

    return { result, text, toolUses };
  }

  private async recordUsage(
    userId: string,
    entry: {
      inputTokens: number;
      outputTokens: number;
      costMicroUsd: bigint;
      latencyMs: number;
      success: boolean;
      errorCode?: string;
    },
  ): Promise<void> {
    try {
      await this.usage.record({
        userId,
        provider: this.llm.name,
        model: this.llm.model,
        ...entry,
      });
    } catch (error) {
      // Maliyet defteri yazılamıyorsa bu bir alarm konusudur ama kullanıcının
      // sohbetini düşürme sebebi değildir.
      this.logger.error({ err: error }, 'AiUsageLog yazılamadı');
    }
  }

  // ── Kota ─────────────────────────────────────────────────────────────────

  /**
   * Günlük mesaj kotası.
   *
   * ⚠️ YARIŞ DURUMU: "önce say, sonra yaz" yaklaşımı aynı anda gelen beş
   *    istekte beşine de izin verir (hepsi 29 okur). Redis INCR atomiktir;
   *    sayaç önce artırılır, sonra bakılır. Fazla artırılan değer, hata
   *    yolunda DECR ile geri alınır.
   *
   * ⚠️ Sayaç Redis'te tutulur, veritabanında değil: bu bir MALİYET FRENİ,
   *    muhasebe kaydı değil. Redis silinirse kota sıfırlanır — kabul edilebilir;
   *    gerçek harcama AiUsageLog'da durur ve bütçe guardrail'i onu okur.
   */
  private async consumeQuota(userId: string): Promise<void> {
    const limit = env().AI_STYLIST_DAILY_PER_USER;
    const key = this.quotaKey(userId);

    let used: number;
    try {
      used = await this.redis.incr(key);
      if (used === 1) {
        // İlk artıştan sonra TTL: anahtar sonsuza kadar kalmasın.
        await this.redis.expire(key, this.secondsUntilMidnight());
      }
    } catch (error) {
      // Redis yoksa kota kontrolü yapılamaz. Açık bırakmak sınırsız harcama
      // demek; kapatmak yalnızca danışmanı devre dışı bırakır. Ticaret akışı
      // etkilenmediği için kapatmayı seçiyoruz.
      this.logger.error({ err: error }, 'Kota sayacı okunamadı, stil danışmanı kapatıldı');
      throw appError('STYLIST_UNAVAILABLE', { internalMessage: 'Kota sayacı kullanılamıyor' });
    }

    if (used > limit) {
      throw appError('STYLIST_RATE_LIMITED', {
        retryAfterSeconds: this.secondsUntilMidnight(),
        internalMessage: `Günlük stil danışmanı kotası aşıldı (${used}/${limit})`,
      });
    }
  }

  private async refundQuota(userId: string): Promise<void> {
    try {
      await this.redis.decr(this.quotaKey(userId));
    } catch {
      // İade edilemezse kullanıcı bir hak kaybeder; sohbeti düşürmeye değmez.
    }
  }

  private quotaKey(userId: string): string {
    const today = new Date().toISOString().slice(0, 10);
    return `stylist:quota:${userId}:${today}`;
  }

  private secondsUntilMidnight(): number {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return Math.max(60, Math.ceil((midnight.getTime() - now.getTime()) / 1000));
  }

  // ── Kalıcılık ────────────────────────────────────────────────────────────

  private async loadOwnedConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ id: string; title: string | null; createdAt: Date; updatedAt: Date }> {
    const conversation = await this.prisma.stylistConversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true, title: true, createdAt: true, updatedAt: true },
    });

    // ⚠️ GÜVENLİK: sahiplik doğrulanmadan konuşma açılırsa, kimliği bilen
    //    herkes başkasının danışman geçmişini (beden, bütçe, tarz) okur.
    //    Yok ve başkasının olan aynı hatayı döner — varlık sızdırılmaz.
    if (!conversation || conversation.userId !== userId) {
      throw appError('NOT_FOUND', {
        internalMessage: `Konuşma ${conversationId} kullanıcı ${userId} için erişilebilir değil`,
      });
    }

    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private async persistUserMessage(conversationId: string, content: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.stylistMessage.create({
        data: { conversationId, role: 'user', content, suggestedProductIds: [] },
      });

      const conversation = await tx.stylistConversation.findUnique({
        where: { id: conversationId },
        select: { title: true },
      });

      await tx.stylistConversation.update({
        where: { id: conversationId },
        data: {
          updatedAt: new Date(),
          // Başlık boşsa ilk mesajdan türetilir: liste ekranında "Adsız
          // konuşma" yerine kullanıcının kendi cümlesi görünsün. Bir kez
          // yazılır; sonraki mesajlar başlığı değiştirmez.
          ...(conversation?.title === null ? { title: content.slice(0, 80) } : {}),
        },
      });
    });
  }

  private async loadHistory(
    conversationId: string,
  ): Promise<{ messages: LlmMessage[]; ledgerSnapshots: unknown[] }> {
    const rows = await this.prisma.stylistMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { role: true, content: true, toolCalls: true },
    });
    rows.reverse();

    /*
     * ⚠️ Geçmiş araç çağrıları modele TEKRAR VERİLMEZ, yalnızca metin verilir.
     *    tool_use blokları eşleşen tool_result blokları olmadan gönderilemez;
     *    kısmi geçmişte eşleşmeyi garanti etmek kırılgan ve pahalıdır.
     *    Bunun bedeli, modelin gerekirse tekrar arama yapmasıdır — kabul
     *    edilebilir. Ürün DEFTERİ ise ayrıca taşınır (aşağıdaki snapshot),
     *    böylece önceki turda bulunan ürün "uydurma" sayılmaz.
     */
    const messages: LlmMessage[] = rows
      .filter((row) => row.content.trim().length > 0)
      .map((row) => ({
        role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: [{ type: 'text' as const, text: row.content }],
      }));

    const ledgerSnapshots = rows
      .map((row) => (isRecord(row.toolCalls) ? row.toolCalls.ledger : null))
      .filter((snapshot) => snapshot !== null);

    return { messages, ledgerSnapshots };
  }

  private async persistAssistantMessage(input: {
    conversationId: string;
    answer: string;
    ledger: ProductLedger;
    toolCalls: Array<{ name: string; isError: boolean }>;
    costMicroUsd: bigint;
  }): Promise<string> {
    const suggestedProductIds = input.ledger.suggestedProductIds();

    // ⚠️ "UYDURMA ÜRÜN" DENETİMİ — SESSİZ GEÇİŞ YOK.
    // Araç katmanı kimlikleri zaten reddediyor; burada modelin DÜZ METİNDE
    // yazdığı kimlikler taranıyor. Bulunursa hem log hem outbox olayı üretilir.
    const unknownInText = findUnknownIdsInText(input.answer, input.ledger);
    const hallucinations = input.ledger.hallucinationCount + unknownInText.length;

    const messageId = await this.prisma.$transaction(async (tx) => {
      const message = await tx.stylistMessage.create({
        data: {
          conversationId: input.conversationId,
          role: 'assistant',
          content: input.answer,
          suggestedProductIds,
          costMicroUsd: input.costMicroUsd,
          toolCalls: {
            version: 1,
            promptVersion: ACTIVE_PROMPT_VERSION,
            calls: input.toolCalls,
            hallucinations,
            ledger: input.ledger.toSnapshot(),
          } as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      if (hallucinations > 0) {
        // ⚠️ Yan etki AYNI transaction'da outbox'a yazılır: mesaj kaydedilip
        //    denetim olayı kaybolursa, "uydurma ürün" olayı hiç yaşanmamış
        //    gibi görünür ve model regresyonu fark edilmez.
        await tx.outboxEvent.create({
          data: {
            aggregate: 'stylist',
            aggregateId: input.conversationId,
            type: 'stylist.hallucination_detected',
            payload: {
              messageId: message.id,
              promptVersion: ACTIVE_PROMPT_VERSION,
              model: this.llm.model,
              toolLevel: input.ledger.hallucinationCount,
              textLevel: unknownInText.length,
              unknownIdsInText: unknownInText,
            },
          },
        });
      }

      await tx.stylistConversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      });

      return message.id;
    });

    if (hallucinations > 0) {
      this.logger.warn(
        {
          conversationId: input.conversationId,
          messageId,
          model: this.llm.model,
          promptVersion: ACTIVE_PROMPT_VERSION,
          toolLevel: input.ledger.hallucinationCount,
          textLevel: unknownInText.length,
        },
        'Stil danışmanı katalogda olmayan ürün kimliği üretti',
      );
    }

    return messageId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// NOT: "model katalogda olmayan ürün üretti" için bilinçli olarak hata kodu
// YOK. Bu durum araç sonucu olarak modele geri döner ve denetim outbox olayına
// yazılır; kullanıcıya yansıyan bir hata değildir. Kullanıcıya gösterilmesi
// ürün kararı olduğu için kod da o karar verilince eklenmeli — şimdi eklenirse
// hiçbir yerden fırlatılmayan ölü bir katalog kaydı olur.
