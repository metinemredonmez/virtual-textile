import { z } from 'zod';
import { genderSchema } from '@vt/contracts';
import { NATURAL_SEARCH } from '@vt/config';

/** POST /v1/search/natural gövdesi. */
export const naturalSearchBodySchema = z.object({
  query: z.string().trim().min(2).max(NATURAL_SEARCH.maxQueryChars),
});

export type NaturalSearchBody = z.infer<typeof naturalSearchBodySchema>;

/**
 * MODELİN ÜRETEBİLECEĞİ TEK ŞEKİL
 *
 * ⚠️ `.strict()` KASITLIDIR. Model tanımlı olmayan bir alan eklerse (ör.
 *    "products", "reasoning", "recommendation") şema tamamen reddedilir ve
 *    arama anahtar kelime yoluna düşer. Bilinmeyen alanı sessizce ayıklamak
 *    daha "hoşgörülü" görünür ama tehlikelidir: modelin sözleşmeden saptığını
 *    kimse görmez ve bir gün o alan gerçekten kullanılmaya başlanır.
 *
 * ⚠️ BURADA ÜRÜN YOKTUR ve OLMAYACAKTIR. Model yalnızca NİYETİ çevirir;
 *    hangi ürünlerin döneceğine veritabanı karar verir. Şemaya bir `products`
 *    veya `productIds` alanı eklemek, modele katalogda olmayan ürün uydurma
 *    izni vermek demektir — doğal dilde aramanın tek gerçek riski budur.
 *
 * ⚠️ Şema DEĞERLERİ doğrulamaz, yalnızca ŞEKLİ doğrular. "kadin-mont-xyz"
 *    geçerli bir string'dir ama katalogda karşılığı yoksa arama SESSİZCE
 *    sıfır sonuç döner (kategori CTE'si boş küme üretir). Değer doğrulaması
 *    katalog söz varlığına karşı yapılır — bkz. `sanitizeIntent`.
 */
export const searchIntentSchema = z
  .object({
    /**
     * Ürün adı ve ayırt edici nitelikler — cümlenin tamamı DEĞİL.
     * Boş dizi geçerlidir: "5000 TL altı bir şeyler" gibi sorgularda ürün adı
     * yoktur, yalnızca fiyat filtresi vardır.
     */
    keywords: z.array(z.string().trim().min(1).max(40)).max(8),
    category: z.string().trim().min(1).max(120).optional(),
    colors: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
    /**
     * ⚠️ PARA: JSON bigint taşıyamaz, model de bigint üretemez. Sınırda TAM
     *    SAYI KURUŞ kabul edilir ve `sanitizeIntent` içinde HEMEN bigint'e
     *    çevrilir. Bu değer hiçbir yerde Number aritmetiğine girmez.
     *    Üst sınır 1.000.000,00 ₺ — üstü model hatasıdır (TL'yi kuruş sanmak).
     */
    maxPriceMinor: z.number().int().nonnegative().max(100_000_000).optional(),
    gender: genderSchema.optional(),
    /**
     * ⚠️ FİLTREYE DÖNÜŞMEZ — bilinçli olarak. Katalogda "kullanım amacı"
     *    diye bir alan yok ve bu kelimeler `searchVector`'da da aranmaz.
     *    Yine de şemada DURMASI gerekir: modele "iş görüşmesi"ni koyacak bir
     *    yer verilmezse onu `keywords`e sıkıştırır ve tsquery'yi VE'leyerek
     *    aramayı sıfırlar. Bu alan bir ÇÖP KUTUSU değil, TAMPONDUR.
     *    (Karşılığı geldiğinde tek satırlık bir eşleme yeter.)
     */
    occasion: z.string().trim().min(1).max(60).optional(),
    /** Aynı gerekçe: `Product.season` kolonu var ama `listProducts` filtrelemiyor. */
    season: z.string().trim().min(1).max(30).optional(),
  })
  .strict();

export type SearchIntentDraft = z.infer<typeof searchIntentSchema>;

/**
 * Temizlenmiş niyet: değerleri katalogda GERÇEKTEN var olan filtre.
 * Modelin ürettiği ham taslaktan farkı, buradaki her değerin veritabanında
 * karşılığının doğrulanmış olmasıdır.
 */
export interface SearchIntent {
  keywords: string[];
  category?: string;
  colors?: string[];
  maxPriceMinor?: bigint;
  gender?: z.infer<typeof genderSchema>;
  /** Taşınır, filtrelenmez — bkz. yukarıdaki gerekçe. Arayüz rozet olarak gösterir. */
  occasion?: string;
  season?: string;
}

/**
 * Aramanın hangi yoldan geçtiği. İstemci bunu kullanıcıya gösterir
 * ("Bütçe: 5.000 ₺ altı"), operasyon ise LLM'in ne sıklıkla devre dışı
 * kaldığını buradan ölçer.
 *
 * ⚠️ Hiçbiri HATA DEĞİLDİR. Her değer "sonuç döndü, şu yoldan" demektir.
 */
export type InterpretationOutcome =
  /** Cümle çözüldü, filtre uygulandı. */
  | 'INTERPRETED'
  /** Kısa sorgu — LLM'e hiç gitmedi (eşik: NATURAL_SEARCH.minWordsForLlm). */
  | 'SHORT_QUERY'
  /** Sorgu yalnızca bir marka adı — anahtar kelime araması zaten doğru cevap. */
  | 'BRAND_ONLY'
  /** Günlük kota doldu. */
  | 'QUOTA_EXCEEDED'
  /** Platform AI bütçe tavanı doldu. */
  | 'BUDGET_EXCEEDED'
  /** Sağlayıcı yapılandırılmamış (ANTHROPIC_API_KEY yok). */
  | 'PROVIDER_NOT_CONFIGURED'
  /** Sağlayıcı çağrısı hata verdi ya da zaman aşımına uğradı. */
  | 'PROVIDER_ERROR'
  /** Model şemaya uymayan bir çıktı üretti. */
  | 'INVALID_OUTPUT';
