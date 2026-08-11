import { appError } from '@vt/contracts';
import type { LlmProvider, LlmStreamEvent, LlmTurnRequest } from '../stylist.ports.js';

/**
 * LLM SAĞLAYICISI — ANAHTARSIZ YOL
 *
 * ⚠️ Bu dosya artık yalnızca YEDEĞİ tanımlar. Gerçek bağlama yapıldı:
 *      • adapter  : `packages/adapters/src/ai/anthropic.ts` (AnthropicLlmProvider)
 *      • köprü    : `./anthropic-llm.bridge.ts` (adapter → stylist portu)
 *      • seçim    : `../index.ts` → `createLlmProvider()` ORTAMDAN seçer
 *
 * Olay, durma nedeni ve araç şeması eşlemeleri köprü dosyasında yaşar ve
 * BURADA TEKRARLANMAZ — iki yerde duran bir eşleme tablosu er geç ayrışır ve
 * hangisinin doğru olduğu ancak üretimde anlaşılır.
 *
 * Seçim kuralı: ANTHROPIC_API_KEY varsa köprü, yoksa aşağıdaki
 * `UnavailableLlmProvider`. Anahtarsız yolda uygulama açılır, ticaret akışı
 * çalışır, yalnızca /stylist uçları 503 döner. Yanlış olan seçenek "hazırım"
 * deyip ilk kullanıcı mesajında patlamaktı.
 */

/**
 * Sağlayıcı yokken kullanılan yedek.
 *
 * ⚠️ ZARİF DÜŞÜŞ: danışman kapalıyken kullanıcı gezinmeye, sepete atmaya ve
 *    satın almaya devam eder. Buradaki hata ticaret akışına yayılmaz.
 */
export class UnavailableLlmProvider implements LlmProvider {
  readonly name = 'unavailable';
  readonly model = 'none';
  readonly isConfigured = false;

  streamTurn(_request: LlmTurnRequest): AsyncIterable<LlmStreamEvent> {
    throw appError('STYLIST_UNAVAILABLE', {
      internalMessage: 'LLM sağlayıcısı yapılandırılmadı: ANTHROPIC_API_KEY yok',
    });
  }
}

/**
 * Anahtarsız yolun fabrikası.
 *
 * ⚠️ SEÇİMİ BU FABRİKA YAPMAZ. Karar `../index.ts` içindeki
 *    `createLlmProvider()`ta, tek yerde verilir; burası yalnızca yedeği kurar.
 */
export function createStylistLlmProvider(): LlmProvider {
  return new UnavailableLlmProvider();
}
