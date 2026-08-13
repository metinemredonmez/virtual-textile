import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  isTryOnSupported,
  KOLEKSIYON_SLUGLARI,
  MEDIA,
  SITE_BANNER_WIDTHS,
  SITE_IMAGE_MAX_CARDS,
  type SiteImageSlot,
  type TryOnCategoryName,
} from '@vt/config';
import { appError } from '@vt/contracts';
import type { Prisma } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { detectImageFormat } from '../media/image-format.js';
import { MEDIA_IMAGE_PROCESSOR, type ImageProcessor } from '../media/image-processor.js';
import { MEDIA_STORAGE, mediaKeys, type MediaStoragePort } from '../media/media.ports.js';
import { AUDIT_ACTION, writeAuditLog, type AdminActor } from './audit.js';
import type {
  SiteImageCardInput,
  SiteImageConfirmInput,
  SiteImageListQuery,
  SiteImageUpdateInput,
  SiteImageUploadInput,
} from './admin-site-image.schema.js';

/** Yükleme bileti — medya modülündeki `UploadTicket` ile aynı şekil. */
export interface SiteImageUploadTicket {
  uploadId: string;
  uploadUrl: string;
  requiredContentType: string;
  maxSizeBytes: number;
  expiresInSeconds: number;
}

export interface SiteImageCardView {
  productId: string;
  slug: string;
  title: string;
  brandName: string;
  imageKey: string | null;
  priceMinor: bigint;
  listPriceMinor: bigint | null;
  defaultVariantId: string | null;
  tryOnable: boolean;
  tryOnCategory: string | null;
}

export interface SiteImageView {
  id: string;
  slot: string;
  targetKey: string | null;
  storageKey: string;
  widthPx: number;
  heightPx: number;
  blurhash: string | null;
  title: string | null;
  subtitle: string | null;
  linkHref: string | null;
  cards: SiteImageCardView[];
}

export interface AdminSiteImageView extends SiteImageView {
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ═══════════════════ ADMİNDEN YÖNETİLEN SİTE GÖRSELLERİ ═════════════════════
 *
 * Yönetilen ÜÇ yüzey: vitrin afişi (HERO), kategori kapağı, koleksiyon kapağı.
 * Hepsi tek tablodan; yeni bir yüzey `@vt/config` → `SITE_IMAGE_SLOTS`e tek
 * satır, migration gerekmez.
 *
 * ⚠️ YÜKLEME AKIŞI SIFIRDAN YAZILMADI. Ürün görselinin üç adımlı imzalı akışı
 *    ZATEN VAR ve aynen kullanılıyor: aynı `MEDIA_STORAGE` portu, aynı
 *    `MEDIA_IMAGE_PROCESSOR`, aynı `mediaKeys` şeması, aynı sanitize→analyze→
 *    derive→blurhash sırası. Bu servis o akışın site görseli için
 *    parametrelenmiş hâlidir; ikinci bir yükleme yolu açmaz.
 *
 * ⚠️ HAM DOSYA PUBLIC KOVAYA İNMEZ. Nihai nesne public (`site/banner/…`) ama
 *    imzalı PUT hedefi private (`staging/site/…`). Gerekçe ürün görselindeki
 *    ile birebir aynı: ham dosya EXIF/GPS taşır ve biz işleyene kadar CDN'den
 *    indirilebilir olurdu. Bkz. media.ports.ts → mediaKeys.
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class AdminSiteImageService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStoragePort,
    @Inject(MEDIA_IMAGE_PROCESSOR) private readonly processor: ImageProcessor,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ══════════════════════════ YÜKLEME ══════════════════════════════════════

  /**
   * POST /admin/site-images → imzalı yükleme adresi.
   *
   * ⚠️ `siteImageId` SUNUCUDA üretilir; istemciden anahtar ALINMAZ. `Store.
   *    logoKey/bannerKey` kalıbı (`seller.schema.ts:37-38`) anahtarı serbest
   *    istemci dizesi olarak alıyor ve nesnenin varlığına dair hiçbir kanıt
   *    taşımıyor — o kalıp KOPYALANMADI. Doğru emsal medya onay akışıdır.
   */
  async requestUpload(input: SiteImageUploadInput): Promise<SiteImageUploadTicket> {
    // ⚠️ Hedef DAHA BİLET AŞAMASINDA doğrulanır. Onaya bırakılsaydı yönetici
    //    10 MB'lık dosyayı yükler, sonra "bu kategori yok" cevabını alırdı.
    await this.assertValidTarget(input.slot, input.targetKey ?? null);

    const siteImageId = randomUUID();
    const stagingKey = mediaKeys.siteImageStaging(siteImageId);

    const uploadUrl = await this.storage.signedUrl({
      key: stagingKey,
      visibility: 'private', // ⚠️ Ham dosya asla public kovaya inmez.
      operation: 'put',
      expiresInSeconds: MEDIA.uploadUrlTtlSeconds,
      contentType: input.contentType,
      maxSizeBytes: input.sizeBytes,
    });

    return {
      uploadId: siteImageId,
      uploadUrl,
      requiredContentType: input.contentType,
      maxSizeBytes: input.sizeBytes,
      expiresInSeconds: MEDIA.uploadUrlTtlSeconds,
    };
  }

