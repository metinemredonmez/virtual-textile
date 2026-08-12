'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Monitor } from 'lucide-react';
import type { SessionSummary } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { tarihSaat } from '@/lib/tarih';

/**
 * AÇIK OTURUMLAR — cihaz bazlı, tekil kapatma.
 *
 * ⚠️ BU LİSTE API OTURUMLARIDIR (`user_sessions`), web oturumu (`vt_sid`)
 *    değil. İkisi 1:1 eşleşiyor: `vt_sid` tek bir API oturumunun jetonlarını
 *    taşıyor. Pratik sonucu şu: BU CİHAZIN satırını kapatmak, kullanıcının
 *    kendisini atmasıdır. O yüzden `current` satırında "kapat" değil "çıkış
 *    yap" akışı çalışır — aksi hâlde ekran açık kalır, her tıklama 401 döner
 *    ve kullanıcı ne olduğunu anlamaz.
 *
 * ⚠️ Liste sunucudan prop olarak geliyor, burada yeniden çekilmiyor:
 *    `SessionSummary` düz bir nesne, RSC sınırından sorunsuz geçer. İstemcide
 *    ikinci bir okuma, ilk boyamada boş bir liste göstermek olurdu.
 */
export function OturumListesi({ oturumlar }: { oturumlar: SessionSummary[] }): React.ReactElement {
  const router = useRouter();
  const [hata, setHata] = React.useState<unknown>(null);
  const [islemdeki, setIslemdeki] = React.useState<string | null>(null);

  async function kapat(oturum: SessionSummary): Promise<void> {
    setIslemdeki(oturum.id);
    setHata(null);

    try {
      if (oturum.current) {
        // Kendi oturumumuz: yerel `vt_sid` de silinmeli, yoksa ölü bir jetona
        // işaret eden bir çerezle dolaşırız.
        await apiFetch<{ loggedOut: true }, '/auth/logout'>('/auth/logout', { method: 'POST' });
        router.replace('/giris');
        router.refresh();
        return;
      }

      // ⚠️ 204 döner, gövdesi yoktur. `unwrap` bunu ele alıyor; elle
      //    `res.json()` çağıran bir istemci başarılı bir isteği hata sanardı.
      await apiFetch<undefined, `/auth/sessions/${string}`>(`/auth/sessions/${oturum.id}`, {
        method: 'DELETE',
      });
      router.refresh();
    } catch (error) {
      setHata(error);
    } finally {
      setIslemdeki(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {oturumlar.map((oturum) => (
          <li
            key={oturum.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-kenar pb-3 last:border-b-0 last:pb-0"
          >
            <div className="flex items-start gap-3">
              <Monitor className="mt-0.5 size-4 shrink-0 text-ikon" />
              <div>
                <p className="flex items-center gap-2 text-sm text-metin">
                  {oturum.deviceLabel ?? 'Bilinmeyen cihaz'}
                  {/* "Bu cihaz" bir DURUMdur: kullanıcının hangi satırı
                      kapatmaması gerektiğini söyler. */}
                  {oturum.current ? <Badge durum="olumlu">Bu cihaz</Badge> : null}
                </p>
                <p className="rakam text-xs text-metin-soluk">
                  {oturum.ipAddress} · son kullanım {tarihSaat(oturum.lastUsedAt)}
                </p>
              </div>
            </div>

            <Button
              variant={oturum.current ? 'ikincil' : 'sessiz'}
              size="sm"
              disabled={islemdeki !== null}
              onClick={() => void kapat(oturum)}
            >
              {oturum.current ? 'Çıkış yap' : 'Oturumu kapat'}
            </Button>
          </li>
        ))}
      </ul>

      {hata ? <HataGosterimi error={hata} /> : null}
    </div>
  );
}
