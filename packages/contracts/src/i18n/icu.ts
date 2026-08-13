import { INTL_ETIKET, VARSAYILAN_LOCALE, type Locale } from './locale.js';

/**
 * KÜÇÜK ICU — yalnızca yer tutucu ve ÇOĞUL.
 *
 * ⚠️ NEDEN BURADA BİR AYRIŞTIRICI VAR, NEDEN next-intl DEĞİL: `next-intl`
 *    `apps/web`in bağımlılığıdır ve `apps/api` ile `apps/worker` onu göremez.
 *    Hata kataloğu metinleri ise ÜÇÜNDE DE biçimlenir — sunucu `userMessage`ı
 *    (sürüm sapması yedeği) hâlâ üretiyor, worker bildirim gönderiyor, tarayıcı
 *    ekrana basıyor. Aynı cümlenin üç yerde iki farklı ayrıştırıcıyla
 *    üretilmesi, bu depoda defalarca yaşanan "iki kopya zamanla ayrışır"
 *    hatasının birebir aynısı olurdu. Bu dosya `Intl` dışında hiçbir şeye
 *    bağlı değil, yani her üç ortamda da aynı çıktıyı verir.
 *
 * ⚠️ ÇOĞUL NEDEN ŞART: Türkçede sayıdan sonra çoğul eki YOKTUR ("3 adet"),
 *    İngilizcede vardır ("3 items" / "1 item"). Düz yer tutucuyla çevrilen bir
 *    katalog metni İngilizcede "1 items" yazar — derleme geçer, test geçer,
 *    kullanıcı bozuk cümle görür. Tam olarak bu deponun "yeşil testle kaçan
 *    hata" deseni.
 *
 * DESTEKLENEN:
 *   {ad}
 *   {ad, plural, one {… # …} other {… # …}}   (`=0` gibi tam eşleşmeler dahil)
 *   `#` → sayının locale'e göre biçimlenmiş hâli
 *
 * DESTEKLENMEYEN (bilerek): `select`, `selectordinal`, tarih/sayı iskeletleri,
 * tırnakla kaçış. Katalogda ihtiyaç yok; olsaydı ayrıştırıcı sessizce yanlış
 * cümle üretmek yerine yer tutucuyu OLDUĞU GİBİ bırakır (aşağıya bakın).
 */

export type IcuDeger = string | number;

/**
 * ⚠️ EKSİK PARAMETRE YER TUTUCUYU OLDUĞU GİBİ BIRAKIR, boş dizge YAZMAZ.
 *    Gerekçe `api-failure.ts` başlığında yazılı: doldurulmamış bir cümle
 *    ("en fazla adet alabilirsiniz") hatanın kendisinden daha kafa karıştırıcı.
 *    Yer tutucu görünür kalırsa arıza ilk gören kişide belli olur.
 */
export function icuBicimle(
  sablon: string,
  degerler: Readonly<Record<string, IcuDeger>> | undefined,
  locale: Locale = VARSAYILAN_LOCALE,
): string {
  if (!sablon.includes('{')) return sablon;
  return coz(sablon, degerler ?? {}, locale, undefined);
}

/**
 * Şablondaki tüm yer tutucu adları — SIRALI ve TEKİL.
 *
 * ⚠️ Çoğul SEÇENEK GÖVDELERİ yer tutucu değildir: `{n, plural, one {# gün}}`
 *    içindeki `{# gün}` bir isim değil, bir dal. Düz bir "iki süslü parantez
 *    arasını al" taraması onu `"# gün"` adlı bir yer tutucu sanar ve
 *    diller arası eşitlik testi HER çoğullu metinde kırmızı yanar; testi
 *    susturmak için de en kolay yol çoğulu silmek olurdu. Bu yüzden gövdeler
 *    ayrıştırılıp İÇLERİNE iniliyor.
 */
export function yerTutucular(sablon: string): string[] {
  const bulunan = new Set<string>();
  topla(sablon, bulunan);
  return [...bulunan].sort();
}

function topla(sablon: string, bulunan: Set<string>): void {
  let i = 0;
  while (i < sablon.length) {
    if (sablon[i] !== '{') {
      i += 1;
      continue;
    }
    const kapanis = eslesenKapanis(sablon, i);
    if (kapanis === -1) return;

    const ic = sablon.slice(i + 1, kapanis);
    const virgul = ic.indexOf(',');
    const ad = (virgul === -1 ? ic : ic.slice(0, virgul)).trim();
    if (ad) bulunan.add(ad);

    if (virgul !== -1) {
      const kalan = ic.slice(virgul + 1).trim();
      if (kalan.startsWith('plural')) {
        for (const govde of Object.values(seceneklerAyristir(kalan.slice('plural'.length)))) {
          topla(govde, bulunan);
        }
      }
    }

    i = kapanis + 1;
  }
}

