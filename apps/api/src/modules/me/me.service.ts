import { Inject, Injectable } from '@nestjs/common';
import { appError, type ConsentType } from '@vt/contracts';
import { Prisma, serializeBigInts, type Role } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { getContext } from '../../common/request-context.js';
import {
  buildConsentStates,
  changesEffectiveConsent,
  revocationExpiresAt,
  revocationPurgesPhotos,
  type ConsentState,
} from './consent.history.js';
import {
  deletionPurgeAt,
  evaluateDeletionCancellation,
  remainingGraceDays,
  DELETION_GRACE_DAYS,
} from './account-deletion.js';
import {
  canRequestDataExport,
  dataExportLinkExpiresAt,
  describeDataExport,
  DATA_EXPORT_LINK_HOURS,
  type DataExportSnapshot,
} from './data-export.js';
import { CONSENT_DOCUMENT_VERSION, type ConsentWriteInput } from './me.schema.js';
import {
  ME_RETENTION,
  ME_SESSIONS,
  type MeRetentionPort,
  type MeSessionPort,
  type Tx,
} from './me.ports.js';

/**
 * ═══════════════════════ KVKK md.11 — "İLGİLİ KİŞİNİN HAKLARI" ══════════════
 *
 * Bu servis, kullanıcının kendi verisi üzerindeki dört hakkını uygular:
 *   • rıza durumunu ÖĞRENME ve rızayı GERİ ÇEKME
 *   • verilerinin bir KOPYASINI isteme
 *   • hesabının SİLİNMESİNİ isteme
 *
 * ⚠️ ÜÇ KURAL BU DOSYANIN OMURGASIDIR:
 *
 *   1. RIZA KAYDI APPEND-ONLY. Geri çekme bir UPDATE değildir; `granted=false`
 *      olan yeni bir satırdır. Gerekçe `consent.history.ts` başında.
 *
 *   2. HİÇBİR ŞEY SENKRON SİLİNMEZ. Veri indirme hazırlığı ve depo silme
 *      worker işidir; uç yalnızca niyeti kaydeder. Bir HTTP isteği içinde
 *      dakikalarca sürecek bir işe girmek, isteği de veriyi de yarıda bırakır.
 *
 *   3. YAN ETKİ AYNI TRANSACTION'DA. Rıza satırı ile fotoğrafın işaretlenmesi,
 *      silme talebi ile oturumların düşürülmesi ayrılamaz. Ayrılırsa
 *      "rıza geri çekildi ama fotoğraf duruyor" durumu oluşur — bu, KVKK
 *      taahhüdünün sessizce ihlalidir ve dışarıdan görünmez.
 */

/** Outbox `aggregate` alanı — tüketiciler buna göre abone olur. */
const OUTBOX_AGGREGATE = 'user';

/** Bu modülün yayımladığı olaylar. Serbest metin yerine sabit liste. */
export const ME_EVENT = {
  consentRevoked: 'user.consent_revoked',
  dataExportRequested: 'user.data_export_requested',
  deletionRequested: 'user.deletion_requested',
  deletionCancelled: 'user.deletion_cancelled',
} as const;

/** Denetim izine yazılan işlemler. Hepsi hassas işlemdir (kural 6). */
export const ME_AUDIT_ACTION = {
  consentRecorded: 'user.consent.recorded',
  dataExportRequested: 'user.data_export.requested',
  deletionRequested: 'user.deletion.requested',
  deletionCancelled: 'user.deletion.cancelled',
} as const;

const ENTITY_USER = 'User';

export interface MeActor {
  readonly userId: string;
  readonly role: Role;
}

export interface ConsentListView {
  consents: ConsentState[];
  /** Şu an yürürlükte olan aydınlatma metni sürümü. */
  documentVersion: string;
}

export interface ConsentWriteView {
  type: ConsentType;
  granted: boolean;
  recordedAt: Date;
  documentVersion: string;
  /** Geçerli durum gerçekten değişti mi (yoksa aynı beyan tekrar mı edildi). */
  changed: boolean;
  /** Geri çekme sonucu silinmek üzere işaretlenen fotoğraf sayısı. */
  photosMarkedForDeletion: number;
}

export interface DataExportView extends DataExportSnapshot {
  linkValidHours: number;
}

export interface AccountDeletionView {
  status: 'PENDING_DELETION';
  requestedAt: Date;
  /** Verilerin silineceği/anonimleştirileceği an. */
  purgeAt: Date;
  graceDays: number;
  daysRemaining: number;
  /** Talep bu istekte mi açıldı, yoksa zaten açık mıydı. */
  alreadyRequested: boolean;
  sessionsRevoked: number;
}

