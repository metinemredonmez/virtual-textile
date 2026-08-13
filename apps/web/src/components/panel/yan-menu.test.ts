import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEB_KOKU, baglantilariTopla, rotaTablosu, rotaVar } from '@/rota/rota-tablosu';

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
 * ⚠️ ROTA TARAMASI VE BAĞLANTI TARAMASI ARTIK BU DOSYADA DEĞİL:
 *    `src/rota/rota-tablosu.ts`. Rota göçünde ikinci bir tarayıcı yazılsaydı
 *    (bu dosyanın eski hâli kendi `rotalar()` ve `sabitBaglantilar()`ını
 *    taşıyordu) `(magaza)` kapsama alınırken biri güncellenir diğeri
 *    bayatlardı — bu depoda ölçülmüş bir olay (`AGENTS.md` §0). Buradaki iş
 *    yalnızca MENÜ DİZİLERİ ile tablonun karşılaştırılması.
 */

const tablo = rotaTablosu();
const rotaDesenleri = new Set(tablo.map((r) => r.desen));

/** `yol: '/seller/products'` satırlarını çeker. `yol: null` (yakında) atlanır. */
function menuYollari(dosya: string): string[] {
  const kaynak = readFileSync(join(WEB_KOKU, dosya), 'utf8');
  return [...kaynak.matchAll(/yol: '([^']+)'/g)].map((eslesme) => eslesme[1]!);
}

const MENULER = [
  { ad: 'satıcı', dosya: 'app/(satici)/layout.tsx', onek: '/seller' },
  { ad: 'yönetim', dosya: 'app/(yonetim)/admin/_kabuk/yan-menu.tsx', onek: '/admin' },
] as const;

describe('panel menüsü ↔ rota tablosu', () => {
  it('rota taraması gerçekten çalışıyor (testin kendisi sessizce boşalmasın)', () => {
    // ⚠️ Bu iddia olmadan, tablo boş dönerse aşağıdaki testlerin HEPSİ boş
    //    döngü olur ve yeşil geçer — testin var olmamasıyla aynı şey.
    expect(rotaDesenleri.size).toBeGreaterThan(15);
    expect(rotaDesenleri).toContain('/seller');
    expect(rotaDesenleri).toContain('/admin');
  });

  for (const menu of MENULER) {
    it(`${menu.ad}: menüdeki her bağlantının bir sayfası var`, () => {
      const yollar = menuYollari(menu.dosya);
      expect(yollar.length).toBeGreaterThan(0);

      const olmayan = yollar.filter((yol) => !rotaVar(tablo, yol, true));
      // ⚠️ Mesaj yolu YAZAR: "false !== true" diyen bir hata, hangi bağlantının
      //    kırık olduğunu söylemez ve düzeltmek için testi okumak gerekir.
      expect(olmayan, `menüde var, sayfası yok: ${olmayan.join(', ')}`).toEqual([]);
    });

    it(`${menu.ad}: yazılmış her üst düzey sayfa menüden ulaşılabiliyor`, () => {
      const yollar = new Set(menuYollari(menu.dosya));

      const ulasilamaz = [...rotaDesenleri].filter((rota) => {
        if (!rota.startsWith(menu.onek)) return false;
        // Dinamik detay rotaları listeden açılır, menüde satırı olmaz.
        if (rota.includes('[')) return false;
        if (yollar.has(rota)) return false;
        // Alt sayfa (ör. `/seller/products/new`) üst satırıyla kapsanır.
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
 * ⚠️ MENÜ TESTİNİN YAPISAL KÖR NOKTASI: yalnız MENÜ dizilerini (`yol: '…'`)
 *    tarıyordu. Panonun kartlarındaki `href` alanına hiç bakmıyordu ve arıza
 *    tam orada yaşandı: yönetim panosunun payout kartı `href: null` taşıyordu
 *    ve ekranda "Payout ekranı yok" yazıyordu — sayfa YAZILMIŞ, sol menüde
 *    DURUYOR ve `next build` rota tablosunda satırı varken.
 *
 * ⚠️ Depo genelindeki kırık bağlantı iddiası `src/rota/rota-tablosu.test.ts`te.
 *    Buradaki iddia PANEL BÖLGESİNE ÖZGÜ ve kapsamın daralmadığını ölçüyor:
 *    panel ekranları en az bu kadar bağlantı taşımalı.
 */
describe('panel ekranlarındaki sabit bağlantılar ↔ rota tablosu', () => {
  for (const grup of ['(satici)', '(yonetim)'] as const) {
    it(`${grup}: ekranlarda yazılı her sabit bağlantının bir sayfası var`, () => {
      const baglantilar = baglantilariTopla([join(WEB_KOKU, 'app', grup)]);

      // ⚠️ Tarama sessizce boşalmasın: bu grup altında en az bir avuç sabit
      //    bağlantı olmalı, yoksa test var olmamasıyla aynı şey.
      expect(baglantilar.length).toBeGreaterThan(10);

      const kirik = baglantilar.filter((b) => !rotaVar(tablo, b.yol, !b.onek));

      expect(
        kirik,
        `sayfası olmayan bağlantı: ${kirik.map((k) => `${k.dosya} → ${k.ham}`).join(' · ')}`,
      ).toEqual([]);
    });
  }
});
