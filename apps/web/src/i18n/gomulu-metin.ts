import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * JSX'E GÖMÜLÜ TÜRKÇE METİN SAYACI — ERTELEMENİN ÖLÇÜM ALETİ.
 *
 * ⚠️ NEDEN VAR. `docs/i18n.md` §8.A metinlerin büyük kısmını bilerek erteliyor
 *    ve ertelemeyi bir ŞARTA bağlıyor: "her turda koşulur ve SAYI KÜÇÜLÜR".
 *    O şartın aleti YOKTU. `scripts/i18n-kapsam.mjs` çalışma zamanında
 *    VARSAYILAN yüzeyi ölçüyor — yani Türkçe metin orada bir ARIZA değil,
 *    beklenen şey; kaç metnin hâlâ sözlük dışında olduğunu göremez.
 *    Şartını ölçmeyen erteleme, erteleme değil unutmadır — ve bu depo aynı
 *    sınıfı altı kez yaşadı ("derleniyor" ile "çalışıyor"un karıştırılması).
 *
 * ⚠️ SAYAÇ KABA VE KABA OLDUĞU YAZILI. Bir AST kurup JSX metin düğümlerini
 *    tam saymıyor; düzenli ifadeyle metin taşıyan iki yeri okuyor (JSX metin
 *    düğümü ve metin taşıyan nitelikler). Yanlış pozitif de yanlış negatif de
 *    üretir. İDDİASI MUTLAK DEĞİL, YÖNSEL: "bu sayı artmadı". Bir tavan
 *    (`TAVAN`) ile birlikte kullanılır; mutlak doğruluğu değil, MONOTONLUĞU
 *    taşır. Bu yüzden tavan düşürülebilir, yükseltilemez.
 *
 * ⚠️ TÜRKÇEYE ÖZGÜ HARF ARANIYOR, "metin var mı" DEĞİL. `<p>OK</p>` ya da
 *    `alt=""` gibi dilden bağımsız şeyler sayılmasın diye; ölçülen şey
 *    "sözlüğe taşınmayı bekleyen TÜRKÇE cümle". Bedeli dürüstçe: Türkçeye
 *    özgü harf taşımayan Türkçe metinler (`Ara`, `Kaydet`, `Toplam`)
 *    SAYILMAZ, yani gerçek borç bu sayıdan BÜYÜKTÜR.
 */

const TURKCE_HARF = /[çğıİşöüÇĞŞÖÜ]/;

/** Metin taşıyan nitelikler — görünür metnin JSX düğümü dışındaki tek yeri. */
const METIN_NITELIKLERI = /\b(?:placeholder|title|aria-label|alt|label)\s*=\s*["']([^"']{2,})["']/g;

/** `>metin<` — JSX metin düğümü. İfade (`{...}`) içerenler dışarıda kalır. */
const JSX_METIN = />([^<>{}]{2,})</g;

/**
 * TIRNAK İÇİ DİZGİ — `.ts` dosyalarındaki etiket tablolarının yaşadığı yer.
 *
 * ⚠️ BU TARAMA SONRADAN EKLENDİ VE SEBEBİ ÖLÇÜLDÜ. Sayaç bir süre YALNIZ
 *    `.tsx` okuyordu, gerekçesi olarak da "görünür metin JSX'te yaşıyor"
 *    yazılıydı — bu depoda o iddia YANLIŞ. Kullanıcının GÖRDÜĞÜ 250 metin
 *    `.ts` etiket tablolarında duruyor (`collection/koleksiyonlar.ts` 48,
 *    `seller/finance/_lib/etiketler.ts` 25, `admin/_finans/etiketler.ts` 20,
 *    `seller/products/_lib/durum.ts` 15 …) ve `AGENTS.md` §0 tablosu o
 *    dosyaları zaten "metin tek yeri" diye işaret ediyor.
 *
 * ⚠️ ASIL BEDELİ SAYIDA DEĞİL, CIRCIRIN KENDİSİNDEYDİ: bir JSX metnini `.ts`
 *    içinde bir sabite taşımak, TEK SATIR çeviri yapmadan sayacı düşürüyordu.
 *    Yani "tavanı büyütme" uyarısının kapatmaya çalıştığı davranışın ucuz hâli
 *    açıktı. İki uzantı birlikte sayıldığı an taşıma sayacı DEĞİŞTİRMEZ.
 */
