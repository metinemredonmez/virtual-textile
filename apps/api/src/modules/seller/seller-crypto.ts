/**
 * ALAN BAZLI ŞİFRELEME — IBAN ve vergi numarası.
 *
 * Neden şifreli: bunlar KVKK kapsamında kişisel/finansal veridir. Veritabanı
 * yedeği, okuma replikası veya bir SQL enjeksiyonu sızdığında düz metin IBAN
 * doğrudan dolandırıcılık malzemesidir. Şifreli alan, sızıntının maliyetini
 * "para kaybı"ndan "gürültü"ye indirir.
 *
 * AES-256-GCM seçildi çünkü kimliği doğrulanmış şifrelemedir (AEAD): saldırgan
 * şifreli metni değiştirirse çözme İŞLEMİ BAŞARISIZ OLUR. CBC gibi bir mod
 * kullanılsaydı bozulmuş bir IBAN sessizce çözülüp başkasının hesabına ödeme
 * yapılabilirdi.
 *
 * ⚠️ KULLANIM SINIRI: `decryptField` YALNIZCA payout akışında çağrılır.
 *    Listeleme, detay ve analitik uçları şifreli değeri asla çözmez; ekranda
 *    `maskIban` ile maskelenmiş hâli gösterilir. Çözülmüş bir IBAN'ın loga,
 *    yanıt gövdesine veya OutboxEvent payload'ına düşmesi şifrelemeyi
 *    anlamsız kılar.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@vt/config';
import { appError } from '@vt/contracts';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM için önerilen uzunluk
const TAG_BYTES = 16;
/** Şifreli metin biçimi sürümü — anahtar rotasyonunda ayırt etmek için. */
const VERSION = 'v1';

function key(): Buffer {
  // env() doğrulanmış yapılandırmayı döndürür; FIELD_ENCRYPTION_KEY 32 baytlık
  // hex olarak şema düzeyinde zorunlu kılınmıştır (bkz. packages/config/env.ts).
  return Buffer.from(env().FIELD_ENCRYPTION_KEY, 'hex');
}

/**
 * Düz metni şifreler.
 * Çıktı: `v1:<iv-base64>:<tag-base64>:<ciphertext-base64>`
 *
 * IV her çağrıda YENİDEN üretilir. Sabit IV ile GCM'de aynı anahtar altında
 * iki mesaj şifrelenirse anahtar akışı tekrar eder ve şifreleme çöker.
 */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * ⚠️ YALNIZCA PAYOUT AKIŞINDA ÇAĞRILIR.
 *
 * Bozuk/oynanmış veride sessizce boş dönmez, hata fırlatır: geçersiz bir IBAN
 * ile ödeme talebi oluşturmak, talebi hiç oluşturmamaktan çok daha pahalıdır.
 */
export function decryptField(encoded: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw appError('FIELD_DECRYPT_FAILED', {
      internalMessage: `Şifreli alan biçimi tanınmıyor (sürüm: ${parts[0] ?? '-'})`,
    });
  }

  const iv = Buffer.from(parts[1]!, 'base64');
  const tag = Buffer.from(parts[2]!, 'base64');
  const ciphertext = Buffer.from(parts[3]!, 'base64');

  // Uzunluk kontrolü try'ın DIŞINDA: createDecipheriv'in kendi hata mesajıyla
  // karışmasın ve nedeni logda ayırt edilebilsin.
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw appError('FIELD_DECRYPT_FAILED', {
      internalMessage: `Şifreli alanın IV (${iv.length}) veya etiket (${tag.length}) uzunluğu geçersiz`,
    });
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    // ⚠️ `cause` loglanır ama kullanıcıya gitmez; şifreli metnin kendisi
    //    hiçbir koşulda hata mesajına konmaz.
    throw appError('FIELD_DECRYPT_FAILED', {
      cause: error,
      internalMessage: 'Şifreli alan çözülemedi (anahtar değişmiş veya veri bozulmuş olabilir)',
    });
  }
}

/**
 * Ekranda ve logda gösterilecek hâl: TR** **** **** **** **** **34
 *
 * Son 4 hane bırakılır — satıcı hangi hesabını seçtiğini ayırt edebilsin diye.
 * Daha fazlası bırakılırsa maskeleme koruma sağlamaz.
 */
export function maskIban(iban: string): string {
  const clean = iban.replace(/\s/g, '').toUpperCase();
  if (clean.length < 8) return '****';
  return `${clean.slice(0, 2)}${'*'.repeat(clean.length - 6)}${clean.slice(-4)}`;
}

/** Vergi/TC numarası maskesi: yalnızca son 3 hane. */
export function maskTaxNumber(taxNumber: string): string {
  const clean = taxNumber.replace(/\s/g, '');
  if (clean.length < 4) return '****';
  return `${'*'.repeat(clean.length - 3)}${clean.slice(-3)}`;
}

/**
 * İki şifreli değerin aynı düz metne karşılık gelip gelmediğini ölçer.
 * GCM'de aynı düz metin her seferinde farklı şifreli metin ürettiği için
 * doğrudan string karşılaştırması yapılamaz.
 *
 * Sabit zamanlı karşılaştırma kullanılır: değişken zamanlı karşılaştırma
 * IBAN'ı bayt bayt tahmin etmeye izin verebilir.
 */
export function encryptedFieldsMatch(a: string, b: string): boolean {
  const left = Buffer.from(decryptField(a), 'utf8');
  const right = Buffer.from(decryptField(b), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
