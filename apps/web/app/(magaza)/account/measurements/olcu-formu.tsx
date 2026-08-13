'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { BodyProfileWire, BodyProfileWriteInput } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';

/**
 * ÖLÇÜ FORMU.
 *
 * ⚠️ İSTEMCİ BİLEŞENİ ve bunun sebebi PATCH'in kendisi: alan boşaltıldığında
 *    `null` gönderilmesi, doldurulduğunda sayı gönderilmesi gerekiyor. Bu ayrım
 *    ancak formun o anki durumu bilinerek yapılabilir.
 *
 * ⚠️ ÖLÇÜLER GÖVDEDE GİDER, SORGU DİZESİNDE DEĞİL. Vücut ölçüsü kişisel
 *    veridir; sorgu dizesine konsaydı erişim günlüklerine, ara vekillere ve
 *    tarayıcı geçmişine yazılırdı.
 */

/**
 * ⚠️ ANAHTAR TİPİ DAR, `string` DEĞİL — ve bu bir derleme kapısı.
 *
 *    `string` yazıldığında `t(alan.anahtar)` derlenmedi: next-intl anahtarları
 *    sözlükten türetilmiş bir union bekliyor. İlk çözüm olarak `as never`
 *    yazmak cazipti; o, sözlükte OLMAYAN bir anahtarı sessizce kabul ederdi.
 *    Dar union sayesinde bir alan adı yanlış yazılırsa DERLEME kırılıyor,
 *    ekranda ham anahtar görünmüyor.
 *
 *    Her anahtar için sözlükte İKİ giriş olmak zorunda: `<anahtar>` (etiket) ve
 *    `<anahtar>Ipucu` (nasıl ölçülür). İkincisi eksikse yine derleme kırılır.
 */
type OlcuAnahtari = 'boy' | 'kilo' | 'gogus' | 'bel' | 'kalca' | 'omuz' | 'icBoy';

interface Alan {
  readonly ad: keyof BodyProfileWriteInput;
  /** ⚠️ Metin DEĞİL, SÖZLÜK ANAHTARI. Metin `t()` ile çözülür. */
  readonly anahtar: OlcuAnahtari;
  readonly birim: string;
  readonly min: number;
  readonly max: number;
}

/**
 * ⚠️ ZORUNLU ALAN YOK — VE BU BİR KARAR.
 *
 *    Motor eksik ölçüyle çalışabiliyor: her ölçü eşleşen boyut sayısını
 *    artırıp güveni yükseltiyor, hiçbiri tek başına şart değil. Zorunlu
 *    kılmak, bilmediği bir ölçü yüzünden kullanıcıyı formdan kaçırırdı —
 *    oysa yalnız göğüs ölçüsüyle bile anlamlı bir öneri üretiliyor.
 *
 * ⚠️ SIRA RASTGELE DEĞİL: en çok bilinenden en az bilinene. Boy ve kilo
 *    herkesin bildiği iki değer; omuz ve iç bacak boyu mezurayla ölçmeyi
 *    gerektiriyor ve altta duruyor.
 */
const TEMEL: readonly Alan[] = [
  {
    ad: 'heightCm',
    anahtar: 'boy',
    birim: 'cm',
    min: 100,
    max: 230,
  },
  {
    ad: 'weightKg',
    anahtar: 'kilo',
    birim: 'kg',
    min: 30,
    max: 250,
  },
  {
    ad: 'chestCm',
    anahtar: 'gogus',
    birim: 'cm',
    min: 50,
    max: 200,
  },
  {
    ad: 'waistCm',
    anahtar: 'bel',
    birim: 'cm',
    min: 40,
    max: 200,
  },
  {
    ad: 'hipCm',
    anahtar: 'kalca',
    birim: 'cm',
    min: 50,
    max: 200,
  },
];

const AYRINTILI: readonly Alan[] = [
  {
    ad: 'shoulderCm',
    anahtar: 'omuz',
    birim: 'cm',
    min: 25,
    max: 70,
  },
  {
    ad: 'inseamCm',
    anahtar: 'icBoy',
    birim: 'cm',
    min: 40,
    max: 110,
  },
];

/** ⚠️ Motorun tanıdığı üç kalıp tercihi (`SIZE_ENGINE.fitAdjustment`). */
const KALIPLAR = [
  { deger: 'SLIM', anahtar: 'kalipSlim' },
  { deger: 'REGULAR', anahtar: 'kalipRegular' },
  { deger: 'OVERSIZE', anahtar: 'kalipOversize' },
] as const;

type Durum = 'bos' | 'gonderiliyor' | 'kaydedildi' | 'hata';

