/**
 * SATIN ALINAN ÜRÜNÜN GARDIROBA OTOMATİK EKLENMESİ — SAF ÇEKİRDEK
 *
 * ⚠️ TETİK OLAYI: `package.delivered`  (görev metnindeki `order.delivered` DEĞİL)
 *
 *    Bu kod tabanında `order.delivered` diye bir olay YOKTUR ve hiçbir yerde
 *    üretilmez. Teslim anında yazılan olay `order.service.ts` içindeki
 *    `updatePackageStatus()` akışıdır ve tipi şudur:
 *        type: `package.${target.toLowerCase()}`  →  'package.delivered'
 *    Aggregate 'order', aggregateId ise SİPARİŞ kimliğidir (paket kimliği
 *    değil); paket kimliği payload içindedir.
 *
 *    Bir sipariş birden çok satıcıya bölünür ve HER PAKET AYRI teslim edilir.
 *    Sipariş düzeyinde tek bir "teslim edildi" olayını beklemek, ilk paketi
 *    eline alan kullanıcının o parçayı gardırobunda görmemesi demekti.
 *
 * ⚠️ YAN ETKİ SERVİSTEN DEĞİL, OLAYDAN TETİKLENİR (görev şartı).
 *    `OrderService` gardıroba yazmaz; teslim transaction'ı `OutboxEvent`
 *    yazar, dağıtıcı kuyruğa taşır, tüketici burayı çağırır. Sipariş
 *    transaction'ı geri alınırsa olay hiç yazılmamış olur.
 *
 * ⚠️ TESLİMAT EN AZ BİR KEZDİR (bkz. outbox.dispatcher.ts başlığı). Aynı olayın
 *    iki kez işlenmesi İSTİSNA DEĞİL, BEKLENEN durumdur:
 *      - outbox dağıtıcısı `publishedAt` yazmadan önce ölürse olay tekrar taşınır,
 *      - BullMQ işi hata sonrası 3 kez dener,
 *      - iade reddi paketi RETURN_REQUESTED → DELIVERED geri döndürür ve
 *        `package.delivered` İKİNCİ KEZ gerçekten üretilir
 *        (bkz. order-status.ts: RETURN_REQUESTED: ['RETURNED', 'DELIVERED']).
 *    Sonuncusu bir hata senaryosu değildir; normal iş akışıdır.
 *
 * Saf fonksiyon: veritabanı, ağ ve saat bağımlılığı yok — testin tamamı bu
 * dosyaya bakarak yazılabilir.
 */

import type { TryOnCategory } from '@vt/db';
import type { WardrobeAutoAddCommand } from './wardrobe.ports.js';

/** Bu modülün dinlediği olay tipi. */
export const WARDROBE_TRIGGER_EVENT = 'package.delivered' as const;

/**
 * Teslim edilen paketin gardıroba girecek kalemi.
 *
 * ⚠️ Alanlar `OrderItem`in SNAPSHOT kolonlarından okunur (productTitle,
 *    variantLabel, imageKey). Katalogdan CANLI okunsaydı, ürün sonradan
 *    silindiğinde veya rengi değiştiğinde kullanıcının gardırobundaki parça
 *    da değişir ya da kaybolurdu — oysa o parça artık kullanıcının dolabında,
 *    fiziksel olarak duruyor.
 */
export interface DeliveredItemSnapshot {
  orderItemId: string;
  variantId: string;
  productTitle: string;
  variantLabel: string;
  imageKey: string;
  /** Katalogdaki try-on kategorisi. Yoksa parça gardıroba GİRMEZ. */
  category: TryOnCategory | null;
  /** Varyantın rengi. Boşsa 'BİLİNMİYOR' değil, parça girmez — bkz. aşağısı. */
  color: string | null;
}

export interface AutoAddPlanInput {
  userId: string;
  items: readonly DeliveredItemSnapshot[];
}

export interface AutoAddPlan {
  commands: WardrobeAutoAddCommand[];
  /** Gardıroba girmeyen kalemler ve gerekçesi — log ve test için. */
  skipped: Array<{ orderItemId: string; reason: SkipReason }>;
}

export type SkipReason =
  /** Giyilebilir bir kategorisi yok: çorap, çanta, parfüm, hediye kartı. */
  | 'NOT_WEARABLE'
  /** Rengi bilinmiyor — renk uyumu motoru bu parçayla karar veremez. */
  | 'NO_COLOR'
  /** Aynı olayın aynı kalemi iki kez taşıması (payload içi tekrar). */
  | 'DUPLICATE_IN_EVENT';

