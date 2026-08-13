'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { isApiFailure, type Locale } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Fiyat } from '@/components/fiyat/fiyat';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Input } from '@/components/ui/input';
import { TBody, THead, TD, TH, TR, Table } from '@/components/ui/table';
import { fieldErrorMap } from '@/components/hata/alan-hatalari';
import { tarih } from '@/lib/tarih';
// ⚠️ İkinci kopya yazılmadı — `lib/sayi.ts` metin → tam sayı çözümünün
//    tek yeri; `src/lib/` altına taşınmalı (rapor).
import { adetCoz, kurusCoz, yuzdeCoz } from '@/lib/sayi';
// ⚠️ Yüzde biçimi TEK yerden: yerel bir çevirici sıfır ondalığı kırpıyordu ve
//    aynı oran kuponlarda "%10", komisyon tablosunda "%10,00" görünüyordu.
import { yuzdeBps } from '@/lib/sayi-bicim';
import type { CouponDiscountTypeWire, SellerCouponWire } from '@vt/contracts';

/**
 * KUPONLAR — liste, oluştur, düzenle.
 *
 * ⚠️ PERCENTAGE'TA `discountValue` BASIS POINT'TİR ve PARA DEĞİLDİR
 *    (`"1000"` = %10). `<Fiyat>` ile basmak %10'u "10,00 ₺" diye gösterirdi.
 *    Yüzde dalında kendi biçimleyicisi var; para dalında `<Fiyat>` kullanılır.
 *    Aynı alanın iki anlamı olması backend kararı: yüzdeyi float taşımak
 *    %12,5'ta kuruş kaydırırdı.
 *
 * ⚠️ DÜZENLEME YALNIZ ÜÇ ALAN: `updateCouponSchema` `isActive`, `validTo` ve
 *    `usageLimit` kabul ediyor. Kod, tutar ve tip DEĞİŞTİRİLEMEZ — değişseydi
 *    kuponu kullanmış siparişlerin geçmişi ile kuponun kendisi ayrışırdı.
 *    Bu yüzden düzenleme formunda o alanlar hiç GÖSTERİLMİYOR: gösterilip
 *    yok sayılan bir alan, en kötü tür arayüz yalanıdır.
 */
export interface KuponYonetimiProps {
  kuponlar: SellerCouponWire[];
}

const TIP_ETIKETLERI: Record<CouponDiscountTypeWire, string> = {
  PERCENTAGE: 'Yüzde indirim',
  FIXED_AMOUNT: 'Tutar indirimi',
  FREE_SHIPPING: 'Ücretsiz kargo',
};

const AZAMI_KURUS = 100_000_000n;

/** `updateCouponSchema` / `createCouponSchema`: `int().min(1).max(1_000_000)`. */
const AZAMI_KULLANIM = 1_000_000;

/**
 * KULLANIM LİMİTİ METNİ → ADET.
 *
 * ⚠️ `Number.parseInt` BURADA İKİ AYRI SESSİZ HATA ÜRETİYORDU ve ikisi de
 *    sunucudan 400 almadan geçiyordu:
 *      • "1.000" → `parseInt` 1 döner (noktada durur). Şema `min(1)` olduğu
 *        için 1 GEÇERLİDİR: satıcı bin kullanımlık kupon açtığını sanır, kupon
 *        birinci kullanımda biter. `adetCoz` aynı metni 1000 okur
 *        (`ayraclariNormalize`: virgül yok + noktadan sonra tam 3 basamak =
 *        binlik ayracı).
 *      • "abc" → `parseInt` NaN, `JSON.stringify` NaN'ı **null**'a çevirir ve
 *        PATCH şemasında `null` = "sınırsız". İstek 200 döner, ekran yenilenir,
 *        satıcı limitin kalktığını hiçbir yerde görmez.
 *    Bu yüzden dönüş `null` olduğunda istek HİÇ atılmaz; sebep ekrana yazılır.
 */
function kullanimLimitiCoz(ham: string): { tamam: true; deger: number | null } | { tamam: false } {
  if (ham.trim() === '') return { tamam: true, deger: null };
  const adet = adetCoz(ham, AZAMI_KULLANIM);
  if (adet === null || adet < 1) return { tamam: false };
  return { tamam: true, deger: adet };
}

/**
 * ISO an → `<input type="date">` değeri (`YYYY-MM-DD`), TÜRKİYE SAATİYLE.
 *
 * ⚠️ `iso.slice(0, 10)` YAZILMAZ: o, UTC gününü verir. Kupon `2026-09-30
 *    23:59:59Z` ile bitiyorsa listede (`lib/tarih.ts`, sabit
 *    `Europe/Istanbul`) "01 Ekim 2026" yazar ama düzenleme kutusunda
 *    "2026-09-30" görünürdü. Satıcı bir şey değiştirmeden "Kaydet"e bastığında
 *    kuponun bitişi BİR GÜN ÖNE çekilirdi — sessizce.
 */
