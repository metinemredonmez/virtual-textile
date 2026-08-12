import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { JwtPayload } from '@vt/contracts';
import { ROLES_KEY } from '../auth/auth.guard.js';
import { IDEMPOTENT_KEY } from '../../common/interceptors/idempotency.interceptor.js';
import { OrderLogisticsController } from './order-logistics.controller.js';
import { OrderModule } from './index.js';
import type { OrderService } from './order.service.js';

/**
 * ═══════════ `package.delivered` ZİNCİRİNİN ÜRETİCİ UCU — KABLO TESTİ ═══════════
 *
 * ⚠️⚠️ BU DOSYANIN VAR OLMA SEBEBİ: teslim olayını üreten kod yolu HİÇ YOKTU.
 *      `order.service.delivered.test.ts` "DELIVERED geçişi doğru olayı yazar"
 *      diyordu ve DOĞRUYDU — ama o geçişi tetikleyen kimse olmadığı için
 *      üretimde tek bir `package.delivered` satırı bile doğmuyordu. Test yeşil,
 *      özellik ölü: bu projede dördüncü kez.
 *
 *      Bu yüzden burada ölçülen şey mantık değil VARLIK ve BAĞLANTIDIR:
 *      controller modülün `controllers` dizisinde mi, hangi rolü istiyor, ve
 *      gerçekten `transitionPackage(..., 'DELIVERED', ...)` mı çağırıyor.
 */

const ADMIN: JwtPayload = { sub: 'admin-1', role: 'ADMIN' } as JwtPayload;

function makeController(): {
  controller: OrderLogisticsController;
  transitionPackage: ReturnType<typeof vi.fn>;
} {
  const transitionPackage = vi.fn().mockResolvedValue({
    orderStatus: 'DELIVERED',
    packageStatus: 'DELIVERED',
  });
  const orders = { transitionPackage } as unknown as OrderService;
  return { controller: new OrderLogisticsController(orders), transitionPackage };
}

describe('teslimat ucu', () => {
  /**
   * ⚠️ Hedef durum dizesi burada ölçülür: 'DELIVERED' dışında bir değer
   *    geçilseydi olay tipi `package.${target.toLowerCase()}` şablonundan
   *    başka bir adla doğar ve gardırop tüketicisi onu hiç tanımazdı.
   */
  it('⚠️ paketi DELIVERED durumuna taşır', async () => {
    const { controller, transitionPackage } = makeController();

    await controller.markDelivered(ADMIN, 'pkg-1');

    expect(transitionPackage).toHaveBeenCalledWith('pkg-1', 'DELIVERED', {
      type: 'ADMIN',
      id: 'admin-1',
    });
  });

  /**
   * ⚠️ Aktör kimliği OrderEvent geçmişine yazılır. Düşerse "bu paketi kim
   *    teslim işaretledi" sorusu ebediyen cevapsız kalır — append-only geçmişin
   *    tek varlık sebebi bu soruydu.
   */
  it('aktör olarak isteği yapan yöneticiyi yazar', async () => {
    const { controller, transitionPackage } = makeController();

    await controller.markDelivered({ ...ADMIN, sub: 'admin-42' }, 'pkg-9');

    expect(transitionPackage.mock.calls[0]?.[2]).toEqual({ type: 'ADMIN', id: 'admin-42' });
  });
});

describe('teslimat ucu — kablolama ve koruma', () => {
  const reflector = new Reflector();

  /**
   * ⚠️ EN KRİTİK İDDİA. Controller bu diziden düşerse uç 404 döner ve
   *    `package.delivered` üreten kod yolu yeniden kalmaz. Derleme bunu
   *    göremez: `controllers` bir dizi, eksik eleman tip hatası değildir.
   */
  it('⚠️ OrderModule controller listesinde kayıtlıdır', () => {
    const controllers = Reflect.getMetadata('controllers', OrderModule) as unknown[];

    expect(controllers).toContain(OrderLogisticsController);
  });

  /**
   * ⚠️ Rol kapısı: satıcıdan bilerek esirgenen yetki (hakediş penceresini
   *    açmak) müşteriye veya destek ekibine sızmamalı.
   */
  it('yalnızca ADMIN rolüne açıktır', () => {
    const roles = reflector.get<string[]>(
      ROLES_KEY,
      OrderLogisticsController.prototype.markDelivered,
    );

    expect(roles).toEqual(['ADMIN']);
  });

  /** İkinci POST geçersiz geçiş hatası değil, aynı yanıtı almalı. */
  it('Idempotency-Key ister', () => {
    const idempotent = reflector.get<boolean>(
      IDEMPOTENT_KEY,
      OrderLogisticsController.prototype.markDelivered,
    );

    expect(idempotent).toBe(true);
  });
});
