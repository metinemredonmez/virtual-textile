/**
 * DEMO VERİ TABLOSU — tek bildirimsel kaynak.
 *
 * Seed'in kendisi bu tabloyu OKUR, içine veri gömmez. Ayrımın somut faydası:
 * `seed-assets/uret.ts` (yer tutucu görsel üreticisi) aynı tabloyu okuyor, yani
 * "görseli üretilmemiş ürün" ya da "ürünü olmayan görsel" durumu doğamaz —
 * ikisi de aynı diziden türüyor.
 *
 * ⚠️ Buradaki hiçbir sayı ekrana ÇIKMAK için seçilmedi; hepsi bir EKRANI
 *    ölçülebilir hâle getirmek için seçildi. Örneğin `eski-moda` mağazasının
 *    SUSPENDED olması bir süs değil: `catalog.service.ts` yalnızca
 *    `s."status" = 'APPROVED'` mağazaları listeliyor, yani o mağazanın ürünü
 *    vitrinde GÖRÜNMEMELİ ve yönetim panelinde GÖRÜNMELİ. İkisini birden
 *    doğrulayabilmek için askıya alınmış bir mağazanın yayınlanmış bir ürüne
 *    sahip olması gerekiyor.
 */

import type {
  Gender,
  ImageAngle,
  ProductStatus,
  TryOnCategory,
} from '../../generated/client/index.js';

// ── Kategori ağacı ─────────────────────────────────────────────────────────

export interface KategoriTanimi {
  readonly slug: string;
  readonly ad: string;
  readonly ustSlug: string | null;
  readonly tryOn: TryOnCategory | null;
  readonly sira: number;
}

/**
 * ÜÇ SEVİYE.
 *
 * ⚠️ Dört slug İSİM OLARAK SERBEST DEĞİL — `apps/web/.../collection/
 *    koleksiyonlar.ts` içindeki `kategoriAdaylari` listeleri bunları arıyor:
 *    `kadin-denim`, `abiye-gelinlik`, `kadin-spor-giyim`, `kadin-elbise`.
 *    Dördü de bugüne kadar YOKTU ve dört iniş sayfası da bu yüzden boştu.
 *    Yeniden adlandırılırsa o sayfalar sessizce boşalır — hata vermez.
 */
export const KATEGORILER: readonly KategoriTanimi[] = [
  { slug: 'kadin', ad: 'Kadın', ustSlug: null, tryOn: null, sira: 1 },
  { slug: 'kadin-ust-giyim', ad: 'Üst Giyim', ustSlug: 'kadin', tryOn: 'UPPER_BODY', sira: 1 },
  { slug: 'kadin-gomlek', ad: 'Gömlek', ustSlug: 'kadin-ust-giyim', tryOn: 'UPPER_BODY', sira: 1 },
  { slug: 'kadin-bluz', ad: 'Bluz', ustSlug: 'kadin-ust-giyim', tryOn: 'UPPER_BODY', sira: 2 },
  { slug: 'kadin-triko', ad: 'Triko', ustSlug: 'kadin-ust-giyim', tryOn: 'UPPER_BODY', sira: 3 },
  { slug: 'kadin-alt-giyim', ad: 'Alt Giyim', ustSlug: 'kadin', tryOn: 'LOWER_BODY', sira: 2 },
  {
    slug: 'kadin-pantolon',
    ad: 'Pantolon',
    ustSlug: 'kadin-alt-giyim',
    tryOn: 'LOWER_BODY',
    sira: 1,
  },
  { slug: 'kadin-denim', ad: 'Denim', ustSlug: 'kadin-alt-giyim', tryOn: 'LOWER_BODY', sira: 2 },
  { slug: 'kadin-etek', ad: 'Etek', ustSlug: 'kadin-alt-giyim', tryOn: 'LOWER_BODY', sira: 3 },
  { slug: 'kadin-elbise', ad: 'Elbise', ustSlug: 'kadin', tryOn: 'DRESS', sira: 3 },
  {
    slug: 'kadin-gunluk-elbise',
    ad: 'Günlük Elbise',
    ustSlug: 'kadin-elbise',
    tryOn: 'DRESS',
    sira: 1,
  },
  {
    slug: 'abiye-gelinlik',
    ad: 'Abiye & Gelinlik',
    ustSlug: 'kadin-elbise',
    tryOn: 'DRESS',
    sira: 2,
  },
  { slug: 'kadin-dis-giyim', ad: 'Dış Giyim', ustSlug: 'kadin', tryOn: 'OUTERWEAR', sira: 4 },
  {
    slug: 'kadin-trenckot',
    ad: 'Trençkot',
    ustSlug: 'kadin-dis-giyim',
    tryOn: 'OUTERWEAR',
    sira: 1,
  },
  { slug: 'kadin-mont', ad: 'Mont', ustSlug: 'kadin-dis-giyim', tryOn: 'OUTERWEAR', sira: 2 },
  { slug: 'kadin-spor-giyim', ad: 'Spor Giyim', ustSlug: 'kadin', tryOn: 'UPPER_BODY', sira: 5 },
  {
    slug: 'kadin-sweatshirt',
    ad: 'Sweatshirt',
    ustSlug: 'kadin-spor-giyim',
    tryOn: 'UPPER_BODY',
    sira: 1,
  },
  { slug: 'kadin-tayt', ad: 'Tayt', ustSlug: 'kadin-spor-giyim', tryOn: 'LOWER_BODY', sira: 2 },

  { slug: 'erkek', ad: 'Erkek', ustSlug: null, tryOn: null, sira: 2 },
  { slug: 'erkek-ust-giyim', ad: 'Üst Giyim', ustSlug: 'erkek', tryOn: 'UPPER_BODY', sira: 1 },
  { slug: 'erkek-gomlek', ad: 'Gömlek', ustSlug: 'erkek-ust-giyim', tryOn: 'UPPER_BODY', sira: 1 },
  { slug: 'erkek-tisort', ad: 'Tişört', ustSlug: 'erkek-ust-giyim', tryOn: 'UPPER_BODY', sira: 2 },
  { slug: 'erkek-alt-giyim', ad: 'Alt Giyim', ustSlug: 'erkek', tryOn: 'LOWER_BODY', sira: 2 },
  { slug: 'erkek-denim', ad: 'Denim', ustSlug: 'erkek-alt-giyim', tryOn: 'LOWER_BODY', sira: 1 },
  { slug: 'erkek-chino', ad: 'Chino', ustSlug: 'erkek-alt-giyim', tryOn: 'LOWER_BODY', sira: 2 },
  { slug: 'erkek-dis-giyim', ad: 'Dış Giyim', ustSlug: 'erkek', tryOn: 'OUTERWEAR', sira: 3 },

  { slug: 'unisex', ad: 'Unisex', ustSlug: null, tryOn: null, sira: 3 },
  { slug: 'unisex-ust-giyim', ad: 'Üst Giyim', ustSlug: 'unisex', tryOn: 'UPPER_BODY', sira: 1 },
  /**
   * ⚠️ `ACCESSORY` katalogda TANIMLI ama sağlayıcı yetenek matrisinde KAPALI
   *    (bkz. schema.prisma → TryOnCategory yorumu). Bilerek duruyor: "kategori
   *    var ama deneme kapalı" hâli ekranda ancak böyle bir ürünle görünür.
   */
  { slug: 'unisex-aksesuar', ad: 'Aksesuar', ustSlug: 'unisex', tryOn: 'ACCESSORY', sira: 2 },

  { slug: 'cocuk', ad: 'Çocuk', ustSlug: null, tryOn: null, sira: 4 },
  { slug: 'cocuk-ust-giyim', ad: 'Üst Giyim', ustSlug: 'cocuk', tryOn: 'UPPER_BODY', sira: 1 },
  { slug: 'cocuk-alt-giyim', ad: 'Alt Giyim', ustSlug: 'cocuk', tryOn: 'LOWER_BODY', sira: 2 },
];

