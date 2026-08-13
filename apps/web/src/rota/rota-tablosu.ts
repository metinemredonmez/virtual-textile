import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ROTA TABLOSU — DOSYA SİSTEMİNDEN ÜRETİLİR, ELLE YAZILMAZ.
 *
 * ⚠️ BU DOSYA BİR TEST YARDIMCISI DEĞİL, ROTA GÖÇÜNÜN KAPISIDIR. Göçün tek
 *    gerçek riski ÖLÜ BAĞLANTIDIR: bir `href` güncellenmezse `next build`
 *    GEÇER, `tsc --noEmit` GEÇER, `vitest` GEÇER ve kullanıcı 404 görür.
 *
 * ⚠️ `typedRoutes: true` BU İŞİ YAPMAZ — ölçüldü. Next 16.3
 *    `.next/types/routes.d.ts` içinde tam bir `AppRoutes` birleşimi üretiyor ve
 *    "o hâlde tip kontrolü ölü bağlantıyı yakalar" demek çok cazip. Denendi:
 *    yapılandırma açılıp `<Link href="/kesinlikle-olmayan-rota">` yazıldığında
 *    `tsc --noEmit` de `next build` de TEMİZ geçti. Üretilen birleşim
 *    `PageProps`/`LayoutProps` içindir; `Link` dayatması TS PLUGIN üzerinden,
 *    yani YALNIZCA editörde. İkinci bir katman olarak açılabilir ama
 *    **CI KAPISI DEĞİLDİR**; kimse bunu bu dosyanın yerine koymasın.
 *
 * ⚠️ SABİT BİR BEKLENEN LİSTE YAZILMADI. Yazılsaydı senkron tutulacak ÜÇÜNCÜ
 *    bir yer doğardı (dosya sistemi · bağlantılar · testin kendisi) ve o üçüncü
 *    yer, ilk unutulan yer olurdu.
 */

/** `apps/web` kökü. */
export const WEB_KOKU = join(__dirname, '..', '..');
/** Depo kökü — göç yalnız `apps/web`i ilgilendirmiyor (`apps/api`, `packages/db`). */
export const DEPO_KOKU = join(WEB_KOKU, '..', '..');

const APP = join(WEB_KOKU, 'app');

type Parca =
  | { tip: 'sabit'; ad: string }
  | { tip: 'dinamik' }
  /** `[...slug]` — bir veya daha fazla parça yutar. */
  | { tip: 'yakala' }
  /** `[[...slug]]` — sıfır veya daha fazla parça yutar. */
  | { tip: 'istege-bagli-yakala' };

export type Rota = {
  /** İnsan okuyacak biçim: `/product/[slug]/try-on`. */
  desen: string;
  parcalar: Parca[];
};

function parcaCoz(ad: string): Parca {
  if (ad.startsWith('[[...') && ad.endsWith(']]')) return { tip: 'istege-bagli-yakala' };
  if (ad.startsWith('[...') && ad.endsWith(']')) return { tip: 'yakala' };
  if (ad.startsWith('[') && ad.endsWith(']')) return { tip: 'dinamik' };
  return { tip: 'sabit', ad };
}

/**
 * `app/**\/{page.tsx,route.ts}` → rota deseni.
 *
 * ⚠️ ÜÇ KLASÖR SINIFI URL'YE GİRMEZ ve üçü de karıştırılırsa tablo baştan
 *    yanlış çıkar: rota grupları (`(magaza)`, `(satici)`, `(yonetim)`),
 *    özel klasörler (`_lib`, `_bilesenler`, `_liste`, `_kabuk`) ve paralel
 *    rotalar (`@slot`).
 */
export function rotaTablosu(): Rota[] {
  const bulunan: Rota[] = [];

  const gez = (dizin: string, parcalar: Parca[]): void => {
    for (const ad of readdirSync(dizin)) {
      const tam = join(dizin, ad);
      if (statSync(tam).isDirectory()) {
        if (ad.startsWith('_') || ad.startsWith('@')) continue;
        const grup = ad.startsWith('(') && ad.endsWith(')');
        gez(tam, grup ? parcalar : [...parcalar, parcaCoz(ad)]);
      } else if (ad === 'page.tsx' || ad === 'route.ts') {
        bulunan.push({ desen: desenYaz(parcalar), parcalar });
      }
    }
  };

  gez(APP, []);
  return bulunan;
}

function desenYaz(parcalar: Parca[]): string {
  if (parcalar.length === 0) return '/';
  return `/${parcalar
    .map((p) =>
      p.tip === 'sabit'
        ? p.ad
        : p.tip === 'dinamik'
          ? '[dinamik]'
          : p.tip === 'yakala'
            ? '[...]'
            : '[[...]]',
    )
    .join('/')}`;
}

/** Sorgu ve çapa rotanın parçası değildir. */
export function yoluTemizle(href: string): string {
  return href.split('?')[0]!.split('#')[0]!;
}

