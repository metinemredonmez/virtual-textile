import type { PrismaClient, TryOnCategory as PrismaTryOnCategory } from '@vt/db';
import type { Logger } from 'pino';
import {
  isWardrobeTrigger,
  planAutoAdd,
  readDeliveredPayload,
  type DeliveredItemSnapshot,
  type TryOnCategory,
  type WardrobeAutoAddCommand,
} from '@vt/contracts';
import type { DomainEventJobData } from '../queues.js';
import type { DomainEventHandler } from './domain-event.fanout.js';

/**
 * SATIN ALINAN ÜRÜNÜN GARDIROBA OTOMATİK EKLENMESİ — TÜKETİCİ
 *
 * `package.delivered` olayının gardırop tarafı. Karar (`planAutoAdd`) saf
 * çekirdektedir (`@vt/contracts` → `wardrobe/auto-add.ts`); bu dosyada yalnızca
 * o kararın altyapı karşılığı vardır: Prisma okuması, Prisma yazması ve log.
 *
 * ⚠️ NEDEN `apps/api` DEĞİL: yan etki bir HTTP isteğinden değil OLAYDAN
 *    tetiklenmelidir ve worker `apps/api`den import edemez. Metot `apps/api`de
 *    dururken tam olarak bu yüzden ölüydü: yazılmıştı, derleniyordu, 16 testi
 *    geçiyordu — ama hiçbir olay ona ulaşmıyordu.
 *
 * ⚠️ NEDEN `@vt/db` DEĞİL: `applyDelivered` ve api portu silindikten sonra bu
 *    okumanın ve bu yazmanın TEK çağıranı burasıdır. Tek çağıranlı bir
 *    fonksiyonu paylaşılan pakete koymak, `WardrobeAutoAddCommand` tipi için
 *    yeni bir `@vt/db → @vt/contracts` paket kenarı ve fazladan bir derleme
 *    adımı satın almak demekti. (`packages/db` içindeki
 *    `getSellerBalanceMinor` bir "paylaşılan sorgu yardımcısı precedenti" gibi
 *    görünüyor ama ölçüldü: apps ve packages altında GERÇEK çağıranı yok,
 *    yalnızca return-ledger.ts'te bir yorumda adı geçiyor — yani ölü kod.)
 *
 * ⚠️ OKUMA TÜKETİCİNİN İHTİYACINA GÖRE ŞEKİLLENİR, olay üreticisinin
 *    sözleşmesini şekillendirmez (aynı kural: notification.processor.ts →
 *    `NotificationContacts`). Bu yüzden yükte yalnızca `packageId` taşınır;
 *    gerisi burada okunur.
 */

/**
 * PRISMA ENUM'I ↔ CONTRACTS AYNASI — SAPMA KİLİDİ.
 *
 * ⚠️ Bu tablo bir belge değil, OKUMA YOLUNUN PARÇASIDIR (aşağıda
 *    `TRYON_CATEGORY[row...]` olarak kullanılır). Kullanılmayan bir tip iddiası
 *    bir gün "ölü kod" diye temizlenir ve koruma sessizce kalkardı — bu, tam da
 *    kapatmaya çalıştığımız hata sınıfı olurdu.
 *
 * İKİ YÖNLÜ ve DERLEME ZAMANI:
 *   - Prisma enum'ına `SHOES` eklenirse → "Property 'SHOES' is missing"
 *   - contracts aynasından `OUTERWEAR` silinirse → değer atanamaz
 *   - aynaya hayalet bir değer eklenirse → fazlalık özellik denetimi kırar
 *
 * Kalıp deponun kendisinden: `multi-tryon.service.ts` → OUTFIT_ORDER_ERROR_CODE
 * (`as const satisfies Record<OutfitOrderFailureReason, ErrorCode>`).
 * `packages/config/src/ai-budget.ts`teki yalnızca-yorumla-korunan aynadan
 * bilinçli olarak daha güçlüdür: sapmayı çalışma zamanına BIRAKMAZ.
 */
const TRYON_CATEGORY = {
  UPPER_BODY: 'UPPER_BODY',
  LOWER_BODY: 'LOWER_BODY',
  DRESS: 'DRESS',
  OUTERWEAR: 'OUTERWEAR',
} as const satisfies Record<PrismaTryOnCategory, TryOnCategory>;

// ── Depo (okuma + yazma, dar port) ────────────────────────────────────────

/** Teslim edilen paketin gardırop için gereken görünümü. */
export interface DeliveredPackageView {
  /**
   * ⚠️ NULL OLABİLİR — misafir siparişi (`Order.userId` nullable,
   *    schema.prisma). Yazılacak bir dolap yoktur.
   */
  userId: string | null;
  items: DeliveredItemSnapshot[];
}

