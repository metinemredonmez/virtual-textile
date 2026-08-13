#!/usr/bin/env node
/**
 * ÇEVİRİ KAPSAM SAYACI — İKİ AYRI İDDİA, TEK ÇEKİM.
 *
 *   A) VARSAYILAN YÜZEY GERÇEKTEN TÜRKÇE Mİ?   (bugün ölçülüyor)
 *   B) İNGİLİZCE YÜZEYDE TÜRKÇE KALDI MI?      (`[locale]` gelince ölçülür)
 *
 * ⚠️ (A) SONRADAN EKLENDİ VE BİR ARIZANIN BEDELİYLE. `src/i18n/request.ts`
 *    içinde ölçüm amacıyla yazılan `localeCoz('en')` satırı yerinde unutuldu;
 *    `<html lang="en">` çıkıyor, TÜM vitrin İngilizce çiziliyordu. `tsc` temiz,
 *    `next build` temiz, 1373 test yeşil. Betiğin o günkü hâli de göremezdi:
 *    yalnız (B)'yi ölçüyordu, yani "Türkçe kelime azaldıkça iyi" sayıyordu —
 *    arıza bu sayacı MÜKEMMEL gösteriyordu. Bir eksikliği ödül olarak okuyan
 *    ölçüm, ölçüm değildir.
 *
 * ⚠️ STATİK TARAMA DEĞİL, ÇALIŞMA ZAMANI ÇEKİMİ. Kaynak koddaki dizgileri
 *    saymak yanıltıcı olurdu: bir metin çevrilmiş olsa da sayfaya çevrilmemiş
 *    hâliyle düşebilir (yanlış sözlük dalı, eksik sağlayıcı, `t()` çağrılmamış
 *    bir bileşen). Ölçülen tek şey KULLANICININ GÖRDÜĞÜ HTML.
 *
 * ⚠️ SESSİZ BOŞALMAYA KARŞI ALT SINIR. Sayfa 200 dönmezse ya da gövde boşsa
 *    "sıfır Türkçe kelime" çıkar ve sayaç mükemmel görünür. Bu yüzden her
 *    sayfada hem durum kodu hem asgari gövde uzunluğu doğrulanıyor; biri
 *    tutmazsa betik HATA ile çıkar.
 *
 * KULLANIM:
 *   node scripts/i18n-kapsam.mjs [kok]          (varsayılan http://localhost:3000)
 *
 * ⚠️ ÜRETİM DERLEMESİ ÜZERİNDE ÇALIŞTIRILIR (`next build && next start`).
 *    `next dev` ölçümü bu depoda KANIT SAYILMAZ (AGENTS.md §8/§12).
 */

const KOK = process.argv[2] ?? 'http://localhost:3000';

/** Ölçülen yüzey. Yeni bir ekran çevrildiğinde buraya satır eklenir. */
const YOLLAR = ['/', '/products', '/calculator', '/collection', '/cart', '/login'];

/** Gövdenin gerçekten dolu olduğunun alt sınırı — boş yanıt "temiz" sayılmasın. */
const ASGARI_GOVDE = 500;

/**
 * ⚠️ VARSAYILAN YÜZEYDE BEKLENEN EN AZ TÜRKÇE KELİME. Sıfır olamaz: bir sayfa
 *    Türkçe çiziliyorsa mutlaka Türkçeye özgü harf taşıyan kelimeler içerir
 *    (ekranların hepsinde en az gezinme çubuğu var). Sayı DÜŞÜK tutuldu çünkü
 *    iddia "çok Türkçe var" değil, "dil hiç devrilmemiş".
 *
 * ⚠️ BU YARIM BUGÜN YÜK TAŞIMIYOR — ve bunu bilmek önemli. KONTROL KOŞUSUNDA
 *    ölçüldü: dil kasten `en`e devrildiğinde kelime sayıları DEĞİŞMEDİ
 *    (`/` 22 · `/calculator` 178), çünkü metinlerin ~%85'i hâlâ JSX'e gömülü
 *    Türkçe. Arızayı yakalayan tek şey `<html lang>` yarısı oldu.
 *    Kapsam büyüdükçe bu yarım da yük taşımaya başlayacak; ikisi birlikte
 *    duruyor ki o gün geldiğinde eklenmesi gereken bir şey kalmasın.
 */
const ASGARI_TURKCE = 5;

const TURKCE_HARF = /[ÇĞİÖŞÜçğış]/;

