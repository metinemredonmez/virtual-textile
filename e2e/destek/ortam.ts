/**
 * E2E ORTAM YAPILANDIRMASI
 *
 * ⚠️ Kök `.env` BURADAN okunuyor, `dotenv` paketi eklenmeden. Gerekçe: e2e
 *    paketinin bağımlılık listesi ne kadar kısaysa, "test altyapısı çalışmıyor"
 *    diye geçirilen süre o kadar az olur. Dosya biçimi basit; 20 satırlık bir
 *    çözümleyici için ayrı bir paket taşımaya değmez.
 *
 * ⚠️ Değerler process.env'i EZMEZ. CI veya kabuk `DATABASE_URL` verdiyse o
 *    kazanır; aksi hâlde geliştiricinin makinesindeki `.env` yanlışlıkla
 *    CI veritabanının üzerine yazabilirdi.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Depo kökünü `pnpm-workspace.yaml` dosyasını arayarak bulur.
 *
 * ⚠️ `import.meta.url` BİLEREK kullanılmıyor: `e2e/package.json` bu ajanın
 *    kapsamı dışında ve `"type": "module"` içerip içermeyeceği bilinmiyor.
 *    İçermezse `import.meta` derlenmez ve tip kontrolü hata verir. `__dirname`
 *    ise ESM'de yok. Yukarı doğru arama iki durumda da çalışır ve testin
 *    hangi dizinden başlatıldığından etkilenmez.
 */
function depoKokunuBul(baslangic: string): string {
  let dizin = resolve(baslangic);

  for (let adim = 0; adim < 10; adim += 1) {
    if (existsSync(resolve(dizin, 'pnpm-workspace.yaml'))) return dizin;
    const ust = dirname(dizin);
    if (ust === dizin) break;
    dizin = ust;
  }

  // Bulunamadıysa çalışma dizini en makul tahmindir; `.env` okunamazsa
  // eksik değişkenler zaten `gerekliDeger()` ile tek tek bildiriliyor.
  return resolve(baslangic);
}

export const DEPO_KOKU = depoKokunuBul(process.cwd());

/** `KEY=value` satırlarını ayrıştırır. Tırnak ve `export ` öneki temizlenir. */
function envDosyasiniCozumle(icerik: string): Record<string, string> {
  const sonuc: Record<string, string> = {};

  for (const hamSatir of icerik.split('\n')) {
    const satir = hamSatir.trim();
    if (satir === '' || satir.startsWith('#')) continue;

    const esittir = satir.indexOf('=');
    if (esittir === -1) continue;

    const anahtar = satir
      .slice(0, esittir)
      .replace(/^export\s+/, '')
      .trim();
    let deger = satir.slice(esittir + 1).trim();

    // Tırnak içindeki değerde `#` yorum başlangıcı DEĞİLDİR; bu yüzden
    // yorum kırpması yalnızca tırnaksız değerlere uygulanıyor.
    if (
      (deger.startsWith('"') && deger.endsWith('"')) ||
      (deger.startsWith("'") && deger.endsWith("'"))
    ) {
      deger = deger.slice(1, -1);
    } else {
      const yorum = deger.indexOf(' #');
      if (yorum !== -1) deger = deger.slice(0, yorum).trim();
    }

    if (anahtar !== '') sonuc[anahtar] = deger;
  }

  return sonuc;
}

let yuklendi = false;

/** Kök `.env`'i process.env'e ekler (var olan değerleri EZMEDEN). */
export function ortamiYukle(): void {
  if (yuklendi) return;
  yuklendi = true;

  try {
    const icerik = readFileSync(resolve(DEPO_KOKU, '.env'), 'utf8');
    for (const [anahtar, deger] of Object.entries(envDosyasiniCozumle(icerik))) {
      if (process.env[anahtar] === undefined) process.env[anahtar] = deger;
    }
  } catch {
    // .env yoksa sorun değil: değerler kabuktan gelmiş olabilir. Eksik olan
    // her zorunlu değişken `gerekliDeger()` ile ayrı ayrı ve isim vererek
    // bildirilir — burada toptan bir uyarı basmak gürültüden ibaret olurdu.
  }
}

/**
 * Zorunlu ortam değişkeni. Eksikse HANGİSİNİN eksik olduğunu söyleyerek
 * patlar; `undefined` ile ilerleyip 40 satır sonra anlaşılmaz bir hata
 * vermekten iyidir.
 */
export function gerekliDeger(anahtar: string): string {
  ortamiYukle();
  const deger = process.env[anahtar];
  if (deger === undefined || deger === '') {
    throw new OrtamHatasi(
      `${anahtar} tanımlı değil. Kök .env dosyasını kontrol edin veya değişkeni kabuktan verin.`,
    );
  }
  return deger;
}

export function istegeBagliDeger(anahtar: string, varsayilan: string): string {
  ortamiYukle();
  const deger = process.env[anahtar];
  return deger === undefined || deger === '' ? varsayilan : deger;
}

/** Kurulum hatalarını test başarısızlıklarından ayırt edebilmek için ayrı tip. */
export class OrtamHatasi extends Error {
  override readonly name = 'OrtamHatasi';
}

export const AYARLAR = {
  /** API kök adresi. Playwright `baseURL` ile aynı olmalı. */
  get temelUrl(): string {
    return istegeBagliDeger('E2E_BASE_URL', 'http://localhost:3001');
  },

  /**
   * Sahte iyzico sunucusunun portu. API süreci `IYZICO_BASE_URL` olarak bunu
   * görmelidir; aksi hâlde ödeme akışı gerçek sağlayıcıya gider ve
   * tamamlanamaz (bkz. destek/sahte-iyzico.ts başlığı).
   */
  get sahteIyzicoPort(): number {
    return Number(istegeBagliDeger('E2E_IYZICO_PORT', '3999'));
  },

  get sahteIyzicoUrl(): string {
    return `http://127.0.0.1:${String(AYARLAR.sahteIyzicoPort)}`;
  },

  get veritabaniUrl(): string {
    return gerekliDeger('DATABASE_URL');
  },

  get redisUrl(): string {
    return gerekliDeger('REDIS_URL');
  },

  /** Webhook imzası için — sahte sağlayıcı da AYNI sırrı kullanmalı. */
  get webhookSirri(): string {
    return gerekliDeger('IYZICO_WEBHOOK_SECRET');
  },
} as const;
