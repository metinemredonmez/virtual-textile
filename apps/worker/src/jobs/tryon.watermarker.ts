import type { ImageWatermarker } from './tryon.processor.js';

/**
 * FİLİGRAN — YASAL UYARININ PİKSELE GÖMÜLMESİ
 *
 * ⚠️ Uyarı PİKSELİN İÇİNE yazılır. CSS katmanı, HTTP başlığı veya ayrı bir alan
 *    YETMEZ: kullanıcı görsele sağ tıklayıp kaydettiğinde, ekran görüntüsü alıp
 *    paylaştığında ya da imzalı URL'den doğrudan çektiğinde uyarı kaybolur —
 *    oysa görselin yanlış anlaşılma riski tam da o an başlar.
 *
 * ⚠️ BU DOSYA, WORKER'DA GÖRÜNTÜ KÜTÜPHANESİNE DOKUNAN TEK YERDİR. `sharp`
 *    doğrudan `import` EDİLMEZ; kullanılan yüzey aşağıda yapısal arayüzle
 *    tanımlanıp yapıcıya DIŞARIDAN geçilir (bkz. worker.module.ts). Böylece
 *    testte gerçek kütüphane olmadan da davranış kurulabiliyor.
 */

// ── sharp'ın kullandığımız yüzeyi ──────────────────────────────────────────

export interface WatermarkMetadata {
  width?: number | undefined;
  height?: number | undefined;
}

export interface WatermarkRawResult {
  data: Buffer;
  info: { width: number; height: number; channels: number };
}

export interface WatermarkCompositeLayer {
  input: Buffer;
  top: number;
  left: number;
}

export interface WatermarkSharpInstance {
  metadata(): Promise<WatermarkMetadata>;
  ensureAlpha(): WatermarkSharpInstance;
  raw(): WatermarkSharpInstance;
  png(): WatermarkSharpInstance;
  jpeg(options: { quality: number; mozjpeg?: boolean }): WatermarkSharpInstance;
  composite(layers: readonly WatermarkCompositeLayer[]): WatermarkSharpInstance;
  toBuffer(): Promise<Buffer>;
  toBuffer(options: { resolveWithObject: true }): Promise<WatermarkRawResult>;
}

export type WatermarkSharpFactory = (
  input: Buffer,
  options?: { limitInputPixels?: number; failOn?: 'none' | 'truncated' | 'error' | 'warning' },
) => WatermarkSharpInstance;

/**
 * Piksel tavanı: sağlayıcıdan gelen görsel de güvenilmez girdidir. Sıkıştırma
 * bombası worker'ın belleğini tüketirse kuyruktaki tüm işler durur.
 */
const MAX_INPUT_PIXELS = 50_000_000;

/** JPEG kalitesi — uyarı metni okunabilir kalmalı, dosya şişmemeli. */
const OUTPUT_QUALITY = 90;

/**
 * Metin şeridinin en az bu kadar pikseli boyanmış olmalı. Altında kalırsa
 * "yazı tipi bulunamadı" demektir (bkz. assertInkRendered).
 */
const MIN_INK_PIXELS = 40;

/** Yazı tipi zinciri — ilki bulunamazsa fontconfig sıradakine düşer. */
const FONT_STACK =
  "'DejaVu Sans','Liberation Sans','Noto Sans','Helvetica Neue',Helvetica,Arial,sans-serif";

/** XML'e metin gömerken kaçırılması ZORUNLU karakterler. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface WatermarkLayout {
  barHeight: number;
  fontSize: number;
  padding: number;
}

/**
 * Şerit ölçüleri görsel genişliğine göre hesaplanır.
 *
 * ⚠️ Sabit punto kullanılamaz: 2048 px'lik bir çıktıda okunmaz kalır, 512
 *    px'lik bir çıktıda ise satır taşar ve uyarının bir kısmı görünmez —
 *    yarım okunan bir uyarı, uyarı sayılmaz. Punto, metnin KARAKTER SAYISINA
 *    göre daraltılır; ölçüm yapmadan güvenli tarafta kalmanın yolu budur.
 */
export function watermarkLayout(width: number, textLength: number): WatermarkLayout {
  const padding = Math.max(8, Math.round(width * 0.015));
  const available = Math.max(1, width - padding * 2);

  // 0,53 = ortalama karakter genişliği / punto (sans-serif için ölçülmüş kaba
  // katsayı). Fazla tahmin etmek taşmaya, az tahmin etmek okunmazlığa yol açar.
  const fitted = Math.floor(available / Math.max(1, textLength * 0.53));
  const fontSize = clamp(fitted, 9, 40);

  return { barHeight: Math.max(24, Math.round(fontSize * 2.2)), fontSize, padding };
}

