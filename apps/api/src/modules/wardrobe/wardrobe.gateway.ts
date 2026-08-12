/**
 * GARDIROP MODÜLÜNÜN ADAPTÖRLERİ
 *
 * `wardrobe.ports.ts` içindeki dört portun gerçek karşılıkları. Servis bu
 * dosyayı GÖRMEZ; bağlama `index.ts` içinde yapılır.
 *
 * Dört adaptörün ortak sözleşmesi: hiçbiri iş kuralı taşımaz. Sahiplik,
 * idempotentlik ve gizlilik kararları portların başlıklarında yazılıdır;
 * burada yalnızca o kararların altyapı karşılığı vardır.
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import type { MediaStoragePort } from '../media/media.ports.js';
import type { StylistService } from '../stylist/index.js';
import type { MultiTryOnService } from '../ai/index.js';
import { isWardrobeKey } from './wardrobe.keys.js';
import type {
  WardrobeAutoAddCommand,
  WardrobeItem,
  WardrobeManualAddCommand,
  WardrobeOutfitSuggestion,
  WardrobePhotoStoragePort,
  WardrobeRepositoryPort,
  WardrobeStylistPort,
  WardrobeSuggestionInput,
  WardrobeTryOnPort,
} from './wardrobe.ports.js';

// ══════════════════════════ DEPO ═══════════════════════════════════════════

/** Prisma satırı → port görünümü. Tek yerde, çünkü dört metot da kullanıyor. */
type WardrobeRow = {
  id: string;
  userId: string;
  source: 'PURCHASE' | 'MANUAL';
  variantId: string | null;
  category: WardrobeItem['category'];
  color: string;
  label: string | null;
  photoKey: string | null;
  productImageKey: string | null;
  sourceOrderItemId: string | null;
  createdAt: Date;
};

function toItem(row: WardrobeRow): WardrobeItem {
  return {
    id: row.id,
    userId: row.userId,
    source: row.source,
    variantId: row.variantId,
    category: row.category,
    color: row.color,
    label: row.label,
    photoKey: row.photoKey,
    productImageKey: row.productImageKey,
    sourceOrderItemId: row.sourceOrderItemId,
    createdAt: row.createdAt,
  };
}

/** ⚠️ `updatedAt` ve tablo adı dışında hiçbir kolon dışarı sızmaz. */
const ITEM_SELECT = {
  id: true,
  userId: true,
  source: true,
  variantId: true,
  category: true,
  color: true,
  label: true,
  photoKey: true,
  productImageKey: true,
  sourceOrderItemId: true,
  createdAt: true,
} as const;

