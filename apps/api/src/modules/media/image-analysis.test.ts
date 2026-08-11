import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_SIZE,
  analyzeGrayscale,
  backgroundUniformity,
  meanLuminance,
  sharpness,
  subjectTouchesEdge,
  type GrayscaleImage,
} from './image-analysis.js';

const SIZE = ANALYSIS_SIZE;

const build = (paint: (x: number, y: number) => number): GrayscaleImage => {
  const data = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      data[y * SIZE + x] = Math.max(0, Math.min(255, Math.round(paint(x, y))));
    }
  }
  return { data, width: SIZE, height: SIZE };
};

const solid = (value: number): GrayscaleImage => build(() => value);

/** Sade fonda ortalanmış koyu bir konu — iyi bir ürün fotoğrafının karşılığı. */
const centeredSubject = build((x, y) => {
  const inside = x > SIZE * 0.3 && x < SIZE * 0.7 && y > SIZE * 0.25 && y < SIZE * 0.75;
  return inside ? 40 : 235;
});

/** Konu sol kenardan taşıyor — kırpılmış görsel. */
const edgeSubject = build((x, y) => {
  const inside = x < SIZE * 0.6 && y > SIZE * 0.2 && y < SIZE * 0.9;
  return inside ? 40 : 235;
});

/** Yüksek frekanslı desen — kalabalık arka plan / net görüntü. */
const checkerboard = build((x, y) => ((x + y) % 2 === 0 ? 0 : 255));

describe('meanLuminance', () => {
  it('düz renkte o rengi döndürür', () => {
    expect(meanLuminance(solid(120))).toBe(120);
  });

  it('simsiyah görüntüde sıfır', () => {
    expect(meanLuminance(solid(0))).toBe(0);
  });
});

describe('sharpness', () => {
  it('düz renkte sıfırdır (bulanığın uç hâli)', () => {
    expect(sharpness(solid(128))).toBe(0);
  });

  it('yüksek frekanslı desende tavana vurur', () => {
    expect(sharpness(checkerboard)).toBe(100);
  });

  it('keskin kenarlı konu bulanık sayılmaz', () => {
    expect(sharpness(centeredSubject)).toBeGreaterThan(0);
  });

  it('çok küçük görüntüde ölçüm yapmaz', () => {
    expect(sharpness({ data: new Uint8Array(4), width: 2, height: 2 })).toBe(0);
  });
});

describe('backgroundUniformity', () => {
  it('düz fon tam puan alır', () => {
    expect(backgroundUniformity(solid(235))).toBe(100);
  });

  it('sade fonlu, ortalanmış konuda yüksek kalır', () => {
    expect(backgroundUniformity(centeredSubject)).toBe(100);
  });

  it('kalabalık desende çöker', () => {
    expect(backgroundUniformity(checkerboard)).toBe(0);
  });
});

describe('subjectTouchesEdge', () => {
  it('sade fonda ortalanmış konuda false', () => {
    expect(subjectTouchesEdge(centeredSubject)).toBe(false);
  });

  it('kenardan taşan konuda true', () => {
    expect(subjectTouchesEdge(edgeSubject)).toBe(true);
  });

  it('boş fonda false', () => {
    expect(subjectTouchesEdge(solid(200))).toBe(false);
  });
});

describe('analyzeGrayscale', () => {
  it('boyutları ölçüm görüntüsünden değil, orijinalden alır', () => {
    const analysis = analyzeGrayscale(centeredSubject, 2048, 3072);
    expect(analysis.widthPx).toBe(2048);
    expect(analysis.heightPx).toBe(3072);
  });

  it('iyi bir ürün fotoğrafında tüm ölçümler olumlu', () => {
    const analysis = analyzeGrayscale(centeredSubject, 2048, 3072);
    expect(analysis.backgroundUniformity).toBeGreaterThan(80);
    expect(analysis.subjectTouchesEdge).toBe(false);
    expect(analysis.sharpness).toBeGreaterThan(0);
  });
});