/**
 * Teslim edilen paketten gardıroba yazılacak komutları üretir.
 *
 * ⚠️ BU FONKSİYON TEKİLLİĞİ GARANTİ ETMEZ, yalnızca doğal anahtarı ÜRETİR.
 *    Gerçek garanti veritabanındadır: UNIQUE(userId, sourceOrderItemId) +
 *    ON CONFLICT DO NOTHING. Neden burada değil: "önce sorgula, yoksa yaz"
 *    iki eşzamanlı tüketicide de "yok" cevabı verir ve iki satır yazılır.
 *    Tekilliği yarış koşullarına dayanıklı biçimde yalnızca veritabanı
 *    kurabilir.
 *
 * `orderItemId` doğal anahtar olarak seçildi çünkü:
 *   - satın alınan her fiziksel parça için BİR tanedir ve değişmez,
 *   - `(userId, variantId)` seçilseydi aynı tişörtten iki tane alan kullanıcı
 *     gardırobunda bir tane görürdü — oysa dolabında iki tane var,
 *   - olay kimliği (`outboxEventId`) seçilseydi, aynı kalemi taşıyan İKİNCİ
 *     bir olay (iade reddi sonrası yeniden teslim) mükerrer kayıt açardı.
 */
export function planAutoAdd(input: AutoAddPlanInput): AutoAddPlan {
  const commands: WardrobeAutoAddCommand[] = [];
  const skipped: AutoAddPlan['skipped'] = [];
  const seen = new Set<string>();

  for (const item of input.items) {
    // Aynı payload içinde aynı kalem iki kez gelirse ikincisi elenir; aksi
    // hâlde tek `insertMany` çağrısı kendi içinde çakışır.
    if (seen.has(item.orderItemId)) {
      skipped.push({ orderItemId: item.orderItemId, reason: 'DUPLICATE_IN_EVENT' });
      continue;
    }
    seen.add(item.orderItemId);

    // ⚠️ Kategorisi olmayan parça gardıroba girmez. Gardırop bir sipariş
    //    geçmişi değil, KOMBİN KURULABİLİR parçalar kümesidir; parfüm veya
    //    hediye kartı öneri havuzunu kirletir.
    if (item.category === null) {
      skipped.push({ orderItemId: item.orderItemId, reason: 'NOT_WEARABLE' });
      continue;
    }

    // ⚠️ Renksiz parça da girmez: renk uyumu kural motorunun TEK girdisi
    //    renktir. 'BİLİNMİYOR' gibi bir yer tutucu yazsaydık motor onu bir
    //    renk ailesi sanıp sessizce yanlış karar verirdi.
    const color = item.color?.trim();
    if (!color) {
      skipped.push({ orderItemId: item.orderItemId, reason: 'NO_COLOR' });
      continue;
    }

    commands.push({
      userId: input.userId,
      variantId: item.variantId,
      category: item.category,
      color,
      label: `${item.productTitle} — ${item.variantLabel}`,
      productImageKey: item.imageKey,
      sourceOrderItemId: item.orderItemId,
    });
  }

  return { commands, skipped };
}

/**
 * Olay bu modülü ilgilendiriyor mu?
 *
 * ⚠️ Tip kontrolü tüketicinin BAŞINDA yapılır. `package.shipped` ve
 *    `package.cancelled` aynı kuyruktan geçer; ayrım yapılmazsa kargoya
 *    verilen —henüz kullanıcının elinde olmayan— parça gardıroba girer.
 */
export function isWardrobeTrigger(eventType: string): boolean {
  return eventType === WARDROBE_TRIGGER_EVENT;
}

/**
 * `package.delivered` payload'ından paket kimliğini çıkarır.
 *
 * Payload `order.service.ts` içinde şu şekilde yazılır:
 *   { packageId, sellerId, from, to, carrier, trackingNo }
 *
 * ⚠️ `from` alanı da okunur ve KULLANILIR: paket zaten DELIVERED iken tekrar
 *    DELIVERED işaretlenemez (geçiş tablosu buna izin vermez), ama
 *    RETURN_REQUESTED → DELIVERED geçişi olayı yeniden üretir. O ikinci olayda
 *    kalemler zaten gardırobtadır; komutlar yine üretilir ve veritabanı
 *    çakışmayı yutar. Burada bilinçli olarak ELENMEZ — çünkü ilk teslimat
 *    olayı kaybolmuş olabilir ve bu ikinci olay tek şansımızdır.
 */
export function readDeliveredPayload(
  payload: unknown,
): { packageId: string; from: string | null } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const packageId = record.packageId;
  if (typeof packageId !== 'string' || packageId.length === 0) return null;
  return {
    packageId,
    from: typeof record.from === 'string' ? record.from : null,
  };
}
