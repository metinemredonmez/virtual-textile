'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { isApiFailure, type Locale } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { fieldErrorMap } from '@/components/hata/alan-hatalari';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// ⚠️ Gerekçe `komisyon/yeni-kural.tsx` başındaki notta: kullanıcı girdisini
//    `bigint`e çözen TEK uygulama; kopyası yazılmaz.
import { kurusCoz, yuzdeCoz } from '@/lib/sayi';
import { yuzdeBps } from '@/lib/sayi-bicim';
import type { CommissionVersionCreatedWire } from '@vt/contracts';

/** Gerekçe alanı sunucuda 10–500 karakter (`reasonSchema`). */
const GEREKCE_EN_AZ = 10;
const GEREKCE_EN_FAZLA = 500;

/**
 * YENİ VERSİYON BAŞLAT.
 *
 * ⚠️ BAŞLIK "ORANI DÜZENLE" DEĞİL, VE BU BİR ÜSLUP TERCİHİ DEĞİL. Uç
 *    `PATCH /commission-rules/:id` DEĞİL, `POST /commission-rules/:id/versions`.
 *    Denetleyicideki yorum sebebini yazıyor: "PATCH sunulsaydı, arayüz
 *    tarafında 'oranı düzelt' beklentisi doğar ve er geç birileri UPDATE
 *    yazardı." Arayüzdeki fiil, HTTP fiiliyle aynı olmalı — yoksa sözleşmeyi
 *    arayüz tarafından geri deler.
 *
 * ⚠️ `reason` ZORUNLU ve bu form onsuz gönderilemez. Gerekçe denetim kaydına
 *    (`AuditLog`) yazılıyor ve "bu oran neden değişti" sorusunun tek cevabı o.
 */
