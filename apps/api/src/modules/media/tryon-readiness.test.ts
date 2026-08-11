import { describe, expect, it } from 'vitest';
import { MEDIA } from '@vt/config';
import {
  scoreTryOnReadiness,
  MIN_TRYON_READINESS_SCORE,
  TRYON_READINESS_WEIGHTS,
  type ReadinessAngle,
  type ReadinessImageFacts,
} from './tryon-readiness.js';

const image = (
  angle: ReadinessAngle,
  overrides: Partial<ReadinessImageFacts> = {},
): ReadinessImageFacts => ({
  angle,
  widthPx: 2000,
  heightPx: 3000,
  backgroundUniformity: 95,
  subjectTouchesEdge: false,
  ...overrides,
});

/** Kusursuz ürün: üç temel açı + model çekimi, hepsi sade ve büyük. */
const perfectSet: ReadinessImageFacts[] = [
  image('FRONT'),
  image('BACK'),
  image('SIDE'),
  image('MODEL'),
];

describe('scoreTryOnReadiness — ağırlıklar', () => {
  it('ağırlıkların toplamı 100', () => {
    const total =
      TRYON_READINESS_WEIGHTS.resolution +
      TRYON_READINESS_WEIGHTS.background +
      TRYON_READINESS_WEIGHTS.uncropped +
      TRYON_READINESS_WEIGHTS.angles +
      TRYON_READINESS_WEIGHTS.onModel;
    expect(total).toBe(100);
  });

  it('kusursuz görsel seti 100 alır, sorun ve öneri üretmez', () => {
    const result = scoreTryOnReadiness(perfectSet);
    expect(result.score).toBe(100);
    expect(result.issues).toEqual([]);
    expect(result.suggestions).toEqual([]);
    expect(result.needsImprovement).toBe(false);
  });

  it('görsel yoksa skor sıfır ve öneri verilir', () => {
    const result = scoreTryOnReadiness([]);
    expect(result.score).toBe(0);
    expect(result.issues).toEqual(['no_images']);
    expect(result.suggestions).toHaveLength(1);
    expect(result.needsImprovement).toBe(true);
  });
});

describe('scoreTryOnReadiness — çözünürlük (25p)', () => {
  it('eşik genişlikte tam puan', () => {
    const result = scoreTryOnReadiness(
      perfectSet.map((img) => ({ ...img, widthPx: MEDIA.minProductImageWidth })),
    );
    expect(result.breakdown.resolution).toBe(TRYON_READINESS_WEIGHTS.resolution);
    expect(result.issues).not.toContain('low_resolution');
  });

  it('yarım genişlikte yarım puan ve düşük çözünürlük sorunu', () => {
    const result = scoreTryOnReadiness(
      perfectSet.map((img) => ({ ...img, widthPx: MEDIA.minProductImageWidth / 2 })),
    );
    expect(result.breakdown.resolution).toBeCloseTo(TRYON_READINESS_WEIGHTS.resolution / 2, 5);
    expect(result.issues).toContain('low_resolution');
  });

  it('tek küçük görsel tüm puanı silmez ama işaretlenir', () => {
    const set = [...perfectSet.slice(0, 3), image('MODEL', { widthPx: 200 })];
    const result = scoreTryOnReadiness(set);
    expect(result.breakdown.resolution).toBeGreaterThan(TRYON_READINESS_WEIGHTS.resolution * 0.7);
    expect(result.issues).toContain('low_resolution');
  });
});

describe('scoreTryOnReadiness — arka plan (25p)', () => {
  it('kalabalık arka planı cezalandırır', () => {
    const result = scoreTryOnReadiness(
      perfectSet.map((img) => ({ ...img, backgroundUniformity: 20 })),
    );
    expect(result.breakdown.background).toBeLessThan(TRYON_READINESS_WEIGHTS.background * 0.3);
    expect(result.issues).toContain('busy_background');
  });

  it('ölçülemeyen arka plan cezalandırılmaz ama tam puan da almaz', () => {
    const result = scoreTryOnReadiness(
      perfectSet.map((img) => ({ ...img, backgroundUniformity: undefined })),
    );
    expect(result.issues).not.toContain('busy_background');
    expect(result.breakdown.background).toBeGreaterThan(0);
    expect(result.breakdown.background).toBeLessThan(TRYON_READINESS_WEIGHTS.background);
  });
});

describe('scoreTryOnReadiness — kırpılmamış (20p)', () => {
  it('hepsi kırpılmışsa puan sıfır', () => {
    const result = scoreTryOnReadiness(
      perfectSet.map((img) => ({ ...img, subjectTouchesEdge: true })),
    );
    expect(result.breakdown.uncropped).toBe(0);
    expect(result.issues).toContain('cropped_subject');
  });

  it('yarısı kırpılmışsa yarım puan', () => {
    const set = [
      image('FRONT', { subjectTouchesEdge: true }),
      image('BACK', { subjectTouchesEdge: true }),
      image('SIDE'),
      image('MODEL'),
    ];
    const result = scoreTryOnReadiness(set);
    expect(result.breakdown.uncropped).toBeCloseTo(TRYON_READINESS_WEIGHTS.uncropped / 2, 5);
  });

  it('ölçülemeyen kırpma bilgisi kırpılmış sayılmaz', () => {
    const result = scoreTryOnReadiness(
      perfectSet.map((img) => ({ ...img, subjectTouchesEdge: undefined })),
    );
    expect(result.breakdown.uncropped).toBe(TRYON_READINESS_WEIGHTS.uncropped);
    expect(result.issues).not.toContain('cropped_subject');
  });
});

