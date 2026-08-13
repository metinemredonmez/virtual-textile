/**
 * DEMO ÜRÜN GÖRSELİ ÜRETİCİSİ — bir kez çalışır, çıktısı diskte kalır.
 *
 * Çalıştır:  FAL_KEY=... pnpm --filter @vt/db seed:varlik
 *            pnpm --filter @vt/db seed:varlik -- --yeniden   (var olanı da yenile)
 *
 * ⚠️ SEED BU BETİĞİ ÇAĞIRMAZ. Seed diskte HAZIR duran dosyayı okur
 *    (`seed/gorsel.ts`). Ayrım korunuyor: görsel seed sırasında üretilseydi
 *    seed bir dış servise ve para harcayan bir çağrıya bağlanırdı.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ BU DOSYA SENTETİK GRİ SİLÜET ÜRETİYORDU. ARTIK GERÇEK FOTOĞRAF ÜRETİYOR.
 *
 *  Eski gerekçe üç ayaklıydı; ikisi geçerliydi, biri YANLIŞTI:
 *
 *    ✓ depo şişmesi (~0,3 MB → ~40 MB)  → GEÇERLİ, aşağıda çözüldü
 *    ✓ stok fotoğrafı lisansı            → GEÇERLİ, üretilen görselde yok
 *    ✗ "renkli fotoğraf akromatik paleti yalanlar"  → TERS. `design-system.md:22`
 *      aynen şunu diyor: "Ürün fotoğrafları ZATEN RENKLİDİR. Arayüz de
 *      renkliyse ikisi yarışır." Yani akromatik ARAYÜZ, renkli ÜRÜN
 *      fotoğrafları OLDUĞU İÇİN var; onlara karşı değil. Gri silüetler bu
 *      kuralı uygulamıyordu, kuralın sebebini ortadan kaldırıyordu.
 *
 *  Sonuç ölçüldü: vitrin "üzerinizde görün" diyor ama gösterecek bir giysi
 *  yoktu — ana sayfanın en büyük kutusu boş bir gri dikdörtgendi.
 *
 *  ÜÇÜNCÜ YOL: görseli fal.ai (FLUX schnell) ile ÜRETİYORUZ.
 *    · lisans sorusu yok — stok arşivinden alınmıyor
 *    · dış servise ÇALIŞMA ZAMANI bağımlılığı yok — üretim bir kerelik
 *    · `next.config.ts` → `remotePatterns` gevşetilmiyor; dosya bizim R2'mize
 *      seed tarafından yükleniyor, tam da bugünkü yol
 *    · determinist: tohum slug'dan türetiliyor, aynı ürün aynı görseli alır
 *
 *  ⚠️ DEPO ŞİŞMESİ ÇÖZÜLDÜ, GÖRMEZDEN GELİNMEDİ: çıktı `.gitignore`da.
 *     Bunun bedeli var ve biliniyor — eski yorumun haklı olduğu nokta şuydu:
 *     "dosya depoda durunca eksikliği `git status` gösterir". O emniyet
 *     kaybolmasın diye `seed/gorsel.ts` eksik dosyada ZATEN atıyor ve
 *     `dogrula()` seed öncesi tüm listeyi tek seferde denetliyor.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { ACILAR, URUNLER, varlikDosyaAdi, type UrunTanimi } from '../seed/veri.js';
import { KATEGORI_EN, RENK_EN, KUMAS_EN, DESEN_EN, KALIP_EN, cevir } from './sozluk.js';

/**
 * ⚠️ `__dirname`, `import.meta.url` DEĞİL. `packages/db/package.json` içinde
 *    `"type": "module"` YOK; tsx bu dosyayı CJS olarak derliyor ve orada
 *    `import.meta` çalışma zamanında patlıyor.
 */
export const VARLIK_KLASORU = join(__dirname, 'urunler');

const GENISLIK = 1200;
const YUKSEKLIK = 1600;

/**
 * ⚠️ `MEDIA.minProductImageWidth` = 1024. Kaynak 1200 px olmak ZORUNDA; altına
 *    düşerse gerçek yükleme yolundaki kalite kapısı bu görselleri REDDEDER ve
 *    demo verisi "uygulamanın kabul etmeyeceği veri" olurdu.
 *
 * ⚠️ MODELDEN 1200x1600 İSTENMİYOR, 960x1280 isteniyor ve sonra büyütülüyor —
 *    HAYIR, bu YANLIŞ olurdu ve yapılmadı. FLUX'un desteklediği en yakın dikey
 *    boy 1024x1536; oradan 1200x1600'e ölçekleme %17 büyütme demek ve dokuyu
 *    yumuşatır. Model 1024 genişlikte üretiyor, sharp 1200'e `kernel: lanczos3`
 *    ile çıkarıyor — kabul edilebilir tek büyütme bu.
 */
