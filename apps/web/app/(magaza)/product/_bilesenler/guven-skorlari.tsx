import * as React from 'react';
import { TRYON } from '@vt/config/constants';
import { Badge } from '@/components/ui/badge';

/**
 * GÜVEN SKORLARI — İKİ AYRI SATIR, İKİ AYRI SORU.
 *
 * ⚠️ TEK BİRLEŞİK ROZET YAZILMAZ ("%85 uyumlu"). Kıyafetin görselde iyi durması
 *    fiziksel olarak oturacağı anlamına GELMEZ; ikisini ortalayan bir sayı,
 *    kullanıcıyı görsele bakıp yanlış beden almaya iter. Görsel benzerliği
 *    sağlayıcının ürettiği görselin ne kadar inandırıcı olduğunu, beden uyumu
 *    ölçü tablosuyla vücut ölçüsünün ne kadar örtüştüğünü söyler.
 *
 * ⚠️ Renk BURADA bilgi taşır: eşik altı güven bir DURUMdur. Süs değil.
 */

interface SkorSatiriProps {
  etiket: string;
  deger: number | null;
  /** Değer yoksa ne yazılacağı — boş satır bırakmak "hesaplandı ve 0" gibi okunur. */
  yerine: string;
  dusuk: boolean;
}

function SkorSatiri({ etiket, deger, yerine, dusuk }: SkorSatiriProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-metin-soluk">{etiket}</span>
      {deger === null ? (
        <span className="text-sm text-metin-soluk">{yerine}</span>
      ) : (
        <Badge durum={dusuk ? 'uyari' : 'notr'} className="rakam">
          %{Math.round(deger)}
        </Badge>
      )}
    </div>
  );
}

export interface GuvenSkorlariProps {
  /** `TryOnJob.visualConfidence` — 0–100. */
  gorselGuveni: number | null;
  /** `SizeRecommendation.confidence` — 0–100. */
  bedenGuveni: number | null;
  /**
   * ⚠️ Sunucunun kararı. Eşik istemcide YENİDEN HESAPLANMAZ; iki yerde tutulan
   *    bir eşik, biri değişip diğeri unutulduğunda sunucunun "gösterme" dediği
   *    zayıf öneriyi ekrana koyardı.
   */
  bedenGosterilsin: boolean;
  className?: string;
}

export function GuvenSkorlari({
  gorselGuveni,
  bedenGuveni,
  bedenGosterilsin,
  className,
}: GuvenSkorlariProps): React.ReactElement {
  const gorselDusuk = gorselGuveni !== null && gorselGuveni < TRYON.lowConfidenceThreshold;

  return (
    <div className={className}>
      <SkorSatiri
        etiket="Görsel benzerliği"
        deger={gorselGuveni}
        yerine="Deneme yapılmadı"
        dusuk={gorselDusuk}
      />
      <SkorSatiri
        etiket="Beden uyumu"
        deger={bedenGosterilsin ? bedenGuveni : null}
        yerine="Ölçüleriniz gerekli"
        dusuk={false}
      />

      {gorselDusuk ? (
        <p className="mt-2 text-xs text-metin-soluk">
          Görselin benzerliği düşük çıktı. Tüm vücudunuzun göründüğü, önden çekilmiş ve aydınlık bir
          fotoğrafla sonuç belirgin biçimde iyileşir.
        </p>
      ) : null}
    </div>
  );
}