function textSvg(width: number, layout: WatermarkLayout, text: string): string {
  const baseline = Math.round(layout.barHeight / 2 + layout.fontSize * 0.36);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${layout.barHeight}">`,
    `<text x="${Math.round(width / 2)}" y="${baseline}" text-anchor="middle"`,
    ` font-family="${FONT_STACK}" font-size="${layout.fontSize}" fill="#ffffff">`,
    escapeXml(text),
    '</text></svg>',
  ].join('');
}

function barSvg(width: number, layout: WatermarkLayout): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${layout.barHeight}">` +
    `<rect width="${width}" height="${layout.barHeight}" fill="#000000" fill-opacity="0.55"/>` +
    '</svg>'
  );
}

/**
 * ⚠️ FİLİGRAN BİLEŞENİ YOKKEN KULLANILAN YER TUTUCU DEĞİLDİR — gerçek uygulama.
 *
 * Fail-closed davranış korunur: aşağıdaki her hata yolu FIRLATIR, hiçbiri
 * filigransız görsel döndürmez. `TryOnProcessor` bunu yakalayıp işi başarısız
 * yazar ve kullanıcı kotasını iade eder.
 */
export class SharpWatermarker implements ImageWatermarker {
  constructor(private readonly sharp: WatermarkSharpFactory) {}

  async embed(image: Buffer, text: string): Promise<{ image: Buffer; contentType: string }> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      // Boş uyarı metni sessizce "filigranlandı" sayılamaz.
      throw new Error('Filigran metni boş — görsel kaydedilmedi');
    }

    const source = this.open(image);
    const meta = await source.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    if (width <= 0 || height <= 0) {
      throw new Error('Filigran eklenemedi: görselin boyutu okunamadı');
    }

    const layout = watermarkLayout(width, trimmed.length);
    if (layout.barHeight >= height) {
      // Şerit görselin tamamını kaplıyorsa ortada gösterilecek bir sonuç yok.
      throw new Error(`Filigran eklenemedi: görsel çok kısa (${width}x${height})`);
    }

    const [bar, ink] = await Promise.all([
      this.sharp(Buffer.from(barSvg(width, layout)))
        .png()
        .toBuffer(),
      this.sharp(Buffer.from(textSvg(width, layout, trimmed)))
        .png()
        .toBuffer(),
    ]);

    await assertInkRendered(this.sharp, ink);

    const top = height - layout.barHeight;
    const output = await this.open(image)
      .composite([
        { input: bar, top, left: 0 },
        { input: ink, top, left: 0 },
      ])
      .jpeg({ quality: OUTPUT_QUALITY, mozjpeg: true })
      .toBuffer();

    return { image: output, contentType: 'image/jpeg' };
  }

  /** Ortak açılış — piksel tavanı ve kısmi dosya reddi tek yerde. */
  private open(input: Buffer): WatermarkSharpInstance {
    return this.sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'truncated' });
  }
}

/**
 * ⚠️ YAZI TİPİ VAR MI? SESSİZ BAŞARISIZLIĞIN TEK SAVUNMASI.
 *
 * SVG metin katmanı, sistemde hiçbir yazı tipi kurulu değilse (ince temel
 * imajlar bunu sıklıkla yapar) HATA VERMEZ — boş, tamamen şeffaf bir katman
 * üretir. O katman görsele bindirilirse sonuç kusursuz görünür ama YASAL
 * UYARIYI TAŞIMAZ; hiç filigran eklememekten farkı yoktur, üstelik
 * eklendiğini sanırız.
 *
 * Bu yüzden katman rasterleştirilip gerçekten boyanmış piksel sayılır. Boşsa
 * iş başarısız yazılır (kota iade edilir) ve neden logda görünür.
 */
async function assertInkRendered(sharp: WatermarkSharpFactory, layer: Buffer): Promise<void> {
  const { data, info } = await sharp(layer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let painted = 0;
  for (let offset = info.channels - 1; offset < data.length; offset += info.channels) {
    // 16 eşiği: kenar yumuşatmanın ürettiği neredeyse şeffaf pikseller sayılmasın.
    if (data[offset]! > 16) {
      painted += 1;
      if (painted >= MIN_INK_PIXELS) return;
    }
  }

  throw new Error(
    'Filigran metni rasterleştirilemedi (sistemde yazı tipi yok?) — görsel kaydedilmedi',
  );
}