// ── Satıcılar ──────────────────────────────────────────────────────────────

export interface SaticiTanimi {
  readonly slug: string;
  readonly unvan: string;
  readonly ad: string;
  readonly durum: 'APPROVED' | 'PENDING' | 'SUSPENDED';
  readonly kaliteSkoru: number;
  readonly durumGerekcesi?: string;
  /** Yönetim panelindeki belge inceleme akışı için. */
  readonly belgeler?: readonly {
    tur: 'TAX_CERTIFICATE' | 'TRADE_REGISTRY' | 'SIGNATURE_CIRCULAR';
    dosyaAdi: string;
  }[];
}

export const SATICILAR: readonly SaticiTanimi[] = [
  {
    slug: 'atolye-nord',
    unvan: 'Atölye Nord Tekstil A.Ş.',
    ad: 'Atölye Nord',
    durum: 'APPROVED',
    kaliteSkoru: 86,
  },
  { slug: 'mavra', unvan: 'Mavra Moda Ltd. Şti.', ad: 'Mavra', durum: 'APPROVED', kaliteSkoru: 78 },
  {
    slug: 'denim-atolyesi',
    unvan: 'Denim Atölyesi Konfeksiyon Ltd. Şti.',
    ad: 'Denim Atölyesi',
    durum: 'APPROVED',
    kaliteSkoru: 72,
  },
  {
    slug: 'kuzey-spor',
    unvan: 'Kuzey Spor Giyim A.Ş.',
    ad: 'Kuzey Spor',
    durum: 'APPROVED',
    kaliteSkoru: 64,
  },
  {
    slug: 'bosphorus-tekstil',
    unvan: 'Bosphorus Tekstil San. ve Tic. Ltd. Şti.',
    ad: 'Bosphorus Tekstil',
    durum: 'PENDING',
    kaliteSkoru: 50,
    belgeler: [
      { tur: 'TAX_CERTIFICATE', dosyaAdi: 'vergi-levhasi.pdf' },
      { tur: 'TRADE_REGISTRY', dosyaAdi: 'ticaret-sicil-gazetesi.pdf' },
      { tur: 'SIGNATURE_CIRCULAR', dosyaAdi: 'imza-sirkuleri.pdf' },
    ],
  },
  {
    slug: 'eski-moda',
    unvan: 'Eski Moda Konfeksiyon Ltd. Şti.',
    ad: 'Eski Moda',
    durum: 'SUSPENDED',
    kaliteSkoru: 31,
    durumGerekcesi: 'Kargo SLA ihlali ve yüksek iade oranı — inceleme sürüyor.',
  },
];

// ── Ürünler ────────────────────────────────────────────────────────────────

