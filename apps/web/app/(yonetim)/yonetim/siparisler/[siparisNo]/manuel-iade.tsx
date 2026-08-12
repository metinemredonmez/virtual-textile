'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { isApiFailure } from '@vt/contracts';
import { apiFetch, newIdempotencyKey } from '@/lib/api/client';
import { otomatikTekrarla } from '@/lib/api/retry-policy';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { fieldErrorMap } from '@/components/hata/alan-hatalari';
import { Fiyat } from '@/components/fiyat/fiyat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// ⚠️ Gerekçe `komisyon/yeni-kural.tsx` başındaki notta: kullanıcının yazdığı
//    tutarı metin üzerinden `bigint`e çözen TEK uygulama; kopyası yazılmaz.
import { kurusCoz } from '@/lib/sayi';
import { hataTutari } from '@/lib/api/hata-tutari';
import type { AdminManualRefundWire } from '@vt/contracts';

/** `reasonSchema`: 10–500 karakter. */
const GEREKCE_EN_AZ = 10;
const GEREKCE_EN_FAZLA = 500;

/** Tek seferde girilebilecek üst sınır — 1.000.000,00 ₺. Gerçek kapı sunucuda. */
const TUTAR_TAVANI = 100_000_000n;

/**
 * MANUEL İADE.
 *
 * ⚠️ EKRANDA "KALAN İADE EDİLEBİLİR" DİYE BİR RAKAM YOK, VE BU BİLİNÇLİ.
 *    O tutar `tahsil edilen − (başarısız olmayan önceki iadeler)` ile bulunuyor
 *    ve hesap ÖDEME kayıtları üzerinden sunucuda yapılıyor. Burada tekrar
 *    toplamak DEĞİŞMEZ KURAL #1'in ("toplamlar frontend'de hesaplanmaz")
 *    doğrudan ihlali olurdu ve iki hesap ayrıştığında yönetici, sunucunun
 *    reddedeceği bir tutarı güvenle girerdi. Rakam yalnızca sunucudan geldiğinde
 *    gösteriliyor: başarılı yanıtta `remainingRefundableMinor`, reddedilen
 *    istekte hata zarfının `details.remainingRefundableMinor` alanı.
 *
 * ⚠️ TUTAR `MinorString` DEĞİLDİR. Yöneticinin yazdığı bir sayı API yanıtından
 *    doğmadı; `unsafeMinorString` ile marka basmak "bu para telden geldi"
 *    güvencesini bütün depo için delerdi. Bu yüzden girdi `kurusCoz` ile
 *    `bigint`e çözülüp gövdeye rakam dizisi olarak yazılıyor ve `<Fiyat>` ile
 *    GÖSTERİLMİYOR — yalnızca sunucudan dönen tutarlar `<Fiyat>`ten geçiyor.
 *
 * ⚠️ YANIT "PARA GİTTİ" DEMEZ. `AdminFinanceService.manualRefund` denetim kaydı
 *    ve `order.refund.manual.requested` OutboxEvent'i yazıyor, başka bir şey
 *    yapmıyor. Ölçüldü: bu olay tipini dinleyen HİÇBİR işçi yok. Ekranda "İade
 *    edildi" yazmak, olmamış bir para hareketini olmuş göstermek olurdu.
 */
