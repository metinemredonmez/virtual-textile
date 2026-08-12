import { TRYON } from '@vt/config/constants';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * TRY-ON UYGUNLUK SKORU — SAYIYI EYLEME ÇEVİREN KATALOG.
 *
 * ⚠️ CÜMLELER YENİDEN YAZILMADI. Backend `buildSuggestions`
 *    (`apps/api/src/modules/media/tryon-readiness.ts`) bu metinleri ZATEN
 *    üretiyor ve GÖRSEL ONAY yanıtında (`POST .../images/:id/confirm`)
 *    gönderiyor. Ama ürün listesi/detayı yalnız `tryOnScore` + `tryOnIssues`
 *    (kod dizisi) döndürüyor — cümle GELMİYOR. Buradaki katalog o iki ekranı
 *    aynı metne bağlar.
 *
 * ⚠️ TEK FARK sayı: backend "3 görselde arka plan kalabalık" diyebiliyor çünkü
 *    o an baytları saymış. Ürün ekranında o sayı YOK, o yüzden buradaki
 *    cümleler sayısız kurulmuş. Sayı uydurulmaz.
 *
 * ⚠️ İKİNCİ KOPYA YAZILMAZ. Görsel yükleme ekranı skoru confirm yanıtından
 *    alır ve OLDUĞU GİBİ basar (`suggestions[].message`); bu katalog yalnızca
 *    cümlenin gelmediği yolda kullanılır. İki ekran iki farklı cümle kurarsa
 *    satıcı aynı sorun için iki ayrı iş yapmaya çalışır.
 *
 * ⚠️ ÜÇ EKRAN OKUYOR: satıcı ürün detayı, satıcı görsel yükleme ve yönetim
 *    moderasyon kuyruğu. Bir dönem satıcı panelinin `_lib`indeydi ve moderasyon
 *    ekranı kendi eşiğini ayrıca tanımlamıştı; ikisi ayrıştığında satıcı,
 *    yönetimin "yetersiz" dediği bir üründe hiçbir uyarı görmezdi.
 */

/** `apps/api/.../tryon-readiness.ts` → `TryOnReadinessIssue`. Sekiz kod, tamamı. */
export type TryOnSorunKodu =
  | 'no_images'
  | 'low_resolution'
  | 'busy_background'
  | 'cropped_subject'
  | 'missing_front_angle'
  | 'missing_back_angle'
  | 'missing_side_angle'
  | 'missing_model_shot';

interface SorunBilgisi {
  /** Satıcının doğrudan uygulayabileceği eylem. */
  readonly eylem: string;
  /** Bu düzeltmenin azami kazancı — sıralama ve "kaç puan" için. */
  readonly azamiKazanc: number;
}

/**
 * ⚠️ Ağırlıklar backend'den birebir: çözünürlük 25, arka plan 25,
 *    kırpılmamış 20, üç açı 20 (her biri ~7), model üzerinde 10.
 */
const SORUNLAR: Record<TryOnSorunKodu, SorunBilgisi> = {
  no_images: {
    eylem: 'Ürüne henüz görsel eklenmemiş. En az bir ön, bir arka ve bir yan görsel yükleyin.',
    azamiKazanc: 100,
  },
  busy_background: {
    eylem: 'Arka plan kalabalık. Ürünü düz beyaz veya açık gri bir fon önünde, gölgesiz çekin.',
    azamiKazanc: 25,
  },
  low_resolution: {
    eylem:
      'Görsel genişliği 1024 pikselin altında. Aynı çekimleri en az 1024 piksel genişliğinde yeniden yükleyin.',
    azamiKazanc: 25,
  },
  cropped_subject: {
    eylem:
      'Ürün kadraja sığmamış. Ürünün tamamı çerçevenin içinde kalacak ve kenarlarda boşluk bırakacak şekilde çekin.',
    azamiKazanc: 20,
  },
  missing_front_angle: {
    eylem:
      'Ön açı eksik. Sanal deneme kıyafetin görmediği tarafını tahmin etmek zorunda kalır; ön görseli ekleyin.',
    azamiKazanc: 7,
  },
  missing_back_angle: {
    eylem:
      'Arka açı eksik. Sanal deneme kıyafetin görmediği tarafını tahmin etmek zorunda kalır; arka görseli ekleyin.',
    azamiKazanc: 7,
  },
  missing_side_angle: {
    eylem:
      'Yan açı eksik. Sanal deneme kıyafetin görmediği tarafını tahmin etmek zorunda kalır; yan görseli ekleyin.',
    azamiKazanc: 6,
  },
  missing_model_shot: {
    eylem:
      'Ürünün model veya manken üzerindeki bir görselini ekleyin (açı: MODEL). Kıyafetin vücutta nasıl durduğu yalnızca bu çekimden anlaşılır.',
    azamiKazanc: 10,
  },
};

function sorunKoduMu(deger: unknown): deger is TryOnSorunKodu {
  return typeof deger === 'string' && deger in SORUNLAR;
}

/**
 * `tryOnIssues` alanı telde `unknown`: JSON kolonu, `null` da olabilir dizi de.
 *
 * ⚠️ `.map()` çağırmadan önce BURADAN geçirilir. Skoru `null` olan üründe
 *    `tryOnIssues` da `null` gelir; doğrudan map çağıran bir ekran o üründe
 *    çöker — ve o ürün "hiç görseli olmayan yeni ürün", yani ekranın en sık
 *    göreceği hâl.
 */
export function sorunlariCoz(ham: unknown): TryOnSorunKodu[] {
  if (!Array.isArray(ham)) return [];
  return ham.filter(sorunKoduMu);
}

/** Kazancı en büyük olan başta — satıcının ilk yapacağı iş en çok getiren iş. */
export function oneriler(
  kodlar: readonly TryOnSorunKodu[],
): Array<{ kod: TryOnSorunKodu; eylem: string; kazanc: number }> {
  return kodlar
    .map((kod) => ({ kod, eylem: SORUNLAR[kod].eylem, kazanc: SORUNLAR[kod].azamiKazanc }))
    .sort((a, b) => b.kazanc - a.kazanc);
}

/**
 * ⚠️ EŞİK ARTIK KOPYA DEĞİL: `@vt/config` → `TRYON.minProductReadinessScore`.
 *    Backend aynı sabiti okuyor (`MIN_TRYON_READINESS_SCORE` artık ondan
 *    türüyor). Üç kopya vardı; ayrıştıkları gün satıcı, backend'in
 *    "iyileştirme gerekli" dediği bir üründe uyarı GÖRMEZDİ.
 *
 * ⚠️ `TRYON.lowConfidenceThreshold` DEĞİL — o, üretilmiş görselin güven
 *    skorunun eşiği. Bugün ikisi de 60; biri değiştiğinde karıştıran kod
 *    sessizce yanlış olur.
 */
export const TRYON_ESIK: number = TRYON.minProductReadinessScore;

/**
 * Skorun rozet durumu.
 *
 * ⚠️ `null` RENK ALMAZ. Hiç görseli olmayan ürünün skoru hesaplanmamıştır;
 *    "0/100" yazıp kırmızı boyamak, satıcıya ölçülmemiş bir başarısızlık
 *    bildirmek olurdu.
 */
export function skorRozeti(skor: number | null): NonNullable<BadgeProps['durum']> {
  if (skor === null) return 'notr';
  return skor < TRYON_ESIK ? 'uyari' : 'olumlu';
}
