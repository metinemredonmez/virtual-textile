'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { isApiFailure } from '@vt/contracts';
import { apiFetch, newIdempotencyKey } from '@/lib/api/client';
import { otomatikTekrarla } from '@/lib/api/retry-policy';
import { fieldErrorMap } from '@/components/hata/alan-hatalari';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PackageStatusWire } from '@vt/contracts';
import type { SellerPackageTransitionWire } from '@vt/contracts';

/**
 * PAKET EYLEMLERİ — onayla / kargoya ver / iptal et.
 *
 * ⚠️ İKİ AYRI UÇ VAR VE İKİSİ AYNI İŞİ YAPABİLİR; seçim rastgele değil:
 *      • Kargoya verme → `POST /seller/packages/:id/shipment`. İki alan da
 *        TİPTE zorunlu ve uç `@Idempotent()`. Ağ zaman aşımında istemci isteği
 *        tekrarlar; anahtarsız ikinci istek ya `ORDER_INVALID_TRANSITION` alıp
 *        satıcıya "başarısız" gösterir (oysa kargo bilgisi girilmiştir) ya da
 *        müşteriye ikinci bir kargo bildirimi gönderir.
 *      • PREPARING ve CANCELLED → `PATCH /seller/packages/:id/status`.
 *    `PATCH` ile `status:'SHIPPED'` göndermek DE mümkün ama zorunluluk orada
 *    `refine` ile, yani ÇALIŞMA ZAMANINDA denetleniyor. Derleme zamanı kapısı
 *    olan yolu tercih ediyoruz.
 *
 * ⚠️ GEÇİŞ MAKİNESİ SUNUCUDA: AWAITING_APPROVAL → PREPARING → SHIPPED.
 *    Yani AWAITING_APPROVAL durumundaki bir paket DOĞRUDAN kargoya verilemez.
 *    Düğmeyi göstermemek bir güvenlik önlemi değil, satıcıya reddedilecek bir
 *    form doldurtmama nezaketidir; kapı `order-status.ts`tedir.
 *
 * ⚠️ `otomatikTekrarla` YALNIZCA kargo çağrısında. `PATCH .../status`
 *    idempotent DEĞİL: otomatik tekrar, ilk isteği aslında işlemiş bir sunucuda
 *    ikinci bir geçiş denemesi demektir. Kullanıcı orada "Tekrar dene"
 *    düğmesiyle kendi karar verir.
 */
