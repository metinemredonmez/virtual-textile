import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { FINANCE } from '@vt/config';
import { Prisma, type LedgerType, type PayoutStatus } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { SellerService } from './seller.service.js';
import { decryptField, maskIban } from './seller-crypto.js';
import {
  assertPayoutEligible,
  balanceFromTotals,
  buildPayoutLedgerRow,
  type SellerBalance,
} from './seller-balance.js';
import type { CreatePayoutInput, LedgerQuery, PayoutListQuery } from './seller.schema.js';
import type { LedgerEntryDraft } from '../order/index.js';

/** Bekleyen sayılan payout durumları — yeni talebi engelleyenler. */
const PENDING_PAYOUT_STATUSES: readonly PayoutStatus[] = ['REQUESTED', 'APPROVED'];

export interface SellerBalanceView extends SellerBalance {
  currency: 'TRY';
  /** Asgari payout tutarı — arayüz "en az X ₺" uyarısını buradan üretir. */
  minPayoutMinor: bigint;
  /** Bekleyen hakedişin olgunlaşacağı en yakın tarih. */
  nextAvailableAt: Date | null;
  /** Bekleyen bir ödeme talebi var mı? */
  hasPendingPayout: boolean;
  /** Bakiye şu an çekilebilir mi (tutar + durum kontrolleri birlikte)? */
  canRequestPayout: boolean;
  breakdown: Record<string, bigint>;
}

/**
 * SATICI FİNANSI — bakiye ve ödeme talebi.
 *
 * ⚠️ BAKİYE AYRI KOLONDA TUTULMAZ. Her okumada LedgerEntry toplanır.
 *    `Seller.balance` gibi bir kolon eklemek cazip görünür (tek sorgu, hızlı)
 *    ama defterle er geç ayrışır ve ayrıştığında hangisinin doğru olduğu
 *    anlaşılamaz. Defter append-only olduğu için toplam her zaman yeniden
 *    üretilebilir; kolon üretilemez.
 *
 * Hesaplama kuralının kendisi `seller-balance.ts`'de ve testlidir; burada
 * yalnızca toplamlar veritabanından çekilir.
 */
