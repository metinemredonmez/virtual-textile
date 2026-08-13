'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { isApiFailure } from '@vt/contracts';
import { apiFetch, newIdempotencyKey } from '@/lib/api/client';
import { otomatikTekrarla } from '@/lib/api/retry-policy';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { IADE_SEBEBI } from '../../_lib/etiketler';
import type { ReturnCreatedWire, ReturnReasonWire } from '@vt/contracts';

export interface IadeKalemi {
  id: string;
  baslik: string;
  varyant: string;
  /** Bu kalemden hâlâ iade edilebilir adet — sunucudaki açık iadeler düşülmüş. */
  kalanAdet: number;
}

/**
 * İADE TALEBİ.
 *
 * ⚠️ `POST /orders/:id/returns` `Idempotency-Key` ZORUNLU bir uçtur (para
 *    hareketi başlatır) ve anahtar TİPTE dayatılıyor: vermeden çağırmak
 *    DERLENMEZ.
 *
 * ⚠️ ANAHTAR `useRef`TE ve NİYETE BAĞLI. `useState`te tutulsaydı her render
 *    yeni anahtar üretir ve "tekrar dene" İKİNCİ BİR İADE açardı. Ama sabit
 *    tek bir anahtar da yanlış olurdu: kullanıcı seçimi değiştirip yeniden
 *    gönderdiğinde sunucu ilk yanıtı 24 saat geri oynatır ve kullanıcı
 *    değiştirdiği talebin işlendiğini sanır. Bu yüzden anahtar YÜKÜN İMZASINA
 *    bağlı: aynı talep = aynı anahtar, değişen talep = yeni niyet.
 */
