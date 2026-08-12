// GÖRÜNTÜ KÜTÜPHANESİ SARMALAYICISI.
//
// `sharp` kurulu ve bağlı (bkz. media/index.ts → createImageProcessor), ama bu
// dosyada doğrudan `import` EDİLMEZ: kullandığımız yüzey aşağıda yapısal
// arayüzle tanımlanıp yapıcıya DIŞARIDAN geçilir.
//
// ⚠️ Bu enjeksiyon bir eksiklik değil, TASARIM: `sharp` gerçek bir kodek
//    yığınıdır ve testte onunla çalışmak yavaş+kırılgandır. Yüzey dar
//    tutulduğu için testler sahte bir fabrika geçebiliyor; EXIF/GPS temizliği
//    gibi güvenlik davranışları da bu sayede kütüphane olmadan doğrulanabiliyor.
//    Gerçek `sharp`ı `import` eden TEK yer media/index.ts'tir.
//
// İkinci bağımlılık `blurhash` KURULDU ve media/index.ts tarafından geçiliyor.
// Aynı gerekçeyle burada da `import` edilmez: `encodeBlurhash` seçeneği
// verilmezse `blurhash()` null döner ve yükleme akışı etkilenmez — testler bu
// yolu paketi kurmak zorunda kalmadan kurabiliyor.

import { Injectable } from '@nestjs/common';
import { MEDIA } from '@vt/config';
import { appError } from '@vt/contracts';
import { ANALYSIS_SIZE, analyzeGrayscale } from './image-analysis.js';
import type {
  DerivedImage,
  ImageAnalysis,
  ImageProcessor,
  ProcessedImage,
  SanitizeOptions,
} from './image-processor.js';

// ── sharp'ın kullandığımız yüzeyi ──────────────────────────────────────────

export interface SharpMetadata {
  width?: number | undefined;
  height?: number | undefined;
  format?: string | undefined;
}

export interface SharpBufferResult {
  data: Buffer;
  info: { width: number; height: number; size: number; channels: number };
}

export interface SharpResizeOptions {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  withoutEnlargement?: boolean;
}

export interface SharpInstance {
  rotate(): SharpInstance;
  resize(options: SharpResizeOptions): SharpInstance;
  greyscale(): SharpInstance;
  webp(options: { quality: number }): SharpInstance;
  jpeg(options: { quality: number; mozjpeg?: boolean }): SharpInstance;
  raw(): SharpInstance;
  metadata(): Promise<SharpMetadata>;
  toBuffer(options: { resolveWithObject: true }): Promise<SharpBufferResult>;
}

export interface SharpFactoryOptions {
  limitInputPixels?: number;
  failOn?: 'none' | 'truncated' | 'error' | 'warning';
}

export type SharpFactory = (input: Buffer, options?: SharpFactoryOptions) => SharpInstance;

/** blurhash paketinin `encode` imzası. */
export type BlurhashEncoder = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  componentX: number,
  componentY: number,
) => string;

export interface SharpImageProcessorOptions {
  encodeBlurhash?: BlurhashEncoder;
  /** Ürün görselleri için WebP kalitesi. */
  webpQuality?: number;
  /** Kullanıcı fotoğrafları için JPEG kalitesi. */
  jpegQuality?: number;
}

/**
 * ⚠️ SIKIŞTIRMA BOMBASI KORUMASI. 100 KB'lık bir PNG, açıldığında 40 000 ×
 *    40 000 piksele genişleyebilir ve süreci belleğiyle birlikte öldürür.
 *    İmzalı URL ile gelen dosya bizim üretmediğimiz bir dosyadır; piksel
 *    tavanı boyut tavanının yerine geçmez, ikisi ayrı saldırıyı kapatır.
 */
const MAX_INPUT_PIXELS = 50_000_000;

const DEFAULT_WEBP_QUALITY = 82;
const DEFAULT_JPEG_QUALITY = 88;

/** Uzun kenar tavanları — üstü ne kaliteye ne modele katkı sağlar. */
const MAX_PRODUCT_DIMENSION = 2048;
const MAX_USER_PHOTO_DIMENSION = 1536;