export function OlcuFormu({ baslangic }: { baslangic: BodyProfileWire | null }) {
  const t = useTranslations('olculerim');
  const [degerler, setDegerler] = React.useState<Record<string, string>>(() => {
    const ilk: Record<string, string> = {};
    for (const alan of [...TEMEL, ...AYRINTILI]) {
      const v = baslangic?.[alan.ad as keyof BodyProfileWire];
      ilk[alan.ad] = typeof v === 'number' ? String(v) : '';
    }
    ilk['usualSize'] = baslangic?.usualSize ?? '';
    ilk['fitPref'] = baslangic?.fitPref ?? '';
    return ilk;
  });

  const [durum, setDurum] = React.useState<Durum>('bos');
  const [hataMetni, setHataMetni] = React.useState<string | null>(null);
  const [ayrintiAcik, setAyrintiAcik] = React.useState(
    // Kullanıcı bu ölçüleri daha önce girdiyse bölüm AÇIK gelir.
    () => typeof baslangic?.shoulderCm === 'number' || typeof baslangic?.inseamCm === 'number',
  );

  async function gonder(olay: React.FormEvent): Promise<void> {
    olay.preventDefault();
    setDurum('gonderiliyor');
    setHataMetni(null);

    /**
     * ⚠️ BOŞ ALAN `null` GÖNDERİLİR, ATLANMAZ. Uç PATCH: atlanan alan
     *    "dokunma", `null` "sil" demek. Boş bir kutuyu atlarsak kullanıcı bir
     *    ölçüyü silemez — sildiğini sanır, eski değer sunucuda kalır ve öneri
     *    ona göre üretilmeye devam eder.
     */
    const govde: Record<string, number | string | null> = {};
    for (const alan of [...TEMEL, ...AYRINTILI]) {
      const ham = (degerler[alan.ad] ?? '').trim();
      govde[alan.ad] = ham === '' ? null : Number(ham);
    }
    govde['usualSize'] = (degerler['usualSize'] ?? '').trim() || null;
    govde['fitPref'] = (degerler['fitPref'] ?? '') || null;

    try {
      await apiFetch<BodyProfileWire, '/me/body-profile'>('/me/body-profile', {
        method: 'PATCH',
        json: govde,
      });
      setDurum('kaydedildi');
    } catch (hata) {
      setDurum('hata');
      setHataMetni(hata instanceof Error ? hata.message : t('kaydedilemedi'));
    }
  }

  function kutu(alan: Alan): React.ReactElement {
    return (
      <div key={alan.ad} className="flex flex-col gap-1.5">
        <label htmlFor={alan.ad} className="text-sm font-medium">
          {t(alan.anahtar)} <span className="text-metin-soluk">({alan.birim})</span>
        </label>
        <input
          id={alan.ad}
          name={alan.ad}
          type="number"
          inputMode="numeric"
          min={alan.min}
          max={alan.max}
          value={degerler[alan.ad] ?? ''}
          onChange={(e) => setDegerler((o) => ({ ...o, [alan.ad]: e.target.value }))}
          className="h-11 rounded-md border border-kenar bg-zemin px-3 text-sm"
        />
        {/* ⚠️ "Nasıl ölçülür" HER ALANDA VAR. Ölçüyü yanlış alan bir kullanıcı,
            ölçüyü hiç vermeyen kullanıcıdan KÖTÜ bir öneri alır — çünkü motor
            yanlış veriye güvenir ve güveni yükseltir. */}
        <p className="text-xs text-metin-soluk">{t(`${alan.anahtar}Ipucu` as const)}</p>
      </div>
    );
  }

  return (
    <form onSubmit={gonder} className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">{TEMEL.map(kutu)}</div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="usualSize" className="text-sm font-medium">
          {t('normalBeden')}
        </label>
        <input
          id="usualSize"
          name="usualSize"
          maxLength={10}
          placeholder="M, 38, 30…"
          value={degerler['usualSize'] ?? ''}
          onChange={(e) => setDegerler((o) => ({ ...o, usualSize: e.target.value }))}
          className="h-11 max-w-40 rounded-md border border-kenar bg-zemin px-3 text-sm"
        />
        <p className="text-xs text-metin-soluk">{t('normalBedenIpucu')}</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('kalipTercihi')}</legend>
        <div className="flex flex-wrap gap-2">
          {KALIPLAR.map((kalip) => (
            <label
              key={kalip.deger}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-kenar px-3 py-2 text-sm"
            >
              <input
                type="radio"
                name="fitPref"
                value={kalip.deger}
                checked={degerler['fitPref'] === kalip.deger}
                onChange={(e) => setDegerler((o) => ({ ...o, fitPref: e.target.value }))}
              />
              {t(kalip.anahtar)}
            </label>
          ))}
        </div>
      </fieldset>

      {/* ⚠️ AYRINTILI ÖLÇÜLER KAPALI BAŞLAR. Omuz ve iç bacak boyu mezura
          ister; formun başına konsaydı çoğu kullanıcı ilk iki alanda vazgeçerdi.
          Kapalı bölüm, isteyene açık bir kapı. */}
      <div className="rounded-lg border border-kenar">
        <button
          type="button"
          onClick={() => setAyrintiAcik((a) => !a)}
          aria-expanded={ayrintiAcik}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
        >
          {t('ayrintiAc')}
          <span className="text-metin-soluk">{ayrintiAcik ? '−' : '+'}</span>
        </button>
        {ayrintiAcik ? (
          <div className="grid gap-4 border-t border-kenar p-4 sm:grid-cols-2">
            {AYRINTILI.map(kutu)}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={durum === 'gonderiliyor'}>
          {durum === 'gonderiliyor' ? t('kaydediliyor') : t('kaydet')}
        </Button>
        {durum === 'kaydedildi' ? (
          <span className="text-sm text-metin-soluk">{t('kaydedildi')}</span>
        ) : null}
        {durum === 'hata' && hataMetni ? (
          <span role="alert" className="text-sm text-durum-olumsuz">
            {hataMetni}
          </span>
        ) : null}
      </div>
    </form>
  );
}