  /**
   * POST /admin/site-images/:id/confirm → satırı ve türevleri yaratır.
   *
   * Doğrulama BAYTLARDAN yapılır, istemci beyanından değil.
   */
  async confirm(
    actor: AdminActor,
    siteImageId: string,
    input: SiteImageConfirmInput,
  ): Promise<AdminSiteImageView> {
    await this.assertValidTarget(input.slot, input.targetKey ?? null);

    const stagingKey = mediaKeys.siteImageStaging(siteImageId);

    if (!(await this.storage.exists(stagingKey, 'private'))) {
      throw appError('SITE_IMAGE_NOT_FOUND', {
        internalMessage: `Onaylanmak istenen yükleme depoda yok: ${stagingKey}`,
      });
    }

    const raw = await this.storage.get(stagingKey, 'private');

    if (raw.byteLength > MEDIA.maxUploadBytes) {
      await this.discard(stagingKey, 'boyut tavanı aşıldı');
      throw appError('PHOTO_TOO_LARGE', {
        params: { maxMb: Math.floor(MEDIA.maxUploadBytes / (1024 * 1024)) },
      });
    }

    // ⚠️ Biçim İÇERİKTEN okunur. Beyan kabul edilseydi `image/webp` diyen bir
    //    HTML dosyası public kovaya inebilirdi.
    if (detectImageFormat(raw) === null) {
      await this.discard(stagingKey, 'desteklenmeyen içerik');
      throw appError('PHOTO_INVALID_FORMAT', {
        internalMessage: `Tanınmayan görsel içeriği: ${stagingKey}`,
      });
    }

    // ⚠️ EXIF/GPS temizliği. Bundan sonrası public kovaya gidiyor.
    const sanitized = await this.processor.sanitize(raw, { format: 'webp' });
    // ⚠️ Türev genişlikleri `SITE_BANNER_WIDTHS`ten, `MEDIA.productImageWidths`
    //    ten DEĞİL: afiş 16/7 yatay ve tam genişlik kaplar, 320px'lik bir
    //    türev hiçbir kırılma noktasında seçilmez.
    const derived = await this.processor.derive(sanitized.buffer, SITE_BANNER_WIDTHS);
    const blurhash = await this.processor.blurhash(sanitized.buffer);

    const originalKey = mediaKeys.siteImageOriginal(siteImageId);

    await this.storage.put({
      key: originalKey,
      visibility: 'public',
      body: sanitized.buffer,
      contentType: sanitized.contentType,
    });

    for (const variant of derived) {
      await this.storage.put({
        key: mediaKeys.siteImage(siteImageId, variant.width),
        visibility: 'public',
        body: variant.buffer,
        contentType: variant.contentType,
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      /**
       * ⚠️ `upsert`, `create` DEĞİL. Onay ucu @Idempotent taşıyor ama anahtar
       *    yalnızca AYNI istek tekrarını yakalar; yönetici sayfayı yenileyip
       *    aynı yüklemeyi yeni bir anahtarla onaylarsa ikinci satır açılır ve
       *    vitrinde iki afiş görünürdü. `storageKey` @unique olduğu için
       *    upsert bunu veritabanı seviyesinde kapatıyor.
       */
      const row = await tx.siteImage.upsert({
        where: { storageKey: originalKey },
        create: {
          id: siteImageId,
          slot: input.slot,
          targetKey: input.targetKey ?? null,
          storageKey: originalKey,
          widthPx: sanitized.widthPx,
          heightPx: sanitized.heightPx,
          blurhash,
          title: input.title ?? null,
          subtitle: input.subtitle ?? null,
          linkHref: input.linkHref ?? null,
          sortOrder: input.sortOrder,
          createdBy: actor.id,
        },
        update: {
          widthPx: sanitized.widthPx,
          heightPx: sanitized.heightPx,
          blurhash,
          title: input.title ?? null,
          subtitle: input.subtitle ?? null,
          linkHref: input.linkHref ?? null,
          sortOrder: input.sortOrder,
        },
        include: SITE_IMAGE_INCLUDE,
      });

      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.siteImageCreated,
        entityType: 'SiteImage',
        entityId: row.id,
        before: null,
        after: { slot: row.slot, targetKey: row.targetKey, sortOrder: row.sortOrder },
      });

      return row;
    });

