/**
 * ═══════════════ GEÇİCİ KÖPRÜLER — SİLİNMEK ÜZERE YAZILDI ═══════════════════
 *
 * Kural 3 gereği medya modülü başka modülün Prisma modeline dokunmaz.
 *
 * Medya modülünün SAHİP OLDUĞU tablo: `UserPhoto` (ai_user_photos). Fotoğrafın
 * yaşam döngüsü (yükleme, kalite kararı, saklama süresi, silme) baştan sona
 * burada yönetiliyor.
 *
 * Sahip OLMADIĞI veriler:
 *   • ProductImage / Product → KATALOG modülü. Katalog henüz satıcı tarafı bir
 *     görsel yazma yüzeyi yayımlamadığı için `MediaCatalogPort` köprüsü var.
 *   • ConsentRecord → KİMLİK/KULLANICI modülü. Rıza okuma yüzeyi yayımlanmadı.
 *
 * ⚠️ ENTEGRASYON AJANI İÇİN: ilgili servisler yayımlandığında `index.ts`
 *    içindeki token bağlamalarını onlara çevirin ve BU DOSYAYI SİLİN.
 *    Medya servislerinde tek satır değişmez.
 */
import { Injectable } from '@nestjs/common';
import { AppError, appError } from '@vt/contracts';
import { Prisma } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import type {
  AddProductImageCommand,
  MediaCatalogPort,
  MediaConsentPort,
  MediaConsentType,
  MediaProductImage,
  MediaStoragePort,
  PutObjectInput,
  SignedUrlInput,
  StorageVisibility,
} from './media.ports.js';
import type { TryOnReadinessIssue } from './tryon-readiness.js';

const imageSelect = {
  id: true,
  productId: true,
  storageKey: true,
  angle: true,
  isPrimary: true,
  blurhash: true,
  widthPx: true,
  heightPx: true,
  sortOrder: true,
} as const;

@Injectable()
export class PrismaMediaCatalogBridge implements MediaCatalogPort {
  constructor(private readonly prisma: PrismaService) {}

  async findProduct(sellerId: string, productId: string): Promise<{ id: string } | null> {
    // ⚠️ `sellerId` SORGU KOŞULU. Önce ürünü okuyup sonra sahibini
    //    karşılaştırsaydık, o karşılaştırmanın bir gün düşmesiyle satıcı
    //    başka mağazanın ürününe görsel ekleyebilirdi.
    return this.prisma.product.findFirst({
      where: { id: productId, sellerId },
      select: { id: true },
    });
  }

