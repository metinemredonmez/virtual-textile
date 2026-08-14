import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type Redis from 'ioredis';
import type { PrismaClient } from '@vt/db';
import type { Logger } from 'pino';
import { SIGNED_URL_TTL_SECONDS, TRYON, isTryOnSupported } from '@vt/config';
import {
  generateWithFallback,
  isPermanentFailure,
  storageKeys,
  type StorageProvider,
  type TryOnChainResult,
  type TryOnFailureReason,
  type TryOnGarmentCategory,
  type TryOnProvider,
  visibilityForKey,
} from '@vt/adapters';
import { CONCURRENCY, QUEUE, type TryOnJobData } from '../queues.js';

/**
 * SANAL DENEME İŞLEYİCİSİ
 *
 * ⚠️ KUYRUK RETRY'I KAPALIDIR (queues.ts → attempts: 1). Yeniden deneme
 *    mantığı işin İÇİNDE, `generateWithFallback()` zincirinde yürür. BullMQ de
 *    denerse "fotoğrafta kişi yok" gibi kalıcı hatalar üç kez daha para yakar.
 *
 * ⚠️ BUNUN SONUCU: bu fonksiyon fırlatırsa iş bir daha ÇALIŞMAZ. Dolayısıyla
 *    her çıkış yolunda iş terminal bir duruma yazılmalı ve kota iade edilmeli.
 *    Bu yüzden gövde baştan sona try/catch ile sarılıdır — beklenmedik bir
 *    istisna işi sonsuza dek RUNNING'de bırakırsa kullanıcı hakkını kaybeder.
 */

export const TRYON_PROVIDERS = 'TRYON_PROVIDERS';
export const TRYON_WATERMARKER = 'TRYON_WATERMARKER';
export const TRYON_URL_ISSUER = 'TRYON_URL_ISSUER';
export const TRYON_STORAGE = 'TRYON_STORAGE';

// ── Filigran ──────────────────────────────────────────────────────────────

/**
 * ⚠️ YASAL ZORUNLULUK: üretilen her görsel, yapay zekâ ile oluşturulduğunu
 *    belirten uyarıyı TAŞIMAK ZORUNDADIR.
 *
 * Uyarı PİKSELİN İÇİNE gömülür. CSS overlay veya ayrı bir katman YETMEZ:
 * kullanıcı görsele sağ tıklayıp kaydettiğinde, ekran görüntüsü alıp
 * paylaştığında ya da API'den doğrudan çektiğinde uyarı kaybolur — oysa
 * görselin yanlış anlaşılma riski tam da o an başlar.
 */
export interface ImageWatermarker {
  embed(image: Buffer, text: string): Promise<{ image: Buffer; contentType: string }>;
}

/**
 * ⚠️ ARTIK BAĞLAMADA KULLANILMIYOR — gerçek uygulama
 *    `tryon.watermarker.ts` → `SharpWatermarker`dır ve `worker.module.ts`
 *    koşulsuz onu bağlar.
 *
 * Dışa açık kalıyor çünkü testlerin "filigran bileşeni yokken iş ne olur"
 * senaryosunu (başarısız yazılır, kota iade edilir) kurabilmesi gerekiyor.
 *
 * ⚠️ Sessizce filigransız kaydetmek seçenek değildir: uyarı taşımayan bir
 *    üretim görselinin kullanıcıya ulaşması, hiç görsel üretmemekten daha
 *    kötüdür. Fail-closed davranış bilinçli bir karardır.
 */
export class UnavailableWatermarker implements ImageWatermarker {
  embed(): Promise<{ image: Buffer; contentType: string }> {
    return Promise.reject(new Error('Filigran bileşeni bağlanmadı — görsel kaydedilmedi'));
  }
}

// ── Sağlayıcıya verilen girdi adresleri ───────────────────────────────────

export interface IssuedUrl {
  url: string;
  /** Çağrı bittiğinde erişimi kapatır — başarı da başarısızlık da olsa. */
  revoke(): Promise<void>;
}

