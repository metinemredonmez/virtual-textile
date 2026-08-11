import { Injectable } from '@nestjs/common';
import { appError } from '@vt/contracts';

/**
 * GÖRSEL İŞLEME ARAYÜZÜ
 *
 * Gerçek `sharp` çağrıları TEK dosyada toplanmıştır: sharp-image-processor.ts.
 * Servisler yalnızca bu arayüzü görür, böylece:
 *   • bağımlılık geldiğinde tek dosya değişir,
 *   • skor hesabı ve akış testleri native bir kütüphane olmadan çalışır,
 *   • "EXIF nerede siliniyor" sorusunun cevabı tek yerde kalır.
 */

export const MEDIA_IMAGE_PROCESSOR = 'MEDIA_IMAGE_PROCESSOR_PORT';

export interface ProcessedImage {
  buffer: Buffer;
  contentType: string;
  widthPx: number;
  heightPx: number;
  sizeBytes: number;
}

export interface SanitizeOptions {
  /**
   * Çıktı biçimi.
   *  webp → ürün görselleri (küçük dosya, CDN maliyeti düşük)
   *  jpeg → kullanıcı fotoğrafları; AI sağlayıcılarının hepsi webp kabul
   *         etmiyor ve girdi biçimi yüzünden başarısız olan bir try-on,
   *         kullanıcı kotasını boşa yakar.
   */
  format?: 'webp' | 'jpeg';
  /** Uzun kenar tavanı. Aşırı büyük görsel hem depo hem GPU maliyetidir. */
  maxDimensionPx?: number;
  quality?: number;
}

/** Skor hesaplarının ihtiyaç duyduğu ölçümler. Saf sayılar — karar içermez. */
export interface ImageAnalysis {
  widthPx: number;
  heightPx: number;
  /** 0-255 ortalama parlaklık (luma). */
  meanLuminance: number;
  /** 0-100; yüksek = net. Laplace varyansının ölçeklenmiş hâli. */
  sharpness: number;
  /** 0-100; yüksek = sade/tek renk arka plan (kenar bandı renk sapması). */
  backgroundUniformity: number;
  /** Konu görüntünün kenarına değiyor mu → kırpılmış. */
  subjectTouchesEdge: boolean;
}

export interface DerivedImage extends ProcessedImage {
  width: number;
}

export interface ImageProcessor {
  readonly name: string;

  /**
   * ⚠️ EXIF/XMP/IPTC TEMİZLİĞİ ZORUNLU — GPS koordinatı, cihaz seri numarası
   *    ve çekim zamanı taşır. Kullanıcı fotoğrafında bu veri, kişinin ev
   *    adresidir; satıcı görselinde atölye adresidir. Metadata KORUNARAK
   *    yeniden kodlama YAPILMAZ.
   *
   * Yönlendirme (orientation) metadata'sı silinmeden önce piksellere
   * UYGULANIR; yoksa temizlenen fotoğraf yan döner.
   */
  sanitize(input: Buffer, options?: SanitizeOptions): Promise<ProcessedImage>;

  analyze(input: Buffer): Promise<ImageAnalysis>;

  /** Duyarlı (responsive) türevler. Orijinalden BÜYÜK genişlik üretilmez. */
  derive(input: Buffer, widths: readonly number[]): Promise<DerivedImage[]>;

  /**
   * Yükleme sırasında gösterilen bulanık yer tutucu.
   *
   * `null` dönebilir: blurhash kodlayıcısı ayrı bir bağımlılıktır ve yoksa
   * görselin yüklenmesi ENGELLENMEZ — yer tutucu bir kolaylıktır, güvenlik
   * gereği değil. `ProductImage.blurhash` bu yüzden nullable.
   */
  blurhash(input: Buffer): Promise<string | null>;
}

/**
 * İŞLEYİCİ BAĞLANMAMIŞ.
 *
 * ⚠️ KAPALIYA DÜŞER (fail-closed). "İşleyici yok, dosyayı olduğu gibi kaydet"
 *    davranışı, EXIF'i temizlenmemiş — yani GPS konumu içeren — fotoğrafın
 *    depoya girmesi demektir. Bir görsel işlenemiyorsa yüklenmez.
 */
@Injectable()
export class UnconfiguredImageProcessor implements ImageProcessor {
  readonly name = 'unconfigured';

  sanitize(): Promise<ProcessedImage> {
    return Promise.reject(this.fail('sanitize'));
  }
  analyze(): Promise<ImageAnalysis> {
    return Promise.reject(this.fail('analyze'));
  }
  derive(): Promise<DerivedImage[]> {
    return Promise.reject(this.fail('derive'));
  }
  blurhash(): Promise<string | null> {
    return Promise.reject(this.fail('blurhash'));
  }

  private fail(operation: string): Error {
    return appError('SERVICE_UNAVAILABLE', {
      internalMessage: `Görsel işleyici bağlanmamış (${operation}) — sharp kurulup MEDIA_IMAGE_PROCESSOR token'ı SharpImageProcessor'a bağlanmalı`,
    });
  }
}
