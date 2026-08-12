import { describe, expect, it } from 'vitest';
import { NATURAL_SEARCH } from './natural-search.constants.js';
import {
  decideInterpretation,
  fallbackProductListQuery,
  foldTr,
  intentToProductListQuery,
  parseIntent,
  sanitizeIntent,
  tokenize,
} from './natural-search.intent.js';
import type { CatalogVocabulary } from './natural-search.ports.js';
import type { SearchIntentDraft } from './natural-search.schema.js';

/**
 * NİYET ÇÖZÜMLEMESİNİN TESTLERİ
 *
 * İki soru burada kilitleniyor:
 *   1. "Kısa sorgu LLM'e gitmiyor" kuralı — maliyetin en büyük kaldıracı.
 *   2. Niyet → filtre dönüşümü — modelin uydurabildiği her şeyin elendiği yer.
 */

const SOZ_VARLIGI: CatalogVocabulary = {
  categorySlugs: ['kadin-ust-giyim', 'kadin-elbise', 'erkek-ceket'],
  // ⚠️ Katalogdaki YAZIMLARIYLA: filtre bu değerlerle birebir karşılaştırılır.
  colors: ['Siyah', 'Bej', 'Lacivert', 'Kırmızı'],
  brands: ['Mavi Jeans', 'Beymen', 'Koton'],
};

/**
 * Şemadan geçmiş taslak üretir.
 * Şemaya uymayan test verisi testi düşürür — sessizce geçmesin.
 */
function draft(over: Record<string, unknown> = {}): SearchIntentDraft {
  const parsed = parseIntent({ keywords: ['ceket'], ...over });
  if (!parsed.ok) expect.fail(`test verisi şemaya uymuyor: ${parsed.issues.join(', ')}`);
  return parsed.draft;
}

describe('foldTr — Türkçe karşılaştırma', () => {
  it('büyük İ harfini doğru küçültür (varsayılan yerel bunu yapamaz)', () => {
    expect(foldTr('MAVİ JEANS')).toBe('mavi jeans');
    expect(foldTr('Mavi Jeans')).toBe('mavi jeans');
  });

  it('aksanları düşürür — kullanıcı "gomlek", katalog "Gömlek" yazar', () => {
    expect(foldTr('Gömlek')).toBe('gomlek');
    expect(foldTr('KIRMIZI')).toBe('kirmizi');
  });
});

describe('tokenize', () => {
  it('noktalamayı kelime saymaz', () => {
    expect(tokenize('5.000 TL altı, sade bir ceket!')).toEqual([
      '5',
      '000',
      'TL',
      'altı',
      'sade',
      'bir',
      'ceket',
    ]);
  });
});

describe('decideInterpretation — kısa sorgu LLM’e GİTMEZ', () => {
  it('tek kelimelik sorgu LLM’e gitmez', () => {
    expect(decideInterpretation('elbise', SOZ_VARLIGI)).toEqual({
      interpret: false,
      reason: 'SHORT_QUERY',
    });
  });

  it('iki kelimelik sorgu LLM’e gitmez', () => {
    expect(decideInterpretation('siyah elbise', SOZ_VARLIGI)).toEqual({
      interpret: false,
      reason: 'SHORT_QUERY',
    });
  });

  it('üç kelimelik ürün tarifi LLM’e gitmez — anahtar kelime araması zaten doğru cevap', () => {
    expect(decideInterpretation('siyah keten gömlek', SOZ_VARLIGI)).toEqual({
      interpret: false,
      reason: 'SHORT_QUERY',
    });
  });

  it('yalnızca marka adı yazılmışsa LLM’e gitmez', () => {
    expect(decideInterpretation('Mavi Jeans', SOZ_VARLIGI)).toEqual({
      interpret: false,
      reason: 'BRAND_ONLY',
    });
  });

  it('marka adı farklı yazımla da tanınır (küçük harf, Türkçe İ)', () => {
    expect(decideInterpretation('mavi jeans', SOZ_VARLIGI).interpret).toBe(false);
    expect(decideInterpretation('MAVİ JEANS', SOZ_VARLIGI)).toEqual({
      interpret: false,
      reason: 'BRAND_ONLY',
    });
  });

  it('marka adı bir cümlenin parçasıysa LLM’e GİDER', () => {
    expect(decideInterpretation('Mavi Jeans erkek kot pantolon', SOZ_VARLIGI)).toEqual({
      interpret: true,
    });
  });

  it('eşiği aşan cümle LLM’e gider', () => {
    expect(
      decideInterpretation('5000 TL altı iş görüşmesi için sade bir kombin', SOZ_VARLIGI),
    ).toEqual({ interpret: true });
  });

  it('rakam içeren kısa sorgu istisnadır — anahtar kelime araması burada sıfır sonuç verir', () => {
    expect(decideInterpretation('5000 altı elbise', SOZ_VARLIGI)).toEqual({ interpret: true });
  });

  it('tek başına rakam yine de LLM’e gitmez', () => {
    expect(decideInterpretation('5000', SOZ_VARLIGI)).toEqual({
      interpret: false,
      reason: 'SHORT_QUERY',
    });
  });

  it('eşik sabitten okunur — sabit değişirse bu test de değişmeli', () => {
    // ⚠️ Kelimelerde RAKAM olamaz: rakam eşiği düşüren istisnayı tetikler.
    const kelimeler = Array.from({ length: NATURAL_SEARCH.minWordsForLlm }, () => 'kelime');
    expect(decideInterpretation(kelimeler.join(' '), SOZ_VARLIGI)).toEqual({ interpret: true });
    expect(decideInterpretation(kelimeler.slice(1).join(' '), SOZ_VARLIGI).interpret).toBe(false);
  });
});