const GUN_ALANI = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function gunAlani(iso: string): string {
  return GUN_ALANI.format(new Date(iso));
}

export function KuponYonetimi({ kuponlar }: KuponYonetimiProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="mb-3 text-sm font-semibold">Kuponlarınız</h2>
        {kuponlar.length === 0 ? (
          /* ⚠️ Boş durum NE YAPILACAĞINI söyler. */
          <p className="max-w-prose rounded-md border border-kenar bg-yuzey p-4 text-sm text-metin-soluk">
            Henüz kupon oluşturmadınız. Kupon, yalnızca sizin ürünlerinizde geçerli bir indirim
            kodudur; aşağıdaki formla oluşturup müşterilerinizle paylaşabilirsiniz.
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Kod</TH>
                <TH>Tür</TH>
                <TH sayisal>İndirim</TH>
                <TH sayisal>Asgari sepet</TH>
                <TH sayisal>Kullanım</TH>
                <TH sayisal>Bitiş</TH>
                <TH>Durum</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {kuponlar.map((kupon) => (
                <KuponSatiri key={kupon.id} kupon={kupon} />
              ))}
            </TBody>
          </Table>
        )}
      </div>

      <KuponFormu />
    </div>
  );
}

function KuponSatiri({ kupon }: { kupon: SellerCouponWire }): React.ReactElement {
  const router = useRouter();
  const [acik, setAcik] = React.useState(false);
  const [aktif, setAktif] = React.useState(kupon.isActive);
  const [bitis, setBitis] = React.useState(gunAlani(kupon.validTo));
  const [limit, setLimit] = React.useState(kupon.usageLimit?.toString() ?? '');
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [hata, setHata] = React.useState<unknown>(null);
  const [yerelHata, setYerelHata] = React.useState<string | null>(null);

  const cozulmusLimit = kullanimLimitiCoz(limit);

  async function kaydet(): Promise<void> {
    if (!cozulmusLimit.tamam) {
      setYerelHata('Kullanım limitini 1000 gibi yazın; boş bırakırsanız sınırsız olur.');
      return;
    }
    setGonderiliyor(true);
    setHata(null);
    setYerelHata(null);
    try {
      await apiFetch<SellerCouponWire, `/seller/coupons/${string}`>(`/seller/coupons/${kupon.id}`, {
        method: 'PATCH',
        json: {
          isActive: aktif,
          /*
            ⚠️ Gün sonu TARAYICININ saat diliminde kuruluyor. Türkiye'deki bir
               satıcı için doğru; başka bir dilimden giren biri için bitiş anı
               birkaç saat kayar. Doğrusu sunucunun günü kapatması olurdu
               (uç `z.coerce.date()` ile ham anı alıyor) — arayüzde
               çözülemeyecek bir şey, backend kartı.
          */
          validTo: new Date(`${bitis}T23:59:59`).toISOString(),
          // ⚠️ Boş alan `null`: "sınırsız" demek. Alanı hiç göndermemek
          //    "değiştirme" demek olurdu; ikisi farklı niyet.
          usageLimit: cozulmusLimit.deger,
        },
      });
      setAcik(false);
      router.refresh();
    } catch (istekHatasi) {
      setHata(istekHatasi);
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <>
      <TR>
        <TD className="font-medium">{kupon.code}</TD>
        <TD>{TIP_ETIKETLERI[kupon.discountType]}</TD>
        <TD sayisal>
          {kupon.discountType === 'PERCENTAGE' ? (
            yuzdeBps(kupon.discountValue)
          ) : kupon.discountType === 'FIXED_AMOUNT' ? (
            <Fiyat value={kupon.discountValue} className="justify-end" />
          ) : (
            '—'
          )}
        </TD>
        <TD sayisal>
          <Fiyat value={kupon.minCartMinor} className="justify-end" />
        </TD>
        <TD sayisal>
          {kupon.usedCount}
          {kupon.usageLimit === null ? '' : ` / ${kupon.usageLimit}`}
        </TD>
        <TD sayisal>{tarih(kupon.validTo)}</TD>
        <TD>
          {/* Kuponun aktifliği bir DURUMDUR; renk taşımaya hakkı var. */}
          <Badge durum={kupon.isActive ? 'olumlu' : 'notr'}>
            {kupon.isActive ? 'Aktif' : 'Kapalı'}
          </Badge>
        </TD>
        <TD>
          <Button variant="sessiz" size="sm" onClick={() => setAcik((onceki) => !onceki)}>
            {acik ? 'Kapat' : 'Düzenle'}
          </Button>
        </TD>
      </TR>

      {acik ? (
        <TR>
          <TD colSpan={8} className="py-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-metin-soluk">Bitiş tarihi</span>
                <Input
                  type="date"
                  value={bitis}
                  onChange={(olay) => setBitis(olay.target.value)}
                  className="rakam w-40"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-metin-soluk">Kullanım limiti</span>
                <Input
                  inputMode="numeric"
                  placeholder="Sınırsız"
                  value={limit}
                  onChange={(olay) => setLimit(olay.target.value)}
                  className="rakam w-full sm:w-32"
                />
                {/*
                  ⚠️ YORUMLANMIŞ DEĞER GERİ GÖSTERİLİYOR — payout formundaki
                     kalıbın aynısı ve aynı sebeple: "1.000" Türkçe girdide hem
                     bin hem 1,000 olabilir. Satıcı ne kaydettiğini KAYDETMEDEN
                     ÖNCE görmezse, yanlış limit ancak kupon erken bittiğinde
                     fark edilir.
                */}
                <span className="text-xs text-metin-soluk">
                  {limit.trim() === ''
                    ? 'Boş = sınırsız'
                    : cozulmusLimit.tamam
                      ? `Kaydedilecek: ${cozulmusLimit.deger!.toLocaleString('tr-TR')} kullanım`
                      : 'Okunamadı'}
                </span>
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={aktif}
                  onChange={(olay) => setAktif(olay.target.checked)}
                />
                <span className="text-metin">Aktif</span>
              </label>
              <Button
                size="sm"
                disabled={gonderiliyor || !cozulmusLimit.tamam}
                onClick={() => void kaydet()}
              >
                {gonderiliyor ? 'Kaydediliyor…' : 'Kaydet'}
              </Button>
            </div>
            <p className="mt-2 text-xs text-metin-soluk">
              Kod, indirim türü ve tutarı değiştirilemez; farklı bir indirim için yeni kupon
              oluşturun.
            </p>
            {yerelHata ? <p className="mt-2 text-sm text-tehlike">{yerelHata}</p> : null}
            {hata !== null ? <HataGosterimi error={hata} className="mt-3 max-w-md" /> : null}
          </TD>
        </TR>
      ) : null}
    </>
  );
}

function KuponFormu(): React.ReactElement {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const [kod, setKod] = React.useState('');
  const [tip, setTip] = React.useState<CouponDiscountTypeWire>('PERCENTAGE');
  const [deger, setDeger] = React.useState('');
  const [asgariSepet, setAsgariSepet] = React.useState('');
  const [baslangic, setBaslangic] = React.useState('');
  const [bitis, setBitis] = React.useState('');
  const [limit, setLimit] = React.useState('');
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [hata, setHata] = React.useState<unknown>(null);
  const [alanHatalari, setAlanHatalari] = React.useState<Record<string, string>>({});
  const [yerelHata, setYerelHata] = React.useState<string | null>(null);

  async function gonder(olay: React.FormEvent): Promise<void> {
    olay.preventDefault();
    setHata(null);
    setAlanHatalari({});
    setYerelHata(null);

    /**
     * ⚠️ TEK ALAN, İKİ ANLAM. `discountValue`:
     *      PERCENTAGE   → basis point (`yuzdeCoz`, tavan 10000 = %100)
     *      FIXED_AMOUNT → kuruş (`kurusCoz`)
     *      FREE_SHIPPING→ şema "0 olmalı" diyor
     *    Tek bir `Number(deger)` yazmak üç dalı da bozardı.
     */
    let indirim: string;
    if (tip === 'FREE_SHIPPING') {
      indirim = '0';
    } else if (tip === 'PERCENTAGE') {
      const bps = yuzdeCoz(deger, 10_000);
      if (bps === null || bps <= 0) {
        setYerelHata('İndirim oranını %10 için 10 şeklinde yazın (en fazla 100).');
        return;
      }
      indirim = bps.toString();
    } else {
      const kurus = kurusCoz(deger, AZAMI_KURUS);
      if (kurus === null || kurus <= 0n) {
        setYerelHata('İndirim tutarını 150,00 gibi yazın.');
        return;
      }
      indirim = kurus.toString();
    }

    const asgari = asgariSepet.trim() === '' ? 0n : kurusCoz(asgariSepet, AZAMI_KURUS);
    if (asgari === null) {
      setYerelHata('Asgari sepet tutarını 500,00 gibi yazın.');
      return;
    }

    // ⚠️ Diğer üç alan gibi limit de `lib/sayi.ts`ten geçiyor: `parseInt`
    //    "1.000"i 1, "abc"yi NaN okuyordu ve ikisi de sunucuda geçerli bir
    //    istek üretiyordu (gerekçe `kullanimLimitiCoz` başlığında).
    const kullanim = kullanimLimitiCoz(limit);
    if (!kullanim.tamam) {
      setYerelHata('Kullanım limitini 1000 gibi yazın; boş bırakırsanız sınırsız olur.');
      return;
    }

    setGonderiliyor(true);
    try {
      await apiFetch<SellerCouponWire, '/seller/coupons'>('/seller/coupons', {
        method: 'POST',
        json: {
          code: kod.trim().toUpperCase(),
          discountType: tip,
          discountValue: indirim,
          minCartMinor: asgari.toString(),
          // ⚠️ Oluşturma şemasında `usageLimit` `nullable` DEĞİL (yalnız
          //    `optional`): "sınırsız" burada alanı HİÇ göndermemektir.
          ...(kullanim.deger === null ? {} : { usageLimit: kullanim.deger }),
          validFrom: new Date(`${baslangic}T00:00:00`).toISOString(),
          validTo: new Date(`${bitis}T23:59:59`).toISOString(),
        },
      });
      setKod('');
      setDeger('');
      setAsgariSepet('');
      setLimit('');
      router.refresh();
    } catch (istekHatasi) {
      if (isApiFailure(istekHatasi) && istekHatasi.fields.length > 0) {
        setAlanHatalari(fieldErrorMap(istekHatasi.fields, locale));
      }
      setHata(istekHatasi);
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <form onSubmit={(olay) => void gonder(olay)} className="flex max-w-2xl flex-col gap-3">
      <h2 className="text-sm font-semibold">Yeni kupon</h2>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-metin">Kod</span>
          <Input
            value={kod}
            onChange={(olay) => setKod(olay.target.value)}
            placeholder="YAZ25"
            required
            className="w-40 uppercase"
          />
          <span className="text-xs text-metin-soluk">En az 4 karakter, harf ve rakam.</span>
          {alanHatalari['code'] ? (
            <span className="text-sm text-tehlike">{alanHatalari['code']}</span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-metin">Tür</span>
          <select
            value={tip}
            onChange={(olay) => setTip(olay.target.value as CouponDiscountTypeWire)}
            className="h-10 rounded-md border border-kenar bg-zemin px-2 text-sm text-metin"
          >
            {(Object.keys(TIP_ETIKETLERI) as CouponDiscountTypeWire[]).map((deger) => (
              <option key={deger} value={deger}>
                {TIP_ETIKETLERI[deger]}
              </option>
            ))}
          </select>
        </label>

        {tip !== 'FREE_SHIPPING' ? (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-metin">
              {tip === 'PERCENTAGE' ? 'Oran (%)' : 'Tutar (₺)'}
            </span>
            <Input
              value={deger}
              inputMode="decimal"
              placeholder={tip === 'PERCENTAGE' ? '10' : '150,00'}
              onChange={(olay) => setDeger(olay.target.value)}
              className="rakam w-32"
            />
            {alanHatalari['discountValue'] ? (
              <span className="text-sm text-tehlike">{alanHatalari['discountValue']}</span>
            ) : null}
          </label>
        ) : null}

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-metin">Asgari sepet (₺)</span>
          <Input
            value={asgariSepet}
            inputMode="decimal"
            placeholder="0,00"
            onChange={(olay) => setAsgariSepet(olay.target.value)}
            className="rakam w-32"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-metin">Başlangıç</span>
          <Input
            type="date"
            value={baslangic}
            onChange={(olay) => setBaslangic(olay.target.value)}
            required
            className="rakam w-44"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-metin">Bitiş</span>
          <Input
            type="date"
            value={bitis}
            onChange={(olay) => setBitis(olay.target.value)}
            required
            className="rakam w-44"
          />
          {alanHatalari['validTo'] ? (
            <span className="text-sm text-tehlike">{alanHatalari['validTo']}</span>
          ) : null}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-metin">Kullanım limiti</span>
          <Input
            value={limit}
            inputMode="numeric"
            placeholder="Sınırsız"
            onChange={(olay) => setLimit(olay.target.value)}
            className="rakam w-32"
          />
        </label>
      </div>

      {yerelHata ? <p className="text-sm text-tehlike">{yerelHata}</p> : null}
      {hata !== null ? <HataGosterimi error={hata} /> : null}

      <div>
        <Button type="submit" disabled={gonderiliyor}>
          {gonderiliyor ? 'Oluşturuluyor…' : 'Kupon oluştur'}
        </Button>
      </div>
    </form>
  );
}
