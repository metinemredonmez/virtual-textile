/**
 * SİTE GÖRSELİ ÜRETİCİSİ — afiş, kategori kapağı, koleksiyon kapağı.
 *
 * Çalıştır:  FAL_KEY=... pnpm --filter @vt/db seed:vitrin-varlik
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ VARLIK SEBEBİ ÖLÇÜLMÜŞ BİR ARIZA — ANA SAYFANIN EN BÜYÜK KUTUSU BOŞTU.
 *
 *  `page.tsx` → `Vitrin`:  mediaUrl(afis?.storageKey ?? urun?.imageKey)
 *  Yani yönetici afiş yüklemediyse afişin yerine BİRİNCİ ÜRÜNÜN FOTOĞRAFI
 *  konuyor. O fotoğraf 1200x1600 (3:4) bir düz seriş; afiş kutusu ise
 *  `md:aspect-[16/7]`. 3:4 bir kareyi 16:7'ye `cover` ile kırpmak giysinin
 *  üstünü ve altını atar: ekranda 1465x640 gri bir dikdörtgenin ortasında
 *  bir paça kalır. Ekran görüntüsünde görülen tam olarak buydu.
 *
 *  ⚠️ ASIL DERS: yedek (fallback) yolu YANLIŞ ORANDA bir görsel seçiyordu ve
 *     hiçbir test bunu göremezdi — `tsc` temiz, `next build` temiz, 1392 test
 *     yeşil. Kırılan şey tipin değil, ORANIN uyuşmazlığıydı.
 *
 *  ÇÖZÜM İKİ AYAKLI:
 *    1. Afiş 16:7 KENDİ ÇEKİMİ olarak üretilir (bu dosya) ve seed onu
 *       `SiteImage(slot=HERO)` olarak yazar — yedek yola hiç düşülmez.
 *    2. Yedek yol yine de duruyor ama artık `Vitrin` ürün fotoğrafını
 *       16:7'ye zorlamıyor (bkz. `page.tsx`, aynı turda).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ KOLEKSİYON VE KATEGORİ KAPAKLARI 16:7 DEĞİL. Kapak, ray içinde duran bir
 *    kart; oranı `aspect-[4/3]`. Afişle aynı oranda üretmek kartları
 *    ekranın yarısı kadar yüksek yapardı.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { KOLEKSIYON_SLUGLARI } from '@vt/config';

export const VITRIN_KLASORU = join(__dirname, 'vitrin');

const FAL_UC = 'https://fal.run/fal-ai/flux/schnell';
const ESZAMAN = 4;

/**
 * ⚠️ AFİŞ 2048 px GENİŞ. `SITE_BANNER_WIDTHS` en büyük türev olarak 2048
 *    listeliyor; kaynak ondan küçük olursa en büyük türev BÜYÜTME olur.
 *    Ürün görselinde (`gorsel.ts`) bu sorun 2048 türevi ELENEREK çözülmüştü;
 *    afişte eleyemeyiz — afiş ekranın tam genişliğini kaplayan öğedir.
 */
const AFIS_GENISLIK = 2048;
const AFIS_YUKSEKLIK = 896; // 16:7

const KAPAK_GENISLIK = 1024;
const KAPAK_YUKSEKLIK = 768; // 4:3

/** Modelin desteklediği en yakın ölçüler; sharp hedefe çıkarır. */
const MODEL_AFIS = { width: 1536, height: 672 };
const MODEL_KAPAK = { width: 1024, height: 768 };

const ORTAK =
  'editorial fashion photography, natural daylight, muted neutral colour palette, ' +
  'calm minimal composition, generous negative space, photorealistic, high detail, ' +
  'no text, no logo, no watermark';

export interface VitrinVarligi {
  /** Dosya adı ve seed tarafındaki arama anahtarı. */
  readonly ad: string;
  readonly slot: 'HERO' | 'CATEGORY_COVER' | 'COLLECTION_COVER';
  /** `CATEGORY_COVER` → kategori slug'ı · `COLLECTION_COVER` → koleksiyon slug'ı. */
  readonly hedef: string | null;
  readonly istem: string;
  readonly genislik: number;
  readonly yukseklik: number;
}