export function YeniVersiyonFormu({
  ruleId,
  etiket,
  maxRateBps,
  mevcutOranBps,
}: {
  ruleId: string;
  etiket: string;
  maxRateBps: number;
  /** Bugün yürürlükteki oran — yalnızca "neyi değiştiriyorsunuz" bilgisi için. */
  mevcutOranBps: number | null;
}): React.ReactElement {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const [acik, setAcik] = React.useState(false);
  const [oran, setOran] = React.useState('');
  const [sabitUcret, setSabitUcret] = React.useState('0');
  const [baslangic, setBaslangic] = React.useState('');
  const [gerekce, setGerekce] = React.useState('');
  const [hata, setHata] = React.useState<unknown>(null);
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [sonuc, setSonuc] = React.useState<CommissionVersionCreatedWire | null>(null);

  const bps = oran.trim() === '' ? null : yuzdeCoz(oran, maxRateBps);
  const sabitKurus = sabitUcret.trim() === '' ? 0n : kurusCoz(sabitUcret, 100_000_00n);

  // ⚠️ `details` tipi `unknown`; alan listesi `fields` GETTER'ından okunur.
  const alanHatalari = isApiFailure(hata) ? fieldErrorMap(hata.fields, locale) : {};

  const gonderilebilir =
    bps !== null && sabitKurus !== null && gerekce.trim().length >= GEREKCE_EN_AZ;

  async function gonder(): Promise<void> {
    if (!gonderilebilir || bps === null || sabitKurus === null) return;
    setGonderiliyor(true);
    setHata(null);

    try {
      const { data } = await apiFetch<
        CommissionVersionCreatedWire,
        `/admin/commission-rules/${string}/versions`
      >(`/admin/commission-rules/${ruleId}/versions`, {
        method: 'POST',
        json: {
          rateBps: bps,
          fixedFeeMinor: sabitKurus.toString(),
          reason: gerekce.trim(),
          ...(baslangic ? { validFrom: baslangic } : {}),
        },
      });
      setSonuc(data);
      router.refresh();
    } catch (error) {
      setHata(error);
    } finally {
      setGonderiliyor(false);
    }
  }

  if (sonuc) {
    return (
      <div role="status" className="rounded-md bg-olumlu-zemin p-3 text-sm text-olumlu">
        <span className="rakam font-medium">{yuzdeBps(sonuc.version.rateBps)}</span> oranlı yeni
        versiyon yazıldı.
        {sonuc.closedVersionId === null
          ? ' Bu kuralın ilk versiyonuydu.'
          : ' Önceki versiyon kapatıldı; geçmiş siparişler kendi oranını taşımaya devam ediyor.'}
      </div>
    );
  }

  if (!acik) {
    return (
      <div className="border-t border-kenar pt-4">
        <Button
          variant="ikincil"
          size="sm"
          onClick={() => {
            setAcik(true);
          }}
        >
          Yeni versiyon başlat
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
        <h2 className="text-sm font-semibold text-metin">{etiket} — yeni versiyon başlat</h2>
        {mevcutOranBps !== null ? (
          <p className="mt-1 text-sm text-metin-soluk">
            Bugünkü oran <span className="rakam">{yuzdeBps(mevcutOranBps)}</span>.
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="versiyon-oran">Yeni oran (%)</Label>
          <Input
            id="versiyon-oran"
            inputMode="decimal"
            className="rakam"
            value={oran}
            onChange={(olay) => {
              setOran(olay.target.value);
            }}
            aria-invalid={oran.trim() !== '' && bps === null}
            aria-describedby="versiyon-oran-ipucu"
            placeholder="12,50"
          />
          <p id="versiyon-oran-ipucu" className="text-xs text-metin-soluk">
            En fazla <span className="rakam">{yuzdeBps(maxRateBps)}</span>.
            {oran.trim() !== '' && bps === null
              ? ' Girilen oran okunamadı ya da tavanı aşıyor.'
              : bps !== null
                ? ` Gönderilecek değer: ${bps} bps.`
                : ''}
          </p>
          {/* Sunucu tavanı aşan oranda `COMMISSION_RATE_ABOVE_CAP` (422) ve
              `details.fields[0].path = 'rateBps'` döndürüyor; mesaj sunucudan
              geldiği gibi basılır. */}
          {alanHatalari.rateBps ? (
            <p className="text-xs text-tehlike">{alanHatalari.rateBps}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="versiyon-sabit">Sabit ücret (₺)</Label>
          <Input
            id="versiyon-sabit"
            inputMode="decimal"
            className="rakam"
            value={sabitUcret}
            onChange={(olay) => {
              setSabitUcret(olay.target.value);
            }}
            aria-invalid={sabitUcret.trim() !== '' && sabitKurus === null}
            placeholder="0,00"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="versiyon-baslangic">Yürürlük başlangıcı</Label>
          {/*
            ⚠️ Geçmiş tarih SUNUCUDA reddediliyor; ayrıca yeni başlangıç mevcut
               versiyonun başlangıcından SONRA olmak zorunda. Takvimin geçmişi
               kapalı, ama gerçek kapı sunucuda — burası yalnızca reddedilecek
               bir formu doldurtmamak için.
          */}
          <Input
            id="versiyon-baslangic"
            type="date"
            className="rakam"
            min={bugun()}
            value={baslangic}
            onChange={(olay) => {
              setBaslangic(olay.target.value);
            }}
          />
          <p className="text-xs text-metin-soluk">Boş bırakılırsa hemen başlar.</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="versiyon-gerekce">Değişiklik gerekçesi</Label>
        <textarea
          id="versiyon-gerekce"
          value={gerekce}
          onChange={(olay) => {
            setGerekce(olay.target.value);
          }}
          minLength={GEREKCE_EN_AZ}
          maxLength={GEREKCE_EN_FAZLA}
          rows={3}
          className="w-full rounded-md border border-kenar bg-zemin p-3 text-sm text-metin placeholder:text-metin-soluk"
          placeholder="Örn. 2026 Q3 kategori pazarlığı sonucu indirim — talep no 4471."
        />
        <p className="text-xs text-metin-soluk">
          En az <span className="rakam">{GEREKCE_EN_AZ}</span> karakter. Denetim kaydına yazılır; bu
          değişikliğin neden yapıldığının tek kaydı budur.
        </p>
        {alanHatalari.reason ? <p className="text-xs text-tehlike">{alanHatalari.reason}</p> : null}
      </div>

      {/*
        ⚠️ BU CÜMLE UYARI RENGİ ALMAZ. Bir hata değil, sözleşmenin kendisi:
           versiyonlama zaten böyle çalışıyor. Uyarı rengi verilseydi her yeni
           versiyonda ekranda kırmızı/sarı bir kutu belirir ve "Tükendi",
           "Ödeme başarısız" gibi gerçek uyarılarla aynı sinyali harcardı.
      */}
      <p className="rounded-md border border-kenar bg-yuzey p-3 text-sm text-metin-soluk">
        Yeni versiyon yalnızca yürürlük tarihinden sonraki siparişlere uygulanır. Mevcut siparişler
        kendi anındaki oranı taşır ve değişmez.
      </p>

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
          {gonderiliyor ? 'Yazılıyor…' : 'Yeni versiyonu yaz'}
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

/** ⚠️ Gerekçe `yeni-kural.tsx` içindeki ikiziyle aynı: UTC kesme günü kaydırır. */
function bugun(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
