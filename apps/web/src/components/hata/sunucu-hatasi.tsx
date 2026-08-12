'use client';

import * as React from 'react';
import { ApiFailure, type ApiErrorBody } from '@vt/contracts';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';

/**
 * Sunucu Bileşeninde yakalanmış bir hatanın gösterimi.
 *
 * ⚠️ `ApiFailure` BURADA yeniden kuruluyor, sunucuda değil: sınıf örneği RSC
 *    sınırından geçemez (bkz. `hata-koprusu.ts`). Düz gövde geçer, nesne
 *    istemcide doğar ve `HataGosterimi` yine `error.code` üzerinden davranış
 *    seçebilir. Aksi hâlde her sunucu hatası "bilinmeyen hata" dalına düşer ve
 *    `retry-policy.ts` devre dışı kalırdı.
 *
 * ⚠️ "Tekrar dene" düğmesi BURADA VERİLMEZ. Sayfa bir Sunucu Bileşeni;
 *    istemcide çağrılacak bir yeniden-getirme fonksiyonu yok. Düğme koyup
 *    `location.reload()` çağırmak, katalogda `geri-sayim` ya da `yok` yazan
 *    kodlarda kullanıcıyı aynı duvara tekrar tekrar çarptırırdı.
 */
export function SunucuHatasi({
  govde,
  className,
}: {
  govde: ApiErrorBody;
  className?: string;
}): React.ReactElement {
  const hata = React.useMemo(() => new ApiFailure(govde), [govde]);
  return <HataGosterimi error={hata} className={className} />;
}
