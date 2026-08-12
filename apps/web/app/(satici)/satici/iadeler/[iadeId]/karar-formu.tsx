'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { isApiFailure } from '@vt/contracts';
import { apiFetch, newIdempotencyKey } from '@/lib/api/client';
import { otomatikTekrarla } from '@/lib/api/retry-policy';
import { fieldErrorMap } from '@/components/hata/alan-hatalari';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Fiyat } from '@/components/fiyat/fiyat';
import type { MinorString } from '@vt/contracts';
import type { SellerReturnApprovalWire, SellerReturnRejectionWire } from '@vt/contracts';

/** Ret gerekçesi alt sınırı — sunucu şeması ile AYNI (`decideReturnSchema`). */
const RET_GEREKCESI_ASGARI = 10;

/**
 * İADE KARARI — ONAYDA PARA HAREKET EDER.
 *
 * ⚠️ Onay, aynı transaction'da üç ters defter kaydı yazar: REFUND (−),
 *    COMMISSION_REVERSAL (+), SHIPPING_REVERSAL (+). Yani bu düğme bir "kaydet"
 *    düğmesi değil, GERİ ALINAMAZ bir para hareketidir. Ekranın onay metni bunu
 *    açıkça söylemek zorunda; söylemeyen bir arayüz satıcıya farkında olmadan
 *    bakiyesini düşürtür.
 *
 * ⚠️ `PATCH /seller/returns/:id` `@Idempotent()` ve anahtar TİPTE dayatılıyor:
 *    vermeden çağırmak DERLENMEZ. Anahtar `useRef`te ve KARARIN İMZASINA bağlı
 *    — `useState` olsaydı her render yeni anahtar üretir, "tekrar dene" ikinci
 *    kez ters kayıt yazma denemesi olurdu.
 *
 * ⚠️ Ters kayıtlar `availableAt = null` ile düşer, yani bakiyeden ANINDA
 *    inerler; beklemezler. Ekran "bakiyenizden düşecek" değil "düşer" demeli.
 */
