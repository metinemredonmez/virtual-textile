'use client';

import * as React from 'react';
import { Money } from '@vt/contracts';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { adetCoz, kurusCoz, yuzdeCoz } from './sayi';
import { tabanHesapla, tahminHesapla, type HesapGirdisi } from './hesap';
import {
  VARSAYIM_DUSUK,
  VARSAYIM_TANIMLARI,
  VARSAYIM_YUKSEK,
  type Varsayim,
  type VarsayimAnahtari,
} from './varsayimlar';

/**
 * TRY-ON HESAPLAYICI — form ve gösterim.
 *
 * ⚠️ RSC SINIRINDAN HİÇBİR PARA GEÇMEZ. Tutarlar bu bileşenin İÇİNDE `bigint`
 *    olarak doğar, burada biçimlenir ve burada ölür. `bigint` bir Sunucu
 *    Bileşeninden prop olarak verilseydi RSC serileştirmesi patlardı
 *    (`components/fiyat/fiyat.tsx` başındaki not). Aşağıdaki `Tutar` bileşenine
 *    `bigint` verilebilmesinin tek sebebi ikisinin de aynı istemci paketinde
 *    olmasıdır.
 *
 * ⚠️ `<Fiyat>` KULLANILMAZ. O bileşen `MinorString` ister; marka "bu para API
 *    yanıtından doğdu" güvencesidir ve buradaki tutar kullanıcının yazdığı bir
 *    varsayımdır. `unsafeMinorString` ile marka basmak, markayı bütün depo için
 *    değersizleştirirdi. Tabular-nums kuralı yine geçerli: `Tutar` ve `Adet`
 *    `rakam` sınıfını kendileri taşır.
 *
 * ⚠️ Global durum kütüphanesi yok ve gerekmiyor: bu form sunucuya hiçbir şey
 *    yazmaz, tamamı yerel durumdur.
 */

const ADET_BICIMI = new Intl.NumberFormat('tr-TR');

/** Girdi sınırları — saçma büyüklükte sayılarla anlamsız sonuç üretmemek için. */
const EN_FAZLA_ZIYARETCI = 100_000_000;
const EN_FAZLA_SEPET_KURUS = 100_000_000_00n; // 100.000.000,00 ₺

interface FormDurumu {
  aylikZiyaretci: string;
  donusum: string;
  sepetOrtalamasi: string;
  iadeOrani: string;
}

const BASLANGIC: FormDurumu = {
  aylikZiyaretci: '50.000',
  donusum: '1,8',
  sepetOrtalamasi: '850',
  iadeOrani: '22',
};

