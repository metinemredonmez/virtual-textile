import type { GenderWire } from '@vt/contracts';

/**
 * URL → SORGU: TEK AYRIŞTIRMA NOKTASI.
 *
 * Liste ekranının tüm durumu URL'dedir (SSR + paylaşılabilir bağlantı + geri
 * tuşu). Bu dosya o URL'i okuyan, doğrulayan ve geri yazan tek yerdir.
 *
 * ⚠️ HAM PARAMETRE API'YE GEÇİRİLMEZ. ÖLÇÜLDÜ:
 *      GET /v1/products?sort=xxx  → 400 VALIDATION_FAILED
 *    Adres çubuğuna bir şey yazan kullanıcı ya da bozuk bir bağlantıyı izleyen
 *    tarama botu, sayfanın tamamını hata sınırına düşürebiliyordu. Doğrulama
 *    burada yapılır ve tanınmayan değer SESSİZCE varsayılana düşer: liste
 *    ekranı bir formdur, form doğrulaması ekranı çökertmez.
 */

/** Sunucunun kabul ettiği değerler (`catalog.schema.ts` → `sort` enum'ı). */
export const SIRALAMALAR = ['relevance', 'price_asc', 'price_desc', 'newest'] as const;
export type Siralama = (typeof SIRALAMALAR)[number];

export const SIRALAMA_ETIKETLERI: Record<Siralama, string> = {
  relevance: 'Önerilen',
  newest: 'Yeni gelenler',
  price_asc: 'Artan fiyat',
  price_desc: 'Azalan fiyat',
};

/**
 * SUNUCUDA BOZUK OLDUĞU ÖLÇÜLEN SIRALAMALAR — bugün BOŞ.
 *
 * `newest` bir süre bu listedeydi: `GET /v1/products?sort=newest&limit=1` HER
 * istekte 500 dönüyordu (`column p.publishedAt does not exist`). Sebep dış
 * sorgunun `SELECT * FROM base p` olması, yani `p`nin artık CTE'nin takma adı
 * olmasıydı; sıralama `p."publishedAt"` yazıyordu ama o sütun base'de
 * seçilmiyordu. `catalog.service.ts`te giderildi ve bu dosyanın kendi yazdığı
 * GERİ AÇMA KOŞULU ölçülerek karşılandı:
 *
 *     GET /v1/products?sort=newest&limit=1                  → 200
 *     dört sıralamada da: 13 sayfa, 289 tekil ürün, 0 tekrar
 *
 * ⚠️ MEKANİZMA SÖKÜLMEDİ, liste boşaltıldı. Bir sonraki bozuk sıralamada
 *    karar verilecek tek yer burası; kapıyı kaldırmak, o gün bağlantıyı
 *    doğrudan silmeye (yani sessiz bir davranış kaybına) davetiye olurdu.
 */
export const BOZUK_SIRALAMALAR: readonly Siralama[] = [];

export const KULLANILABILIR_SIRALAMALAR: readonly Siralama[] = SIRALAMALAR.filter(
  (s) => !BOZUK_SIRALAMALAR.includes(s),
);

/** `SEARCH.defaultPageSize` ile aynı. Sunucu zaten bunu varsayıyor. */
export const SAYFA_BOYU = 24;

/** Aynı fasetten seçilebilecek azami değer — URL'i ve `IN (…)` listesini sınırlar. */
const AZAMI_FASET_SECIMI = 20;

/** `catalog.schema.ts`: q en fazla 100, doğal dil cümlesi 200 karakter. */
const AZAMI_Q = 100;
const AZAMI_CUMLE = 200;

/**
 * İmleç base64url'dir ve en fazla 500 karakterdir.
 *
 * ⚠️ UZUN İMLEÇ KIRPILMAZ, ATILIR. Kırpmak GEÇERLİ bir imleci geçersiz bir
 *    imlece çevirirdi; sunucu onu çözemeyip 400 döndürür ve kullanıcı bozuk bir
 *    adres yüzünden BOŞ SAYFA görür. Tanınmayan sayfa göstergesinin doğru
 *    karşılığı "ilk sayfa"dır, hata değil.
 */
const IMLEC = /^[A-Za-z0-9_-]{1,500}$/;

/** `slugSchema` — uymayan değer 400 döndürür, o yüzden burada eleniyor. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Fiyat sınırı: TAM TL, en fazla 9 basamak. Kuruşa çevrimi `apiSorgusu` yapar. */
const TAM_TL = /^\d{1,9}$/;

const CINSIYETLER: readonly GenderWire[] = ['WOMAN', 'MAN', 'UNISEX', 'KIDS'];

export type AramaParametreleri = Record<string, string | string[] | undefined>;

