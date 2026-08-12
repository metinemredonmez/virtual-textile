'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
// ⚠️ `Money` BU DOSYADAN ÇIKTI ve geri girmemeli: `Money.formatMoney` çağrısı
//    ekran kodunda hiç görünmez (AGENTS.md §3). Telden gelen tutar `<Fiyat>`e,
//    kullanıcının yazdığı `<Tutar>`a.
import { isApiFailure, type MinorString } from '@vt/contracts';
import { apiFetch, newIdempotencyKey } from '@/lib/api/client';
import { readMinor } from '@/lib/money';
import { Fiyat } from '@/components/fiyat/fiyat';
import { Tutar } from '@/components/fiyat/tutar';
import { fieldErrorMap } from '@/components/hata/alan-hatalari';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// ⚠️ ROTA GRUBU DIŞINDAN İMPORT — bilinçli ve geçici.
//    `kurusCoz` "kullanıcının yazdığı metin → kuruş" dönüşümünün TEK sınanmış
//    uygulaması (`hesaplayici/sayi.test.ts`). Türkçe girdide `.` hem binlik hem
//    ondalık ayracı olabildiği için burada ikinci bir ayrıştırıcı yazmak,
//    sessizce on kat sapan bir tutar üretme riskidir. Doğru yer `src/lib/`;
//    taşınması raporlandı ("PAYLAŞILANA TAŞINMALI").
import { kurusCoz } from '@/lib/sayi';
import type { SellerPayoutRequestWire } from '@vt/contracts';

/**
 * ÖDEME TALEBİ.
 *
 * ⚠️ TUTAR AÇIKÇA İSTENİYOR, "hepsini çek" kısayolu YOK — ve bu sunucunun
 *    bilinçli kararı: talep anındaki çekilebilir bakiye ile satıcının ekranda
 *    gördüğü tutar farklı olabilir (arada bir iade düşmüş olabilir). Açık tutar,
 *    idempotency özetini de kararlı kılar.
 *
 * ⚠️ KULLANICININ YAZDIĞI TUTAR `MinorString` DEĞİLDİR. Marka "bu para API
 *    yanıtından doğdu" güvencesidir; `unsafeMinorString` ile marka basmak o
 *    güvenceyi bütün depo için delerdi (AGENTS.md §3). Bu yüzden girdi
 *    `bigint` olarak tutulur ve ekrana `<Tutar>` ile basılır; `<Fiyat>`e
 *    SOKULMAZ — `<Fiyat>` yalnız TELDEN gelen tutarlar içindir. Gövdeye
 *    `.toString()` ile düz string olarak gider (`minorAmountSchema` zaten
 *    string bekliyor).
 *
 * ⚠️ TERSİ DE GEÇERLİ ve bir dönem ihlal ediliyordu: talep yanıtındaki
 *    `sonuc.amountMinor` SUNUCUDAN gelir, yani `<Fiyat>` ile basılır. Elle
 *    biçimlenmesi, aynı ekranda telden gelen para için ikinci bir biçimleme
 *    yolu demekti.
 *
 * ⚠️ DÜĞMENİN KAPALILIK KARARI `canRequestPayout`TAN GELİR, burada yeniden
 *    hesaplanmaz. Yeniden hesaplansaydı "bekleyen talep varken yeni talep
 *    açılamaz" şartı sessizce düşerdi — satıcının aynı parayı iki kez talep
 *    etmesinin önündeki tek kilit o şart.
 *    Burada hesaplanan tek şey, düğmenin NEDEN kapalı olduğunu söyleyen
 *    cümledir: sebep söylenmezse satıcı kapalı düğmeye bakıp destek arar.
 */