/** Yer tutucu görselin çizeceği silüet. `tryOn` alanından TÜRETİLMEZ. */
export type Siluet = 'ust' | 'alt' | 'elbise' | 'dis' | 'aksesuar';

export interface UrunTanimi {
  readonly slug: string;
  readonly baslik: string;
  readonly saticiSlug: string;
  readonly kategoriSlug: string;
  readonly cinsiyet: Gender;
  readonly durum: ProductStatus;
  readonly aciklama: string;
  readonly siluet: Siluet;
  readonly koleksiyon?: string;
  readonly sezon?: string;
  readonly etiketler: Readonly<Record<string, string>>;
  readonly tryOnSkoru: number;
  readonly tryOnSorunlari?: readonly string[];
  readonly populerlik: number;
  readonly goruntuleme: number;
  readonly denemeSayisi: number;
  readonly fiyatTl: number;
  readonly listeFiyatiTl?: number;
  readonly bedenler: readonly string[];
  readonly renkler: readonly { ad: string; hex: string }[];
  /** Varyant başına stok. 0 → tükenmiş (vitrin filtresi bunu gizler). */
  readonly stok: number;
  readonly bedenTablosu?: Readonly<Record<string, Record<string, number>>>;
}

const UST_BEDEN_TABLOSU = {
  XS: { gogus: 84, bel: 66, boy: 60 },
  S: { gogus: 88, bel: 70, boy: 62 },
  M: { gogus: 94, bel: 76, boy: 64 },
  L: { gogus: 100, bel: 82, boy: 66 },
  XL: { gogus: 108, bel: 90, boy: 68 },
} as const;

const ALT_BEDEN_TABLOSU = {
  '26': { bel: 66, kalca: 92, icBoy: 76 },
  '28': { bel: 71, kalca: 97, icBoy: 77 },
  '30': { bel: 76, kalca: 102, icBoy: 78 },
  '32': { bel: 81, kalca: 107, icBoy: 79 },
} as const;

const EKRU = { ad: 'Ekru', hex: '#EFE9DE' };
const BEJ = { ad: 'Bej', hex: '#D9CBB3' };
const BEYAZ = { ad: 'Beyaz', hex: '#FFFFFF' };
const SIYAH = { ad: 'Siyah', hex: '#111111' };
const ANTRASIT = { ad: 'Antrasit', hex: '#3A3A3A' };
const LACIVERT = { ad: 'Lacivert', hex: '#1C2A44' };
const HAKI = { ad: 'Haki', hex: '#5A5F4A' };
const GRI = { ad: 'Gri Melanj', hex: '#9B9B99' };
const INDIGO = { ad: 'İndigo', hex: '#2C3E5C' };
const ACIK_INDIGO = { ad: 'Açık İndigo', hex: '#7C93B0' };
const FILDISI = { ad: 'Fildişi', hex: '#F5EFE3' };
const SAMPANYA = { ad: 'Şampanya', hex: '#E8D9BE' };