export interface ListeSorgusu {
  q: string | null;
  kategori: string | null;
  marka: string[];
  renk: string[];
  beden: string[];
  /** TAM TL (kuruş DEĞİL) — kullanıcı "1500" yazar, URL "1500" taşır. */
  minFiyat: string | null;
  maxFiyat: string | null;
  cinsiyet: GenderWire | null;
  sirala: Siralama;
  imlec: string | null;
  /**
   * Doğal dil cümlesi. YALNIZCA arama kutusundan gelen açık bir gönderimle
   * doğar ve sayfa başına BİR KEZ yorumlanır.
   *
   * ⚠️ Bu parametreyi taşıyan bir `<Link>` HİÇBİR YERE KONULMAZ: Next
   *    bağlantıları görünür olunca ön yükler ve her ön yükleme bir LLM çağrısı
   *    demek olurdu. Kutu `router.push` ile gider — ön yükleme yoktur.
   */
  ara: string | null;
}

function tekDeger(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  const kirpilmis = value?.trim() ?? '';
  return kirpilmis === '' ? null : kirpilmis;
}

function coklu(value: string | string[] | undefined): string[] {
  const ham = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const temiz = ham.map((v) => v.trim()).filter((v) => v !== '');
  // Yinelenenler `IN (…)` listesini şişirir ve URL'i okunmaz yapar.
  return Array.from(new Set(temiz)).slice(0, AZAMI_FASET_SECIMI);
}

function sinirli(value: string | null, azami: number): string | null {
  if (value === null) return null;
  return value.length > azami ? value.slice(0, azami) : value;
}

export interface OkumaSecenekleri {
  /**
   * `/category/[slug]` rotasında kategori YOLDAN gelir; sorgu dizesindeki
   * `kategori` yok sayılır ve üretilen bağlantılara da yazılmaz.
   */
  sabitKategori?: string;
}

export function sorguyuOku(
  params: AramaParametreleri,
  secenekler: OkumaSecenekleri = {},
): ListeSorgusu {
  const siralaHam = tekDeger(params.sirala);
  const sirala = KULLANILABILIR_SIRALAMALAR.find((s) => s === siralaHam) ?? 'relevance';

  const kategoriHam = secenekler.sabitKategori ?? tekDeger(params.kategori);
  const cinsiyetHam = tekDeger(params.cinsiyet);

  const minFiyat = tekDeger(params.minFiyat);
  const maxFiyat = tekDeger(params.maxFiyat);
  const imlec = tekDeger(params.imlec);

  return {
    q: sinirli(tekDeger(params.q), AZAMI_Q),
    kategori: kategoriHam && SLUG.test(kategoriHam) ? kategoriHam : null,
    marka: coklu(params.marka),
    renk: coklu(params.renk),
    beden: coklu(params.beden),
    minFiyat: minFiyat && TAM_TL.test(minFiyat) ? minFiyat : null,
    maxFiyat: maxFiyat && TAM_TL.test(maxFiyat) ? maxFiyat : null,
    cinsiyet: CINSIYETLER.find((c) => c === cinsiyetHam) ?? null,
    sirala,
    imlec: imlec && IMLEC.test(imlec) ? imlec : null,
    ara: sinirli(tekDeger(params.ara), AZAMI_CUMLE),
  };
}

/**
 * TL → kuruş.
 *
 * ⚠️ ÇARPMA DEĞİL, DİZGİ EKİ. `Number(tl) * 100` iki şeyi birden bozardı:
 *    büyük tutarda kayan nokta hatası üretir ve lint'in para koruması bu ifadeyi
 *    GÖRMEZ (değişken adı `Minor` ile bitmiyor). Sonundaki iki sıfır tam sayı
 *    dizgesinde her zaman doğrudur ve hiçbir sayısal tipe uğramaz.
 */
function kurusa(tamTl: string | null): string | undefined {
  return tamTl === null ? undefined : `${tamTl}00`;
}

/** `serverFetch(..., { query })` için sorgu nesnesi. */
export function apiSorgusu(
  sorgu: ListeSorgusu,
): Record<string, string | number | string[] | undefined> {
  return {
    q: sorgu.q ?? undefined,
    category: sorgu.kategori ?? undefined,
    brand: sorgu.marka.length > 0 ? sorgu.marka : undefined,
    color: sorgu.renk.length > 0 ? sorgu.renk : undefined,
    size: sorgu.beden.length > 0 ? sorgu.beden : undefined,
    minPriceMinor: kurusa(sorgu.minFiyat),
    maxPriceMinor: kurusa(sorgu.maxFiyat),
    gender: sorgu.cinsiyet ?? undefined,
    sort: sorgu.sirala,
    cursor: sorgu.imlec ?? undefined,
    limit: SAYFA_BOYU,
    /**
     * ⚠️ `inStockOnly` BİLİNÇLİ OLARAK GÖNDERİLMİYOR ve "tükenenleri göster"
     *    diye bir seçenek YOK. Şema `z.coerce.boolean()` kullanıyor; o da
     *    `Boolean('false')` demek, yani `true`. Yani bu bayrak API üzerinden
     *    KAPATILAMIYOR — ölçüldü, `?inStockOnly=false` varsayılanla aynı sonucu
     *    veriyor. Çalışmayan bir onay kutusu koymak, kullanıcının tıkladığında
     *    hiçbir şeyin değişmediğini görmesi demektir.
     */
  };
}

