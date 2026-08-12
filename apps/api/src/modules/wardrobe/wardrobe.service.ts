/**
 * DİJİTAL GARDIROP SERVİSİ
 *
 * Sahip olduğu tablo: `DigitalWardrobeItem` (`user_wardrobe_items`, migration
 * `20260812131500_digital_wardrobe`). Erişim doğrudan Prisma ile DEĞİL,
 * `WardrobeRepositoryPort` üzerindendir — gerçek uygulaması
 * `wardrobe.gateway.ts` içindeki `PrismaWardrobeRepository`.
 *
 * Üç güvence bu dosyada toplanır:
 *   1. SAHİPLİK — her okuma/yazma/silme oturumdaki kullanıcıyla sınırlıdır.
 *   2. GİZLİLİK — gardırop fotoğrafı private kovadadır ve yalnızca kısa ömürlü
 *      imzalı URL ile okunur; kalıcı adres HİÇBİR yanıtta dönmez.
 *   3. SINIR    — kombin ve deneme mantığı burada YAZILMAZ, ilgili modüllerin
 *      servisleri çağrılır.
 */

import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { appError } from '@vt/contracts';
import { SIGNED_URL_TTL_SECONDS } from '@vt/config';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { wardrobeKeys } from './wardrobe.keys.js';
import { planAutoAdd, type DeliveredItemSnapshot } from './wardrobe.auto-add.js';
import {
  WARDROBE_PHOTO_STORAGE,
  WARDROBE_REPOSITORY,
  WARDROBE_STYLIST,
  WARDROBE_TRYON,
  type WardrobeItem,
  type WardrobeOutfitSuggestion,
  type WardrobePhotoStoragePort,
  type WardrobeRepositoryPort,
  type WardrobeStylistPort,
  type WardrobeTryOnPort,
} from './wardrobe.ports.js';
import type { WardrobeCreateInput } from './wardrobe.schema.js';

/**
 * ⚠️ Gardırop fotoğrafı için AYRI bir TTL sabiti YOKTUR; kullanıcı fotoğrafı
 *    ile aynı sınıfta olduğu için `userPhoto` (5 dk) kullanılıyor. Daha uzun
 *    bir süre seçmek, kopyalanan bir bağlantının daha uzun süre çalışması
 *    demektir. `packages/config` bu modülün dosyası değil; oraya
 *    `wardrobePhoto` anahtarı eklenmesi raporda önerilmiştir.
 */
const PHOTO_URL_TTL_SECONDS = SIGNED_URL_TTL_SECONDS.userPhoto;

const UPLOAD_URL_TTL_SECONDS = 300;

/**
 * İstemciye dönen parça görünümü.
 *
 * ⚠️ `photoKey` ALANI YOKTUR. Depo anahtarı içeriden bir detaydır; dışarı
 *    verilseydi istemci onu başka uçlara geri göndermeye başlar ve "istemciden
 *    anahtar alma" yasağı fiilen delinirdi.
 */
export interface WardrobeItemView {
  id: string;
  source: 'PURCHASE' | 'MANUAL';
  variantId: string | null;
  category: WardrobeItem['category'];
  color: string;
  label: string | null;
  /**
   * MANUAL parçada KISA ÖMÜRLÜ İMZALI URL, PURCHASE parçada ürünün public
   * görsel adresi. İki kaynak da aynı alandan döner ama muameleleri farklıdır.
   */
  imageUrl: string | null;
  /** true ise `imageUrl` imzalıdır ve dakikalar içinde geçersiz olur. */
  imageUrlExpires: boolean;
  tryOnable: boolean;
  createdAt: string;
}

