'use client';

import { HataGosterimi } from '@/components/hata/hata-gosterimi';

/**
 * ⚠️ Next hata sınırına DÜŞEN nesne artık `ApiFailure` DEĞİLDİR: sunucudan
 *    istemciye geçerken düz `Error`a sadeleşir ve yalnızca `message`/`digest`
 *    kalır. Bu yüzden burada kod bazlı davranış (rıza akışı, yeniden deneme)
 *    ARANMAZ; o kararlar hatanın oluştuğu yerde, `try/catch` içinde verilir.
 *    Bu sınır son çaredir.
 *
 * ⚠️ "SON ÇARE"NİN BEDELİ ÖLÇÜLDÜ, ve bu kutuyu görmek bir ARIZA işaretidir.
 *    Hız limiti kasten tetiklendiğinde (60 sn içinde 330 istek → API `429`,
 *    `retryAfterSeconds: 50`) `/products?q=zzz1` şunu döndürdü:
 *    **HTTP 200**, gövde 38 733 bayt, ürün kartı **0**, ekranda
 *    "Beklenmeyen bir hata" + "Tekrar dene". Kullanıcıya söylenebilecek en
 *    doğru şey ("50 saniye sonra tekrar deneyin") elimizdeyken KAYBOLDU,
 *    çünkü kod bu sınıra ulaşmıyor. Liste ekranı bu yüzden hatayı artık
 *    KENDİ yakalıyor (`products/_liste/urun-listesi.tsx`).
 *
 * ⚠️ VE BU KUTU TARAMALARDA GÖRÜNMEZ: sayfa **200** döner. Durum koduna bakan
 *    bir ölü-bağlantı taraması burayı SAĞLAM sayar. Kabul ölçütü §12'de
 *    genişletildi: tarama sırasında sunucu logunda `⨯` satırı olmayacak.
 */
export default function MagazaError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-16">
      <HataGosterimi error={null} onRetry={reset} className="mx-auto max-w-md" />
    </div>
  );
}
