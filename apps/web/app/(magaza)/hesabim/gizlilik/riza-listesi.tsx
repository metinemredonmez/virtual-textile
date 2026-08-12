'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api/client';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { FOTOGRAF_TASIYAN_RIZALAR, RIZA_METNI } from '../_lib/etiketler';
import { tarihSaat } from '@/lib/tarih';
import type { ConsentStateWire, ConsentWriteWire } from '@vt/contracts';

/**
 * RIZA LİSTESİ — verme ve GERİ ÇEKME.
 *
 * ⚠️ GERİ ÇEKME BİR "KAPAT" DEĞİL, YENİ BİR BEYANDIR. Sunucu kaydı
 *    APPEND-ONLY tutuyor: mevcut satır güncellenmiyor, `granted=false` olan
 *    yeni bir satır yazılıyor (`me.service.ts`). Bu yüzden uç POST ve bu
 *    yüzden ekran "geçmiş"i de gösteriyor — "ne zaman verdim, ne zaman geri
 *    çektim" sorusunun cevabı KVKK gereği kullanıcıda olmalı.
 *
 * ⚠️ FOTOĞRAF TAŞIYAN RIZALAR ONAY İSTER. `PHOTO_PROCESSING` veya
 *    `CROSS_BORDER_TRANSFER` geri çekildiğinde sunucu fotoğrafları SİLİNMEK
 *    ÜZERE İŞARETLİYOR ve bu geri alınamaz. Tek tıkla olan, sonucu
 *    söylenmeyen bir işlem değil.
 *
 * ⚠️ Onay metninde "silinecek" YAZILMAZ, "silinmek üzere işaretlenecek"
 *    yazılır: silme işini `PhotoRetentionJob` yapıyor ve senkron değil. Anında
 *    silindiğini söylemek, birkaç dakika sonra hâlâ görünen bir sonuç
 *    karşısında kullanıcıyı haklı olarak şüpheye düşürür.
 */