export interface ProviderInputUrlIssuer {
  issue(key: string): Promise<IssuedUrl>;
}

/**
 * İMZALI, KISA ÖMÜRLÜ, TEK KULLANIMLIK GİRDİ ADRESİ
 *
 * Sağlayıcı fotoğrafı bizim depomuzdan çeker; ona kalıcı bir bağlantı
 * verilmez. Üç katman:
 *  1. İmza      — anahtar bilinse bile imzasız erişilemez.
 *  2. Kısa ömür — `SIGNED_URL_TTL_SECONDS.aiProviderInput` (10 dk).
 *  3. Tek kullanım — Redis'teki nonce kaydı; çağrı biter bitmez SİLİNİR.
 *
 * ⚠️ Üçüncü katmanın zorlanması medya proxy ucunu gerektirir (nonce'u doğrulayıp
 *    ilk kullanımda düşürür). O uç yazılana kadar fiilî güvence 1 + 2'dir ve
 *    `revoke()` yalnızca kaydı temizler.
 *    // TODO(medya-proxy): /internal/ai-input/:nonce ucu yazılmalı.
 */
export class SignedUrlIssuer implements ProviderInputUrlIssuer {
  constructor(
    private readonly storage: StorageProvider,
    private readonly redis: Redis,
  ) {}

  async issue(key: string): Promise<IssuedUrl> {
    const ttl = SIGNED_URL_TTL_SECONDS.aiProviderInput;
    const nonce = randomUUID();

    /**
     * ⚠️ GÖRÜNÜRLÜK ANAHTARDAN TÜRETİLİR — SABİT `'private'` YAZILAMAZ.
     *
     *  Burada `visibility: 'private'` sabitti ve HER SANAL DENEMEYİ
     *  DÜŞÜRÜYORDU. Bu fonksiyon İKİ anahtar için çağrılıyor:
     *
     *      kullanıcı fotoğrafı  user-photos/…      → private  ✓
     *      ÜRÜN GÖRSELİ         products/…         → PUBLIC   ✗
     *
     *  `assertVisibilityMatchesKey` public bir anahtar için private istendiğinde
     *  ATIYOR ("kova karışması engellendi") — ve bu koruma DOĞRU, hata çağıran
     *  taraftaydı. Sonuç: iş sağlayıcıya HİÇ ULAŞMADAN düşüyordu.
     *
     *  ⚠️ VERİTABANI BUNU SÖYLÜYORDU AMA OKUNMASI GEREKİYORDU:
     *         status=FAILED · provider=NULL · latencyMs=NULL
     *     `provider` boşsa hiçbir sağlayıcı çağrılmamıştır; hata sağlayıcıda
     *     değil ÖNCESİNDEDİR. `TRYON_PROVIDER_ERROR` kodu yanıltıcıydı.
     *
     * ⚠️ İMZALI URL PUBLIC KOVA İÇİN DE DOĞRU TERCİH: alternatif `publicUrl()`
     *    ve o r2.dev adresini üretiyor — ölçüldü, r2.dev 8 istekte 8 zaman
     *    aşımı veriyor (bkz. media-public.controller.ts). fal.ai o adresten
     *    görseli çekemezdi. İmzalı S3 adresi hem erişilebilir hem süreli.
     */
    const url = await this.storage.signedUrl({
      key,
      visibility: visibilityForKey(key),
      operation: 'get',
      expiresInSeconds: ttl,
    });

    await this.redis.set(`tryon:input:${nonce}`, key, 'EX', ttl);

    return {
      url,
      revoke: async () => {
        await this.redis.del(`tryon:input:${nonce}`);
      },
    };
  }
}

// ── Sonuç ─────────────────────────────────────────────────────────────────

export interface TryOnProcessOutcome {
  jobId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'FAILED_PERMANENT' | 'SKIPPED';
  reason?: string;
}

