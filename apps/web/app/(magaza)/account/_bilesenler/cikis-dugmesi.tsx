'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';

/**
 * ÇIKIŞ.
 *
 * ⚠️ `POST /api/auth/logout` — genel vekil DEĞİL, kendi handler'ı. O handler
 *    jeton bayatsa ÖNCE yeniliyor, SONRA API'ye çıkış diyor: 16 dakika bekleyip
 *    çıkışa basan kullanıcı aksi hâlde 401 alır ve oturumu sunucuda 30 GÜN
 *    yaşamaya devam ederdi (bkz. `app/api/auth/logout/route.ts`).
 *
 * ⚠️ Hata dalı YOK ve bu bilinçli: o handler her durumda 200 döner ve yerel
 *    oturumu her hâlükârda siler. "Çıkış yapamadınız" diyen bir ekran, ortak
 *    bilgisayarda oturumu açık bırakmanın en kibar yoludur.
 *
 * ⚠️ `refresh()` gerekli: hesap düzeni Sunucu Bileşeni ve çerezli hâli
 *    yönlendirmeden sonra da önbellekte durabilir.
 */
export function CikisDugmesi(): React.ReactElement {
  const router = useRouter();
  const [cikiliyor, setCikiliyor] = React.useState(false);

  async function cik(): Promise<void> {
    setCikiliyor(true);
    try {
      await apiFetch<{ loggedOut: true }, '/auth/logout'>('/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <Button variant="sessiz" size="sm" onClick={() => void cik()} disabled={cikiliyor}>
      <LogOut className="text-ikon" />
      {cikiliyor ? 'Çıkılıyor…' : 'Çıkış yap'}
    </Button>
  );
}
