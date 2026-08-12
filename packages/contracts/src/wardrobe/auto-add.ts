/**
 * SATIN ALINAN ÜRÜNÜN GARDIROBA OTOMATİK EKLENMESİ — SAF ÇEKİRDEK
 *
 * ⚠️ NEDEN `@vt/contracts` İÇİNDE: bu kural iki uygulamayı birden ilgilendirir.
 *    Planı ÜRETEN kod `apps/worker` içindedir (olay tüketicisi), planın
 *    dayandığı olayı YAZAN kod `apps/api` içindedir. Dosya daha önce
 *    `apps/api/src/modules/wardrobe/wardrobe.auto-add.ts` idi ve worker oradan
 *    import EDEMEZ. Buraya taşındı; `@vt/contracts`ın tek bağımlılığı `zod`
 *    olduğu için yeni bir paket kenarı açılmadı (para birimi kuralının
 *    `money.ts` içinde durmasıyla aynı gerekçe).
 *
 * ⚠️ TAŞINDI, KOPYALANMADI. `apps/api` altındaki eski dosya SİLİNDİ. İki içe
 *    aktarma yolu bırakılsaydı altı ay sonra biri "modülün kendi kopyası"
 *    diyerek yerele geri yazar ve iki kural birbirinden sapardı.
 *
 * ⚠️ TETİK OLAYI: `package.delivered`. Aggregate 'order', aggregateId ise
 *    SİPARİŞ kimliğidir (paket kimliği değil); paket kimliği payload içindedir
 *    (bkz. `PackageDeliveredPayload`).
 *
 *    Bir sipariş birden çok satıcıya bölünür ve HER PAKET AYRI teslim edilir.
 *    Sipariş düzeyinde tek bir "teslim edildi" olayını beklemek, ilk paketi
 *    eline alan kullanıcının o parçayı gardırobunda görmemesi demekti.
 *
 * ⚠️ YAN ETKİ SERVİSTEN DEĞİL, OLAYDAN TETİKLENİR. `OrderService` gardıroba
 *    yazmaz; teslim transaction'ı `OutboxEvent` yazar, dağıtıcı kuyruğa taşır,
 *    tüketici burayı çağırır. Sipariş transaction'ı geri alınırsa olay hiç
 *    yazılmamış olur. Bu bir temenni değil YAPISAL bir güvencedir: `apps/api`
 *    tarafındaki yazma yolu (`WardrobeService.applyDelivered` ve
 *    `insertPurchasedIgnoringDuplicates` portu) SİLİNDİ, gardıroba PURCHASE
 *    satırı yazan tek kod yolu `apps/worker` içindedir.
 *
 * ⚠️ TESLİMAT EN AZ BİR KEZDİR (bkz. outbox.dispatcher.ts başlığı). Aynı olayın
 *    iki kez işlenmesi İSTİSNA DEĞİL, BEKLENEN durumdur:
 *      - outbox dağıtıcısı `publishedAt` yazmadan önce ölürse olay tekrar taşınır,
 *      - BullMQ işi hata sonrası 3 kez dener.
 *    (Daha önce burada üçüncü bir gerekçe yazılıydı: "iade reddi paketi
 *    RETURN_REQUESTED → DELIVERED geri döndürür ve olay İKİNCİ KEZ üretilir".
 *    ÖLÇÜLDÜ ve YANLIŞ çıktı: `order.service.ts` iade reddi yolunda doğrudan
 *    `tx.orderPackage.update` yapar, `recordEvent`i ATLAR — o geçiş outbox'a
 *    hiç uğramaz. Yanlış gerekçeyi silmek doğru sonucu değiştirmiyor:
 *    idempotentlik yukarıdaki iki sebeple zaten zorunludur.)
 *
 * Saf fonksiyon: veritabanı, ağ ve saat bağımlılığı yok — testin tamamı bu
 * dosyaya bakarak yazılabilir.
 */

import type { TryOnCategory } from '../schemas/common.js';

/** Bu modülün dinlediği olay tipi. */
export const WARDROBE_TRIGGER_EVENT = 'package.delivered' as const;

/**
 * `package.delivered` olayının yükü — ÜRETİCİ ile TÜKETİCİNİN ORTAK SÖZLEŞMESİ.
 *
 * ⚠️ VAR OLMA SEBEBİ: `DomainEventJobData.payload` tipi `unknown`dır. Yani
 *    üretici (`order.service.ts` → `transitionPackage` → `recordEvent`) alan
 *    adını değiştirse tüketici derlemede hiçbir şey görmez; arıza yalnızca
 *    üretimde, "gardıroba hiçbir şey düşmüyor" biçiminde ortaya çıkar. Bu
 *    arayüz o deliği kapatır: üretici yükü `satisfies PackageDeliveredPayload`
 *    ile yazar, tüketici `readDeliveredPayload` ile aynı tipten okur.
 *    `packageId` yeniden adlandırılırsa İKİ TARAF BİRDEN derlemede kırılır.
 *
 * ⚠️ `carrier`/`trackingNo` null OLABİLİR: paket kargo bilgisi girilmeden de
 *    durum değiştirebilir (bkz. bildirim tarafındaki "takip numarası yoksa SMS
 *    gönderme" kuralı).
 */