describe('scoreTryOnReadiness — açılar (20p)', () => {
  it('yalnızca ön açı varsa üçte bir puan alır', () => {
    const result = scoreTryOnReadiness([image('FRONT'), image('MODEL')]);
    // breakdown iki ondalığa yuvarlanır — 20/3 = 6,67
    expect(result.breakdown.angles).toBeCloseTo(TRYON_READINESS_WEIGHTS.angles / 3, 1);
    expect(result.issues).toContain('missing_back_angle');
    expect(result.issues).toContain('missing_side_angle');
    expect(result.issues).not.toContain('missing_front_angle');
  });

  it('detay çekimi eksik açının yerini tutmaz', () => {
    const result = scoreTryOnReadiness([image('FRONT'), image('DETAIL'), image('DETAIL')]);
    expect(result.issues).toContain('missing_back_angle');
    expect(result.issues).toContain('missing_side_angle');
  });

  it('detay çekimleri çözünürlük/arka plan ortalamasına karışmaz', () => {
    const withBadDetail = scoreTryOnReadiness([
      ...perfectSet,
      image('DETAIL', { widthPx: 100, backgroundUniformity: 0, subjectTouchesEdge: true }),
    ]);
    expect(withBadDetail.score).toBe(100);
  });
});

describe('scoreTryOnReadiness — model çekimi (10p)', () => {
  it('model görseli yoksa 10 puan kaybedilir', () => {
    const result = scoreTryOnReadiness([image('FRONT'), image('BACK'), image('SIDE')]);
    expect(result.breakdown.onModel).toBe(0);
    expect(result.score).toBe(100 - TRYON_READINESS_WEIGHTS.onModel);
    expect(result.issues).toContain('missing_model_shot');
  });
});

describe('scoreTryOnReadiness — satıcıya öneriler', () => {
  it('60 puanın altında iyileştirme bayrağı kalkar', () => {
    const result = scoreTryOnReadiness([
      image('FRONT', { widthPx: 400, backgroundUniformity: 25, subjectTouchesEdge: true }),
    ]);
    expect(result.score).toBeLessThan(MIN_TRYON_READINESS_SCORE);
    expect(result.needsImprovement).toBe(true);
  });

  it('öneriler somut ve en çok puan kazandıran başta', () => {
    const result = scoreTryOnReadiness([
      image('FRONT', { widthPx: 300, backgroundUniformity: 10, subjectTouchesEdge: true }),
    ]);

    expect(result.suggestions.length).toBeGreaterThan(0);
    const gains = result.suggestions.map((s) => s.gain);
    expect([...gains].sort((a, b) => b - a)).toEqual(gains);

    // Her öneri satıcının uygulayabileceği bir eylem içermeli.
    for (const suggestion of result.suggestions) {
      expect(suggestion.message.length).toBeGreaterThan(20);
      expect(suggestion.gain).toBeGreaterThan(0);
    }
  });

  it('düşük çözünürlük önerisi kaç görselin küçük olduğunu söyler', () => {
    const result = scoreTryOnReadiness([
      image('FRONT', { widthPx: 300 }),
      image('BACK', { widthPx: 300 }),
      image('SIDE'),
      image('MODEL'),
    ]);
    const suggestion = result.suggestions.find((s) => s.issue === 'low_resolution');
    expect(suggestion?.message).toContain('2 görselin');
    expect(suggestion?.message).toContain(String(MEDIA.minProductImageWidth));
  });

  it('eksik açılar tek öneride toplanır ve hepsi listelenir', () => {
    const result = scoreTryOnReadiness([image('FRONT'), image('MODEL')]);
    const suggestion = result.suggestions.find((s) => s.issue === 'missing_back_angle');
    expect(suggestion?.message).toContain('arka');
    expect(suggestion?.message).toContain('yan');
    expect(suggestion?.gain).toBe(13);
  });

  it('kazanç toplamı skoru 100’e tamamlar', () => {
    const result = scoreTryOnReadiness([
      image('FRONT', { widthPx: 512, backgroundUniformity: 40, subjectTouchesEdge: true }),
      image('BACK', { widthPx: 512, backgroundUniformity: 40, subjectTouchesEdge: true }),
    ]);
    const totalGain = result.suggestions.reduce((sum, s) => sum + s.gain, 0);
    // Yuvarlama payı bırakılıyor; amaç satıcının "hepsini yaparsam 100 olurum"
    // beklentisinin tutması.
    expect(Math.abs(result.score + totalGain - 100)).toBeLessThanOrEqual(2);
  });
});
