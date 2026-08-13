import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT_RESULT_LEGACY_PATH, CHECKOUT_RESULT_PATH } from '@vt/config/constants';
import { describe, expect, it } from 'vitest';
import {
  DEPO_KOKU,
  WEB_KOKU,
  baglantilariTopla,
  rotaTablosu,
  rotaVar,
  yoluTemizle,
  type Baglanti,
} from './rota-tablosu';

/**
 * ÖLÜ BAĞLANTI KAPISI — ROTA GÖÇÜNÜN TEK GERÇEK KORUMASI.
 *
 * ⚠️ NEDEN VAR: Türkçe adresler (`/urunler`, `/hesabim`, `/satici`) İngilizce
 *    karşılıklarına taşındı. Bu göçte kırılabilecek tek şey bir `href`in
 *    güncellenmemesidir ve o kırılma DERLEMEYE YANSIMAZ: `next build` geçer,
 *    `pnpm --filter @vt/web exec tsc --noEmit` geçer, `eslint` geçer, kullanıcı
 *    404 görür. Bu depoda ALTI KEZ yaşanan "testler yeşilken bağlantı kopuk"
 *    deseninin rota eksenindeki hâli budur.
 *
 * ⚠️ HER TARAMANIN BİR ALT SINIR İDDİASI VAR. Tarama sessizce boşalırsa
 *    aşağıdaki `filter`ların hepsi boş dizi döner ve test YEŞİL yanar — yani
 *    testin var olmamasıyla aynı şey. Bu depoda `yan-menu.test.ts` dosyası
 *    hiç yüklenmezken `vitest` 1175 test geçiyordu; sayıya değil KAPSAMA
 *    bakılır.
 *
 * ⚠️ BU TEST BİR ÇALIŞMA ZAMANI KANITI DEĞİLDİR. `<Link>` sayısını doğrular,
 *    sayfanın çizildiğini doğrulaMAZ. Üretim derlemesi üzerinde her yolu çekmek
 *    ayrı bir adımdır ve o adım atlanamaz.
 */

const TARANAN_KOKLER = [join(WEB_KOKU, 'app'), join(WEB_KOKU, 'src')];

/**
 * `next.config.ts` içindeki iki `rewrite` yüzünden bu iki adres GERÇEK bir
 * `page.tsx`e sahip değil ama YAŞAYAN adreslerdir.
 *
 * ⚠️ Bunu "yanlış pozitif" sanıp `legal/[belge]`nin `canonical: /${slug}`
 *    değerini `/legal/...` diye düzelten kişi, hukuki metinlerin canonical'ını
 *    BOZAR — adres çubuğunda görünen adres bu ikisi.
 */
const REWRITE_ADRESLERI = ['/kullanim-kosullari', '/aydinlatma-metni'];

/** Dış bağlantı, `mailto:`, çapa — rota tablosunun konusu değil. */
function icBaglanti(b: Baglanti): boolean {
  return b.yol.startsWith('/') && !b.yol.startsWith('//');
}

const tablo = rotaTablosu();
const baglantilar = baglantilariTopla(TARANAN_KOKLER).filter(icBaglanti);

function cozuluyorMu(yol: string, onek: boolean): boolean {
  if (REWRITE_ADRESLERI.includes(yoluTemizle(yol))) return true;
  return rotaVar(tablo, yol, !onek);
}

