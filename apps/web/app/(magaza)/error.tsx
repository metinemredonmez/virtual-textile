'use client';

import { HataGosterimi } from '@/components/hata/hata-gosterimi';

/**
 * ⚠️ Next hata sınırına DÜŞEN nesne artık `ApiFailure` DEĞİLDİR: sunucudan
 *    istemciye geçerken düz `Error`a sadeleşir ve yalnızca `message`/`digest`
 *    kalır. Bu yüzden burada kod bazlı davranış (rıza akışı, yeniden deneme)
 *    ARANMAZ; o kararlar hatanın oluştuğu yerde, `try/catch` içinde verilir.
 *    Bu sınır son çaredir.
 */
export default function MagazaError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-16">
      <HataGosterimi error={null} onRetry={reset} className="mx-auto max-w-md" />
    </div>
  );
}