    // ⚠️ Ham (EXIF'li) dosya işi bitince silinir. Silinemezse istek DÜŞMEZ:
    //    dosya private kovada erişilemez durumda kalır, afiş geçerlidir.
    await this.discard(stagingKey, 'işlendi');

    this.logger.info(
      { siteImageId: created.id, slot: created.slot, derivedCount: derived.length },
      'Site görseli yüklendi',
    );

    return toAdminView(created);
  }

  // ══════════════════════════ YÖNETİM ══════════════════════════════════════

  async list(query: SiteImageListQuery): Promise<{ items: AdminSiteImageView[] }> {
    const rows = await this.prisma.siteImage.findMany({
      where: query.slot ? { slot: query.slot } : {},
      // Yönetim listesi PASİF kayıtları da gösterir — yönetici neyi açıp
      // kapatacağını göremezse yönetemez.
      orderBy: [{ slot: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: SITE_IMAGE_INCLUDE,
    });

    return { items: rows.map(toAdminView) };
  }

  /**
   * PATCH /admin/site-images/:id
   *
   * ⚠️ "Sıra değiştir" ve "pasifleştir" AYRI UÇ DEĞİL, bu ucun alanlarıdır:
   *    `sortOrder` sırayı, `isActive` yayını taşır. Ayrı uçlar açmak üç kez
   *    aynı yetki kontrolünü, üç kez aynı denetim kaydını ve üç kez aynı
   *    testi yazmak demekti.
   */
  async update(
    actor: AdminActor,
    siteImageId: string,
    input: SiteImageUpdateInput,
  ): Promise<AdminSiteImageView> {
    const before = await this.prisma.siteImage.findUnique({ where: { id: siteImageId } });
    if (!before) throw appError('SITE_IMAGE_NOT_FOUND');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.siteImage.update({
        where: { id: siteImageId },
        data: {
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
          ...(input.linkHref !== undefined ? { linkHref: input.linkHref } : {}),
        },
        include: SITE_IMAGE_INCLUDE,
      });

      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.siteImageUpdated,
        entityType: 'SiteImage',
        entityId: siteImageId,
        before: { isActive: before.isActive, sortOrder: before.sortOrder, title: before.title },
        after: { isActive: updated.isActive, sortOrder: updated.sortOrder, title: updated.title },
      });

      return toAdminView(updated);
    });
  }

  /**
   * DELETE /admin/site-images/:id
   *
   * ⚠️ Şemanın "soft delete yok, status var" kuralı BURADA UYGULANMAZ ve
   *    gerekçesi var: o kural TİCARİ kayıtlar içindir (sipariş, ödeme, rıza) —
   *    geçmişi yeniden yazmamak için. Afiş bir geçmiş kaydı değil, bir yayın
   *    kararıdır; `isActive:false` zaten "yayından kaldır" demek. `DELETE`
   *    bundan farklı bir şeydir: "bu dosya bir daha kullanılmayacak". Satır
   *    kalsaydı depoda ölü nesneler süresiz birikirdi.
   */
  async remove(actor: AdminActor, siteImageId: string): Promise<{ id: string; deleted: true }> {
    const row = await this.prisma.siteImage.findUnique({ where: { id: siteImageId } });
    if (!row) throw appError('SITE_IMAGE_NOT_FOUND');

    await this.prisma.$transaction(async (tx) => {
      // Kartlar FK cascade ile düşer.
      await tx.siteImage.delete({ where: { id: siteImageId } });

      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.siteImageDeleted,
        entityType: 'SiteImage',
        entityId: siteImageId,
        before: { slot: row.slot, targetKey: row.targetKey, isActive: row.isActive },
        after: null,
      });
    });

    // ⚠️ Nesneler SATIR SİLİNDİKTEN SONRA silinir ve hata istek düşürmez.
    //    Ters sırada yapılsaydı, depo silme başarılı olup transaction geri
    //    alındığında satır kalır ama görsel 404 olurdu — yani "sayfa 200
    //    dönüyor, görsel kırık" arızasının kendisi.
    await this.discardPublic(siteImageId);

    return { id: siteImageId, deleted: true };
  }

  // ══════════════════════════ ÜRÜN KARTLARI ════════════════════════════════

  /**
   * POST /admin/site-images/:id/cards
   *
   * Afişin üzerinde duran ürün kartları. Ana sayfa "üzerinizde görün" DİYOR
   * ama göstermiyordu; kartlar o vaadi görünür kılar.
   */
  async addCard(
    actor: AdminActor,
    siteImageId: string,
    input: SiteImageCardInput,
  ): Promise<AdminSiteImageView> {
    const image = await this.prisma.siteImage.findUnique({
      where: { id: siteImageId },
      include: { cards: { select: { id: true } } },
    });
    if (!image) throw appError('SITE_IMAGE_NOT_FOUND');

    // ⚠️ Kart YALNIZCA afişe eklenir. Kapaklarda kartı çizen hiçbir ekran yok;
    //    izin verilseydi yönetici kart bağlar, kaydedilir ve HİÇBİR YERDE
    //    görünmezdi — bu depoda altı kez yaşanan arızanın ta kendisi.
    if (image.slot !== 'HERO') {
      throw appError('VALIDATION_FAILED', {
        internalMessage: `Kart yalnızca HERO'ya eklenebilir, istenen slot: ${image.slot}`,
        details: {
          fields: [{ path: 'slot', message: 'Ürün kartı yalnızca vitrin afişine eklenebilir.' }],
        },
      });
    }

    if (image.cards.length >= SITE_IMAGE_MAX_CARDS) {
      throw appError('SITE_IMAGE_TOO_MANY_CARDS', { params: { max: SITE_IMAGE_MAX_CARDS } });
    }

    // ⚠️ Yayında olmayan ürün bağlanamaz. Bağlanabilseydi okuma sorgusunun
    //    `status = PUBLISHED` filtresi kartı düşürür, yönetici "ekledim ama
    //    görünmüyor" derdi ve sebebini hiçbir yerde göremezdi.
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, status: 'PUBLISHED' },
      select: { id: true },
    });
    if (!product) throw appError('PRODUCT_NOT_FOUND');

    await this.prisma.$transaction(async (tx) => {
      await tx.siteImageCard.upsert({
        where: { siteImageId_productId: { siteImageId, productId: input.productId } },
        create: { siteImageId, productId: input.productId, sortOrder: input.sortOrder },
        update: { sortOrder: input.sortOrder },
      });

      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.siteImageCardAdded,
        entityType: 'SiteImage',
        entityId: siteImageId,
        before: null,
        after: { productId: input.productId, sortOrder: input.sortOrder },
      });
    });

    return this.requireAdminView(siteImageId);
  }

  /**
   * DELETE /admin/site-images/:id/cards/:productId
   *
   * @Idempotent KULLANILMAZ: silme doğası gereği tekrarlanabilir. İkinci çağrı
   * `SITE_IMAGE_NOT_FOUND` döner — kayıp değil, zaten yapılmış demektir.
   */
  async removeCard(
    actor: AdminActor,
    siteImageId: string,
    productId: string,
  ): Promise<AdminSiteImageView> {
    const card = await this.prisma.siteImageCard.findUnique({
      where: { siteImageId_productId: { siteImageId, productId } },
    });
    if (!card) throw appError('SITE_IMAGE_NOT_FOUND');

    await this.prisma.$transaction(async (tx) => {
      await tx.siteImageCard.delete({ where: { id: card.id } });

      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.siteImageCardRemoved,
        entityType: 'SiteImage',
        entityId: siteImageId,
        before: { productId },
        after: null,
      });
    });

    return this.requireAdminView(siteImageId);
  }

  // ══════════════════════════ GENEL OKUMA ══════════════════════════════════

  /**
   * GET /site-images/hero — vitrinin okuduğu uç. Kimlik istemez.
   *
   * ⚠️ "AYNI ANDA TEK AKTİF HERO" KURALI BURADA UYGULANIR, DB KISITIYLA
   *    DEĞİL. Prisma kısmi (partial) unique yazamıyor — emsal
   *    `20260811095040_commission_rule_null_safe_unique` ham SQL — ve kısıt
   *    konulsaydı yönetici "önce eskisini kapat" çıkmazına girerdi. Onun
   *    yerine okuma TEK satır seçer ve seçim DETERMİNİSTİKTİR: en küçük
   *    `sortOrder`, eşitlikte en yeni.
   *
   * ⚠️ NULL DÖNER, 404 DEĞİL. Afiş tanımlanmamışsa bu bir hata değil, boş
   *    durumdur; 404 olsaydı yönetici hiçbir şey yapmadığı için ana sayfa
   *    hata sınırına giderdi. Vitrin bu durumda bugünkü davranışına (ilk
   *    ürünün fotoğrafı) düşer.
   */
  async readHero(): Promise<{ image: SiteImageView | null }> {
    const row = await this.prisma.siteImage.findFirst({
      where: { slot: 'HERO', isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: SITE_IMAGE_INCLUDE,
    });

    return { image: row ? toPublicView(row) : null };
  }

  /**
   * GET /site-images?slot=CATEGORY_COVER — kategori/koleksiyon kapakları.
   *
   * ⚠️ OKUMA HOŞGÖRÜLÜDÜR: hedefin (kategori) hâlâ var olup olmadığı BURADA
   *    kontrol edilmez. Kategori silinmişse kapak yalnızca hiçbir sayfayla
   *    eşleşmez; sayfa kırılmaz. Katılık YAZMA anındadır.
   */
  async readBySlot(slot: SiteImageSlot, targetKey?: string): Promise<{ items: SiteImageView[] }> {
    const rows = await this.prisma.siteImage.findMany({
      where: { slot, isActive: true, ...(targetKey !== undefined ? { targetKey } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: SITE_IMAGE_INCLUDE,
    });

    return { items: rows.map(toPublicView) };
  }

  // ══════════════════════════ YARDIMCILAR ══════════════════════════════════

  /**
   * SLOT ↔ HEDEF DOĞRULAMASI — YAZMA ANINDA KATI.
   *
   * ⚠️ `CATEGORY_COVER` hedefi `Category.id`dir, SLUG DEĞİL. Slug @unique ama
   *    DEĞİŞMEZ değil: yönetici bir gün "kadin-elbise"yi "elbise" yapar ve
   *    slug'a bağlanmış kapak sessizce boşa düşerdi.
   *
   * ⚠️ `COLLECTION_COVER` hedefi `@vt/config` → `KOLEKSIYON_SLUGLARI` içinde
   *    aranır. Koleksiyonların DB karşılığı yok; iniş sayfaları statik.
   */
  private async assertValidTarget(slot: SiteImageSlot, targetKey: string | null): Promise<void> {
    if (slot === 'HERO') {
      // ⚠️ HERO'da hedef VERİLMEMELİ. Sessizce yok saymak yerine reddediliyor:
      //    hedef gönderen istemci bir şeyi yanlış anlamıştır ve o yanlış
      //    anlama, kabul edilirse bir sonraki turda özellik sanılır.
      if (targetKey !== null) {
        throw appError('SITE_IMAGE_TARGET_INVALID', {
          params: { slot },
          internalMessage: 'HERO tek bir yüzeydir, hedef almaz',
        });
      }
      return;
    }

    if (targetKey === null) {
      throw appError('SITE_IMAGE_TARGET_INVALID', {
        params: { slot },
        internalMessage: `${slot} bir hedef ister`,
      });
    }

    if (slot === 'COLLECTION_COVER') {
      if (!(KOLEKSIYON_SLUGLARI as readonly string[]).includes(targetKey)) {
        throw appError('SITE_IMAGE_TARGET_INVALID', {
          params: { slot },
          internalMessage: `Bilinmeyen koleksiyon: ${targetKey}`,
        });
      }
      return;
    }

    const category = await this.prisma.category.findUnique({
      where: { id: targetKey },
      select: { id: true },
    });
    if (!category) {
      throw appError('SITE_IMAGE_TARGET_INVALID', {
        params: { slot },
        internalMessage: `Kategori bulunamadı: ${targetKey}`,
      });
    }
  }

  private async requireAdminView(siteImageId: string): Promise<AdminSiteImageView> {
    const row = await this.prisma.siteImage.findUnique({
      where: { id: siteImageId },
      include: SITE_IMAGE_INCLUDE,
    });
    if (!row) throw appError('SITE_IMAGE_NOT_FOUND');
    return toAdminView(row);
  }

  private async discard(key: string, reason: string): Promise<void> {
    try {
      await this.storage.delete(key, 'private');
    } catch (error) {
      this.logger.warn({ key, reason, err: error }, 'Geçici yükleme silinemedi');
    }
  }

  /** Public kovadaki asıl nesne + türevler. Hata istek düşürmez. */
  private async discardPublic(siteImageId: string): Promise<void> {
    const keys = [
      mediaKeys.siteImageOriginal(siteImageId),
      ...SITE_BANNER_WIDTHS.map((width) => mediaKeys.siteImage(siteImageId, width)),
    ];

    try {
      await this.storage.deleteMany(keys, 'public');
    } catch (error) {
      this.logger.warn({ siteImageId, err: error }, 'Site görseli nesneleri silinemedi');
    }
  }
}

// ══════════════════════════ SORGU ŞEKLİ ════════════════════════════════════

/**
 * Kart verisi TEK SORGUDA gelir.
 *
 * ⚠️ Kart başına ayrı bir `GET /products/:slug` REDDEDİLDİ: ana sayfa
 *    `force-dynamic` ve o gecikme HER görüntülemede ödenirdi.
 *
 * ⚠️ Varyantlar FİYATA GÖRE sıralı ve BİR tane alınıyor. Gösterilen fiyat ile
 *    sepete eklenen varyant AYNI olmak zorunda: liste ekranları en düşük
 *    varyant fiyatını gösteriyor, kart farklı bir varyantı eklerse kullanıcı
 *    sepette başka bir tutar görür.
 */
const SITE_IMAGE_INCLUDE = {
  cards: {
    orderBy: { sortOrder: 'asc' },
    include: {
      product: {
        select: {
          id: true,
          slug: true,
          title: true,
          brandName: true,
          status: true,
          category: { select: { tryOnCategory: true } },
          images: {
            orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
            take: 1,
            select: { storageKey: true },
          },
          variants: {
            where: { isActive: true },
            orderBy: [{ priceMinor: 'asc' }, { sortOrder: 'asc' }],
            take: 1,
            select: { id: true, priceMinor: true, listPriceMinor: true },
          },
        },
      },
    },
  },
} satisfies Prisma.SiteImageInclude;

type SiteImageRow = Prisma.SiteImageGetPayload<{ include: typeof SITE_IMAGE_INCLUDE }>;

// ══════════════════════════ GÖRÜNÜM ÇEVİRİCİLERİ ═══════════════════════════

function toCards(row: SiteImageRow): SiteImageCardView[] {
  return (
    row.cards
      // ⚠️ FK YAYIN DURUMUNU BİLMEZ. Ürün ARCHIVED'a çekilince satır durur
      //    ama kart gösterilmemeli — filtre bu yüzden burada, cascade'e ek.
      .filter((card) => card.product.status === 'PUBLISHED')
      .map((card) => {
        const product = card.product;
        const variant = product.variants[0];
        const tryOnCategory = product.category.tryOnCategory;

        return {
          productId: product.id,
          slug: product.slug,
          title: product.title,
          brandName: product.brandName,
          imageKey: product.images[0]?.storageKey ?? null,
          // ⚠️ Varyant yoksa fiyat da yok. `0n` yazmak "bedava" demek olurdu.
          priceMinor: variant?.priceMinor ?? 0n,
          listPriceMinor: variant?.listPriceMinor ?? null,
          defaultVariantId: variant?.id ?? null,
          /**
           * ⚠️ DENEME KAPISININ TAMAMI BURADA HESAPLANIR, YARISI DEĞİL.
           *    `category.tryOnCategory !== null` yalnızca ilk yarıdır ve
           *    AYAKKABI için de `true` döner; ikinci yarı bugünkü sağlayıcı
           *    yeteneğidir (`isTryOnSupported`). Yalnız ilk yarıya bakan bir
           *    kart, `PRODUCT_NOT_TRYONABLE` ile geri dönen bir düğme çizerdi.
           */
          tryOnable: isTryOnSupported(tryOnCategory as TryOnCategoryName | null),
          tryOnCategory,
        };
      })
  );
}

function toPublicView(row: SiteImageRow): SiteImageView {
  return {
    id: row.id,
    slot: row.slot,
    targetKey: row.targetKey,
    storageKey: row.storageKey,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
    blurhash: row.blurhash,
    title: row.title,
    subtitle: row.subtitle,
    linkHref: row.linkHref,
    cards: toCards(row),
  };
}

function toAdminView(row: SiteImageRow): AdminSiteImageView {
  return {
    ...toPublicView(row),
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