/**
 * SHARP TABANLI GÖRSEL İŞLEYİCİ
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ EXIF/GPS TEMİZLİĞİ BURADA OLUR VE ŞÖYLE ÇALIŞIR:
 *
 *    sharp, `.withMetadata()` ÇAĞRILMADIKÇA çıktıya metadata YAZMAZ. Yani
 *    temizlik "silme" değil, "hiç kopyalamama" ile sağlanır. Bu dosyada
 *    `.withMetadata()` çağrısı YOKTUR ve EKLENMEMELİDİR: tek satırla
 *    kullanıcının ev konumu ve cihaz seri numarası depoya girer.
 *
 *    `.rotate()` argümansız çağrılıyor; EXIF yönlendirmesini PİKSELLERE
 *    uygular. Metadata atıldığı için bu yapılmazsa dikey çekilmiş fotoğraf
 *    yan yatar ve kalite skoru haksız yere düşer.
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class SharpImageProcessor implements ImageProcessor {
  readonly name = 'sharp';

  private readonly webpQuality: number;
  private readonly jpegQuality: number;
  private readonly encodeBlurhash: BlurhashEncoder | undefined;

  constructor(
    private readonly sharp: SharpFactory,
    options: SharpImageProcessorOptions = {},
  ) {
    this.webpQuality = options.webpQuality ?? DEFAULT_WEBP_QUALITY;
    this.jpegQuality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY;
    this.encodeBlurhash = options.encodeBlurhash;
  }

  async sanitize(input: Buffer, options: SanitizeOptions = {}): Promise<ProcessedImage> {
    const format = options.format ?? 'webp';
    const maxDimension =
      options.maxDimensionPx ??
      (format === 'jpeg' ? MAX_USER_PHOTO_DIMENSION : MAX_PRODUCT_DIMENSION);

    return this.guard('sanitize', async () => {
      const pipeline = this.open(input).rotate().resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      });

      const encoded =
        format === 'jpeg'
          ? pipeline.jpeg({ quality: options.quality ?? this.jpegQuality, mozjpeg: true })
          : pipeline.webp({ quality: options.quality ?? this.webpQuality });

      const { data, info } = await encoded.toBuffer({ resolveWithObject: true });

      return {
        buffer: data,
        contentType: format === 'jpeg' ? 'image/jpeg' : 'image/webp',
        widthPx: info.width,
        heightPx: info.height,
        sizeBytes: info.size,
      };
    });
  }

  async analyze(input: Buffer): Promise<ImageAnalysis> {
    return this.guard('analyze', async () => {
      // Ölçüm sabit boyutlu gri görüntü üzerinde yapılır: hem ucuz, hem de
      // skorlar görselin çözünürlüğünden bağımsız olarak karşılaştırılabilir.
      const { data, info } = await this.open(input)
        .rotate()
        .greyscale()
        .resize({ width: ANALYSIS_SIZE, height: ANALYSIS_SIZE, fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Gerçek boyutlar döndürülmüş piksellerden okunur; metadata'daki
      // genişlik/yükseklik EXIF yönlendirmesi uygulanmadan öncekidir ve
      // dikey fotoğrafta ters çıkar.
      const rotated = await this.open(input).rotate().toBuffer({ resolveWithObject: true });

      return analyzeGrayscale(
        { data: new Uint8Array(data), width: info.width, height: info.height },
        rotated.info.width,
        rotated.info.height,
      );
    });
  }

  async derive(input: Buffer, widths: readonly number[]): Promise<DerivedImage[]> {
    return this.guard('derive', async () => {
      const source = await this.open(input).metadata();
      const sourceWidth = source.width ?? 0;

      // Orijinalden büyük türev üretilmez: yapay büyütme dosya boyutunu
      // artırır, kaliteyi artırmaz. Kaynak zaten küçükse en az bir türev
      // kalsın diye kaynak genişliği listeye eklenir.
      const targets = widths.filter((width) => width <= sourceWidth);
      const effective = targets.length > 0 ? targets : [Math.max(1, sourceWidth)];

      const results: DerivedImage[] = [];
      for (const width of effective) {
        const { data, info } = await this.open(input)
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: this.webpQuality })
          .toBuffer({ resolveWithObject: true });

        results.push({
          width,
          buffer: data,
          contentType: 'image/webp',
          widthPx: info.width,
          heightPx: info.height,
          sizeBytes: info.size,
        });
      }
      return results;
    });
  }

  async blurhash(input: Buffer): Promise<string | null> {
    const encode = this.encodeBlurhash;
    if (!encode) return null;

    return this.guard('blurhash', async () => {
      const { data, info } = await this.open(input)
        .rotate()
        .resize({ width: 32, height: 32, fit: 'inside' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      // blurhash RGBA bekler; sharp raw çıktısı kanal sayısına göre değişir.
      const rgba = toRgba(data, info.width, info.height, info.channels);
      return encode(rgba, info.width, info.height, 4, 3);
    });
  }

  /** Ortak açılış — piksel tavanı ve kısmi dosya reddi tek yerde. */
  private open(input: Buffer): SharpInstance {
    return this.sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      // Yarım inen dosya sessizce "işlendi" sayılmasın.
      failOn: 'truncated',
    });
  }

  /**
   * Kütüphane hatalarını uygulama hatasına çevirir.
   *
   * Bozuk/desteklenmeyen dosya kullanıcı hatasıdır (422) — Sentry'ye system
   * hatası olarak düşerse gerçek arızalar gürültüde kaybolur. Boyut tavanı
   * aşımı da buraya düşer ve ayrıca ayrılır.
   */
  private async guard<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('pixels') || message.includes('limitInputPixels')) {
        throw appError('PHOTO_TOO_LARGE', {
          params: { maxMb: Math.floor(MEDIA.maxUploadBytes / (1024 * 1024)) },
          cause: error,
          internalMessage: `sharp.${operation}: piksel tavanı aşıldı`,
        });
      }

      throw appError('PHOTO_INVALID_FORMAT', {
        cause: error,
        internalMessage: `sharp.${operation} başarısız: ${message}`,
      });
    }
  }
}

/** Ham piksel dizisini RGBA'ya tamamlar (gri/RGB girdiler için). */
function toRgba(data: Buffer, width: number, height: number, channels: number): Uint8ClampedArray {
  if (channels === 4) return new Uint8ClampedArray(data);

  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const source = i * channels;
    const red = data[source] ?? 0;
    const green = channels >= 3 ? (data[source + 1] ?? red) : red;
    const blue = channels >= 3 ? (data[source + 2] ?? red) : red;
    pixels[i * 4] = red;
    pixels[i * 4 + 1] = green;
    pixels[i * 4 + 2] = blue;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}