@Injectable()
export class PrismaWardrobeRepository implements WardrobeRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listByUser(userId: string): Promise<WardrobeItem[]> {
    const rows = await this.prisma.digitalWardrobeItem.findMany({
      where: { userId },
      // ⚠️ En yeni önce: kombin önerisi kategori başına yalnızca ilk N parçayı
      //    alıyor (bkz. outfit-suggest.ts → MAX_PIECES_PER_CATEGORY), dolayısıyla
      //    kesilen kuyruk kullanıcının en eski parçaları olur.
      orderBy: { createdAt: 'desc' },
      select: ITEM_SELECT,
    });
    return rows.map(toItem);
  }

  async findOwned(userId: string, itemId: string): Promise<WardrobeItem | null> {
    // ⚠️ `userId` SORGUYA girer, sonradan kontrol edilmez.
    const row = await this.prisma.digitalWardrobeItem.findFirst({
      where: { id: itemId, userId },
      select: ITEM_SELECT,
    });
    return row ? toItem(row) : null;
  }

  /**
   * ⚠️ `skipDuplicates: true` → PostgreSQL'de `ON CONFLICT DO NOTHING`.
   *
   *    Port sözleşmesinin talep ettiği tam davranış budur: ekleme öncesi HİÇBİR
   *    OKUMA YAPILMAZ. "Önce var mı diye bak, yoksa yaz" yazılsaydı aynı olayı
   *    aynı anda işleyen iki tüketici de "yok" cevabı alır ve iki satır yazardı;
   *    tekilliği yalnızca UNIQUE(userId, sourceOrderItemId) indeksi kurabilir.
   *
   *    Dönen `count` GERÇEKTEN eklenen satır sayısıdır — çakışanlar sayılmaz,
   *    yani `added < commands.length` bir hata değil, mükerrer teslimat
   *    olayının yutulduğunun kanıtıdır.
   */
  async insertPurchasedIgnoringDuplicates(
    commands: readonly WardrobeAutoAddCommand[],
  ): Promise<number> {
    if (commands.length === 0) return 0;

    const result = await this.prisma.digitalWardrobeItem.createMany({
      data: commands.map((command) => ({
        userId: command.userId,
        source: 'PURCHASE' as const,
        variantId: command.variantId,
        category: command.category,
        color: command.color,
        label: command.label,
        // ⚠️ PURCHASE kaydında `photoKey` YAZILMAZ: satın alınan ürünün görseli
        //    satıcının public pazarlama materyalidir, kullanıcının özel
        //    fotoğrafı değil. İkisi ayrı kolonda durur ki bir sorgu onları aynı
        //    yoldan servis edemesin.
        productImageKey: command.productImageKey,
        sourceOrderItemId: command.sourceOrderItemId,
      })),
      skipDuplicates: true,
    });

    return result.count;
  }

  async insertManual(command: WardrobeManualAddCommand): Promise<WardrobeItem> {
    const row = await this.prisma.digitalWardrobeItem.create({
      data: {
        userId: command.userId,
        source: 'MANUAL',
        // ⚠️ MANUAL kayıtta `variantId` null: parça katalogda yok. Bu bir
        //    eksiklik değil, modülün varlık sebebi.
        variantId: null,
        category: command.category,
        color: command.color,
        label: command.label,
        photoKey: command.photoKey,
        productImageKey: null,
        // ⚠️ null bırakılır: UNIQUE indeksinde PostgreSQL NULL'ları birbirinden
        //    farklı sayar, yani kullanıcı istediği kadar el ile parça ekler.
        sourceOrderItemId: null,
      },
      select: ITEM_SELECT,
    });
    return toItem(row);
  }

  /**
   * ⚠️ SAHİPLİK KOŞULU SORGUNUN İÇİNDE — `DELETE … WHERE id AND userId
   *    RETURNING`.
   *
   *    Prisma'nın `delete()` metodu yalnızca tekil bir anahtarla çalışır, yani
   *    "önce oku, sahibini doğrula, sonra sil" yazmak gerekirdi; o üç adım
   *    arasında satır başkasına geçemez ama KOD bir gün ortadaki kontrolü
   *    kaybedebilir. `deleteMany` ise sahiplik koşulunu alır ama silinen satırı
   *    DÖNDÜRMEZ — oysa depodaki fotoğrafı silmek için `photoKey` gerekiyor.
   *    Ham DELETE … RETURNING ikisini birden verir.
   *
   *    Tüm parametreler `Prisma.sql` ile bağlanır; metin birleştirme yok.
   */
  async deleteOwned(userId: string, itemId: string): Promise<WardrobeItem | null> {
    const rows = await this.prisma.$queryRaw<WardrobeRow[]>(Prisma.sql`
      DELETE FROM "user_wardrobe_items"
      WHERE "id" = ${itemId} AND "userId" = ${userId}
      RETURNING
        "id", "userId", "source", "variantId", "category",
        "color", "label", "photoKey", "productImageKey",
        "sourceOrderItemId", "createdAt"
    `);

    return rows[0] ? toItem(rows[0]) : null;
  }
}

// ══════════════════════════ FOTOĞRAF DEPOSU ════════════════════════════════

/**
 * ⚠️ PRIVATE KOVAYA SABİTLENMİŞ DAR SARMALAYICI.
 *
 * Porta doğrudan `R2StorageProvider` bağlanamaz ve bu bilinçlidir: o sınıf
 * `publicUrl()` de yayımlar, yani gardırop fotoğrafı için kalıcı ve imzasız
 * bir CDN adresi üretmek MÜMKÜN hâle gelirdi. Bu sarmalayıcı o metodu hiç
 * taşımaz — var olmayan metot yanlış kullanılamaz.
 *
 * ⚠️ `visibility` her çağrıda 'private' olarak SABİT verilir, çağırandan
 *    alınmaz. Ayrıca `assertWardrobeKey` her anahtarı doğrular: bu adaptör
 *    `wardrobe/` dışında hiçbir öneke dokunamaz, yani bir gün servise sızan
 *    yabancı bir anahtar (`user-photos/<başkası>/…`) buradan okunamaz.
 */