/**
 * ⚠️ AFİŞTE İNSAN VAR, ÜRÜN FOTOĞRAFINDA YOK — ve bu bilinçli bir ayrım.
 *    Ürün fotoğrafı giysiyi gösterir (kullanıcı onu KENDİ üzerinde görecek).
 *    Afiş ise sayfanın vaadini gösterir: "satın almadan önce üzerinizde
 *    görün". Bir giysinin düz serilmiş hâli bu cümleyi kuramaz.
 *
 * ⚠️ YÜZ YOK. `no face` istemde: tanınabilir bir yüz üretmek hem KVKK
 *    tarafında gereksiz bir soru açar hem de demo verisi olarak bir kişiyi
 *    temsil ediyormuş izlenimi verir.
 */
export const VARLIKLAR: readonly VitrinVarligi[] = [
  {
    ad: 'afis-ana',
    slot: 'HERO',
    hedef: null,
    /**
     * ⚠️ İLK DENEME BOŞ ÇIKTI VE SEBEBİ ORTAK İSTEMDEKİ TEK BİR İFADEYDİ:
     *    `generous negative space`. Kapaklarda doğru olan bu ifade, 16:7'lik
     *    bir tuvalde ekranın %80'ini boş beyaz duvara çeviriyor — tek kişi
     *    ortada, iki yanı boşluk. Yani düzeltmeye çalıştığımız "gri boş
     *    dikdörtgen" arızası, içinde bir insanla geri geliyordu.
     *
     * ⚠️ BU YÜZDEN AFİŞ `ORTAK`I KULLANMAZ. Kendi kuyruğunu yazıyor:
     *    kare DOLU olacak (`fills the frame`), kadraj yakın, birden çok
     *    figür. Yüz yine yok — gerekçe aşağıdaki blokta.
     */
    istem:
      'wide editorial fashion banner, three people standing close together seen from the ' +
      'shoulders down to the knees, cropped tight so the figures fill the frame, wearing ' +
      'layered neutral clothing — linen shirt, wool knit, tailored trousers, denim — ' +
      'warm natural daylight, soft shadows, textured off-white studio wall close behind them, ' +
      'wide horizontal composition, shallow depth of field, editorial fashion photography, ' +
      'muted neutral colour palette, photorealistic, high detail fabric texture, ' +
      'no face, no text, no logo, no watermark',
    genislik: AFIS_GENISLIK,
    yukseklik: AFIS_YUKSEKLIK,
  },

  // ── Kategori kapakları — dört kök kategori (`veri.ts` → ustSlug: null) ───
  {
    ad: 'kategori-kadin',
    slot: 'CATEGORY_COVER',
    hedef: 'kadin',
    istem: `women's contemporary wardrobe flat lay, folded linen shirt, wool knit and trousers arranged on a pale grey surface, overhead view, ${ORTAK}`,
    genislik: KAPAK_GENISLIK,
    yukseklik: KAPAK_YUKSEKLIK,
  },
  {
    ad: 'kategori-erkek',
    slot: 'CATEGORY_COVER',
    hedef: 'erkek',
    istem: `men's wardrobe flat lay, folded oxford shirt, denim jeans and a knit sweater arranged on a pale grey surface, overhead view, ${ORTAK}`,
    genislik: KAPAK_GENISLIK,
    yukseklik: KAPAK_YUKSEKLIK,
  },
  {
    ad: 'kategori-unisex',
    slot: 'CATEGORY_COVER',
    hedef: 'unisex',
    istem: `unisex basics flat lay, plain cotton t-shirts and a canvas tote in ecru and charcoal on a pale grey surface, overhead view, ${ORTAK}`,
    genislik: KAPAK_GENISLIK,
    yukseklik: KAPAK_YUKSEKLIK,
  },
  {
    ad: 'kategori-cocuk',
    slot: 'CATEGORY_COVER',
    hedef: 'cocuk',
    istem: `children's clothing flat lay, small folded sweatshirt and trousers in soft neutral tones on a pale grey surface, overhead view, no children visible, ${ORTAK}`,
    genislik: KAPAK_GENISLIK,
    yukseklik: KAPAK_YUKSEKLIK,
  },

  // ── Koleksiyon kapakları ────────────────────────────────────────────────
  {
    ad: 'koleksiyon-denim',
    slot: 'COLLECTION_COVER',
    hedef: 'denim',
    istem: `stack of folded indigo and washed denim jeans on a pale grey surface, close overhead view, visible denim weave texture, ${ORTAK}`,
    genislik: KAPAK_GENISLIK,
    yukseklik: KAPAK_YUKSEKLIK,
  },
  {
    ad: 'koleksiyon-gelinlik',
    slot: 'COLLECTION_COVER',
    hedef: 'gelinlik',
    istem: `ivory tulle and satin bridal gown fabric draped on a pale grey surface, soft light, delicate lace detail, no person, ${ORTAK}`,
    genislik: KAPAK_GENISLIK,
    yukseklik: KAPAK_YUKSEKLIK,
  },
  {
    ad: 'koleksiyon-spor-giyim',
    slot: 'COLLECTION_COVER',
    hedef: 'spor-giyim',
    istem: `activewear flat lay, black technical leggings and a charcoal training top on a pale grey surface, overhead view, ${ORTAK}`,
    genislik: KAPAK_GENISLIK,
    yukseklik: KAPAK_YUKSEKLIK,
  },
  {
    ad: 'koleksiyon-elbise',
    slot: 'COLLECTION_COVER',
    hedef: 'elbise',
    istem: `three day dresses on wooden hangers against a pale grey wall, ecru, dusty rose and black, soft daylight, no person, ${ORTAK}`,
    genislik: KAPAK_GENISLIK,
    yukseklik: KAPAK_YUKSEKLIK,
  },
];

