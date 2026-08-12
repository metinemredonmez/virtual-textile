import { appError, REQUIRED_TRYON_CONSENTS } from '@vt/contracts';
import { aiBudgetFromEnv, checkBudget, env, TRYON } from '@vt/config';
import type { PrismaService } from '../../infra/prisma.service.js';
import type { Logger } from '../../common/logger.js';
import { evaluateTryOnConsent } from './consent.rules.js';
import type { ConsentPort } from './ai.ports.js';

/**
 * SANAL DENEME ÖN KAPILARI — TEK ÜRÜN VE KOMBİN İÇİN ORTAK
 *
 * ⚠️ Bu dosyanın varlık sebebi kural 6'dır: "AI çağrısı öncesi RIZA ve KOTA
 *    kontrolü ATLANAMAZ". Çoklu ürün denemesi ikinci bir giriş kapısı açtı;
 *    kapıların mantığı iki yerde yaşasaydı biri güncellenip diğeri unutulurdu
 *    ve unutulan taraf sessizce rızasız üretim yapardı.
 *
 * Buradaki fonksiyonlar veri OKUR ve KARAR VERİR; hiçbir şey yazmaz.
 * Rıza kararının kendisi yine `consent.rules.ts`tedir — burada yalnızca
 * uygulanır.
 */

/** ⚠️ Rıza kontrolü. Kararı `consent.rules.ts` verir; burada yalnızca uygulanır. */
export async function assertTryOnConsent(
  consents: ConsentPort,
  logger: Logger,
  userId: string,
): Promise<void> {
  const records = await consents.findRecords(userId, REQUIRED_TRYON_CONSENTS);
  const decision = evaluateTryOnConsent(records);

  if (!decision.allowed) {
    // Reddedilen istek de loglanır: rızasız işleme girişiminin denetlenebilir
    // olması gerekir (ve bir hata varsa erken görülür).
    logger.warn(
      { userId, missingConsent: decision.missing },
      'Sanal deneme rıza eksikliği nedeniyle reddedildi',
    );
    throw appError(decision.code);
  }
}

export async function loadOwnPhoto(
  prisma: PrismaService,
  photoId: string,
  userId: string,
): Promise<{ id: string; contentHash: string }> {
  const photo = await prisma.userPhoto.findFirst({
    where: {
      id: photoId,
      // ⚠️ Sahiplik, süre ve silinmişlik TEK sorguda: ayrı kontrol edilirse
      // araya giren bir silme işlemiyle yarış oluşur.
      userId,
      deletedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, contentHash: true, qualityScore: true, qualityIssues: true },
  });

  if (!photo) throw appError('PHOTO_NOT_FOUND');

  // Kalitesiz fotoğrafta üretim neredeyse kesin başarısız olur; parayı
  // harcamadan önce kullanıcıya somut nedeni söylüyoruz.
  if (photo.qualityScore !== null && photo.qualityScore < TRYON.minPhotoQualityScore) {
    const issues = Array.isArray(photo.qualityIssues) ? photo.qualityIssues.join(', ') : 'düşük';
    throw appError('PHOTO_QUALITY_LOW', { params: { reason: issues } });
  }

  return { id: photo.id, contentHash: photo.contentHash };
}

/**
 * KOTA VE BÜTÇE
 *
 * İki ayrı koruma: kullanıcı kotası kötüye kullanımı, platform bütçesi ise
 * toplam gideri sınırlar. İkincisi aşıldığında AI kapanır ama TİCARET AKIŞI
 * ETKİLENMEZ — kullanıcı yine gezer, sepete atar, satın alır.
 *
 * ⚠️ `units` — KOMBİN KARARI. Çoklu deneme tek deneme SAYILMAZ: kota, açılacak
 *    üretim sayısı kadar düşer (bkz. multi-tryon.service.ts → kota gerekçesi).
 *
 * ⚠️ `projectedMicroUsd` — çok adımlı istekler için ÖN PROJEKSİYON. Tek ürün
 *    akışında verilmez ve davranış birebir korunur: orada tek çağrılık maliyet
 *    tavanı zaten bir sonraki istekte yakalanır. Beş adımlık bir zincirde ise
 *    üçüncü adımda bütçenin dolması, ödenmiş iki adımı çöpe atmak demektir —
 *    o yüzden zincir BAŞLAMADAN önce toplam maliyet hesaba katılır.
 */