export const URUNLER: readonly UrunTanimi[] = [
  // ── Atölye Nord ─────────────────────────────────────────────────────────
  {
    slug: 'keten-gomlek-oversize',
    baslik: 'Keten Oversize Gömlek',
    saticiSlug: 'atolye-nord',
    kategoriSlug: 'kadin-gomlek',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama:
      'Yıkanmış keten kumaştan üretilen, düşük omuzlu oversize gömlek. Sıcak havalarda rahat kullanım için tasarlandı. Kumaş her yıkamada biraz daha yumuşar.',
    siluet: 'ust',
    sezon: 'İlkbahar/Yaz',
    etiketler: {
      color: 'Bej',
      pattern: 'Düz',
      fabric: 'Keten',
      neckline: 'Klasik',
      fit: 'Oversize',
    },
    tryOnSkoru: 86,
    populerlik: 92,
    goruntuleme: 4821,
    denemeSayisi: 412,
    fiyatTl: 1290,
    listeFiyatiTl: 1690,
    bedenler: ['XS', 'S', 'M', 'L', 'XL'],
    renkler: [BEJ, BEYAZ, HAKI],
    stok: 12,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'poplin-beyaz-gomlek',
    baslik: 'Poplin Beyaz Gömlek',
    saticiSlug: 'atolye-nord',
    kategoriSlug: 'kadin-gomlek',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama:
      'Uzun elyaflı pamuktan dokunmuş poplin gömlek. Ofis ve günlük kullanım arasında geçiş yapan klasik kalıp.',
    siluet: 'ust',
    etiketler: {
      color: 'Beyaz',
      pattern: 'Düz',
      fabric: 'Pamuk poplin',
      neckline: 'Klasik',
      fit: 'Regular',
    },
    tryOnSkoru: 81,
    populerlik: 74,
    goruntuleme: 2140,
    denemeSayisi: 188,
    fiyatTl: 990,
    bedenler: ['S', 'M', 'L'],
    renkler: [BEYAZ, ACIK_INDIGO],
    stok: 20,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'triko-kazak',
    baslik: 'Yumuşak Dokulu Triko Kazak',
    saticiSlug: 'atolye-nord',
    kategoriSlug: 'kadin-triko',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'İnce triko, günlük kullanım için yumuşak dokulu kazak. Bisiklet yaka, düşük omuz.',
    siluet: 'ust',
    sezon: 'Sonbahar/Kış',
    etiketler: { color: 'Antrasit', pattern: 'Düz', fabric: 'Akrilik karışım', fit: 'Regular' },
    // ⚠️ Bilerek düşük: satıcı panelindeki "Try-On uygunluğu" uyarı akışı
    //    ancak eşiğin (TRYON.minProductReadinessScore = 60) altında görünür.
    tryOnSkoru: 42,
    tryOnSorunlari: ['missing_back_angle', 'busy_background'],
    populerlik: 48,
    goruntuleme: 1105,
    denemeSayisi: 39,
    fiyatTl: 890,
    bedenler: ['M', 'L'],
    renkler: [ANTRASIT, EKRU],
    stok: 5,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'yikanmis-keten-bluz',
    baslik: 'Yıkanmış Keten Bluz',
    saticiSlug: 'atolye-nord',
    kategoriSlug: 'kadin-bluz',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'Hafif keten bluz, kolları katlanabilir. Dökümlü kalıp, ütü izi bırakmayan doku.',
    siluet: 'ust',
    sezon: 'İlkbahar/Yaz',
    etiketler: {
      color: 'Ekru',
      pattern: 'Düz',
      fabric: 'Keten',
      neckline: 'V yaka',
      fit: 'Regular',
    },
    tryOnSkoru: 77,
    populerlik: 66,
    goruntuleme: 1732,
    denemeSayisi: 121,
    fiyatTl: 1150,
    bedenler: ['XS', 'S', 'M', 'L'],
    renkler: [EKRU, SIYAH],
    stok: 9,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'yun-karisimli-trenckot',
    baslik: 'Yün Karışımlı Trençkot',
    saticiSlug: 'atolye-nord',
    kategoriSlug: 'kadin-trenckot',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'Çift sıra düğmeli, kemerli trençkot. Yün karışımı astarlı kumaş, diz altı boy.',
    siluet: 'dis',
    sezon: 'Sonbahar/Kış',
    koleksiyon: 'Kış Kapsülü',
    etiketler: { color: 'Bej', pattern: 'Düz', fabric: 'Yün karışımı', fit: 'Regular' },
    tryOnSkoru: 69,
    populerlik: 81,
    goruntuleme: 3012,
    denemeSayisi: 244,
    fiyatTl: 3450,
    listeFiyatiTl: 4290,
    bedenler: ['S', 'M', 'L'],
    renkler: [BEJ, SIYAH],
    stok: 6,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'oversize-yun-mont',
    baslik: 'Oversize Yün Mont',
    saticiSlug: 'atolye-nord',
    kategoriSlug: 'kadin-mont',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'Kalın yün mont, gizli düğmeli kapama. Omuz hattı düşük, kollar geniş kesim.',
    siluet: 'dis',
    sezon: 'Sonbahar/Kış',
    koleksiyon: 'Kış Kapsülü',
    etiketler: { color: 'Antrasit', pattern: 'Düz', fabric: 'Yün', fit: 'Oversize' },
    tryOnSkoru: 64,
    populerlik: 58,
    goruntuleme: 1490,
    denemeSayisi: 97,
    fiyatTl: 4290,
    bedenler: ['S', 'M', 'L'],
    renkler: [ANTRASIT, HAKI],
    // ⚠️ Bilerek TÜKENMİŞ: `listProducts` varsayılan olarak stoksuzu gizliyor.
    //    "Stokta olmayanı da göster" filtresinin gerçekten bir şey değiştirdiği
    //    ancak stoksuz bir ürün varken görülür.
    stok: 0,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'keten-erkek-gomlek',
    baslik: 'Keten Erkek Gömlek',
    saticiSlug: 'atolye-nord',
    kategoriSlug: 'erkek-gomlek',
    cinsiyet: 'MAN',
    durum: 'PUBLISHED',
    aciklama: 'Düğmeli yaka, saf keten erkek gömleği. Yazlık dokuma, hafif ve nefes alan kumaş.',
    siluet: 'ust',
    sezon: 'İlkbahar/Yaz',
    etiketler: {
      color: 'Beyaz',
      pattern: 'Düz',
      fabric: 'Keten',
      neckline: 'Düğmeli yaka',
      fit: 'Regular',
    },
    tryOnSkoru: 79,
    populerlik: 55,
    goruntuleme: 980,
    denemeSayisi: 61,
    fiyatTl: 1390,
    bedenler: ['S', 'M', 'L', 'XL'],
    renkler: [BEYAZ, LACIVERT],
    stok: 14,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'kadife-blazer-ceket',
    baslik: 'Kadife Blazer Ceket',
    saticiSlug: 'atolye-nord',
    kategoriSlug: 'kadin-dis-giyim',
    cinsiyet: 'WOMAN',
    // ⚠️ Yönetim → Moderasyon kuyruğu için. Bu üç ürün olmasa o ekran BOŞ açılır
    //    ve "çalışıyor mu" sorusu cevapsız kalır.
    durum: 'PENDING_REVIEW',
    aciklama: 'Kadife dokulu blazer ceket, tek düğmeli kapama.',
    siluet: 'dis',
    etiketler: { color: 'Lacivert', pattern: 'Düz', fabric: 'Kadife', fit: 'Regular' },
    tryOnSkoru: 58,
    tryOnSorunlari: ['low_resolution'],
    populerlik: 0,
    goruntuleme: 0,
    denemeSayisi: 0,
    fiyatTl: 2790,
    bedenler: ['S', 'M'],
    renkler: [LACIVERT],
    stok: 4,
  },

  // ── Mavra ───────────────────────────────────────────────────────────────
  {
    slug: 'yuksek-bel-palazzo-pantolon',
    baslik: 'Yüksek Bel Palazzo Pantolon',
    saticiSlug: 'mavra',
    kategoriSlug: 'kadin-pantolon',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'Akışkan dokulu, yüksek belli, bol paçalı palazzo pantolon. Astarsız, hafif viskon.',
    siluet: 'alt',
    etiketler: { color: 'Siyah', pattern: 'Düz', fabric: 'Viskon', fit: 'Wide leg' },
    tryOnSkoru: 71,
    populerlik: 84,
    goruntuleme: 3640,
    denemeSayisi: 298,
    fiyatTl: 1750,
    bedenler: ['S', 'M', 'L'],
    renkler: [SIYAH, BEJ],
    stok: 8,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'midi-saten-elbise',
    baslik: 'Midi Saten Elbise',
    saticiSlug: 'mavra',
    kategoriSlug: 'kadin-gunluk-elbise',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'Biye askılı, midi boy saten elbise. Dökümlü kalıp, yandan gizli fermuar.',
    siluet: 'elbise',
    koleksiyon: 'Davet',
    etiketler: {
      color: 'Şampanya',
      pattern: 'Düz',
      fabric: 'Saten',
      neckline: 'Askılı',
      fit: 'Regular',
    },
    tryOnSkoru: 88,
    populerlik: 90,
    goruntuleme: 5210,
    denemeSayisi: 501,
    fiyatTl: 2290,
    listeFiyatiTl: 2890,
    bedenler: ['XS', 'S', 'M', 'L'],
    renkler: [SAMPANYA, SIYAH],
    stok: 11,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'kruvaze-ofis-elbisesi',
    baslik: 'Kruvaze Ofis Elbisesi',
    saticiSlug: 'mavra',
    kategoriSlug: 'kadin-gunluk-elbise',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'Kruvaze yaka, bel vurgulu ofis elbisesi. Diz altı boy, hafif esnek dokuma.',
    siluet: 'elbise',
    etiketler: {
      color: 'Lacivert',
      pattern: 'Düz',
      fabric: 'Krep',
      neckline: 'Kruvaze',
      fit: 'Slim',
    },
    tryOnSkoru: 83,
    populerlik: 70,
    goruntuleme: 2280,
    denemeSayisi: 176,
    fiyatTl: 1990,
    bedenler: ['S', 'M', 'L', 'XL'],
    renkler: [LACIVERT, SIYAH],
    stok: 7,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'tul-detayli-abiye',
    baslik: 'Tül Detaylı Abiye',
    saticiSlug: 'mavra',
    kategoriSlug: 'abiye-gelinlik',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'Tül omuz detaylı, uzun abiye elbise. Astarlı gövde, yerden hafif yükseltilmiş etek.',
    siluet: 'elbise',
    koleksiyon: 'Davet',
    etiketler: {
      color: 'Siyah',
      pattern: 'Düz',
      fabric: 'Tül & krep',
      neckline: 'Kayık yaka',
      fit: 'Slim',
    },
    tryOnSkoru: 74,
    populerlik: 62,
    goruntuleme: 1810,
    denemeSayisi: 143,
    fiyatTl: 5490,
    bedenler: ['XS', 'S', 'M'],
    renkler: [SIYAH, LACIVERT],
    stok: 3,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'dantel-a-kesim-gelinlik',
    baslik: 'Dantel A Kesim Gelinlik',
    saticiSlug: 'mavra',
    kategoriSlug: 'abiye-gelinlik',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama:
      'A kesim gelinlik, dantel korse üst ve tül etek. Kuyruk uzunluğu 120 cm, korse arkadan bağcıklı.',
    siluet: 'elbise',
    koleksiyon: 'Gelinlik',
    etiketler: {
      color: 'Fildişi',
      pattern: 'Dantel',
      fabric: 'Dantel & tül',
      neckline: 'Kalp yaka',
      fit: 'A kesim',
    },
    // ⚠️ Kuyruk/tül gövdeden taşıyor; koleksiyon sayfası bunu SSS'de açıkça
    //    söylüyor. Skorun yüksek çıkması o metni yalanlar.
    tryOnSkoru: 61,
    tryOnSorunlari: ['busy_background'],
    populerlik: 44,
    goruntuleme: 2960,
    denemeSayisi: 210,
    fiyatTl: 18900,
    bedenler: ['S', 'M', 'L'],
    renkler: [FILDISI],
    stok: 2,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'pileli-midi-etek',
    baslik: 'Pileli Midi Etek',
    saticiSlug: 'mavra',
    kategoriSlug: 'kadin-etek',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'İnce pileli midi etek, elastik bel. Dökümlü kumaş, astarlı.',
    siluet: 'alt',
    etiketler: { color: 'Haki', pattern: 'Pileli', fabric: 'Polyester krep', fit: 'Regular' },
    tryOnSkoru: 76,
    populerlik: 59,
    goruntuleme: 1420,
    denemeSayisi: 88,
    fiyatTl: 1290,
    bedenler: ['S', 'M', 'L'],
    renkler: [HAKI, SIYAH],
    stok: 10,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'simli-mini-elbise',
    baslik: 'Simli Mini Elbise',
    saticiSlug: 'mavra',
    kategoriSlug: 'kadin-gunluk-elbise',
    cinsiyet: 'WOMAN',
    durum: 'PENDING_REVIEW',
    aciklama: 'Simli dokuma mini elbise, uzun kollu.',
    siluet: 'elbise',
    etiketler: { color: 'Şampanya', pattern: 'Simli', fabric: 'Simli örme', fit: 'Slim' },
    tryOnSkoru: 55,
    tryOnSorunlari: ['missing_back_angle'],
    populerlik: 0,
    goruntuleme: 0,
    denemeSayisi: 0,
    fiyatTl: 1690,
    bedenler: ['XS', 'S', 'M'],
    renkler: [SAMPANYA],
    stok: 6,
  },

  // ── Denim Atölyesi ──────────────────────────────────────────────────────
  {
    slug: 'yuksek-bel-mom-jean',
    baslik: 'Yüksek Bel Mom Jean',
    saticiSlug: 'denim-atolyesi',
    kategoriSlug: 'kadin-denim',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'Yüksek bel, hafif bol paça mom jean. Rijit denim, yıkamayla oturur.',
    siluet: 'alt',
    koleksiyon: 'Denim',
    etiketler: { color: 'İndigo', pattern: 'Düz', fabric: 'Rijit denim', fit: 'Mom' },
    tryOnSkoru: 85,
    populerlik: 95,
    goruntuleme: 6120,
    denemeSayisi: 688,
    fiyatTl: 1690,
    listeFiyatiTl: 1990,
    bedenler: ['26', '28', '30', '32'],
    renkler: [INDIGO, ACIK_INDIGO],
    stok: 15,
    bedenTablosu: ALT_BEDEN_TABLOSU,
  },
  {
    slug: 'duz-paca-straight-jean',
    baslik: 'Düz Paça Straight Jean',
    saticiSlug: 'denim-atolyesi',
    kategoriSlug: 'kadin-denim',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'Orta bel, düz paça klasik jean. Hafif esnek denim, günlük kullanım.',
    siluet: 'alt',
    koleksiyon: 'Denim',
    etiketler: { color: 'İndigo', pattern: 'Düz', fabric: 'Esnek denim', fit: 'Straight' },
    tryOnSkoru: 82,
    populerlik: 77,
    goruntuleme: 2980,
    denemeSayisi: 301,
    fiyatTl: 1590,
    bedenler: ['26', '28', '30', '32'],
    renkler: [INDIGO, SIYAH],
    stok: 18,
    bedenTablosu: ALT_BEDEN_TABLOSU,
  },
  {
    slug: 'wide-leg-denim-pantolon',
    baslik: 'Wide Leg Denim Pantolon',
    saticiSlug: 'denim-atolyesi',
    kategoriSlug: 'kadin-denim',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'Yüksek bel, geniş paça denim pantolon. Uzun boy kesim, ağır gramajlı kumaş.',
    siluet: 'alt',
    koleksiyon: 'Denim',
    etiketler: { color: 'Açık İndigo', pattern: 'Düz', fabric: 'Rijit denim', fit: 'Wide leg' },
    tryOnSkoru: 80,
    populerlik: 68,
    goruntuleme: 2140,
    denemeSayisi: 199,
    fiyatTl: 1790,
    bedenler: ['26', '28', '30'],
    renkler: [ACIK_INDIGO],
    stok: 9,
    bedenTablosu: ALT_BEDEN_TABLOSU,
  },
  {
    slug: 'oversize-denim-ceket',
    baslik: 'Oversize Denim Ceket',
    saticiSlug: 'denim-atolyesi',
    kategoriSlug: 'kadin-denim',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'Düşük omuzlu oversize denim ceket. Metal düğme, iki göğüs cebi.',
    siluet: 'dis',
    koleksiyon: 'Denim',
    etiketler: { color: 'Açık İndigo', pattern: 'Düz', fabric: 'Rijit denim', fit: 'Oversize' },
    tryOnSkoru: 73,
    populerlik: 71,
    goruntuleme: 2510,
    denemeSayisi: 187,
    fiyatTl: 2190,
    bedenler: ['S', 'M', 'L'],
    renkler: [ACIK_INDIGO, INDIGO],
    stok: 7,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'erkek-slim-jean',
    baslik: 'Erkek Slim Jean',
    saticiSlug: 'denim-atolyesi',
    kategoriSlug: 'erkek-denim',
    cinsiyet: 'MAN',
    durum: 'PUBLISHED',
    aciklama: 'Dar kesim erkek jean. Esnek denim, orta bel.',
    siluet: 'alt',
    etiketler: { color: 'Siyah', pattern: 'Düz', fabric: 'Esnek denim', fit: 'Slim' },
    tryOnSkoru: 78,
    populerlik: 61,
    goruntuleme: 1680,
    denemeSayisi: 104,
    fiyatTl: 1890,
    bedenler: ['30', '32'],
    renkler: [SIYAH, INDIGO],
    stok: 12,
    bedenTablosu: ALT_BEDEN_TABLOSU,
  },
  {
    slug: 'erkek-chino-pantolon',
    baslik: 'Erkek Chino Pantolon',
    saticiSlug: 'denim-atolyesi',
    kategoriSlug: 'erkek-chino',
    cinsiyet: 'MAN',
    durum: 'PUBLISHED',
    aciklama: 'Pamuklu gabardin chino pantolon. Düz paça, yan cepler.',
    siluet: 'alt',
    etiketler: { color: 'Haki', pattern: 'Düz', fabric: 'Gabardin', fit: 'Regular' },
    tryOnSkoru: 75,
    populerlik: 52,
    goruntuleme: 1120,
    denemeSayisi: 66,
    fiyatTl: 1490,
    bedenler: ['30', '32'],
    renkler: [HAKI, LACIVERT],
    stok: 16,
    bedenTablosu: ALT_BEDEN_TABLOSU,
  },

  // ── Kuzey Spor ──────────────────────────────────────────────────────────
  {
    slug: 'kapusonlu-sweatshirt',
    baslik: 'Kapüşonlu Sweatshirt',
    saticiSlug: 'kuzey-spor',
    kategoriSlug: 'kadin-sweatshirt',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'Şardonlu iç yüzey, kapüşonlu sweatshirt. Reglan kol, geniş kalıp.',
    siluet: 'ust',
    koleksiyon: 'Spor',
    etiketler: { color: 'Gri Melanj', pattern: 'Düz', fabric: 'Pamuk şardon', fit: 'Oversize' },
    tryOnSkoru: 84,
    populerlik: 88,
    goruntuleme: 4410,
    denemeSayisi: 466,
    fiyatTl: 1090,
    listeFiyatiTl: 1290,
    bedenler: ['S', 'M', 'L', 'XL'],
    renkler: [GRI, SIYAH, EKRU],
    stok: 22,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'oversize-esofman-ustu',
    baslik: 'Oversize Eşofman Üstü',
    saticiSlug: 'kuzey-spor',
    kategoriSlug: 'unisex-ust-giyim',
    cinsiyet: 'UNISEX',
    durum: 'PUBLISHED',
    aciklama: 'Fermuarlı oversize eşofman üstü. Unisex kalıp, yan cepler.',
    siluet: 'ust',
    koleksiyon: 'Spor',
    etiketler: { color: 'Antrasit', pattern: 'Düz', fabric: 'Pamuk karışım', fit: 'Oversize' },
    tryOnSkoru: 79,
    populerlik: 65,
    goruntuleme: 1930,
    denemeSayisi: 152,
    fiyatTl: 1250,
    bedenler: ['S', 'M', 'L', 'XL'],
    renkler: [ANTRASIT, GRI],
    stok: 13,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'yuksek-bel-tayt',
    baslik: 'Yüksek Bel Tayt',
    saticiSlug: 'kuzey-spor',
    kategoriSlug: 'kadin-tayt',
    cinsiyet: 'WOMAN',
    durum: 'PUBLISHED',
    aciklama: 'Yüksek bel, dikişsiz spor tayt. Nem yönetimli kumaş, opak doku.',
    siluet: 'alt',
    koleksiyon: 'Spor',
    etiketler: { color: 'Siyah', pattern: 'Düz', fabric: 'Polyamid karışım', fit: 'Slim' },
    tryOnSkoru: 87,
    populerlik: 83,
    goruntuleme: 3870,
    denemeSayisi: 389,
    fiyatTl: 790,
    bedenler: ['XS', 'S', 'M', 'L'],
    renkler: [SIYAH, HAKI],
    stok: 25,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'cocuk-kapusonlu-sweatshirt',
    baslik: 'Çocuk Kapüşonlu Sweatshirt',
    saticiSlug: 'kuzey-spor',
    kategoriSlug: 'cocuk-ust-giyim',
    cinsiyet: 'KIDS',
    durum: 'PUBLISHED',
    aciklama: 'Çocuklar için şardonlu kapüşonlu sweatshirt. Kanguru cep.',
    siluet: 'ust',
    etiketler: { color: 'Lacivert', pattern: 'Düz', fabric: 'Pamuk şardon', fit: 'Regular' },
    tryOnSkoru: 62,
    populerlik: 40,
    goruntuleme: 640,
    denemeSayisi: 21,
    fiyatTl: 690,
    bedenler: ['4', '6', '8'],
    renkler: [LACIVERT, GRI],
    stok: 18,
  },
  {
    slug: 'erkek-basic-tisort',
    baslik: 'Erkek Basic Tişört',
    saticiSlug: 'kuzey-spor',
    kategoriSlug: 'erkek-tisort',
    cinsiyet: 'MAN',
    durum: 'PUBLISHED',
    aciklama: 'Bisiklet yaka, penye basic tişört. Kalın gramaj, yıkamada çekmez.',
    siluet: 'ust',
    etiketler: { color: 'Beyaz', pattern: 'Düz', fabric: 'Penye pamuk', fit: 'Regular' },
    tryOnSkoru: 80,
    populerlik: 57,
    goruntuleme: 1340,
    denemeSayisi: 74,
    fiyatTl: 490,
    bedenler: ['S', 'M', 'L', 'XL'],
    renkler: [BEYAZ, SIYAH, LACIVERT],
    stok: 30,
    bedenTablosu: UST_BEDEN_TABLOSU,
  },
  {
    slug: 'unisex-bucket-sapka',
    baslik: 'Unisex Bucket Şapka',
    saticiSlug: 'kuzey-spor',
    kategoriSlug: 'unisex-aksesuar',
    cinsiyet: 'UNISEX',
    durum: 'PENDING_REVIEW',
    aciklama: 'Pamuklu bucket şapka, tek beden.',
    siluet: 'aksesuar',
    etiketler: { color: 'Haki', pattern: 'Düz', fabric: 'Pamuk', fit: 'Tek beden' },
    // ⚠️ Kategori ACCESSORY: sağlayıcı bu kategoriyi desteklemiyor, dolayısıyla
    //    deneme skoru anlamsız. `null` yerine 0 değil — alan opsiyonel, 0
    //    "ölçüldü ve kötü" demek olurdu.
    tryOnSkoru: 0,
    populerlik: 0,
    goruntuleme: 0,
    denemeSayisi: 0,
    fiyatTl: 390,
    bedenler: ['Tek Beden'],
    renkler: [HAKI, SIYAH],
    stok: 20,
  },

  // ── Eski Moda (SUSPENDED mağaza) ────────────────────────────────────────
  {
    slug: 'arsiv-yun-hirka',
    baslik: 'Arşiv Yün Hırka',
    saticiSlug: 'eski-moda',
    kategoriSlug: 'kadin-triko',
    cinsiyet: 'WOMAN',
    // ⚠️ PUBLISHED ama mağaza SUSPENDED → vitrinde GÖRÜNMEZ, yönetimde görünür.
    durum: 'PUBLISHED',
    aciklama: 'Düğmeli yün hırka, arşiv koleksiyonundan.',
    siluet: 'ust',
    etiketler: { color: 'Bej', pattern: 'Düz', fabric: 'Yün', fit: 'Regular' },
    tryOnSkoru: 66,
    populerlik: 30,
    goruntuleme: 410,
    denemeSayisi: 12,
    fiyatTl: 1490,
    bedenler: ['M', 'L'],
    renkler: [BEJ],
    stok: 3,
  },
];

