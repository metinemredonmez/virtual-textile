import type { MinorString } from './money.js';
import type { GenderWire, ProductListPayloadWire } from './catalog.js';

/**
 * ARAMA UÇLARININ TELDEKİ ŞEKLİ — ÖLÇÜLDÜ, TAHMİN EDİLMEDİ.
 *
 * Kaynak istekler:
 *   GET  /v1/search/suggest?q=keten
 *        → {"data":[{"text":"Keten Oversize Gömlek","type":"product"}],"meta":{…}}
 *   POST /v1/search/natural  {"query":"iş görüşmesi için 2000 TL altı siyah gömlek"}
 *        → data.interpretation = {"outcome":"INTERPRETED","filter":{…}}
 *
 * ⚠️ Paket içinden `@vt/contracts` ile İTHAL EDİLMEZ, kardeş dosyadan alınır:
 *    paketin kendi adına yazılan import döngüsel çözümlemeye girer ve `dist`
 *    üretimini kendi kendine bağımlı yapar.
 */

export interface SuggestItemWire {
  text: string;
  /** Bugün yalnız `product` ölçüldü; uç marka önerisi de üretebiliyor. */
  type: 'product' | 'brand';
}

/**
 * Cümlenin çevrildiği filtre. İstemci bunu İKİ iş için kullanır:
 * kullanıcıya "neyi anladım"ı göstermek ve SONRAKİ sayfayı `GET /v1/products`
 * üzerinden çekmek.
 *
 * ⚠️ İkincisi maliyet kararıdır: sayfalama bu uçtan yapılsaydı her "sonraki
 *    sayfa" aynı cümle için BİR LLM ÇAĞRISI daha olurdu.
 */
export interface AppliedFilterWire {
  keywords: string[];
  category: string | null;
  colors: string[];
  /** ⚠️ Telde string: ölçülen değer `"200000"` (2.000,00 ₺). bigint değil. */
  maxPriceMinor: MinorString | null;
  gender: GenderWire | null;
  /**
   * ⚠️ `occasion` ve `season` FİLTREYE DÖNÜŞMEZ — katalogda karşılıkları yok
   *    (bkz. natural-search.schema.ts). Sunucu bunları yalnızca "seni şöyle
   *    anladım" diyebilelim diye geri veriyor. Bunları sonraki sayfanın
   *    sorgusuna eklemek sonucu SESSİZCE daraltırdı.
   */
  occasion: string | null;
  season: string | null;
}

/**
 * ⚠️ Hiçbiri HATA DEĞİLDİR; hepsi "sonuç döndü, şu yoldan" demektir. `outcome`
 *    kullanıcıya hata olarak gösterilmez — en fazla "cümleni yorumlayamadım,
 *    kelimelerle aradım" bilgisidir.
 */
export type InterpretationOutcomeWire =
  | 'INTERPRETED'
  | 'SHORT_QUERY'
  | 'BRAND_ONLY'
  | 'QUOTA_EXCEEDED'
  | 'BUDGET_EXCEEDED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_ERROR'
  | 'INVALID_OUTPUT';

/**
 * `POST /v1/search/natural` yükü.
 *
 * ⚠️ Alan sırası `GET /v1/products` ile AYNI tutulmuş (sunucu yorumu): aynı
 *    liste bileşeni iki uçtan da beslenebilsin diye. `interpretation` tek fark.
 */
export interface NaturalSearchPayloadWire extends ProductListPayloadWire {
  interpretation: {
    outcome: InterpretationOutcomeWire;
    /** Yorumlama yapılmadıysa `null` — sonuç yine gelir. */
    filter: AppliedFilterWire | null;
  };
}
