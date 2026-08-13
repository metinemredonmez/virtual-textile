/**
 * DEMO ÜRÜN GÖRSELİ ÜRETİCİSİ — bir kez çalışır, çıktısı depoya girer.
 *
 * Çalıştır:  pnpm --filter @vt/db seed:varlik
 *
 * ⚠️ SEED BU BETİĞİ ÇAĞIRMAZ. Seed diskte HAZIR duran dosyayı okur. Ayrım
 *    önemli: görsel seed sırasında üretilseydi "depoda görsel yok ama seed
 *    yeşil" durumu geri gelirdi — eksik dosya ancak seed koşarken fark
 *    edilirdi. Dosya depoda durunca eksikliği `git status` gösterir.
 *
 * ⚠️ NEDEN SENTETİK, NEDEN STOK FOTOĞRAF DEĞİL — ölçüldü, tahmin değil:
 *      sentetik akromatik yer tutucu 1200x1600 webp q82  ≈ 4-6 KB
 *      gürültülü gerçek fotoğraf, aynı ayarla            ≈ 797 KB
 *    56 dosya için fark: ~0,3 MB ile ~44 MB. `.git` bugün 8 MB. Gerçek stok
 *    fotoğrafı depoyu birkaç katına çıkarır ve üstüne bir lisans sorusu açar.
 *    Ayrıca `docs/design-system.md` paletini renkli stok fotoğrafıyla doldurmak
 *    "renk yalnız DURUM taşır" kuralını görsel olarak yalanlardı.
 *
 * ⚠️ picsum/pexels gibi dış adresler ELENDİ: `next.config.ts` → `remotePatterns`
 *    üretim görsel politikasıdır; demo verisi için gevşetilirse seed ve vitrin
 *    dış bir servise bağımlı hâle gelir. Bugün orada duran `images.pexels.com`
 *    kaydı da bu turda gereksizleşiyor (bkz. rapor → BÜTÜNLEMEYE).
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { ACILAR, URUNLER, varlikDosyaAdi, type Siluet } from '../seed/veri.js';

/**
 * ⚠️ `__dirname`, `import.meta.url` DEĞİL. `packages/db/package.json` içinde
 *    `"type": "module"` YOK; tsx bu dosyayı CJS olarak derliyor ve orada
 *    `import.meta` çalışma zamanında patlıyor. Paketi ESM'e çevirmek `dist`i
 *    tüketen apps tarafını da ilgilendirir — seed için ödenecek bir bedel değil.
 */
export const VARLIK_KLASORU = join(__dirname, 'urunler');

const GENISLIK = 1200;
const YUKSEKLIK = 1600;

/**
 * ⚠️ `MEDIA.minProductImageWidth` = 1024. Kaynak 1200 px olmak ZORUNDA; 1024'ün
 *    altına düşerse gerçek yükleme yolundaki kalite kapısı bu görselleri
 *    reddederdi ve demo verisi "uygulamanın kabul etmeyeceği veri" olurdu.
 */

interface Palet {
  readonly zemin: string;
  readonly parca: string;
  readonly cizgi: string;
  readonly yazi: string;
}

/**
 * Ton, slug'dan TÜRETİLİR: aynı ürün her çalıştırmada aynı görseli üretir
 * (dosya farkı gürültüsü olmaz), farklı ürünler ise vitrinde birbirinin
 * kopyası gibi durmaz. Palet akromatik kalır — üretilen tek şey aynı grinin
 * birkaç tonudur.
 */
function palet(slug: string, arka: boolean): Palet {
  const ozet = createHash('sha256').update(slug).digest();
  const kaydir = ozet.readUInt8(0) % 10; // 0-9
  const taban = (arka ? 206 : 216) - kaydir;
  const gri = (deger: number): string => {
    const v = Math.max(0, Math.min(255, deger));
    return `#${v.toString(16).padStart(2, '0').repeat(3)}`;
  };
  return {
    zemin: gri(243 - (ozet.readUInt8(1) % 5)),
    parca: gri(taban),
    cizgi: gri(taban - 24),
    yazi: gri(122),
  };
}