export function IadeFormu({
  siparisId,
  paketAdi,
  kalemler,
}: {
  siparisId: string;
  paketAdi: string;
  kalemler: IadeKalemi[];
}): React.ReactElement {
  const router = useRouter();
  const [acik, setAcik] = React.useState(false);
  const [adetler, setAdetler] = React.useState<Record<string, number>>({});
  const [sebep, setSebep] = React.useState<ReturnReasonWire>('SIZE_TOO_SMALL');
  const [not, setNot] = React.useState('');
  const [hata, setHata] = React.useState<unknown>(null);
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [sonuc, setSonuc] = React.useState<ReturnCreatedWire | null>(null);

  const niyetRef = React.useRef<{ imza: string; anahtar: string } | null>(null);

  const secilenler = kalemler
    .map((kalem) => ({ orderItemId: kalem.id, quantity: adetler[kalem.id] ?? 0 }))
    .filter((kalem) => kalem.quantity > 0);

  function anahtarAl(imza: string): string {
    if (niyetRef.current?.imza === imza) return niyetRef.current.anahtar;
    const anahtar = newIdempotencyKey();
    niyetRef.current = { imza, anahtar };
    return anahtar;
  }

  async function gonder(): Promise<void> {
    if (secilenler.length === 0) return;

    const govde = { reason: sebep, items: secilenler, ...(not.trim() ? { note: not.trim() } : {}) };
    const anahtar = anahtarAl(JSON.stringify(govde));

    setGonderiliyor(true);
    setHata(null);

    try {
      /**
       * ⚠️ ANAHTAR SARMALAYICININ DIŞINDA ÜRETİLDİ ve üç denemede de AYNI.
       *    İçeride üretilseydi `IDEMPOTENCY_IN_PROGRESS` üzerine ÜÇ AYRI iade
       *    açılırdı — otomatik tekrarın tek güvenlik şartı budur
       *    (`retry-policy.ts` → `otomatikTekrarla`).
       *
       * ⚠️ Sunucu `IDEMPOTENCY_IN_PROGRESS`i `retryAfterSeconds: 2` ile
       *    döndürüyor; bekleme süresi tahmin edilmez, o alandan okunur.
       */
      const { data } = await otomatikTekrarla(() =>
        apiFetch<ReturnCreatedWire, `/orders/${string}/returns`>(`/orders/${siparisId}/returns`, {
          method: 'POST',
          json: govde,
          idempotencyKey: anahtar,
        }),
      );
      setSonuc(data);
      // ⚠️ Sayfayı yeniden çekmek ŞART: iade talebi paket durumunu ve kalan
      //    iade adetlerini değiştiriyor. Yenilenmezse kullanıcı aynı kalemi
      //    ikinci kez seçebilir ve sunucudan anlamsız bir hata alır.
      router.refresh();
    } catch (error) {
      setHata(error);
      // ⚠️ Anahtar SIFIRLANMAZ. Hata "belki işlendi belki işlenmedi" anlamına
      //    gelebilir (zaman aşımı); aynı anahtarla tekrar denemek tek güvenli
      //    davranıştır. `IDEMPOTENCY_IN_PROGRESS` kodu da bunu bekliyor.
      if (isApiFailure(error) && error.code === 'RETURN_ALREADY_EXISTS') router.refresh();
    } finally {
      setGonderiliyor(false);
    }
  }

  if (sonuc) {
    return (
      <div role="status" className="rounded-md bg-olumlu-zemin p-3 text-sm text-olumlu">
        İade talebiniz alındı. Talep numarası <span className="rakam">{sonuc.returnNumber}</span>.
        Satıcı onayladıktan sonra kargo süreci başlar.
      </div>
    );
  }

  if (!acik) {
    return (
      <div>
        <Button variant="ikincil" size="sm" onClick={() => setAcik(true)}>
          İade talebi oluştur
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void gonder();
      }}
      className="flex flex-col gap-4 border-t border-kenar pt-4"
    >
      <p className="text-sm font-medium text-metin">{paketAdi} — iade talebi</p>

      <ul className="flex flex-col gap-2">
        {kalemler.map((kalem) => (
          <li key={kalem.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-metin">
              {kalem.baslik}
              <span className="text-metin-soluk"> · {kalem.varyant}</span>
            </span>

            <span className="flex items-center gap-2">
              <Label htmlFor={`adet-${kalem.id}`} className="text-xs text-metin-soluk">
                Adet
              </Label>
              {/*
                ⚠️ Üst sınır `kalanAdet`. Sunucu da aynı kapıyı sipariş satırını
                   KİLİTLEYEREK uyguluyor; buradaki sınır kullanıcıya
                   reddedilecek bir form doldurtmamak içindir, güvenlik değil.
              */}
              <select
                id={`adet-${kalem.id}`}
                value={adetler[kalem.id] ?? 0}
                onChange={(event) =>
                  setAdetler((onceki) => ({ ...onceki, [kalem.id]: Number(event.target.value) }))
                }
                className="rakam h-8 rounded-md border border-kenar bg-zemin px-2 text-sm text-metin"
              >
                {Array.from({ length: kalem.kalanAdet + 1 }, (_, adet) => (
                  <option key={adet} value={adet}>
                    {adet}
                  </option>
                ))}
              </select>
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="iade-sebebi">İade sebebi</Label>
        <select
          id="iade-sebebi"
          value={sebep}
          onChange={(event) => setSebep(event.target.value as ReturnReasonWire)}
          className="h-10 rounded-md border border-kenar bg-zemin px-3 text-sm text-metin"
        >
          {(Object.keys(IADE_SEBEBI) as ReturnReasonWire[]).map((anahtar) => (
            <option key={anahtar} value={anahtar}>
              {IADE_SEBEBI[anahtar]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="iade-notu">Açıklama (isteğe bağlı)</Label>
        <textarea
          id="iade-notu"
          value={not}
          onChange={(event) => setNot(event.target.value)}
          maxLength={1000}
          rows={3}
          className="w-full rounded-md border border-kenar bg-zemin p-3 text-sm text-metin placeholder:text-metin-soluk"
          placeholder="Satıcının durumu anlaması için kısa bir açıklama yazabilirsiniz."
        />
      </div>

      {/*
        ⚠️ `onRetry` ZORUNLU. Otomatik denemeler tükendikten sonra ekranda
           kalan tek çıkış bu düğme; olmadığı sürece kullanıcı para hareketi
           başlatan bir uçta ("İsteğiniz işleniyor, lütfen bekleyin.")
           düğmesiz kalıyordu. Anahtar `niyetRef`te olduğu için düğme İKİNCİ
           BİR İADE AÇMAZ — aynı niyet, aynı anahtar.
      */}
      {hata ? <HataGosterimi error={hata} onRetry={() => void gonder()} /> : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={gonderiliyor || secilenler.length === 0}>
          {gonderiliyor ? 'Gönderiliyor…' : 'İade talebini gönder'}
        </Button>
        <Button type="button" variant="sessiz" onClick={() => setAcik(false)}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}