@Injectable()
export class SellerFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellers: SellerService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── Bakiye ───────────────────────────────────────────────────────────────

  async balance(sellerId: string, now: Date = new Date()): Promise<SellerBalanceView> {
    const [totals, pending, breakdownRows, nextRow, pendingPayout] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({
        where: { sellerId },
        _sum: { amountMinor: true },
      }),
      // ⚠️ "Olgunlaşmamış" = availableAt DOLU ve GELECEKTE.
      //    `availableAt = null` satırları (iade ters kayıtları, payout
      //    borçları) bilerek DIŞARIDA bırakılmıyor — onlar anında etki eder.
      //    Gerekçe: seller-balance.ts → computeBalance.
      this.prisma.ledgerEntry.aggregate({
        where: { sellerId, availableAt: { gt: now } },
        _sum: { amountMinor: true },
      }),
      this.prisma.ledgerEntry.groupBy({
        by: ['type'],
        where: { sellerId },
        _sum: { amountMinor: true },
      }),
      this.prisma.ledgerEntry.findFirst({
        where: { sellerId, availableAt: { gt: now }, amountMinor: { gt: 0 } },
        orderBy: { availableAt: 'asc' },
        select: { availableAt: true },
      }),
      this.prisma.payoutRequest.findFirst({
        where: { sellerId, status: { in: [...PENDING_PAYOUT_STATUSES] } },
        select: { id: true },
      }),
    ]);

    const balance = balanceFromTotals(
      totals._sum.amountMinor ?? 0n,
      pending._sum.amountMinor ?? 0n,
    );

    const breakdown: Record<string, bigint> = {};
    for (const row of breakdownRows) {
      breakdown[row.type] = row._sum.amountMinor ?? 0n;
    }

    const hasPendingPayout = pendingPayout !== null;

    return {
      ...balance,
      currency: 'TRY',
      minPayoutMinor: FINANCE.minPayoutMinor,
      nextAvailableAt: nextRow?.availableAt ?? null,
      hasPendingPayout,
      canRequestPayout: !hasPendingPayout && balance.withdrawableMinor >= FINANCE.minPayoutMinor,
      breakdown,
    };
  }

  /** Defter dökümü — mutabakat ekranı. */
  async ledger(
    sellerId: string,
    query: LedgerQuery,
  ): Promise<{ items: unknown[]; nextCursor: string | null }> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { sellerId, ...(query.type ? { type: query.type } : {}) },
      // uuid v7 zaman sıralıdır; offset yerine cursor kullanılıyor ki araya
      // yeni kayıt düştüğünde satır atlanmasın veya iki kez görünmesin.
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        amountMinor: true,
        currency: true,
        description: true,
        orderItemId: true,
        payoutId: true,
        availableAt: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  // ── Ödeme talebi ─────────────────────────────────────────────────────────

  /**
   * ÖDEME TALEBİ.
   *
   * Talep yalnızca PayoutRequest(REQUESTED) yazar; PARA BURADA HAREKET ETMEZ.
   * Ödeme admin onayıyla yapılır ve PAYOUT defter kaydı o anda düşer
   * (bkz. buildPayoutLedgerRow). Talep anında defter yazılsaydı, reddedilen
   * bir talep için satıcının bakiyesi düşmüş kalırdı.
   *
   * ⚠️ YARIŞ DURUMU: iki eşzamanlı talep aynı bakiyeyi görüp ikisi de
   *    geçebilirdi. Satıcı satırı transaction başında `FOR UPDATE` ile
   *    kilitleniyor; ikinci istek birincinin talebini gördükten sonra
   *    değerlendirilir ve PAYOUT_PENDING_EXISTS alır. Uygulama düzeyinde
   *    "önce oku, sonra yaz" kontrolü bu yarışı KAPATMAZ.
   */
  async requestPayout(
    sellerId: string,
    input: CreatePayoutInput,
    actorUserId: string,
  ): Promise<{
    id: string;
    amountMinor: bigint;
    status: PayoutStatus;
    ibanMasked: string;
    createdAt: Date;
  }> {
    await this.sellers.requireActive(sellerId);
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // Mağaza satırını kilitle — aynı mağazanın payout istekleri sıraya girer.
      await tx.$queryRaw`SELECT id FROM seller_sellers WHERE id = ${sellerId}::uuid FOR UPDATE`;

      // Kilit alındıktan SONRA oku: kilidi beklerken başka bir istek talep
      // açmış olabilir.
      const pending = await tx.payoutRequest.findFirst({
        where: { sellerId, status: { in: [...PENDING_PAYOUT_STATUSES] } },
        select: { id: true },
      });

      const [totals, maturing] = await Promise.all([
        tx.ledgerEntry.aggregate({ where: { sellerId }, _sum: { amountMinor: true } }),
        tx.ledgerEntry.aggregate({
          where: { sellerId, availableAt: { gt: now } },
          _sum: { amountMinor: true },
        }),
      ]);

      const balance = balanceFromTotals(
        totals._sum.amountMinor ?? 0n,
        maturing._sum.amountMinor ?? 0n,
      );

      // Asgari tutar → bekleyen talep → yetersiz bakiye (bkz. seller-balance.ts).
      assertPayoutEligible({
        requestedMinor: input.amountMinor,
        withdrawableMinor: balance.withdrawableMinor,
        hasPendingRequest: pending !== null,
      });

      // ⚠️ IBAN'ın ÇÖZÜLDÜĞÜ TEK YER BURASI.
      //    Amaç değeri taşımak değil, DOĞRULAMAK: bozuk veya anahtar
      //    rotasyonundan sonra çözülemeyen bir IBAN ile talep açılırsa hata
      //    admin onayında, yani günler sonra ortaya çıkar. Çözülen değer
      //    değişkende kalır; yanıta, loga veya outbox payload'ına GİRMEZ.
      const ibanEnc = await this.sellers.encryptedIban(tx, sellerId);
      const iban = decryptField(ibanEnc);
      const masked = maskIban(iban);

      const payout = await tx.payoutRequest.create({
        data: {
          sellerId,
          amountMinor: input.amountMinor,
          status: 'REQUESTED',
          // Talep anındaki IBAN ŞİFRELİ hâliyle kopyalanır: satıcı sonradan
          // hesabını değiştirse bile bu talep hangi hesaba açıldıysa oraya
          // ödenir.
          ibanEnc,
          // Sağlayıcıya retry'da AYNI değer gider; çifte ödemeyi engelleyen anahtar.
          payoutRef: `PO-${randomUUID()}`,
        },
        select: { id: true, amountMinor: true, status: true, createdAt: true },
      });

      await tx.outboxEvent.create({
        data: {
          aggregate: 'payout',
          aggregateId: payout.id,
          type: 'payout.requested',
          payload: {
            payoutId: payout.id,
            sellerId,
            amountMinor: payout.amountMinor.toString(),
            requestedBy: actorUserId,
            // ⚠️ Yalnızca maskeli IBAN. Düz IBAN outbox'a yazılırsa şifreleme
            //    sınırı delinir; kuyruk ve tüketiciler şifrelenmemiş alandır.
            ibanMasked: masked,
          },
        },
      });

      return { ...payout, ibanMasked: masked };
    });

    this.logger.info(
      { sellerId, payoutId: result.id, amountMinor: result.amountMinor.toString() },
      'Ödeme talebi oluşturuldu',
    );

    return result;
  }

  async listPayouts(
    sellerId: string,
    query: PayoutListQuery,
  ): Promise<{ items: unknown[]; nextCursor: string | null }> {
    const rows = await this.prisma.payoutRequest.findMany({
      where: { sellerId, ...(query.status ? { status: query.status } : {}) },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        amountMinor: true,
        status: true,
        payoutRef: true,
        approvedAt: true,
        sentAt: true,
        failureReason: true,
        createdAt: true,
        // ⚠️ `ibanEnc` seçilmiyor: listeleme uçlarında şifreli alan taşımanın
        //    hiçbir faydası yok, sızma yüzeyi ise büyüyor.
      },
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  // ── Defter yazma (modül sınırı) ──────────────────────────────────────────

  /**
   * `SellerLedgerPort` uyumlu yazma yüzeyi.
   *
   * Sipariş modülü iade ters kayıtlarını bir port üzerinden yazıyor ve şu an
   * geçici `PrismaSellerLedger` adaptörüne bağlı (bkz. order/ledger.port.ts).
   * Defterin sahibi artık bu modül olduğu için o token BURAYA bağlanabilir.
   *
   * ⚠️ ENTEGRASYON AJANI: `OrderModule` içindeki
   *      { provide: SELLER_LEDGER, useClass: PrismaSellerLedger }
   *    satırını
   *      { provide: SELLER_LEDGER, useExisting: SellerFinanceService }
   *    ile değiştirip `PrismaSellerLedger`'ı silebilir.
   *
   * Kayıtlar ÇAĞIRANIN transaction'ında yazılır: ayrı transaction kullanılsaydı
   * iade onaylanıp defter yazılmadan kalabilirdi.
   */
  async append(tx: Prisma.TransactionClient, entries: readonly LedgerEntryDraft[]): Promise<void> {
    if (entries.length === 0) return;

    await tx.ledgerEntry.createMany({
      data: entries.map((entry) => ({
        sellerId: entry.sellerId,
        orderItemId: entry.orderItemId,
        type: entry.type,
        amountMinor: entry.amountMinor,
        description: entry.description,
        availableAt: entry.availableAt ?? null,
      })),
    });
  }

  /**
   * Ödeme gönderildiğinde defter borcunu yazar.
   *
   * Satıcı ucundan ÇAĞRILMAZ — admin onay akışının kullanacağı yüzeydir.
   * Burada duruyor çünkü bakiye hesabının sahibi bu servistir; başka bir modül
   * PAYOUT satırını kendi yazsaydı işaret veya `availableAt` kuralı sessizce
   * ayrışabilirdi.
   */
  async recordPayoutSettlement(
    tx: Prisma.TransactionClient,
    input: { sellerId: string; payoutId: string; amountMinor: bigint },
  ): Promise<void> {
    const row = buildPayoutLedgerRow(input);
    await tx.ledgerEntry.create({
      data: {
        sellerId: row.sellerId,
        payoutId: row.payoutId,
        type: row.type satisfies LedgerType,
        amountMinor: row.amountMinor,
        description: row.description,
        availableAt: row.availableAt,
      },
    });
  }
}

// Prisma tip alanını kullanan `satisfies` için referans korunuyor.
export type { Prisma };
