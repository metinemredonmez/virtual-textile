import { describe, expect, it } from 'vitest';
import { MEDIA, TRYON } from '@vt/config';
import {
  isPhotoQualityAcceptable,
  scorePhotoQuality,
  PHOTO_QUALITY_WEIGHTS,
  type PhotoQualityInput,
} from './photo-quality.js';

/** İdeal fotoğraf — testler bunun üzerinde tek değişken oynatır. */
const perfect: PhotoQualityInput = {
  widthPx: 1080,
  heightPx: 1620,
  meanLuminance: 130,
  sharpness: 80,
};

describe('scorePhotoQuality — ağırlıklar', () => {
  it('ağırlıkların toplamı 100', () => {
    const total =
      PHOTO_QUALITY_WEIGHTS.resolution +
      PHOTO_QUALITY_WEIGHTS.brightness +
      PHOTO_QUALITY_WEIGHTS.sharpness;
    expect(total).toBe(100);
  });

  it('kusursuz fotoğraf 100 alır ve sorun listesi boştur', () => {
    const result = scorePhotoQuality(perfect);
    expect(result.score).toBe(100);
    expect(result.issues).toEqual([]);
  });

  it('skor her zaman 0-100 aralığında kalır', () => {
    const inputs: PhotoQualityInput[] = [
      { widthPx: 0, heightPx: 0, meanLuminance: 0, sharpness: 0 },
      { widthPx: 9999, heightPx: 9999, meanLuminance: 255, sharpness: 999 },
      { widthPx: -10, heightPx: -10, meanLuminance: -5, sharpness: -5 },
    ];
    for (const input of inputs) {
      const { score } = scorePhotoQuality(input);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe('scorePhotoQuality — çözünürlük', () => {
  it('eşik boyutta tam puan verir', () => {
    const result = scorePhotoQuality({
      ...perfect,
      widthPx: MEDIA.minUserPhotoWidth,
      heightPx: MEDIA.minUserPhotoHeight,
    });
    expect(result.breakdown.resolution).toBe(PHOTO_QUALITY_WEIGHTS.resolution);
    expect(result.issues).not.toContain('low_resolution');
  });

  it('eşiğin altında puanı orantılı düşürür ve uyarır', () => {
    const result = scorePhotoQuality({
      ...perfect,
      widthPx: MEDIA.minUserPhotoWidth / 2,
      heightPx: MEDIA.minUserPhotoHeight / 2,
    });
    expect(result.breakdown.resolution).toBeCloseTo(PHOTO_QUALITY_WEIGHTS.resolution / 2, 5);
    expect(result.issues).toContain('low_resolution');
  });

  it('zayıf eksene göre puanlar — geniş ama basık fotoğraf tam puan almaz', () => {
    const result = scorePhotoQuality({ ...perfect, widthPx: 4000, heightPx: 400 });
    expect(result.breakdown.resolution).toBeLessThan(PHOTO_QUALITY_WEIGHTS.resolution);
    expect(result.issues).toContain('low_resolution');
  });

  it('çok yüksek çözünürlük ekstra puan getirmez', () => {
    const huge = scorePhotoQuality({ ...perfect, widthPx: 6000, heightPx: 9000 });
    expect(huge.breakdown.resolution).toBe(PHOTO_QUALITY_WEIGHTS.resolution);
  });

  it('sıfır boyut sıfır puan ve düşük çözünürlük uyarısı', () => {
    const result = scorePhotoQuality({ ...perfect, widthPx: 0, heightPx: 0 });
    expect(result.breakdown.resolution).toBe(0);
    expect(result.issues).toContain('low_resolution');
  });
});

describe('scorePhotoQuality — parlaklık', () => {
  it('ideal bantta tam puan', () => {
    for (const luminance of [90, 130, 175]) {
      const result = scorePhotoQuality({ ...perfect, meanLuminance: luminance });
      expect(result.breakdown.brightness).toBe(PHOTO_QUALITY_WEIGHTS.brightness);
    }
  });

  it('karanlık fotoğrafı cezalandırır ve too_dark uyarır', () => {
    const result = scorePhotoQuality({ ...perfect, meanLuminance: 40 });
    expect(result.breakdown.brightness).toBeLessThan(PHOTO_QUALITY_WEIGHTS.brightness);
    expect(result.issues).toContain('too_dark');
  });

  it('aşırı parlak fotoğrafı da cezalandırır (tek yönlü ölçü değil)', () => {
    const result = scorePhotoQuality({ ...perfect, meanLuminance: 245 });
    expect(result.breakdown.brightness).toBe(0);
    expect(result.issues).toContain('too_bright');
  });

  it('simsiyah fotoğrafta parlaklık puanı sıfırdır', () => {
    const result = scorePhotoQuality({ ...perfect, meanLuminance: 5 });
    expect(result.breakdown.brightness).toBe(0);
  });

  it('karanlık ve parlak uyarısı aynı anda verilmez', () => {
    for (const luminance of [0, 60, 130, 200, 255]) {
      const { issues } = scorePhotoQuality({ ...perfect, meanLuminance: luminance });
      expect(issues.includes('too_dark') && issues.includes('too_bright')).toBe(false);
    }
  });
});

describe('scorePhotoQuality — netlik', () => {
  it('referans netliğin üstünde tam puan', () => {
    const result = scorePhotoQuality({ ...perfect, sharpness: 100 });
    expect(result.breakdown.sharpness).toBe(PHOTO_QUALITY_WEIGHTS.sharpness);
  });

  it('bulanık fotoğrafı işaretler', () => {
    const result = scorePhotoQuality({ ...perfect, sharpness: 10 });
    expect(result.issues).toContain('blurry');
    expect(result.breakdown.sharpness).toBeLessThan(PHOTO_QUALITY_WEIGHTS.sharpness / 2);
  });

  it('tamamen bulanık fotoğrafta netlik puanı sıfır', () => {
    const result = scorePhotoQuality({ ...perfect, sharpness: 0 });
    expect(result.breakdown.sharpness).toBe(0);
  });
});

describe('scorePhotoQuality — reddetme eşiği', () => {
  it('kusursuz fotoğraf kabul edilir', () => {
    expect(isPhotoQualityAcceptable(scorePhotoQuality(perfect))).toBe(true);
  });

  it('karanlık + bulanık + küçük fotoğraf eşiğin altında kalır', () => {
    const result = scorePhotoQuality({
      widthPx: 200,
      heightPx: 300,
      meanLuminance: 25,
      sharpness: 5,
    });
    expect(result.score).toBeLessThan(TRYON.minPhotoQualityScore);
    expect(isPhotoQualityAcceptable(result)).toBe(false);
  });

  it('eşiğin tam üstündeki fotoğraf kabul edilir', () => {
    // Yalnızca çözünürlük ve parlaklık tam, netlik sıfır → 70 puan.
    const result = scorePhotoQuality({ ...perfect, sharpness: 0 });
    expect(result.score).toBe(70);
    expect(isPhotoQualityAcceptable(result)).toBe(true);
  });
});

describe('scorePhotoQuality — kullanıcıya dönen gerekçe', () => {
  it('her sorun için eyleme dönük bir cümle üretir', () => {
    const result = scorePhotoQuality({
      widthPx: 100,
      heightPx: 100,
      meanLuminance: 20,
      sharpness: 3,
    });
    expect(result.issues).toEqual(['low_resolution', 'too_dark', 'blurry']);
    expect(result.reason).toContain('piksel');
    expect(result.reason).toContain('karanlık');
    expect(result.reason).toContain('bulanık');
  });

  it('bariz sorun yoksa da boş gerekçe dönmez', () => {
    // Tüm bileşenler sınırda: uyarı eşiklerinin hiçbiri tetiklenmiyor.
    const result = scorePhotoQuality({
      widthPx: MEDIA.minUserPhotoWidth,
      heightPx: MEDIA.minUserPhotoHeight,
      meanLuminance: 75,
      sharpness: 45,
    });
    expect(result.issues).toEqual([]);
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