describe('rota tablosu', () => {
  it('dosya sistemi taraması gerçekten çalışıyor', () => {
    // ⚠️ Alt sınır: bugün 48 `page.tsx` + 5 `route.ts` var. Tarama boşalırsa
    //    aşağıdaki bütün iddialar boş döngüye düşer.
    expect(tablo.length).toBeGreaterThan(45);

    const desenler = new Set(tablo.map((r) => r.desen));
    // Üç bölgenin de kökü tabloda olmalı; biri düşerse göç yarım kalmıştır.
    expect(desenler).toContain('/products');
    expect(desenler).toContain('/product/[dinamik]/try-on');
    expect(desenler).toContain('/account/orders/[dinamik]');
    expect(desenler).toContain('/seller/products/[dinamik]/images');
    expect(desenler).toContain('/admin/payout');
    expect(desenler).toContain('/checkout/result');
  });

  it('rota grupları ve özel klasörler URL’ye girmiyor', () => {
    // `(magaza)` `(satici)` `(yonetim)` Türkçe KALIR — URL'ye girmedikleri için.
    // Sızarlarsa her yol yanlış çıkar ve test hep kırmızı olur; bu iddia
    // "kırmızının sebebi tarayıcı" hâlini erken ayırır.
    const sizinti = tablo.filter((r) => /[()_@]/.test(r.desen));
    expect(sizinti.map((r) => r.desen)).toEqual([]);
  });
});