// ── Görsel açıları ─────────────────────────────────────────────────────────

export const ACILAR: readonly ImageAngle[] = ['FRONT', 'BACK'];

/** `<slug>-front.webp` / `<slug>-back.webp` — depodaki kaynak dosya adı. */
export function varlikDosyaAdi(slug: string, aci: ImageAngle): string {
  return `${slug}-${aci.toLowerCase()}.webp`;
}

// ── Demo hesaplar ──────────────────────────────────────────────────────────

export interface HesapTanimi {
  readonly eposta: string;
  readonly ad: string;
  readonly soyad: string;
  readonly telefon: string;
  readonly rol: 'CUSTOMER' | 'SELLER_USER' | 'ADMIN';
  /** SELLER_USER için mağaza üyeliği. */
  readonly saticiSlug?: string;
  readonly magazaRolu?: 'owner' | 'manager';
}

/**
 * ⚠️ TEK PAROLA, HERKESE AYNI — ve bu bilinçli. Demo hesapların parolası bir
 *    sır değil; ayrı ayrı parola üretmek yalnızca "hangisi hangisiydi" sorusu
 *    doğururdu. Kapı parolanın gizliliği değil, seed'in üretimde HİÇ
 *    ÇALIŞMAMASI (bkz. seed/kapi.ts).
 */