/**
 * ⚠️ BU KONTROL DERLEME ZAMANINDA YAPILAMIYOR, O YÜZDEN ÇALIŞMA ZAMANINDA VAR.
 *    `KOLEKSIYON_SLUGLARI` config'te tek kaynak; buradaki dört kapak onunla
 *    eşleşmezse seed sessizce hedefsiz bir kapak yazar ve koleksiyon sayfası
 *    bugünkü boş hâlinde kalır — kimse fark etmez.
 */
export function koleksiyonKapsamiDogrula(): void {
  const kapakli = new Set(
    VARLIKLAR.filter((v) => v.slot === 'COLLECTION_COVER').map((v) => v.hedef),
  );
  const eksik = KOLEKSIYON_SLUGLARI.filter((slug) => !kapakli.has(slug));
  if (eksik.length > 0) {
    throw new Error(
      `Koleksiyon kapağı eksik: ${eksik.join(', ')} — seed-assets/vitrin.ts içine ekleyin.`,
    );
  }
  const fazla = [...kapakli].filter(
    (slug) => !(KOLEKSIYON_SLUGLARI as readonly string[]).includes(slug ?? ''),
  );
  if (fazla.length > 0) {
    throw new Error(`Bilinmeyen koleksiyon kapağı: ${fazla.join(', ')} — @vt/config ile ayrışmış.`);
  }
}

export function vitrinDosyaAdi(ad: string): string {
  return `${ad}.webp`;
}

function tohum(ad: string): number {
  return createHash('sha256').update(`vitrin#${ad}`).digest().readUInt32BE(0);
}

async function varMi(yol: string): Promise<boolean> {
  try {
    await access(yol);
    return true;
  } catch {
    return false;
  }
}

