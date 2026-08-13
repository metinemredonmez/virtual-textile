import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  TEMA_BETIGI,
  TEMA_COOKIE,
  TEMA_COZUM_NITELIGI,
  TEMA_NITELIGI,
  TEMA_SECENEKLERI,
  TEMA_SINIFI,
  TEMA_VARSAYILAN,
  temaCozumle,
} from './tema';

/**
 * TEMA KAPILARI — hepsi DOSYA SİSTEMİ / DİZGİ taraması, render testi değil.
 *
 * ⚠️ Gerekçe AGENTS.md §10: bu depoda jsdom + testing-library BİLEREK kurulu
 *    değil, yani "bileşen çiziliyor mu" testi yok. Buradaki iddialar o boşluğu
 *    doldurmuyor; kapattıkları şey daha dar ve daha ölçülebilir: bir sonraki
 *    kişinin sessizce geri getirebileceği ÜÇ somut gerileme.
 *      1. `.tema-koyu`nun bir kabuk layout'una geri konması (Portal tuzağı).
 *      2. Sabit renk sınıfının geri gelmesi (`bg-black/40` gibi).
 *      3. `:root` ve `.tema-koyu` token kümelerinin ayrışması — koyu temada
 *         tanımsız kalan bir token, açık temadaki değeri MİRAS ALIR ve arıza
 *         "beyaz metin beyaz zeminde" olarak yalnız ekranda görünür.
 *
 * ⚠️ FOUC BU TESTLERLE ÖLÇÜLMEZ ve ölçülemez. `document.documentElement.className`
 *    doğru olduğunu iddia eden bir test 300 ms beyaz flaş varken de YEŞİL yanar.
 *    O ölçüm üretim derlemesi + gerçek tarayıcı + ekran kaydı işidir.
 */

const KOK = join(__dirname, '..', '..');
const GLOBALS = readFileSync(join(KOK, 'app', 'globals.css'), 'utf8');

function dosyalariTara(kok: string, uzantilar: readonly string[]): string[] {
  const cikti: string[] = [];
  const gez = (yol: string): void => {
    for (const ad of readdirSync(yol)) {
      if (ad === 'node_modules' || ad === '.next') continue;
      const tam = join(yol, ad);
      if (statSync(tam).isDirectory()) gez(tam);
      else if (uzantilar.some((u) => ad.endsWith(u))) cikti.push(tam);
    }
  };
  gez(kok);
  return cikti;
}

describe('tema sabitleri', () => {
  it('bilinmeyen değer varsayılana düşer', () => {
    expect(temaCozumle('koyu')).toBe('koyu');
    expect(temaCozumle('dark')).toBe(TEMA_VARSAYILAN);
    expect(temaCozumle(null)).toBe(TEMA_VARSAYILAN);
    expect(temaCozumle('')).toBe(TEMA_VARSAYILAN);
  });

  /**
   * ⚠️ Betik dizgisi sabitlerden ÜRETİLİYOR; bu test o üretimin gerçekten
   *    yapıldığını doğrular. Biri betiği elle yazıp sınıf adını sabitlerse
   *    `globals.css`teki bir yeniden adlandırma sessizce ayrışır ve arıza
   *    yalnız ilk karede görünür.
   */
  it('satır içi betik sabitlerden üretilir', () => {
    expect(TEMA_BETIGI).toContain(TEMA_COOKIE);
    expect(TEMA_BETIGI).toContain(TEMA_SINIFI);
    expect(TEMA_BETIGI).toContain(TEMA_NITELIGI);
    expect(TEMA_BETIGI).toContain(TEMA_COZUM_NITELIGI);
    for (const secenek of TEMA_SECENEKLERI) expect(TEMA_BETIGI).toContain(`"${secenek}"`);
  });

  /**
   * ⚠️ Betik `<script>` İÇİNE ham basılıyor (`dangerouslySetInnerHTML`).
   *    İçinde `</script` geçerse tarayıcı betiği ERKEN kapatır ve sayfanın
   *    geri kalanı metin olarak akar — sayfa tamamen bozulur, `tsc` sessizdir.
   */
  it('betik script etiketini erken kapatamaz', () => {
    expect(TEMA_BETIGI.toLowerCase()).not.toContain('</script');
    expect(TEMA_BETIGI).not.toContain('<!--');
  });

  it('betik tek satır ve senkron — async/defer/await taşımaz', () => {
    expect(TEMA_BETIGI).not.toContain('\n');
    expect(TEMA_BETIGI).not.toMatch(/\bawait\b|\bimport\b|requestAnimationFrame|setTimeout/);
  });
});

