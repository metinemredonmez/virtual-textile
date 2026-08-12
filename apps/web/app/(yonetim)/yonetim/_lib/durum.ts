import type { FraudAlertWire } from '@vt/contracts';
import { TRYON_ESIK, skorRozeti } from '@/components/tryon/tryon-oneriler';
import { SATICI_DURUMU, URUN_DURUMU, type DurumGorunumu } from '@/lib/durum-etiketleri';

/**
 * YÖNETİME ÖZGÜ DURUM GÖRÜNÜMLERİ.
 *
 * ⚠️ SATICI VE ÜRÜN DURUMU BURADA TANIMLI DEĞİL — `lib/durum-etiketleri.ts`ten
 *    okunuyor. Bir dönem burada ikinci kopyaları duruyordu ve etiketleri
 *    satıcı panelindekiyle birebir aynıydı; ayrıştıkları gün yönetici ile satıcı
 *    aynı ürün için iki farklı durum adı okurdu.
 *
 * ⚠️ Burada kalanlar YALNIZCA yönetimin gördüğü şeyler: dolandırıcılık uyarısı
 *    ve satıcı belgesi. İkisinin de müşteri/satıcı tarafında karşılığı yok.
 */
export type { DurumGorunumu };

export function saticiDurumu(status: keyof typeof SATICI_DURUMU): DurumGorunumu {
  return SATICI_DURUMU[status];
}

export function urunDurumu(status: keyof typeof URUN_DURUMU): DurumGorunumu {
  return URUN_DURUMU[status];
}

/**
 * TRY-ON UYGUNLUK SKORU.
 *
 * ⚠️ EŞİK AYNALANMIYOR ARTIK: `@vt/config` → `TRYON.minProductReadinessScore`,
 *    ve rozet kararı satıcı panelinin okuduğu `skorRozeti()` ile AYNI
 *    fonksiyondan geliyor. Üç kopya vardı (backend sabiti, satıcı `TRYON_ESIK`,
 *    buradaki `TRYON_UYGUNLUK_ESIGI`); ayrıştıkları gün yönetici "yetersiz"
 *    dediği bir üründe satıcının hiçbir uyarı görmediğini fark etmezdi.
 *
 * ⚠️ `null` = HİÇ ÖLÇÜLMEDİ, sıfır değil — ve renk ALMAZ. Yönetici "kötü skor"
 *    ile "görsel yüklenmemiş" arasındaki farkı göremezse yanlış ürünü reddeder.
 */
export function tryOnSkoru(score: number | null): DurumGorunumu | null {
  if (score === null) return null;
  return { metin: `${score}/100`, rozet: skorRozeti(score) };
}

export { TRYON_ESIK };

const UYARI_SIDDETI: Readonly<Record<FraudAlertWire['severity'], DurumGorunumu>> = {
  LOW: { metin: 'Düşük', rozet: 'notr' },
  MEDIUM: { metin: 'Orta', rozet: 'uyari' },
  HIGH: { metin: 'Yüksek', rozet: 'tehlike' },
};

export function uyariSiddeti(severity: FraudAlertWire['severity']): DurumGorunumu {
  return UYARI_SIDDETI[severity];
}

/**
 * ⚠️ Uyarı TÜRÜ renk TAŞIMAZ — şiddeti taşır. Tür yalnızca "ne olduğunu"
 *    söyler; aciliyeti `severity` söyler ve rozet zaten onda.
 */
const UYARI_TURU: Readonly<Record<FraudAlertWire['type'], string>> = {
  CARD_TESTING: 'Kart deneme',
  HIGH_RETURN_RATE: 'Yüksek iade oranı',
  UNUSUAL_ORDER_VALUE: 'Olağandışı sipariş tutarı',
  RAPID_ORDER_CANCELLATION: 'Hızlı sipariş iptali',
};

export function uyariTuru(type: FraudAlertWire['type']): string {
  return UYARI_TURU[type];
}

/**
 * BELGE İNCELEME DURUMU.
 *
 * ⚠️ Üç değerli ve üçüncüsü `null`: "incelenmedi" ile "reddedildi" AYNI ŞEY
 *    DEĞİL. `approved === false` olan bir belgeyi "henüz incelenmedi" diye
 *    göstermek, yöneticiye zaten verdiği kararı yeniden aldırır.
 */
export function belgeDurumu(approved: boolean | null): DurumGorunumu {
  if (approved === null) return { metin: 'İncelenmedi', rozet: 'notr' };
  return approved ? { metin: 'Kabul', rozet: 'olumlu' } : { metin: 'Ret', rozet: 'tehlike' };
}