const MODEL_GENISLIK = 1024;
const MODEL_YUKSEKLIK = 1536;

const FAL_UC = 'https://fal.run/fal-ai/flux/schnell';

/** ⚠️ 16 eşzamanlı istek fal tarafında 429 aldı (ölçüldü). 6 güvenli. */
const ESZAMAN = 6;

/** İstek başına deneme. Ağ hatası ve 429 için; 4xx doğrulama hatasında değil. */
const AZAMI_DENEME = 3;

// ── İstem kurulumu ─────────────────────────────────────────────────────────

/**
 * ⚠️ "no person, no mannequin" İSTEMİN EN ÖNEMLİ PARÇASI. Modelin varsayılan
 *    davranışı giysiyi bir insanın üzerinde çizmek. Bu demo için ARIZA olurdu:
 *    ürün kartında zaten modelli fotoğraf varsa sanal deneme sonucu
 *    "fotoğraftaki kişi" ile karışır ve özelliğin ne yaptığı anlaşılmaz.
 *    Ürün fotoğrafı = giysi. Üzerindeki kişi = kullanıcının kendisi.
 *
 * ⚠️ ZEMİN AÇIK GRİ, BEYAZ DEĞİL. Beyaz zeminde beyaz/ekru ürün (katalogda 21
 *    tane var) kenarını kaybediyor ve kart içinde yüzüyor. Açık gri hem
 *    `design-system.md` yüzey tonuna oturuyor hem de her rengi kesiyor.
 */
const ORTAK_ISTEM =
  'professional e-commerce catalogue product photography, ' +
  'flat lay on seamless light grey studio background, ' +
  'soft even diffused studio lighting, subtle natural shadow, ' +
  'no person, no mannequin, no model, no face, no hands, ' +
  'garment centred and fully visible with margin on all sides, ' +
  'sharp focus, high detail fabric texture, vertical composition, photorealistic';

/**
 * Arka görünüm.
 *
 * ⚠️ AKSESUARDA ARKA GÖRÜNÜM "ters çevrilmiş" DEĞİL, "farklı açı". Bir çantanın
 *    arkası anlamlı, bir küpenin arkası değil; model ikincisinde boş bir kart
 *    çizerdi. `aksesuar` silüetinde ikinci kare açı değişimi olarak isteniyor.
 */
function aciIstemi(urun: UrunTanimi, arka: boolean): string {
  if (!arka) return 'photographed straight from the front, front view';
  if (urun.siluet === 'aksesuar') return 'photographed from a three-quarter angle, alternate view';
  return 'photographed straight from the back, rear view of the same garment';
}

export function istemKur(urun: UrunTanimi, arka: boolean): string {
  const parcalar = [
    cevir(KATEGORI_EN, urun.kategoriSlug, 'kategoriSlug'),
    cevir(RENK_EN, urun.etiketler.color ?? '', 'etiketler.color'),
    cevir(KUMAS_EN, urun.etiketler.fabric ?? '', 'etiketler.fabric'),
    cevir(DESEN_EN, urun.etiketler.pattern ?? '', 'etiketler.pattern'),
    cevir(KALIP_EN, urun.etiketler.fit ?? '', 'etiketler.fit'),
  ];
  return `${parcalar.join(', ')}, ${aciIstemi(urun, arka)}, ${ORTAK_ISTEM}`;
}

/**
 * Tohum slug'dan TÜRETİLİR.
 *
 * ⚠️ SEBEBİ REPRODÜKLENEBİLİRLİK: rastgele tohumla her çalıştırma başka bir
 *    katalog üretirdi ve "dün gördüğüm ürün bugün başka" şikâyeti doğardı.
 *    Ön ve arka kareler AYRI tohum alır, yoksa model ikisini birebir aynı
 *    çizer — arka görünüm diye ikinci bir ön fotoğraf koymuş oluruz.
 */
export function tohum(slug: string, arka: boolean): number {
  const ozet = createHash('sha256')
    .update(`${slug}#${arka ? 'back' : 'front'}`)
    .digest();
  return ozet.readUInt32BE(0);
}