  async listImages(productId: string): Promise<MediaProductImage[]> {
    return this.prisma.productImage.findMany({
      where: { productId },
      select: imageSelect,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async addImage(
    sellerId: string,
    productId: string,
    input: AddProductImageCommand,
  ): Promise<{ image: MediaProductImage; images: MediaProductImage[] }> {
    return this.prisma.$transaction(async (tx) => {
      const owned = await tx.product.findFirst({
        where: { id: productId, sellerId },
        select: { id: true },
      });
      if (!owned) throw appError('PRODUCT_NOT_FOUND');

      // Aynı anahtar zaten yazılmışsa yeni satır AÇILMAZ: onay isteği ağ
      // zaman aşımında tekrarlanabilir ve ürün aynı görseli iki kez
      // göstermemelidir. `storageKey` benzersizlik kısıtı taşımadığı için
      // tekilleştirme burada, transaction içinde yapılıyor.
      const existing = await tx.productImage.findFirst({
        where: { productId, storageKey: input.storageKey },
        select: imageSelect,
      });

      if (!existing && input.isPrimary) {
        // Tek bir birincil görsel olabilir; yenisi gelince eskisi düşer.
        await tx.productImage.updateMany({
          where: { productId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      const image =
        existing ??
        (await tx.productImage.create({
          data: {
            id: input.imageId,
            productId,
            storageKey: input.storageKey,
            angle: input.angle,
            isPrimary: input.isPrimary,
            blurhash: input.blurhash,
            widthPx: input.widthPx,
            heightPx: input.heightPx,
            sortOrder: 0,
          },
          select: imageSelect,
        }));

      const images = await tx.productImage.findMany({
        where: { productId },
        select: imageSelect,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });

      return { image, images };
    });
  }

  async saveReadiness(
    sellerId: string,
    productId: string,
    score: number,
    issues: readonly TryOnReadinessIssue[],
  ): Promise<void> {
    // ⚠️ Yarış durumu bilinçli olarak "son yazan kazanır" bırakıldı: iki
    //    görsel aynı anda onaylanırsa skor kısa süre eksik veriyle yazılabilir
    //    ve bir sonraki yüklemede düzelir. Skor TAVSİYEDİR — para, stok veya
    //    yetki değil. Kilitlemek, satıcı panelinde nadiren görülen bir sayı
    //    için transaction maliyeti demek olurdu.
    await this.prisma.product.updateMany({
      where: { id: productId, sellerId },
      data: { tryOnScore: score, tryOnIssues: issues as unknown as Prisma.InputJsonValue },
    });
  }
}

/**
 * RIZA OKUMA KÖPRÜSÜ
 *
 * ⚠️ "granted: true kaydı var mı" DEĞİL, "EN SON kayıt granted mı" sorulur.
 *    Rıza kayıtları geçmiştir; geri çekme yeni bir satırla (granted: false)
 *    yazılır. İlk sorgu biçimi, rızasını geri çekmiş kullanıcının fotoğrafını
 *    işlemeye devam etmek anlamına gelirdi.
 */
@Injectable()
export class PrismaMediaConsentBridge implements MediaConsentPort {
  constructor(private readonly prisma: PrismaService) {}

  async hasActiveConsent(userId: string, type: MediaConsentType): Promise<boolean> {
    const latest = await this.prisma.consentRecord.findFirst({
      where: { userId, type },
      orderBy: { createdAt: 'desc' },
      select: { granted: true },
    });
    return latest?.granted === true;
  }
}

/**
 * DEPOLAMA YAPILANDIRILMAMIŞ — FAIL-CLOSED YER TUTUCU.
 *
 * ⚠️ Bu GEÇİCİ bir bağımlılık stubu DEĞİLDİR ve silinmemelidir. Gerçek depo
 *    `index.ts` içinde `r2StorageFromEnv()` ile bağlanır; buraya yalnızca R2
 *    ANAHTARLARI yokken düşülür. Yani bu sınıf, anahtarsız bir ortamın
 *    sessizce "yükledim/sildim" demesini engelleyen kalıcı güvenliktir.
 *
 * ⚠️ Sessizce başarılı DÖNMEZ. Yapılandırılmamış bir deponun "yüklendi" demesi,
 *    ürün görselinin kaybolmasından ve — çok daha kötüsü — kullanıcının
 *    "fotoğrafım silindi" sanmasından sorumlu olurdu. Her çağrı görünür
 *    biçimde hata verir.
 */
@Injectable()
export class UnconfiguredStorageProvider implements MediaStoragePort {
  readonly name = 'unconfigured';

  put(_input: PutObjectInput): Promise<{ key: string; etag: string }> {
    return Promise.reject(this.fail('put'));
  }
  get(_key: string, _visibility: StorageVisibility): Promise<Buffer> {
    return Promise.reject(this.fail('get'));
  }
  delete(_key: string, _visibility: StorageVisibility): Promise<void> {
    return Promise.reject(this.fail('delete'));
  }
  deleteMany(_keys: string[], _visibility: StorageVisibility): Promise<void> {
    return Promise.reject(this.fail('deleteMany'));
  }
  exists(_key: string, _visibility: StorageVisibility): Promise<boolean> {
    return Promise.reject(this.fail('exists'));
  }
  signedUrl(_input: SignedUrlInput): Promise<string> {
    return Promise.reject(this.fail('signedUrl'));
  }
  publicUrl(_key: string): string {
    throw this.fail('publicUrl');
  }

  private fail(operation: string): AppError {
    return appError('SERVICE_UNAVAILABLE', {
      internalMessage: `Depolama sağlayıcısı bağlanmamış (${operation}) — MEDIA_STORAGE token'ı R2StorageProvider'a bağlanmalı`,
    });
  }
}
