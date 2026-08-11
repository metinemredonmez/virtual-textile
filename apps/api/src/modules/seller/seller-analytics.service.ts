import { Inject, Injectable } from '@nestjs/common';
import {
  analyzeProductFunnels,
  analyzeSizeReturns,
  buildFunnel,
  ratePct,
  type ProductFunnelInsight,
  type SizeReturnInsight,
  type FunnelStage,
} from './seller-analytics.js';
import { SELLER_ANALYTICS_READER, type SellerAnalyticsReaderPort } from './seller.ports.js';
import type { AnalyticsQuery } from './seller.schema.js';

/** Ürün bazlı huni tablosunda gösterilecek satır sayısı. */
const PRODUCT_FUNNEL_LIMIT = 25;

export interface SellerFunnelReport {
  range: { from: Date; to: Date };
  stages: FunnelStage[];
  totals: {
    revenueMinor: bigint;
    orderCount: number;
    purchasedCount: number;
    /** Ortalama sepet tutarı (kuruş). */
    averageOrderValueMinor: bigint;
    /** Sanal denemeden satışa dönüşüm (%). */
    tryOnToPurchasePct: number | null;
  };
  products: ProductFunnelInsight[];
  sizes: SizeReturnInsight[];
}

/**
 * SATICI ANALİTİĞİ — try-on → sepet → satış hunisi.
 *
 * Sayımlar birden çok modülün tablosundan gelir (AI deneme kayıtları, sepet,
 * sipariş, iade); bu yüzden okuma dar bir port arkasındadır. Oran ve dönüşüm
 * hesabı `seller-analytics.ts` içindeki saf fonksiyonlarda yapılır — sıfıra
 * bölme ve yuvarlama kararları tek yerde ve testlenebilir kalsın.
 */
@Injectable()
export class SellerAnalyticsService {
  constructor(
    @Inject(SELLER_ANALYTICS_READER) private readonly reader: SellerAnalyticsReaderPort,
  ) {}

  async funnel(sellerId: string, query: AnalyticsQuery): Promise<SellerFunnelReport> {
    const range = { from: query.from, to: query.to };

    const [totals, products, sizes] = await Promise.all([
      this.reader.funnelTotals(sellerId, range),
      this.reader.funnelByProduct(sellerId, range, PRODUCT_FUNNEL_LIMIT),
      this.reader.returnsBySize(sellerId, range),
    ]);

    const stages = buildFunnel({
      tryOnCount: totals.tryOnCount,
      cartAddCount: totals.cartAddCount,
      purchasedCount: totals.purchasedCount,
    });

    return {
      range,
      stages,
      totals: {
        revenueMinor: totals.revenueMinor,
        orderCount: totals.orderCount,
        purchasedCount: totals.purchasedCount,
        // ⚠️ bigint bölme: kalan ATILIR, float'a çevrilmez. Ortalama sepet
        //    tutarında 1 kuruşluk kırpma kabul edilebilir; float'a çevirip
        //    geri dönmek büyük tutarlarda hassasiyet kaybeder.
        averageOrderValueMinor:
          totals.orderCount > 0 ? totals.revenueMinor / BigInt(totals.orderCount) : 0n,
        tryOnToPurchasePct: ratePct(totals.purchasedCount, totals.tryOnCount),
      },
      products: analyzeProductFunnels(products),
      sizes: analyzeSizeReturns(sizes),
    };
  }
}