async function uret(varlik: VitrinVarligi, anahtar: string): Promise<number> {
  const olcu = varlik.slot === 'HERO' ? MODEL_AFIS : MODEL_KAPAK;

  const yanit = await fetch(FAL_UC, {
    method: 'POST',
    headers: { Authorization: `Key ${anahtar}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: varlik.istem,
      image_size: olcu,
      num_images: 1,
      num_inference_steps: 4,
      seed: tohum(varlik.ad),
      enable_safety_checker: false,
    }),
  });
  if (!yanit.ok) throw new Error(`fal ${yanit.status}: ${(await yanit.text()).slice(0, 200)}`);

  const veri = (await yanit.json()) as { images?: readonly { url?: string }[] };
  const adres = veri.images?.[0]?.url;
  if (!adres) throw new Error(`fal yanıtında görsel yok (${varlik.ad})`);

  const indir = await fetch(adres);
  if (!indir.ok) throw new Error(`görsel indirilemedi (${indir.status}): ${varlik.ad}`);

  const govde = await sharp(Buffer.from(await indir.arrayBuffer()))
    .resize(varlik.genislik, varlik.yukseklik, {
      fit: 'cover',
      position: 'centre',
      kernel: 'lanczos3',
    })
    .webp({ quality: 82 })
    .toBuffer();

  await writeFile(join(VITRIN_KLASORU, vitrinDosyaAdi(varlik.ad)), govde);
  return govde.byteLength;
}

async function main(): Promise<void> {
  const anahtar = process.env.FAL_KEY;
  if (!anahtar) {
    console.error('❌ FAL_KEY yok. FAL_KEY=... pnpm --filter @vt/db seed:vitrin-varlik');
    process.exitCode = 1;
    return;
  }

  koleksiyonKapsamiDogrula();
  await mkdir(VITRIN_KLASORU, { recursive: true });

  const yeniden = process.argv.includes('--yeniden');
  const sira = yeniden
    ? [...VARLIKLAR]
    : (
        await Promise.all(
          VARLIKLAR.map(async (v) =>
            (await varMi(join(VITRIN_KLASORU, vitrinDosyaAdi(v.ad)))) ? null : v,
          ),
        )
      ).filter((v): v is VitrinVarligi => v !== null);

  console.log(`▸ ${VARLIKLAR.length} site görseli · ${sira.length} üretilecek`);
  if (sira.length === 0) return;

  let toplam = 0;
  const hatalar: string[] = [];

  await Promise.all(
    Array.from({ length: ESZAMAN }, async () => {
      for (;;) {
        const varlik = sira.shift();
        if (!varlik) return;
        try {
          // ⚠️ `+=  await` DEĞİL — `uret.ts`teki ölçülmüş yarış hatası.
          const bayt = await uret(varlik, anahtar);
          toplam += bayt;
          console.log(`  ✓ ${varlik.ad} (${(bayt / 1024).toFixed(0)} KB)`);
        } catch (hata) {
          hatalar.push(`${varlik.ad}: ${String(hata)}`);
        }
      }
    }),
  );

  console.log(`✓ toplam ${(toplam / 1024 / 1024).toFixed(1)} MB · klasör: ${VITRIN_KLASORU}`);

  if (hatalar.length > 0) {
    console.error(`\n❌ ${hatalar.length} görsel üretilemedi:`);
    for (const h of hatalar) console.error(`   ${h}`);
    process.exitCode = 1;
  }
}

/**
 * ⚠️ `endsWith('vitrin.ts')` YAZILAMAZ — ÖLÇÜLDÜ, YANLIŞ ÇALIŞTI.
 *    Seed girişinin adı `seed-vitrin.ts` ve o da `vitrin.ts` ile BİTİYOR.
 *    Sonuç: `pnpm seed:vitrin` çalıştırıldığında bu modül yalnızca import
 *    edilmiş olmasına rağmen `main()` KOŞTU ve seed çıktısına araya
 *    "▸ 9 site görseli · 0 üretilecek" satırını bastı. Bu sefer zararsız
 *    kaldı (dosyalar vardı, üretilecek bir şey yoktu) ama FAL_KEY tanımlıysa
 *    seed sırasında sessizce dokuz görsel ÜRETİRDİ — yani para harcardı.
 *
 *    Dosya ADI karşılaştırılıyor, sonek değil.
 */
const calistirilanDosya = process.argv[1]?.split(/[\\/]/).pop();
if (calistirilanDosya === 'vitrin.ts') {
  void main().catch((hata: unknown) => {
    console.error('❌ Site görseli üretimi başarısız:', hata);
    process.exitCode = 1;
  });
}
