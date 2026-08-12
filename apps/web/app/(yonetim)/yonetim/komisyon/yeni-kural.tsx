'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { isApiFailure } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { fieldErrorMap } from '@/components/hata/alan-hatalari';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// ⚠️ KOPYA DEĞİL, PAYLAŞIM. Kullanıcının yazdığı tutarı/oranı metin üzerinden
//    `bigint`e çözen tek uygulama bu dosya (AGENTS.md §3 onu kalıp olarak
//    gösteriyor). İkinci bir kopya yazmak, Türkçe ayraç sezgiselinin ("1.290"
//    binlik mi ondalık mı) iki farklı sürümünü üretirdi ve bu depoda kopya
//    sapması ÖLÇÜLMÜŞ bir olay. Göreli yol geçici: dosya `src/lib/` altına
//    taşınmalı (raporda "PAYLAŞILANA TAŞINMALI").
import { kurusCoz, yuzdeCoz } from '@/lib/sayi';
import { yuzdeBps } from '@/lib/sayi-bicim';
import type { CommissionScopeWire, CommissionRuleCreatedWire } from '@vt/contracts';

/**
 * YENİ KOMİSYON KURALI.
 *
 * ⚠️ Bu uç `IdempotentPath` LİSTESİNDE DEĞİL, yani anahtar gönderilmez ve
 *    gönderilemez (tip engelliyor). Çift gönderime karşı koruma sunucuda:
 *    aynı (kategori, satıcı) çifti için ikinci kural `DUPLICATE_RESOURCE`
 *    alır — advisory lock + `UNIQUE … NULLS NOT DISTINCT`. Bu yüzden burada
 *    `otomatikTekrarla` KULLANILMIYOR: anahtarsız bir POST'u otomatik
 *    tekrarlamak `retry-policy.ts`in açıkça yasakladığı şey.
 */