function coz(
  sablon: string,
  degerler: Readonly<Record<string, IcuDeger>>,
  locale: Locale,
  diyezDegeri: number | undefined,
): string {
  let sonuc = '';
  let i = 0;

  while (i < sablon.length) {
    const karakter = sablon[i]!;

    if (karakter === '#' && diyezDegeri !== undefined) {
      sonuc += sayiBicimle(diyezDegeri, locale);
      i += 1;
      continue;
    }

    if (karakter !== '{') {
      sonuc += karakter;
      i += 1;
      continue;
    }

    const kapanis = eslesenKapanis(sablon, i);
    if (kapanis === -1) {
      // Dengesiz süslü parantez: metin bozuk ama kullanıcıya bir şey gösterilmeli.
      sonuc += sablon.slice(i);
      break;
    }

    sonuc += yerTutucuCoz(sablon.slice(i + 1, kapanis), degerler, locale);
    i = kapanis + 1;
  }

  return sonuc;
}

function yerTutucuCoz(
  ic: string,
  degerler: Readonly<Record<string, IcuDeger>>,
  locale: Locale,
): string {
  const virgul = ic.indexOf(',');
  const ad = (virgul === -1 ? ic : ic.slice(0, virgul)).trim();
  const deger = degerler[ad];

  if (deger === undefined) return `{${ic}}`;

  if (virgul === -1) {
    return typeof deger === 'number' ? sayiBicimle(deger, locale) : deger;
  }

  const kalan = ic.slice(virgul + 1).trim();
  if (!kalan.startsWith('plural')) return `{${ic}}`;

  const sayi = typeof deger === 'number' ? deger : Number(deger);
  if (!Number.isFinite(sayi)) return `{${ic}}`;

  const secenekler = seceneklerAyristir(kalan.slice('plural'.length));
  const kategori = new Intl.PluralRules(INTL_ETIKET[locale]).select(sayi);
  const govde = secenekler[`=${sayi}`] ?? secenekler[kategori] ?? secenekler['other'];

  return govde === undefined ? `{${ic}}` : coz(govde, degerler, locale, sayi);
}

/** `one {…} other {…}` → `{ one: '…', other: '…' }` */
function seceneklerAyristir(kaynak: string): Record<string, string> {
  const secenekler: Record<string, string> = {};
  let i = 0;

  while (i < kaynak.length) {
    while (i < kaynak.length && (kaynak[i] === ',' || /\s/.test(kaynak[i]!))) i += 1;
    const baslangic = i;
    while (i < kaynak.length && kaynak[i] !== '{') i += 1;
    if (i >= kaynak.length) break;

    const secici = kaynak.slice(baslangic, i).trim();
    const kapanis = eslesenKapanis(kaynak, i);
    if (kapanis === -1) break;
    if (secici) secenekler[secici] = kaynak.slice(i + 1, kapanis);
    i = kapanis + 1;
  }

  return secenekler;
}

/**
 * ⚠️ DÜZ `indexOf('}')` YAZILAMAZ: çoğul seçeneklerinin gövdesi kendi süslü
 *    parantezlerini taşıyor (`other {{count} satır}`). Düz arama ilk `}`de
 *    durur ve şablonun geri kalanı ham metin olarak ekrana düşer.
 */
function eslesenKapanis(kaynak: string, acilis: number): number {
  let derinlik = 0;
  for (let i = acilis; i < kaynak.length; i += 1) {
    if (kaynak[i] === '{') derinlik += 1;
    else if (kaynak[i] === '}') {
      derinlik -= 1;
      if (derinlik === 0) return i;
    }
  }
  return -1;
}

const SAYI_BICIMLEYICI = new Map<Locale, Intl.NumberFormat>();

/**
 * ⚠️ BURADA BİÇİMLENEN SAYI PARA DEĞİLDİR ve olamaz: adet, gün, dakika, satır
 *    sayısı. Para `money.ts` → `formatMoney` yolundan geçer ve o yol `BigInt`
 *    üzerinde kalır. Bu ikisi karıştırılırsa `Number()` para okuma yasağı
 *    (`apps/web/src/lib/money.ts` başlığı) katalog metinleri üzerinden sessizce
 *    delinmiş olur.
 */
function sayiBicimle(deger: number, locale: Locale): string {
  let bicimleyici = SAYI_BICIMLEYICI.get(locale);
  if (!bicimleyici) {
    bicimleyici = new Intl.NumberFormat(INTL_ETIKET[locale]);
    SAYI_BICIMLEYICI.set(locale, bicimleyici);
  }
  return bicimleyici.format(deger);
}