/**
 * ⚠️ Okuma ve yazma TEK portta. Ayrı portlara bölünseydi ikisi ayrı yerlerde
 *    yaşayabilir, ikisinin ayrı sahte nesnesi yazılır ve testler "okunan şey
 *    yazılan şeyle uyuşuyor mu" sorusunu hiç sormazdı.
 */
export interface WardrobeAutoAddStore {
  deliveredPackage(packageId: string): Promise<DeliveredPackageView | null>;

  /**
   * ⚠️ SÖZLEŞME: aynı `sourceOrderItemId` ile ikinci çağrı YENİ SATIR AÇMAZ.
   *    Uygulaması `ON CONFLICT DO NOTHING` OLMALIDIR — "önce var mı diye bak,
   *    yoksa yaz" YAZILAMAZ: aynı olayı aynı anda işleyen iki tüketici de "yok"
   *    görür ve iki satır yazılır. Tekilliği veritabanı kurar, uygulama değil.
   *
   * Dönen sayı GERÇEKTEN eklenen satır sayısıdır (çakışanlar sayılmaz).
   */
  insertPurchasedIgnoringDuplicates(commands: readonly WardrobeAutoAddCommand[]): Promise<number>;
}

/** Prisma ile gerçek okuma/yazma. Kalıp: `PrismaNotificationContacts`. */
export class PrismaWardrobeAutoAddStore implements WardrobeAutoAddStore {
  constructor(private readonly prisma: PrismaClient) {}

  async deliveredPackage(packageId: string): Promise<DeliveredPackageView | null> {
    const pkg = await this.prisma.orderPackage.findUnique({
      where: { id: packageId },
      select: {
        order: { select: { userId: true } },
        items: {
          select: {
            id: true,
            variantId: true,
            // ── SNAPSHOT kolonları: ürün silinse de gardıroptaki parça durur ──
            productTitle: true,
            variantLabel: true,
            imageKey: true,
            /**
             * ⚠️ BUNLAR CANLI KATALOG OKUMASIDIR, snapshot DEĞİL.
             *    `OrderItem` rengi ve try-on kategorisini tutmaz; başka
             *    kaynağı yok. Ürünün rengi sipariş sonrası düzeltilirse
             *    gardıroba düzeltilmiş hâli girer. Bu yalnızca HENÜZ HİÇ
             *    YAZILMAMIŞ kalemleri etkiler: unique indeks sayesinde ilk
             *    yazılan satır kazanır.
             */
            variant: {
              select: {
                color: true,
                product: { select: { category: { select: { tryOnCategory: true } } } },
              },
            },
          },
        },
      },
    });

    if (!pkg) return null;

    return {
      userId: pkg.order.userId,
      items: pkg.items.map((item) => ({
        orderItemId: item.id,
        variantId: item.variantId,
        productTitle: item.productTitle,
        variantLabel: item.variantLabel,
        imageKey: item.imageKey,
        // ⚠️ Sapma kilidi burada, YÜK TAŞIYAN yolda kullanılıyor.
        category: mapCategory(item.variant.product.category.tryOnCategory),
        color: item.variant.color,
      })),
    };
  }

  async insertPurchasedIgnoringDuplicates(
    commands: readonly WardrobeAutoAddCommand[],
  ): Promise<number> {
    if (commands.length === 0) return 0;

    /**
     * ⚠️ `skipDuplicates: true` → PostgreSQL'de `ON CONFLICT DO NOTHING`.
     *    Ekleme öncesi HİÇBİR OKUMA YAPILMAZ; tekilliği yalnızca
     *    UNIQUE(userId, sourceOrderItemId) indeksi kurabilir.
     *
     *    Dönen `count` gerçekten eklenen satır sayısıdır — `added < planned`
     *    bir hata değil, mükerrer teslimat olayının yutulduğunun kanıtıdır.
     */
    const result = await this.prisma.digitalWardrobeItem.createMany({
      data: commands.map((command) => ({
        userId: command.userId,
        source: 'PURCHASE' as const,
        variantId: command.variantId,
        category: command.category,
        color: command.color,
        label: command.label,
        /**
         * ⚠️ KVKK: PURCHASE kaydında `photoKey` YAZILMAZ. `photoKey` private
         *    kovadaki KULLANICI fotoğrafıdır; buradaki görsel satıcının PUBLIC
         *    pazarlama materyalidir ve public kalır. İkisi ayrı kolonda durur
         *    ki tek bir sorgu onları aynı yoldan servis edemesin
         *    (bkz. wardrobe.service.ts → toView).
         */
        productImageKey: command.productImageKey,
        sourceOrderItemId: command.sourceOrderItemId,
      })),
      skipDuplicates: true,
    });

    return result.count;
  }
}

function mapCategory(category: PrismaTryOnCategory | null): TryOnCategory | null {
  return category === null ? null : TRYON_CATEGORY[category];
}

// ── Olay işleyicisi ───────────────────────────────────────────────────────

export interface WardrobeAutoAddResult {
  added: number;
  skipped: number;
}

