/**
 * ═══════════════ GEÇİCİ KÖPRÜLER — SİLİNMEK ÜZERE YAZILDI ═══════════════════
 *
 * Kural 3 gereği "hesabım" modülü başka modülün Prisma modeline dokunmaz.
 * Aşağıdaki iki köprü, sahibi modüller bir yazma yüzeyi yayımlamadığı için var:
 *
 *   • `UserPhoto` → MEDYA modülünün tablosu. `MediaService` bugün yalnızca
 *     "tek fotoğrafı sil" yüzeyi veriyor; "bu kullanıcının tüm fotoğraflarının
 *     saklama süresini geçmişe çek" yüzeyi yok.
 *     → MEDYA `expireUserPhotos(tx, userId, at)` yayımlayınca `index.ts`
 *       içindeki `ME_RETENTION` bağlaması ona çevrilir ve bu sınıf silinir.
 *
 *   • `Session` → KİMLİK modülünün tablosu. `TokenService.revokeAllSessions`
 *     VAR ama kendi bağlantısını kullanıyor; çağıranın transaction'ına
 *     katılamıyor. Silme talebi ile oturum düşürmenin atomik olması şart
 *     olduğu için (bkz. me.ports.ts) araya bu köprü giriyor.
 *     → `TokenService` `tx` alan bir aşırı yükleme yayımlayınca `ME_SESSIONS`
 *       bağlaması ona çevrilir ve bu sınıf silinir.
 *
 * ⚠️ Köprüler İŞ KURALI İÇERMEZ. "Hangi fotoğraf" ve "ne zaman" kararı
 *    `consent.history.ts` içinde verilir; buradaki kod yalnızca yazar.
 */
import { Injectable } from '@nestjs/common';
import type { MeRetentionPort, MeSessionPort, Tx } from './me.ports.js';

@Injectable()
export class PrismaMeRetentionBridge implements MeRetentionPort {
  async expireUserPhotos(tx: Tx, userId: string, expiresAt: Date): Promise<number> {
    const result = await tx.userPhoto.updateMany({
      // ⚠️ `deletedAt: null` koşulu: zaten silinmiş satırın süresini geriye
      //    çekmek `PhotoRetentionJob`'ın sorgusuna girmez (o `deletedAt: null`
      //    arar) ama sayacı şişirir ve denetim kaydında "12 fotoğraf silindi"
      //    diye yanlış bir sayı bırakırdı.
      where: { userId, deletedAt: null },
      data: { expiresAt },
    });
    return result.count;
  }
}

@Injectable()
export class PrismaMeSessionBridge implements MeSessionPort {
  async revokeAllSessions(tx: Tx, userId: string): Promise<number> {
    const result = await tx.session.updateMany({
      // Zaten düşmüş oturuma yeniden `revokedAt` yazmak, iptal ANINI
      // geriye dönük olarak bozardı — denetimde yanlış zaman görünürdü.
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}
