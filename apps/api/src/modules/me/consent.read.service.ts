import { Injectable } from '@nestjs/common';
import type { ConsentType } from '@vt/contracts';
import { PrismaService } from '../../infra/prisma.service.js';
import type { ConsentReadSurface } from './me.ports.js';

/**
 * RIZA OKUMA YÜZEYİ — DİĞER MODÜLLER İÇİN.
 *
 * `ConsentRecord` bu modülün tablosudur. Medya ve sanal deneme modülleri bugün
 * ona KENDİ geçici Prisma köprüleriyle erişiyor, çünkü yayımlanmış bir okuma
 * yüzeyi yoktu. Bu sınıf o yüzeydir.
 *
 * ⚠️ ENTEGRASYON AJANI İÇİN:
 *      media/index.ts   → `MEDIA_CONSENT` token'ını buna bağla, ardından
 *                         `PrismaMediaConsentBridge` SİLİNEBİLİR.
 *      ai/index.ts      → `CONSENT_PORT` token'ını buna bağla, ardından oradaki
 *                         rıza köprüsü SİLİNEBİLİR.
 *    İmzalar yapısal olarak birebir uyuyor; uyarlama katmanı gerekmez.
 *
 * ⚠️ İKİ FARKLI SORU, İKİ FARKLI METOT — ve bu bilinçli:
 *      `findRecords`      → "tüm kayıtları ver", kararı çağıran verir. Sanal
 *                           deneme hangi rızanın eksik olduğunu ayırt etmek
 *                           zorunda (CONSENT_REQUIRED vs CONSENT_CROSS_BORDER_
 *                           REQUIRED), tek bir boolean ona yetmez.
 *      `hasActiveConsent` → "izin var mı", tek soru tek cevap.
 *
 * ⚠️ HER İKİSİ DE "EN SON KAYIT" MANTIĞIYLA ÇALIŞIR. "granted=true satırı var
 *    mı" diye sorulsaydı, rızasını geri çekmiş kullanıcının fotoğrafı işlenmeye
 *    devam ederdi: geri çekme eski satırı SİLMEZ, yenisini ekler.
 */
@Injectable()
export class MeConsentService implements ConsentReadSurface {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * İstenen türlerdeki TÜM kayıtlar (append-only geçmiş).
   * Sıralama en yeniden eskiye; karar kuralları `consent.rules.ts` içinde.
   */
  async findRecords(
    userId: string,
    types: readonly ConsentType[],
  ): Promise<{ type: ConsentType; granted: boolean; createdAt: Date }[]> {
    return this.prisma.consentRecord.findMany({
      where: { userId, type: { in: [...types] } },
      select: { type: true, granted: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Tek tür için geçerli durum — EN SON satır. */
  async hasActiveConsent(userId: string, type: ConsentType): Promise<boolean> {
    const latest = await this.prisma.consentRecord.findFirst({
      where: { userId, type },
      orderBy: { createdAt: 'desc' },
      select: { granted: true },
    });
    return latest?.granted === true;
  }
}
