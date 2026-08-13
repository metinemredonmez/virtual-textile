'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { isApiFailure, type MinorString } from '@vt/contracts';
import { apiFetch, newIdempotencyKey } from '@/lib/api/client';
import { otomatikTekrarla } from '@/lib/api/retry-policy';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Fiyat } from '@/components/fiyat/fiyat';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { hataTutari } from '@/lib/api/hata-tutari';
import type { PayoutApprovalWire, PayoutRejectionWire } from '@vt/contracts';

/** `reasonSchema`: 10–500 karakter. */
const GEREKCE_EN_AZ = 10;
const GEREKCE_EN_FAZLA = 500;

/**
 * PAYOUT KARARI — onayla / reddet.
 *
 * ⚠️ İKİ UÇ, İKİ FARKLI GÜVENLİK MODELİ. Karıştırmak para hatasıdır:
 *
 *   • `POST /admin/payouts/:id/approve` → `@Idempotent()`. Anahtar TİPTE
 *     zorunlu (`IdempotentPath`); vermeden çağırmak DERLENMEZ. Bu yüzden
 *     otomatik tekrar GÜVENLİ ve kullanılıyor.
 *   • `POST /admin/payouts/:id/reject`  → idempotent DEĞİL. Anahtar
 *     gönderilemez (tip `idempotencyKey?: never`), otomatik tekrar da
 *     YAPILMAZ — `retry-policy.ts`: "Anahtarsız bir POST'u otomatik
 *     tekrarlamak ikinci bir sipariş/üretim yaratır."
 *
 * ⚠️ ANAHTAR `useRef`TE. `useState`te tutulsaydı her render yeni anahtar
 *    üretilir ve "tekrar dene" düğmesi İKİNCİ BİR HAVALE olayı yayınlardı.
 *    Anahtar `otomatikTekrarla`nın DIŞINDA üretiliyor: içeride üretilseydi üç
 *    denemenin üçü de ayrı anahtarla giderdi ve idempotency hiç işlemezdi.
 *
 * ⚠️ REDDİ İKİ KEZ GÖNDERMEK HATA DEĞİL, TEKRAR. İkinci istek
 *    `PAYOUT_INVALID_STATE` alır ve o mesaj ADMİNE yazılmıştır
 *    ("… durumunda, … yapılamaz"). Kırmızı bir hata kutusu göstermek yerine
 *    liste tazeleniyor: talep zaten karara bağlanmış, yapılacak bir şey yok.
 */