export function PayoutFormu({
  cekilebilirMinor,
  asgariMinor,
  talepEdilebilir,
  bekleyenTalepVar,
}: {
  cekilebilirMinor: MinorString;
  asgariMinor: MinorString;
  talepEdilebilir: boolean;
  bekleyenTalepVar: boolean;
}): React.ReactElement {
  const router = useRouter();

  const [ham, setHam] = React.useState('');
  const [hata, setHata] = React.useState<unknown>(null);
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [sonuc, setSonuc] = React.useState<SellerPayoutRequestWire | null>(null);

  const cekilebilir = readMinor(cekilebilirMinor).amountMinor;
  const asgari = readMinor(asgariMinor).amountMinor;

  /**
   * ⚠️ Anahtar `useRef`te ve TUTARIN İMZASINA bağlı. Sabit tek anahtar,
   *    satıcı tutarı düzeltip yeniden gönderdiğinde ilk yanıtı 24 saat geri
   *    oynatır ve satıcı düzelttiği tutarın talep edildiğini sanardı.
   */
  const niyetRef = React.useRef<{ imza: string; anahtar: string } | null>(null);

  const tutar = ham.trim() === '' ? null : kurusCoz(ham, cekilebilir);
  const alanHatalari = isApiFailure(hata) ? fieldErrorMap(hata.fields) : {};

  async function gonder(): Promise<void> {
    if (tutar === null || tutar < asgari) return;

    const govde = { amountMinor: tutar.toString() };
    const imza = govde.amountMinor;
    if (niyetRef.current?.imza !== imza) {
      niyetRef.current = { imza, anahtar: newIdempotencyKey() };
    }

    setGonderiliyor(true);
    setHata(null);

    try {
      /**
       * ⚠️ `otomatikTekrarla` KULLANILMIYOR. Bu uçta otomatik tekrarı hak eden
       *    tek kod `IDEMPOTENCY_IN_PROGRESS`; onun dışındaki hatalar
       *    (`PAYOUT_PENDING_EXISTS`, `PAYOUT_BELOW_MINIMUM`,
       *    `PAYOUT_INSUFFICIENT_BALANCE`) tekrarlanınca değişmez ve hepsi
       *    `retry-policy.ts`te `yok` davranışında. Sarmalayıcıyı yine de
       *    koymak, para hareketi başlatan bir uca sebepsiz ikinci istek atma
       *    alışkanlığı olurdu.
       */
      const { data } = await apiFetch<SellerPayoutRequestWire, '/seller/finance/payout'>(
        '/seller/finance/payout',
        { method: 'POST', json: govde, idempotencyKey: niyetRef.current.anahtar },
      );
      setSonuc(data);
      // Bakiye kartları ve talep listesi değişti; yenilenmezse satıcı
      // "Talep Et" düğmesini hâlâ açık görür.
      router.refresh();
    } catch (error) {
      setHata(error);
      // ⚠️ Anahtar SIFIRLANMAZ: zaman aşımı "belki işlendi" demektir.
    } finally {
      setGonderiliyor(false);
    }
  }

  if (sonuc) {
    return (
      <div
        role="status"
        className="flex flex-col gap-1 rounded-md bg-olumlu-zemin p-3 text-sm text-olumlu"
      >
        <p>
          <Fiyat value={sonuc.amountMinor} /> tutarında ödeme talebiniz alındı.
        </p>
        {/* ⚠️ Maskeli IBAN yalnızca BU yanıtta bir kez döner; listede ve
            `/seller/me` yanıtında yok. Burada göstermezsek satıcı hangi hesaba
            talep açtığını hiçbir yerde göremez. */}
        <p className="rakam">Ödeme {sonuc.ibanMasked} hesabına yapılacak.</p>
        <p>Talebiniz yönetim onayından sonra işleme alınır.</p>
      </div>
    );
  }

  /**
   * KAPALILIK GEREKÇESİ — sıra sunucunun uygunluk sırasıyla AYNI
   * (`assertPayoutEligible`: asgari → bekleyen talep → bakiye).
   *
   * ⚠️ Sıra bilerek aynı: ekran önce "bekleyen talebin var" deyip talep
   *    kapandıktan sonra "zaten asgarinin altındaydın" derse, satıcı iki kez
   *    boşuna beklemiş olur. Backend bu sorunu çözmüş; arayüz bozmamalı.
   */
  const gerekce: React.ReactNode = talepEdilebilir ? null : cekilebilir < asgari ? (
    /*
          ⚠️ BU CÜMLE DİZGİ DEĞİL, JSX — ve sebebi kural: `asgariMinor` ve
             `cekilebilirMinor` TELDEN geliyor, yani `<Fiyat>` yolundan çıkmak
             zorunda (AGENTS.md §3). Dizgi hâlinde `Money.formatMoney` ekran
             koduna sızmıştı ve ikinci bir sonucu vardı: düz şablon dizgisi
             `rakam` (tabular-nums) sınıfını taşımadığı için AYNI iki tutar,
             aynı ekranda, otuz satır aşağıdaki `<Tutar>` gösterimiyle farklı
             tipografide çıkıyordu.
        */
    <>
      Çekilebilir bakiyeniz asgari ödeme tutarının altında. En az{' '}
      <Fiyat value={asgariMinor} className="text-sm" /> birikmesi gerekiyor; şu an{' '}
      <Fiyat value={cekilebilirMinor} className="text-sm" /> çekilebilir durumda.
    </>
  ) : bekleyenTalepVar ? (
    'Sonuçlanmamış bir ödeme talebiniz var. Aynı anda yalnızca bir talep açık olabilir; mevcut talep sonuçlanınca yenisini oluşturabilirsiniz.'
  ) : (
    'Ödeme talebi şu anda oluşturulamıyor.'
  );

  if (gerekce !== null) {
    return (
      <div className="flex flex-col gap-2">
        <Button disabled>Ödeme talebi oluştur</Button>
        {/*
          ⚠️ Gerekçe metni RENK TAŞIMAZ: bu bir hata değil, sistemin normal
             hâli. Uyarı rengi verilseydi, gerçekten yanlış giden bir şey
             olduğunda satıcı onu ayırt edemezdi.
        */}
        <div className="max-w-prose text-sm text-metin-soluk">{gerekce}</div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(olay) => {
        olay.preventDefault();
        void gonder();
      }}
      className="flex flex-col gap-4"
    >
      {hata ? <HataGosterimi error={hata} onRetry={() => void gonder()} /> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payout-tutari">Talep tutarı</Label>
        <Input
          id="payout-tutari"
          value={ham}
          onChange={(olay) => setHam(olay.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder="1.000,00"
          className="rakam max-w-48"
          aria-invalid={alanHatalari['amountMinor'] !== undefined}
          aria-describedby="payout-tutari-yardim"
        />

        {/*
          ⚠️ GİRDİNİN YORUMLANMIŞ HÂLİ GERİ GÖSTERİLİYOR. Türkçe girdide "1.000"
             hem bin hem 1,000 olabilir; ayraç sezgiseldir, kesin değildir
             (`sayi.ts` başlığı). Satıcı ne talep ettiğini göndermeden ÖNCE
             görmeli.
        */}
        <p id="payout-tutari-yardim" className="text-sm text-metin-soluk">
          En az <Tutar minor={asgari} />, en fazla <Tutar minor={cekilebilir} />.
          {ham.trim() !== '' ? (
            tutar === null ? (
              <> Girdiğiniz tutar okunamadı veya çekilebilir bakiyeyi aşıyor.</>
            ) : (
              <>
                {' '}
                Talep edilecek: <Tutar minor={tutar} />
              </>
            )
          ) : null}
        </p>

        {alanHatalari['amountMinor'] ? (
          <p className="text-xs text-tehlike">{alanHatalari['amountMinor']}</p>
        ) : null}
      </div>

      <p className="max-w-prose text-sm text-metin-soluk">
        Ödeme, satıcı başvurunuzda kayıtlı banka hesabınıza yapılır. Talep açıldıktan sonra yönetim
        onayı beklenir; onaylanan talep hazırlanana kadar tutar bakiyenizde görünmeye devam eder.
      </p>

      <div>
        <Button type="submit" disabled={gonderiliyor || tutar === null || tutar < asgari}>
          {gonderiliyor ? 'Gönderiliyor…' : 'Ödeme talebi oluştur'}
        </Button>
      </div>
    </form>
  );
}