export function KargoFormu({
  paketId,
  durum,
}: {
  paketId: string;
  durum: PackageStatusWire;
}): React.ReactElement | null {
  const router = useRouter();

  const [acikForm, setAcikForm] = React.useState<'kargo' | 'iptal' | null>(null);
  const [kargoFirmasi, setKargoFirmasi] = React.useState('');
  const [takipNo, setTakipNo] = React.useState('');
  const [iptalGerekcesi, setIptalGerekcesi] = React.useState('');
  const [hata, setHata] = React.useState<unknown>(null);
  const [calisiyor, setCalisiyor] = React.useState(false);

  /**
   * ⚠️ ANAHTAR `useRef`TE ve YÜKÜN İMZASINA BAĞLI.
   *    `useState` olsaydı her render yeni anahtar üretir ve "tekrar dene"
   *    ikinci bir kargo kaydı denemesi olurdu. Tek sabit anahtar da yanlış
   *    olurdu: satıcı takip numarasını düzeltip yeniden gönderdiğinde sunucu
   *    ilk yanıtı geri oynatır ve satıcı düzelttiği numaranın işlendiğini
   *    sanardı. Aynı yük = aynı niyet = aynı anahtar.
   */
  const niyetRef = React.useRef<{ imza: string; anahtar: string } | null>(null);

  function anahtarAl(imza: string): string {
    if (niyetRef.current?.imza === imza) return niyetRef.current.anahtar;
    const anahtar = newIdempotencyKey();
    niyetRef.current = { imza, anahtar };
    return anahtar;
  }

  /**
   * ⚠️ `hata.fields` okunuyor, `hata.details` DEĞİL: `details` tipi `unknown` ve
   *    şeklini burada yeniden çözmek, ikinci bir ayrıştırıcı yazmak olurdu.
   *
   * ⚠️ Metin `fieldErrorMap` üzerinden geçiyor çünkü `details.fields[].message`
   *    Türkçe olmayabilir (`zodBody` ZodError mesajını ham geçiriyor).
   */
  const alanHatalari = isApiFailure(hata) ? fieldErrorMap(hata.fields) : {};

  async function calistir(islem: () => Promise<unknown>): Promise<void> {
    setCalisiyor(true);
    setHata(null);
    try {
      await islem();
      setAcikForm(null);
      // ⚠️ Yanıt paketin TAMAMINI döndürmüyor (`{orderStatus, packageStatus}`),
      //    o yüzden ekran kendi durumunu elle güncelleyemez. Yenilemek zorunlu:
      //    yenilenmezse satıcı kargoya verdiği paketin hâlâ "Hazırlanıyor"
      //    olduğunu görür ve ikinci kez kargolamayı dener.
      router.refresh();
    } catch (error) {
      setHata(error);
    } finally {
      setCalisiyor(false);
    }
  }

  function hazirligaAl(): void {
    void calistir(() =>
      apiFetch<SellerPackageTransitionWire, `/seller/packages/${string}/status`>(
        `/seller/packages/${paketId}/status`,
        { method: 'PATCH', json: { status: 'PREPARING' } },
      ),
    );
  }

  function kargoyaVer(): void {
    const govde = { carrier: kargoFirmasi.trim(), trackingNo: takipNo.trim() };
    const anahtar = anahtarAl(JSON.stringify(govde));

    void calistir(() =>
      /**
       * ⚠️ ANAHTAR SARMALAYICININ DIŞINDA ÜRETİLDİ ve üç denemede de AYNI.
       *    İçeride üretilseydi `IDEMPOTENCY_IN_PROGRESS` üzerine üç ayrı kargo
       *    kaydı denemesi gider; otomatik tekrarın tek güvenlik şartı budur.
       */
      otomatikTekrarla(() =>
        apiFetch<SellerPackageTransitionWire, `/seller/packages/${string}/shipment`>(
          `/seller/packages/${paketId}/shipment`,
          { method: 'POST', json: govde, idempotencyKey: anahtar },
        ),
      ),
    );
  }

  function iptalEt(): void {
    void calistir(() =>
      apiFetch<SellerPackageTransitionWire, `/seller/packages/${string}/status`>(
        `/seller/packages/${paketId}/status`,
        { method: 'PATCH', json: { status: 'CANCELLED', cancelReason: iptalGerekcesi.trim() } },
      ),
    );
  }

  const hazirligaAlinabilir = durum === 'AWAITING_APPROVAL';
  const kargolanabilir = durum === 'PREPARING';
  const iptalEdilebilir = durum === 'AWAITING_APPROVAL' || durum === 'PREPARING';

  if (!hazirligaAlinabilir && !kargolanabilir && !iptalEdilebilir) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {hata ? <HataGosterimi error={hata} onRetry={() => setHata(null)} /> : null}

      {acikForm === null ? (
        <div className="flex flex-wrap gap-3">
          {hazirligaAlinabilir ? (
            <Button onClick={hazirligaAl} disabled={calisiyor}>
              {calisiyor ? 'Gönderiliyor…' : 'Siparişi onayla ve hazırlığa al'}
            </Button>
          ) : null}

          {kargolanabilir ? (
            <Button onClick={() => setAcikForm('kargo')} disabled={calisiyor}>
              Kargoya ver
            </Button>
          ) : null}

          {iptalEdilebilir ? (
            <Button variant="sessiz" onClick={() => setAcikForm('iptal')} disabled={calisiyor}>
              Siparişi iptal et
            </Button>
          ) : null}
        </div>
      ) : null}

      {acikForm === 'kargo' ? (
        <form
          onSubmit={(olay) => {
            olay.preventDefault();
            kargoyaVer();
          }}
          className="flex flex-col gap-4 border-t border-kenar pt-4"
        >
          {/*
            ⚠️ İKİ ALAN DA ZORUNLU ve bu sunucunun kuralı: takip numarası olmadan
               SHIPPED'a geçilebilseydi müşteri kargosunu izleyemezdi. Buradaki
               `required` yalnızca satıcıya boş form gönderttirmemek için.
          */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kargo-firmasi">Kargo firması</Label>
              <Input
                id="kargo-firmasi"
                value={kargoFirmasi}
                onChange={(olay) => setKargoFirmasi(olay.target.value)}
                minLength={2}
                maxLength={60}
                required
                autoComplete="off"
                placeholder="Yurtiçi Kargo"
                aria-invalid={alanHatalari['carrier'] !== undefined}
              />
              {alanHatalari['carrier'] ? (
                <p className="text-xs text-tehlike">{alanHatalari['carrier']}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="takip-no">Takip numarası</Label>
              <Input
                id="takip-no"
                value={takipNo}
                onChange={(olay) => setTakipNo(olay.target.value)}
                minLength={4}
                maxLength={64}
                required
                autoComplete="off"
                className="rakam"
                aria-invalid={alanHatalari['trackingNo'] !== undefined}
              />
              {alanHatalari['trackingNo'] ? (
                <p className="text-xs text-tehlike">{alanHatalari['trackingNo']}</p>
              ) : null}
            </div>
          </div>

          <p className="text-xs text-metin-soluk">
            Kargo bilgisi kaydedildiğinde paket &quot;Kargoya verildi&quot; durumuna geçer ve
            müşteriye bildirim gider. Bu adım geri alınamaz.
          </p>

          <div className="flex gap-3">
            <Button type="submit" disabled={calisiyor}>
              {calisiyor ? 'Kaydediliyor…' : 'Kargo bilgisini kaydet'}
            </Button>
            <Button type="button" variant="sessiz" onClick={() => setAcikForm(null)}>
              Vazgeç
            </Button>
          </div>
        </form>
      ) : null}

      {acikForm === 'iptal' ? (
        <form
          onSubmit={(olay) => {
            olay.preventDefault();
            iptalEt();
          }}
          className="flex flex-col gap-4 border-t border-kenar pt-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="iptal-gerekcesi">İptal gerekçesi</Label>
            {/* ⚠️ Gerekçe ZORUNLU (sunucu: 3–300 karakter) ve müşteriye
                gösterilir; "stok yok" ile "adres hatalı" aynı şey değil. */}
            <textarea
              id="iptal-gerekcesi"
              value={iptalGerekcesi}
              onChange={(olay) => setIptalGerekcesi(olay.target.value)}
              minLength={3}
              maxLength={300}
              required
              rows={3}
              className="w-full rounded-md border border-kenar bg-zemin p-3 text-sm text-metin placeholder:text-metin-soluk"
              placeholder="Müşteriye gösterilecek kısa bir gerekçe yazın."
              aria-invalid={alanHatalari['cancelReason'] !== undefined}
            />
            {alanHatalari['cancelReason'] ? (
              <p className="text-xs text-tehlike">{alanHatalari['cancelReason']}</p>
            ) : null}
          </div>

          <p className="text-xs text-metin-soluk">
            İptal geri alınamaz. Rezerve edilen stok serbest bırakılır ve müşteriye ödemesi iade
            edilir.
          </p>

          <div className="flex gap-3">
            {/* Yıkıcı eylem — renk burada DURUM taşıyor, süs değil. */}
            <Button type="submit" variant="tehlike" disabled={calisiyor}>
              {calisiyor ? 'Gönderiliyor…' : 'Siparişi iptal et'}
            </Button>
            <Button type="button" variant="sessiz" onClick={() => setAcikForm(null)}>
              Vazgeç
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