export function RizaListesi({
  rizalar,
  yururluktekiSurum,
}: {
  rizalar: ConsentStateWire[];
  yururluktekiSurum: string;
}): React.ReactElement {
  const router = useRouter();
  const [hata, setHata] = React.useState<unknown>(null);
  const [islemdeki, setIslemdeki] = React.useState<string | null>(null);
  const [onayBekleyen, setOnayBekleyen] = React.useState<ConsentStateWire | null>(null);
  const [sonYazim, setSonYazim] = React.useState<ConsentWriteWire | null>(null);

  async function yaz(riza: ConsentStateWire, granted: boolean): Promise<void> {
    setIslemdeki(riza.type);
    setHata(null);
    setOnayBekleyen(null);

    try {
      const { data } = await apiFetch<ConsentWriteWire, '/me/consents'>('/me/consents', {
        method: 'POST',
        json: { type: riza.type, granted },
      });
      setSonYazim(data);
      router.refresh();
    } catch (error) {
      setHata(error);
    } finally {
      setIslemdeki(null);
    }
  }

  function degistir(riza: ConsentStateWire): void {
    const geriCekiliyor = riza.granted;
    if (geriCekiliyor && FOTOGRAF_TASIYAN_RIZALAR.includes(riza.type)) {
      setOnayBekleyen(riza);
      return;
    }
    void yaz(riza, !riza.granted);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-metin-soluk">
        Yürürlükteki aydınlatma metni sürümü: <span className="rakam">{yururluktekiSurum}</span>
      </p>

      <ul className="flex flex-col gap-4">
        {rizalar.map((riza) => {
          const metin = RIZA_METNI[riza.type];
          return (
            <li
              key={riza.type}
              className="flex flex-col gap-2 border-b border-kenar pb-4 last:border-b-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-metin">{metin.baslik}</span>
                  {/* Rıza durumu bir DURUMdur; rengin izinli olduğu yer. */}
                  <Badge durum={riza.granted ? 'olumlu' : 'notr'}>
                    {riza.granted ? 'Rıza verildi' : 'Rıza yok'}
                  </Badge>
                </span>

                <Button
                  variant={riza.granted ? 'sessiz' : 'ikincil'}
                  size="sm"
                  disabled={islemdeki !== null}
                  onClick={() => degistir(riza)}
                >
                  {riza.granted ? 'Rızayı geri çek' : 'Rıza ver'}
                </Button>
              </div>

              <p className="text-sm text-metin-soluk">{metin.aciklama}</p>

              {/* ⚠️ Sürüm sapması GİZLENMEZ: kullanıcı ESKİ metne rıza vermiş
                  olabilir ve hangi metni onayladığını bilmeye hakkı var. */}
              {riza.granted &&
              riza.documentVersion &&
              riza.documentVersion !== yururluktekiSurum ? (
                <p className="text-xs text-uyari">
                  Bu rıza <span className="rakam">{riza.documentVersion}</span> sürümlü metne
                  dayanıyor; yürürlükteki metin daha yeni.
                </p>
              ) : null}

              <RizaGecmisi riza={riza} />
            </li>
          );
        })}
      </ul>

      {sonYazim ? (
        <p role="status" className="text-sm text-metin-soluk">
          {sonYazim.changed
            ? `Tercihiniz kaydedildi (${tarihSaat(sonYazim.recordedAt)}).`
            : `Aynı tercih yeniden kaydedildi (${tarihSaat(sonYazim.recordedAt)}).`}
          {sonYazim.photosMarkedForDeletion > 0 ? (
            <>
              {' '}
              <span className="rakam">{sonYazim.photosMarkedForDeletion}</span> fotoğraf silinmek
              üzere işaretlendi.
            </>
          ) : null}
        </p>
      ) : null}

      {hata ? <HataGosterimi error={hata} /> : null}

      <Dialog open={onayBekleyen !== null} onOpenChange={(acik) => !acik && setOnayBekleyen(null)}>
        <DialogContent>
          <DialogTitle className="text-base font-semibold">
            Rızayı geri çekmek üzeresiniz
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm text-metin-soluk">
            {onayBekleyen ? RIZA_METNI[onayBekleyen.type].baslik : ''} rızasını geri çektiğinizde
            yüklediğiniz fotoğraflar ve bu fotoğraflardan üretilmiş sanal deneme görselleri silinmek
            üzere işaretlenir. Sanal deneme özelliği, rızayı yeniden verene kadar çalışmaz. Bu işlem
            geri alınamaz.
          </DialogDescription>

          <div className="mt-6 flex gap-3">
            <Button
              variant="tehlike"
              disabled={islemdeki !== null}
              onClick={() => onayBekleyen && void yaz(onayBekleyen, false)}
            >
              Rızayı geri çek
            </Button>
            <Button variant="sessiz" onClick={() => setOnayBekleyen(null)}>
              Vazgeç
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * ⚠️ Geçmişin TAMAMI değil, son iki olayı gösteriliyor; tamamı bir ayrıntı
 *    bloğunda. KVKK "her an cevaplanabilsin" diyor, "ekranı doldursun" demiyor
 *    — 30 satırlık bir zaman çizelgesi, asıl karar düğmelerini ekranın dışına
 *    iter.
 */
function RizaGecmisi({ riza }: { riza: ConsentStateWire }): React.ReactElement | null {
  if (riza.history.length === 0) {
    return <p className="text-xs text-metin-soluk">Bu konuda henüz bir beyanınız yok.</p>;
  }

  return (
    <details className="text-xs text-metin-soluk">
      <summary className="cursor-pointer">
        {riza.since ? `Son değişiklik: ${tarihSaat(riza.since)}` : 'Geçmiş'} ·{' '}
        <span className="rakam">{riza.history.length}</span> kayıt
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {riza.history.map((olay, index) => (
          <li key={`${olay.at}-${index}`}>
            {olay.granted ? 'Rıza verildi' : 'Rıza geri çekildi'} · {tarihSaat(olay.at)} ·{' '}
            <span className="rakam">{olay.documentVersion}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
