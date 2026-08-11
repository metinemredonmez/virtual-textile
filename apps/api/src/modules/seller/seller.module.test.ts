import { Global, Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { ROLES_KEY, SellerScopeGuard } from '../auth/auth.guard.js';
import { OrderService } from '../order/index.js';
import { SellerApplicationController } from './seller.controller.js';
import {
  SellerAnalyticsService,
  SellerController,
  SellerCouponService,
  SellerFinanceService,
  SellerFulfillmentService,
  SellerModule,
  SellerProductService,
  SellerService,
  SELLER_ANALYTICS_READER,
  SELLER_CATALOG,
  SELLER_COUPON,
  SELLER_FULFILLMENT_READER,
} from './index.js';

/**
 * BAĞIMLILIK ENJEKSİYONU DUMAN TESTİ.
 *
 * Yanlış bağlanmış bir provider yalnızca uygulama AÇILIRKEN patlar; birim
 * testleri servisleri elle kurduğu için bunu göremez. Bu test modülü gerçek
 * `SellerModule` tanımıyla ayağa kaldırır: token adı, `inject` dizisinin
 * sırası veya eksik bir bağımlılık burada yakalanır.
 *
 * Veritabanı ve logger sahte; hiçbir sorgu çalışmıyor — ölçülen tek şey
 * KABLOLAMA.
 */
const fakePrisma = {} as PrismaService;
const fakeLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

/** Gerçekte InfraModule @Global; testte aynı rolü bu sahte üstleniyor. */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: fakePrisma },
    { provide: APP_LOGGER, useValue: fakeLogger },
  ],
  exports: [PrismaService, APP_LOGGER],
})
class FakeInfraModule {}

describe('SellerModule kablolaması', () => {
  it('modül hatasız derlenir ve tüm servisler çözülür', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeInfraModule, SellerModule],
    }).compile();

    expect(moduleRef.get(SellerService)).toBeInstanceOf(SellerService);
    expect(moduleRef.get(SellerProductService)).toBeInstanceOf(SellerProductService);
    expect(moduleRef.get(SellerFulfillmentService)).toBeInstanceOf(SellerFulfillmentService);
    expect(moduleRef.get(SellerFinanceService)).toBeInstanceOf(SellerFinanceService);
    expect(moduleRef.get(SellerAnalyticsService)).toBeInstanceOf(SellerAnalyticsService);
    expect(moduleRef.get(SellerCouponService)).toBeInstanceOf(SellerCouponService);
    expect(moduleRef.get(SellerController)).toBeInstanceOf(SellerController);

    await moduleRef.close();
  });

  it('köprü tokenları bağlıdır', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeInfraModule, SellerModule],
    }).compile();

    for (const token of [
      SELLER_CATALOG,
      SELLER_FULFILLMENT_READER,
      SELLER_ANALYTICS_READER,
      SELLER_COUPON,
    ]) {
      expect(moduleRef.get(token)).toBeDefined();
    }

    await moduleRef.close();
  });

  /**
   * Satıcı modülü sipariş YAZMA işlerini `OrderService`'e devrediyor
   * (kural 3). Bağlantı kopar veya OrderModule import'u düşerse paket
   * geçişleri ve iade kararları çalışmaz.
   */
  it('OrderService devralınabilir durumda', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeInfraModule, SellerModule],
    }).compile();

    expect(moduleRef.get(OrderService, { strict: false })).toBeInstanceOf(OrderService);

    await moduleRef.close();
  });
});

/**
 * ═══════════════════ KAPSAM KORUMASI ═══════════════════
 *
 * `@SellerPanel()` iki koruma birden uyguluyor. Metadata veya guard sessizce
 * düşerse hiçbir birim testi bunu görmez, ama bir satıcı BAŞKA MAĞAZANIN
 * cirosunu okuyabilir hâle gelir. Bu yüzden dekoratörün gerçekten iz
 * bıraktığı doğrudan ölçülüyor.
 */
describe('satıcı paneli koruması', () => {
  const reflector = new Reflector();

  it('SellerController sınıf düzeyinde SELLER_USER rolü ister', () => {
    const roles = reflector.get<string[]>(ROLES_KEY, SellerController);
    expect(roles).toEqual(['SELLER_USER']);
  });

  it('SellerController sınıf düzeyinde SellerScopeGuard taşır', () => {
    const guards = Reflect.getMetadata('__guards__', SellerController) as unknown[] | undefined;
    expect(guards).toBeDefined();
    expect(guards).toContain(SellerScopeGuard);
  });

  /**
   * ⚠️ Başvuru ucu BİLEREK kapsam guard'ı taşımaz: başvuran kullanıcının
   *    henüz mağazası yoktur, `sellerIds` boştur ve guard her başvuruyu
   *    reddederdi. Kapsam bunun yerine oturumdaki kullanıcıdan türetilir.
   *    Bu test o istisnanın kasıtlı olduğunu kayda geçirir.
   */
  it('başvuru ucu kapsam guard’ı taşımaz', () => {
    const guards = Reflect.getMetadata('__guards__', SellerApplicationController) as
      unknown[] | undefined;
    expect(guards ?? []).not.toContain(SellerScopeGuard);
    expect(reflector.get<string[]>(ROLES_KEY, SellerApplicationController)).toBeUndefined();
  });
});
