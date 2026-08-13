'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Fiyat } from '@/components/fiyat/fiyat';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// ⚠️ İKİNCİ KOPYA YAZILMADI. Kullanıcının yazdığı tutarı kuruşa çevirmenin tek
//    yolu bu dosya (`lib/sayi.ts`); Türkçe girdide `.`nın iki anlamı
//    olduğu ve `Number()`ın parayı sessizce bozduğu orada ölçülmüş. Dosya iki
//    ekran tarafından kullanıldığı için `src/lib/` altına TAŞINMALI (rapor).
import { adetCoz, kurusCoz } from '@/lib/sayi';
import type { SellerVariantWire } from '@vt/contracts';

/**
 * VARYANT MATRİSİ — renk × beden, her hücrede stok + fiyat (Polaris kararı).
 *
 * ⚠️ MATRİSİN KAYNAĞI `GET /seller/products/:id`. Ayrı bir "matris" ucu YOK;
 *    hücreler `variants` dizisinden kurulur.
 *
 * ⚠️ SATIR/SÜTUN SIRASI SUNUCUDAN: dizi `color asc, sortOrder asc` geliyor,
 *    yani "Bej" "Siyah"tan önce. Kendi sıramızı icat etmek, satıcının ürün
 *    formunda verdiği `sortOrder`ı görünmez kılardı. Bedenler de ilk
 *    görüldükleri sırada sütun olur — 'M' < 'L' gibi alfabetik bir sıra beden
 *    için ANLAMSIZDIR ('L' 'M'den önce gelirdi).
 *
 * ⚠️ SANALLAŞTIRMA GEREKMİYOR — ölçüldü, tahmin değil: `createProductSchema`
 *    varyant tavanı 200 (`seller.schema.ts`), yani matris en fazla 200 hücre.
 *    Toplu güncelleme tavanı da 500 satır. 200 hücrelik bir tabloyu
 *    sanallaştırmak, kazandırdığından çok karmaşıklık ekler (ve seçim durumu
 *    ile klavye gezinmesini kırar). Tavan bir gün kalkarsa ölçüt de değişir.
 *
 * ⚠️ `onHand` ve `reserved` AYRI gösteriliyor. "12 stok var ama 5'i sepetlerde"
 *    bilgisi olmadan satıcı tükenişi anlayamaz; sunucu `reserved`ı bilerek
 *    veriyor.
 */
export interface VaryantMatrisiProps {
  variants: SellerVariantWire[];
}

interface Guncelleme {
  variantId: string;
  priceMinor?: string;
  stock?: number;
  isActive?: boolean;
}

/** Fiyat alanı için tavan: 18 basamaklı `minorAmountSchema` sınırının altında. */
const AZAMI_KURUS = 100_000_000n;
const AZAMI_STOK = 1_000_000;