const TS_DIZGI = /(['"])((?:[^'"\\\n]|\\.){2,}?)\1/g;

/**
 * ⚠️ SÖZLÜĞÜN KENDİSİ BORÇ DEĞİL, BORCUN VARIŞ YERİ. `sozluk/tr.ts` taranırsa
 *    çevrilmiş her metin "çevrilmemiş" sayılır ve sayaç, doğru davranışı
 *    cezalandırır. Dışlanan tek yer burası — geniş bir "i18n klasörü" muafiyeti
 *    yazılsaydı bir sonraki tur metni oraya taşıyarak sayacı düşürebilirdi.
 */
const SOZLUK_YOLU = /(?:^|[\\/])i18n[\\/]sozluk[\\/]/;

/**
 * ⚠️ YORUMLAR SÖKÜLÜR. Bu depoda yorumlar Türkçe ve GEREKÇE taşıyor; sayılsaydı
 *    sayacı düşürmenin en kolay yolu gerekçeyi silmek olurdu. Bir ölçüm,
 *    iyileştirmenin en ucuz yolunu "belgeyi sil"e çeviriyorsa ölçüm değildir.
 */
function yorumlariAt(kaynak: string): string {
  return kaynak
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

export type GomuluMetin = { dosya: string; metin: string };

/** Sayının hangi uzantıdan geldiği — taşımayla düşürme denemesini görünür kılar. */
export interface BorcOzeti {
  readonly toplam: number;
  readonly tsx: number;
  readonly ts: number;
}

export function borcOzeti(bulunan: readonly GomuluMetin[]): BorcOzeti {
  const tsx = bulunan.filter((b) => b.dosya.endsWith('.tsx')).length;
  return { toplam: bulunan.length, tsx, ts: bulunan.length - tsx };
}

function dosyalariGez(kok: string, isle: (tam: string) => void): void {
  for (const ad of readdirSync(kok)) {
    if (ad === 'node_modules' || ad === '.next' || ad === 'dist') continue;
    const tam = join(kok, ad);
    if (statSync(tam).isDirectory()) {
      dosyalariGez(tam, isle);
      continue;
    }
    // `.ts` ve `.tsx` birlikte — gerekçe `TS_DIZGI` başlığında. Test dosyaları
    // BEKLENTİ taşır, borç değil; sözlüğün kendisi borcun VARIŞ yeri.
    if (!/\.tsx?$/.test(ad) || /\.test\.tsx?$/.test(ad)) continue;
    if (SOZLUK_YOLU.test(tam)) continue;
    isle(tam);
  }
}

/** Verilen köklerdeki sözlüğe taşınmamış Türkçe metinler. */
export function gomuluMetinler(kokler: readonly string[], kokUzunlugu: number): GomuluMetin[] {
  const bulunan: GomuluMetin[] = [];

  for (const kok of kokler) {
    dosyalariGez(kok, (tam) => {
      const kaynak = yorumlariAt(readFileSync(tam, 'utf8'));
      const dosya = tam.slice(kokUzunlugu);
      // Aynı metin bir dosyada iki kez geçebilir; çeviri BİRİMİ tektir.
      const gorulen = new Set<string>();

      const ekle = (ham: string): void => {
        const metin = ham.trim();
        if (metin.length < 2 || !TURKCE_HARF.test(metin)) return;
        if (gorulen.has(metin)) return;
        gorulen.add(metin);
        bulunan.push({ dosya, metin });
      };

      if (tam.endsWith('.tsx')) {
        for (const m of kaynak.matchAll(JSX_METIN)) ekle(m[1]!);
        for (const m of kaynak.matchAll(METIN_NITELIKLERI)) ekle(m[1]!);
      } else {
        for (const m of kaynak.matchAll(TS_DIZGI)) ekle(m[2]!);
      }
    });
  }

  return bulunan;
}
