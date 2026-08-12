/**
 * HESAP SİLME — SAF ÇEKİRDEK
 *
 * ⚠️ SİLME TALEBİ ANINDA SİLMEZ. `User.deletionRequestedAt` işaretlenir ve
 *    `PHOTO_RETENTION.accountDeletionGraceDays` kadar bir GERİ ALMA PENCERESİ
 *    başlar.
 *
 *    NEDEN: hesap silme geri alınamaz. Kullanıcıların önemli bir kısmı öfkeyle,
 *    yanlışlıkla ya da ele geçirilmiş bir oturumdan siler. Anında silme, hesabı
 *    çalan saldırgana da "izini sil" düğmesi verirdi.
 *
 * ⚠️ SİPARİŞ VE MALİ KAYITLAR SİLİNMEZ, ANONİMLEŞTİRİLİR.
 *    Sipariş, fatura, muhasebe kaydı ve LedgerEntry satırları kullanıcıya değil
 *    ŞİRKETE ait yasal kayıtlardır (VUK/TTK: 10 yıl saklama). Silinirlerse
 *    defter tutmaz, satıcı hakedişleri açıklanamaz ve geçmiş dönem raporları
 *    değişir. Yapılacak olan, kişiyi işaret eden alanların (ad, e-posta,
 *    telefon, adres) yerine geri döndürülemez bir takma kimlik yazılmasıdır;
 *    tutarlar ve tarihler yerinde kalır.
 *    → Uygulaması WORKER işidir (grace period dolduğunda), burada yapılmaz.
 *
 * Saf fonksiyonlar — saat dışarıdan verilir ki test beklemesin.
 */
import { PHOTO_RETENTION } from '@vt/config';

/** Talebin geri alınabildiği gün sayısı. */
export const DELETION_GRACE_DAYS = PHOTO_RETENTION.accountDeletionGraceDays;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Verilerin gerçekten silineceği/anonimleştirileceği an.
 * Bu ana kadar kullanıcı vazgeçebilir.
 */
export function deletionPurgeAt(requestedAt: Date, graceDays: number = DELETION_GRACE_DAYS): Date {
  return new Date(requestedAt.getTime() + graceDays * DAY_MS);
}

export type DeletionCancellation =
  | { cancellable: true; purgeAt: Date; remainingMs: number }
  | { cancellable: false; reason: 'NO_REQUEST' | 'GRACE_EXPIRED'; purgeAt: Date | null };

/**
 * Bekleyen bir silme talebi geri alınabilir mi?
 *
 * ⚠️ SINIRDA FAIL-CLOSED: `now === purgeAt` anında geri alma REDDEDİLİR.
 *    O anda worker silme/anonimleştirme turunu çoktan başlatmış olabilir;
 *    "geri aldın" deyip yarısı silinmiş bir hesabı geri vermek, kullanıcıya
 *    tutulamayacak bir söz vermektir. Belirsizlikte kullanıcıya "talep zaten
 *    işlendi" demek, sessizce bozuk bir hesap teslim etmekten iyidir.
 */
export function evaluateDeletionCancellation(
  requestedAt: Date | null,
  now: Date,
  graceDays: number = DELETION_GRACE_DAYS,
): DeletionCancellation {
  if (!requestedAt) {
    return { cancellable: false, reason: 'NO_REQUEST', purgeAt: null };
  }

  const purgeAt = deletionPurgeAt(requestedAt, graceDays);
  const remainingMs = purgeAt.getTime() - now.getTime();

  if (remainingMs <= 0) {
    return { cancellable: false, reason: 'GRACE_EXPIRED', purgeAt };
  }

  return { cancellable: true, purgeAt, remainingMs };
}

/**
 * Kullanıcıya gösterilecek kalan gün sayısı — YUKARI yuvarlanır.
 *
 * "0 gün kaldı" yazan bir arayüzde hâlâ 6 saatlik hakkı olduğunu kimse
 * anlamaz; kullanıcı lehine yuvarlanır.
 */
export function remainingGraceDays(
  requestedAt: Date | null,
  now: Date,
  graceDays: number = DELETION_GRACE_DAYS,
): number {
  const decision = evaluateDeletionCancellation(requestedAt, now, graceDays);
  return decision.cancellable ? Math.ceil(decision.remainingMs / DAY_MS) : 0;
}