function govdeMetni(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function turkceKelimeler(html) {
  const metin = govdeMetni(html);
  const bulunan = new Set();
  for (const kelime of metin.match(/[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/g) ?? []) {
    if (TURKCE_HARF.test(kelime)) bulunan.add(kelime);
  }
  return [...bulunan].sort();
}

/** `<html lang="…">` — dilin OTORİTESİNİN sayfada göründüğü tek yer. */
function htmlDili(html) {
  return html.match(/<html[^>]*\slang="([^"]+)"/i)?.[1] ?? null;
}

let hata = false;

async function cek(yol) {
  let yanit;
  try {
    yanit = await fetch(KOK + yol, { redirect: 'manual' });
  } catch (sebep) {
    console.error(`✗ ${yol} — sunucuya ulaşılamadı: ${sebep.message}`);
    hata = true;
    return null;
  }

  const html = await yanit.text();

  // ⚠️ 200 DIŞI DA BİR SONUÇTUR: 307 (oturum kapısı) beklenen, 404/500 değil.
  if (yanit.status >= 400) {
    console.error(`✗ ${yol} — HTTP ${yanit.status}`);
    hata = true;
    return null;
  }
  if (yanit.status === 200 && html.length < ASGARI_GOVDE) {
    console.error(`✗ ${yol} — gövde ${html.length} bayt, tarama boşalmış olabilir`);
    hata = true;
    return null;
  }

  return { html, durum: yanit.status };
}

// ══════════════════ A) VARSAYILAN YÜZEY GERÇEKTEN TÜRKÇE Mİ ═══════════════════

console.log(`i18n kapsam sayacı — ${KOK}\n`);
console.log('A) VARSAYILAN YÜZEY — dil devrilmemiş mi?\n');

for (const yol of YOLLAR) {
  const cikti = await cek(yol);
  if (!cikti) continue;

  const dil = htmlDili(cikti.html);
  const turkce = turkceKelimeler(cikti.html);

  /**
   * ⚠️ İKİ AYRI İDDİA, VE İKİSİ DE GEREKLİ. Yalnız `<html lang>` bakılsaydı
   *    "lang=tr ama içerik İngilizce" durumu kaçardı; yalnız kelime sayılsaydı
   *    `lang` yanlışken içerik doğru olan (ekran okuyucuyu yanıltan) durum
   *    kaçardı. Arızanın ilk hâli TAM OLARAK ikisini birden devirmişti.
   */
  const dilTamam = dil === 'tr';
  const icerikTamam = cikti.durum !== 200 || turkce.length >= ASGARI_TURKCE;

  if (!dilTamam || !icerikTamam) {
    console.error(
      `✗ ${yol.padEnd(14)} lang="${dil}" · Türkçe kelime ${turkce.length}` +
        (dilTamam ? '' : '  ← <html lang> "tr" DEĞİL') +
        (icerikTamam ? '' : '  ← içerik Türkçe görünmüyor'),
    );
    hata = true;
  } else {
    console.log(`✓ ${yol.padEnd(14)} lang="${dil}" · Türkçe kelime ${turkce.length}`);
  }
}

// ═════════════════ B) İNGİLİZCE YÜZEYDE TÜRKÇE KALDI MI ══════════════════════

console.log('\nB) İNGİLİZCE YÜZEY — çevrilmemiş kalan\n');

/**
 * ⚠️ SONDA `cek()` İLE YAPILMAZ: o fonksiyon 404'ü hata sayar ve `hata`
 *    bayrağını kaldırır. Burada 404 BEKLENEN durum — `[locale]` segmenti ayrı
 *    bir kartın işi ve henüz inmedi. Sondanın kendi çekimi var.
 */
const enVar = await (async () => {
  try {
    return (await fetch(`${KOK}/en`, { redirect: 'manual' })).status !== 404;
  } catch {
    return false;
  }
})();

/**
 * ⚠️ "YÜZEY YOK" DURUMU BAŞARI SAYILMAZ, AMA HATA DA SAYILMAZ. Buraya
 *    "0 çevrilmemiş kelime" yazmak, hiç ölçülmemiş bir şeyi tamamlanmış
 *    göstermek olurdu — bu deponun tam olarak kaçındığı şey.
 */
if (!enVar) {
  console.log('   ⊘ `/en` yok — `[locale]` segmenti henüz inmedi, ölçüm YAPILMADI.');
  console.log('     Bu bir başarı değil, ÖLÇÜLMEMİŞ bir alandır (docs/i18n.md → Açık uçlar).');
  process.exit(hata ? 1 : 0);
}

let toplam = 0;
for (const yol of YOLLAR) {
  const cikti = await cek('/en' + (yol === '/' ? '' : yol));
  if (!cikti) continue;

  const kalan = turkceKelimeler(cikti.html);
  toplam += kalan.length;
  const ornek = kalan.slice(0, 6).join(', ');
  console.log(
    `${kalan.length === 0 ? '✓' : ' '} ${('/en' + yol).padEnd(16)} çevrilmemiş: ` +
      `${String(kalan.length).padStart(4)}` +
      (ornek ? `   ${ornek}${kalan.length > 6 ? ' …' : ''}` : ''),
  );
}

console.log(`\nTOPLAM ÇEVRİLMEMİŞ KELİME: ${toplam}`);
console.log(
  toplam === 0
    ? 'Kapsam tamam. `/en` artık `noindex` olmaktan çıkabilir ve dil anahtarı menüye konabilir.'
    : 'Bu sayı HER TURDA KÜÇÜLMELİ. Sıfırlanana kadar `/en` `noindex` kalır ve dil\n' +
        'anahtarı menüye KONMAZ — yarım çevrilmiş bir dili açmak, bu deponun\n' +
        '"derleniyor = çalışıyor" hatasının dil eksenindeki hâli olurdu.',
);

process.exit(hata ? 1 : 0);
