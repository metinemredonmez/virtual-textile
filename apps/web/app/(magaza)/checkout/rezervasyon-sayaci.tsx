'use client';

import * as React from 'react';
import { Timer } from 'lucide-react';
import { INVENTORY } from '@vt/config/constants';

/**
 * REZERVASYON GERİ SAYIMI.
 *
 * `checkout/init` stoğu `INVENTORY.reservationTtlMinutes` (15 dk) boyunca
 * rezerve ediyor. Süre görünmezse kullanıcı ödeme formunda oyalanır ve
 * `checkout/pay` çağrısında `ORDER_RESERVATION_EXPIRED` duvarına toslar —
 * hiçbir uyarı almadan.
 *
 * ⚠️ SÜRE SUNUCUNUN VERDİĞİ ANDAN SAYILIR (`reservationExpiresAt`), 15
 *    dakikadan geriye değil. `init` yanıtı ile ekranın çizilmesi arasında ağ
 *    gecikmesi var; yerelde 15 dakika saymak kullanıcıya sunucudan daha uzun
 *    bir süre vaat ederdi ve fark tam da son saniyede ortaya çıkardı.
 *
 * ⚠️ İSTEMCİ SAATİNE GÜVENİLMİYOR — ama kaçınılmaz olarak kullanılıyor:
 *    `Date.now()` istemcinin saati. Saati kayan bir kullanıcıda sayaç yanlış
 *    olur; bu yüzden sayaç bir GÜVENCE DEĞİL, bir uyarıdır ve gerçek karar
 *    daima sunucudadır (`pay` süreyi kendisi kontrol ediyor). Sayaç sıfırlanınca
 *    ekran ödemeyi kapatmaz, ne olacağını YAZAR.
 *
 * ⚠️ İlk render sunucuda da çalışır ve orada `Date.now()` FARKLI bir değer
 *    üretir → hidrasyon uyuşmazlığı. Bu yüzden sayaç değeri ilk boyamada
 *    yazılmaz; `useEffect` çalışana kadar `null`.
 */
export function RezervasyonSayaci({
  bitis,
  onDoldu,
}: {
  /** ISO 8601 — `CheckoutInitResultWire.reservationExpiresAt`. */
  bitis: string;
  onDoldu?: () => void;
}): React.ReactElement {
  const [kalanMs, setKalanMs] = React.useState<number | null>(null);
  const dolduBildirildi = React.useRef(false);

  React.useEffect(() => {
    const hedef = new Date(bitis).getTime();

    const guncelle = () => {
      const kalan = Math.max(0, hedef - Date.now());
      setKalanMs(kalan);
      if (kalan === 0 && !dolduBildirildi.current) {
        dolduBildirildi.current = true;
        onDoldu?.();
      }
    };

    guncelle();
    const zamanlayici = setInterval(guncelle, 1000);
    return () => clearInterval(zamanlayici);
  }, [bitis, onDoldu]);

  const doldu = kalanMs === 0;

  return (
    <div
      className={[
        'flex items-start gap-2 rounded-md border p-3 text-sm',
        // ⚠️ Renk DURUM taşıyor: süre dolduğunda gerçekten bir şey değişti.
        doldu ? 'border-kenar bg-tehlike-zemin text-tehlike' : 'border-kenar bg-yuzey text-metin',
      ].join(' ')}
      // Sayaç her saniye değişiyor; `polite` olmasaydı ekran okuyucu saniyede
      // bir konuşurdu.
      aria-live="polite"
    >
      <Timer className={['mt-0.5 size-4 shrink-0', doldu ? '' : 'text-ikon'].join(' ')} />
      <div>
        {doldu ? (
          <>
            <p className="font-medium">Stok rezervasyonunuzun süresi doldu.</p>
            <p className="mt-1 text-metin-soluk">
              Ürünler yeniden satışa açıldı. Ödemeyi başlatmayı denerseniz sipariş reddedilir;
              sepetinize dönüp ödemeyi yeniden başlatmanız gerekir. Sepetiniz silinmedi.
            </p>
          </>
        ) : (
          <>
            <p>
              Sepetinizdeki ürünler{' '}
              <span className="rakam font-medium">{kalanMs === null ? '—' : bicim(kalanMs)}</span>{' '}
              boyunca sizin için ayrıldı.
            </p>
            <p className="mt-1 text-metin-soluk">
              Süre dolduğunda ürünler yeniden satışa açılır ve ödemeyi yeniden başlatmanız gerekir.
              Rezervasyon {INVENTORY.reservationTtlMinutes} dakikadır.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** 125000 → "2:05" */
function bicim(ms: number): string {
  const toplamSaniye = Math.ceil(ms / 1000);
  const dakika = Math.floor(toplamSaniye / 60);
  const saniye = toplamSaniye % 60;
  return `${dakika}:${String(saniye).padStart(2, '0')}`;
}