describe('ölü bağlantı', () => {
  it('bağlantı taraması gerçekten çalışıyor', () => {
    // ⚠️ Göç öncesi kapsama 26 bağlantıydı (%27) ve yalnız panel bölgesiydi.
    //    En çok bağlantı taşıyan `(magaza)` hiç taranmıyordu.
    expect(baglantilar.length).toBeGreaterThan(90);

    // Her kaynak türünün en az bir örneği yakalanmalı: bir desen bozulursa
    // (ör. `redirect(` yazımı değişirse) tarama sessizce daralır.
    const turler = new Set(baglantilar.map((b) => b.kaynak));
    expect([...turler].sort()).toEqual([
      'donus-yolu',
      'href',
      'next-parametresi',
      'push',
      'redirect',
    ]);

    // `(magaza)` bölgesi kapsamda mı — göçün en geniş etki alanı burası.
    const vitrin = baglantilar.filter((b) => b.dosya.includes('(magaza)'));
    expect(vitrin.length).toBeGreaterThan(30);
  });

  it('kaynaktaki her iç bağlantının bir rotası var', () => {
    const kirik = baglantilar.filter((b) => !cozuluyorMu(b.yol, b.onek));

    expect(
      kirik,
      `rotası olmayan bağlantı:\n${kirik
        .map((k) => `  ${k.dosya} (${k.kaynak}) → ${k.ham}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('`?next=` dönüş yolları da gerçek rota', () => {
    // ⚠️ `guvenliDonusYolu()` yalnız AÇIK YÖNLENDİRMEYE bakar ve `/` ile
    //    başlayan HER yolu kabul eder. Yani bayat bir `?next=/hesabim`
    //    göçten sonra SESSİZCE 404'e gider — güvenlik değil, UX arızası.
    const donusler = baglantilar.filter((b) => b.kaynak === 'next-parametresi');
    expect(donusler.length).toBeGreaterThan(0);

    const kirik = donusler.filter((b) => !cozuluyorMu(b.yol, b.onek));
    expect(kirik, `kırık ?next=: ${kirik.map((k) => `${k.dosya} → ${k.ham}`).join(' · ')}`).toEqual(
      [],
    );
  });
});

/**
 * TÜRKÇE SEGMENT KARA LİSTESİ — DEPO GENELİNDE.
 *
 * ⚠️ YALNIZ `apps/web` YETMEZ: `packages/db/prisma/seed.ts` konsola adres
 *    basıyor ve `apps/api` ödeme dönüş adresini SABİT YAZILI tutuyor. Göç
 *    `apps/web`de bitip depoda bir yerde eski adres kalırsa, kalan yer
 *    kullanıcının parasını ödediği yer olabilir.
 */
const YASAKLI_SEGMENTLER = [
  'urunler',
  'urun',
  'sepet',
  'giris',
  'kayit',
  'odeme',
  'kategori',
  'koleksiyon',
  'hesaplayici',
  'hukuki',
  'stil-danismani',
  'hesabim',
  'satici',
  'yonetim',
  'gardirop',
  'gizlilik',
  'guvenlik',
  'siparisler',
  'iadeler',
  'finans',
  'kuponlar',
  'saticilar',
  'kategoriler',
  'raporlar',
  'uyarilar',
  'komisyon',
  'moderasyon',
  'denetim',
  'gorseller',
  'toplu-yukleme',
];

const KARA_LISTE_KOKLERI = [
  join(WEB_KOKU, 'app'),
  join(WEB_KOKU, 'src'),
  join(DEPO_KOKU, 'apps', 'api', 'src'),
  join(DEPO_KOKU, 'packages', 'db', 'prisma'),
];

describe('göç tamamlandı: eski Türkçe adres kalmadı', () => {
  it('hiçbir bağlantı eski Türkçe segmentle başlamıyor', () => {
    const tumu = baglantilariTopla(KARA_LISTE_KOKLERI);
    expect(tumu.length).toBeGreaterThan(90);

    const eski = tumu.filter((b) => {
      const ilk = yoluTemizle(b.yol).split('/')[1] ?? '';
      return YASAKLI_SEGMENTLER.includes(ilk);
    });

    expect(
      eski,
      `göç edilmemiş adres:\n${eski.map((k) => `  ${k.dosya} → ${k.ham}`).join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * PROXY MATCHER'I — BU TURUN EN KIRILGAN ÜÇ SATIRI.
 *
 * ⚠️ Matcher panel öneklerini taşır ve önekler bu göçte DEĞİŞTİ. Güncellenmezse
 *    eşleşme durur; çerezsiz ziyaretçi önce panel kabuğunu çizdirir sonra
 *    yönlendirilir (iskelet sıçraması geri gelir). `next build` ve `tsc` ikisi
 *    de SESSİZ kalır.
 *
 * ⚠️ Bunun bir GÜVENLİK katmanı OLMADIĞINI vurguluyorum — gerçek kapı
 *    `(satici)`/`(yonetim)` layout'larındaki `requireRole` ve API guard'ları.
 *    Matcher'ı güvenlik ilan etmek `guard.ts`in adıyla uyardığı yanılsamayı
 *    besler. Buradaki iddia "koruma var" değil, "matcher bayat değil"dir.
 */
describe('proxy matcher’ı rota tablosuyla uyumlu', () => {
  const kaynak = readFileSync(join(WEB_KOKU, 'proxy.ts'), 'utf8');
  const onekler = [...kaynak.matchAll(/'(\/[^']*?)\/:path\*'/g)].map((m) => m[1]!);

  it('matcher okunabildi', () => {
    expect(onekler).toEqual(['/account', '/seller', '/admin']);
  });

  it('her matcher öneki en az bir gerçek rotayla eşleşiyor', () => {
    const bos = onekler.filter((onek) => !rotaVar(tablo, onek, true));
    expect(bos, `hiçbir rotayla eşleşmeyen matcher öneki: ${bos.join(', ')}`).toEqual([]);
  });

  it('oturum kapısı `/login`e yönlendiriyor', () => {
    // Yönlendirme hedefi de bir rotadır ve göçte kaçırılırsa oturumsuz her
    // panel isteği 404'e gider — yani kapı çalışır ama kimse giriş yapamaz.
    const hedef = kaynak.match(/new URL\('(\/[^']+)'/)?.[1];
    expect(hedef).toBe('/login');
    expect(rotaVar(tablo, hedef!, true)).toBe(true);
  });

  it('panel bölgelerinin hepsi matcher’da', () => {
    // Tabloda kökü olan panel bölgesi matcher'da yoksa o bölge iskelet
    // sıçraması yaşar. Yeni bir panel kökü açıldığı gün burası kırmızı olur.
    const panelKokleri = new Set(
      tablo
        .map((r) => r.desen.split('/')[1])
        .filter((kok): kok is string => kok === 'account' || kok === 'seller' || kok === 'admin'),
    );
    expect([...panelKokleri].sort()).toEqual(onekler.map((o) => o.slice(1)).sort());
  });
});

/**
 * `next.config.ts` — YÖNLENDİRME VE REWRITE KAYITLARI.
 *
 * ⚠️ `/checkout/sonuc` KÖPRÜSÜ ZİNCİRİN EN PAHALI HALKASI. Türkçe kara listeye
 *    TAKILMAZ ("checkout" İngilizce, "sonuc" listede yok) ve arıza yalnızca
 *    GERÇEK bir ödeme tamamlandıktan sonra, parası çekilmiş kullanıcıda
 *    görünür. Diğer her ölü bağlantının bedeli bir 404; bunun bedeli bir sipariş.
 */
describe('next.config yönlendirmeleri', () => {
  const kaynak = readFileSync(join(WEB_KOKU, 'next.config.ts'), 'utf8');
  const kayitlar = [...kaynak.matchAll(/source:\s*'([^']+)',\s*destination:\s*'([^']+)'/g)].map(
    (m) => ({ source: m[1]!, destination: m[2]! }),
  );

  it('kayıtlar okunabildi', () => {
    expect(kayitlar.length).toBe(3);
  });

  it('her `destination` gerçek bir rota', () => {
    const kirik = kayitlar.filter((k) => !rotaVar(tablo, k.destination, true));
    expect(
      kirik,
      `hedefi olmayan kayıt: ${kirik.map((k) => `${k.source} → ${k.destination}`).join(' · ')}`,
    ).toEqual([]);
  });

  it('hiçbir kayıt kendine yönlenmiyor', () => {
    // ⚠️ Bir find/replace ikisini eşitlerse Next kendine yönlenen bir kayıt
    //    üretir (ERR_TOO_MANY_REDIRECTS). Derleme geçer, tsc geçer.
    const dongu = kayitlar.filter((k) => k.source === k.destination);
    expect(dongu.map((k) => k.source)).toEqual([]);
  });

  it('rewrite `source`ları rota tablosunda YOK — olsaydı gölgelenirlerdi', () => {
    // `/kullanim-kosullari` bir `page.tsx`e sahip olsaydı rewrite hiç
    // çalışmaz, iki ayrı düzen ayrışırdı.
    for (const adres of REWRITE_ADRESLERI) {
      expect(rotaVar(tablo, adres, true), `${adres} hem rewrite hem rota`).toBe(false);
    }
  });

  /**
   * ⚠️ BU İDDİA BÜTÜNLEME TURUNDA GÜÇLENDİ. Önceki hâli "backend'in yazdığı
   *    dizgi ile köprünün `source`u aynı mı" diye soruyordu; o soru ancak
   *    ADRES İKİ DEPODA AYRI AYRI YAZILIYKEN anlamlıydı. Artık tek yazılı yer
   *    `@vt/config` → `CHECKOUT_RESULT_PATH` ve backend onu okuyor, yani
   *    ayrışma kaynağı kurudu. Bugün sorulan üç şey:
   *      1. backend yolu YENİDEN sabit yazmaya dönmedi (regresyon kapısı),
   *      2. sabitin işaret ettiği yol GERÇEK bir rota,
   *      3. eski Türkçe adres için köprü HÂLÂ ayakta (uçuştaki 3DS ödemeleri).
   */
  const CHECKOUT_SERVISI = readFileSync(
    join(DEPO_KOKU, 'apps', 'api', 'src', 'modules', 'checkout', 'checkout.service.ts'),
    'utf8',
  );

  it('backend dönüş yolunu SABİT YAZMIYOR, paylaşılan sabitten okuyor', () => {
    // ⚠️ Kaçış yolu da kapalı: `APP_URL}` ardından `/` ile başlayan bir dizgi
    //    gelmesi, sabitin yeniden gömüldüğü anlamına gelir.
    const gomulu = CHECKOUT_SERVISI.match(/APP_URL\}(\/[a-z/-]+)\?/)?.[1];
    expect(
      gomulu,
      `checkout.service.ts dönüş yolunu yeniden sabit yazmış ('${gomulu}') — @vt/config → CHECKOUT_RESULT_PATH kullanılmalı`,
    ).toBeUndefined();
    expect(CHECKOUT_SERVISI).toContain('CHECKOUT_RESULT_PATH');
  });

  it('paylaşılan dönüş sabiti gerçek bir rota', () => {
    expect(
      rotaVar(tablo, CHECKOUT_RESULT_PATH, true),
      `CHECKOUT_RESULT_PATH ('${CHECKOUT_RESULT_PATH}') rota tablosunda yok`,
    ).toBe(true);
  });

  it('eski Türkçe dönüş adresi için köprü hâlâ ayakta', () => {
    // ⚠️ Bu köprü kaldırıldığında, göç anında 3DS'e gitmiş bir ödemenin
    //    sağlayıcıda tutulan `redirectUrl`ı 404 verir. Kaldırma şartı ZAMANDIR
    //    (bkz. `CHECKOUT_RESULT_LEGACY_PATH` gerekçesi); o gün bu testin de
    //    gerekçesiyle birlikte silinmesi gerekir.
    const kopru = kayitlar.find((k) => k.source === CHECKOUT_RESULT_LEGACY_PATH);
    expect(
      kopru,
      `eski ödeme dönüş adresi '${CHECKOUT_RESULT_LEGACY_PATH}' için next.config'de köprü yok`,
    ).toBeTruthy();
    expect(kopru!.destination).toBe(CHECKOUT_RESULT_PATH);
    expect(rotaVar(tablo, kopru!.destination, true)).toBe(true);
  });
});

/**
 * `alternates.canonical` — SEO YÜZEYİ.
 *
 * ⚠️ Canonical bir `<Link>` değil, o yüzden yukarıdaki taramaya girmiyor; ama
 *    kırıldığında bedeli daha büyük: arama motoruna var olmayan bir adres
 *    bildirilir ve hiçbir kullanıcı akışı bunu göstermez.
 */
describe('canonical adresleri', () => {
  it('yazılı her canonical bir rota ya da rewrite adresi', () => {
    const bulunan: Array<{ dosya: string; deger: string }> = [];

    for (const kokDizin of TARANAN_KOKLER) {
      const yigin = [kokDizin];
      while (yigin.length > 0) {
        const dizin = yigin.pop()!;
        for (const ad of readdirSync(dizin)) {
          const tam = join(dizin, ad);
          if (statSync(tam).isDirectory()) {
            yigin.push(tam);
            continue;
          }
          if (!ad.endsWith('.tsx') && !ad.endsWith('.ts')) continue;
          for (const m of readFileSync(tam, 'utf8').matchAll(/canonical:\s*[`'"](\/[^`'"]*)/g)) {
            bulunan.push({ dosya: tam.slice(DEPO_KOKU.length + 1), deger: m[1]! });
          }
        }
      }
    }

    expect(bulunan.length).toBeGreaterThan(2);

    const kirik = bulunan.filter(({ deger }) => {
      const ifadeBasi = deger.indexOf('${');
      // `canonical: \`/${metin.slug}\`` → sabit önek `/`, yani DOĞRULANAMAZ.
      // Bu değer bilerek rewrite adresini üretiyor; beyaz listeye alınır.
      if (ifadeBasi !== -1) return false;
      return !rotaVar(tablo, deger, true) && !REWRITE_ADRESLERI.includes(deger);
    });

    expect(
      kirik,
      `rotası olmayan canonical: ${kirik.map((k) => `${k.dosya} → ${k.deger}`).join(' · ')}`,
    ).toEqual([]);
  });
});