function parcalaraAyir(yol: string): string[] {
  return yol.split('/').filter((p) => p.length > 0);
}

/**
 * Somut bir yol bu rotaya oturuyor mu?
 *
 * ⚠️ `tamOlmali=false` ÖN EK modudur: şablon dizgilerinde (`` `/product/${slug}` ``)
 *    kırılan şey `${slug}` DEĞİL, sabit `/product/` önekidir. Önek modunda
 *    "verilen parçalar rotanın BAŞLANGICINA oturuyor mu" sorulur.
 */
function rotayaOturuyor(rota: Rota, parcalar: string[], tamOlmali: boolean): boolean {
  let i = 0;
  for (const beklenen of rota.parcalar) {
    if (beklenen.tip === 'yakala' || beklenen.tip === 'istege-bagli-yakala') {
      // Kalan her şeyi yutar; `[[...]]` sıfır parçayı da kabul eder.
      if (beklenen.tip === 'yakala' && i >= parcalar.length && tamOlmali) return false;
      return true;
    }
    if (i >= parcalar.length) return !tamOlmali;
    if (beklenen.tip === 'sabit' && beklenen.ad !== parcalar[i]) return false;
    i += 1;
  }
  return i === parcalar.length ? true : false;
}

/**
 * ⚠️ `[locale]` TOLERANSI — BİLEREK. Çok dillilik işi `app/[locale]/…`
 *    sarmalaması getiriyor ve o gün `href="/products"` yazan 95 bağlantı
 *    değişMEYECEK (next-intl `createNavigation` href'leri locale'siz tutar).
 *    Bu tabloyu o gün elle düzeltmek gerekseydi, düzeltmeyi yapan kişi ya
 *    testi gevşetir ya da 95 bağlantıyı ikinci kez düzenlerdi. Baştaki
 *    `[locale]` parçası bu yüzden İSTEĞE BAĞLI sayılır.
 */
function localeAtla(parcalar: Parca[]): Parca[] {
  const ilk = parcalar[0];
  return ilk?.tip === 'dinamik' ? parcalar.slice(1) : parcalar;
}

export function rotaVar(tablo: Rota[], yol: string, tamOlmali = true): boolean {
  const parcalar = parcalaraAyir(yoluTemizle(yol));
  return tablo.some(
    (rota) =>
      rotayaOturuyor(rota, parcalar, tamOlmali) ||
      rotayaOturuyor({ ...rota, parcalar: localeAtla(rota.parcalar) }, parcalar, tamOlmali),
  );
}

/* ------------------------------------------------------------------ */
/* Bağlantı toplama                                                    */
/* ------------------------------------------------------------------ */

export type Baglanti = {
  dosya: string;
  /** Kaynakta yazılı hâli — hata mesajı bunu yazar, yoksa dosyayı açmak gerekir. */
  ham: string;
  /** Doğrulanacak yol. Şablon dizgilerinde ifadeye kadarki SABİT önek. */
  yol: string;
  /** Şablon öneki mi? Öyleyse tam eşleşme aranmaz. */
  onek: boolean;
  kaynak: 'href' | 'redirect' | 'push' | 'donus-yolu' | 'yol-sabiti' | 'next-parametresi';
};

/**
 * ⚠️ ŞABLON DİZGİLERİ ARTIK TARANIYOR — ve eski gerekçe ("değeri çalışma
 *    zamanında belli") YENİDEN ADLANDIRMADA ÇÖKÜYOR. `` `/urun/${slug}` ``
 *    içinde kırılan şey `${slug}` değil, sabit `/urun/` ÖNEKİDİR; göçte
 *    kırılan tam olarak odur.
 */
