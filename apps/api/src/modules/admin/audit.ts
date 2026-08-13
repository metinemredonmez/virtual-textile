/**
 * DENETİM İZİ (AuditLog) — yönetim modülünün omurgası.
 *
 * ⚠️ APPEND-ONLY. Kayıt güncellenmez, silinmez.
 *
 * ⚠️ AYNI TRANSACTION KURALI: denetim kaydı, denetlediği değişiklikle aynı
 *    transaction'da yazılır. Ayrı yazılsaydı iki başarısızlık modu doğardı:
 *      - değişiklik yazılır, denetim yazılmaz → kim yaptığı ebediyen kayıp;
 *      - denetim yazılır, değişiklik geri alınır → olmamış bir işlem raporlanır.
 *    Denetim yazılamıyorsa değişiklik de yapılmamalıdır.
 *
 * ⚠️ `before`/`after` alanlarına HAM KAYIT konulmaz. Şifreli sütunlar
 *    (ibanEnc, taxNumberEnc), fotoğraf anahtarları ve iletişim bilgileri
 *    denetim kaydına kopyalanırsa, hassas veri "kimin ne yaptığı" günlüğüne
 *    sızar ve orada süresiz durur. Çağıran taraf yalnızca DEĞİŞEN alanları
 *    verir; `redactSensitive` kalan bilinen riskli anahtarları temizler.
 */

// `Prisma` değer olarak da gerekiyor (Prisma.JsonNull) — tip-only import yetmez.
import { Prisma, serializeBigInts } from '@vt/db';
import type { Role } from '@vt/db';
import type { JwtPayload } from '@vt/contracts';
import { getContext } from '../../common/request-context.js';

type Tx = Prisma.TransactionClient;

/** Denetim kaydına yazılacak aktör. IP istek bağlamından gelir. */
export interface AdminActor {
  readonly id: string;
  readonly role: Role;
  readonly ipAddress: string;
}

/**
 * Aktörü token'dan ve istek bağlamından kurar.
 *
 * Rol TOKEN'dan okunur, veritabanından değil: yetki kararı zaten token ile
 * verildi; denetim kaydı da o kararın dayanağını göstermeli.
 */
export function adminActor(user: JwtPayload): AdminActor {
  const context = getContext();
  return {
    id: user.sub,
    role: user.role as Role,
    // Bağlam yoksa (ör. arka plan işi) IP bilinmez; boş bırakmak yerine
    // açıkça işaretlenir ki "IP kaydı yok" ile "IP 0.0.0.0" karışmasın.
    ipAddress: context?.ipAddress ?? 'bilinmiyor',
  };
}

/** Denetlenen işlem türleri — serbest metin yerine sabit liste. */
export const AUDIT_ACTION = {
  sellerApproved: 'seller.approved',
  sellerRejected: 'seller.rejected',
  sellerSuspended: 'seller.suspended',
  sellerReinstated: 'seller.reinstated',
  productApproved: 'product.moderation.approved',
  productRejected: 'product.moderation.rejected',
  categoryCreated: 'category.created',
  categoryUpdated: 'category.updated',
  couponCreated: 'coupon.created',
  couponDeactivated: 'coupon.deactivated',
  commissionRuleCreated: 'commission.rule.created',
  commissionVersionCreated: 'commission.rule.version.created',
  orderRefundRequested: 'order.refund.manual.requested',
  payoutApproved: 'payout.approved',
  payoutRejected: 'payout.rejected',
  photoBreakGlass: 'user.photo.break_glass_access',
  /**
   * Site içeriği — vitrin afişi, kategori/koleksiyon kapağı.
   *
   * ⚠️ Denetleniyor çünkü bu kayıtlar SİTENİN YÜZÜNÜ değiştirir: afişi kimin
   *    ne zaman değiştirdiği, "ana sayfada bu neden duruyor" sorusunun tek
   *    cevabıdır. `storageKey` kayda yazılmaz — `SENSITIVE_KEYS` onu zaten
   *    gizliyor ve gerek de yok: hangi görsel olduğunu `entityId` taşıyor.
   */
  siteImageCreated: 'site.image.created',
  siteImageUpdated: 'site.image.updated',
  siteImageDeleted: 'site.image.deleted',
  siteImageCardAdded: 'site.image.card.added',
  siteImageCardRemoved: 'site.image.card.removed',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

export interface AuditEntry {
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  /** Değişiklik ÖNCESİ — yalnızca değişen alanlar. */
  readonly before?: Record<string, unknown> | null;
  /** Değişiklik SONRASI — yalnızca değişen alanlar. */
  readonly after?: Record<string, unknown> | null;
  /** Break-glass ve para hareketlerinde ZORUNLU gerekçe. */
  readonly reason?: string | null;
}

/**
 * Denetim kaydına asla girmemesi gereken alan adları.
 * Yeni bir şifreli/hassas sütun eklendiğinde buraya da eklenmelidir.
 */
const SENSITIVE_KEYS = new Set([
  'ibanEnc',
  'iban',
  'taxNumberEnc',
  'taxNumber',
  'passwordHash',
  'password',
  'refreshTokenHash',
  'cardToken',
  'cardMask',
  'storageKey',
  'photoKeys',
  'contentHash',
  'embedding',
]);

export function redactSensitive(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEYS.has(key) ? '[gizlendi]' : entry;
  }
  return output;
}

/**
 * Denetim kaydını ÇAĞIRANIN transaction'ı içinde yazar.
 *
 * ⚠️ `serializeBigInts`: para alanları bigint'tir ve Prisma Json sütununa
 *    doğrudan yazılamaz (JSON.stringify bigint'i serileştiremez). String'e
 *    çevriliyor — Number'a değil, çünkü 2^53 üstü kuruş tutarları bozulur.
 */
export async function writeAuditLog(tx: Tx, actor: AdminActor, entry: AuditEntry): Promise<void> {
  const before = redactSensitive(entry.before);
  const after = redactSensitive(entry.after);

  await tx.auditLog.create({
    data: {
      actorId: actor.id,
      actorRole: actor.role,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      // ⚠️ `DbNull`, `JsonNull` DEĞİL. Yaratma işleminde "önceki durum" diye bir
      // şey YOKTUR; bu bir yokluktur, JSON `null` DEĞERİ değil. JsonNull
      // yazılsaydı sütunda 'null'::jsonb dururdu ve "kayıt yoktu" ile "değer
      // null'dı" birbirinden ayrılamazdı.
      before: before === null ? Prisma.DbNull : (serializeBigInts(before) as Prisma.InputJsonValue),
      after: after === null ? Prisma.DbNull : (serializeBigInts(after) as Prisma.InputJsonValue),
      reason: entry.reason ?? null,
      ipAddress: actor.ipAddress,
    },
  });
}

/**
 * TRANSACTIONAL OUTBOX'a yan etki yazar.
 *
 * ⚠️ Kuyruğa DOĞRUDAN yazılmaz. Transaction geri alınırsa olmamış bir işlem
 *    için bildirim/para hareketi tetiklenmiş olurdu.
 */
export async function emitOutbox(
  tx: Tx,
  event: {
    aggregate: string;
    aggregateId: string;
    type: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      aggregate: event.aggregate,
      aggregateId: event.aggregateId,
      type: event.type,
      payload: serializeBigInts(event.payload) as Prisma.InputJsonValue,
    },
  });
}