@Injectable()
export class WardrobePhotoStorage implements WardrobePhotoStoragePort {
  constructor(private readonly storage: MediaStoragePort) {}

  private assertWardrobeKey(key: string): void {
    if (!isWardrobeKey(key)) {
      throw new Error(`Gardırop deposu yalnızca wardrobe/ önekini işler: ${key}`);
    }
  }

  async signedUploadUrl(input: {
    key: string;
    expiresInSeconds: number;
    contentType: string;
    maxSizeBytes: number;
  }): Promise<string> {
    this.assertWardrobeKey(input.key);
    return this.storage.signedUrl({
      key: input.key,
      visibility: 'private',
      operation: 'put',
      expiresInSeconds: input.expiresInSeconds,
      contentType: input.contentType,
      maxSizeBytes: input.maxSizeBytes,
    });
  }

  async signedReadUrl(input: { key: string; expiresInSeconds: number }): Promise<string> {
    this.assertWardrobeKey(input.key);
    return this.storage.signedUrl({
      key: input.key,
      visibility: 'private',
      operation: 'get',
      expiresInSeconds: input.expiresInSeconds,
    });
  }

  async exists(key: string): Promise<boolean> {
    this.assertWardrobeKey(key);
    return this.storage.exists(key, 'private');
  }

  async delete(key: string): Promise<void> {
    this.assertWardrobeKey(key);
    await this.storage.delete(key, 'private');
  }
}

// ══════════════════════════ STİL DANIŞMANI ═════════════════════════════════

/**
 * ⚠️ SADECE DEVİR. Bu sınıfta tek bir moda kuralı yoktur ve olmamalıdır;
 *    kombin kararı `StylistService.suggestOutfits` içindedir (o da
 *    `color-harmony.ts` kural motorunu çağırır).
 *
 * ⚠️ Danışmana giden veri KASITLI OLARAK DAR: kimlik, kategori, renk, etiket.
 *    Fotoğraf, depo anahtarı ve imzalı URL geçmez — servis zaten göndermiyor,
 *    bu adaptör de bir alan EKLEMİYOR.
 */
@Injectable()
export class StylistWardrobeAdapter implements WardrobeStylistPort {
  constructor(private readonly stylist: StylistService) {}

  async suggestOutfits(input: {
    userId: string;
    items: readonly WardrobeSuggestionInput[];
    limit: number;
  }): Promise<WardrobeOutfitSuggestion[]> {
    const suggestions = this.stylist.suggestOutfits({
      userId: input.userId,
      items: input.items.map((item) => ({
        itemId: item.itemId,
        category: item.category,
        color: item.color,
        label: item.label,
      })),
      limit: input.limit,
    });

    return suggestions.map((suggestion) => ({
      itemIds: suggestion.itemIds,
      title: suggestion.title,
      rationale: suggestion.rationale,
      harmony: suggestion.harmony,
    }));
  }
}

// ══════════════════════════ SANAL DENEME ═══════════════════════════════════

/**
 * ⚠️ SADECE DEVİR. Rıza, kota, bütçe ve katman sırası kapılarının hepsi AI
 *    modülündedir; buradan doğrudan sağlayıcıya gidilseydi hepsi atlanırdı.
 *
 * ⚠️ `checkOutfitEligibility` HİÇBİR ŞEY ÜRETMEZ ve kota harcamaz — yalnızca
 *    uygunluk ve katman sırası kapılarını yoklar. Denemeyi gerçekten başlatan
 *    uç `POST /v1/tryon/outfit`tur ve rıza kapısı oradadır.
 */
@Injectable()
export class MultiTryOnWardrobeAdapter implements WardrobeTryOnPort {
  constructor(private readonly tryOn: MultiTryOnService) {}

  async prepareOutfit(input: {
    userId: string;
    variantIds: readonly string[];
  }): Promise<{ available: boolean; reason?: string }> {
    return this.tryOn.checkOutfitEligibility(input.variantIds);
  }
}
