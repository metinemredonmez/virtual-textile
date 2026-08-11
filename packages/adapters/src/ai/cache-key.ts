import { createHash } from 'node:crypto';

/**
 * SANAL DENEME ÖNBELLEK ANAHTARI
 *
 * ⚠️ EN BÜYÜK MALİYET KALDIRACI. Aynı fotoğraf + aynı ürün ikinci kez
 * ÜRETİLMEZ; önbellekten döner. Maliyet 0, gecikme ~80 ms.
 *
 * Anahtar bileşenleri ve neden:
 *  - photoContentHash : dosya adı/kimliği değil İÇERİK özeti. Kullanıcı aynı
 *                       fotoğrafı tekrar yüklerse önbellek yine isabet eder.
 *  - variantId        : renk ve beden farklı ürün demektir.
 *  - mode             : FAST ve QUALITY farklı çıktı üretir.
 *  - promptVersion    : prompt/pipeline değişince eski sonuçlar geçersizleşir.
 *                       ⚠️ Pipeline'ı değiştirdiğinde BU DEĞERİ ARTIR, yoksa
 *                       kullanıcılar eski kalitedeki görselleri görmeye devam eder.
 */
export const TRYON_PROMPT_VERSION = 1;

export interface TryOnCacheKeyInput {
  photoContentHash: string;
  variantId: string;
  mode: 'FAST' | 'QUALITY';
  promptVersion?: number;
}

export function tryOnCacheKey(input: TryOnCacheKeyInput): string {
  const version = input.promptVersion ?? TRYON_PROMPT_VERSION;
  return createHash('sha256')
    .update([input.photoContentHash, input.variantId, input.mode, `v${version}`].join('|'))
    .digest('hex');
}

/** Yüklenen fotoğrafın içerik özeti — önbellek anahtarının temeli. */
export function photoContentHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
