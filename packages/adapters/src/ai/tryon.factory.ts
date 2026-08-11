import { appError } from '@vt/contracts';
import { isFalConfigured, isGeminiConfigured, type TryOnKeys } from '../wiring.js';
import { circuitFor } from '../resilience/circuit-breaker.js';
import { FalTryOnProvider } from './fal.js';
import { GeminiTryOnProvider } from './gemini.js';
import type { TryOnGarmentCategory, TryOnProvider, TryOnResult } from './tryon.provider.js';

/**
 * SANAL DENEME SAĞLAYICI ZİNCİRİ — ORTAMDAN KURULUM
 *
 * Zincir `generateWithFallback()` ile soldan sağa denenir:
 *   fal (birincil) → gemini (yedek)
 *
 * ⚠️ Zincire YALNIZCA yapılandırılmış sağlayıcılar girer. Anahtarsız bir
 *    sağlayıcı listede kalsaydı her üretim önce onun 401'ini bekler, ardından
 *    yedeğe düşerdi: kullanıcı için sebepsiz gecikme, bizim için devre
 *    kesiciyi boşuna açan gürültü.
 */

/**
 * HİÇBİR SAĞLAYICI YAPILANDIRILMAMIŞ.
 *
 * ⚠️ Fail-closed ve GÖRÜNÜR. `{ status: 'FAILED' }` DÖNMEZ, fırlatır: başarısız
 *    bir sonuç "sağlayıcı denedi ve olmadı" demektir ve çağıran taraf onu
 *    sağlayıcı kesintisi sayıp kullanıcı kotasını harcanmış gibi işleyebilir.
 *    Burada olan şey bir kesinti değil, eksik YAPILANDIRMADIR; ikisi aynı
 *    kanaldan raporlanırsa üretimde hangisi olduğu log'dan anlaşılamaz.
 */
export class UnconfiguredTryOnProvider implements TryOnProvider {
  readonly name = 'unconfigured';

  /**
   * Dördü de listelenir. Liste boş bırakılsaydı `generateWithFallback` bu
   * sağlayıcıyı ATLAR ve zincir sessizce "hiç sağlayıcı denenmedi" sonucuna
   * düşerdi — tam da kaçınmak istediğimiz sessiz davranış.
   */
  readonly supportedCategories: readonly TryOnGarmentCategory[] = [
    'UPPER_BODY',
    'LOWER_BODY',
    'DRESS',
    'OUTERWEAR',
  ];

  generate(): Promise<TryOnResult> {
    return Promise.reject(
      appError('SERVICE_UNAVAILABLE', {
        internalMessage:
          'Sanal deneme sağlayıcısı yapılandırılmadı — FAL_KEY veya GOOGLE_AI_API_KEY tanımlı değil',
      }),
    );
  }
}

export type TryOnEnv = TryOnKeys & {
  FAL_TRYON_MODEL: string;
  GOOGLE_AI_IMAGE_MODEL: string;
};

/**
 * Ortamdan yapılandırılmış sağlayıcı zinciri. Hiçbiri yoksa TEK elemanlı bir
 * zincir döner: `UnconfiguredTryOnProvider`. Boş dizi dönmek, çağıran tarafta
 * "zincir bitti" ile "zincir hiç yoktu" durumlarını ayırt edilemez kılardı.
 *
 * ⚠️ Devre kesiciler sağlayıcı ADIYLA paylaşılır (`circuitFor`): API ve worker
 *    aynı süreçte olmasa bile aynı isim kullanılır, böylece bir sağlayıcının
 *    çökmesi tek bir yerde yönetilir.
 */
export function createTryOnProviders(config: TryOnEnv): TryOnProvider[] {
  const providers: TryOnProvider[] = [];

  if (isFalConfigured(config)) {
    providers.push(
      new FalTryOnProvider({
        apiKey: config.FAL_KEY,
        model: config.FAL_TRYON_MODEL,
        circuitBreaker: circuitFor('fal'),
      }),
    );
  }

  if (isGeminiConfigured(config)) {
    providers.push(
      new GeminiTryOnProvider({
        apiKey: config.GOOGLE_AI_API_KEY,
        model: config.GOOGLE_AI_IMAGE_MODEL,
        circuitBreaker: circuitFor('gemini'),
      }),
    );
  }

  return providers.length > 0 ? providers : [new UnconfiguredTryOnProvider()];
}