/** Faset seçimleri hariç bir filtre var mı — "temizle" bağlantısı buna bakar. */
export function filtreVarMi(sorgu: ListeSorgusu): boolean {
  return (
    sorgu.q !== null ||
    sorgu.marka.length > 0 ||
    sorgu.renk.length > 0 ||
    sorgu.beden.length > 0 ||
    sorgu.minFiyat !== null ||
    sorgu.maxFiyat !== null ||
    sorgu.cinsiyet !== null
  );
}

/** Seçili faset sayısı — mobil çekmece düğmesindeki rozet. */
export function secimSayisi(sorgu: ListeSorgusu): number {
  return (
    sorgu.marka.length +
    sorgu.renk.length +
    sorgu.beden.length +
    (sorgu.minFiyat !== null || sorgu.maxFiyat !== null ? 1 : 0) +
    (sorgu.cinsiyet !== null ? 1 : 0)
  );
}

export type Degisiklik = Partial<Omit<ListeSorgusu, 'ara'>>;

/**
 * Bağlantı üretici — sıralama, sayfalama ve rozet kaldırma hepsi buradan geçer.
 *
 * ⚠️ İMLEÇ, AÇIKÇA VERİLMEDİKÇE DÜŞER. Sebebi ölçüldü:
 *      /v1/products?sort=price_asc&cursor=<relevance imleci>  → HTTP 500
 *    İmleç `{sort, id}` taşıyor ve sunucu `price_asc` dalında `BigInt(cursor.sort)`
 *    çağırıyor; ilgi sıralamasının anahtarı `"0.5"` olduğu için bu çağrı
 *    fırlatıyor. Yani sıralamayı değiştirirken imleci korumak kullanıcıyı
 *    doğrudan 500'e çarptırıyordu. Aynı şey filtre değişiminde de doğru:
 *    yeni sonuç kümesinin 3. sayfasından başlamak anlamsızdır.
 *
 * ⚠️ `ara` ASLA taşınmaz. Taşınsaydı her onay kutusu, her sıralama değişimi ve
 *    her sayfa çevirme aynı cümleyi yeniden yorumlatırdı — yani bir LLM çağrısı
 *    daha. Cümlenin sonucu bir kez filtreye çevrilir, sonrası düz filtredir.
 */
export function listeBaglantisi(
  yol: string,
  sorgu: ListeSorgusu,
  degisiklik: Degisiklik = {},
  secenekler: OkumaSecenekleri = {},
): string {
  const sonuc: ListeSorgusu = { ...sorgu, ...degisiklik, ara: null };
  if (degisiklik.imlec === undefined) sonuc.imlec = null;

  const params = new URLSearchParams();
  if (sonuc.q) params.set('q', sonuc.q);
  if (sonuc.kategori && !secenekler.sabitKategori) params.set('kategori', sonuc.kategori);
  for (const marka of sonuc.marka) params.append('marka', marka);
  for (const renk of sonuc.renk) params.append('renk', renk);
  for (const beden of sonuc.beden) params.append('beden', beden);
  if (sonuc.minFiyat) params.set('minFiyat', sonuc.minFiyat);
  if (sonuc.maxFiyat) params.set('maxFiyat', sonuc.maxFiyat);
  if (sonuc.cinsiyet) params.set('cinsiyet', sonuc.cinsiyet);
  // Varsayılan sıralama URL'e yazılmaz: aynı liste tek adresle paylaşılsın.
  if (sonuc.sirala !== 'relevance') params.set('sirala', sonuc.sirala);
  if (sonuc.imlec) params.set('imlec', sonuc.imlec);

  const qs = params.toString();
  return qs ? `${yol}?${qs}` : yol;
}

/** Bir faset değerini ekler/çıkarır — rozetteki × ve onay kutusu aynı yolu kullanır. */
export function fasetiDegistir(mevcut: string[], deger: string): string[] {
  return mevcut.includes(deger)
    ? mevcut.filter((v) => v !== deger)
    : [...mevcut, deger].slice(0, AZAMI_FASET_SECIMI);
}