function bpsMetin(bps: number): string {
  return (bps / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}

type VarsayimFormu = Record<VarsayimAnahtari, { dusuk: string; yuksek: string }>;

function varsayimFormuBaslat(): VarsayimFormu {
  const bos = {} as VarsayimFormu;
  for (const tanim of VARSAYIM_TANIMLARI) {
    bos[tanim.anahtar] = { dusuk: bpsMetin(tanim.dusukBps), yuksek: bpsMetin(tanim.yuksekBps) };
  }
  return bos;
}

export function Hesaplayici(): React.ReactElement {
  const kimlik = React.useId();
  const [form, setForm] = React.useState<FormDurumu>(BASLANGIC);
  const [varsayimForm, setVarsayimForm] = React.useState<VarsayimFormu>(varsayimFormuBaslat);

  const aylikZiyaretci = adetCoz(form.aylikZiyaretci, EN_FAZLA_ZIYARETCI);
  const donusumBps = yuzdeCoz(form.donusum, 10_000);
  const sepetOrtalamasiMinor = kurusCoz(form.sepetOrtalamasi, EN_FAZLA_SEPET_KURUS);
  const iadeOraniBps = yuzdeCoz(form.iadeOrani, 10_000);

  const gecerli =
    aylikZiyaretci !== null &&
    donusumBps !== null &&
    sepetOrtalamasiMinor !== null &&
    iadeOraniBps !== null;

  const girdi: HesapGirdisi | null = gecerli
    ? { aylikZiyaretci, donusumBps, sepetOrtalamasiMinor, iadeOraniBps }
    : null;

  const varsayimlar = varsayimlariCoz(varsayimForm);

  return (
    <div className="flex flex-col gap-10">
      <form
        className="grid gap-6 sm:grid-cols-2"
        // Sunucuya gidecek bir şey yok; Enter sayfayı yeniden yüklemesin.
        onSubmit={(olay) => olay.preventDefault()}
      >
        <Alan
          id={`${kimlik}-ziyaretci`}
          etiket="Aylık ziyaretçi"
          yardim="Ürün sayfalarını gören tekil ziyaretçi sayısı."
          deger={form.aylikZiyaretci}
          gecerli={aylikZiyaretci !== null}
          hata="Tam sayı yazın (en fazla 100.000.000)."
          onChange={(v) => setForm((o) => ({ ...o, aylikZiyaretci: v }))}
        />
        <Alan
          id={`${kimlik}-donusum`}
          etiket="Dönüşüm oranı"
          birim="%"
          yardim="Ziyaretçilerin yüzde kaçı sipariş veriyor."
          deger={form.donusum}
          gecerli={donusumBps !== null}
          hata="%0 ile %100 arasında, en fazla iki ondalık."
          onChange={(v) => setForm((o) => ({ ...o, donusum: v }))}
        />
        <Alan
          id={`${kimlik}-sepet`}
          etiket="Sepet ortalaması"
          birim="₺"
          yardim="Sipariş başına ortalama tutar."
          deger={form.sepetOrtalamasi}
          gecerli={sepetOrtalamasiMinor !== null}
          hata="Tutarı yazın, örn. 1.290,50."
          onChange={(v) => setForm((o) => ({ ...o, sepetOrtalamasi: v }))}
        />
        <Alan
          id={`${kimlik}-iade`}
          etiket="İade oranı"
          birim="%"
          yardim="Siparişlerin yüzde kaçı iade ediliyor."
          deger={form.iadeOrani}
          gecerli={iadeOraniBps !== null}
          hata="%0 ile %100 arasında, en fazla iki ondalık."
          onChange={(v) => setForm((o) => ({ ...o, iadeOrani: v }))}
        />
      </form>

      {girdi === null ? (
        <p className="text-sm text-metin-soluk">Sonucu görmek için dört alanı da doldurun.</p>
      ) : (
        <Sonuclar girdi={girdi} varsayimlar={varsayimlar} />
      )}

      <VarsayimDuzenleyici
        kimlik={kimlik}
        form={varsayimForm}
        onChange={setVarsayimForm}
        cozulmus={varsayimlar}
      />
    </div>
  );
}

/**
 * Varsayım formundaki metinleri iki varsayım kümesine çevirir.
 * Geçersiz bir alan varsa O ALAN için yayımlanan varsayılana düşülür — form
 * kısmen bozukken sayfanın tamamen sessizleşmesi, kullanıcının ne olduğunu
 * anlamasını zorlaştırırdı.
 */
function varsayimlariCoz(form: VarsayimFormu): { dusuk: Varsayim; yuksek: Varsayim } {
  const dusuk = { ...VARSAYIM_DUSUK };
  const yuksek = { ...VARSAYIM_YUKSEK };

  for (const tanim of VARSAYIM_TANIMLARI) {
    const d = yuzdeCoz(form[tanim.anahtar].dusuk, tanim.enFazlaBps);
    const y = yuzdeCoz(form[tanim.anahtar].yuksek, tanim.enFazlaBps);
    if (d !== null) dusuk[tanim.anahtar] = d;
    if (y !== null) yuksek[tanim.anahtar] = y;
  }

  return { dusuk, yuksek };
}

function Sonuclar({
  girdi,
  varsayimlar,
}: {
  girdi: HesapGirdisi;
  varsayimlar: { dusuk: Varsayim; yuksek: Varsayim };
}): React.ReactElement {
  const taban = tabanHesapla(girdi);
  const dusuk = tahminHesapla(girdi, varsayimlar.dusuk);
  const yuksek = tahminHesapla(girdi, varsayimlar.yuksek);

  return (
    <div className="flex flex-col gap-8">
      {/*
        ⚠️ ÖNCE SATICININ KENDİ SAYILARI. Bu blokta hiçbir varsayım yok; girilen
           dört sayının aritmetiği. Varsayımla üretilen kısımdan görsel olarak
           ayrılması şart: ikisi tek tabloda karışırsa tahmin de ölçüm gibi
           okunur.
      */}
      <section>
        <h3 className="text-sm font-semibold">Bugünkü tablonuz</h3>
        <p className="mt-1 text-xs text-metin-soluk">
          Yalnızca sizin girdiğiniz dört sayıdan hesaplandı; varsayım içermez.
        </p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <Kutu etiket="Aylık sipariş" deger={<Adet value={taban.siparis} />} />
          <Kutu etiket="Aylık ciro" deger={<Tutar minor={taban.ciroMinor} />} />
          <Kutu etiket="İadeye giden ciro" deger={<Tutar minor={taban.iadeMinor} />} />
        </dl>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Sanal deneme ile tahmini etki</h3>
        <p className="mt-1 text-xs text-metin-soluk">
          Aşağıdaki iki sütun, varsayım aralığının iki ucudur. Aradaki fark hesaplamanın hatası
          değil, belirsizliğin kendisidir.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-kenar text-left">
                <th className="py-2 font-medium text-metin-soluk">Aylık</th>
                <th className="py-2 text-right font-medium text-metin-soluk">Temkinli</th>
                <th className="py-2 text-right font-medium text-metin-soluk">İyimser</th>
              </tr>
            </thead>
            <tbody>
              <Satir
                etiket="Deneme yapan ziyaretçi"
                dusuk={<Adet value={dusuk.denemeYapanZiyaretci} />}
                yuksek={<Adet value={yuksek.denemeYapanZiyaretci} />}
              />
              <Satir
                etiket="Ek sipariş"
                dusuk={<Adet value={dusuk.ekSiparis} />}
                yuksek={<Adet value={yuksek.ekSiparis} />}
              />
              <Satir
                etiket="Ek ciro"
                dusuk={<Tutar minor={dusuk.ekCiroMinor} />}
                yuksek={<Tutar minor={yuksek.ekCiroMinor} />}
              />
              <Satir
                etiket="İadeye gitmeyen ciro"
                dusuk={<Tutar minor={dusuk.onlenenIadeMinor} />}
                yuksek={<Tutar minor={yuksek.onlenenIadeMinor} />}
              />
              <Satir
                etiket="Toplam etki"
                vurgulu
                dusuk={<Tutar minor={dusuk.toplamEtkiMinor} />}
                yuksek={<Tutar minor={yuksek.toplamEtkiMinor} />}
              />
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-metin-soluk">
          &laquo;Toplam etki&raquo; = ek ciro + iadeye gitmeyen ciro. İkisi aynı cinsten değildir:
          ilki yeni satış, ikincisi zaten yapılmış ama geri dönmeyen satıştır. Nakit akışınıza
          etkileri de aynı anda gerçekleşmez.
        </p>
      </section>

      <p className="rounded-md border border-kenar bg-yuzey p-4 text-xs text-metin-soluk">
        Bu bir <strong className="font-semibold text-metin">tahmindir, garanti değildir</strong>.
        Sonuç tamamen aşağıdaki varsayımlara bağlıdır ve varsayımlar bizim ölçümümüz değildir. Adet
        hesapları her adımda aşağı yuvarlanır; yani sayılar iyimser tarafa değil, temkinli tarafa
        kayar.
      </p>
    </div>
  );
}

function VarsayimDuzenleyici({
  kimlik,
  form,
  onChange,
  cozulmus,
}: {
  kimlik: string;
  form: VarsayimFormu;
  onChange: React.Dispatch<React.SetStateAction<VarsayimFormu>>;
  cozulmus: { dusuk: Varsayim; yuksek: Varsayim };
}): React.ReactElement {
  return (
    <details className="rounded-md border border-kenar">
      <summary className="cursor-pointer p-4 text-sm font-semibold">
        Varsayımlar — kendi ölçtüğünüz sayıları yazın
      </summary>

      <div className="flex flex-col gap-6 border-t border-kenar p-4">
        {VARSAYIM_TANIMLARI.map((tanim) => (
          <div key={tanim.anahtar} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div>
              <p className="text-sm font-medium">{tanim.etiket}</p>
              <p className="mt-1 text-xs text-metin-soluk">{tanim.aciklama}</p>
            </div>

            <VarsayimGirdisi
              id={`${kimlik}-${tanim.anahtar}-dusuk`}
              etiket="Temkinli"
              deger={form[tanim.anahtar].dusuk}
              gecerli={yuzdeCoz(form[tanim.anahtar].dusuk, tanim.enFazlaBps) !== null}
              onChange={(v) =>
                onChange((o) => ({ ...o, [tanim.anahtar]: { ...o[tanim.anahtar], dusuk: v } }))
              }
            />
            <VarsayimGirdisi
              id={`${kimlik}-${tanim.anahtar}-yuksek`}
              etiket="İyimser"
              deger={form[tanim.anahtar].yuksek}
              gecerli={yuzdeCoz(form[tanim.anahtar].yuksek, tanim.enFazlaBps) !== null}
              onChange={(v) =>
                onChange((o) => ({ ...o, [tanim.anahtar]: { ...o[tanim.anahtar], yuksek: v } }))
              }
            />
          </div>
        ))}

        {/*
          Geçersiz bir alan yayımlanan varsayılana düşer; hangi değerin
          KULLANILDIĞI burada yazılı olmazsa kullanıcı yazdığı sayının işlendiğini
          sanır. Sessiz geri düşüş, yanlış sayıdan daha kötüdür.
        */}
        <p className="rakam text-xs text-metin-soluk">
          Hesapta kullanılan değerler — temkinli: %{bpsMetin(cozulmus.dusuk.denemeKullanimBps)} · %
          {bpsMetin(cozulmus.dusuk.donusumArtisiBps)} · %{bpsMetin(cozulmus.dusuk.iadeDususuBps)} |
          iyimser: %{bpsMetin(cozulmus.yuksek.denemeKullanimBps)} · %
          {bpsMetin(cozulmus.yuksek.donusumArtisiBps)} · %{bpsMetin(cozulmus.yuksek.iadeDususuBps)}
        </p>
      </div>
    </details>
  );
}

function Alan({
  id,
  etiket,
  birim,
  yardim,
  deger,
  gecerli,
  hata,
  onChange,
}: {
  id: string;
  etiket: string;
  birim?: string;
  yardim: string;
  deger: string;
  gecerli: boolean;
  hata: string;
  onChange: (deger: string) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {etiket}
        {birim ? <span className="text-metin-soluk"> ({birim})</span> : null}
      </Label>
      <Input
        id={id}
        // ⚠️ `type="number"` DEĞİL: Türkçe binlik/ondalık ayracı (1.290,50)
        //    tarayıcının sayı girdisinde geçersiz sayılır ve alan sessizce
        //    boşalır. Doğrulama `sayi.ts`te, orada ayracın anlamı biliniyor.
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={deger}
        aria-invalid={!gecerli}
        aria-describedby={`${id}-yardim`}
        onChange={(olay) => onChange(olay.target.value)}
        className="rakam"
      />
      <p
        id={`${id}-yardim`}
        className={cn('text-xs', gecerli ? 'text-metin-soluk' : 'text-tehlike')}
      >
        {gecerli ? yardim : hata}
      </p>
    </div>
  );
}

function VarsayimGirdisi({
  id,
  etiket,
  deger,
  gecerli,
  onChange,
}: {
  id: string;
  etiket: string;
  deger: string;
  gecerli: boolean;
  onChange: (deger: string) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-metin-soluk">
        {etiket} (%)
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={deger}
        aria-invalid={!gecerli}
        onChange={(olay) => onChange(olay.target.value)}
        className="rakam w-24"
      />
    </div>
  );
}

function Kutu({ etiket, deger }: { etiket: string; deger: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-md border border-kenar p-4">
      <dt className="text-xs text-metin-soluk">{etiket}</dt>
      <dd className="mt-1 text-base font-semibold">{deger}</dd>
    </div>
  );
}

function Satir({
  etiket,
  dusuk,
  yuksek,
  vurgulu = false,
}: {
  etiket: string;
  dusuk: React.ReactNode;
  yuksek: React.ReactNode;
  vurgulu?: boolean;
}): React.ReactElement {
  return (
    <tr className={cn('border-b border-kenar', vurgulu && 'font-semibold')}>
      <td className="py-2 text-metin-soluk">{etiket}</td>
      {/* Sayılar SAĞA yaslı — virgüller hizalansın (design-system.md → Stripe). */}
      <td className="py-2 text-right">{dusuk}</td>
      <td className="py-2 text-right">{yuksek}</td>
    </tr>
  );
}

/**
 * ⚠️ `rakam` sınıfı (tabular-nums) BİLEŞENİN İÇİNDE. Para/sayı gösterilen her
 *    yerde elle yazılsaydı bir yerde unutulur ve tablo virgülleri kayardı;
 *    `<Fiyat>` de aynı sebeple sınıfı kendi taşıyor.
 */
function Tutar({ minor }: { minor: bigint }): React.ReactElement {
  return <span className="rakam">{Money.formatMoney(Money.money(minor))}</span>;
}

function Adet({ value }: { value: bigint }): React.ReactElement {
  return <span className="rakam">{ADET_BICIMI.format(value)}</span>;
}
