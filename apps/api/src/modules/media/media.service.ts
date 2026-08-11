import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { MEDIA, SIGNED_URL_TTL_SECONDS, TRYON } from '@vt/config';
import { appError } from '@vt/contracts';
import { Prisma } from '@vt/db';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { PrismaService } from '../../infra/prisma.service.js';
import type { Logger } from '../../common/logger.js';
import { detectImageFormat, looksLikeItHasExif } from './image-format.js';
import { MEDIA_IMAGE_PROCESSOR, type ImageProcessor } from './image-processor.js';
import {
  MEDIA_CONSENT,
  MEDIA_STORAGE,
  mediaKeys,
  type MediaConsentPort,
  type MediaStoragePort,
} from './media.ports.js';
import { isPhotoQualityAcceptable, scorePhotoQuality } from './photo-quality.js';
import { photoExpiresAt, requiresStorageConsent } from './photo-retention.js';
import type { UserPhotoConfirmInput, UserPhotoUploadInput } from './media.schema.js';

export interface UploadTicket {
  /** Onay çağrısında yol parametresi olarak kullanılır (`/…/:id/confirm`). */
  uploadId: string;
  uploadUrl: string;
  /** İstemci PUT ederken bu başlığı AYNEN göndermeli, aksi hâlde imza tutmaz. */
  requiredContentType: string;
  maxSizeBytes: number;
  expiresInSeconds: number;
}

export interface UserPhotoView {
  id: string;
  qualityScore: number;
  qualityIssues: string[];
  widthPx: number;
  heightPx: number;
  sizeBytes: number;
  purpose: string;
  expiresAt: Date;
  /** Kısa ömürlü imzalı görüntüleme adresi. Kalıcı bağlantı VERİLMEZ. */
  viewUrl: string;
  createdAt: Date;
}

