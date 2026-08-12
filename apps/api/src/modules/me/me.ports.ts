/**
 * "HESABIM" MODÜLÜNÜN DIŞ YÜZEYLERİ
 *
 * Bu modülün SAHİP OLDUĞU veri, kullanıcının kendi KVKK yüzeyidir:
 *   • `ConsentRecord` (rıza geçmişi)
 *   • `User.deletionRequestedAt` (silme talebi)
 *
 * Sahip OLMADIĞI ama dokunması gereken veriler porta bağlanır (kural 3):
 *   • `UserPhoto`  → MEDYA modülü. Rıza geri çekilince saklama süresi geçmişe
 *                    çekilir; satırı MEDYA yazar, kararı BİZ veririz.
 *   • `Session`    → KİMLİK modülü. Silme talebinde tüm oturumlar düşürülür.
 *   • `TryOnJob`   → AI modülü. Hiç dokunulmuyor: türetilmiş çıktıları
 *                    `PhotoRetentionJob` kaynak fotoğrafla birlikte temizler.
 *
 * ⚠️ HER İKİ PORT DA `tx` ALIR VE BU BİLİNÇLİDİR.
 *    Rıza satırı ile fotoğrafın işaretlenmesi, silme talebi ile oturumların
 *    düşürülmesi AYNI transaction'da olmak zorundadır. Ayrı yazılsalardı iki
 *    sessiz felaket doğardı:
 *      - rıza geri çekilir, fotoğraf işaretlenmez → rızasız veri elde kalır;
 *      - silme talebi yazılır, oturumlar düşmez   → hesabı ele geçiren kişi
 *        silme talebini tarayıcıda geri alabilir.
 */
import type { ConsentType } from '@vt/contracts';
import type { Prisma } from '@vt/db';

export type Tx = Prisma.TransactionClient;

// ══════════════════════════ FOTOĞRAF SAKLAMA ═══════════════════════════════

export const ME_RETENTION = 'ME_RETENTION_PORT';

export interface MeRetentionPort {
  /**
   * Kullanıcının silinmemiş fotoğraflarının `expiresAt` değerini verilen ana
   * çeker ve etkilenen satır sayısını döndürür.
   *
   * ⚠️ SENKRON SİLME DEĞİL, İŞARETLEME. Depodan silmeyi ve türetilmiş try-on
   *    çıktılarının temizliğini `PhotoRetentionJob` yapar. Burada nesne silmek,
   *    HTTP isteğini yavaş ve kırılgan bir depo işine bağlamak olurdu: depo
   *    çağrısı düşerse rıza geri çekme işlemi de düşerdi.
   */
  expireUserPhotos(tx: Tx, userId: string, expiresAt: Date): Promise<number>;
}

// ══════════════════════════ OTURUMLAR ══════════════════════════════════════

export const ME_SESSIONS = 'ME_SESSIONS_PORT';

export interface MeSessionPort {
  /**
   * Kullanıcının açık TÜM oturumlarını düşürür, düşen oturum sayısını döndürür.
   *
   * ⚠️ Access token'lar iptal edilemez ama oturum edilebilir: `JwtAuthGuard`
   *    her istekte `isSessionActive` sorar, dolayısıyla kalan 15 dakikalık
   *    ömür kullanılamaz.
   */
  revokeAllSessions(tx: Tx, userId: string): Promise<number>;
}

// ══════════════════════════ YAYIMLANAN YÜZEY ═══════════════════════════════

/**
 * RIZA OKUMA YÜZEYİ — DİĞER MODÜLLER İÇİN.
 *
 * ⚠️ ENTEGRASYON AJANI İÇİN: `media.bridges.ts` içindeki
 *    `PrismaMediaConsentBridge` ve `ai.bridges`/`ai/index.ts` içindeki rıza
 *    köprüsü bu yüzeyin yokluğunda yazılmış GEÇİCİ köprülerdir. `MeConsentService`
 *    her ikisinin de imzasını yapısal olarak karşılar; `MEDIA_CONSENT` ve
 *    `CONSENT_PORT` token'ları ona bağlanınca o köprüler SİLİNEBİLİR.
 */
export interface ConsentReadSurface {
  /** Sanal denemenin kullandığı biçim: karar veren taraf kuralları kendi uygular. */
  findRecords(
    userId: string,
    types: readonly ConsentType[],
  ): Promise<{ type: ConsentType; granted: boolean; createdAt: Date }[]>;

  /** Medyanın kullandığı biçim: "EN SON kayıt granted mı". */
  hasActiveConsent(userId: string, type: ConsentType): Promise<boolean>;
}