export function KararFormu({
  iadeId,
  iadeTutari,
}: {
  iadeId: string;
  iadeTutari: MinorString;
}): React.ReactElement {
  const router = useRouter();

  const [acikKarar, setAcikKarar] = React.useState<'onay' | 'ret' | null>(null);
  const [retGerekcesi, setRetGerekcesi] = React.useState('');
  const [hata, setHata] = React.useState<unknown>(null);
  const [calisiyor, setCalisiyor] = React.useState(false);
  const [onaySonucu, setOnaySonucu] = React.useState<SellerReturnApprovalWire | null>(null);
  const [retSonucu, setRetSonucu] = React.useState<SellerReturnRejectionWire | null>(null);

  const niyetRef = React.useRef<{ imza: string; anahtar: string } | null>(null);

  function anahtarAl(imza: string): string {
    if (niyetRef.current?.imza === imza) return niyetRef.current.anahtar;
    const anahtar = newIdempotencyKey();
    niyetRef.current = { imza, anahtar };
    return anahtar;
  }

  const alanHatalari = isApiFailure(hata) ? fieldErrorMap(hata.fields) : {};

  async function gonder(govde: { action: 'APPROVE' } | { action: 'REJECT'; rejectReason: string }) {
    const anahtar = anahtarAl(JSON.stringify(govde));

    setCalisiyor(true);
    setHata(null);

    try {
      /**
       * ⚠️ ANAHTAR SARMALAYICININ DIŞINDA. İçeride üretilseydi
       *    `IDEMPOTENCY_IN_PROGRESS` üzerine ÜÇ AYRI iade kararı gider ve
       *    defterde üç kez ters kayıt oluşurdu — otomatik tekrarın tek güvenlik
       *    şartı anahtarın sabit kalmasıdır.
       */
      const { data } = await otomatikTekrarla(() =>
        apiFetch<SellerReturnApprovalWire | SellerReturnRejectionWire, `/seller/returns/${string}`>(
          `/seller/returns/${iadeId}`,
          { method: 'PATCH', json: govde, idempotencyKey: anahtar },
        ),
      );

      if (govde.action === 'APPROVE') setOnaySonucu(data as SellerReturnApprovalWire);
      else setRetSonucu(data as SellerReturnRejectionWire);

      // Karar paket durumunu ve iade kaydını değiştiriyor; yenilenmezse satıcı
      // hâlâ karar düğmelerini görür ve ikinci kez basar.
      router.refresh();
    } catch (error) {
      setHata(error);
      // ⚠️ Anahtar SIFIRLANMAZ: zaman aşımı "belki işlendi" demektir ve aynı
      //    anahtarla tekrar denemek tek güvenli davranıştır.
    } finally {
      setCalisiyor(false);
    }
  }

  if (onaySonucu) {
    return (
      <div
        role="status"
        className="flex flex-col gap-2 rounded-md bg-olumlu-zemin p-3 text-sm text-olumlu"
      >
        <p>
          <span className="rakam">{onaySonucu.returnNumber}</span> numaralı iade onaylandı.
        </p>
        {/*
          ⚠️ İKİ TUTAR AYRI SATIRDA ve ayrı cümlelerle. Aynı satıra konsaydı
             satıcı ikisini aynı rakam sanır; oysa indirim payı müşteriden
             düşer, satıcı defterine brüt yansır — birbirini tutmaları
             beklenmez.
        */}
        <p className="flex flex-wrap items-baseline gap-2">
          Müşteriye ödenecek tutar: <Fiyat value={onaySonucu.refundAmountMinor} />
        </p>
        <p className="flex flex-wrap items-baseline gap-2">
          Defterinize düşen net etki: <Fiyat value={onaySonucu.sellerNetImpactMinor} />
        </p>
      </div>
    );
  }

  if (retSonucu) {
    return (
      <div role="status" className="rounded-md bg-yuzey p-3 text-sm text-metin">
        <span className="rakam">{retSonucu.returnNumber}</span> numaralı iade reddedildi. Paket
        teslim edilmiş durumuna geri döndü; defterinize hiçbir kayıt yazılmadı.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {hata ? <HataGosterimi error={hata} onRetry={() => setHata(null)} /> : null}

      {acikKarar === null ? (
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setAcikKarar('onay')} disabled={calisiyor}>
            İadeyi onayla
          </Button>
          <Button variant="ikincil" onClick={() => setAcikKarar('ret')} disabled={calisiyor}>
            İadeyi reddet
          </Button>
        </div>
      ) : null}

      {acikKarar === 'onay' ? (
        <div className="flex flex-col gap-4 border-t border-kenar pt-4">
          <p className="text-sm text-metin">
            Onayladığınızda müşteriye <Fiyat value={iadeTutari} className="text-sm" /> tutarında
            iade süreci başlar. Bu kalemin satışı, komisyonu ve kargo payı defterinizde ters kayıtla
            geri alınır ve bakiyeniz aynı anda düşer.
          </p>
          <p className="text-sm text-metin-soluk">Onay geri alınamaz.</p>

          <div className="flex gap-3">
            <Button onClick={() => void gonder({ action: 'APPROVE' })} disabled={calisiyor}>
              {calisiyor ? 'Gönderiliyor…' : 'Onaylıyorum'}
            </Button>
            <Button variant="sessiz" onClick={() => setAcikKarar(null)} disabled={calisiyor}>
              Vazgeç
            </Button>
          </div>
        </div>
      ) : null}

      {acikKarar === 'ret' ? (
        <form
          onSubmit={(olay) => {
            olay.preventDefault();
            void gonder({ action: 'REJECT', rejectReason: retGerekcesi.trim() });
          }}
          className="flex flex-col gap-4 border-t border-kenar pt-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ret-gerekcesi">Ret gerekçesi</Label>
            {/*
              ⚠️ GEREKÇE ZORUNLU ve alt sınır sunucudadır (en az 10 karakter).
                 Buradaki `minLength` satıcıya reddedilecek bir form
                 doldurtmamak için; karar sunucunun.
            */}
            <textarea
              id="ret-gerekcesi"
              value={retGerekcesi}
              onChange={(olay) => setRetGerekcesi(olay.target.value)}
              minLength={RET_GEREKCESI_ASGARI}
              maxLength={500}
              required
              rows={3}
              className="w-full rounded-md border border-kenar bg-zemin p-3 text-sm text-metin placeholder:text-metin-soluk"
              placeholder="Ürünün kullanılmış olması, eksik parça, iade süresinin dolması gibi somut bir gerekçe yazın."
              aria-invalid={alanHatalari['rejectReason'] !== undefined}
            />
            <p className="text-xs text-metin-soluk">
              En az <span className="rakam">{RET_GEREKCESI_ASGARI}</span> karakter. Gerekçe
              müşteriye iletilir.
            </p>
            {alanHatalari['rejectReason'] ? (
              <p className="text-xs text-tehlike">{alanHatalari['rejectReason']}</p>
            ) : null}
          </div>

          <div className="flex gap-3">
            <Button
              type="submit"
              variant="tehlike"
              disabled={calisiyor || retGerekcesi.trim().length < RET_GEREKCESI_ASGARI}
            >
              {calisiyor ? 'Gönderiliyor…' : 'İadeyi reddet'}
            </Button>
            <Button type="button" variant="sessiz" onClick={() => setAcikKarar(null)}>
              Vazgeç
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
