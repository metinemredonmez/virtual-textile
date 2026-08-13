/**
 * DEMO GÖRSELLERİN NESNE DEPOSUNA YÜKLENMESİ.
 *
 * ⚠️ ESKİ SEED'İN ASIL HATASI 404 DEĞİL, ŞEMA UYUŞMAZLIĞIYDI. Seed
 *    `demo/{slug}/front.webp` yazıyordu; o ön ek uygulamanın anahtar şemasında
 *    HİÇ YOK. Gerçek şema tek yerde tanımlı:
 *      `@vt/adapters` → storageKeys        (= `apps/api/.../media.ports.ts` → mediaKeys)
 *      products/{productId}/{imageId}/original
 *      products/{productId}/{imageId}/{320|640|1024}.webp
 *    `demo/` ayrıca `r2.config.ts → KNOWN_KEY_PREFIXES` listesinde de yoktu,
 *    yani kova görünürlük kontrolünden sessizce muaftı. Seed dosyayı yüklemiş
 *    OLSAYDI BİLE uygulamanın hiç ürettiği bir anahtar biçimini yazıyordu.
 *
 * ⚠️ TEK KOD YOLU, ÜÇ ORTAM. Depolama yapılandırılmamışsa (CI) yükleme atlanır,
 *    DB satırları YİNE yazılır ve konsola yüksek sesle uyarı basılır. Yerelde
 *    ve sunucuda kök `.env` gerçek R2 anahtarlarını taşıyor, yani ikisi de aynı
 *    dalı koşar. "Yerelde çalışıp sunucuda çalışmayan" durum bu yüzden yapısal
 *    olarak imkânsız: nesneler AYNI kovaya, AYNI anahtarla gidiyor.
 *
 * ⚠️ Türevler (320/640/1024) DEPOYA KONMAZ; seed sırasında `sharp` ile
 *    üretilir. Depoda yalnızca 1200x1600 kaynak durur.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MEDIA } from '@vt/config';
import { r2StorageFromEnv, storageKeys, type StorageProvider } from '@vt/adapters';
import sharp from 'sharp';
import type { ImageAngle } from '../../generated/client/index.js';
import { varlikDosyaAdi } from './veri.js';

export const VARLIK_KLASORU = join(__dirname, '..', 'seed-assets', 'urunler');

/** Kaynak görselin ölçüleri — DB satırına da bu yazılır. */
export const KAYNAK_GENISLIK = 1200;
export const KAYNAK_YUKSEKLIK = 1600;

export interface GorselDepolama {
  readonly saglayici: StorageProvider | null;
  readonly yuklenen: string[];
  readonly atlanan: string[];
}

export function depolamaKur(): StorageProvider | null {
  return r2StorageFromEnv({
    R2_ENDPOINT: process.env['R2_ENDPOINT'] ?? '',
    R2_ACCESS_KEY_ID: process.env['R2_ACCESS_KEY_ID'] ?? '',
    R2_SECRET_ACCESS_KEY: process.env['R2_SECRET_ACCESS_KEY'] ?? '',
    R2_BUCKET_PUBLIC: process.env['R2_BUCKET_PUBLIC'] ?? '',
    R2_BUCKET_PRIVATE: process.env['R2_BUCKET_PRIVATE'] ?? '',
    R2_PUBLIC_URL: process.env['R2_PUBLIC_URL'] ?? '',
  });
}

/**
 * ⚠️ 2048 px TÜREV ÜRETİLMEZ. `MEDIA.productImageWidths` dört genişlik
 *    listeliyor ama kaynak 1200 px; 2048'e büyütmek bilgi eklemez, yalnızca
 *    dosya boyutunu ve yükleme süresini artırır. Gerçek satıcı görselinde
 *    (≥2048 px) o türev üretilir — burada kaynak yetmiyor.
 */
export const TUREV_GENISLIKLERI = MEDIA.productImageWidths.filter((w) => w < KAYNAK_GENISLIK);

export interface YuklemeSonucu {
  /** DB'ye yazılacak anahtar — `original`. */
  readonly anahtar: string;
  readonly yuklendi: boolean;
}

/**
 * Bir ürün görselini ve türevlerini yükler.
 *
 * `put()` üzerine yazar, yani yükleme KENDİLİĞİNDEN idempotenttir: ikinci
 * çalıştırmada aynı anahtara aynı içerik gider, mükerrer nesne oluşmaz.
 */
export async function gorselYukle(input: {
  storage: StorageProvider | null;
  urunId: string;
  gorselId: string;
  urunSlug: string;
  aci: ImageAngle;
}): Promise<YuklemeSonucu> {
  const anahtar = storageKeys.productImageOriginal(input.urunId, input.gorselId);
  if (!input.storage) return { anahtar, yuklendi: false };

  const kaynak = await readFile(join(VARLIK_KLASORU, varlikDosyaAdi(input.urunSlug, input.aci)));

  await input.storage.put({
    key: anahtar,
    visibility: 'public',
    body: kaynak,
    contentType: 'image/webp',
    // Ürün görselleri değişmez; anahtar değişirse adres de değişir.
    cacheControl: 'public, max-age=31536000, immutable',
  });

  for (const genislik of TUREV_GENISLIKLERI) {
    const turev = await sharp(kaynak).resize({ width: genislik }).webp({ quality: 82 }).toBuffer();
    await input.storage.put({
      key: storageKeys.productImage(input.urunId, input.gorselId, genislik),
      visibility: 'public',
      body: turev,
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    });
  }

  return { anahtar, yuklendi: true };
}