// ── Üretim ─────────────────────────────────────────────────────────────────

interface FalYanit {
  readonly images?: readonly { readonly url?: string }[];
}

async function bekle(ms: number): Promise<void> {
  await new Promise((coz) => setTimeout(coz, ms));
}

async function falCagir(istem: string, tohumDeger: number, anahtar: string): Promise<string> {
  let sonHata: unknown;

  for (let deneme = 1; deneme <= AZAMI_DENEME; deneme += 1) {
    try {
      const yanit = await fetch(FAL_UC, {
        method: 'POST',
        headers: { Authorization: `Key ${anahtar}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: istem,
          image_size: { width: MODEL_GENISLIK, height: MODEL_YUKSEKLIK },
          num_images: 1,
          num_inference_steps: 4,
          seed: tohumDeger,
          enable_safety_checker: false,
        }),
      });

      // ⚠️ 4xx TEKRAR DENENMEZ (429 hariç): istem ya da anahtar hatalıysa üç
      //    kez denemek yalnızca üç kat para ve zaman harcar.
      if (!yanit.ok) {
        const govde = await yanit.text();
        if (yanit.status !== 429 && yanit.status < 500) {
          throw new Error(`fal ${yanit.status}: ${govde.slice(0, 200)}`);
        }
        throw Object.assign(new Error(`fal ${yanit.status}: ${govde.slice(0, 120)}`), {
          tekrarlanabilir: true,
        });
      }

      const veri = (await yanit.json()) as FalYanit;
      const adres = veri.images?.[0]?.url;
      if (!adres)
        throw new Error(`fal yanıtında görsel yok: ${JSON.stringify(veri).slice(0, 200)}`);
      return adres;
    } catch (hata) {
      sonHata = hata;
      const tekrar =
        hata instanceof Error && (hata as { tekrarlanabilir?: boolean }).tekrarlanabilir === true;
      const ag = hata instanceof TypeError; // fetch ağ hatası
      if (!tekrar && !ag) throw hata;
      if (deneme < AZAMI_DENEME) await bekle(deneme * 2000);
    }
  }

  throw sonHata instanceof Error ? sonHata : new Error(String(sonHata));
}

/**
 * ⚠️ `fit: 'cover'` DEĞİL `fit: 'contain'` DE DEĞİL — model zaten 2:3 üretiyor
 *    (1024x1536), hedef de 3:4 (1200x1600). Oran farkı var, yani bir şey
 *    kırpılacak. `cover` seçildi ve ÜSTTEN/ALTTAN eşit kırpıyor; istemdeki
 *    "margin on all sides" tam bu yüzden var — kenar boşluğu olmadan kırpma
 *    giysinin omzunu ya da paçasını keserdi.
 */
export async function govdeUret(ham: ArrayBuffer): Promise<Buffer> {
  return sharp(Buffer.from(ham))
    .resize(GENISLIK, YUKSEKLIK, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
    .webp({ quality: 80 })
    .toBuffer();
}

async function varMi(yol: string): Promise<boolean> {
  try {
    await access(yol);
    return true;
  } catch {
    return false;
  }
}

interface Is {
  readonly urun: UrunTanimi;
  readonly arka: boolean;
  readonly yol: string;
}

async function isiYurut(is: Is, anahtar: string): Promise<number> {
  const adres = await falCagir(istemKur(is.urun, is.arka), tohum(is.urun.slug, is.arka), anahtar);

  const indir = await fetch(adres);
  if (!indir.ok) throw new Error(`görsel indirilemedi (${indir.status}): ${adres}`);

  const govde = await govdeUret(await indir.arrayBuffer());
  await writeFile(is.yol, govde);
  return govde.byteLength;
}

async function main(): Promise<void> {
  const anahtar = process.env.FAL_KEY;
  if (!anahtar) {
    console.error('❌ FAL_KEY yok. Görsel üretimi bir fal.ai anahtarı gerektirir.');
    console.error('   FAL_KEY=... pnpm --filter @vt/db seed:varlik');
    process.exitCode = 1;
    return;
  }

  const yeniden = process.argv.includes('--yeniden');
  await mkdir(VARLIK_KLASORU, { recursive: true });

  // ⚠️ İSTEMLER ÖNCE KURULUYOR, TEK BİR İSTEK ATILMADAN. Sözlükte eksik bir
  //    kumaş varsa `cevir()` burada atar ve HİÇ PARA HARCANMAZ. Üretimin
  //    ortasında patlamak yarım bir katalog bırakırdı.
  const tumIsler: Is[] = [];
  for (const urun of URUNLER) {
    for (const aci of ACILAR) {
      const arka = aci === 'BACK';
      istemKur(urun, arka); // doğrulama — çıktısı burada kullanılmıyor
      tumIsler.push({ urun, arka, yol: join(VARLIK_KLASORU, varlikDosyaAdi(urun.slug, aci)) });
    }
  }

  const isler = yeniden
    ? tumIsler
    : (await Promise.all(tumIsler.map(async (is) => ((await varMi(is.yol)) ? null : is)))).filter(
        (is): is is Is => is !== null,
      );

  const atlanan = tumIsler.length - isler.length;
  console.log(`▸ ${tumIsler.length} kare · ${isler.length} üretilecek · ${atlanan} zaten var`);
  if (isler.length === 0) {
    console.log('  yapacak iş yok (yenilemek için: --yeniden)');
    return;
  }

  let toplamBayt = 0;
  let biten = 0;
  const hatalar: string[] = [];

  // ⚠️ Havuz `Promise.all(map)` DEĞİL: 298 isteği aynı anda açmak fal'da 429,
  //    yerelde sharp yüzünden bellek baskısı demek. Sabit genişlikte havuz.
  const sira = [...isler];
  await Promise.all(
    Array.from({ length: ESZAMAN }, async () => {
      for (;;) {
        const is = sira.shift();
        if (!is) return;
        try {
          /**
           * ⚠️ `toplamBayt += await …` YAZILAMAZ. `+=` sol tarafı AWAIT'TEN
           *    ÖNCE okur; altı görev eşzamanlı koşarken hepsi aynı eski değeri
           *    okuyup üzerine yazar. Ölçüldü: gerçek 14 MB, sayaç 2,1 MB
           *    dedi — tam 1/6, yani havuz genişliği kadar kayıp. Rapor ekrana
           *    "ortalama 8 KB" bastı ve bu, üretimin blank görsel ürettiğine
           *    dair YANLIŞ bir alarm verdi. Önce değeri al, sonra ekle.
           */
          const bayt = await isiYurut(is, anahtar);
          toplamBayt += bayt;
        } catch (hata) {
          hatalar.push(`${is.urun.slug} ${is.arka ? 'BACK' : 'FRONT'}: ${String(hata)}`);
        }
        biten += 1;
        if (biten % 20 === 0) console.log(`  ${biten}/${isler.length}`);
      }
    }),
  );

  const basarili = biten - hatalar.length;
  console.log(
    `✓ ${basarili} görsel üretildi — toplam ${(toplamBayt / 1024 / 1024).toFixed(1)} MB (ortalama ${(toplamBayt / Math.max(1, basarili) / 1024).toFixed(0)} KB)`,
  );
  console.log(`  klasör: ${VARLIK_KLASORU}`);

  // ⚠️ HATA VARSA ÇIKIŞ KODU 0 DEĞİL. Sessizce eksik biten bir üretim, seed
  //    aşamasında "dosya yok" diye patlar ve sebebi bir tur önceye gömülür.
  if (hatalar.length > 0) {
    console.error(`\n❌ ${hatalar.length} kare üretilemedi:`);
    for (const h of hatalar.slice(0, 10)) console.error(`   ${h}`);
    if (hatalar.length > 10) console.error(`   … ve ${hatalar.length - 10} tane daha`);
    console.error('\n   Tekrar çalıştırın — var olan kareler atlanır, yalnız eksikler üretilir.');
    process.exitCode = 1;
  }
}

// Doğrudan çalıştırıldığında üret; `import` edildiğinde sessiz kal.
/**
 * ⚠️ Dosya ADI karşılaştırılıyor, sonek DEĞİL. Kardeş modül `vitrin.ts`te bu
 *    tam olarak kırıldı: `seed-vitrin.ts` de `vitrin.ts` ile bittiği için
 *    modül import edildiğinde `main()` koştu. Burada bugün çakışan bir ad yok
 *    ama aynı kalıbı bırakmak, bir gün `seed-uret.ts` yazan kişiye tuzak kurmak
 *    olurdu.
 */
const calistirilanDosya = process.argv[1]?.split(/[\\/]/).pop();
if (calistirilanDosya === 'uret.ts') {
  void main().catch((hata: unknown) => {
    console.error('❌ Görsel üretimi başarısız:', hata);
    process.exitCode = 1;
  });
}