export class WardrobeAutoAddHandler implements DomainEventHandler {
  /**
   * ⚠️ 24 SAATLİK BAYAT OLAY KAPISI GARDIROBA UYGULANMAZ — bilerek `null`.
   *
   *    Kapı BİLDİRİM için doğrudur: bir gün geç gelen "siparişiniz kargoya
   *    verildi" SMS'i bilgilendirmez, YANILTIR. Gardırop için YANLIŞTIR: bir
   *    gün sonra işlenen teslimat da kullanıcının dolabındadır. Geç bildirim
   *    yanlış bilgi verir; geç gardırop kaydı yalnızca geç kayıttır.
   *
   *    Alan opsiyonel değil ZORUNLU (bkz. `DomainEventHandler`): bu kararın
   *    unutulabilir olmaması gerekiyordu.
   */
  readonly maxEventAgeMs = null;

  constructor(
    private readonly store: WardrobeAutoAddStore,
    private readonly logger: Logger,
  ) {}

  async process(event: DomainEventJobData): Promise<WardrobeAutoAddResult> {
    // ⚠️ Tip kontrolü EN BAŞTA: `package.shipped` ve `package.cancelled` aynı
    //    kuyruktan geçer. Ayrım yapılmasaydı kargoya verilen —henüz kullanıcının
    //    elinde olmayan— parça gardıroba girerdi.
    if (!isWardrobeTrigger(event.type)) return { added: 0, skipped: 0 };

    const payload = readDeliveredPayload(event.payload);
    if (!payload) {
      // ⚠️ Fırlatılmaz: yükü bozuk bir olay tekrar denendiğinde de bozuk kalır
      //    ve kuyruğu üç kez meşgul etmesi bir işe yaramaz. Ama görünür olmalı.
      this.logger.error(
        { outboxEventId: event.outboxEventId, type: event.type },
        'package.delivered yükünde packageId yok — gardıroba işlenemedi',
      );
      return { added: 0, skipped: 0 };
    }

    const pkg = await this.store.deliveredPackage(payload.packageId);
    if (!pkg) {
      this.logger.warn(
        { outboxEventId: event.outboxEventId, packageId: payload.packageId },
        'Teslim edilen paket bulunamadı — gardıroba işlenmedi',
      );
      return { added: 0, skipped: 0 };
    }

    /**
     * ⚠️ MİSAFİR SİPARİŞİ. `Order.userId` null ise yazılacak dolap yoktur ve bu
     *    bir hata değildir. Kalem düzeyinde bir `SkipReason` olarak
     *    modellenmedi: olgu sipariş düzeyindedir, kalemlerin kendisiyle ilgisi
     *    yok. `planAutoAdd` çağrılmadan ÖNCE elenir (`AutoAddPlanInput.userId`
     *    null kabul etmez).
     */
    if (pkg.userId === null) {
      this.logger.info(
        { outboxEventId: event.outboxEventId, packageId: payload.packageId },
        'Misafir siparişi — gardıroba eklenecek kullanıcı yok',
      );
      return { added: 0, skipped: 0 };
    }

    const plan = planAutoAdd({ userId: pkg.userId, items: pkg.items });

    if (plan.commands.length === 0) {
      /**
       * ⚠️ İZLEME NOKTASI. Teslim edilmiş bir paketten SIFIR komut çıkması,
       *    kablonun KOPUK olduğu durumla BİREBİR AYNI görünür (ikisi de sıfır
       *    satır). En olası sebep veri eksikliğidir: `Category.tryOnCategory`
       *    NULLABLE'dır ve admin tarafından elle doldurulur; katalogda boşsa
       *    her teslimat `NOT_WEARABLE` üretir. Tip sistemi enum'ın ADLARINI
       *    korur, VERİNİN doluluğunu koruyamaz — o yüzden burada warn var.
       */
      this.logger.warn(
        {
          outboxEventId: event.outboxEventId,
          packageId: payload.packageId,
          items: pkg.items.length,
          reasons: plan.skipped.map((entry) => entry.reason),
        },
        'Teslim edilen paketten gardıroba giren parça çıkmadı',
      );
      return { added: 0, skipped: plan.skipped.length };
    }

    const added = await this.store.insertPurchasedIgnoringDuplicates(plan.commands);

    // ⚠️ `added < planned` NORMALDİR: fark, veritabanının yuttuğu mükerrer
    //    kayıtlardır. Hata olarak loglanmaz, yoksa outbox'ın en-az-bir-kez
    //    teslimatı her tekrarında sahte alarm üretirdi.
    this.logger.info(
      {
        outboxEventId: event.outboxEventId,
        packageId: payload.packageId,
        userId: pkg.userId,
        planned: plan.commands.length,
        added,
        skipped: plan.skipped.length,
      },
      'Teslim edilen parçalar gardıroba işlendi',
    );

    return { added, skipped: plan.skipped.length };
  }
}