describe('globals.css token bütünlüğü', () => {
  const blok = (secici: string): Map<string, string> => {
    const i = GLOBALS.indexOf(`\n${secici} {`);
    expect(i, `${secici} bloğu bulunamadı`).toBeGreaterThan(-1);
    const govde = GLOBALS.slice(i, GLOBALS.indexOf('\n}', i));
    const harita = new Map<string, string>();
    for (const eslesme of govde.matchAll(/^\s{2}(--[a-z-]+):\s*([^;]+);/gm)) {
      const ad = eslesme[1];
      const deger = eslesme[2];
      if (ad !== undefined && deger !== undefined) harita.set(ad, deger.trim());
    }
    return harita;
  };

  /**
   * ⚠️ TEMA BAŞINA DEĞİŞMEYEN TOKENLAR. `.tema-koyu` bunları BİLEREK ezmiyor:
   *    ürün fotoğrafı beyaz fon üzerine çekiliyor ve koyu zeminde kesim
   *    çizgileri kayboluyor. Listeye yeni bir ad eklemek bir KARAR'dır; bu
   *    yüzden test onu görünür kılıyor.
   */
  const DEGISMEYENLER = ['--urun-zemin', '--urun-zemin-metin'];

  it('iki tema aynı token kümesini tanımlar', () => {
    const acik = blok(':root');
    const koyu = blok('.tema-koyu');
    expect(acik.size).toBeGreaterThan(15);

    const eksik = [...acik.keys()].filter((ad) => !koyu.has(ad) && !DEGISMEYENLER.includes(ad));
    const fazla = [...koyu.keys()].filter((ad) => !acik.has(ad));
    expect(eksik, 'koyu temada tanımsız kalan token MİRAS alır — ekranda görünür').toEqual([]);
    expect(fazla, 'yalnız koyu temada var olan token açık temada tanımsız kalır').toEqual([]);
  });

  it('değişmeyen tokenlar koyu temada EZİLMEZ', () => {
    const koyu = blok('.tema-koyu');
    for (const ad of DEGISMEYENLER) {
      expect(koyu.has(ad), `${ad} koyu temada ezilmiş — ürün fotoğrafı çerçevesi koyulaşır`).toBe(
        false,
      );
    }
  });

  it('modal perdesi her iki temada da tanımlı', () => {
    expect(blok(':root').has('--perde')).toBe(true);
    expect(blok('.tema-koyu').has('--perde')).toBe(true);
  });

  it('görsel yedeği kuralları duruyor', () => {
    expect(GLOBALS).toContain('.gorsel-yedek::before');
    expect(GLOBALS).toContain('.gorsel-yedek::after');
    // ⚠️ Ürün adı `attr()` ile geliyor: yedek hidrasyondan ÖNCE çizilmeli,
    //    yani değeri yazabilecek tek yer HTML'in kendisidir.
    expect(GLOBALS).toContain('content: attr(data-yedek-ad)');
  });

  /**
   * ⚠️ İkonun çizgi rengi CSS `url()` içinde SABİT YAZILI (var() giremez) ve
   *    `--urun-zemin-metin` ile aynı olmak zorunda. Token değişip dizgi
   *    kalırsa yedek kutudaki ikon ile ad FARKLI tonda çıkar.
   */
  it('yedek ikonunun rengi --urun-zemin-metin ile aynı', () => {
    const token = blok(':root').get('--urun-zemin-metin');
    expect(token).toBeDefined();
    const kodsuz = token!.replace('#', '').toLowerCase();
    expect(GLOBALS).toContain(`stroke='%23${kodsuz}'`);
  });
});

