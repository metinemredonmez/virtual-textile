/**
 * SATICI DEFTERİ — modül sınırı.
 *
 * Sipariş modülü satıcı bakiyesinin sahibi DEĞİLDİR; iade ters kayıtlarını
 * yalnızca bu port üzerinden yazar. Böylece finans modülü hazır olduğunda
 * yalnızca sağlayıcı değişir, sipariş mantığına dokunulmaz.
 */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@vt/db';
import type { LedgerEntryDraft } from './return-ledger.js';

export const SELLER_LEDGER = 'SELLER_LEDGER';

export interface SellerLedgerPort {
  /**
   * Kayıtlar ÇAĞIRANIN transaction'ı içinde yazılır.
   * Ayrı transaction kullanılsaydı iade onaylanıp defter yazılmayabilirdi.
   */
  append(tx: Prisma.TransactionClient, entries: readonly LedgerEntryDraft[]): Promise<void>;
}

/**
 * ⚠️ GEÇİCİ SAĞLAYICI. Finans modülü (packages: LedgerEntry, PayoutRequest)
 * devreye girdiğinde bu sınıf SİLİNİR ve SELLER_LEDGER token'ı finans
 * servisine bağlanır. Buradaki tek iş, iade onaylandığında defterin
 * yazılmadan kalmaması.
 */
@Injectable()
export class PrismaSellerLedger implements SellerLedgerPort {
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
}