export function PayoutKarari({
  payoutId,
  saticiAdi,
  tutarMinor,
}: {
  payoutId: string;
  saticiAdi: string;
  tutarMinor: MinorString;
}): React.ReactElement {
  const router = useRouter();
  const [mod, setMod] = React.useState<'kapali' | 'onay' | 'red'>('kapali');
  const [gerekce, setGerekce] = React.useState('');
  const [hata, setHata] = React.useState<unknown>(null);
  const [calisiyor, setCalisiyor] = React.useState(false);

  /** Kullanıcı NİYETİ başına bir kez; render'lar arasında sabit. */
  const onayAnahtariRef = React.useRef<string | null>(null);

  /**
   * ⚠️ Yalnızca onay dalında anlamlı: talep ile onay arasında iade düşmüş
   *    olabilir ve sunucu ödenebilir tutarı `details.availableMinor` ile
   *    bildiriyor. Bu, bu ekranda gösterilebilen TEK güvenilir bakiye rakamı.
   */
  const odenebilir = isApiFailure(hata) ? hataTutari(hata.details, 'availableMinor') : null;

  async function onayla(): Promise<void> {
    setCalisiyor(true);
    setHata(null);

    // ⚠️ Anahtar sarmalayıcının DIŞINDA. Hata sonrası SIFIRLANMAZ: zaman
    //    aşımı "belki işlendi" demektir; aynı anahtarla tekrar denemek tek
    //    güvenli davranıştır.
    onayAnahtariRef.current ??= newIdempotencyKey();
    const anahtar = onayAnahtariRef.current;

    try {
      await otomatikTekrarla(() =>
        apiFetch<PayoutApprovalWire, `/admin/payouts/${string}/approve`>(
          `/admin/payouts/${payoutId}/approve`,
          { method: 'POST', idempotencyKey: anahtar },
        ),
      );
      router.refresh();
    } catch (error) {
      if (isApiFailure(error) && error.code === 'PAYOUT_INVALID_STATE') {
        // Başka bir yönetici araya girmiş; liste tazelenince doğru durum görünür.
        router.refresh();
      } else {
        setHata(error);
      }
    } finally {
      setCalisiyor(false);
    }
  }

  async function reddet(): Promise<void> {
    if (gerekce.trim().length < GEREKCE_EN_AZ) return;
    setCalisiyor(true);
    setHata(null);

    try {
      // ⚠️ `otomatikTekrarla` YOK ve `idempotencyKey` YOK — uç idempotent değil.
      //    Çift tıklama koruması tamamen burada: `calisiyor` düğmeyi kapatıyor.
      await apiFetch<PayoutRejectionWire, `/admin/payouts/${string}/reject`>(
        `/admin/payouts/${payoutId}/reject`,
        { method: 'POST', json: { reason: gerekce.trim() } },
      );
      router.refresh();
    } catch (error) {
      if (isApiFailure(error) && error.code === 'PAYOUT_INVALID_STATE') {
        router.refresh();
      } else {
        setHata(error);
      }
    } finally {
      setCalisiyor(false);
    }
  }

  if (mod === 'kapali') {
    return (
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          disabled={calisiyor}
          onClick={() => {
            setMod('onay');
          }}
        >
          Onayla
        </Button>
        <Button
          size="sm"
          variant="ikincil"
          disabled={calisiyor}
          onClick={() => {
            setMod('red');
          }}
        >
          Reddet
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-3 text-left">
      {mod === 'onay' ? (
        <>
          <p className="text-sm text-metin">
            <span className="font-medium">{saticiAdi}</span> için{' '}
            <Fiyat value={tutarMinor} className="text-sm" /> tutarında ödeme onaylanacak.
          </p>
          {/*
            ⚠️ "Bakiyeden düşülecek" DENMEZ. Onay defterde `PAYOUT` satırı
               oluşturmuyor (`recordPayoutSettlement` yazılmış ama çağıranı yok);
               satıcı bakiyesinde bu tutarı onaydan sonra da görmeye devam eder.
          */}
          <p className="text-xs text-metin-soluk">
            Onay parayı göndermez: gönderim ayrı bir adımda yapılır ve talep o ana kadar
            &quot;gönderim bekliyor&quot; kalır.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={calisiyor}
              onClick={() => {
                void onayla();
              }}
            >
              {calisiyor ? 'Onaylanıyor…' : 'Onayı gönder'}
            </Button>
            <Button
              size="sm"
              variant="sessiz"
              disabled={calisiyor}
              onClick={() => {
                setMod('kapali');
                setHata(null);
              }}
            >
              Vazgeç
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`red-gerekce-${payoutId}`}>Red gerekçesi</Label>
            <textarea
              id={`red-gerekce-${payoutId}`}
              value={gerekce}
              onChange={(olay) => {
                setGerekce(olay.target.value);
              }}
              minLength={GEREKCE_EN_AZ}
              maxLength={GEREKCE_EN_FAZLA}
              rows={3}
              className="w-full rounded-md border border-kenar bg-zemin p-2 text-sm text-metin placeholder:text-metin-soluk"
              placeholder="Örn. IBAN sahibi ile mağaza unvanı uyuşmuyor — belge talep edildi."
            />
            <p className="text-xs text-metin-soluk">
              En az <span className="rakam">{GEREKCE_EN_AZ}</span> karakter. Gerekçe denetim kaydına
              yazılır ve satıcıya iletilir.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="tehlike"
              disabled={calisiyor || gerekce.trim().length < GEREKCE_EN_AZ}
              onClick={() => {
                void reddet();
              }}
            >
              {calisiyor ? 'Reddediliyor…' : 'Talebi reddet'}
            </Button>
            <Button
              size="sm"
              variant="sessiz"
              disabled={calisiyor}
              onClick={() => {
                setMod('kapali');
                setHata(null);
              }}
            >
              Vazgeç
            </Button>
          </div>
        </>
      )}

      {odenebilir !== null ? (
        <p className="text-sm text-uyari">
          Sunucunun bildirdiği ödenebilir tutar: <Fiyat value={odenebilir} className="text-sm" />
        </p>
      ) : null}

      {hata ? (
        <HataGosterimi
          error={hata}
          onRetry={() => {
            void (mod === 'onay' ? onayla() : reddet());
          }}
        />
      ) : null}
    </div>
  );
}