describe('parseIntent — model uydurma alan döndüremez', () => {
  it('sözleşmeye uyan çıktı kabul edilir', () => {
    const result = parseIntent({ keywords: ['blazer ceket'], maxPriceMinor: 500_000 });
    expect(result.ok).toBe(true);
  });

  it('ŞEMADA OLMAYAN alan çıktıyı tamamen reddeder', () => {
    const result = parseIntent({
      keywords: ['ceket'],
      // ⚠️ Asıl korkulan bu: modelin ürün uydurması.
      products: [{ id: 'yok-boyle-bir-urun', title: 'Uydurma Ceket', price: 1234 }],
    });

    expect(result.ok).toBe(false);
  });

  it('model serbest metin gerekçe eklerse de reddedilir', () => {
    expect(parseIntent({ keywords: ['ceket'], reasoning: 'çünkü resmî bir ortam' }).ok).toBe(false);
  });

  it('keywords zorunludur', () => {
    expect(parseIntent({ category: 'kadin-elbise' }).ok).toBe(false);
  });

  it('kuruş tam sayı olmalıdır — kuruşun kuruşu yoktur', () => {
    expect(parseIntent({ keywords: ['ceket'], maxPriceMinor: 1500.5 }).ok).toBe(false);
  });

  it('cinsiyet yalnızca sözleşmedeki değerlerden olabilir', () => {
    expect(parseIntent({ keywords: ['ceket'], gender: 'KADIN' }).ok).toBe(false);
    expect(parseIntent({ keywords: ['ceket'], gender: 'WOMAN' }).ok).toBe(true);
  });

  it('hatalı çıktı FIRLATMAZ, rapor eder — çağıran anahtar kelime aramasına düşecek', () => {
    const result = parseIntent('bu bir JSON bile değil');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('sanitizeIntent — değerler katalogda gerçekten var mı', () => {
  it('katalogda olmayan kategori ELENİR — yoksa arama sessizce sıfır sonuç döner', () => {
    const intent = sanitizeIntent(draft({ category: 'kadin-uzay-giysisi' }), SOZ_VARLIGI);
    expect(intent.category).toBeUndefined();
  });

  it('katalogda olan kategori korunur', () => {
    const intent = sanitizeIntent(draft({ category: 'kadin-elbise' }), SOZ_VARLIGI);
    expect(intent.category).toBe('kadin-elbise');
  });

  it('renk katalogdaki YAZIMINA çevrilir — SQL karşılaştırması birebirdir', () => {
    const intent = sanitizeIntent(draft({ colors: ['siyah', 'LACİVERT'] }), SOZ_VARLIGI);
    expect(intent.colors).toEqual(['Siyah', 'Lacivert']);
  });

  it('katalogda olmayan renk elenir', () => {
    const intent = sanitizeIntent(draft({ colors: ['neon yeşil'] }), SOZ_VARLIGI);
    expect(intent.colors).toBeUndefined();
  });

  it('anahtar kelimeler tavanla sınırlanır — her terim tsquery’de VE ile bağlanır', () => {
    const intent = sanitizeIntent(
      draft({ keywords: ['ceket', 'blazer', 'yün', 'astarlı', 'klasik'] }),
      SOZ_VARLIGI,
    );
    expect(intent.keywords).toHaveLength(NATURAL_SEARCH.maxKeywords);
  });

  it('salt rakam olan anahtar kelime atılır — hiçbir başlıkta "5000" geçmez', () => {
    const intent = sanitizeIntent(
      draft({ keywords: ['5000', 'elbise'], maxPriceMinor: 500_000 }),
      SOZ_VARLIGI,
    );
    expect(intent.keywords).toEqual(['elbise']);
    expect(intent.maxPriceMinor).toBe(500_000n);
  });

  it('yapılandırılmış filtreye giren renk anahtar kelimeden düşer', () => {
    const intent = sanitizeIntent(
      draft({ keywords: ['siyah', 'elbise'], colors: ['siyah'] }),
      SOZ_VARLIGI,
    );
    expect(intent.keywords).toEqual(['elbise']);
    expect(intent.colors).toEqual(['Siyah']);
  });

  it('tekrar eden anahtar kelime bir kez alınır', () => {
    const intent = sanitizeIntent(draft({ keywords: ['Ceket', 'ceket'] }), SOZ_VARLIGI);
    expect(intent.keywords).toEqual(['Ceket']);
  });

  it('para bigint’e çevrilir, Number aritmetiğine girmez', () => {
    const intent = sanitizeIntent(draft({ maxPriceMinor: 500_000 }), SOZ_VARLIGI);
    expect(intent.maxPriceMinor).toBe(500_000n);
    expect(typeof intent.maxPriceMinor).toBe('bigint');
  });

  it('kullanım amacı ve mevsim taşınır (gösterim için), atılmaz', () => {
    const intent = sanitizeIntent(draft({ occasion: 'iş görüşmesi', season: 'kış' }), SOZ_VARLIGI);
    expect(intent.occasion).toBe('iş görüşmesi');
    expect(intent.season).toBe('kış');
  });

  it('söz varlığı okunamamışsa (boş liste) kategori ve renk elenir, arama yine çalışır', () => {
    const bos: CatalogVocabulary = { categorySlugs: [], colors: [], brands: [] };
    const intent = sanitizeIntent(
      draft({ category: 'kadin-elbise', colors: ['Siyah'], maxPriceMinor: 100_000 }),
      bos,
    );

    expect(intent.category).toBeUndefined();
    expect(intent.colors).toBeUndefined();
    expect(intent.maxPriceMinor).toBe(100_000n);
  });
});

describe('intentToProductListQuery — niyet mevcut katalog sorgusuna çevrilir', () => {
  it('cümlenin tamamı değil, yalnızca ürün adı tsquery’ye gider', () => {
    // "5000 TL altı iş görüşmesi için sade bir kombin" cümlesinin karşılığı.
    const intent = sanitizeIntent(
      draft({
        keywords: ['blazer ceket'],
        category: 'kadin-ust-giyim',
        colors: ['siyah'],
        maxPriceMinor: 500_000,
        gender: 'WOMAN',
        occasion: 'iş görüşmesi',
        season: 'kış',
      }),
      SOZ_VARLIGI,
    );

    const query = intentToProductListQuery(intent, 24);

    expect(query.q).toBe('blazer ceket');
    expect(query.category).toBe('kadin-ust-giyim');
    expect(query.color).toEqual(['Siyah']);
    expect(query.maxPriceMinor).toBe(500_000n);
    expect(query.gender).toBe('WOMAN');
    expect(query.inStockOnly).toBe(true);
    expect(query.sort).toBe('relevance');
    expect(query.limit).toBe(24);
  });

  it('kullanım amacı ve mevsim tsquery’ye SIZMAZ — terimler VE ile bağlanır, sonuç sıfırlanırdı', () => {
    const query = intentToProductListQuery(
      sanitizeIntent(draft({ occasion: 'iş görüşmesi', season: 'kış' }), SOZ_VARLIGI),
      24,
    );

    expect(query.q).toBe('ceket');
    expect(query.q).not.toContain('görüşme');
    expect(query.q).not.toContain('kış');
  });

  it('ürün adı yoksa metin araması hiç yapılmaz, yalnızca filtreler kalır', () => {
    const query = intentToProductListQuery(
      sanitizeIntent(draft({ keywords: [], maxPriceMinor: 500_000 }), SOZ_VARLIGI),
      24,
    );

    expect(query.q).toBeUndefined();
    expect(query.maxPriceMinor).toBe(500_000n);
  });

  it('uydurma kategori filtreye HİÇ ulaşmaz', () => {
    const query = intentToProductListQuery(
      sanitizeIntent(draft({ category: 'yok-boyle-kategori' }), SOZ_VARLIGI),
      24,
    );
    expect(query.category).toBeUndefined();
  });
});

describe('fallbackProductListQuery — LLM devre dışıyken', () => {
  it('kullanıcının cümlesini olduğu gibi arar', () => {
    const query = fallbackProductListQuery('  siyah keten gömlek  ', 24);
    expect(query.q).toBe('siyah keten gömlek');
    expect(query.inStockOnly).toBe(true);
    expect(query.sort).toBe('relevance');
  });

  it('metin sınırını katalog şemasıyla aynı tutar (100 karakter)', () => {
    const query = fallbackProductListQuery('a'.repeat(150), 24);
    expect(query.q).toHaveLength(100);
  });
});