export interface PackageDeliveredPayload {
  packageId: string;
  sellerId: string;
  /** Önceki paket durumu. */
  from: string;
  /** Yeni paket durumu — bu olayda 'DELIVERED'. */
  to: string;
  carrier: string | null;
  trackingNo: string | null;
}

/**
 * Teslim edilen paketin gardıroba girecek kalemi.
 *
 * ⚠️ Alanların KAYNAĞI KARIŞIKTIR ve bu bilinçlidir:
 *      productTitle, variantLabel, imageKey → `OrderItem` SNAPSHOT kolonları.
 *        Katalogdan canlı okunsaydı ürün sonradan silindiğinde ya da adı
 *        değiştiğinde kullanıcının gardırobundaki parça da değişir veya
 *        kaybolurdu — oysa o parça artık kullanıcının dolabında duruyor.
 *      category, color → CANLI KATALOG (`Category.tryOnCategory`,
 *        `Variant.color`). Sipariş kalemi bu ikisinin anlık görüntüsünü
 *        TUTMAZ; başka yerden okunamıyor.
 *
 *    (Bu başlık daha önce "alanların hepsi snapshot kolonlarından okunur"
 *    diyordu; ölçüldü, yanlıştı.) Sapma yalnızca HENÜZ HİÇ YAZILMAMIŞ kalemleri
 *    etkiler: UNIQUE(userId, sourceOrderItemId) sayesinde ilk yazılan kazanır,
 *    sonraki teslimat olayları var olan satırı değiştirmez.
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
  /**
   * ⚠️ `string`, `string | null` DEĞİL. Misafir siparişinde `Order.userId`
   *    null'dır ve o kalemler bu fonksiyona HİÇ GELMEZ; eleme çağrı yerinde,
   *    sipariş düzeyinde yapılır. Bir `SkipReason` olarak modellenmedi çünkü
   *    kalem düzeyinde bir olgu değil: misafir siparişinde YAZILACAK BİR DOLAP
   *    YOKTUR.
   */
  userId: string;
  items: readonly DeliveredItemSnapshot[];
}

/** Otomatik eklemede kullanılan yazma komutu. */
export interface WardrobeAutoAddCommand {
  userId: string;
  variantId: string;
  category: TryOnCategory;
  color: string;
  label: string;
  /** ⚠️ Satıcının PUBLIC ürün görseli — private kova anahtarı DEĞİL. */
  productImageKey: string;
  /** ⚠️ UNIQUE(userId, sourceOrderItemId) — idempotentliğin dayanağı. */
  sourceOrderItemId: string;
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
 *   - satın alınan her sipariş kalemi için BİR tanedir ve değişmez,
 *   - olay kimliği (`outboxEventId`) seçilseydi, aynı kalemi taşıyan İKİNCİ
 *     bir olay (outbox'ın en-az-bir-kez teslimatı) mükerrer kayıt açardı.
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
 * `package.delivered` yükünü okur.
 *
 * ⚠️ Yükün kendisi JSON kolonundan gelir ve `unknown`dır: veritabanındaki eski
 *    satırlar bugünkü sözleşmeyi TAŞIMAYABİLİR. Bu yüzden tip iddiası değil,
 *    çalışma zamanı kontrolü yapılır — tek zorunlu alan `packageId`dir, gerisi
 *    olmadan da gardıroba yazılabilir.
 *
 * ⚠️ `from` alanı okunur ama ELEME AMACIYLA KULLANILMAZ. Aynı kalemi taşıyan
 *    ikinci bir olay geldiğinde komutlar yine üretilir ve çakışmayı veritabanı
 *    yutar — çünkü ilk olay dağıtım sırasında kaybolmuş olabilir ve ikinci
 *    olay tek şansımızdır.
 */
export function readDeliveredPayload(
  payload: unknown,
): { packageId: string; from: string | null } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Partial<Record<keyof PackageDeliveredPayload, unknown>>;
  const packageId = record.packageId;
  if (typeof packageId !== 'string' || packageId.length === 0) return null;
  return {
    packageId,
    from: typeof record.from === 'string' ? record.from : null,
  };
}