export async function assertTryOnQuotaAndBudget(
  prisma: PrismaService,
  logger: Logger,
  input: { userId: string; units: number; projectedMicroUsd?: bigint },
): Promise<void> {
  const budget = aiBudgetFromEnv(env());
  const now = new Date();
  const dayStart = startOfLocalDay(now);
  const monthStart = startOfLocalMonth(now);

  const [used, todaySpend, monthSpend] = await Promise.all([
    consumedQuotaToday(prisma, input.userId, dayStart),
    prisma.aiUsageLog.aggregate({
      _sum: { costMicroUsd: true },
      where: { createdAt: { gte: dayStart } },
    }),
    prisma.aiUsageLog.aggregate({
      _sum: { costMicroUsd: true },
      where: { createdAt: { gte: monthStart } },
    }),
  ]);

  // ⚠️ `used + units > limit`: kısmen sığan bir istek KABUL EDİLMEZ. Kalan hakkı
  //    3 iken 5 parçalı kombin başlatmak, üç katman giydirip dördüncüde kotaya
  //    takılmak demektir — kullanıcı hem hakkını hem de yarım bir görsel için
  //    ödenen parayı kaybeder.
  if (used + input.units > budget.perUserDailyTryOn) {
    throw appError('TRYON_QUOTA_EXCEEDED', {
      params: { used, limit: budget.perUserDailyTryOn },
    });
  }

  const projected = input.projectedMicroUsd ?? 0n;
  const decision = checkBudget(budget, {
    todayMicroUsd: (todaySpend._sum.costMicroUsd ?? 0n) + projected,
    thisMonthMicroUsd: (monthSpend._sum.costMicroUsd ?? 0n) + projected,
  });

  if (!decision.allowed) {
    logger.error({ reason: decision.reason }, 'AI bütçesi doldu — üretim durduruldu');
    throw appError('AI_BUDGET_EXCEEDED');
  }

  if (decision.warnAtRatio !== undefined) {
    logger.warn({ ratio: decision.warnAtRatio }, 'AI günlük bütçe eşiği aşıldı');
  }
}

/**
 * KOTA SAYIMI — ve dolaylı olarak KOTA İADESİ.
 *
 * ⚠️ Ayrı bir sayaç tutulmuyor. Kota, "bugün açılmış ve başarısız OLMAMIŞ"
 *    işlerin sayısıdır. Böylece bir iş FAILED'a düştüğü anda kota kendiliğinden
 *    geri verilmiş olur — worker çökse, süreç yarıda kesilse bile.
 *    Sayaç artırıp azaltan bir tasarımda, azaltma adımı kaçırıldığında
 *    kullanıcı hakkını kalıcı olarak kaybederdi.
 *
 * ⚠️ Kombinde her KATMAN ayrı bir TryOnJob satırıdır; dolayısıyla bu sayım
 *    çoklu denemede kendiliğinden "parça başına" çalışır ve düşen bir katman
 *    yalnızca kendi hakkını iade eder.
 */
export async function consumedQuotaToday(
  prisma: PrismaService,
  userId: string,
  dayStart: Date,
): Promise<number> {
  return prisma.tryOnJob.count({
    where: {
      userId,
      queuedAt: { gte: dayStart },
      status: { in: ['QUEUED', 'RUNNING', 'SUCCEEDED'] },
    },
  });
}

/**
 * Gün ve ay sınırı Türkiye saatine göre hesaplanır (UTC+3, yaz saati yok).
 *
 * ⚠️ UTC kullanılsaydı kullanıcının günlük hakkı gece 03:00'te yenilenirdi;
 *    "yarın tekrar deneyin" mesajı yanlış olurdu.
 */
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

export function startOfLocalDay(now: Date): Date {
  const shifted = new Date(now.getTime() + TR_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - TR_OFFSET_MS);
}

export function startOfLocalMonth(now: Date): Date {
  const shifted = new Date(now.getTime() + TR_OFFSET_MS);
  shifted.setUTCDate(1);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - TR_OFFSET_MS);
}