const DESENLER: Array<{ re: RegExp; kaynak: Baglanti['kaynak'] }> = [
  /**
   * `href` VE `…Href` / `yol` / `YOL` / `…Yolu`.
   *
   * ⚠️ `[^;\n]*?` TERNARY İÇİN VAR, süs değil: `denemeYolu={denemeAcik ?
   *    `/product/${slug}/try-on` : null}` yazımı `[=:]\s*\{?\s*['"\`]` ile
   *    eşleşMEZ ve bu depoda tam olarak o yazımla bir deneme bağlantısı var.
   *    Katı desen o satırı sessizce atlar — yani göçün en kolay unutulacağı
   *    yerlerden biri taramanın dışında kalırdı.
   */
  {
    re: /\b\w*(?:[Hh]ref|[Yy][Oo][Ll][Uu]?)\s*[=:]\s*\{?[^;\n]*?['"`](\/[^'"`]*)/g,
    kaynak: 'href',
  },
  { re: /\b(?:permanentRedirect|redirect)\(\s*['"`](\/[^'"`]*)/g, kaynak: 'redirect' },
  { re: /\brouter\.(?:push|replace)\(\s*['"`](\/[^'"`]*)/g, kaynak: 'push' },
  // `hesapFetch(uçYolu, donusYolu)` — İKİNCİ argüman bir ROTADIR, uç değil.
  { re: /\bhesapFetch<[^>]*>\(\s*[^,]+,\s*['"`](\/[^'"`]*)/g, kaynak: 'donus-yolu' },
];

/**
 * `?next=` DÖNÜŞ YOLU — göçten sonra SESSİZCE 404'e giden sınıf.
 *
 * ⚠️ Karakter kümesi `$`ı DIŞLAMAZ: dışlasaydı `?next=/product/${slug}/try-on`
 *    yalnız `/product/` olarak yakalanır ve TAM eşleşme aranırdı — var olmayan
 *    bir rota gibi görünüp yanlış pozitif üretirdi. `${` yakalanınca `yoluCoz`
 *    doğru şekilde ÖNEK moduna geçer.
 */
const NEXT_DESENI = /[?&]next=(\/[^'"`&\s]*)/g;

/**
 * ⚠️ YORUMLAR TARAMA DIŞI. Bu depoda yorumlar SİLİNMİŞ bağlantıların
 *    hikâyesini tutuyor (`cart/paket.tsx` → kaldırılan `/magaza/…` bağlantısı,
 *    `not-found.tsx` → silinmiş `loading.tsx`ler). Tarasaydık kapı, kaldırıldığı
 *    için doğru olan bir kararı arıza diye bildirir ve ilk düzelten kişi
 *    gerekçeyi silerdi. Tıklanamayan bir dizgi ölü bağlantı değildir.
 */
function yorumlariAt(kaynak: string): string {
  return kaynak.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const UZANTILAR = ['.ts', '.tsx'];

function dosyalariGez(kok: string, isle: (tam: string) => void): void {
  for (const ad of readdirSync(kok)) {
    if (ad === 'node_modules' || ad === '.next' || ad === 'dist') continue;
    const tam = join(kok, ad);
    if (statSync(tam).isDirectory()) {
      dosyalariGez(tam, isle);
      continue;
    }
    if (!UZANTILAR.some((u) => ad.endsWith(u))) continue;
    // ⚠️ Test dosyaları taranmaz: içlerindeki yollar BEKLENTİDİR, bağlantı
    //    değil — ve bu dosyanın kendi desenleri bir test kaynağında kolayca
    //    kendine takılır (regex literalleri `href`/`yol` sözcüğünü taşır).
    //    Taransaydı kapı, ilk kırmızısını kendi kaynağında verirdi.
    if (/\.test\.tsx?$/.test(ad)) continue;
    isle(tam);
  }
}

/**
 * Şablon önekini ayıklar.
 *
 * `` `/products?q=${x}` `` → sorgu başladıysa yol TAMDIR (`/products`).
 * `` `/product/${slug}` `` → `${`e kadarki kısım ÖNEKtir (`/product/`).
 */
function yoluCoz(ham: string): { yol: string; onek: boolean } | null {
  const ifadeBasi = ham.indexOf('${');
  const sabit = ifadeBasi === -1 ? ham : ham.slice(0, ifadeBasi);
  const temiz = yoluTemizle(sabit);
  if (temiz.length === 0 || !temiz.startsWith('/')) return null;

  // Sorgu/çapa görüldüyse yol parçası bitmiştir: tam eşleşme aranır.
  const sorguVar = sabit.length > temiz.length;
  if (sorguVar || ifadeBasi === -1) return { yol: temiz.replace(/\/$/, '') || '/', onek: false };
  return { yol: temiz, onek: true };
}

export function baglantilariTopla(kokler: string[]): Baglanti[] {
  const bulunan: Baglanti[] = [];

  for (const kok of kokler) {
    dosyalariGez(kok, (tam) => {
      const kaynak = yorumlariAt(readFileSync(tam, 'utf8'));
      const dosya = tam.slice(DEPO_KOKU.length + 1);

      for (const { re, kaynak: tur } of DESENLER) {
        for (const eslesme of kaynak.matchAll(new RegExp(re.source, re.flags))) {
          const ham = eslesme[1]!;
          const cozum = yoluCoz(ham);
          if (cozum) bulunan.push({ dosya, ham, ...cozum, kaynak: tur });
        }
      }

      for (const eslesme of kaynak.matchAll(NEXT_DESENI)) {
        const cozum = yoluCoz(eslesme[1]!);
        if (cozum) bulunan.push({ dosya, ham: eslesme[1]!, ...cozum, kaynak: 'next-parametresi' });
      }
    });
  }

  // Aynı satır iki desene birden takılabiliyor (`href` ve `\w*[Hh]ref`).
  const gorulen = new Set<string>();
  return bulunan.filter((b) => {
    const anahtar = `${b.dosya}|${b.kaynak}|${b.ham}`;
    if (gorulen.has(anahtar)) return false;
    gorulen.add(anahtar);
    return true;
  });
}