/** Rıza kontrolünde bakılan türler — API tarafıyla aynı sözleşme. */
const REQUIRED_CONSENTS = ['PHOTO_PROCESSING', 'CROSS_BORDER_TRANSFER'] as const;

/** Kalıcı sağlayıcı hatalarının katalog karşılığı — kullanıcıya bu kod gider. */
const FAILURE_ERROR_CODE: Record<TryOnFailureReason, string> = {
  INVALID_INPUT: 'PHOTO_QUALITY_LOW',
  CONTENT_BLOCKED: 'TRYON_CONTENT_BLOCKED',
  NO_PERSON_DETECTED: 'PHOTO_NO_PERSON',
  PROVIDER_ERROR: 'TRYON_PROVIDER_ERROR',
  TIMEOUT: 'TRYON_TIMEOUT',
  RATE_LIMITED: 'TRYON_PROVIDER_ERROR',
  QUOTA_EXCEEDED: 'AI_BUDGET_EXCEEDED',
  // ⚠️ Kök neden BİZDE (anahtar/izin). Kullanıcı mesajı TRYON_PROVIDER_ERROR
  //    ile aynı şeyi söyler ama kod ayrıdır: alarm kuralı "sağlayıcı arızası"
  //    ile "bizim yapılandırmamız bozuk"u ayırt edebilmeli.
  MISCONFIGURED: 'TRYON_PROVIDER_MISCONFIGURED',
};