export interface WardrobeUploadTicket {
  itemId: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

@Injectable()
export class WardrobeService {
  constructor(
    @Inject(WARDROBE_REPOSITORY) private readonly repository: WardrobeRepositoryPort,
    @Inject(WARDROBE_PHOTO_STORAGE) private readonly storage: WardrobePhotoStoragePort,
    @Inject(WARDROBE_STYLIST) private readonly stylist: WardrobeStylistPort,
    @Inject(WARDROBE_TRYON) private readonly tryOn: WardrobeTryOnPort,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── GET /v1/wardrobe ─────────────────────────────────────────────────────

  async list(userId: string): Promise<WardrobeItemView[]> {
    const items = await this.repository.listByUser(userId);
    return Promise.all(items.map((item) => this.toView(item)));
  }

  // ── POST /v1/wardrobe ────────────────────────────────────────────────────

  /**
   * Kullanıcının kendi parçası için yükleme bileti üretir.
   *
   * ⚠️ Kayıt bu adımda KALICI DEĞİLDİR. Önce anahtar ve kimlik ayrılır, imzalı
   *    URL verilir; satır ancak `confirm()` ile —dosyanın depoda GERÇEKTEN
   *    var olduğu doğrulandıktan sonra— yazılır. Ters sırada yapılsaydı,
   *    yüklemeyi yarıda bırakan her kullanıcı gardırobunda görselsiz bir
   *    hayalet parça bırakırdı.
   */
  async requestUpload(userId: string, input: WardrobeCreateInput): Promise<WardrobeUploadTicket> {
    const itemId = randomUUID();
    const key = wardrobeKeys.photo(userId, itemId);

    const uploadUrl = await this.storage.signedUploadUrl({
      key,
      // ⚠️ private kova — port zaten başka kovaya yazamaz.
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      contentType: input.contentType,
      maxSizeBytes: input.sizeBytes,
    });

    return { itemId, uploadUrl, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
  }

  /**
   * Yükleme sonrası kaydı kalıcılaştırır.
   *
   * ⚠️ Anahtar İSTEMCİDEN ALINMAZ, `userId` + `itemId` ile YENİDEN ÜRETİLİR.
   *    Böylece kullanıcı yalnızca kendi ad alanındaki bir nesneyi onaylayabilir.
   */
  async confirmUpload(
    userId: string,
    itemId: string,
    input: WardrobeCreateInput,
  ): Promise<WardrobeItemView> {
    const key = wardrobeKeys.photo(userId, itemId);

    // Dosya gerçekten yüklendi mi? Yüklenmediyse kayıt açılmaz.
    if (!(await this.storage.exists(key))) {
      throw appError('PHOTO_NOT_FOUND', {
        internalMessage: `Gardırop fotoğrafı depoda yok: ${key}`,
      });
    }

    const item = await this.repository.insertManual({
      userId,
      category: input.category,
      color: input.color,
      label: input.label,
      photoKey: key,
    });

    return this.toView(item);
  }

  // ── DELETE /v1/wardrobe/:id ──────────────────────────────────────────────

  /**
   * Parçayı siler.
   *
   * ⚠️ SIRA: önce VERİTABANI satırı (sahiplik koşuluyla), sonra DEPO nesnesi.
   *    `photo-retention.job.ts` bunun TERSİNİ yapar ve orada da doğrudur —
   *    fark, oradaki silmenin bir CRON olması: depo silme başarısız olursa
   *    kayıt durur ve sonraki tur tekrar dener. Burada tekrar denenecek bir
   *    tur yoktur; kullanıcı "sil" dedi ve yanıtı bekliyor. Bu yüzden önce
   *    satır silinir (kullanıcı için parça gitmiştir), depo silme başarısız
   *    olursa YETİM NESNE kalır ve HATA SEVİYESİNDE loglanır.
   *
   * ⚠️ Yetim nesne bir KVKK borcudur: kullanıcı sildiğini sanırken fotoğraf
   *    depoda durur. Bunu süpüren bir temizlik işi GEREKLİDİR ve worker
   *    tarafında henüz YOKTUR — raporda bildirilmiştir.
   */
  async remove(userId: string, itemId: string): Promise<void> {
    const deleted = await this.repository.deleteOwned(userId, itemId);

    // ⚠️ Sahibi olmayan parça için 404 — 403 DEĞİL. 403 dönseydi, saldırgan
    //    kimlik denemesiyle "bu kimlik var ama senin değil" bilgisini toplardı.
    if (!deleted) {
      throw appError('NOT_FOUND', {
        internalMessage: `Gardırop parçası bulunamadı veya sahibi değil: ${itemId}`,
      });
    }

    if (deleted.photoKey) {
      try {
        await this.storage.delete(deleted.photoKey);
      } catch (error) {
        this.logger.error(
          { itemId, err: error },
          'Gardırop fotoğrafı depodan silinemedi — yetim nesne kaldı',
        );
      }
    }
  }

  // ── GET /v1/wardrobe/outfit-suggestions ──────────────────────────────────

  /**
   * Gardıroptaki parçalarla kombin önerir.
   *
   * ⚠️ MODÜL SINIRI: öneri mantığı BURADA YOKTUR. Renk uyumu ve kombin kararı
   *    stil danışmanı modülünün kural motorundadır; bu servis yalnızca
   *    gardıroptaki parçaları toplar, danışmana verir, sonucu görünüme çevirir.
   *
   * ⚠️ Danışmana giden veri KASITLI OLARAK DAR: kategori, renk ve etiket.
   *    Fotoğraf, depo anahtarı ve imzalı URL GÖNDERİLMEZ — kullanıcının kendi
   *    dolabının fotoğrafı yurt dışındaki bir LLM sağlayıcısına gitmemelidir
   *    (aynı gerekçe: stylist.ports.ts → StylistUserProfile veri minimizasyonu).
   */
  async suggestOutfits(userId: string, limit: number): Promise<WardrobeOutfitSuggestion[]> {
    const items = await this.repository.listByUser(userId);

    // Boş gardırop bir hata değil, boş sonuçtur. Danışman boşuna çalışmasın.
    if (items.length === 0) return [];

    return this.stylist.suggestOutfits({
      userId,
      items: items.map((item) => ({
        itemId: item.id,
        category: item.category,
        color: item.color,
        label: item.label,
      })),
      limit,
    });
  }

  /**
   * Bir kombinin sanal denemeye uygunluğunu sorar.
   *
   * ⚠️ Denemeyi BAŞLATMAZ, `MultiTryOnService`e devreder (port arkasında).
   *    Rıza, kota ve bütçe kapıları orada; burada kopyalanmaz.
   *
   * ⚠️ MANUAL parçalar (variantId null) elenerek gönderilir: sanal deneme
   *    katalogdaki ürün görselinden giydirir, kullanıcının kendi fotoğrafından
   *    değil.
   */
  async prepareTryOn(
    userId: string,
    itemIds: readonly string[],
  ): Promise<{
    available: boolean;
    reason?: string;
  }> {
    const items = await Promise.all(itemIds.map((id) => this.repository.findOwned(userId, id)));

    const variantIds = items
      .filter((item): item is WardrobeItem => item !== null)
      .map((item) => item.variantId)
      .filter((id): id is string => id !== null);

    if (variantIds.length === 0) {
      return {
        available: false,
        reason: 'Bu kombindeki parçalar platformda satılmadığı için sanal deneme yapılamıyor.',
      };
    }

    return this.tryOn.prepareOutfit({ userId, variantIds });
  }

  // ── Otomatik ekleme (olay tüketicisi çağırır) ────────────────────────────

  /**
   * `package.delivered` olayının gardırop tarafı.
   *
   * ⚠️ Bu metot bir HTTP ucundan çağrılmaz; olay tüketicisi çağırır.
   *    Tekillik veritabanındadır (bkz. `planAutoAdd` başlığı) — bu metot aynı
   *    girdiyle iki kez çağrıldığında ikinci çağrı 0 ekler.
   */
  async applyDelivered(input: {
    userId: string;
    items: readonly DeliveredItemSnapshot[];
  }): Promise<{ added: number; skipped: number }> {
    const plan = planAutoAdd(input);

    if (plan.commands.length === 0) {
      return { added: 0, skipped: plan.skipped.length };
    }

    const added = await this.repository.insertPurchasedIgnoringDuplicates(plan.commands);

    // ⚠️ added < commands.length NORMALDİR: fark, veritabanının yuttuğu
    //    mükerrer kayıtlardır. Hata olarak loglanmaz, yoksa her tekrar
    //    teslimat olayı sahte alarm üretir.
    this.logger.info(
      { userId: input.userId, planned: plan.commands.length, added, skipped: plan.skipped.length },
      'Teslim edilen parçalar gardıroba işlendi',
    );

    return { added, skipped: plan.skipped.length };
  }

  // ── Görünüm ──────────────────────────────────────────────────────────────

  /**
   * ⚠️ GİZLİLİK KARARININ TEK YERİ.
   *
   * MANUAL parçanın fotoğrafı private kovadadır → imzalı, kısa ömürlü URL.
   * PURCHASE parçasının görseli satıcının ürün görselidir → public CDN adresi.
   * İkisi tek bir alandan döner ama ASLA aynı yolla üretilmez.
   */
  private async toView(item: WardrobeItem): Promise<WardrobeItemView> {
    const signed = item.photoKey
      ? await this.storage.signedReadUrl({
          key: item.photoKey,
          expiresInSeconds: PHOTO_URL_TTL_SECONDS,
        })
      : null;

    return {
      id: item.id,
      source: item.source,
      variantId: item.variantId,
      category: item.category,
      color: item.color,
      label: item.label,
      imageUrl: signed ?? item.productImageKey,
      imageUrlExpires: signed !== null,
      // Yalnızca katalogda karşılığı olan parça denenebilir.
      tryOnable: item.variantId !== null,
      createdAt: item.createdAt.toISOString(),
    };
  }
}