/**
 * ═══════════════════════ KULLANICI FOTOĞRAFI SERVİSİ ════════════════════════
 *
 * Sahip olduğu tablo: `UserPhoto`.
 *
 * AKIŞ İKİ ADIMLIDIR ve bu bilinçlidir:
 *
 *   1. `requestUpload` → imzalı PUT URL'i üretir. VERİTABANINA HİÇBİR ŞEY
 *      YAZMAZ. Yarım kalan yükleme geride kayıt bırakmaz; "yükleniyor"
 *      durumunda ölü satırlar birikmez.
 *
 *   2. `confirmUpload` → dosyayı depodan okur, biçimini DOĞRULAR, EXIF'ini
 *      TEMİZLER, kalitesini ölçer ve ancak geçerse satırı yazar.
 *
 * ⚠️ Dosya imzalı URL ile doğrudan depoya gittiği için sunucu yükleme anında
 *    içeriği görmez. Bütün doğrulama (biçim, boyut, kalite, EXIF) 2. adımda
 *    yapılır; 1. adımdaki beyanlar yalnızca imzaya gömülen kısıtlardır.
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStoragePort,
    @Inject(MEDIA_IMAGE_PROCESSOR) private readonly processor: ImageProcessor,
    @Inject(MEDIA_CONSENT) private readonly consent: MediaConsentPort,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  /** POST /me/photos — imzalı yükleme adresi üretir. */
  async requestUpload(userId: string, input: UserPhotoUploadInput): Promise<UploadTicket> {
    await this.assertConsent(userId, input.purpose);

    const photoId = randomUUID();
    // ⚠️ Anahtar OTURUMDAKİ kullanıcıdan üretilir. İstemci ne gönderirse
    //    göndersin başka bir kullanıcının alanına yazamaz.
    const key = mediaKeys.userPhoto(userId, photoId);

    const uploadUrl = await this.storage.signedUrl({
      key,
      visibility: 'private', // ⚠️ Kullanıcı fotoğrafı ASLA public kovaya gitmez.
      operation: 'put',
      expiresInSeconds: MEDIA.uploadUrlTtlSeconds,
      contentType: input.contentType,
      maxSizeBytes: input.sizeBytes,
    });

    return {
      uploadId: photoId,
      uploadUrl,
      requiredContentType: input.contentType,
      maxSizeBytes: input.sizeBytes,
      expiresInSeconds: MEDIA.uploadUrlTtlSeconds,
    };
  }

  /**
   * POST /me/photos/:id/confirm — yüklenen dosyayı doğrular ve kaydeder.
   *
   * ⚠️ Rıza BURADA TEKRAR sorulur. İki istek arasında kullanıcı rızasını geri
   *    çekmiş olabilir ve fotoğraf kalıcı hâle asıl bu adımda geliyor.
   */
  async confirmUpload(
    userId: string,
    photoId: string,
    input: UserPhotoConfirmInput,
  ): Promise<UserPhotoView> {
    await this.assertConsent(userId, input.purpose);

    const key = mediaKeys.userPhoto(userId, photoId);

    if (!(await this.storage.exists(key, 'private'))) {
      throw appError('PHOTO_NOT_FOUND', {
        internalMessage: `Onaylanmak istenen nesne depoda yok: ${key}`,
      });
    }

    const raw = await this.storage.get(key, 'private');

    if (raw.byteLength > MEDIA.maxUploadBytes) {
      await this.discard(key, 'boyut tavanı aşıldı');
      throw appError('PHOTO_TOO_LARGE', {
        params: { maxMb: Math.floor(MEDIA.maxUploadBytes / (1024 * 1024)) },
      });
    }

    // ⚠️ Biçim SİHİRLİ BAYTLARDAN okunur. `Content-Type` istemci beyanıdır ve
    //    "image/jpeg" diye bildirilmiş bir HTML dosyası saklı XSS'e dönüşür.
    const detected = detectImageFormat(raw);
    if (detected === null) {
      await this.discard(key, 'desteklenmeyen içerik');
      throw appError('PHOTO_INVALID_FORMAT', {
        internalMessage: `Tanınmayan görsel içeriği: ${key}`,
      });
    }

    // ⚠️ EXIF/GPS TEMİZLİĞİ. Kullanıcı fotoğrafının konum verisi, kişinin ev
    //    adresidir; sanal deneme sağlayıcısına da bu temizlenmiş sürüm gider.
    //    JPEG seçiliyor: AI sağlayıcılarının tamamı WebP kabul etmiyor ve
    //    biçim yüzünden düşen bir try-on kullanıcının kotasını boşa yakar.
    const sanitized = await this.processor.sanitize(raw, { format: 'jpeg' });

    if (looksLikeItHasExif(sanitized.buffer)) {
      // Buraya düşmek işleyicinin metadata yazdığı anlamına gelir; fotoğrafı
      // kaydetmek yerine akışı durdur. Sessizce devam etmek, tam da
      // engellemeye çalıştığımız sızıntıyı üretir.
      await this.discard(key, 'EXIF temizliği doğrulanamadı');
      this.logger.error({ userId }, 'EXIF temizliği sonrası metadata tespit edildi');
      throw appError('SERVICE_UNAVAILABLE', {
        internalMessage: 'Temizlenmiş görselde hâlâ EXIF var — işleyici yapılandırması hatalı',
      });
    }

    const analysis = await this.processor.analyze(sanitized.buffer);
    const quality = scorePhotoQuality(analysis);

    if (!isPhotoQualityAcceptable(quality)) {
      // ⚠️ Reddedilen fotoğraf DEPODA BIRAKILMAZ: işlenmeyecek bir kişisel
      //    veriyi saklamanın hukuki dayanağı yok (veri minimizasyonu).
      await this.discard(key, `kalite skoru ${quality.score}`);
      throw appError('PHOTO_QUALITY_LOW', {
        params: { reason: quality.reason },
        details: {
          score: quality.score,
          minScore: TRYON.minPhotoQualityScore,
          issues: quality.issues,
        },
      });
    }

    // ⚠️ Temizlenmiş sürüm ham dosyanın ÜZERİNE yazılır. Ham dosya (EXIF'li)
    //    depoda kalmamalı; ayrı bir anahtara yazılsaydı iki kopya oluşur ve
    //    silme akışının ikisini de bulması gerekirdi.
    await this.storage.put({
      key,
      visibility: 'private',
      body: sanitized.buffer,
      contentType: sanitized.contentType,
      metadata: { purpose: input.purpose },
    });

    // ⚠️ İçerik özeti TEMİZLENMİŞ baytlardan alınır: try-on önbelleği bu
    //    anahtarla çalışır ve modele giden görüntü de budur. Ham baytların
    //    özeti alınsaydı aynı fotoğrafı farklı cihazdan yükleyen kullanıcı
    //    (EXIF farkı yüzünden) önbelleği ıskalardı.
    const contentHash = createHash('sha256').update(sanitized.buffer).digest('hex');

    const expiresAt = photoExpiresAt(input.purpose, new Date());

    const photo = await this.prisma.userPhoto.upsert({
      // `storageKey` benzersiz: aynı onayın tekrarı ikinci satır açmaz.
      where: { storageKey: key },
      create: {
        id: photoId,
        userId,
        storageKey: key,
        purpose: input.purpose,
        qualityScore: quality.score,
        qualityIssues: quality.issues as unknown as Prisma.InputJsonValue,
        contentHash,
        widthPx: sanitized.widthPx,
        heightPx: sanitized.heightPx,
        sizeBytes: sanitized.sizeBytes,
        expiresAt,
      },
      update: {
        purpose: input.purpose,
        qualityScore: quality.score,
        qualityIssues: quality.issues as unknown as Prisma.InputJsonValue,
        contentHash,
        widthPx: sanitized.widthPx,
        heightPx: sanitized.heightPx,
        sizeBytes: sanitized.sizeBytes,
        expiresAt,
        deletedAt: null,
      },
    });

    this.logger.info(
      { photoId: photo.id, purpose: input.purpose, qualityScore: quality.score },
      'Kullanıcı fotoğrafı kaydedildi',
    );

    return this.toView(photo, await this.viewUrl(key));
  }

  /**
   * DELETE /me/photos/:id
   *
   * ⚠️ SIRA ÖNEMLİ: ÖNCE DEPODAN, sonra veritabanından.
   *    Tersi yapılsaydı ve depo silme başarısız olsaydı, hangi nesnenin
   *    silineceğini gösteren tek kayıt kaybolur ve dosya sonsuza kadar depoda
   *    kalırdı (yetim nesne). Bu sırayla en kötü ihtimalle satır "silinmemiş"
   *    kalır ve saklama cron'u tekrar dener.
   */
  async deletePhoto(userId: string, photoId: string): Promise<{ id: string; deleted: true }> {
    const photo = await this.prisma.userPhoto.findFirst({
      // ⚠️ `userId` sorgu koşulu — başkasının fotoğrafı silinemez.
      where: { id: photoId, userId, deletedAt: null },
      select: { id: true, storageKey: true },
    });

    if (!photo) throw appError('PHOTO_NOT_FOUND');

    await this.storage.delete(photo.storageKey, 'private');

    await this.prisma.$transaction(async (tx) => {
      await tx.userPhoto.update({
        where: { id: photo.id },
        data: { deletedAt: new Date() },
      });

      // ⚠️ Türetilmiş veriler (try-on sonuç görselleri) BAŞKA modülün
      //    tablosunda. Doğrudan yazmak yerine olay bırakılıyor (kural 4);
      //    tüketici, bu fotoğraftan üretilmiş çıktıları temizler. Olay aynı
      //    transaction'da yazılıyor ki "silindi ama haber gitmedi" durumu
      //    oluşmasın.
      await tx.outboxEvent.create({
        data: {
          aggregate: 'user_photo',
          aggregateId: photo.id,
          type: 'user_photo.deleted',
          payload: { photoId: photo.id, userId, storageKey: photo.storageKey },
        },
      });
    });

    this.logger.info({ photoId: photo.id }, 'Kullanıcı fotoğrafı silindi');

    return { id: photo.id, deleted: true };
  }

  // ── Yardımcılar ─────────────────────────────────────────────────────────

  /**
   * ⚠️ KVKK RIZA KAPISI. Fotoğraf özel nitelikli kişisel veridir; işlemek
   *    için AÇIK RIZA şarttır. "Profilimde sakla" ayrı ve daha ağır bir
   *    izindir — tek rızaya bağlanması, denemek isteyen kullanıcıyı saklamaya
   *    da razı olmaya zorlardı.
   */
  private async assertConsent(
    userId: string,
    purpose: UserPhotoUploadInput['purpose'],
  ): Promise<void> {
    if (!(await this.consent.hasActiveConsent(userId, 'PHOTO_PROCESSING'))) {
      throw appError('CONSENT_REQUIRED', {
        details: { requiredConsent: 'PHOTO_PROCESSING' },
      });
    }

    if (
      requiresStorageConsent(purpose) &&
      !(await this.consent.hasActiveConsent(userId, 'PHOTO_STORAGE'))
    ) {
      throw appError('CONSENT_REQUIRED', {
        details: { requiredConsent: 'PHOTO_STORAGE' },
      });
    }
  }

  /**
   * Reddedilen yüklemeyi depodan kaldırır.
   *
   * Silme başarısız olursa istek yine de reddedilir; nesne private kovada
   * kalır ve saklama süresi temizliği onu bir sonraki turda toplayamaz
   * (satırı yok) — bu yüzden hata WARN olarak loglanır ve izlenir.
   */
  private async discard(key: string, reason: string): Promise<void> {
    try {
      await this.storage.delete(key, 'private');
    } catch (error) {
      this.logger.warn({ key, reason, err: error }, 'Reddedilen yükleme depodan silinemedi');
    }
  }

  private async viewUrl(key: string): Promise<string> {
    return this.storage.signedUrl({
      key,
      visibility: 'private',
      operation: 'get',
      // Ömür sabitten okunur; uzun bir bağlantı, linki gören herkese erişimdir.
      expiresInSeconds: SIGNED_URL_TTL_SECONDS.userPhoto,
    });
  }

  private toView(
    photo: {
      id: string;
      qualityScore: number | null;
      qualityIssues: unknown;
      widthPx: number;
      heightPx: number;
      sizeBytes: number;
      purpose: string;
      expiresAt: Date;
      createdAt: Date;
    },
    viewUrl: string,
  ): UserPhotoView {
    return {
      id: photo.id,
      qualityScore: photo.qualityScore ?? 0,
      qualityIssues: Array.isArray(photo.qualityIssues) ? (photo.qualityIssues as string[]) : [],
      widthPx: photo.widthPx,
      heightPx: photo.heightPx,
      sizeBytes: photo.sizeBytes,
      purpose: photo.purpose,
      expiresAt: photo.expiresAt,
      viewUrl,
      createdAt: photo.createdAt,
    };
  }
}