export const DEMO_PAROLA = 'DemoParola2026';

export const HESAPLAR: readonly HesapTanimi[] = [
  {
    eposta: 'demo@example.com',
    ad: 'Demo',
    soyad: 'Kullanıcı',
    telefon: '+905321112233',
    rol: 'CUSTOMER',
  },
  {
    eposta: 'ayse@example.com',
    ad: 'Ayşe',
    soyad: 'Yıldız',
    telefon: '+905321112234',
    rol: 'CUSTOMER',
  },
  {
    eposta: 'mehmet@example.com',
    ad: 'Mehmet',
    soyad: 'Kaya',
    telefon: '+905321112235',
    rol: 'CUSTOMER',
  },
  {
    eposta: 'zeynep@example.com',
    ad: 'Zeynep',
    soyad: 'Demir',
    telefon: '+905321112236',
    rol: 'CUSTOMER',
  },
  {
    eposta: 'yonetici@example.com',
    ad: 'Yönetim',
    soyad: 'Hesabı',
    telefon: '+905321112240',
    rol: 'ADMIN',
  },
  {
    eposta: 'satici@atolye-nord.example.com',
    ad: 'Nord',
    soyad: 'Satıcı',
    telefon: '+905321112241',
    rol: 'SELLER_USER',
    saticiSlug: 'atolye-nord',
    magazaRolu: 'owner',
  },
  {
    eposta: 'satici@mavra.example.com',
    ad: 'Mavra',
    soyad: 'Satıcı',
    telefon: '+905321112242',
    rol: 'SELLER_USER',
    saticiSlug: 'mavra',
    magazaRolu: 'owner',
  },
  {
    eposta: 'satici@denim-atolyesi.example.com',
    ad: 'Denim',
    soyad: 'Satıcı',
    telefon: '+905321112243',
    rol: 'SELLER_USER',
    saticiSlug: 'denim-atolyesi',
    magazaRolu: 'owner',
  },
  {
    eposta: 'satici@kuzey-spor.example.com',
    ad: 'Kuzey',
    soyad: 'Satıcı',
    telefon: '+905321112244',
    rol: 'SELLER_USER',
    saticiSlug: 'kuzey-spor',
    magazaRolu: 'owner',
  },
];
