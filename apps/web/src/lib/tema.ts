/**
 * TEMA — açık / koyu / sistem. TEK KAYNAK: adlar, çerez, satır içi betik.
 *
 * ⚠️ ÇEREZ, `localStorage` DEĞİL — ve gerekçe FOUC değil. FOUC açısından ikisi
 *    DENKTİR: `<body>`nin ilk çocuğu olan bloklayan bir betik ikisini de ilk
 *    boyamadan önce senkron okur. Gerekçe GÖÇ MALİYETİ: yarın sunucunun temayı
 *    bilmesi gerekirse (e-posta şablonu, `Sec-CH-Prefers-Color-Scheme`
 *    müzakeresi, OG görseli) çerez zaten oradadır; `localStorage` sunucuya
 *    HİÇBİR ZAMAN ulaşmaz ve o gün ikinci bir saklama yeri açılırdı — bu
 *    depoda iki kopyanın ayrışması teorik değil, ölçülmüş bir olay.
 *
 * ⚠️ `httpOnly` DEĞİL ve bu BİLİNÇLİ bir istisna. `lib/session/cookies.ts`teki
 *    üç çerez sırdır; tema sır değildir. Dahası: Sunucu Bileşeninden çerez
 *    YAZILAMAZ (gerekçe o dosyanın başlığında), yani tercihi yazan taraf
 *    zorunlu olarak tarayıcıdır.
 *
 * ⚠️ TERCİH ÇEREZDE, KARAR TARAYICIDA. `sistem` seçeneği SUNUCUDA
 *    ÇÖZÜLEMEZ: `prefers-color-scheme` sunucuya gelmez
 *    (`Sec-CH-Prefers-Color-Scheme` opt-in'dir ve ilk istekte hiç gelmez).
 *    Yani "çerezi sunucuda okuyup `<html>`e sınıf basmak" varsayılan
 *    kullanıcının temasını hiçbir zaman doğru veremezdi. İkinci ve daha ağır
 *    sebep: kök düzende `cookies()` çağırmak bugün statik olan beş rotayı
 *    (`/_not-found`, `/calculator`, `/collection`,
 *    `/legal/kullanim-kosullari`, `/legal/aydinlatma-metni`) `ƒ`ye düşürür ve
 *    `legal/[belge]`nin `dynamicParams:false` + `generateStaticParams` 404
 *    kapısını SESSİZCE devre dışı bırakır — AGENTS.md §8'in "aylarca 200
 *    döndü" diye anlattığı arızanın birebir aynısı.
 *
 * ⚠️ BEDELİ DÜRÜSTÇE: çerez her istekte gider (~18 bayt), `/_next/static/*`
 *    dahil. `infra/nginx/vt.conf` bugün çerezle önbellek anahtarlamıyor; bir
 *    gün anahtarlarsa vitrin önbelleği ikiye bölünür.
 */

export const TEMA_COOKIE = 'vt_tema';

/** `globals.css` içindeki koyu tema kapsayıcısı. Betik ve TS aynı sabiti okur. */
export const TEMA_SINIFI = 'tema-koyu';

/** Ölçüm ve testler bunu okur; `data-tema` TERCİH, `data-tema-cozum` SONUÇ. */
export const TEMA_NITELIGI = 'data-tema';
export const TEMA_COZUM_NITELIGI = 'data-tema-cozum';

export const TEMA_SECENEKLERI = ['acik', 'koyu', 'sistem'] as const;
export type TemaSecimi = (typeof TEMA_SECENEKLERI)[number];

/**
 * ⚠️ VARSAYILAN `acik` — ÜRÜN KARARI, teknik tercih değil.
 *
 *    Bir dönem `sistem` idi ve teknik olarak daha "doğru" görünüyordu:
 *    kullanıcının işletim sistemi tercihine uy. Ama burası bir MODA VİTRİNİ ve
 *    ayrıştırıcısı sanal deneme GÖRSELİ. `design-system.md`nin gerekçe bölümü
 *    bunu söylüyor: o görselin işe yaraması için etrafın SUSMASI gerekir.
 *
 *    Ürün fotoğrafları beyaz/nötr fonda çekiliyor. Koyu zeminde aynı görsel
 *    kesik bir kare gibi durur ve kumaşın rengi olduğundan farklı algılanır —
 *    satın alma kararının tam da dayandığı şey. Bu, tema tercihinden daha
 *    ağır basar.
 *
 * ⚠️ BEDELİ AÇIKÇA: işletim sisteminde koyu tema seçmiş bir kullanıcı bu siteyi
 *    AÇIK açar; onun için bir sürprizdir. Karşılığında ürün görselinin doğru
 *    göründüğü bir vitrin alıyoruz. Seçim tek tıkla değişir ve KALICIDIR
 *    (çerez, bir yıl) — sürpriz bir kez yaşanır.
 *
 * ⚠️ YÖNETİM PANELİNE ÖZEL VARSAYILAN YOK ve olmayacak. Rota önekine bakan bir
 *    dal (`pathname.startsWith('/admin')`) rota adının ÜÇÜNCÜ bir kopyasını
 *    doğururdu; o kopyanın bayatlaması varsayım değil — rota adları bu depoda
 *    BİR KEZ topluca değişti (`/yonetim` → `/admin`). `design-system.md` koyuyu
 *    yönetim için REFERANS TERCİHİ olarak yazıyor, işlevsel kısıt olarak değil;
 *    yönetici koyuyu tek tıkla seçer ve seçimi kalır.
 */
