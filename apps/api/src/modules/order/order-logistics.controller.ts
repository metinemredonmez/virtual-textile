import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { JwtPayload } from '@vt/contracts';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor.js';
import { CurrentUser, Roles } from '../auth/auth.guard.js';
import { OrderService } from './order.service.js';

/**
 * ═══════════════════ TESLİMAT UCU — `package.delivered` MUSLUĞU ═══════════════
 *
 * ⚠️⚠️ BU DOSYANIN VAR OLMA SEBEBİ: `package.delivered` OLAYINI ÜRETEN HİÇBİR
 *      KOD YOLU YOKTU.
 *
 *      Kablo baştan sona kusursuzdu — outbox dağıtıcısı, domain olay kuyruğu,
 *      fanout, gardırop işleyicisi, hepsi yazıldı, derlendi, test edildi. Ama
 *      paketi DELIVERED'a taşıyan tek giriş noktası (`transitionPackage`) yalnızca
 *      satıcı ucundan çağrılıyordu ve o ucun şeması DELIVERED'ı KABUL ETMİYOR
 *      (`updatePackageStatusSchema`: PREPARING | SHIPPED | CANCELLED). Yani
 *      üretimde `package.delivered` satırı HİÇ YAZILMIYORDU.
 *
 *      Bu, projeyi üç kez yakan hata sınıfının (SIZE_LEARNING_PORT, BullMQ
 *      jobId, `applyDelivered`) bir halka YUKARI kaymış hâliydi: tüketici artık
 *      canlıydı ama üretici yoktu. Tüketiciyi bağlamak yetmez, MUSLUĞU AÇMAK
 *      gerekir.
 *
 * ⚠️ TEK MUSLUK, DÖRT ÖZELLİK. Bu geçiş yalnızca gardırobu beslemez:
 *      • `deliveredAt` → iade penceresi (ORDER.returnWindowDays) buradan işler,
 *      • `deliveredAt` → satıcı hakediş penceresi (payoutAvailableAt),
 *      • sipariş durumu DELIVERED → COMPLETED türetimi,
 *      • beden öğrenme sinyali (fit-learning.gateway.ts, `deliveredAt` sorgusu).
 *    Dördü de bu uç yazılana kadar üretimde ölüydü.
 *
 * ⚠️ NEDEN SATICI UCUNDA DEĞİL: satıcı kendi paketini teslim işaretleyebilseydi
 *    hakediş penceresini (teslim + 14 gün) istediği an açardı — parayı alacak
 *    olan taraf, paranın vadesini başlatan olayı yazamaz. Bu yasak
 *    `seller-fulfillment.service.ts` içinde zaten yazılıydı; buradaki uç onu
 *    delmiyor, boşluğu satıcı DIŞINDA bir aktörle kapatıyor.
 *
 * ⚠️ NEDEN SUPPORT DEĞİL, YALNIZCA ADMIN: modülün kuralı "SUPPORT inceler,
 *    ADMIN karar verir" (bkz. admin.controller.ts). Teslim kaydı bir olgu gibi
 *    görünse de para vadesi başlatır; satıcıdan esirgenen yetki destek ekibine
 *    varsayılan olarak verilmemelidir.
 *
 * ⚠️ GEÇMİŞE TARİH ATILAMAZ. Gövde yok, `deliveredAt` = şimdi
 *    (`transitionPackage`). Operatörün tarih yazabilmesi, iade penceresini
 *    geçmişe çekip müşterinin iade hakkını kısaltmak demekti. Kargo firması
 *    gerçek teslim saatini bildirdiğinde doğru çözüm bu ucu esnetmek değil,
 *    webhook'un o saati taşıması olacak.
 *
 * ⚠️ KARGO WEBHOOK'U BURAYA TAKILIR. Entegrasyon geldiğinde yeni bir yazma yolu
 *    AÇILMAZ: `@Public()` bir webhook ucu imzayı doğrular ve aynı
 *    `transitionPackage(..., 'DELIVERED', { type: 'SYSTEM' })` çağrısını yapar.
 *    Geçiş makinesi, OrderEvent geçmişi ve outbox yazımı tek yerde kalır.
 *
 * ⚠️ `@Idempotent()`: ikinci POST `ORDER_INVALID_TRANSITION` alırdı
 *    (DELIVERED → DELIVERED geçersiz) ve operatöre "teslim işaretlenemedi" gibi
 *    görünürdü. Ağ zaman aşımında istemcinin tekrar denemesi normaldir.
 */
@Controller('logistics')
export class OrderLogisticsController {
  constructor(private readonly orders: OrderService) {}

  /**
   * Paketi teslim edildi olarak işaretler — SHIPPED → DELIVERED.
   *
   * 200 döner, 201 değil: yeni kaynak yaratılmıyor, var olanın durumu değişiyor.
   */
  @Post('packages/:id/delivered')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @Roles('ADMIN')
  async markDelivered(
    @CurrentUser() user: JwtPayload,
    @Param('id') packageId: string,
  ): Promise<unknown> {
    // ⚠️ Aktör ADMIN olarak yazılır, SYSTEM olarak değil: OrderEvent geçmişinde
    //    "kim teslim işaretledi" sorusunun cevabı kalmalı. SYSTEM yalnızca
    //    gerçekten otomatik bir kaynağa (kargo webhook'u) aittir.
    return this.orders.transitionPackage(packageId, 'DELIVERED', {
      type: 'ADMIN',
      id: user.sub,
    });
  }
}
