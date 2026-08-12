import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MENÜ ↔ ROTA TABLOSU SAPMA TESTİ.
 *
 * ⚠️ BU TEST BİR ÜSLUP DENETİMİ DEĞİL, BU DEPODA ÜÇ KEZ YAŞANMIŞ BİR ARIZANIN
 *    KAPISI. İki yönü de ayrı ayrı gerçekleşti:
 *      • Bir dönem panel kabuklarında YEDİ bağlantı vardı ve yedisi de 404
 *        veriyordu — sayfalar hiç yazılmamıştı (`AGENTS.md` §10).
 *      • Üç kez de tersi oldu: ekran yazıldı, derlendi, testler yeşildi ve
 *        hiçbir yerden çağrılmadı (§9.9).
 *    İkisi de "derleniyor" ile "çalışıyor"un karıştırılmasıydı: TypeScript
 *    `href` dizgisini doğrulamaz, `next build` de menüde olmayan rotayı
 *    şikâyet etmez.
 *
 * ⚠️ KAYNAK DOSYA SİSTEMİ, uydurma bir liste değil. Menü dizileri
 *    `layout.tsx` / `yan-menu.tsx` içinden okunuyor, rotalar `app/**\/page.tsx`
 *    taranarak çıkarılıyor. Sabit bir beklenen liste yazılsaydı üçüncü bir
 *    senkron tutulacak yer doğardı — testin kendisi.
 */

const WEB_KOKU = join(__dirname, '..', '..', '..');
const APP = join(WEB_KOKU, 'app');

/** `yol: '/satici/urunler'` satırlarını çeker. `yol: null` (yakında) atlanır. */
function menuYollari(dosya: string): string[] {
  const kaynak = readFileSync(join(WEB_KOKU, dosya), 'utf8');
  return [...kaynak.matchAll(/yol: '([^']+)'/g)].map((eslesme) => eslesme[1]!);
}

/**
 * `app/**\/page.tsx` → URL yolu.
 *
 * ⚠️ Rota grupları (`(satici)`, `(magaza)`) URL'ye GİRMEZ; ayıklanmazsa her yol
 *    yanlış çıkar ve test hep kırmızı olur.
 */
function rotalar(): Set<string> {
  const bulunan = new Set<string>();

  const gez = (dizin: string, parcalar: string[]): void => {
    for (const ad of readdirSync(dizin)) {
      const tam = join(dizin, ad);
      if (statSync(tam).isDirectory()) {
        // `_lib` / `_bilesenler` rota üretmez; `(grup)` URL'ye girmez.
        if (ad.startsWith('_')) continue;
        gez(tam, ad.startsWith('(') ? parcalar : [...parcalar, ad]);
      } else if (ad === 'page.tsx') {
        bulunan.add(`/${parcalar.join('/')}` === '/' ? '/' : `/${parcalar.join('/')}`);
      }
    }
  };

  gez(APP, []);
  return bulunan;
}

const MENULER = [
  { ad: 'satıcı', dosya: 'app/(satici)/layout.tsx', onek: '/satici' },
  { ad: 'yönetim', dosya: 'app/(yonetim)/yonetim/_kabuk/yan-menu.tsx', onek: '/yonetim' },
] as const;

describe('panel menüsü ↔ rota tablosu', () => {
  const tumRotalar = rotalar();

  it('rota taraması gerçekten çalışıyor (testin kendisi sessizce boşalmasın)', () => {
    // ⚠️ Bu iddia olmadan, `rotalar()` boş küme dönerse aşağıdaki testlerin
    //    HEPSİ boş döngü olur ve yeşil geçer — testin var olmamasıyla aynı şey.
    expect(tumRotalar.size).toBeGreaterThan(15);
    expect(tumRotalar).toContain('/satici');
    expect(tumRotalar).toContain('/yonetim');
  });

  for (const menu of MENULER) {
    it(`${menu.ad}: menüdeki her bağlantının bir sayfası var`, () => {
      const yollar = menuYollari(menu.dosya);
      expect(yollar.length).toBeGreaterThan(0);

      const olmayan = yollar.filter((yol) => !tumRotalar.has(yol));
      // ⚠️ Mesaj yolu YAZAR: "false !== true" diyen bir hata, hangi bağlantının
      //    kırık olduğunu söylemez ve düzeltmek için testi okumak gerekir.
      expect(olmayan, `menüde var, sayfası yok: ${olmayan.join(', ')}`).toEqual([]);
    });

    it(`${menu.ad}: yazılmış her üst düzey sayfa menüden ulaşılabiliyor`, () => {
      const yollar = new Set(menuYollari(menu.dosya));

      const ulasilamaz = [...tumRotalar].filter((rota) => {
        if (!rota.startsWith(menu.onek)) return false;
        // Dinamik detay rotaları listeden açılır, menüde satırı olmaz.
        if (rota.includes('[')) return false;
        if (yollar.has(rota)) return false;
        // Alt sayfa (ör. `/satici/urunler/yeni`) üst satırıyla kapsanır.
        const ust = rota.split('/').slice(0, 3).join('/');
        return !yollar.has(ust);
      });

      expect(ulasilamaz, `sayfası var, menüde yok: ${ulasilamaz.join(', ')}`).toEqual([]);
    });
  }
});

