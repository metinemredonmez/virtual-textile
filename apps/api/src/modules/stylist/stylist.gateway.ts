import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import type {
  AiUsageEntry,
  AiUsagePort,
  StylistUserProfile,
  TryOnHandoff,
  TryOnPort,
  UserProfilePort,
} from './stylist.ports.js';

/**
 * GEÇİCİ ADAPTÖRLER
 *
 * Bu dosyadaki sınıflar, servisi henüz yayımlanmamış modüllerin verisine
 * (kullanıcı profili, sipariş geçmişi, sanal deneme, AI maliyet defteri)
 * doğrudan Prisma ile ulaşır.
 *
 * ⚠️ Bu bilinçli bir GEÇİCİ İSTİSNADIR ve modül sınırı kuralının sınırıdır.
 *    İlgili modüller servislerini yayımladığında `index.ts` içindeki provider
 *    satırları değişir, bu dosya silinir; servis ve araç kodu hiç dokunulmaz.
 *    Sınır ihlali tek dosyada toplandığı için de gözden kaçmaz.
 */

/** En fazla kaç favori/sipariş kaydı modele verilir — bağlam ve maliyet sınırı. */
const PROFILE_SAMPLE_LIMIT = 5;

@Injectable()
export class PrismaUserProfileAdapter implements UserProfilePort {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<StylistUserProfile | null> {
    const [body, favorites, purchases] = await Promise.all([
      this.prisma.bodyProfile.findUnique({
        where: { userId },
        // ⚠️ KVKK: boy/kilo/göğüs/bel/kalça KASITLI OLARAK SEÇİLMİYOR.
        // Seçilmeyen alan, yanlışlıkla sağlayıcıya gönderilemez.
        select: { usualSize: true, fitPref: true },
      }),
      this.prisma.favorite.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: PROFILE_SAMPLE_LIMIT,
        select: {
          product: {
            select: {
              title: true,
              brandName: true,
              variants: { where: { isActive: true }, select: { color: true }, take: 6 },
            },
          },
        },
      }),
      this.prisma.orderItem.findMany({
        // Yalnızca ödenmiş siparişler: sepette kalmış ya da iptal olmuş bir
        // kalem kullanıcının beden tercihine kanıt değildir.
        where: { order: { userId, paidAt: { not: null } } },
        orderBy: { createdAt: 'desc' },
        take: PROFILE_SAMPLE_LIMIT,
        select: { productTitle: true, variantLabel: true },
      }),
    ]);

    const hasSignal = body !== null || favorites.length > 0 || purchases.length > 0;
    if (!hasSignal) return null;

    return {
      usualSize: body?.usualSize ?? null,
      fitPref: body?.fitPref ?? null,
      favorites: favorites.map((favorite) => ({
        title: favorite.product.title,
        brandName: favorite.product.brandName,
        colors: [...new Set(favorite.product.variants.map((variant) => variant.color))],
      })),
      recentPurchases: purchases.map((item) => {
        // variantLabel biçimi: "Siyah / M"
        const [color = '', size = ''] = item.variantLabel.split('/').map((part) => part.trim());
        return { title: item.productTitle, size, color };
      }),
    };
  }
}

/**
 * ⚠️ ENTEGRASYON NOTU: `modules/ai` (AiModule → TryOnService) yayımlandı.
 *    Bu adaptör silinip TRYON_PORT sağlayıcısı TryOnService'e bağlanabilir;
 *    `TryOnPort` sözleşmesi değişmediği için servis ve araç kodu etkilenmez.
 *    Devretme davranışı (iş başlatmama) korunmalı — gerekçe aşağıda.
 */
@Injectable()
export class TryOnHandoffAdapter implements TryOnPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ⚠️ İŞ BAŞLATMAZ — yalnızca ürünün denemeye uygun olup olmadığına bakar.
   *
   * TryOnJob oluşturmak kullanıcı fotoğrafı ve iki ayrı KVKK rızası ister
   * (fotoğraf işleme + yurt dışına aktarım). Rıza, kullanıcının onu verdiği
   * ekranda alınır; sohbette "denemeyi aç" demek rıza yerine geçmez.
   */
  async prepare(input: { variantId: string; userId: string }): Promise<TryOnHandoff> {
    const variant = await this.prisma.variant.findUnique({
      where: { id: input.variantId },
      select: {
        isActive: true,
        product: {
          select: {
            title: true,
            status: true,
            category: { select: { tryOnCategory: true } },
          },
        },
      },
    });

    if (!variant || !variant.isActive || variant.product.status !== 'PUBLISHED') {
      return { available: false, reason: 'Seçtiğiniz renk/beden şu an satışta değil.' };
    }

    if (variant.product.category.tryOnCategory === null) {
      return { available: false, reason: 'Bu ürün için sanal deneme desteklenmiyor.' };
    }

    return {
      available: true,
      action: {
        type: 'OPEN_TRYON',
        variantId: input.variantId,
        productTitle: variant.product.title,
      },
    };
  }
}

@Injectable()
export class PrismaAiUsageAdapter implements AiUsagePort {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AiUsageEntry): Promise<void> {
    await this.prisma.aiUsageLog.create({
      data: {
        userId: entry.userId,
        feature: 'STYLIST',
        provider: entry.provider,
        model: entry.model,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        costMicroUsd: entry.costMicroUsd,
        latencyMs: entry.latencyMs,
        success: entry.success,
        errorCode: entry.errorCode ?? null,
      },
    });
  }

  async spent(): Promise<{ todayMicroUsd: bigint; thisMonthMicroUsd: bigint }> {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [today, month] = await Promise.all([
      this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: dayStart } },
        _sum: { costMicroUsd: true },
      }),
      this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: { costMicroUsd: true },
      }),
    ]);

    return {
      todayMicroUsd: today._sum.costMicroUsd ?? 0n,
      thisMonthMicroUsd: month._sum.costMicroUsd ?? 0n,
    };
  }
}
