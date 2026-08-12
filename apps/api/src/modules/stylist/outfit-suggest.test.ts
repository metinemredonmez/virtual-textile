import { describe, expect, it } from 'vitest';
import { suggestOutfitsFromWardrobe, type OutfitCandidatePiece } from './tools/outfit-suggest.js';

/**
 * GARDIROPTAN KOMBİN ÖNERİSİ
 *
 * ⚠️ Bu çekirdek gardırop modülünün `WardrobeStylistPort` portunun ARKASINDAKİ
 *    gerçek uygulamadır. Port bir tur boyunca `useValue: null` idi: uçlar
 *    kayıtlı olsaydı ilk istek 500 dönerdi ve hiçbir birim testi bunu
 *    yakalamazdı — çünkü testler portu kendi sahte nesneleriyle dolduruyor.
 */

function piece(over: Partial<OutfitCandidatePiece> & { itemId: string }): OutfitCandidatePiece {
  return {
    category: 'UPPER_BODY',
    color: 'siyah',
    label: null,
    ...over,
  };
}

describe('suggestOutfitsFromWardrobe', () => {
  it('üst + alt parçadan kombin kurar', () => {
    const result = suggestOutfitsFromWardrobe({
      items: [
        piece({ itemId: 'u1', category: 'UPPER_BODY', color: 'beyaz' }),
        piece({ itemId: 'l1', category: 'LOWER_BODY', color: 'lacivert' }),
      ],
      limit: 5,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.itemIds).toEqual(['u1', 'l1']);
  });

  it('elbise tek başına kombindir', () => {
    const result = suggestOutfitsFromWardrobe({
      items: [piece({ itemId: 'd1', category: 'DRESS', color: 'siyah' })],
      limit: 5,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.itemIds).toEqual(['d1']);
  });

  it('tek başına üst parça kombin ÜRETMEZ — yarım kıyafet önerilmez', () => {
    const result = suggestOutfitsFromWardrobe({
      items: [piece({ itemId: 'u1', category: 'UPPER_BODY' })],
      limit: 5,
    });

    expect(result).toEqual([]);
  });

  it('boş gardırop boş sonuç verir, hata değil', () => {
    expect(suggestOutfitsFromWardrobe({ items: [], limit: 3 })).toEqual([]);
  });

  /**
   * ⚠️ Kullanıcıya sırf liste dolsun diye kötü bir kombin göstermek, öneriye
   *    olan güveni tek seferde bitirir. Boş liste dürüst cevaptır.
   */
  it('⚠️ ÇATIŞAN renkli kombin listeye GİRMEZ', () => {
    const result = suggestOutfitsFromWardrobe({
      items: [
        piece({ itemId: 'u1', category: 'UPPER_BODY', color: 'kırmızı' }),
        piece({ itemId: 'l1', category: 'LOWER_BODY', color: 'pembe' }),
      ],
      limit: 5,
    });

    expect(result).toEqual([]);
  });

  it('dış giyim kombine ek seçenek olarak eklenir, mecbur değildir', () => {
    const result = suggestOutfitsFromWardrobe({
      items: [
        piece({ itemId: 'u1', category: 'UPPER_BODY', color: 'beyaz' }),
        piece({ itemId: 'l1', category: 'LOWER_BODY', color: 'lacivert' }),
        piece({ itemId: 'o1', category: 'OUTERWEAR', color: 'gri' }),
      ],
      limit: 5,
    });

    const shapes = result.map((suggestion) => suggestion.itemIds.length).sort();
    expect(shapes).toEqual([2, 3]);
    // Eşit skorda AZ parçalı önce: temel cevap listenin başında olmalı.
    expect(result[0]!.itemIds).toEqual(['u1', 'l1']);
  });

  it('limit aşılmaz', () => {
    const items: OutfitCandidatePiece[] = [];
    for (let i = 0; i < 5; i += 1) {
      items.push(piece({ itemId: `u${i}`, category: 'UPPER_BODY', color: 'beyaz' }));
      items.push(piece({ itemId: `l${i}`, category: 'LOWER_BODY', color: 'siyah' }));
    }

    expect(suggestOutfitsFromWardrobe({ items, limit: 3 })).toHaveLength(3);
  });

  /**
   * ⚠️ Sıra DETERMİNİSTİK olmalı: aynı gardırop için iki ardışık istek farklı
   *    sıralama döndürseydi arayüz sebepsiz oynardı.
   */
  it('aynı girdi aynı sırayı verir', () => {
    const items = [
      piece({ itemId: 'u1', category: 'UPPER_BODY', color: 'beyaz' }),
      piece({ itemId: 'u2', category: 'UPPER_BODY', color: 'gri' }),
      piece({ itemId: 'l1', category: 'LOWER_BODY', color: 'lacivert' }),
    ];

    const first = suggestOutfitsFromWardrobe({ items, limit: 10 });
    const second = suggestOutfitsFromWardrobe({ items, limit: 10 });

    expect(first.map((s) => s.itemIds.join())).toEqual(second.map((s) => s.itemIds.join()));
  });

  /**
   * ⚠️ Kombinasyon sayısı parça sayısıyla ÇARPIMSAL büyür. Sınır olmasaydı
   *    dolabını dolduran bir kullanıcı tek istekle API prosesini kilitlerdi.
   */
  it('⚠️ büyük gardıropta üst sınır uygulanır — proses kilitlenmez', () => {
    const items: OutfitCandidatePiece[] = [];
    for (let i = 0; i < 400; i += 1) {
      items.push(piece({ itemId: `u${i}`, category: 'UPPER_BODY', color: 'beyaz' }));
      items.push(piece({ itemId: `l${i}`, category: 'LOWER_BODY', color: 'siyah' }));
    }

    const startedAt = Date.now();
    const result = suggestOutfitsFromWardrobe({ items, limit: 3 });

    expect(result).toHaveLength(3);
    // Kategori başına 12 parça → en fazla 144 gövde; milisaniyeler sürer.
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('etiketi olan parçalar başlığı taşır', () => {
    const result = suggestOutfitsFromWardrobe({
      items: [
        piece({ itemId: 'u1', category: 'UPPER_BODY', color: 'beyaz', label: 'Keten gömlek' }),
        piece({ itemId: 'l1', category: 'LOWER_BODY', color: 'lacivert', label: 'Kot pantolon' }),
      ],
      limit: 5,
    });

    expect(result[0]!.title).toBe('Keten gömlek + Kot pantolon');
  });

  it('etiket yoksa başlık renk ve kategoriden kurulur', () => {
    const result = suggestOutfitsFromWardrobe({
      items: [
        piece({ itemId: 'u1', category: 'UPPER_BODY', color: 'beyaz' }),
        piece({ itemId: 'l1', category: 'LOWER_BODY', color: 'lacivert' }),
      ],
      limit: 5,
    });

    expect(result[0]!.title).toBe('beyaz üst + lacivert alt');
  });

  it('gerekçe kural motorunun notlarından gelir — boş bırakılmaz', () => {
    const result = suggestOutfitsFromWardrobe({
      items: [
        piece({ itemId: 'u1', category: 'UPPER_BODY', color: 'beyaz' }),
        piece({ itemId: 'l1', category: 'LOWER_BODY', color: 'siyah' }),
      ],
      limit: 5,
    });

    expect(result[0]!.rationale.length).toBeGreaterThan(0);
    expect(result[0]!.harmony).toBe('HARMONIOUS');
  });

  /** Aynı parça bir öneride iki kez geçemez; farklı önerilerde geçebilir. */
  it('bir öneri içinde aynı parça tekrarlanmaz', () => {
    const result = suggestOutfitsFromWardrobe({
      items: [
        piece({ itemId: 'u1', category: 'UPPER_BODY', color: 'beyaz' }),
        piece({ itemId: 'l1', category: 'LOWER_BODY', color: 'siyah' }),
        piece({ itemId: 'l2', category: 'LOWER_BODY', color: 'gri' }),
      ],
      limit: 10,
    });

    for (const suggestion of result) {
      expect(new Set(suggestion.itemIds).size).toBe(suggestion.itemIds.length);
    }
    // Aynı üst iki farklı altla eşleşebilir.
    expect(result.length).toBe(2);
  });
});