export function YeniKuralFormu({
  kategoriler,
  saticilar,
  maxRateBps,
}: {
  kategoriler: Array<{ id: string; ad: string }>;
  saticilar: Array<{ id: string; ad: string }>;
  /** ⚠️ `@vt/config/constants` → `FINANCE.maxCommissionBps`. Sayı, bigint değil: RSC sınırını geçer. */
  maxRateBps: number;
}): React.ReactElement {
  const router = useRouter();
  const [acik, setAcik] = React.useState(false);
  const [kapsam, setKapsam] = React.useState<CommissionScopeWire>('PLATFORM');
  const [kategoriId, setKategoriId] = React.useState('');
  const [saticiId, setSaticiId] = React.useState('');
  const [etiket, setEtiket] = React.useState('');
  const [oran, setOran] = React.useState('');
  const [sabitUcret, setSabitUcret] = React.useState('0');
  const [baslangic, setBaslangic] = React.useState('');
  const [hata, setHata] = React.useState<unknown>(null);
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [sonuc, setSonuc] = React.useState<CommissionRuleCreatedWire | null>(null);

  const kategoriGerekli = kapsam === 'CATEGORY' || kapsam === 'SELLER_CATEGORY';
  const saticiGerekli = kapsam === 'SELLER' || kapsam === 'SELLER_CATEGORY';

  /**
   * ⚠️ ORAN `Number(oran)` İLE OKUNMAZ. "%12,5" yazan bir yöneticide
   *    `Number('12,5')` → `NaN`, `parseFloat('12,5')` → `12` olurdu: ikincisi
   *    sessizce YANLIŞ bir oran gönderir ve komisyon yarım puan eksik kesilir.
   *    Metin → basamak → tam sayı bps.
   */
  const bps = oran.trim() === '' ? null : yuzdeCoz(oran, maxRateBps);
  const sabitKurus = sabitUcret.trim() === '' ? 0n : kurusCoz(sabitUcret, 100_000_00n);

  // ⚠️ `hata.details` tipi `unknown`; alan listesi `fields` GETTER'ından okunur.
  //    `details.fields`e doğrudan uzanmak derlenmez ve derlenseydi de biçim
  //    sapmasında `undefined.map` üretirdi.
  const alanHatalari = isApiFailure(hata) ? fieldErrorMap(hata.fields) : {};

  const gonderilebilir =
    etiket.trim().length >= 3 &&
    bps !== null &&
    sabitKurus !== null &&
    (!kategoriGerekli || kategoriId !== '') &&
    (!saticiGerekli || saticiId !== '');

  async function gonder(): Promise<void> {
    if (!gonderilebilir || bps === null || sabitKurus === null) return;
    setGonderiliyor(true);
    setHata(null);

    try {
      const { data } = await apiFetch<CommissionRuleCreatedWire, '/admin/commission-rules'>(
        '/admin/commission-rules',
        {
          method: 'POST',
          json: {
            label: etiket.trim(),
            rateBps: bps,
            // ⚠️ `minorAmountSchema` yalnızca RAKAM DİZİSİ kabul ediyor
            //    (`/^-?\d{1,18}$/`). `bigint` JSON'a serileşmez.
            fixedFeeMinor: sabitKurus.toString(),
            ...(kategoriGerekli ? { categoryId: kategoriId } : {}),
            ...(saticiGerekli ? { sellerId: saticiId } : {}),
            ...(baslangic ? { validFrom: baslangic } : {}),
          },
        },
      );
      setSonuc(data);
      // Liste Sunucu Bileşeninde; yeni kuralın görünmesi için yeniden çekilir.
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
        <span className="font-medium">{sonuc.label}</span> kuralı oluşturuldu; ilk versiyonu{' '}
        <span className="rakam">{yuzdeBps(sonuc.currentVersion.rateBps)}</span> oranıyla yürürlüğe
        girdi. Oranı değiştirmek için kural detayından yeni versiyon başlatın.
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
          Yeni kural tanımla
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
      <h2 className="text-sm font-semibold text-metin">Yeni kural tanımla</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kural-kapsam">Kapsam</Label>
          <select
            id="kural-kapsam"
            value={kapsam}
            onChange={(olay) => {
              setKapsam(olay.target.value as CommissionScopeWire);
            }}
            className="h-10 rounded-md border border-kenar bg-zemin px-3 text-sm text-metin"
          >
            <option value="PLATFORM">Platform varsayılanı</option>
            <option value="CATEGORY">Kategori</option>
            <option value="SELLER">Satıcı</option>
            <option value="SELLER_CATEGORY">Satıcı + kategori</option>
          </select>
          {/* ⚠️ Sunucu bu hatayı `details.fields[0].path = 'categoryId'` ile
              döndürüyor (DUPLICATE_RESOURCE); kapsam alanının altına basılıyor
              çünkü düzeltilecek şey kapsam seçimidir. */}
          {alanHatalari.categoryId ? (
            <p className="text-xs text-tehlike">{alanHatalari.categoryId}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kural-etiket">Etiket</Label>
          <Input
            id="kural-etiket"
            value={etiket}
            onChange={(olay) => {
              setEtiket(olay.target.value);
            }}
            minLength={3}
            maxLength={120}
            placeholder="Örn. Dış giyim komisyonu"
          />
        </div>

        {kategoriGerekli ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kural-kategori">Kategori</Label>
            <select
              id="kural-kategori"
              value={kategoriId}
              onChange={(olay) => {
                setKategoriId(olay.target.value);
              }}
              className="h-10 rounded-md border border-kenar bg-zemin px-3 text-sm text-metin"
            >
              <option value="">Seçin…</option>
              {kategoriler.map((kategori) => (
                <option key={kategori.id} value={kategori.id}>
                  {kategori.ad}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {saticiGerekli ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kural-satici">Satıcı</Label>
            <select
              id="kural-satici"
              value={saticiId}
              onChange={(olay) => {
                setSaticiId(olay.target.value);
              }}
              className="h-10 rounded-md border border-kenar bg-zemin px-3 text-sm text-metin"
            >
              <option value="">Seçin…</option>
              {saticilar.map((satici) => (
                <option key={satici.id} value={satici.id}>
                  {satici.ad}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kural-oran">Komisyon oranı (%)</Label>
          <Input
            id="kural-oran"
            inputMode="decimal"
            className="rakam"
            value={oran}
            onChange={(olay) => {
              setOran(olay.target.value);
            }}
            aria-invalid={oran.trim() !== '' && bps === null}
            aria-describedby="kural-oran-ipucu"
            placeholder="12,50"
          />
          <p id="kural-oran-ipucu" className="text-xs text-metin-soluk">
            En fazla <span className="rakam">{yuzdeBps(maxRateBps)}</span>.
            {oran.trim() !== '' && bps === null
              ? ' Girilen oran okunamadı ya da tavanı aşıyor.'
              : bps !== null
                ? ` Gönderilecek değer: ${bps} bps.`
                : ''}
          </p>
          {alanHatalari.rateBps ? (
            <p className="text-xs text-tehlike">{alanHatalari.rateBps}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kural-sabit">Sabit ücret (₺)</Label>
          <Input
            id="kural-sabit"
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
          <Label htmlFor="kural-baslangic">Yürürlük başlangıcı</Label>
          {/*
            ⚠️ `min` BUGÜN. Sunucu geçmişe dönük `validFrom`u reddediyor
               (`planCommissionVersion`): geçmişe oran yazmak, kesilmiş
               komisyonları geriye dönük değiştirmeye çalışmaktır ve mümkün
               değildir. Alan kapatılmasaydı yönetici formu doldurup 400 alırdı.
          */}
          <Input
            id="kural-baslangic"
            type="date"
            className="rakam"
            min={bugun()}
            value={baslangic}
            onChange={(olay) => {
              setBaslangic(olay.target.value);
            }}
          />
          <p className="text-xs text-metin-soluk">Boş bırakılırsa hemen yürürlüğe girer.</p>
        </div>
      </div>

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
          {gonderiliyor ? 'Gönderiliyor…' : 'Kuralı oluştur'}
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

/**
 * ⚠️ `toISOString().slice(0,10)` DEĞİL: UTC'ye göre keser ve Türkiye saatiyle
 *    03:00 öncesinde bir GÜN GERİ kayar — yani gece yarısı kural tanımlayan
 *    yönetici için "bugün" dün olurdu ve sunucu geçmiş tarih diye reddederdi.
 */
function bugun(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
