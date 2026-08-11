import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@vt/db';
import type { StorageProvider } from '@vt/adapters';
import type { Logger } from 'pino';

const BATCH_SIZE = 500;

export interface RetentionResult {
  scanned: number;
  deleted: number;
  storageFailures: number;
}

/**
 * FOTOĞRAF SAKLAMA SÜRESİ TEMİZLİĞİ
 *
 * Kullanıcı fotoğrafları özel nitelikli kişisel veridir ve süresi dolduğunda
 * silinmesi taahhüt edilmiştir:
 *   "Yalnızca bu işlem için kullan" → 24 saat
 *   "Profilimde sakla"             → 90 gün
 *
 * ⚠️ BU İŞİN SESSİZCE DURMASI BİR KVKK İHLALİDİR.
 *    Çalıştığı her turda son çalışma zamanı yazılır; izleme bu değeri okur ve
 *    beklenenden eskiyse alarm üretir (bkz. docs/privacy.md §3).
 *
 * SIRA ÖNEMLİ: önce DEPODAN sil, sonra veritabanı kaydını.
 * Tersi yapılırsa ve depo silme başarısız olursa, artık hangi nesnenin
 * silineceğini bilemeyiz — dosya sonsuza kadar depoda kalır (yetim nesne).
 */
@Injectable()
export class PhotoRetentionJob {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageProvider,
    private readonly logger: Logger,
  ) {}

  async run(now: Date = new Date()): Promise<RetentionResult> {
    const expired = await this.prisma.userPhoto.findMany({
      where: { expiresAt: { lte: now }, deletedAt: null },
      select: { id: true, storageKey: true, userId: true },
      take: BATCH_SIZE,
    });

    if (expired.length === 0) {
      return { scanned: 0, deleted: 0, storageFailures: 0 };
    }

    let deleted = 0;
    let storageFailures = 0;

    for (const photo of expired) {
      try {
        // 1) Türetilmiş try-on sonuçları — kaynak silinince onlar da gitmeli.
        const derived = await this.prisma.tryOnJob.findMany({
          where: { userPhotoId: photo.id, resultKey: { not: null } },
          select: { id: true, resultKey: true },
        });

        const derivedKeys = derived
          .map((job) => job.resultKey)
          .filter((key): key is string => key !== null);

        if (derivedKeys.length > 0) {
          await this.storage.deleteMany(derivedKeys, 'private');
        }

        // 2) Kaynak fotoğraf
        await this.storage.delete(photo.storageKey, 'private');

        // 3) Ancak depodan gerçekten silindikten SONRA kayıtları işaretle.
        await this.prisma.$transaction([
          // Try-on kayıtları silinmez, anonimleştirilir: metrikler (kaç deneme
          // yapıldı, önbellek isabeti) korunsun ama görsel kalmasın.
          this.prisma.tryOnJob.updateMany({
            where: { userPhotoId: photo.id },
            data: { resultKey: null },
          }),
          this.prisma.userPhoto.update({
            where: { id: photo.id },
            data: { deletedAt: new Date() },
          }),
        ]);

        deleted += 1;
      } catch (error) {
        storageFailures += 1;
        // Kayıt silinmemiş olarak kalır ve sonraki turda tekrar denenir.
        this.logger.error({ photoId: photo.id, err: error }, 'Süresi dolmuş fotoğraf silinemedi');
      }
    }

    this.logger.info(
      { scanned: expired.length, deleted, storageFailures },
      'Fotoğraf saklama süresi temizliği tamamlandı',
    );

    return { scanned: expired.length, deleted, storageFailures };
  }
}

/**
 * Süresi geçmiş stok rezervasyonlarını serbest bırakır.
 *
 * Normalde ödeme akışı bunu kendi yapar. Bu iş güvenlik ağıdır: süreç ödeme
 * sırasında ölürse stok sonsuza kadar kilitli kalmasın.
 */
@Injectable()
export class ReservationReleaseJob {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
  ) {}

  async run(now: Date = new Date()): Promise<{ released: number }> {
    const stale = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', reservationExpiresAt: { lte: now } },
      select: { id: true, items: { select: { variantId: true, quantity: true } } },
      take: 200,
    });

    let released = 0;

    for (const order of stale) {
      await this.prisma.$transaction(async (tx) => {
        for (const item of order.items) {
          await tx.inventory.update({
            where: { variantId: item.variantId },
            data: { reserved: { decrement: item.quantity } },
          });
        }
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'EXPIRED' },
        });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'order.expired',
            actorType: 'SYSTEM',
            payload: { reason: 'reservation_timeout' },
          },
        });
      });
      released += 1;
    }

    if (released > 0) {
      this.logger.warn({ released }, 'Süresi dolmuş rezervasyonlar serbest bırakıldı');
    }

    return { released };
  }
}
