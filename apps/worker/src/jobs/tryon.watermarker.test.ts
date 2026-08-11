import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { TRYON } from '@vt/config';
import {
  SharpWatermarker,
  watermarkLayout,
  type WatermarkSharpFactory,
  type WatermarkSharpInstance,
} from './tryon.watermarker.js';

const factory = sharp as unknown as WatermarkSharpFactory;
const watermarker = new SharpWatermarker(factory);

/** Düz renkli test görseli — filigranın hangi pikselleri değiştirdiği ölçülebilsin. */
async function solidImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .png()
    .toBuffer();
}

/** Belirtilen şeritteki ortalama parlaklık. Filigran şeridi koyulaştırır. */
async function stripBrightness(image: Buffer, fromBottom: number): Promise<number> {
  const meta = await sharp(image).metadata();
  const height = meta.height!;
  const width = meta.width!;
  const { data } = await sharp(image)
    .extract({ left: 0, top: height - fromBottom, width, height: fromBottom })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let total = 0;
  for (const value of data) total += value;
  return total / data.length;
}

describe('watermarkLayout', () => {
  it('⚠️ punto genişliğe göre daralır — uzun uyarı dar görselde taşmamalı', () => {
    const long = TRYON.watermarkText.length;
    const narrow = watermarkLayout(512, long);
    const wide = watermarkLayout(2048, long);

    expect(narrow.fontSize).toBeLessThan(wide.fontSize);

    // Kaba genişlik tahmini şeride sığmalı (0,53 katsayısı ile aynı model).
    for (const [width, layout] of [
      [512, narrow],
      [2048, wide],
    ] as const) {
      const estimated = long * layout.fontSize * 0.53;
      expect(estimated).toBeLessThanOrEqual(width - layout.padding * 2);
    }
  });

  it('punto tabanı vardır — çok dar görselde okunmaz büyüklüğe inmez', () => {
    expect(watermarkLayout(64, 200).fontSize).toBe(9);
  });

  it('punto tavanı vardır — çok geniş görselde şerit görseli yutmaz', () => {
    expect(watermarkLayout(8000, 5).fontSize).toBe(40);
  });
});

describe('SharpWatermarker', () => {
  it('⚠️ uyarıyı PİKSELE gömer — alt şerit belirgin biçimde koyulaşır', async () => {
    const source = await solidImage(1024, 1536);
    const result = await watermarker.embed(source, TRYON.watermarkText);

    expect(result.contentType).toBe('image/jpeg');

    const layout = watermarkLayout(1024, TRYON.watermarkText.length);
    const before = await stripBrightness(source, layout.barHeight);
    const after = await stripBrightness(result.image, layout.barHeight);

    // Şerit %55 opaklıkta siyah: parlaklık belirgin düşmeli.
    expect(after).toBeLessThan(before - 40);
  });

  it('çıktı geçerli bir görseldir ve boyutları korunur', async () => {
    const result = await watermarker.embed(await solidImage(768, 1024), TRYON.watermarkText);
    const meta = await sharp(result.image).metadata();

    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(768);
    expect(meta.height).toBe(1024);
  });

  it('⚠️ görselin ÜST kısmına dokunmaz — sonuç şeridin dışında bozulmaz', async () => {
    const source = await solidImage(640, 960);
    const result = await watermarker.embed(source, TRYON.watermarkText);

    const top = await sharp(result.image)
      .extract({ left: 0, top: 0, width: 640, height: 400 })
      .greyscale()
      .stats();

    // JPEG sıkıştırması küçük sapma yaratır; düz gri korunmalı.
    expect(top.channels[0]!.mean).toBeGreaterThan(190);
    expect(top.channels[0]!.mean).toBeLessThan(210);
  });

  it('boş uyarı metnini reddeder — sessizce filigransız kaydetmez', async () => {
    await expect(watermarker.embed(await solidImage(640, 960), '   ')).rejects.toThrow(/boş/);
  });

  it('şeridin sığmadığı kadar kısa görseli reddeder', async () => {
    await expect(watermarker.embed(await solidImage(640, 20), TRYON.watermarkText)).rejects.toThrow(
      /çok kısa/,
    );
  });

  it('bozuk görseli reddeder — "işlendi" deyip geçmez', async () => {
    await expect(
      watermarker.embed(Buffer.from('bu bir görsel değil'), TRYON.watermarkText),
    ).rejects.toThrow();
  });

  /**
   * ⚠️ EN ÖNEMLİ TEST. Yazı tipi bulunamayan bir sistemde SVG metin katmanı
   * HATA VERMEZ, boş/şeffaf rasterleşir. O katman bindirilirse görsel kusursuz
   * görünür ama YASAL UYARIYI TAŞIMAZ. Burada metin katmanı bilerek boş
   * döndürülüyor; uygulama fırlatmazsa filigransız görsel depoya yazılırdı.
   */
  it('metin katmanı boş rasterleşirse FIRLATIR (yazı tipi yok senaryosu)', async () => {
    const blankTextLayer: WatermarkSharpFactory = (input, options) => {
      const isSvg = input.subarray(0, 5).toString('utf8') === '<svg ';
      const isText = isSvg && input.toString('utf8').includes('<text');
      if (!isText) return factory(input, options);

      // Aynı ölçüde ama TAMAMEN ŞEFFAF katman — "yazı tipi yok" hâli.
      const match = /width="(\d+)" height="(\d+)"/.exec(input.toString('utf8'))!;
      return sharp({
        create: {
          width: Number(match[1]),
          height: Number(match[2]),
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).png() as unknown as WatermarkSharpInstance;
    };

    await expect(
      new SharpWatermarker(blankTextLayer).embed(await solidImage(1024, 1536), TRYON.watermarkText),
    ).rejects.toThrow(/yazı tipi/);
  });
});
