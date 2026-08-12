'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { incelemeEngelleri } from '../_lib/durum';
import type { SellerProductDetailWire } from '@vt/contracts';

/**
 * ÜRÜN DURUM EYLEMLERİ.
 *
 * ⚠️ "YAYINLA" DÜĞMESİ YOK VE OLAMAZ. `updateProductSchema` satıcıya yalnız üç
 *    hedef veriyor: `DRAFT`, `PENDING_REVIEW`, `ARCHIVED`. `PUBLISHED`
 *    gönderildiğinde uç 400 döndürüyor (ölçüldü). Yayına alma admin işidir;
 *    "Yayınla" yazan bir düğme, basınca hata veren bir düğme olurdu.
 *
 * ⚠️ ARŞİVDEN GERİ DÖNÜŞ SATICIYA AÇIK (ölçüldü: `ARCHIVED → PENDING_REVIEW`
 *    kabul edildi) — oysa adminin geçiş makinesi `ARCHIVED: []` diyor. Yani
 *    aynı geçiş iki yoldan farklı cevap alıyor. Arayüz bugünkü DAVRANIŞI
 *    izliyor; çelişki backend kartı olarak raporlandı.
 */
export interface DurumEylemleriProps {
  urun: SellerProductDetailWire;
}

export function DurumEylemleri({ urun }: DurumEylemleriProps): React.ReactElement {
  const router = useRouter();
  const [calisan, setCalisan] = React.useState<string | null>(null);
  const [hata, setHata] = React.useState<unknown>(null);

  const engeller = incelemeEngelleri(urun);
  const incelemeyeGonderilebilir = urun.status !== 'PENDING_REVIEW' && urun.status !== 'PUBLISHED';

  async function durumaGec(hedef: 'PENDING_REVIEW' | 'DRAFT'): Promise<void> {
    setCalisan(hedef);
    setHata(null);
    try {
      await apiFetch<unknown, `/seller/products/${string}`>(`/seller/products/${urun.id}`, {
        method: 'PATCH',
        json: { status: hedef },
      });
      router.refresh();
    } catch (istekHatasi) {
      setHata(istekHatasi);
    } finally {
      setCalisan(null);
    }
  }

  async function arsivle(): Promise<void> {
    setCalisan('arsiv');
    setHata(null);
    try {
      // Ürün SİLİNMEZ, arşivlenir — uç bu yüzden POST, DELETE değil.
      await apiFetch<{ archived: true }, `/seller/products/${string}/archive`>(
        `/seller/products/${urun.id}/archive`,
        { method: 'POST' },
      );
      router.refresh();
    } catch (istekHatasi) {
      setHata(istekHatasi);
    } finally {
      setCalisan(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {incelemeyeGonderilebilir ? (
          <Button
            size="sm"
            disabled={calisan !== null || engeller.length > 0}
            onClick={() => void durumaGec('PENDING_REVIEW')}
          >
            {calisan === 'PENDING_REVIEW' ? 'Gönderiliyor…' : 'İncelemeye gönder'}
          </Button>
        ) : null}

        {urun.status === 'PENDING_REVIEW' || urun.status === 'PUBLISHED' ? (
          <Button
            variant="ikincil"
            size="sm"
            disabled={calisan !== null}
            onClick={() => void durumaGec('DRAFT')}
          >
            {urun.status === 'PUBLISHED' ? 'Vitrinden indir' : 'İncelemeden geri al'}
          </Button>
        ) : null}

        {urun.status !== 'ARCHIVED' ? (
          <Button
            variant="ikincil"
            size="sm"
            disabled={calisan !== null}
            onClick={() => void arsivle()}
          >
            {calisan === 'arsiv' ? 'Arşivleniyor…' : 'Arşivle'}
          </Button>
        ) : null}
      </div>

      {/*
        ⚠️ DEVRE DIŞI DÜĞME SEBEBİNİ SÖYLER. Sebepsiz soluk bir düğme,
           satıcının neyi eksik yaptığını bulmak için ekranı taraması demektir;
           iki engel de ölçülmüş ve adı konmuş şeyler.
      */}
      {incelemeyeGonderilebilir && engeller.length > 0 ? (
        <p className="mt-2 text-sm text-metin-soluk">
          İncelemeye gönderilemez: {engeller.join(', ')}. Bu eksikler giderilmeden ürün moderasyonda
          reddedilir.
        </p>
      ) : null}

      {hata !== null ? <HataGosterimi error={hata} className="mt-3 max-w-md" /> : null}
    </div>
  );
}
