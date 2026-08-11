import { Inject, Injectable } from '@nestjs/common';
import { Money, appError } from '@vt/contracts';
import { ORDER } from '@vt/config';
import { serializeBigInts } from '@vt/db';
import type { ActorType, OrderStatus, PackageStatus, Prisma, ReturnStatus } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import {
  assertOrderCancellable,
  assertPackageTransition,
  deriveOrderStatus,
  derivePaymentPhase,
  isTerminalOrderStatus,
  type PackageSnapshot,
} from './order-status.js';
import { lockOrder, nextOrderNumber, nextReturnNumber } from './order-number.js';
import { computeReturnReversal, type ReturnLine } from './return-ledger.js';
import { SELLER_LEDGER, type SellerLedgerPort } from './ledger.port.js';
import type { CancelOrderInput, CreateReturnInput, OrderListQuery } from './order.schema.js';

type Tx = Prisma.TransactionClient;

export interface OrderActor {
  readonly type: ActorType;
  readonly id?: string | null;
  /** SELLER ise yalnızca bu mağazanın paketlerine dokunabilir. */
  readonly sellerId?: string | null;
}

/**
 * Açık iade: adet REZERVE eder. Kapanmış iade: adet gerçekten düşmüştür.
 * REJECTED/CANCELLED hiçbir adet tüketmez — müşteri tekrar talep edebilir.
 */