describe('tema kabuk kuralları', () => {
  const KAYNAKLAR = [
    ...dosyalariTara(join(KOK, 'app'), ['.tsx', '.ts']),
    ...dosyalariTara(join(KOK, 'src'), ['.tsx', '.ts']),
  ];

  it('tarama boşalmadı', () => {
    expect(KAYNAKLAR.length).toBeGreaterThan(150);
  });

  /**
   * ⚠️ BU DEPODAKİ PORTAL TUZAĞININ KAPISI. `.tema-koyu` bir kabuk
   *    layout'una geri konursa `Dialog`/`Sheet` içeriği `document.body`ye
   *    portal edildiği için o kapsamın DIŞINA düşer ve koyu panelde açılan
   *    modal AÇIK temada çizilir. Derleme geçer, `tsc` geçer, ilk kullanan
   *    ekranla birlikte görünür.
   */
  it('tema sınıfı JSX içinde HİÇBİR yerde elle yazılmaz', () => {
    const suclular = KAYNAKLAR.filter((yol) => {
      if (yol.endsWith('tema.ts') || yol.endsWith('tema.test.ts')) return false;
      const icerik = readFileSync(yol, 'utf8');
      // Yorum satırlarında adı geçebilir; aranan şey SINIF DİZGİSİ kullanımı.
      return /className=\{?["'`][^"'`]*\btema-koyu\b/.test(icerik);
    });
    expect(suclular.map((y) => y.slice(KOK.length + 1))).toEqual([]);
  });

  /**
   * ⚠️ Sabit renk sınıfı panelde HİÇ kullanılmaz — hepsi anlamsal token
   *    (AGENTS.md §7). Ölçüldü: bir dönem tüm depoda yalnız İKİ ihlal vardı
   *    (`dialog.tsx` + `sheet.tsx` → `bg-black/40`) ve ikisi de koyu temada
   *    perdeyi görünmez yapıyordu.
   */
  it('sabit renk sınıfı yok', () => {
    const desen =
      /className=\{?[^}]{0,400}?\b(bg-black|bg-white|text-white|text-black|(bg|text|border)-(gray|slate|zinc|neutral|stone)-\d{2,3})\b/;
    const suclular = KAYNAKLAR.filter((yol) => {
      if (yol.endsWith('tema.test.ts')) return false;
      return desen.test(readFileSync(yol, 'utf8'));
    });
    expect(suclular.map((y) => y.slice(KOK.length + 1))).toEqual([]);
  });

  /**
   * ⚠️ FOTOĞRAF ÇERÇEVESİ `--yuzey` DEĞİL `--urun-zemin` TAŞIR, ve fark
   *    yalnızca KOYU temada görünür. `--yuzey` temayla birlikte koyarır;
   *    ürün fotoğrafları beyaz fon üzerine çekildiği için görsel inene kadar
   *    (ve şeffaf PNG'lerde kalıcı olarak) fotoğrafın altında koyu bir zemin
   *    kalır, kesim çizgileri kaybolur — gerekçe `globals.css` başlığında.
   *
   *    Açık temada iki token neredeyse aynı (`#fafafa` ↔ `#f4f4f5`), yani
   *    yanlış yazılmış bir çerçeve açık temada FARK ETMEZ. Bu turda sekiz
   *    çerçeve bu yüzden gözden kaçmıştı; kapı, dokuzuncusu için.
   */
  it('ürün fotoğrafı çerçeveleri --urun-zemin taşır', () => {
    const suclular: string[] = [];
    for (const yol of KAYNAKLAR) {
      if (yol.endsWith('tema.test.ts')) continue;
      const satirlar = readFileSync(yol, 'utf8').split('\n');
      satirlar.forEach((satir, i) => {
        if (satir.includes('aspect-urun') && /\bbg-yuzey\b/.test(satir)) {
          suclular.push(`${yol.slice(KOK.length + 1)}:${i + 1}`);
        }
      });
    }
    expect(suclular, `fotoğraf çerçevesi bg-yuzey taşıyor: ${suclular.join(' · ')}`).toEqual([]);
  });

  /**
   * ⚠️ Kök düzende `cookies()` çağırmak statik rotaları `ƒ`ye düşürür ve
   *    `legal/[belge]`nin `dynamicParams:false` 404 kapısını sessizce
   *    devre dışı bırakır (AGENTS.md §8). Temayı "sunucuda çözelim" diye
   *    düzeltmeye kalkan kişi tam olarak bunu yapar.
   */
  it('kök düzen cookies() çağırmaz ve betiği taşır', () => {
    const kokDuzen = readFileSync(join(KOK, 'app', 'layout.tsx'), 'utf8');
    // ⚠️ Yorumlar SÖKÜLÜYOR: bu dosyanın başlığı zaten "`cookies()` çağrılmaz"
    //    diye yazıyor ve ham metinde arama yapmak testi KENDİ gerekçesine
    //    takılan bir yalancı yapardı.
    const kod = kokDuzen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(kod).not.toMatch(/\bcookies\s*\(/);
    expect(kod).not.toContain('next/headers');
    expect(kod).toContain('TemaBetigi');
    expect(kod).toContain('suppressHydrationWarning');
  });
});
