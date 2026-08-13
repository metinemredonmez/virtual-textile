/**
 * TÜRKÇE ÜRÜN ALANLARI → İNGİLİZCE GÖRSEL İSTEMİ SÖZLÜĞÜ.
 *
 * ⚠️ NEDEN ÇEVİRİ GEREKİYOR: görsel üreten model istemi İngilizce anlıyor.
 *    "Keten Oversize Gömlek" başlığını olduğu gibi vermek ölçüldü — model
 *    kumaşı ve kalıbı kaçırıyor, rastgele bir parça çiziyor. Yapısal
 *    alanlardan (kategori · kumaş · renk · desen · kalıp) İngilizce bir
 *    tamlama kurmak hem daha isabetli hem de DETERMİNİST: aynı ürün her
 *    çalıştırmada aynı istemi üretir.
 *
 * ⚠️ BAŞLIK ÇEVİRİSİ YOK VE OLMAYACAK. Başlığı da çevirmek ikinci bir
 *    sözlük borcu doğururdu; yapısal alanlar zaten başlığın taşıdığı her
 *    bilgiyi taşıyor (`veri.ts` etiketleri zorunlu alanlar).
 *
 * ⚠️ EKSİK ANAHTAR SESSİZCE GEÇMEZ. `çevir()` bilinmeyen değerde ATAR.
 *    Bunun sebebi ölçülmüş bir arıza sınıfı: sözlükte olmayan bir kumaş
 *    `undefined` olarak isteme girerse görsel yine üretilir, yalnızca YANLIŞ
 *    üretilir — ve kimse fark etmez. `veri.ts`e yeni bir kumaş eklendiğinde
 *    üretim DURMALI.
 */

/** Kategori slug'ı → İngilizce giysi adı. `veri.ts`teki 25 slug'ın tamamı. */
export const KATEGORI_EN: Readonly<Record<string, string>> = {
  'kadin-gomlek': "women's button-up shirt",
  'kadin-bluz': "women's blouse",
  'kadin-triko': "women's knit sweater",
  'kadin-sweatshirt': "women's sweatshirt",
  'kadin-ust-giyim': "women's top",
  'kadin-pantolon': "women's trousers",
  'kadin-denim': "women's jeans, full-length trousers",
  'kadin-etek': "women's skirt",
  'kadin-tayt': "women's leggings",
  'kadin-elbise': "women's dress",
  'kadin-gunluk-elbise': "women's casual day dress",
  'kadin-trenckot': "women's trench coat",
  'kadin-mont': "women's puffer jacket",
  'kadin-dis-giyim': "women's outerwear coat",
  'abiye-gelinlik': 'floor-length formal evening gown',
  'erkek-gomlek': "men's button-up shirt",
  'erkek-tisort': "men's t-shirt",
  'erkek-ust-giyim': "men's top",
  'erkek-denim': "men's jeans, full-length trousers",
  'erkek-chino': "men's chino trousers",
  'erkek-dis-giyim': "men's outerwear jacket",
  'cocuk-ust-giyim': "children's top",
  'cocuk-alt-giyim': "children's trousers",
  'unisex-ust-giyim': 'unisex top',
  'unisex-aksesuar': 'fashion accessory',
};

export const RENK_EN: Readonly<Record<string, string>> = {
  Antrasit: 'charcoal grey',
  'Açık İndigo': 'light indigo blue',
  Bej: 'beige',
  Beyaz: 'white',
  Bordo: 'burgundy',
  'Buz Mavi': 'ice blue',
  Camel: 'camel tan',
  Ekru: 'ecru off-white',
  Fildişi: 'ivory',
  'Gri Melanj': 'heather grey',
  'Gül Kurusu': 'dusty rose',
  Haki: 'khaki green',
  Kahve: 'coffee brown',
  'Koyu Yeşil': 'dark green',
  Lacivert: 'navy blue',
  Pudra: 'powder pink',
  Siyah: 'black',
  Taş: 'stone grey',
  Zümrüt: 'emerald green',
  İndigo: 'indigo blue',
  Şampanya: 'champagne',
};

