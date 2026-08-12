/**
 * DOĞAL DİLDE ARAMA — EŞİKLER, KOTA VE SINIRLAR
 *
 * Buradaki her sayı bir ÜRÜN kararıdır ve gerekçesi yanındadır. Kod içine
 * gömülmemesinin sebebi `@vt/config/constants.ts` ile aynı: değer değişince
 * testler de aynı değeri görsün, iki yerde ayrışmasın.
 *
 * ⚠️ NEDEN `@vt/config` İÇİNDE DEĞİL: `SEARCH` sabiti oraya ait ve bu blok da
 *    uzun vadede oraya taşınmalı. Bu görevin kapsamı `modules/catalog` ile
 *    sınırlı olduğu ve `packages/config` üzerinde paralel çalışan başka ajanlar
 *    bulunduğu için burada duruyor. Taşıma tek dosya taşımasıdır; kod
 *    değişmez, yalnızca import yolu değişir.
 */
export const NATURAL_SEARCH = {
  /**
   * KELİME EŞİĞİ — LLM'e gitmenin alt sınırı.
   *
   * Bir sorgu, ancak ANAHTAR KELİME İNDEKSİNİN KULLANAMAYACAĞI bir bilgi
   * taşıyorsa LLM'e değer: bütçe ("5000 TL altı"), kullanım amacı ("iş
   * görüşmesi için"), cinsiyet ("erkeğe"), olumsuzlama ("desensiz").
   * Bu bilgiler Türkçe'de CÜMLE olarak yazılır; ürün adı ise 1-3 kelimedir.
   *
   * "siyah keten gömlek" (3 kelime) zaten mükemmel bir tsquery'dir: üç terim
   * de searchVector'da A/B ağırlıklı alanlarda karşılık bulur. Buna LLM
   * eklemek ~1 sn gecikme ve ~0,001 $ maliyet ekler, FİLTREYİ DEĞİŞTİRMEZ.
   *
   * Ölçüt "kaç kelime" değil aslında "cümle mi"; 4 kelime bunun ucuz ve
   * yanılması ucuz olan yaklaşık karşılığıdır. Yanlış tarafa düşerse ne olur:
   *   - Gereksiz LLM  → para ve gecikme (kötü)
   *   - Kaçırılan LLM → normal arama çalışır, kullanıcı sonuç alır (kabul)
   * Bu asimetri eşiğin YÜKSEK tutulmasını gerektirir.
   */
  minWordsForLlm: 4,

  /**
   * RAKAM İSTİSNASI — eşiğin altına inen tek durum.
   *
   * "5000 altı elbise" 3 kelimedir ama anahtar kelime aramasında SIFIR sonuç
   * verir: `websearch_to_tsquery` terimleri VE ile bağlar ve hiçbir ürün
   * başlığında "5000" geçmez. Rakam içeren kısa sorgu, tam da anahtar kelime
   * aramasının çuvalladığı yerdir; LLM burada sorunu çözer (fiyat → filtre).
   */
  minWordsWithNumericHint: 2,

  /**
   * ANAHTAR KELİME TAVANI.
   *
   * ⚠️ `websearch_to_tsquery` boşlukla ayrılmış terimleri VE'ler, VEYA'lamaz.
   *    Her ek kelime sonuç kümesini DARALTIR. Modele "cümledeki her şeyi
   *    keywords'e koy" dedirtmek, aramayı sıfır sonuca kilitlemenin en hızlı
   *    yoludur. Bu yüzden model yalnızca ÜRÜN ADINI yazar (en fazla 3 terim),
   *    geri kalan her şey yapılandırılmış alanlara gider.
   */
  maxKeywords: 3,

  /** Sorgu üst sınırı — bundan uzunu cümle değil, yapıştırılmış metindir. */
  maxQueryChars: 200,

  /**
   * GÜNLÜK KOTA — stil danışmanından AYRI (gerekçe: natural-search.service.ts).
   *
   * ⚠️ NEEDS-CONFIG: `AI_NL_SEARCH_DAILY_PER_USER` / `..._PER_GUEST` olarak
   *    `packages/config/src/env.ts` içine taşınmalı. Ortamdan okunamadığı
   *    sürece kota yalnızca yeni sürümle değiştirilebilir; bu bir olay anında
   *    (maliyet fırlaması) müdahale hızını düşürür.
   *
   * Sayıların gerekçesi: doğal dilde arama bir KEŞİF aracıdır, sohbet değil.
   * Aktif bir kullanıcı günde birkaç kez cümle kurar, onlarca kez değil;
   * 20 sınırı gerçek kullanımın çok üstünde, otomatik kazımanın çok altındadır.
   */
  dailyPerUser: 20,

  /**
   * Misafir sınırı daha düşük: kimliksiz istek IP başına sayılır ve IP
   * paylaşılabilir (kurumsal NAT, mobil operatör). Düşük tavan hem kötüye
   * kullanımı hem de masum paylaşımın faturasını sınırlar. Kota dolunca
   * misafir HATA GÖRMEZ; anahtar kelime aramasına düşer.
   */
  dailyPerGuest: 5,

  /**
   * Katalog söz varlığı (kategori/renk/marka) önbellek ömrü.
   *
   * Bu liste her aramada iki toplu sorgu demektir; arama sıcak yoldur.
   * Kategori ve renk kümesi günde birkaç kez değişir, saniyede değil.
   * 10 dakikalık bayatlık, yeni eklenen bir kategorinin en fazla 10 dakika
   * boyunca cümleden çıkarılamaması demektir — o sorgu yine sonuç döner.
   */
  vocabularyTtlMs: 10 * 60_000,

  /**
   * Bütçe anlık görüntüsü ömrü.
   *
   * ⚠️ Stil danışmanı bütçeyi HER mesajda sorar; mesaj seyrektir, sorgu ise
   *    `ai_usage_logs` üzerinde iki toplama (aggregate) yapar. Arama sıcak
   *    yolda aynı şeyi yaparsa tablo büyüdükçe aramayı bu sorgu yavaşlatır.
   *    60 saniyelik bayatlık, tavan aşıldıktan sonra en fazla 60 saniyelik
   *    harcamanın kaçması demektir — iki toplamanın her aramada ödenmesinden
   *    kat kat ucuz. Gerçek fren zaten katmanlı: kota → bütçe → sağlayıcı.
   */
  budgetSnapshotTtlMs: 60_000,

  /**
   * Modelin üretebileceği azami token. Çıktı tek bir küçük JSON nesnesidir;
   * bu sınır aynı zamanda "model cevap yazmaya kalkarsa" maliyet frenidir.
   */
  maxOutputTokens: 400,

  /** Söz varlığı istem içinde kaç değere kadar taşınır — bağlam maliyeti. */
  vocabularyLimits: {
    categories: 80,
    colors: 40,
    brands: 60,
  },

  /** Yorumlanmış aramada sayfa boyu. Sayfalama için bkz. natural-search.service.ts */
  pageSize: 24,
} as const;