@Injectable()
export class TryOnProcessor implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<TryOnJobData>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly connection: Redis,
    private readonly providers: readonly TryOnProvider[],
    private readonly watermarker: ImageWatermarker,
    private readonly storage: StorageProvider,
    private readonly urls: ProviderInputUrlIssuer,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<TryOnJobData>(
      QUEUE.TRYON,
      async (job: Job<TryOnJobData>) => this.process(job.data),
      {
        connection: this.connection,
        // Dış API hız limitine takılmamak için düşük tutulur.
        concurrency: CONCURRENCY[QUEUE.TRYON],
      },
    );

    this.worker.on('failed', (job, error) => {
      // ⚠️ Buraya düşmek beklenmez: `process()` kendi hatalarını yutar ve işi
      // terminal duruma yazar. Düşülüyorsa altyapı seviyesinde bir sorun var.
      this.logger.error(
        { jobId: job?.data.tryOnJobId, err: error },
        'Try-on işi işlenemedi — kota iadesi doğrulanmalı',
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  async process(data: TryOnJobData): Promise<TryOnProcessOutcome> {
    // ── İşi sahiplen ────────────────────────────────────────────────────
    // ⚠️ Outbox teslimatı EN AZ BİR KEZ'dir; aynı iş iki kez gelebilir.
    // Koşullu güncelleme, ikinci teslimatın üretimi tekrarlamasını engeller:
    // yalnızca QUEUED durumundaki işi RUNNING'e çeviren kazanır.
    const claimed = await this.prisma.tryOnJob.updateMany({
      where: { id: data.tryOnJobId, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
    });

    if (claimed.count === 0) {
      this.logger.debug({ tryOnJobId: data.tryOnJobId }, 'Try-on işi zaten alınmış, atlanıyor');
      return { jobId: data.tryOnJobId, status: 'SKIPPED', reason: 'ALREADY_CLAIMED' };
    }

    const startedAt = Date.now();
    let chain: TryOnChainResult | null = null;

    try {
      const context = await this.loadContext(data);

      // ⚠️ RIZA YENİDEN KONTROL EDİLİR. İstek kuyruğa alındıktan sonra
      // kullanıcı rızasını geri çekmiş olabilir. Fotoğraf tam da BURADA
      // yurt dışına çıkıyor; kararın verileceği an, isteğin alındığı an değil
      // aktarımın yapıldığı andır.
      await this.assertConsentStillGranted(context.userId, data.tryOnJobId);

      const [personUrl, garmentUrl] = await Promise.all([
        this.urls.issue(context.photoKey),
        this.urls.issue(context.garmentKey),
      ]);

      try {
        chain = await generateWithFallback(this.providers, {
          personImageUrl: personUrl.url,
          garmentImageUrl: garmentUrl.url,
          category: context.category,
          mode: data.mode,
          // Sağlayıcı tarafında da tekilleştirme: aynı anahtar iki kez
          // gönderilirse ikinci çağrı için para ödemeyiz.
          idempotencyKey: data.cacheKey,
        });
      } finally {
        // Başarı da olsa hata da olsa girdi erişimi kapatılır.
        await Promise.all([personUrl.revoke(), garmentUrl.revoke()]).catch(() => {
          this.logger.warn({ tryOnJobId: data.tryOnJobId }, 'Girdi adresleri kapatılamadı');
        });
      }

      if (chain.result.status === 'FAILED') {
        return await this.fail(data, chain, chain.result.reason);
      }

      // ── FİLİGRAN ─────────────────────────────────────────────────────
      // ⚠️ Depoya yazmadan ÖNCE. Filigransız bir görsel bir an bile depoda
      //    durmamalı; oradan imzalı URL üretilirse uyarısız yayılır.
      const watermarked = await this.watermarker.embed(chain.result.image, TRYON.watermarkText);

      const resultKey = storageKeys.tryOnResult(data.tryOnJobId);
      await this.storage.put({
        key: resultKey,
        // ⚠️ private: görsel kullanıcının vücut görüntüsüdür. Public kovaya
        //    yazılması KVKK ihlalidir.
        visibility: 'private',
        body: watermarked.image,
        contentType: watermarked.contentType,
        cacheControl: 'private, no-store',
      });

      const visualConfidence = computeVisualConfidence({
        providerScore: chain.result.visualConfidence,
        imageBytes: watermarked.image.byteLength,
        attemptCount: chain.attempted.length,
      });

      await this.prisma.tryOnJob.update({
        where: { id: data.tryOnJobId },
        data: {
          status: 'SUCCEEDED',
          provider: chain.attempted.at(-1)?.provider ?? null,
          resultKey,
          visualConfidence,
          // cacheKey iş yaratılırken yazıldı; burada teyit edilir ki
          // sonraki aynı istek üretim yapmadan bu satırı bulsun.
          cacheKey: data.cacheKey,
          costMicroUsd: chain.totalCostMicroUsd,
          latencyMs: Date.now() - startedAt,
          finishedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });

      await this.writeUsageLog(data, chain, {
        success: true,
        model: chain.result.model,
        latencyMs: Date.now() - startedAt,
      });

      this.logger.info(
        {
          tryOnJobId: data.tryOnJobId,
          provider: chain.attempted.at(-1)?.provider,
          visualConfidence,
          costMicroUsd: chain.totalCostMicroUsd.toString(),
        },
        'Sanal deneme üretildi',
      );

      return { jobId: data.tryOnJobId, status: 'SUCCEEDED' };
    } catch (error) {
      // ⚠️ SON SAVUNMA. Buraya rıza iptali, depo hatası, filigran eksikliği ya
      //    da beklenmedik bir istisna düşer. Hangisi olursa olsun iş terminal
      //    duruma yazılır — aksi hâlde RUNNING'de kalır ve kullanıcının günlük
      //    hakkı kalıcı olarak yanar.
      return this.fail(data, chain, 'PROVIDER_ERROR', error);
    }
  }

  // ── Başarısızlık yolu ────────────────────────────────────────────────────

  /**
   * ⚠️ KOTA İADESİ BURADA GERÇEKLEŞİR.
   *
   * Ayrı bir sayaç azaltılmaz: günlük kota, "bugün açılmış ve başarısız
   * OLMAMIŞ" işlerin sayısıdır (bkz. TryOnService.consumedQuotaToday). İşi
   * FAILED'a yazmak kotayı aynı anda ve atomik biçimde geri verir. Sayaç
   * tabanlı bir tasarımda bu güncelleme kaçırılırsa hak kalıcı olarak yanardı.
   *
   * ⚠️ AiUsageLog HER DURUMDA yazılır: başarısız çağrı da para harcar.
   *    Yazılmazsa ay sonunda fatura ile panel tutmaz ve fark açıklanamaz.
   */
  private async fail(
    data: TryOnJobData,
    chain: TryOnChainResult | null,
    reason: TryOnFailureReason,
    error?: unknown,
  ): Promise<TryOnProcessOutcome> {
    const permanent = isPermanentFailure(reason);
    const errorCode = FAILURE_ERROR_CODE[reason];

    /**
     * ⚠️ HATA METNİ ZİNCİRİN TAMAMINI TAŞIR — SON HALKAYI DEĞİL.
     *
     *    Eskiden istisna yoksa buraya `Sağlayıcı hatası: QUOTA_EXCEEDED` gibi
     *    HİÇBİR ŞEY SÖYLEMEYEN bir metin yazılıyordu. Canlıda bunun bedeli:
     *    işler `provider=gemini` + `AI_BUDGET_EXCEEDED` ile düşüyordu ve
     *    zincirin ÖNCE fal'ı denediği, fal'ın NE dediği hiçbir yerde yoktu.
     *    Yirmi dakika önce fal başarıyla üretim yapmışken saatlerce yanlış
     *    yerde arandı.
     *
     * ⚠️ NEDEN `errorCode` DEĞİL DE METİN: `errorCode` kullanıcıya giden tek
     *    bir koddur ve zincirin SON halkasından gelir — o kalmalı, çünkü
     *    kullanıcıya gösterilecek mesajı o belirliyor. Ama teşhis için gereken
     *    şey zincirin TAMAMI ve onun yeri bu serbest metin alanı.
     *
     *    Örnek çıktı:
     *      "fal: PROVIDER_ERROR (2103ms) → gemini: QUOTA_EXCEEDED (890ms)"
     */
    const zincirOzeti = chain?.attempted.length
      ? chain.attempted
          .map((d) => `${d.provider}: ${d.reason ?? 'başarılı'} (${d.latencyMs}ms)`)
          .join(' → ')
      : null;

    const message = (
      error instanceof Error
        ? // İstisna varsa metni ÖNDE: yığın izinin taşıdığı bilgi zincir
          //  özetinden daha spesifiktir. Zincir yine de arkasına eklenir.
          zincirOzeti
          ? `${error.message} | zincir: ${zincirOzeti}`
          : error.message
        : (zincirOzeti ?? `Sağlayıcı hatası: ${reason}`)
    ).slice(0, 500);

    try {
      await this.prisma.tryOnJob.update({
        where: { id: data.tryOnJobId },
        data: {
          status: permanent ? 'FAILED_PERMANENT' : 'FAILED',
          provider: chain?.attempted.at(-1)?.provider ?? null,
          costMicroUsd: chain?.totalCostMicroUsd ?? 0n,
          errorCode,
          errorMessage: message,
          finishedAt: new Date(),
        },
      });
    } catch (updateError) {
      // Durum yazılamadıysa kota iadesi de olmadı demektir — bu, sessiz
      // geçilecek bir hata değil, alarm konusudur.
      this.logger.error(
        { tryOnJobId: data.tryOnJobId, err: updateError },
        'Try-on işi başarısız işaretlenemedi — KOTA İADE EDİLMEDİ',
      );
    }

    await this.writeUsageLog(data, chain, {
      success: false,
      model: 'unknown',
      latencyMs: chain?.result.latencyMs ?? 0,
      errorCode,
    });

    /**
     * ⚠️ ZİNCİRİN TAMAMI LOGLANIR, YALNIZCA SON DENEME DEĞİL.
     *
     *    `chain.attempted` alanının kendi yorumu "gözlemlenebilirlik için"
     *    diyordu — ama HİÇBİR YERDE OKUNMUYORDU. Log da, veritabanı da,
     *    kullanım defteri de yalnızca `attempted.at(-1)`i yazıyordu.
     *
     *    Canlıda bunun bedeli şuydu: iş `provider=gemini` ve
     *    `QUOTA_EXCEEDED` ile düşüyordu. Ama zincir önce FAL'ı denemişti ve
     *    fal'ın NEDEN düştüğü hiçbir yere yazılmadığı için görünmüyordu —
     *    yirmi dakika önce aynı sağlayıcı başarıyla üretim yapmışken.
     *    "Son denemeyi logla" tasarımı, tam da fallback zincirinin en çok
     *    açıklama gerektirdiği anda susuyor.
     *
     * ⚠️ `err` AYRI TUTULUYOR: istisna varsa yığın izi lazım, ama zincir
     *    istisnasız da başarısız olabilir (her sağlayıcı düzgün bir `reason`
     *    döndürür). O durumda `err` boş, `zincir` dolu olur.
     */
    this.logger.warn(
      {
        tryOnJobId: data.tryOnJobId,
        reason,
        permanent,
        zincir: chain?.attempted.map((deneme) => ({
          saglayici: deneme.provider,
          sebep: deneme.reason ?? 'başarılı',
          ms: deneme.latencyMs,
        })),
        err: error,
      },
      'Sanal deneme başarısız — kullanıcı kotası iade edildi',
    );

    return {
      jobId: data.tryOnJobId,
      status: permanent ? 'FAILED_PERMANENT' : 'FAILED',
      reason,
    };
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────────

  private async loadContext(data: TryOnJobData): Promise<{
    userId: string;
    photoKey: string;
    garmentKey: string;
    category: TryOnGarmentCategory;
  }> {
    const photo = await this.prisma.userPhoto.findFirst({
      // Süresi dolmuş veya silinmiş fotoğrafla üretim yapılmaz: kullanıcı
      // saklama süresi dolduğu için silinmesini beklerken kopyası
      // sağlayıcıya gönderilemez.
      where: { id: data.userPhotoId, deletedAt: null, expiresAt: { gt: new Date() } },
      select: { userId: true, storageKey: true },
    });

    if (!photo) throw new Error('Kullanıcı fotoğrafı bulunamadı veya süresi dolmuş');

    const variant = await this.prisma.variant.findUnique({
      where: { id: data.variantId },
      select: {
        product: {
          select: {
            category: { select: { tryOnCategory: true } },
            images: {
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
              take: 1,
              select: { storageKey: true },
            },
          },
        },
      },
    });

    const category = variant?.product.category.tryOnCategory ?? null;
    const garmentKey = variant?.product.images[0]?.storageKey ?? null;

    if (!garmentKey) {
      throw new Error('Ürün sanal denemeye uygun değil (görsel eksik)');
    }

    /**
     * ⚠️ SON KAPI — VE TİP DARALTICI.
     *
     *    Katalog kategorisi sekiz değerlidir; sağlayıcıya yalnızca en az bir
     *    modelin giydirebildiği alt küme gönderilebilir. `isTryOnSupported`
     *    tipi daralttığı için, bu satır kaldırılırsa aşağıdaki `return`
     *    DERLENMEZ — kapı yorumla değil derleyiciyle korunuyor.
     *
     *    Buraya normalde hiç gelinmemelidir: API tarafındaki
     *    `TRYONABLE_CATEGORIES` kontrolü işi kuyruğa almadan önce reddeder
     *    (tryon.service.ts). Yine de savunma burada da duruyor, çünkü kuyruğa
     *    ELDEN iş eklenebilir ve o yolda API kontrolü hiç çalışmaz.
     */
    if (!isTryOnSupported(category)) {
      throw new Error(
        `Ürün sanal denemeye uygun değil (kategori desteklenmiyor: ${category ?? 'yok'})`,
      );
    }

    return { userId: photo.userId, photoKey: photo.storageKey, garmentKey, category };
  }

  /**
   * ⚠️ ConsentRecord APPEND-ONLY'dir: geçerli durum türün EN SON kaydıdır.
   *    `granted=true` satırının var olması hiçbir şey kanıtlamaz — sonrasında
   *    geri çekilmiş olabilir.
   *
   * // TODO(paylaşılan-kural): Bu değerlendirme API tarafındaki
   * //   `consent.rules.ts` ile aynı sözleşmedir. Kural `@vt/contracts`'a
   * //   taşınıp iki taraf da oradan okumalı; iki yerde yaşayan bir KVKK
   * //   kuralı zamanla ayrışır.
   */
  private async assertConsentStillGranted(userId: string, tryOnJobId: string): Promise<void> {
    for (const type of REQUIRED_CONSENTS) {
      const latest = await this.prisma.consentRecord.findFirst({
        where: { userId, type },
        orderBy: { createdAt: 'desc' },
        select: { granted: true },
      });

      if (latest?.granted !== true) {
        this.logger.warn(
          { tryOnJobId, userId, missingConsent: type },
          'Rıza kuyruğa alındıktan sonra geri çekilmiş — aktarım yapılmadı',
        );
        throw new Error(`Rıza yok veya geri çekilmiş: ${type}`);
      }
    }
  }

  private async writeUsageLog(
    data: TryOnJobData,
    chain: TryOnChainResult | null,
    outcome: { success: boolean; model: string; latencyMs: number; errorCode?: string },
  ): Promise<void> {
    try {
      const job = await this.prisma.tryOnJob.findUnique({
        where: { id: data.tryOnJobId },
        select: { userId: true },
      });

      await this.prisma.aiUsageLog.create({
        data: {
          userId: job?.userId ?? null,
          feature: 'TRYON',
          provider: chain?.attempted.at(-1)?.provider ?? 'none',
          model: outcome.model,
          imageCount: 1,
          // ⚠️ Zincirin TOPLAM maliyeti: başarısız denemeler de faturaya girer.
          costMicroUsd: chain?.totalCostMicroUsd ?? 0n,
          latencyMs: outcome.latencyMs,
          success: outcome.success,
          errorCode: outcome.errorCode ?? null,
          cacheHit: false,
        },
      });
    } catch (error) {
      // Maliyet kaydı yazılamadı: panel eksik kalır ama iş akışı durmaz.
      this.logger.error(
        { tryOnJobId: data.tryOnJobId, err: error },
        'AI kullanım kaydı yazılamadı — maliyet paneli eksik olacak',
      );
    }
  }
}

/**
 * GÖRSEL GÜVEN SKORU (0-100)
 *
 * Sağlayıcının kendi skoru tek başına yeterli değildir: sağlayıcılar iyimser
 * raporlar ve "üretebildim" ile "inandırıcı oldu" aynı şey değildir. Bu yüzden
 * kendi gözlemlerimizle aşağı çekilir.
 *
 * ⚠️ Skor YUKARI çekilmez. Yanlış yüksek bir güven, kullanıcının görsele
 *    güvenip yanlış ürünü almasına yol açar; yanlış düşük bir güven yalnızca
 *    fazladan bir uyarı gösterir. Asimetrik risk, asimetrik hesap.
 */
export function computeVisualConfidence(input: {
  providerScore: number;
  imageBytes: number;
  attemptCount: number;
}): number {
  let score = Math.min(100, Math.max(0, Math.round(input.providerScore)));

  // Çok küçük çıktı genellikle bozuk/dejenere bir üretimdir (düz zemin,
  // yarım gövde). Boyut tek başına kanıt değil ama güçlü bir şüphe işaretidir.
  if (input.imageBytes < 30_000) score -= 25;
  else if (input.imageBytes < 80_000) score -= 10;

  // Birincil sağlayıcı başarısız olup yedeğe düşüldüyse sonuç genellikle
  // daha zayıftır — kullanıcıya bunu yansıtmak dürüst olandır.
  if (input.attemptCount > 1) score -= 5 * (input.attemptCount - 1);

  return Math.min(100, Math.max(0, score));
}
