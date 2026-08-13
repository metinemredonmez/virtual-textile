'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api/client';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { tarihSaat } from '@/lib/tarih';
import type { DataExportWire } from '@vt/contracts';

/**
 * VERİ İNDİRME TALEBİ (KVKK md.11).
 *
 * ⚠️ BU EKRAN DOSYA VERMEZ ve vermeyeceğini AÇIKÇA SÖYLER. Arşiv worker
 *    tarafından hazırlanıp kullanıcıya gönderiliyor; uç 202 dönüyor. "İndir"
 *    yazan bir düğme koyup hiçbir şey indirmemek, hakkın kullanıldığı izlenimi
 *    verip kullanmamaktır.
 *
 * ⚠️ BEKLEYEN TALEP VARKEN YENİSİ AÇILMAZ; sunucu var olanı geri döndürüyor
 *    (`canRequestDataExport`). Düğme bu yüzden gizlenmiyor, DEVRE DIŞI
 *    bırakılıyor: kaybolan bir düğme kullanıcıya "sistem bozuldu" dedirtir.
 */
const DURUM_METNI = {
  NONE: { metin: 'Talep yok', rozet: 'notr' },
  PREPARING: { metin: 'Hazırlanıyor', rozet: 'uyari' },
  READY: { metin: 'Hazır', rozet: 'olumlu' },
  EXPIRED: { metin: 'Bağlantı süresi doldu', rozet: 'notr' },
} satisfies Record<DataExportWire['status'], { metin: string; rozet: 'notr' | 'uyari' | 'olumlu' }>;

export function VeriIndirme({ durum }: { durum: DataExportWire }): React.ReactElement {
  const router = useRouter();
  const [hata, setHata] = React.useState<unknown>(null);
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [sonuc, setSonuc] = React.useState<DataExportWire | null>(null);

  const guncel = sonuc ?? durum;
  const gosterim = DURUM_METNI[guncel.status];
  const yeniTalepAcilabilir = guncel.status === 'NONE' || guncel.status === 'EXPIRED';

  async function talepEt(): Promise<void> {
    setGonderiliyor(true);
    setHata(null);
    try {
      const { data } = await apiFetch<DataExportWire, '/me/data-export'>('/me/data-export', {
        method: 'POST',
      });
      setSonuc(data);
      router.refresh();
    } catch (error) {
      setHata(error);
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm text-metin">
          Durum
          <Badge durum={gosterim.rozet}>{gosterim.metin}</Badge>
        </span>
        <Button
          variant="ikincil"
          size="sm"
          disabled={!yeniTalepAcilabilir || gonderiliyor}
          onClick={() => void talepEt()}
        >
          {gonderiliyor ? 'Talep gönderiliyor…' : 'Verilerimi indirmek istiyorum'}
        </Button>
      </div>

      <p className="text-sm text-metin-soluk">
        Talebiniz alındığında siparişleriniz, adresleriniz, rıza geçmişiniz ve sanal deneme
        kayıtlarınız tek bir arşiv dosyasında toplanır. Dosya bu ekranda görünmez; hazır olduğunda
        indirme bağlantısı size gönderilir ve bağlantı{' '}
        <span className="rakam">{guncel.linkValidHours}</span> saat geçerlidir.
      </p>

      {guncel.requestedAt ? (
        <p className="text-sm text-metin-soluk">
          Talep tarihi: {tarihSaat(guncel.requestedAt)}
          {guncel.preparedAt ? <> · Hazırlık başlangıcı: {tarihSaat(guncel.preparedAt)}</> : null}
          {guncel.linkExpiresAt ? (
            <> · Bağlantı son geçerlilik: {tarihSaat(guncel.linkExpiresAt)}</>
          ) : null}
        </p>
      ) : null}

      {guncel.status === 'PREPARING' || guncel.status === 'READY' ? (
        <p className="text-sm text-metin-soluk">
          Bekleyen bir talebiniz olduğu için şu an yeni talep açılamaz. Bağlantının süresi
          dolduğunda yeniden talep edebilirsiniz.
        </p>
      ) : null}

      {hata ? <HataGosterimi error={hata} /> : null}
    </div>
  );
}