const OPEN_RETURN_STATUSES: readonly ReturnStatus[] = [
  'REQUESTED',
  'APPROVED',
  'IN_TRANSIT',
  'RECEIVED',
];
const SETTLED_RETURN_STATUSES: readonly ReturnStatus[] = ['REFUNDED'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SELLER_LEDGER) private readonly ledger: SellerLedgerPort,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── Okuma ────────────────────────────────────────────────────────────────

  /**
   * Müşterinin sipariş listesi.
   *
   * Cursor olarak Order.id kullanılıyor: kimlikler uuid v7, yani zaman
   * sıralı. Offset kullanılsaydı araya yeni sipariş girdiğinde kullanıcı
   * aynı siparişi iki kez görürdü.
   */
  async listForUser(
    userId: string,
    query: OrderListQuery,
  ): Promise<{ items: unknown[]; nextCursor: string | null }> {
    const rows = await this.prisma.order.findMany({
      where: { userId, ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        orderNumber: true,
        status: true,
        grandTotalMinor: true,
        currency: true,
        createdAt: true,
        paidAt: true,
        cancelledAt: true,
        reservationExpiresAt: true,
        packages: { select: { id: true, status: true, deliveredAt: true } },
        items: {
          take: 4,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            productTitle: true,
            variantLabel: true,
            imageKey: true,
            quantity: true,
          },
        },
        _count: { select: { items: true } },
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: page.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        // Kolon değil, TÜRETİM okunuyor: kolon yalnızca filtreleme önbelleğidir.
        status: this.statusOf(order),
        grandTotalMinor: order.grandTotalMinor,
        currency: order.currency,
        createdAt: order.createdAt,
        packageCount: order.packages.length,
        itemCount: order._count.items,
        previewItems: order.items,
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async getByOrderNumber(userId: string, orderNumber: string): Promise<unknown> {
    const order = await this.prisma.order.findFirst({
      // ⚠️ userId koşulu WHERE'de: "başkasının siparişi" ile "olmayan sipariş"
      // aynı cevabı verir. Ayrı 403 dönseydi numara denemesiyle sipariş
      // varlığı öğrenilebilirdi.
      where: { orderNumber, userId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        email: true,
        phone: true,
        itemsTotalMinor: true,
        shippingTotalMinor: true,
        discountMinor: true,
        grandTotalMinor: true,
        currency: true,
        shippingAddress: true,
        billingAddress: true,
        createdAt: true,
        paidAt: true,
        completedAt: true,
        cancelledAt: true,
        reservationExpiresAt: true,
        packages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            sellerId: true,
            status: true,
            carrier: true,
            trackingNo: true,
            slaDeadline: true,
            shippedAt: true,
            deliveredAt: true,
            cancelledAt: true,
            cancelReason: true,
            shippingMinor: true,
            itemsTotalMinor: true,
            discountShareMinor: true,
            seller: { select: { id: true, displayName: true } },
            items: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                productId: true,
                productTitle: true,
                brandName: true,
                variantLabel: true,
                sku: true,
                imageKey: true,
                unitPriceMinor: true,
                quantity: true,
                lineTotalMinor: true,
              },
            },
          },
        },
        returns: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            returnNumber: true,
            status: true,
            reason: true,
            refundAmountMinor: true,
            createdAt: true,
            items: { select: { orderItemId: true, quantity: true, refundMinor: true } },
          },
        },
        events: {
          orderBy: { createdAt: 'asc' },
          select: { type: true, actorType: true, createdAt: true },
        },
      },
    });

    if (!order) throw appError('ORDER_NOT_FOUND');

    const now = new Date();
    return {
      ...order,
      status: this.statusOf(order, now),
      packages: order.packages.map((pkg) => ({
        ...pkg,
        /** Müşteri arayüzü "iptal et" düğmesini buna göre gösterir. */
        cancellable: pkg.status === 'AWAITING_APPROVAL' || pkg.status === 'PREPARING',
        returnableUntil:
          pkg.deliveredAt === null
            ? null
            : new Date(pkg.deliveredAt.getTime() + ORDER.returnWindowDays * MS_PER_DAY),
      })),
    };
  }

  // ── Sipariş numarası ─────────────────────────────────────────────────────

  /**
   * Checkout modülü sipariş yazarken bunu KENDİ transaction'ı içinde çağırır.
   * Numara üretimi ile sipariş yazımı aynı transaction'da olmazsa numara
   * tahsis edilip sipariş yazılmayabilir ve seride boşluk oluşur.
   */
  async allocateOrderNumber(tx: Tx, now: Date = new Date()): Promise<string> {
    return nextOrderNumber(tx, now);
  }

  // ── İptal ────────────────────────────────────────────────────────────────

  /**
   * Müşteri iptali.
   *
   * Kargolanmış paket varsa hiçbir şey iptal edilmez (ORDER_NOT_CANCELLABLE);
   * yarım iptal müşteriye "neyin iptal olduğu" belirsizliği yaratır ve iade
   * akışıyla çakışır.
   *
   * Ödeme alınmışsa para iadesi BURADA yapılmaz: OutboxEvent yazılır, ödeme
   * modülü tahsilatı geri alır. Aynı transaction'da dış servis çağrılsaydı
   * transaction sağlayıcının yanıtını beklerdi ve rollback edilse bile para
   * iadesi geri alınamazdı.
   */
  async cancel(
    userId: string,
    orderId: string,
    input: CancelOrderInput,
  ): Promise<{ orderNumber: string; status: OrderStatus; cancelledPackageIds: string[] }> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, orderId);

      const order = await tx.order.findFirst({
        where: { id: orderId, userId },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paidAt: true,
          grandTotalMinor: true,
          packages: { select: { id: true, status: true, sellerId: true } },
        },
      });
      if (!order) throw appError('ORDER_NOT_FOUND');

      if (isTerminalOrderStatus(order.status)) {
        throw appError('ORDER_INVALID_TRANSITION', {
          internalMessage: `Sipariş ${order.orderNumber} ${order.status} durumunda`,
        });
      }
      assertOrderCancellable(order.packages);

      // ⚠️ Yalnızca AÇIK paketler iptal edilir. Satıcının daha önce iptal ettiği
      // bir paket bu listeye girseydi, onun cancelReason'ı ve cancelledAt'i
      // müşteri iptaliyle ezilir ve "bu paket neden iptal oldu" cevabı kaybolurdu.
      const cancelledPackageIds = order.packages
        .filter((pkg) => pkg.status !== 'CANCELLED')
        .map((pkg) => pkg.id);
      const reason = input.reason ?? 'Müşteri talebiyle iptal edildi';

      if (cancelledPackageIds.length > 0) {
        await tx.orderPackage.updateMany({
          where: { id: { in: cancelledPackageIds } },
          data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason },
        });
      }
      await tx.order.update({ where: { id: orderId }, data: { cancelledAt: now } });

      const status = await this.syncOrderStatus(tx, orderId, now);

      await this.recordEvent(tx, {
        orderId,
        type: 'order.cancelled',
        actorType: 'CUSTOMER',
        actorId: userId,
        payload: {
          orderNumber: order.orderNumber,
          reason,
          packageIds: cancelledPackageIds,
          sellerIds: [
            ...new Set(
              order.packages
                .filter((pkg) => cancelledPackageIds.includes(pkg.id))
                .map((pkg) => pkg.sellerId),
            ),
          ],
          // Tüketiciler: stok serbest bırakma + (ödendiyse) para iadesi.
          //
          // ⚠️ grandTotal "iade edilecek tutar" DEĞİL, siparişin toplamıdır.
          // Daha önce iptal/iade edilmiş paket varsa bir kısmı zaten geri
          // ödenmiş olabilir; ödeme modülü tahsil edilen ile iade edileni
          // kendi kayıtlarından mutabık kılar. Burada net tutar hesaplansaydı
          // iki modül aynı parayı iki farklı yerden hesaplardı.
          refundRequired: order.paidAt !== null,
          orderGrandTotalMinor: order.grandTotalMinor,
        },
      });

      return { orderNumber: order.orderNumber, status, cancelledPackageIds };
    });
  }

  // ── İade talebi ──────────────────────────────────────────────────────────

  /**
   * İADE TALEBİ (kısmi destekli).
   *
   * Koşullar: kalem teslim edilmiş olacak, iade penceresi (ORDER.returnWindowDays)
   * kapanmamış olacak, aynı kalem için açık iade bulunmayacak.
   *
   * Burada yalnızca TALEP oluşur; defter kaydı onayda yazılır (approveReturn).
   * Talep anında yazılsaydı reddedilen her iade defterde iki kez düzeltme
   * gerektirirdi.
   */
  async createReturn(
    userId: string,
    orderId: string,
    input: CreateReturnInput,
  ): Promise<{
    id: string;
    returnNumber: string;
    status: ReturnStatus;
    refundAmountMinor: bigint;
  }> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Kilit ÖNCE: iki paralel iade talebi aynı kalemi iki kez rezerve etmesin.
      await lockOrder(tx, orderId);

      const order = await tx.order.findFirst({
        where: { id: orderId, userId },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          packages: {
            select: {
              id: true,
              sellerId: true,
              status: true,
              deliveredAt: true,
              discountShareMinor: true,
            },
          },
          items: {
            select: {
              id: true,
              packageId: true,
              quantity: true,
              lineTotalMinor: true,
              commissionAmountMinor: true,
              sellerNetMinor: true,
              productTitle: true,
              variantLabel: true,
            },
          },
          returns: {
            select: {
              status: true,
              items: { select: { orderItemId: true, quantity: true } },
            },
          },
        },
      });
      if (!order) throw appError('ORDER_NOT_FOUND');

      const packageById = new Map(order.packages.map((pkg) => [pkg.id, pkg]));
      const itemById = new Map(order.items.map((item) => [item.id, item]));
      const discountByItem = this.allocateDiscountShares(order.packages, order.items);

      const openItemIds = new Set<string>();
      const settledQuantity = new Map<string, number>();
      for (const request of order.returns) {
        for (const item of request.items) {
          if (OPEN_RETURN_STATUSES.includes(request.status)) openItemIds.add(item.orderItemId);
          if (SETTLED_RETURN_STATUSES.includes(request.status)) {
            settledQuantity.set(
              item.orderItemId,
              (settledQuantity.get(item.orderItemId) ?? 0) + item.quantity,
            );
          }
        }
      }

      const lines: ReturnLine[] = input.items.map((requested) => {
        const item = itemById.get(requested.orderItemId);
        if (!item) {
          throw appError('VALIDATION_FAILED', {
            internalMessage: `Kalem ${requested.orderItemId} bu siparişe ait değil`,
            details: {
              fields: [{ path: 'items', message: 'Seçilen ürün bu siparişte bulunamadı.' }],
            },
          });
        }

        const pkg = packageById.get(item.packageId);
        if (!pkg || pkg.deliveredAt === null) {
          throw appError('RETURN_NOT_ALLOWED', {
            internalMessage: `Kalem ${item.id} teslim edilmemiş paket ${item.packageId} içinde`,
          });
        }
        if (pkg.status !== 'DELIVERED' && pkg.status !== 'RETURN_REQUESTED') {
          throw appError('RETURN_NOT_ALLOWED', {
            internalMessage: `Paket ${pkg.id} durumu ${pkg.status}`,
          });
        }

        // İade penceresi teslim tarihinden işler, sipariş tarihinden değil.
        const deadline = pkg.deliveredAt.getTime() + ORDER.returnWindowDays * MS_PER_DAY;
        if (now.getTime() > deadline) {
          throw appError('REFUND_WINDOW_CLOSED', { params: { days: ORDER.returnWindowDays } });
        }

        if (openItemIds.has(item.id)) {
          throw appError('RETURN_ALREADY_EXISTS', {
            internalMessage: `Kalem ${item.id} için açık iade var`,
          });
        }

        return {
          orderItemId: item.id,
          sellerId: pkg.sellerId,
          quantity: item.quantity,
          lineTotalMinor: item.lineTotalMinor,
          commissionAmountMinor: item.commissionAmountMinor,
          sellerNetMinor: item.sellerNetMinor,
          discountShareMinor: discountByItem.get(item.id) ?? 0n,
          alreadyReturnedQuantity: settledQuantity.get(item.id) ?? 0,
          returnQuantity: requested.quantity,
          label: `${item.productTitle} (${item.variantLabel})`,
        };
      });

      // Adet ve tutar doğrulaması burada; RETURN_NOT_ALLOWED oradan gelir.
      const draft = computeReturnReversal(lines);
      const quantityByItem = new Map(input.items.map((item) => [item.orderItemId, item.quantity]));

      const returnNumber = await nextReturnNumber(tx, now);
      const created = await tx.returnRequest.create({
        data: {
          returnNumber,
          orderId,
          reason: input.reason,
          note: input.note ?? null,
          photoKeys: input.photoKeys,
          refundAmountMinor: draft.customerRefundMinor,
          items: {
            create: draft.perItem.map((result) => ({
              orderItemId: result.orderItemId,
              quantity: quantityByItem.get(result.orderItemId) ?? 0,
              refundMinor: result.customerRefundMinor,
            })),
          },
        },
        select: { id: true, returnNumber: true, status: true, refundAmountMinor: true },
      });

      // Paketleri iade talebine al — satıcı panelinde ayrı kuyruğa düşsün.
      const touchedPackageIds = [
        ...new Set(lines.map((line) => itemById.get(line.orderItemId)!.packageId)),
      ];
      for (const packageId of touchedPackageIds) {
        const pkg = packageById.get(packageId)!;
        if (pkg.status === 'RETURN_REQUESTED') continue;
        assertPackageTransition(pkg.status, 'RETURN_REQUESTED');
        await tx.orderPackage.update({
          where: { id: packageId },
          data: { status: 'RETURN_REQUESTED' },
        });
      }

      await this.syncOrderStatus(tx, orderId, now);

      await this.recordEvent(tx, {
        orderId,
        type: 'return.requested',
        actorType: 'CUSTOMER',
        actorId: userId,
        payload: {
          returnId: created.id,
          returnNumber: created.returnNumber,
          orderNumber: order.orderNumber,
          reason: input.reason,
          refundAmountMinor: created.refundAmountMinor,
          items: draft.perItem,
        },
      });

      return created;
    });
  }

  /**
   * İADE ONAYI — para burada hareket eder.
   *
   * Ters defter kayıtları (REFUND −, COMMISSION_REVERSAL +, SHIPPING_REVERSAL +)
   * onay anında yazılır: platform iadeyi kabul ettiği anda satıcının o kalemden
   * hakedişi düşer. Fiziksel teslim beklenseydi bu arada payout penceresi
   * açılabilir ve satıcıya iade edilecek para ödenmiş olurdu.
   *
   * Müşteriye para iadesi ödeme sağlayıcısı üzerinden yapılır → OutboxEvent.
   */
  async approveReturn(
    returnId: string,
    actor: OrderActor,
  ): Promise<{ returnNumber: string; refundAmountMinor: bigint; sellerNetImpactMinor: bigint }> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const head = await tx.returnRequest.findUnique({
        where: { id: returnId },
        select: { orderId: true },
      });
      if (!head) throw appError('NOT_FOUND', { internalMessage: `İade ${returnId} yok` });

      await lockOrder(tx, head.orderId);

      // Kilit beklerken başka bir istek onaylamış olabilir — TEKRAR oku.
      const request = await tx.returnRequest.findUniqueOrThrow({
        where: { id: returnId },
        select: {
          id: true,
          orderId: true,
          returnNumber: true,
          status: true,
          items: { select: { orderItemId: true, quantity: true } },
          order: {
            select: {
              orderNumber: true,
              packages: {
                select: {
                  id: true,
                  sellerId: true,
                  status: true,
                  discountShareMinor: true,
                },
              },
              items: {
                select: {
                  id: true,
                  packageId: true,
                  quantity: true,
                  lineTotalMinor: true,
                  commissionAmountMinor: true,
                  sellerNetMinor: true,
                  productTitle: true,
                  variantLabel: true,
                },
              },
              returns: {
                where: { id: { not: returnId } },
                select: { status: true, items: { select: { orderItemId: true, quantity: true } } },
              },
            },
          },
        },
      });

      if (request.status !== 'REQUESTED') {
        throw appError('ORDER_INVALID_TRANSITION', {
          internalMessage: `İade ${request.returnNumber} ${request.status} durumunda`,
        });
      }

      const packageById = new Map(request.order.packages.map((pkg) => [pkg.id, pkg]));
      const itemById = new Map(request.order.items.map((item) => [item.id, item]));
      const discountByItem = this.allocateDiscountShares(
        request.order.packages,
        request.order.items,
      );

      const settledQuantity = new Map<string, number>();
      for (const other of request.order.returns) {
        if (!SETTLED_RETURN_STATUSES.includes(other.status)) continue;
        for (const item of other.items) {
          settledQuantity.set(
            item.orderItemId,
            (settledQuantity.get(item.orderItemId) ?? 0) + item.quantity,
          );
        }
      }

      const lines: ReturnLine[] = request.items.map((returnItem) => {
        const item = itemById.get(returnItem.orderItemId);
        if (!item) {
          throw appError('RETURN_NOT_ALLOWED', {
            internalMessage: `İade kalemi ${returnItem.orderItemId} siparişte yok`,
          });
        }
        const pkg = packageById.get(item.packageId)!;
        this.assertSellerScope(actor, pkg.sellerId);
        return {
          orderItemId: item.id,
          sellerId: pkg.sellerId,
          quantity: item.quantity,
          lineTotalMinor: item.lineTotalMinor,
          commissionAmountMinor: item.commissionAmountMinor,
          sellerNetMinor: item.sellerNetMinor,
          discountShareMinor: discountByItem.get(item.id) ?? 0n,
          alreadyReturnedQuantity: settledQuantity.get(item.id) ?? 0,
          returnQuantity: returnItem.quantity,
          label: `${item.productTitle} (${item.variantLabel})`,
        };
      });

      const draft = computeReturnReversal(lines);

      // Defter ve iade kaydı AYNI transaction'da — biri yazılıp diğeri
      // yazılmazsa satıcı bakiyesi ile iade kaydı ebediyen çelişir.
      await this.ledger.append(tx, draft.entries);

      await tx.returnRequest.update({
        where: { id: returnId },
        data: {
          status: 'APPROVED',
          decidedBy: actor.id ?? null,
          decidedAt: now,
          refundAmountMinor: draft.customerRefundMinor,
        },
      });

      // Paket tamamen iade edildiyse RETURNED, kısmi ise teslim edilmiş hâline
      // döner — kalan ürünler hâlâ müşteride.
      const returnedByItem = new Map(settledQuantity);
      for (const line of lines) {
        returnedByItem.set(
          line.orderItemId,
          (returnedByItem.get(line.orderItemId) ?? 0) + line.returnQuantity,
        );
      }
      const touchedPackageIds = [
        ...new Set(lines.map((line) => itemById.get(line.orderItemId)!.packageId)),
      ];
      for (const packageId of touchedPackageIds) {
        const pkg = packageById.get(packageId)!;
        const packageItems = request.order.items.filter((item) => item.packageId === packageId);
        const fullyReturned = packageItems.every(
          (item) => (returnedByItem.get(item.id) ?? 0) >= item.quantity,
        );
        const target: PackageStatus = fullyReturned ? 'RETURNED' : 'DELIVERED';
        assertPackageTransition(pkg.status, target);
        await tx.orderPackage.update({ where: { id: packageId }, data: { status: target } });
      }

      await this.syncOrderStatus(tx, request.orderId, now);

      await this.recordEvent(tx, {
        orderId: request.orderId,
        type: 'return.approved',
        actorType: actor.type,
        actorId: actor.id ?? null,
        payload: {
          returnId,
          returnNumber: request.returnNumber,
          orderNumber: request.order.orderNumber,
          // Ödeme modülü bu tutarı sağlayıcıya iade eder.
          refundAmountMinor: draft.customerRefundMinor,
          sellerNetImpactMinor: draft.sellerNetImpactMinor,
        },
      });

      this.logger.info(
        {
          returnNumber: request.returnNumber,
          refundAmountMinor: draft.customerRefundMinor.toString(),
          sellerNetImpactMinor: draft.sellerNetImpactMinor.toString(),
          ledgerEntryCount: draft.entries.length,
        },
        'İade onaylandı, ters defter kayıtları yazıldı',
      );

      return {
        returnNumber: request.returnNumber,
        refundAmountMinor: draft.customerRefundMinor,
        sellerNetImpactMinor: draft.sellerNetImpactMinor,
      };
    });
  }

  /** İade reddi: paket teslim edilmiş hâline döner, defter hiç yazılmaz. */
  async rejectReturn(
    returnId: string,
    actor: OrderActor,
    rejectReason: string,
  ): Promise<{ returnNumber: string; status: ReturnStatus }> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const head = await tx.returnRequest.findUnique({
        where: { id: returnId },
        select: { orderId: true },
      });
      if (!head) throw appError('NOT_FOUND', { internalMessage: `İade ${returnId} yok` });

      await lockOrder(tx, head.orderId);

      const request = await tx.returnRequest.findUniqueOrThrow({
        where: { id: returnId },
        select: {
          orderId: true,
          returnNumber: true,
          status: true,
          items: { select: { orderItemId: true } },
          order: {
            select: {
              packages: { select: { id: true, sellerId: true, status: true } },
              items: { select: { id: true, packageId: true } },
            },
          },
        },
      });

      if (request.status !== 'REQUESTED') {
        throw appError('ORDER_INVALID_TRANSITION', {
          internalMessage: `İade ${request.returnNumber} ${request.status} durumunda`,
        });
      }

      const packageIdByItem = new Map(request.order.items.map((item) => [item.id, item.packageId]));
      const packageById = new Map(request.order.packages.map((pkg) => [pkg.id, pkg]));
      const touched = [
        ...new Set(
          request.items
            .map((item) => packageIdByItem.get(item.orderItemId))
            .filter((id): id is string => id !== undefined),
        ),
      ];
      for (const packageId of touched)
        this.assertSellerScope(actor, packageById.get(packageId)!.sellerId);

      await tx.returnRequest.update({
        where: { id: returnId },
        data: { status: 'REJECTED', decidedBy: actor.id ?? null, decidedAt: now, rejectReason },
      });

      for (const packageId of touched) {
        const pkg = packageById.get(packageId)!;
        if (pkg.status !== 'RETURN_REQUESTED') continue;
        assertPackageTransition(pkg.status, 'DELIVERED');
        await tx.orderPackage.update({ where: { id: packageId }, data: { status: 'DELIVERED' } });
      }

      await this.syncOrderStatus(tx, request.orderId, now);
      await this.recordEvent(tx, {
        orderId: request.orderId,
        type: 'return.rejected',
        actorType: actor.type,
        actorId: actor.id ?? null,
        payload: { returnId, returnNumber: request.returnNumber, rejectReason },
      });

      return { returnNumber: request.returnNumber, status: 'REJECTED' as ReturnStatus };
    });
  }

  /** Ödeme modülü iadeyi sağlayıcıda tamamladığında çağırır. */
  async markReturnRefunded(returnId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.returnRequest.findUniqueOrThrow({
        where: { id: returnId },
        select: { orderId: true, returnNumber: true, status: true },
      });
      await lockOrder(tx, request.orderId);
      if (request.status !== 'APPROVED') {
        throw appError('ORDER_INVALID_TRANSITION', {
          internalMessage: `İade ${request.returnNumber} ${request.status} durumunda`,
        });
      }
      await tx.returnRequest.update({
        where: { id: returnId },
        data: { status: 'REFUNDED', refundedAt: now },
      });
      await this.syncOrderStatus(tx, request.orderId, now);
      await this.recordEvent(tx, {
        orderId: request.orderId,
        type: 'return.refunded',
        actorType: 'SYSTEM',
        payload: { returnId, returnNumber: request.returnNumber },
      });
    });
  }

  // ── Paket geçişleri (satıcı/sistem) ──────────────────────────────────────

  /**
   * Tek giriş noktası: paket durumu YALNIZCA buradan değişir. Satıcı modülü
   * kendi tablosuna değil bu servise yazar; aksi hâlde geçiş makinesi ve
   * OrderEvent kaydı atlanabilirdi.
   */
  async transitionPackage(
    packageId: string,
    target: PackageStatus,
    actor: OrderActor,
    patch: { carrier?: string; trackingNo?: string; cancelReason?: string } = {},
  ): Promise<{ orderStatus: OrderStatus; packageStatus: PackageStatus }> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const head = await tx.orderPackage.findUnique({
        where: { id: packageId },
        select: { orderId: true },
      });
      if (!head) throw appError('PACKAGE_NOT_FOUND');

      await lockOrder(tx, head.orderId);

      const pkg = await tx.orderPackage.findUniqueOrThrow({
        where: { id: packageId },
        select: { id: true, orderId: true, sellerId: true, status: true },
      });
      this.assertSellerScope(actor, pkg.sellerId);

      if (target === 'CANCELLED' && (pkg.status === 'SHIPPED' || pkg.status === 'DELIVERED')) {
        throw appError('ORDER_NOT_CANCELLABLE', {
          internalMessage: `Paket ${packageId} ${pkg.status} durumunda`,
        });
      }
      assertPackageTransition(pkg.status, target);

      await tx.orderPackage.update({
        where: { id: packageId },
        data: {
          status: target,
          ...(patch.carrier !== undefined ? { carrier: patch.carrier } : {}),
          ...(patch.trackingNo !== undefined ? { trackingNo: patch.trackingNo } : {}),
          ...(target === 'SHIPPED' ? { shippedAt: now } : {}),
          ...(target === 'DELIVERED' && pkg.status === 'SHIPPED' ? { deliveredAt: now } : {}),
          ...(target === 'CANCELLED'
            ? { cancelledAt: now, cancelReason: patch.cancelReason ?? null }
            : {}),
        },
      });

      const orderStatus = await this.syncOrderStatus(tx, pkg.orderId, now);

      await this.recordEvent(tx, {
        orderId: pkg.orderId,
        type: `package.${target.toLowerCase()}`,
        actorType: actor.type,
        actorId: actor.id ?? null,
        payload: {
          packageId,
          sellerId: pkg.sellerId,
          from: pkg.status,
          to: target,
          carrier: patch.carrier ?? null,
          trackingNo: patch.trackingNo ?? null,
        },
      });

      return { orderStatus, packageStatus: target };
    });
  }

  // ── Ortak yardımcılar ────────────────────────────────────────────────────

  /**
   * Order.status kolonunu türetimle yeniden yazar.
   *
   * Kolon doğruluk kaynağı değil, listeleme/filtreleme önbelleğidir; her paket
   * değişiminden sonra AYNI transaction içinde tazelenir ki liste ekranı ile
   * detay ekranı farklı şey söylemesin.
   */
  async syncOrderStatus(tx: Tx, orderId: string, now: Date = new Date()): Promise<OrderStatus> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        status: true,
        paidAt: true,
        cancelledAt: true,
        completedAt: true,
        reservationExpiresAt: true,
        packages: { select: { status: true, deliveredAt: true } },
      },
    });

    const next = deriveOrderStatus(order.packages, {
      paymentPhase: derivePaymentPhase({
        paidAt: order.paidAt,
        reservationExpiresAt: order.reservationExpiresAt,
        status: order.status,
        now,
      }),
      cancelled: order.cancelledAt !== null,
      now,
    });

    if (next !== order.status) {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: next,
          ...(next === 'COMPLETED' && order.completedAt === null ? { completedAt: now } : {}),
        },
      });
    }
    return next;
  }

  /** Okuma yolunda kolona güvenmeden durumu türetir. */
  private statusOf(
    order: {
      status: OrderStatus;
      paidAt: Date | null;
      cancelledAt: Date | null;
      reservationExpiresAt: Date | null;
      packages: readonly PackageSnapshot[];
    },
    now: Date = new Date(),
  ): OrderStatus {
    return deriveOrderStatus(order.packages, {
      paymentPhase: derivePaymentPhase({
        paidAt: order.paidAt,
        reservationExpiresAt: order.reservationExpiresAt,
        status: order.status,
        now,
      }),
      cancelled: order.cancelledAt !== null,
      now,
    });
  }

  /**
   * Paket indirimini kalemlere KURUŞ KAYBI OLMADAN paylaştırır.
   *
   * İndirim paket düzeyinde tutuluyor; iadede müşteriye ne kadar geri
   * ödeneceğini bilmek için kalem payı gerekiyor. Ağırlık olarak lineTotal
   * kullanılıyor: pahalı kalem indirimden daha çok pay alır.
   */
  private allocateDiscountShares(
    packages: readonly { id: string; discountShareMinor: bigint }[],
    items: readonly { id: string; packageId: string; lineTotalMinor: bigint }[],
  ): Map<string, bigint> {
    const shares = new Map<string, bigint>();
    for (const pkg of packages) {
      const packageItems = items.filter((item) => item.packageId === pkg.id);
      if (packageItems.length === 0) continue;
      if (pkg.discountShareMinor === 0n) {
        for (const item of packageItems) shares.set(item.id, 0n);
        continue;
      }
      // Ağırlıklar Number: kuruş tutarları 2^53'ün çok altında ve allocate
      // yalnızca ORAN için kullanıyor — bölünen tutar bigint kalıyor.
      const allocated = Money.allocate(
        Money.money(pkg.discountShareMinor),
        packageItems.map((item) => Number(item.lineTotalMinor)),
      );
      packageItems.forEach((item, index) => {
        shares.set(item.id, allocated[index]?.amountMinor ?? 0n);
      });
    }
    return shares;
  }

  private assertSellerScope(actor: OrderActor, sellerId: string): void {
    // ⚠️ Bu kontrol olmadan bir satıcı, başka mağazanın iadesini onaylayıp
    // o mağazanın defterine kayıt düşürebilirdi.
    if (actor.type !== 'SELLER') return;
    if (actor.sellerId !== sellerId) {
      throw appError('AUTH_FORBIDDEN', {
        internalMessage: `Satıcı ${actor.sellerId ?? '-'} paket sahibi ${sellerId} değil`,
      });
    }
  }

  /**
   * OrderEvent (append-only geçmiş) + OutboxEvent (yan etkiler) AYNI
   * transaction'da yazılır. Kuyruğa doğrudan yazılsaydı transaction rollback
   * edildiğinde olmamış bir olay için bildirim gitmiş olurdu.
   */
  private async recordEvent(
    tx: Tx,
    event: {
      orderId: string;
      type: string;
      actorType: ActorType;
      actorId?: string | null;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    const payload = serializeBigInts(event.payload) as Prisma.InputJsonValue;

    await tx.orderEvent.create({
      data: {
        orderId: event.orderId,
        type: event.type,
        actorType: event.actorType,
        actorId: event.actorId ?? null,
        payload,
      },
    });
    await tx.outboxEvent.create({
      data: {
        aggregate: 'order',
        aggregateId: event.orderId,
        type: event.type,
        payload,
      },
    });
  }
}
