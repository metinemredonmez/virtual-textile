import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';
import { MeConsentService } from './consent.read.service.js';
import { ME_RETENTION, ME_SESSIONS } from './me.ports.js';
import { PrismaMeRetentionBridge, PrismaMeSessionBridge } from './me.bridges.js';

/**
 * "HESABIM" MODÜLÜ — KVKK md.11 yüzeyi.
 *
 * Uçlar:
 *   GET    /v1/me/consents      → rıza durumları + tam geçmiş
 *   POST   /v1/me/consents      → rıza ver / geri çek (APPEND-ONLY)
 *   GET    /v1/me/data-export   → talebin durumu
 *   POST   /v1/me/data-export   → veri indirme talebi (202)
 *   DELETE /v1/me               → hesap silme talebi (202, 30 gün geri alınabilir)
 *
 * Sahip olduğu veri: `ConsentRecord`, `User.deletionRequestedAt`.
 *
 * Başka modülün verisine erişim (kural 3):
 *   • `UserPhoto` → `ME_RETENTION` portu, geçici Prisma köprüsü
 *   • `Session`   → `ME_SESSIONS` portu, geçici Prisma köprüsü
 *   • `TryOnJob`  → HİÇ dokunulmuyor; `PhotoRetentionJob` kaynak fotoğrafla
 *                   birlikte türetilmiş çıktıları da temizler.
 *
 * ⚠️ `MeConsentService` DIŞA AÇILIYOR: medya ve sanal deneme modüllerindeki
 *    geçici rıza köprülerinin yerine geçmek üzere yazıldı (bkz.
 *    consent.read.service.ts).
 */
@Module({
  controllers: [MeController],
  providers: [
    // ── Geçici köprüler (bkz. me.bridges.ts) ──
    { provide: ME_RETENTION, useClass: PrismaMeRetentionBridge },
    { provide: ME_SESSIONS, useClass: PrismaMeSessionBridge },

    // ── Servisler ──
    {
      provide: MeService,
      inject: [PrismaService, ME_RETENTION, ME_SESSIONS, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof MeService>) => new MeService(...args),
    },
    {
      provide: MeConsentService,
      inject: [PrismaService],
      useFactory: (...args: ConstructorParameters<typeof MeConsentService>) =>
        new MeConsentService(...args),
    },
  ],
  // ⚠️ `MeService` dışa açık çünkü `AuthService` başarılı girişte
  //    `cancelAccountDeletion` çağırmalı (bkz. me.service.ts ve modül raporu).
  exports: [MeService, MeConsentService],
})
export class MeModule {}

// ── Genel yüzey ───────────────────────────────────────────────────────────

export { MeController } from './me.controller.js';
export {
  MeService,
  ME_AUDIT_ACTION,
  ME_EVENT,
  type AccountDeletionView,
  type ConsentListView,
  type ConsentWriteView,
  type DataExportView,
  type DeletionCancellationView,
  type MeActor,
} from './me.service.js';
export { MeConsentService } from './consent.read.service.js';

// Saf çekirdek — diğer modüller ve worker bu kuralları yeniden yazmasın.
export {
  ALL_CONSENT_TYPES,
  PHOTO_BEARING_CONSENTS,
  buildConsentStates,
  changesEffectiveConsent,
  currentConsent,
  revocationExpiresAt,
  revocationPurgesPhotos,
  type ConsentEvent,
  type ConsentHistoryRecord,
  type ConsentState,
} from './consent.history.js';

export {
  DELETION_GRACE_DAYS,
  deletionPurgeAt,
  evaluateDeletionCancellation,
  remainingGraceDays,
  type DeletionCancellation,
} from './account-deletion.js';

export {
  DATA_EXPORT_LINK_HOURS,
  canRequestDataExport,
  dataExportLinkExpiresAt,
  describeDataExport,
  type DataExportSnapshot,
  type DataExportStatus,
} from './data-export.js';

export {
  CONSENT_DOCUMENT_VERSION,
  accountDeletionSchema,
  consentWriteSchema,
  type AccountDeletionInput,
  type ConsentWriteInput,
} from './me.schema.js';

export {
  ME_RETENTION,
  ME_SESSIONS,
  type ConsentReadSurface,
  type MeRetentionPort,
  type MeSessionPort,
} from './me.ports.js';

export { PrismaMeRetentionBridge, PrismaMeSessionBridge } from './me.bridges.js';