export function VaryantMatrisi({ variants }: VaryantMatrisiProps): React.ReactElement {
  const router = useRouter();
  const [secili, setSecili] = React.useState<ReadonlySet<string>>(new Set());
  const [fiyat, setFiyat] = React.useState('');
  const [stok, setStok] = React.useState('');
  const [aktiflik, setAktiflik] = React.useState<'' | 'aktif' | 'pasif'>('');
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [hata, setHata] = React.useState<unknown>(null);
  const [sonuc, setSonuc] = React.useState<string | null>(null);
  const [alanHatasi, setAlanHatasi] = React.useState<string | null>(null);

  const renkler = React.useMemo(() => benzersiz(variants.map((v) => v.color)), [variants]);
  const bedenler = React.useMemo(() => benzersiz(variants.map((v) => v.size)), [variants]);
  const hucre = React.useMemo(() => {
    const harita = new Map<string, SellerVariantWire>();
    for (const varyant of variants) harita.set(`${varyant.color}|${varyant.size}`, varyant);
    return harita;
  }, [variants]);

  function degistir(id: string, acik: boolean): void {
    const sonraki = new Set(secili);
    if (acik) sonraki.add(id);
    else sonraki.delete(id);
    setSecili(sonraki);
  }

  function satirDegistir(renk: string, acik: boolean): void {
    const sonraki = new Set(secili);
    for (const varyant of variants) {
      if (varyant.color !== renk) continue;
      if (acik) sonraki.add(varyant.id);
      else sonraki.delete(varyant.id);
    }
    setSecili(sonraki);
  }

  async function uygula(): Promise<void> {
    setHata(null);
    setSonuc(null);
    setAlanHatasi(null);

    const yama: Omit<Guncelleme, 'variantId'> = {};

    if (fiyat.trim() !== '') {
      /**
       * ⚠️ `Number(fiyat)` YAZILMAZ. Kullanıcının yazdığı tutar metinden
       *    doğrudan `bigint`e çözülür (`kurusCoz`); kayan noktaya uğrayan para
       *    hata VERMEDEN yanlış tutar üretir.
       *
       * ⚠️ Çıkan değer `MinorString` DEĞİLDİR ve öyle işaretlenmez: marka
       *    "bu para API yanıtından doğdu" güvencesidir. Telde string olarak
       *    gidiyor, ama ekranda `<Fiyat>` ile basılmıyor.
       */
      const kurus = kurusCoz(fiyat, AZAMI_KURUS);
      if (kurus === null) {
        setAlanHatasi('Fiyatı 1.290,50 gibi yazın.');
        return;
      }
      yama.priceMinor = kurus.toString();
    }

    if (stok.trim() !== '') {
      const adet = adetCoz(stok, AZAMI_STOK);
      if (adet === null) {
        setAlanHatasi('Stok, sıfır veya daha büyük bir tam sayı olmalı.');
        return;
      }
      yama.stock = adet;
    }

    if (aktiflik !== '') yama.isActive = aktiflik === 'aktif';

    if (Object.keys(yama).length === 0) {
      setAlanHatasi('Fiyat, stok veya satış durumundan en az birini doldurun.');
      return;
    }

    setGonderiliyor(true);
    try {
      /**
       * ⚠️ TEK İSTEK, TEK TRANSACTION. Sunucu hep-ya-hiç uyguluyor; satır
       *    satır göndermek, 40 satırı geçip 41'incide patlayan ve satıcının
       *    hangisinin geçtiğini bilemediği bir durum üretirdi.
       *
       * ⚠️ Bu uç `IdempotentPath` listesinde DEĞİL, anahtar gerekmiyor: `stock`
       *    MUTLAK değer olduğu için istek doğası gereği tekrarlanabilir.
       */
      const yanit = await apiFetch<{ updated: number }, '/seller/variants/bulk'>(
        '/seller/variants/bulk',
        {
          method: 'PATCH',
          json: { updates: [...secili].map((variantId) => ({ variantId, ...yama })) },
        },
      );
      setSonuc(`${yanit.data.updated} varyant güncellendi.`);
      setSecili(new Set());
      setFiyat('');
      setStok('');
      setAktiflik('');
      /**
       * ⚠️ Yanıt GÜNCELLENMİŞ SATIRLARI DÖNDÜRMÜYOR (`{"updated":2}`), o yüzden
       *    matris elde tazelenemez: sunucudan yeniden çekiliyor.
       */
      router.refresh();
    } catch (istekHatasi) {
      /**
       * ⚠️ Hata SATIRA BAĞLANAMIYOR ve bu bir eksik: `STOCK_BELOW_RESERVED`
       *    ile `VARIANT_NOT_FOUND` hangi varyantta patladığını SÖYLEMİYOR
       *    (kimlikler yalnız `internalMessage`ta, zarfa çıkmıyor). Uydurup bir
       *    satırın altına basmak yanlış satırı işaretlerdi; hata tablonun
       *    tamamı için gösteriliyor.
       */
      setHata(istekHatasi);
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <div>
      {/* TOPLU DÜZENLEME ÇUBUĞU — yalnız seçim varken. */}
      {secili.size > 0 ? (
        <div className="mb-3 rounded-md border border-kenar bg-yuzey p-3">
          <div className="flex flex-wrap items-end gap-3">
            <span className="rakam pb-2 text-sm text-metin-soluk">
              {secili.size} varyant seçildi
            </span>

            <div className="flex flex-col gap-1">
              <Label htmlFor="toplu-fiyat" className="text-xs">
                Fiyat (₺)
              </Label>
              <Input
                id="toplu-fiyat"
                inputMode="decimal"
                placeholder="1.290,00"
                value={fiyat}
                onChange={(olay) => setFiyat(olay.target.value)}
                className="rakam h-9 w-32"
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="toplu-stok" className="text-xs">
                Stok (yeni toplam)
              </Label>
              <Input
                id="toplu-stok"
                inputMode="numeric"
                placeholder="20"
                value={stok}
                onChange={(olay) => setStok(olay.target.value)}
                className="rakam h-9 w-28"
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="toplu-aktif" className="text-xs">
                Satışta
              </Label>
              <select
                id="toplu-aktif"
                value={aktiflik}
                onChange={(olay) => setAktiflik(olay.target.value as '' | 'aktif' | 'pasif')}
                className="h-9 rounded-md border border-kenar bg-zemin px-2 text-sm text-metin"
              >
                <option value="">Değiştirme</option>
                <option value="aktif">Satışta</option>
                <option value="pasif">Satışta değil</option>
              </select>
            </div>

            <Button size="sm" disabled={gonderiliyor} onClick={() => void uygula()}>
              {gonderiliyor ? 'Uygulanıyor…' : 'Seçilenlere uygula'}
            </Button>
          </div>

          {/* ⚠️ Bu cümle şart: stok MUTLAK değer, delta değil (`seller.schema.ts`). */}
          <p className="mt-2 text-xs text-metin-soluk">
            Stok alanı yeni toplamı yazar, mevcut stoğa eklemez. Boş bıraktığınız alanlar değişmez.
          </p>

          {alanHatasi ? <p className="mt-2 text-sm text-tehlike">{alanHatasi}</p> : null}
        </div>
      ) : null}

      {sonuc ? <p className="mb-3 text-sm text-metin-soluk">{sonuc}</p> : null}
      {hata !== null ? <HataGosterimi error={hata} className="mb-3" /> : null}

      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-kenar text-metin-soluk">
            <tr className="h-9">
              <th className="px-3 text-left font-medium">Renk</th>
              {bedenler.map((beden) => (
                <th key={beden} className="px-3 text-left font-medium">
                  {beden}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {renkler.map((renk) => {
              const satirVaryantlari = variants.filter((varyant) => varyant.color === renk);
              const satirSecili =
                satirVaryantlari.length > 0 &&
                satirVaryantlari.every((varyant) => secili.has(varyant.id));

              return (
                <tr key={renk} className="border-b border-kenar/60 align-top">
                  <th className="px-3 py-2 text-left font-normal">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={`${renk} satırını seç`}
                        checked={satirSecili}
                        onChange={(olay) => satirDegistir(renk, olay.target.checked)}
                      />
                      {/*
                        ⚠️ Renk örneği bir DURUM DEĞİL, ürün verisi: `<Badge>`
                           kullanılmıyor, nötr bir kare çiziliyor. Kenarlık
                           beyaz/açık renklerin görünmesi için.
                      */}
                      <span
                        aria-hidden="true"
                        className="size-3.5 rounded-sm border border-kenar"
                        style={{ backgroundColor: satirVaryantlari[0]?.colorHex }}
                      />
                      <span className="font-medium text-metin">{renk}</span>
                    </label>
                  </th>

                  {bedenler.map((beden) => {
                    const varyant = hucre.get(`${renk}|${beden}`);
                    if (!varyant) {
                      /* ⚠️ Boş hücre EKSİK DEĞİL, olmayan bir kombinasyondur. */
                      return (
                        <td key={beden} className="px-3 py-2 text-metin-soluk">
                          —
                        </td>
                      );
                    }

                    const satilabilir = varyant.onHand - varyant.reserved;

                    return (
                      <td key={beden} className="px-3 py-2">
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-1"
                            aria-label={`${renk} ${beden} seç`}
                            checked={secili.has(varyant.id)}
                            onChange={(olay) => degistir(varyant.id, olay.target.checked)}
                          />
                          <span className="flex flex-col gap-0.5">
                            <Fiyat value={varyant.priceMinor} listValue={varyant.listPriceMinor} />
                            <span className="rakam text-xs text-metin-soluk">
                              {satilabilir} satılabilir
                              {varyant.reserved > 0 ? ` · ${varyant.reserved} rezerve` : ''}
                            </span>
                            <span className="text-xs text-metin-soluk">{varyant.sku}</span>
                            {!varyant.isActive ? (
                              <span className="text-xs text-metin-soluk">Satışta değil</span>
                            ) : null}
                          </span>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** İlk görülme sırasını KORUYARAK tekilleştirir — sıra sunucunun kararı. */
function benzersiz(degerler: readonly string[]): string[] {
  return [...new Set(degerler)];
}