export const KUMAS_EN: Readonly<Record<string, string>> = {
  'Akrilik karışım': 'acrylic blend',
  'Akrilik yün karışımı': 'acrylic wool blend',
  'Dantel & tül': 'lace and tulle',
  Deri: 'leather',
  'Esnek denim': 'stretch denim',
  Gabardin: 'gabardine',
  'Geri dönüştürülmüş polyester': 'recycled polyester',
  'Hafif denim': 'lightweight denim',
  'Ham denim': 'raw selvedge denim',
  Kadife: 'velvet',
  'Kaplamalı örme': 'coated knit',
  'Kaşmir karışımı': 'cashmere blend',
  Keten: 'linen',
  Krep: 'crepe',
  'Merinos karışımı': 'merino wool blend',
  'Modal karışım': 'modal blend',
  'Modal karışımı örme': 'modal blend jersey',
  Naylon: 'nylon',
  'Oxford pamuk': 'cotton oxford',
  'Pamuk dokuma': 'woven cotton',
  'Pamuk elastan': 'cotton elastane',
  'Pamuk flanel': 'cotton flannel',
  'Pamuk gabardin': 'cotton gabardine',
  'Pamuk karışım': 'cotton blend',
  'Pamuk karışımı': 'cotton blend',
  'Pamuk oxford': 'cotton oxford',
  'Pamuk poplin': 'cotton poplin',
  'Pamuk triko': 'cotton knit',
  'Pamuk tuval': 'cotton canvas',
  'Pamuk twill': 'cotton twill',
  'Pamuk şardon': 'brushed cotton fleece',
  Pamuk: 'cotton',
  'Penye pamuk': 'combed cotton jersey',
  'Pike pamuk': 'cotton piqué',
  Polar: 'fleece',
  'Polyamid karışım': 'polyamide blend',
  'Polyester & kaz tüyü': 'polyester with down fill',
  'Polyester dokuma': 'woven polyester',
  'Polyester krep': 'polyester crepe',
  'Rijit denim': 'rigid denim',
  'Ripstop pamuk': 'ripstop cotton',
  Saten: 'satin',
  'Simli örme': 'metallic lurex knit',
  Softshell: 'softshell',
  'Su itici teknik kumaş': 'water-repellent technical fabric',
  'Süet görünümlü polyester': 'faux suede',
  'Teknik polyester': 'technical polyester',
  'Termal örme': 'thermal knit',
  Triko: 'knitwear',
  'Tül & krep': 'tulle and crepe',
  'Tül & saten': 'tulle and satin',
  Tül: 'tulle',
  Tüvit: 'tweed',
  'Viskon karışımı triko': 'viscose blend knit',
  Viskon: 'viscose',
  'Yün karışımı': 'wool blend',
  Yün: 'wool',
  'Yıkanmış denim': 'washed denim',
  Örme: 'jersey knit',
  'İpek karışımı': 'silk blend',
  Şifon: 'chiffon',
};

export const DESEN_EN: Readonly<Record<string, string>> = {
  Dantel: 'lace detailing',
  Düz: 'solid colour, no print',
  Ekose: 'plaid check pattern',
  Fitilli: 'ribbed corduroy texture',
  Kapitone: 'quilted panels',
  Pileli: 'pleated',
  Ribana: 'ribbed texture',
  Simli: 'subtle metallic sheen',
  Tüvit: 'tweed weave',
  Çizgili: 'striped',
  'Çiçek desenli': 'floral print',
  Örgü: 'cable knit texture',
};

export const KALIP_EN: Readonly<Record<string, string>> = {
  'A kesim': 'A-line cut',
  Ayarlanabilir: 'adjustable fit',
  Bol: 'loose fit',
  Krop: 'cropped length',
  Loose: 'loose fit',
  Mom: 'high-waist mom fit',
  Oversize: 'oversized fit',
  Prenses: 'fitted princess-seam bodice',
  Regular: 'regular fit',
  Skinny: 'skinny fit',
  Slim: 'slim fit',
  Straight: 'straight leg',
  Tapered: 'tapered leg',
  'Tek beden': 'one size',
  'Wide leg': 'wide leg',
};

/**
 * ⚠️ BULUNAMAYAN ANAHTAR ATAR — sessiz `undefined` değil.
 *    Gerekçe dosya başlığında: yanlış üretilmiş bir görsel, üretilmemiş bir
 *    görselden kötüdür, çünkü kimse bakıp fark etmez.
 */
export function cevir(
  sozluk: Readonly<Record<string, string>>,
  deger: string,
  alan: string,
): string {
  const karsilik = sozluk[deger];
  if (karsilik === undefined) {
    throw new Error(
      `Sözlükte yok — ${alan}: "${deger}". packages/db/prisma/seed-assets/sozluk.ts içine ekleyin.`,
    );
  }
  return karsilik;
}
