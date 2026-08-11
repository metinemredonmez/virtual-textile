import { Inject, Injectable } from '@nestjs/common';
import { appError } from '@vt/contracts';
import type { PackageStatus } from '@vt/db';
import { OrderService, type OrderActor } from '../order/index.js';
import { SellerService } from './seller.service.js';
import {
  SELLER_FULFILLMENT_READER,
  type SellerFulfillmentReaderPort,
  type SellerPackageDetail,
  type SellerPackageSummary,
  type SellerReturnSummary,
} from './seller.ports.js';
import type {
  DecideReturnInput,
  SellerOrderListQuery,
  SellerReturnListQuery,
  ShipPackageInput,
  UpdatePackageStatusInput,
} from './seller.schema.js';

/**
 * SATICI SİPARİŞ VE İADE İŞLEMLERİ.
 *
 * ⚠️ YAZMA İŞLEMLERİ `OrderService`'e DEVREDİLİR — paket ve iade tabloları
 *    sipariş modülünündür. Satıcı modülü bu tablolara kendi yazsaydı:
 *      • paket geçiş makinesi (AWAITING_APPROVAL → PREPARING → SHIPPED)
 *        atlanır, satıcı kargolanmış paketi "hazırlanıyor"a geri alabilirdi,
 *      • `Order.status` türetimi tazelenmez, liste ve detay ekranı farklı
 *        şey söylerdi,
 *      • OrderEvent (append-only geçmiş) yazılmaz, "bu sipariş neden iptal
 *        oldu" sorusu yanıtsız kalırdı,
 *      • iade onayında defter ters kayıtları düşmez, satıcıya iade edilmiş
 *        ürünün parası ödenirdi.
 *
 * Okuma tarafında sipariş modülü satıcı kırılımlı bir yüzey yayımlamadığı
 * için dar bir okuma portu kullanılıyor.
 *
 * ⚠️ Sipariş modülü `OrderActor.sellerId`'yi kendi içinde de doğrular
 *    (`assertSellerScope`). Kapsam iki kez kontrol edilir ve bu bilinçlidir:
 *    guard atlanırsa servis, servis atlanırsa guard tutar.
 */
@Injectable()
export class SellerFulfillmentService {
  constructor(
    private readonly sellers: SellerService,
    private readonly orders: OrderService,
    @Inject(SELLER_FULFILLMENT_READER) private readonly reader: SellerFulfillmentReaderPort,
  ) {}

  private actor(sellerId: string, userId: string): OrderActor {
    return { type: 'SELLER', id: userId, sellerId };
  }

  // ── Sipariş / paket ──────────────────────────────────────────────────────

  async listPackages(
    sellerId: string,
    query: SellerOrderListQuery,
  ): Promise<{ items: SellerPackageSummary[]; nextCursor: string | null }> {
    return this.reader.listPackages(sellerId, {
      status: query.status,
      slaBreached: query.slaBreached,
      orderNumber: query.orderNumber,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  async getPackage(sellerId: string, packageId: string): Promise<SellerPackageDetail> {
    return this.reader.getPackage(sellerId, packageId);
  }

  /**
   * Paket durumu değişikliği.
   *
   * Hedef durumlar şema düzeyinde PREPARING / SHIPPED / CANCELLED ile sınırlı:
   * DELIVERED kargo entegrasyonundan, RETURNED iade akışından gelir. Satıcıya
   * DELIVERED verilseydi satıcı paketi teslim işaretleyip hakediş penceresini
   * (teslim + 14 gün) erken açabilirdi.
   */
  async updatePackageStatus(
    sellerId: string,
    packageId: string,
    input: UpdatePackageStatusInput,
    userId: string,
  ): Promise<{ orderStatus: string; packageStatus: PackageStatus }> {
    await this.sellers.requireActive(sellerId);

    return this.orders.transitionPackage(packageId, input.status, this.actor(sellerId, userId), {
      ...(input.carrier !== undefined ? { carrier: input.carrier } : {}),
      ...(input.trackingNo !== undefined ? { trackingNo: input.trackingNo } : {}),
      ...(input.cancelReason !== undefined ? { cancelReason: input.cancelReason } : {}),
    });
  }

  /**
   * KARGO TAKİP NUMARASI GİRİŞİ.
   *
   * Ayrı bir uç çünkü satıcı panelinde ayrı bir eylemdir ve iki alan da
   * ZORUNLUDUR. Durum güncelleme ucuna bırakılsaydı takip numarası olmadan
   * SHIPPED'a geçilebilir, müşteri kargosunu izleyemezdi.
   */
  async shipPackage(
    sellerId: string,
    packageId: string,
    input: ShipPackageInput,
    userId: string,
  ): Promise<{ orderStatus: string; packageStatus: PackageStatus }> {
    await this.sellers.requireActive(sellerId);

    return this.orders.transitionPackage(packageId, 'SHIPPED', this.actor(sellerId, userId), {
      carrier: input.carrier,
      trackingNo: input.trackingNo,
    });
  }

  // ── İade ─────────────────────────────────────────────────────────────────

  async listReturns(
    sellerId: string,
    query: SellerReturnListQuery,
  ): Promise<{ items: SellerReturnSummary[]; nextCursor: string | null }> {
    return this.reader.listReturns(sellerId, {
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  async getReturn(sellerId: string, returnId: string): Promise<SellerReturnSummary> {
    return this.reader.getReturn(sellerId, returnId);
  }

  /**
   * İADE KARARI — para burada hareket eder.
   *
   * Onayda defter ters kayıtları (REFUND −, COMMISSION_REVERSAL +,
   * SHIPPING_REVERSAL +) `OrderService.approveReturn` içinde, iade kaydıyla
   * AYNI transaction'da yazılır. Bu yüzden karar burada verilip para ayrı bir
   * çağrıyla taşınmaz: ikisi ayrılsaydı iade onaylanıp defter yazılmayabilirdi.
   *
   * ⚠️ İade talebi satıcıya ait olmayan bir siparişe aitse `OrderService`
   *    `AUTH_FORBIDDEN` fırlatır; kapsam orada da doğrulanır.
   */
  async decideReturn(
    sellerId: string,
    returnId: string,
    input: DecideReturnInput,
    userId: string,
  ): Promise<unknown> {
    await this.sellers.requireActive(sellerId);
    const actor = this.actor(sellerId, userId);

    if (input.action === 'APPROVE') {
      return this.orders.approveReturn(returnId, actor);
    }

    // Şema `REJECT` için gerekçeyi zorunlu kılıyor; yine de savunmacı kontrol:
    // şema ileride gevşetilirse gerekçesiz ret sessizce geçmesin.
    if (!input.rejectReason) {
      throw appError('VALIDATION_FAILED', {
        internalMessage: 'İade reddinde gerekçe zorunlu',
        details: { fields: [{ path: 'rejectReason', message: 'Ret gerekçesi zorunludur.' }] },
      });
    }

    return this.orders.rejectReturn(returnId, actor, input.rejectReason);
  }
}