export type DeletionCancellationView =
  | { cancelled: true; cancelledAt: Date }
  | { cancelled: false; reason: 'NO_REQUEST' | 'GRACE_EXPIRED' };

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ME_RETENTION) private readonly retention: MeRetentionPort,
    @Inject(ME_SESSIONS) private readonly sessions: MeSessionPort,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── RIZA ────────────────────────────────────────────────────────────────

  /**
   * Rıza durumları + TAM GEÇMİŞ.
   *
   * ⚠️ Geçmiş de dönülüyor, yalnızca "şu anki durum" değil: KVKK'nın istediği
   *    şey "ne zaman verildi, ne zaman geri çekildi" sorusunun her an
   *    cevaplanabilmesidir. Yalnızca güncel durum gösteren bir arayüz, bu
   *    soruyu destek ekibine ve oradan veritabanına havale eder.
   */
  async listConsents(userId: string): Promise<ConsentListView> {
    const records = await this.prisma.consentRecord.findMany({
      where: { userId },
      select: { type: true, granted: true, createdAt: true, documentVersion: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      consents: buildConsentStates(records),
      documentVersion: CONSENT_DOCUMENT_VERSION,
    };
  }

  /**
   * Rıza verir veya geri çeker.
   *
   * ⚠️ HER ÇAĞRI YENİ SATIR YAZAR — aynı beyan tekrarlansa bile.
   *    "Durum değişmiyorsa yazma" optimizasyonu YAPILMADI: her onay ayrı bir
   *    irade beyanıdır, kendi zamanı, kendi IP'si ve kendi metin sürümü
   *    vardır. Metin sürümü değiştiğinde kullanıcının yeniden onayladığını
   *    ispat edebilmek yalnızca bu satır sayesinde mümkün olur.
   *
   * ⚠️ Yan etkiler (fotoğraf işaretleme) yalnızca DURUM DEĞİŞTİĞİNDE tetiklenir;
   *    tekrar eden bir geri çekme, süresi çoktan geçmişe çekilmiş fotoğrafları
   *    ikinci kez işaretleyip denetim kaydına yanlış sayı bırakmaz.
   */
  async recordConsent(actor: MeActor, input: ConsentWriteInput): Promise<ConsentWriteView> {
    const now = new Date();
    const fingerprint = this.requestFingerprint();

    const existing = await this.prisma.consentRecord.findMany({
      where: { userId: actor.userId, type: input.type },
      select: { type: true, granted: true, createdAt: true, documentVersion: true },
    });

    const changed = changesEffectiveConsent(existing, input.type, input.granted);
    const purge = changed && revocationPurgesPhotos(input.type, input.granted);

    const photosMarkedForDeletion = await this.prisma.$transaction(async (tx) => {
      // ⚠️ APPEND-ONLY: `create`, `update`/`upsert` DEĞİL. Bir gün buraya
      //    `upsert` yazılırsa rıza geçmişi sessizce yok olur ve geçmişe dönük
      //    hiçbir ispat kalmaz.
      await tx.consentRecord.create({
        data: {
          userId: actor.userId,
          type: input.type,
          granted: input.granted,
          documentVersion: CONSENT_DOCUMENT_VERSION,
          ipAddress: fingerprint.ipAddress,
          userAgent: fingerprint.userAgent,
          createdAt: now,
        },
      });

      // ⚠️ SENKRON SİLME YOK: saklama süresi geçmişe çekilir, `PhotoRetentionJob`
      //    hem fotoğrafı hem TÜRETİLMİŞ try-on çıktılarını (resultKey) temizler.
      //    Türetilmiş veriye burada dokunulmaması bilinçlidir; o iş, kaynak
      //    fotoğrafla birlikte tek yerde yapılırsa yarım temizlik riski kalmaz.
      const marked = purge
        ? await this.retention.expireUserPhotos(tx, actor.userId, revocationExpiresAt(now))
        : 0;

      if (purge) {
        await this.emitOutbox(tx, actor.userId, ME_EVENT.consentRevoked, {
          userId: actor.userId,
          consentType: input.type,
          revokedAt: now.toISOString(),
          photosMarkedForDeletion: marked,
        });
      }

      // Denetim izi rıza satırıyla AYNI transaction'da — biri yazılıp diğeri
      // yazılamazsa ortada ya sahibi belirsiz bir rıza ya da olmamış bir işlem
      // raporu kalırdı.
      await this.writeAudit(tx, actor, {
        action: ME_AUDIT_ACTION.consentRecorded,
        entityId: actor.userId,
        after: {
          type: input.type,
          granted: input.granted,
          changed,
          photosMarkedForDeletion: marked,
        },
      });

      return marked;
    });

    this.logger.info(
      { userId: actor.userId, consentType: input.type, granted: input.granted, changed },
      'Rıza kaydı yazıldı',
    );

    return {
      type: input.type,
      granted: input.granted,
      recordedAt: now,
      documentVersion: CONSENT_DOCUMENT_VERSION,
      changed,
      photosMarkedForDeletion,
    };
  }

  // ── VERİ İNDİRME ────────────────────────────────────────────────────────

  /** Bekleyen/hazır talebin durumu. Talep yoksa `NONE`. */
  async getDataExport(userId: string, now: Date = new Date()): Promise<DataExportView> {
    const latest = await this.findLatestExportRequest(userId);
    return { ...describeDataExport(latest, now), linkValidHours: DATA_EXPORT_LINK_HOURS };
  }

  /**
   * Veri indirme talebi açar.
   *
   * ⚠️ 202 döner, dosya DÖNMEZ. Arşivi worker hazırlar ve bağlantıyı
   *    kullanıcıya gönderir; bağlantı 48 saat geçerlidir.
   *
   * ⚠️ Bekleyen talep varken YENİSİ AÇILMAZ, var olan döner. Aksi hâlde
   *    düğmeye üst üste basan tek bir kullanıcı, her biri tüm tablolarını
   *    tarayan onlarca ağır işi kuyruğa koyabilirdi.
   */
  async requestDataExport(actor: MeActor, now: Date = new Date()): Promise<DataExportView> {
    const latest = await this.findLatestExportRequest(actor.userId);

    if (!canRequestDataExport(latest, now)) {
      return { ...describeDataExport(latest, now), linkValidHours: DATA_EXPORT_LINK_HOURS };
    }

    await this.prisma.$transaction(async (tx) => {
      await this.emitOutbox(tx, actor.userId, ME_EVENT.dataExportRequested, {
        userId: actor.userId,
        requestedAt: now.toISOString(),
        linkExpiresAt: dataExportLinkExpiresAt(now).toISOString(),
      });

      await this.writeAudit(tx, actor, {
        action: ME_AUDIT_ACTION.dataExportRequested,
        entityId: actor.userId,
        after: { requestedAt: now.toISOString() },
      });
    });

    this.logger.info({ userId: actor.userId }, 'Veri indirme talebi alındı');

    return {
      status: 'PREPARING',
      requestedAt: now,
      preparedAt: null,
      linkExpiresAt: dataExportLinkExpiresAt(now),
      linkValidHours: DATA_EXPORT_LINK_HOURS,
    };
  }

  // ── HESAP SİLME ─────────────────────────────────────────────────────────

  /**
   * Hesap silme talebi.
   *
   * ⚠️ ANINDA SİLMEZ. `deletionRequestedAt` işaretlenir ve 30 günlük geri alma
   *    penceresi başlar; kullanıcı bu sürede giriş yaparsa talep iptal olur.
   *
   * ⚠️ `User.status` PENDING_DELETION YAPILMAZ ve bu bilinçlidir.
   *    `auth.service.ts` girişte `status !== 'ACTIVE'` olan hesabı reddediyor;
   *    durumu şimdi değiştirseydik kullanıcı geri alma penceresi boyunca giriş
   *    YAPAMAZ, dolayısıyla vazgeçemezdi — pencerenin kendisi anlamsız kalırdı.
   *    Durumu, pencere dolduğunda worker çevirir.
   *
   * ⚠️ SİPARİŞ VE MALİ KAYITLAR SİLİNMEZ, ANONİMLEŞTİRİLİR (bkz.
   *    account-deletion.ts). Muhasebe bütünlüğü kişisel veri talebiyle
   *    bozulamaz; kişiyi işaret eden alanlar takma kimlikle değiştirilir,
   *    tutarlar ve tarihler yerinde kalır. Uygulaması worker işidir.
   */
  async requestAccountDeletion(
    actor: MeActor,
    reason: string | null = null,
    now: Date = new Date(),
  ): Promise<AccountDeletionView> {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, deletionRequestedAt: true },
    });

    if (!user) throw appError('NOT_FOUND', { internalMessage: 'Kullanıcı kaydı bulunamadı' });

    // Zaten açık bir talep varsa ikincisi açılmaz: yeni bir `requestedAt`
    // yazmak geri alma penceresini SIFIRDAN başlatır ve kullanıcının 29 gün
    // önce başlattığı silmeyi sessizce 30 gün daha erteleridi.
    if (user.deletionRequestedAt) {
      const requestedAt = user.deletionRequestedAt;
      return {
        status: 'PENDING_DELETION',
        requestedAt,
        purgeAt: deletionPurgeAt(requestedAt),
        graceDays: DELETION_GRACE_DAYS,
        daysRemaining: remainingGraceDays(requestedAt, now),
        alreadyRequested: true,
        sessionsRevoked: 0,
      };
    }

    const purgeAt = deletionPurgeAt(now);

    const sessionsRevoked = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: actor.userId },
        data: { deletionRequestedAt: now },
      });

      // ⚠️ TÜM OTURUMLAR DÜŞER. Hesabı ele geçiren biri silme talebi açtıysa,
      //    açık kalan oturumundan talebi geri alıp erişimini sürdürebilirdi.
      //    Düşürme aynı transaction'da: talep yazılıp oturumlar kalsaydı bu
      //    tam olarak o senaryo olurdu.
      const revoked = await this.sessions.revokeAllSessions(tx, actor.userId);

      await this.emitOutbox(tx, actor.userId, ME_EVENT.deletionRequested, {
        userId: actor.userId,
        requestedAt: now.toISOString(),
        purgeAt: purgeAt.toISOString(),
        graceDays: DELETION_GRACE_DAYS,
        reason,
      });

      await this.writeAudit(tx, actor, {
        action: ME_AUDIT_ACTION.deletionRequested,
        entityId: actor.userId,
        before: { deletionRequestedAt: null },
        after: { deletionRequestedAt: now.toISOString(), purgeAt: purgeAt.toISOString() },
        reason,
      });

      return revoked;
    });

    this.logger.info(
      { userId: actor.userId, purgeAt: purgeAt.toISOString(), sessionsRevoked },
      'Hesap silme talebi alındı — geri alma penceresi başladı',
    );

    return {
      status: 'PENDING_DELETION',
      requestedAt: now,
      purgeAt,
      graceDays: DELETION_GRACE_DAYS,
      daysRemaining: remainingGraceDays(now, now),
      alreadyRequested: false,
      sessionsRevoked,
    };
  }

  /**
   * SİLME TALEBİNİ GERİ ALIR.
   *
   * ⚠️ BAŞARILI GİRİŞTEN SONRA ÇAĞRILMAK ÜZERE YAZILDI. "Kullanıcı geri alma
   *    penceresinde giriş yaparsa vazgeçmiş sayılır" kuralının karşılığıdır:
   *    ayrı bir "vazgeç" düğmesi aramak zorunda kalan kullanıcı, çoğu zaman
   *    onu bulamaz.
   *    → ENTEGRASYON: `AuthService` başarılı girişte bunu çağırmalı
   *      (bkz. modül raporu).
   *
   * ⚠️ HATA FIRLATMAZ, SONUÇ DÖNER. Girişin akışında çağrıldığı için burada
   *    fırlatılan bir hata, vazgeçilemeyen bir talebi olan kullanıcının GİRİŞİNİ
   *    engellerdi. Yapılamadıysa sebebiyle birlikte bildirilir.
   */
  async cancelAccountDeletion(
    actor: MeActor,
    now: Date = new Date(),
  ): Promise<DeletionCancellationView> {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { deletionRequestedAt: true },
    });

    const decision = evaluateDeletionCancellation(user?.deletionRequestedAt ?? null, now);

    if (!decision.cancellable) {
      return { cancelled: false, reason: decision.reason };
    }

    const requestedAt = user?.deletionRequestedAt ?? null;

    await this.prisma.$transaction(async (tx) => {
      // ⚠️ `deletionRequestedAt: { not: null }` KOŞULU: iki eşzamanlı istek
      //    (giriş + "vazgeç" düğmesi) aynı anda geldiğinde ikincisi hiçbir
      //    satırı güncellemez ve ikinci bir "iptal edildi" olayı yayımlanmaz.
      const result = await tx.user.updateMany({
        where: { id: actor.userId, deletionRequestedAt: { not: null } },
        data: { deletionRequestedAt: null },
      });

      if (result.count === 0) return;

      await this.emitOutbox(tx, actor.userId, ME_EVENT.deletionCancelled, {
        userId: actor.userId,
        cancelledAt: now.toISOString(),
        originallyRequestedAt: requestedAt?.toISOString() ?? null,
      });

      await this.writeAudit(tx, actor, {
        action: ME_AUDIT_ACTION.deletionCancelled,
        entityId: actor.userId,
        before: { deletionRequestedAt: requestedAt?.toISOString() ?? null },
        after: { deletionRequestedAt: null },
      });
    });

    this.logger.info({ userId: actor.userId }, 'Hesap silme talebi geri alındı');

    return { cancelled: true, cancelledAt: now };
  }

  // ── Yardımcılar ─────────────────────────────────────────────────────────

  /**
   * Veri indirme talebinin KAYDI.
   *
   * ⚠️ Talep bugün OutboxEvent satırında yaşıyor; ayrı bir `DataExportRequest`
   *    tablosu YOK (şema değişikliği bu görevin kapsamı dışında — bkz. modül
   *    raporu). Bu yüzden "hazırlandı mı" sorusunun cevabı `publishedAt`
   *    alanından okunuyor: worker olayı aldığında dolar.
   */
  private async findLatestExportRequest(
    userId: string,
  ): Promise<{ requestedAt: Date; publishedAt: Date | null } | null> {
    const event = await this.prisma.outboxEvent.findFirst({
      where: {
        aggregate: OUTBOX_AGGREGATE,
        aggregateId: userId,
        type: ME_EVENT.dataExportRequested,
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, publishedAt: true },
    });

    return event ? { requestedAt: event.createdAt, publishedAt: event.publishedAt } : null;
  }

  /**
   * Rıza kaydına yazılacak IP ve tarayıcı bilgisi.
   *
   * ⚠️ Bağlam okunamazsa rıza yazımı REDDEDİLMEZ. Kullanıcının iradesini
   *    "IP'sini okuyamadık" diye kayda geçirmemek, KVKK açısından delilsiz
   *    kalmaktan çok daha kötüdür: rıza hiç var olmamış olurdu. Eksiklik
   *    "bilinmiyor" olarak AÇIKÇA yazılır ki boş string ile karışmasın.
   */
  private requestFingerprint(): { ipAddress: string; userAgent: string } {
    const context = getContext();
    if (!context) {
      this.logger.warn({}, 'Rıza kaydı istek bağlamı olmadan yazılıyor — IP/UA bilinmiyor');
      return { ipAddress: 'bilinmiyor', userAgent: 'bilinmiyor' };
    }
    return { ipAddress: context.ipAddress, userAgent: context.userAgent };
  }

  /**
   * TRANSACTIONAL OUTBOX (kural 5).
   *
   * ⚠️ Kuyruğa DOĞRUDAN yazılmaz. Transaction geri alınırsa, olmamış bir
   *    silme talebi için hesabı kapatan bir worker tetiklenmiş olurdu.
   */
  private async emitOutbox(
    tx: Tx,
    userId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        aggregate: OUTBOX_AGGREGATE,
        aggregateId: userId,
        type,
        payload: serializeBigInts(payload) as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * DENETİM İZİ (kural 6) — değişiklikle AYNI transaction'da.
   *
   * ⚠️ Kullanıcı kendi verisi üzerinde işlem yapıyor: aktör de, nesne de aynı
   *    kişidir. Buna rağmen kayıt tutuluyor, çünkü "hesabımı sildirmedim"
   *    itirazının tek cevabı bu satırdır.
   *
   * ⚠️ `before`/`after` alanlarına HAM KAYIT konmaz — e-posta, telefon,
   *    fotoğraf anahtarı denetim kaydına kopyalanırsa hassas veri "kim ne
   *    yaptı" günlüğüne sızar ve orada süresiz durur. Yalnızca değişen alanın
   *    adı ve durumu yazılır.
   */
  private async writeAudit(
    tx: Tx,
    actor: MeActor,
    entry: {
      action: string;
      entityId: string;
      before?: Record<string, unknown> | null;
      after?: Record<string, unknown> | null;
      reason?: string | null;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: actor.userId,
        actorRole: actor.role,
        action: entry.action,
        entityType: ENTITY_USER,
        entityId: entry.entityId,
        // ⚠️ `DbNull`, `JsonNull` DEĞİL: "önceki durum yoktu" bir YOKLUKtur,
        //    JSON `null` DEĞERİ değil. JsonNull yazılsaydı sütunda 'null'::jsonb
        //    dururdu ve iki durum birbirinden ayrılamazdı.
        before: entry.before
          ? (serializeBigInts(entry.before) as Prisma.InputJsonValue)
          : Prisma.DbNull,
        after: entry.after
          ? (serializeBigInts(entry.after) as Prisma.InputJsonValue)
          : Prisma.DbNull,
        reason: entry.reason ?? null,
        ipAddress: this.requestFingerprint().ipAddress,
      },
    });
  }
}