export const TEMA_VARSAYILAN: TemaSecimi = 'acik';

/** 1 yıl. Tercih oturumdan uzun yaşar. */
export const TEMA_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function temaCozumle(deger: string | null | undefined): TemaSecimi {
  return (TEMA_SECENEKLERI as readonly string[]).includes(deger ?? '')
    ? (deger as TemaSecimi)
    : TEMA_VARSAYILAN;
}

declare global {
  interface Window {
    /**
     * Satır içi betiğin dışarı açtığı TEK giriş. Değiştirici bunu çağırır ki
     * uygulama mantığı iki yerde yazılmasın.
     */
    __vtTema?: (secim: TemaSecimi) => void;
  }
}

/**
 * BLOKLAYAN SATIR İÇİ BETİK — `<body>`nin İLK ÇOCUĞU.
 *
 * ⚠️ Dizgi ELLE yazılmıyor, yukarıdaki sabitlerden üretiliyor. Elle yazılsaydı
 *    sınıf adı bir gün `globals.css`te değişip burada eski kalırdı ve arıza
 *    yalnızca ilk karede görünürdü — `tsc` ve `next build` böyle bir sapmayı
 *    yakalayamaz.
 *
 * ⚠️ `style.colorScheme` DOĞRUDAN yazılıyor: CSS henüz inmemişken kaydırma
 *    çubuğu, form denetimleri ve `<html>` kök zemini tarayıcı varsayılanıyla
 *    (beyaz) çizilir. `color-scheme` bunu tek satırda kapatır.
 *
 * ⚠️ `matchMedia` dinleyicisi BURADA kuruluyor, değiştiricide değil: `sistem`
 *    seçili kullanıcı işletim sistemi temasını değiştirdiğinde sayfanın
 *    takip etmesi gerekir ve değiştirici her ekranda mount edilmiş olmayabilir.
 *
 * ⚠️ `try/catch`: çerez erişimi kısıtlı bir bağlamda (gömülü iframe, katı
 *    gizlilik ayarı) fırlatırsa sayfa temasız ama ÇALIŞIR halde kalır.
 */
export const TEMA_BETIGI = `(function(){try{var d=document.documentElement,c=document.cookie.match(/(?:^|; )${TEMA_COOKIE}=([^;]*)/),s=c?decodeURIComponent(c[1]):'${TEMA_VARSAYILAN}';if(${JSON.stringify(
  TEMA_SECENEKLERI,
)}.indexOf(s)<0){s='${TEMA_VARSAYILAN}';}var q=window.matchMedia('(prefers-color-scheme: dark)');var f=function(){var k=s==='koyu'||(s==='sistem'&&q.matches);d.classList.toggle('${TEMA_SINIFI}',k);d.setAttribute('${TEMA_NITELIGI}',s);d.setAttribute('${TEMA_COZUM_NITELIGI}',k?'koyu':'acik');d.style.colorScheme=k?'dark':'light';};f();q.addEventListener('change',f);window.__vtTema=function(v){s=v;f();};}catch(e){}})();`;

/**
 * Tercihi UYGULA + KALICI YAZ. Yalnızca tarayıcıda çağrılır.
 *
 * ⚠️ Uygulama yolu satır içi betiğin `__vtTema`sıdır; buradaki yedek dal
 *    yalnızca betik hiç çalışmadıysa (CSP nonce'suz bir gün eklenirse) devreye
 *    girer. İki yol da AYNI sabitleri kullanıyor, ayrışamazlar.
 */
export function temaUygula(secim: TemaSecimi): void {
  if (typeof window === 'undefined') return;

  if (window.__vtTema) {
    window.__vtTema(secim);
  } else {
    const d = document.documentElement;
    const koyu =
      secim === 'koyu' ||
      (secim === 'sistem' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    d.classList.toggle(TEMA_SINIFI, koyu);
    d.setAttribute(TEMA_NITELIGI, secim);
    d.setAttribute(TEMA_COZUM_NITELIGI, koyu ? 'koyu' : 'acik');
    d.style.colorScheme = koyu ? 'dark' : 'light';
  }

  // ⚠️ `secure` yalnız https'te: yerel geliştirme http üzerinden çalışıyor ve
  //    `secure` yazılsaydı çerez hiç kaydedilmez, tercih her yenilemede
  //    kaybolurdu — "yerelde çalışmıyor, sunucuda çalışıyor" sınıfı bir arıza.
  const guvenli = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${TEMA_COOKIE}=${secim}; path=/; max-age=${TEMA_COOKIE_MAX_AGE}; samesite=lax${guvenli}`;
}

/** Değiştiricinin okuduğu mevcut tercih; kaynağı `<html>`in kendisidir. */
export function mevcutTema(): TemaSecimi {
  if (typeof document === 'undefined') return TEMA_VARSAYILAN;
  return temaCozumle(document.documentElement.getAttribute(TEMA_NITELIGI));
}