/** Silüetler — 1200x1600 tuvalinde, giysi ~y:380-1320 arasında. */
function siluetYolu(siluet: Siluet, arka: boolean): string {
  switch (siluet) {
    case 'ust':
      return [
        'M480 382 L720 382 L812 424 L900 704 L800 744 L770 662 L770 1198',
        'L430 1198 L430 662 L400 744 L300 704 L388 424 Z',
      ].join(' ');
    case 'alt':
      return 'M402 486 L798 486 L788 1302 L642 1302 L600 782 L558 1302 L412 1302 Z';
    case 'elbise':
      return 'M470 382 L730 382 L800 432 L762 702 L880 1302 L320 1302 L438 702 L400 432 Z';
    case 'dis':
      return [
        'M468 382 L732 382 L832 432 L920 764 L820 804 L790 700 L790 1320',
        'L410 1320 L410 700 L380 804 L280 764 L368 432 Z',
      ].join(' ');
    case 'aksesuar':
      return arka
        ? 'M420 762 Q420 566 600 566 Q780 566 780 762 L862 762 Q862 902 600 902 Q338 902 338 762 Z'
        : 'M420 762 Q420 552 600 552 Q780 552 780 762 L862 762 Q862 908 600 908 Q338 908 338 762 Z';
  }
}

/** Ön/arka farkını taşıyan detay çizgileri — iki açı aynı görünmemeli. */
function detayYolu(siluet: Siluet, arka: boolean): string {
  if (siluet === 'aksesuar') return arka ? 'M338 762 L862 762' : 'M420 700 L780 700';
  if (arka) {
    // Arka: tek dikey orta dikiş.
    const bas = siluet === 'alt' ? 486 : 382;
    const son = siluet === 'dis' ? 1320 : siluet === 'alt' ? 780 : 1198;
    return `M600 ${bas} L600 ${son}`;
  }
  switch (siluet) {
    case 'ust':
      return 'M480 382 Q600 476 720 382';
    case 'alt':
      return 'M402 560 L798 560 M600 560 L600 782';
    case 'elbise':
      return 'M470 382 Q600 486 730 382';
    case 'dis':
      return 'M468 382 Q600 470 732 382 M600 400 L600 1320';
    default:
      return '';
  }
}

function svg(baslik: string, siluet: Siluet, arka: boolean, slug: string): string {
  const p = palet(slug, arka);
  const etiket = arka ? 'ARKA' : 'ÖN';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${GENISLIK}" height="${YUKSEKLIK}" viewBox="0 0 ${GENISLIK} ${YUKSEKLIK}">
  <rect width="${GENISLIK}" height="${YUKSEKLIK}" fill="${p.zemin}"/>
  <path d="${siluetYolu(siluet, arka)}" fill="${p.parca}" stroke="${p.cizgi}" stroke-width="3"/>
  <path d="${detayYolu(siluet, arka)}" fill="none" stroke="${p.cizgi}" stroke-width="3"/>
  <text x="${GENISLIK / 2}" y="1436" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="42" font-weight="500" fill="${p.yazi}">${kacir(baslik)}</text>
  <text x="${GENISLIK / 2}" y="1496" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" letter-spacing="6" fill="${p.yazi}">${etiket} · DEMO GÖRSELİ</text>
</svg>`;
}

/** ⚠️ Ürün başlıkları `&` içerebilir; kaçırılmazsa SVG ayrıştırıcısı patlar. */
function kacir(metin: string): string {
  return metin
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function yerTutucuUret(
  baslik: string,
  siluet: Siluet,
  slug: string,
  arka: boolean,
): Promise<Buffer> {
  return sharp(Buffer.from(svg(baslik, siluet, arka, slug)))
    .webp({ quality: 82 })
    .toBuffer();
}

async function main(): Promise<void> {
  await mkdir(VARLIK_KLASORU, { recursive: true });

  let toplamBayt = 0;
  let sayi = 0;

  for (const urun of URUNLER) {
    for (const aci of ACILAR) {
      const govde = await yerTutucuUret(urun.baslik, urun.siluet, urun.slug, aci === 'BACK');
      const yol = join(VARLIK_KLASORU, varlikDosyaAdi(urun.slug, aci));
      await writeFile(yol, govde);
      toplamBayt += govde.byteLength;
      sayi += 1;
    }
  }

  console.log(
    `✓ ${sayi} yer tutucu görsel üretildi — toplam ${(toplamBayt / 1024).toFixed(1)} KB (ortalama ${(toplamBayt / sayi / 1024).toFixed(1)} KB)`,
  );
  console.log(`  klasör: ${VARLIK_KLASORU}`);
}

// Doğrudan çalıştırıldığında üret; `import` edildiğinde sessiz kal.
if (process.argv[1] && process.argv[1].endsWith('uret.ts')) {
  void main().catch((hata: unknown) => {
    console.error('❌ Yer tutucu üretimi başarısız:', hata);
    process.exitCode = 1;
  });
}