export function ManuelIadeFormu({
  siparisId,
  siparisNo,
}: {
  siparisId: string;
  siparisNo: string;
}): React.ReactElement {
  const router = useRouter();
  const [acik, setAcik] = React.useState(false);
  const [tutar, setTutar] = React.useState('');
  const [gerekce, setGerekce] = React.useState('');
  const [hata, setHata] = React.useState<unknown>(null);
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [sonuc, setSonuc] = React.useState<AdminManualRefundWire | null>(null);

  /**
   * ⚠️ ANAHTAR NİYETE BAĞLI, `useRef`TE. Sabit tek anahtar yanlış olurdu:
   *    yönetici tutarı düzeltip yeniden gönderdiğinde sunucu ilk yanıtı 24 saat
   *    geri oynatır ve yönetici düzelttiği tutarın işlendiğini sanır. Her
   *    render'da yeni anahtar da yanlış: tek bir hata üç ayrı iade açar. Çözüm
   *    `hesabim/.../iade-formu.tsx` ile aynı — anahtar YÜKÜN İMZASINA bağlı.
   */
  const niyetRef = React.useRef<{ imza: string; anahtar: string } | null>(null);

  const kurus = tutar.trim() === '' ? null : kurusCoz(tutar, TUTAR_TAVANI);
  const alanHatalari = isApiFailure(hata) ? fieldErrorMap(hata.fields) : {};
  const kalanHatadan = isApiFailure(hata)
    ? hataTutari(hata.details, 'remainingRefundableMinor')
    : null;

  const gonderilebilir = kurus !== null && kurus > 0n && gerekce.trim().length >= GEREKCE_EN_AZ;

  function anahtarAl(imza: string): string {
    if (niyetRef.current?.imza === imza) return niyetRef.current.anahtar;
    const anahtar = newIdempotencyKey();
    niyetRef.current = { imza, anahtar };
    return anahtar;
  }

  async function gonder(): Promise<void> {
    if (!gonderilebilir || kurus === null) return;

    const govde = { amountMinor: kurus.toString(), reason: gerekce.trim() };
    const anahtar = anahtarAl(JSON.stringify(govde));

    setGonderiliyor(true);
    setHata(null);

    try {
      /**
       * ⚠️ ANAHTAR SARMALAYICININ DIŞINDA ve üç denemede de AYNI. İçeride
       *    üretilseydi `IDEMPOTENCY_IN_PROGRESS` üzerine ÜÇ AYRI İADE açılırdı
       *    — otomatik tekrarın tek güvenlik şartı budur.
       */
      const { data } = await otomatikTekrarla(() =>
        apiFetch<AdminManualRefundWire, `/admin/orders/${string}/refund`>(
          `/admin/orders/${siparisId}/refund`,
          { method: 'POST', json: govde, idempotencyKey: anahtar },
        ),
      );
      setSonuc(data);
      router.refresh();
    } catch (error) {
      // ⚠️ Anahtar SIFIRLANMAZ: hata "belki işlendi belki işlenmedi" olabilir
      //    (zaman aşımı). Aynı anahtarla tekrar denemek tek güvenli davranış.
      setHata(error);
    } finally {
      setGonderiliyor(false);
    }
  }

  if (sonuc) {
    return (
      <div role="status" className="rounded-md border border-kenar bg-yuzey p-4 text-sm">
        <p className="font-medium text-metin">
          İade talebi kaydedildi — <span className="rakam">{sonuc.refundRef}</span>
        </p>
        {/*
          ⚠️ "İade edildi" DEĞİL. `status: 'REFUND_REQUESTED'` yalnızca kaydın
             yazıldığını söyler; para ödeme sağlayıcısına ayrı bir adımda
             gönderilir ve o adımı yürüten işçi bugün YOK.
        */}
        <p className="mt-1 text-metin-soluk">
          <Fiyat value={sonuc.amountMinor} className="text-sm" /> tutarındaki iade {siparisNo} için
          kuyruğa alındı. Para henüz gönderilmedi; gönderim ödeme modülü tarafından ayrı bir adımda
          yapılır.
        </p>
        <p className="mt-1 text-metin-soluk">
          Bu iadeden sonra kalan iade edilebilir tutar:{' '}
          <Fiyat value={sonuc.remainingRefundableMinor} className="text-sm" />
        </p>
      </div>
    );
  }

  if (!acik) {
    return (
      <div>
        <Button
          variant="ikincil"
          size="sm"
          onClick={() => {
            setAcik(true);
          }}
        >
          Manuel iade başlat
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(olay) => {
        olay.preventDefault();
        void gonder();
      }}
      className="flex flex-col gap-4 rounded-lg border border-kenar p-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-metin">Manuel iade — {siparisNo}</h2>
        <p className="mt-1 text-sm text-metin-soluk">
          Tutar, tahsil edilen ödemeden önceki iadeler düşüldükten sonra kalanı aşamaz. Kalan tutarı
          sunucu hesaplar; aşan bir istek reddedilir ve doğru rakam hata mesajında gelir.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="iade-tutar">İade tutarı (₺)</Label>
          <Input
            id="iade-tutar"
            inputMode="decimal"
            className="rakam"
            value={tutar}
            onChange={(olay) => {
              setTutar(olay.target.value);
            }}
            aria-invalid={tutar.trim() !== '' && kurus === null}
            aria-describedby="iade-tutar-ipucu"
            placeholder="1.290,00"
          />
          <p id="iade-tutar-ipucu" className="text-xs text-metin-soluk">
            {tutar.trim() !== '' && kurus === null
              ? 'Girilen tutar okunamadı.'
              : kurus !== null
                ? `Gönderilecek değer: ${kurus.toString()} kuruş.`
                : 'Örn. 1.290,00'}
          </p>
          {alanHatalari.amountMinor ? (
            <p className="text-xs text-tehlike">{alanHatalari.amountMinor}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="iade-gerekce">Gerekçe</Label>
          <textarea
            id="iade-gerekce"
            value={gerekce}
            onChange={(olay) => {
              setGerekce(olay.target.value);
            }}
            minLength={GEREKCE_EN_AZ}
            maxLength={GEREKCE_EN_FAZLA}
            rows={3}
            className="w-full rounded-md border border-kenar bg-zemin p-3 text-sm text-metin placeholder:text-metin-soluk"
            placeholder="Örn. Kargo hasarı — müşteri şikâyeti 8812, fotoğraflı kanıt alındı."
          />
          <p className="text-xs text-metin-soluk">
            En az <span className="rakam">{GEREKCE_EN_AZ}</span> karakter. Denetim kaydına yazılır.
          </p>
          {alanHatalari.reason ? (
            <p className="text-xs text-tehlike">{alanHatalari.reason}</p>
          ) : null}
        </div>
      </div>

      {/* ⚠️ Sunucu reddettiğinde kalan tutarı `details` içinde bildiriyor;
          mesajın kendisi rakamı içermiyor. Rakam gösterilmezse yönetici
          doğru tutarı tahmin etmek zorunda kalır. */}
      {kalanHatadan !== null ? (
        <p className="text-sm text-uyari">
          Sunucunun bildirdiği kalan iade edilebilir tutar:{' '}
          <Fiyat value={kalanHatadan} className="text-sm" />
        </p>
      ) : null}

      {hata ? (
        <HataGosterimi
          error={hata}
          onRetry={() => {
            void gonder();
          }}
        />
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" size="sm" disabled={gonderiliyor || !gonderilebilir}>
          {gonderiliyor ? 'Gönderiliyor…' : 'İade talebini kaydet'}
        </Button>
        <Button
          type="button"
          variant="sessiz"
          size="sm"
          onClick={() => {
            setAcik(false);
          }}
        >
          Vazgeç
        </Button>
      </div>
    </form>
  );
}