/**
 * PANEL EKRANLARINDAKİ SABİT BAĞLANTILAR ↔ ROTA TABLOSU.
 *
 * ⚠️ YUKARIDAKİ TESTİN YAPISAL KÖR NOKTASI: yalnız MENÜ dizilerini
 *    (`yol: '…'`) tarıyordu. Panonun kartlarındaki `href` alanına hiç
 *    bakmıyordu ve arıza tam orada yaşandı: yönetim panosunun payout kartı
 *    `href: null` taşıyordu ve ekranda "Payout ekranı yok; karar bugün API
 *    üzerinden veriliyor." yazıyordu — `app/(yonetim)/yonetim/payout/page.tsx`
 *    YAZILMIŞ, sol menüde DURUYOR ve `next build` rota tablosunda `ƒ` satırı
 *    varken. Yöneticinin gördüğü ilk ekran, var olan bir karar kuyruğuna giden
 *    kısayolu kapatıp üstüne yanlış bir cümle basıyordu; menü testi yeşildi.
 *
 * ⚠️ Şablon dizgileri (`` `/satici/urunler/${id}` ``) TARANMIYOR: değeri
 *    çalışma zamanında belli ve dinamik rota zaten `[id]` olarak tabloda.
 *    Taranan şey SABİT yazılmış her iç bağlantı.
 */
function sabitBaglantilar(kok: string): Array<{ dosya: string; href: string }> {
  const bulunan: Array<{ dosya: string; href: string }> = [];

  const gez = (dizin: string): void => {
    for (const ad of readdirSync(dizin)) {
      const tam = join(dizin, ad);
      if (statSync(tam).isDirectory()) {
        gez(tam);
        continue;
      }
      if (!ad.endsWith('.tsx')) continue;

      const kaynak = readFileSync(tam, 'utf8');
      // `href="/..."`, `href: '/...'`, `href={'/...'}` — üç yazım da geçiyor.
      for (const eslesme of kaynak.matchAll(/href[=:]\s*\{?\s*['"](\/[^'"]*)['"]/g)) {
        bulunan.push({ dosya: tam.slice(kok.length + 1), href: eslesme[1]! });
      }
    }
  };

  gez(kok);
  return bulunan;
}

describe('panel ekranlarındaki sabit bağlantılar ↔ rota tablosu', () => {
  const tumRotalar = rotalar();

  for (const grup of ['(satici)', '(yonetim)'] as const) {
    it(`${grup}: ekranlarda yazılı her sabit bağlantının bir sayfası var`, () => {
      const baglantilar = sabitBaglantilar(join(APP, grup));

      // ⚠️ Tarama sessizce boşalmasın: bu grup altında en az bir sabit
      //    bağlantı olmalı, yoksa test var olmamasıyla aynı şey.
      expect(baglantilar.length).toBeGreaterThan(3);

      const kirik = baglantilar.filter(({ href }) => {
        // Sorgu ve çapa rotanın parçası değil.
        const yol = href.split('?')[0]!.split('#')[0]!.replace(/\/$/, '') || '/';
        return !tumRotalar.has(yol);
      });

      expect(
        kirik,
        `sayfası olmayan bağlantı: ${kirik.map((k) => `${k.dosya} → ${k.href}`).join(' · ')}`,
      ).toEqual([]);
    });
  }
});
