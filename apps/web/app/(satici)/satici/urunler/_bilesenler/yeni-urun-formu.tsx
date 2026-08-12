'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { isApiFailure } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Input } from '@/components/ui/input';
import { fieldErrorMap } from '@/components/hata/alan-hatalari';
// ⚠️ İkinci kopya yazılmadı — bkz. `varyant-matrisi.tsx`teki aynı not.
import { adetCoz, kurusCoz } from '@/lib/sayi';
import { CINSIYET_ETIKETLERI } from '../_lib/durum';
import type { KategoriSecenegi } from '../../_lib/kategoriler';
import type { SellerGenderWire, SellerProductDetailWire } from '@vt/contracts';

/**
 * YENİ ÜRÜN FORMU.
 *
 * ⚠️ ÜRÜN DRAFT DOĞAR (ölçüldü) ve bu ekranda "yayınla" seçeneği YOKTUR:
 *    yayın kararı admin'in. Form bunu bitişte açıkça söylüyor, yoksa satıcı
 *    kaydettikten sonra ürünü vitrinde arar.
 *
 * ⚠️ EN AZ BİR VARYANT ZORUNLU (`createProductSchema`), çünkü fiyat ve stok
 *    varyantta duruyor — varyantsız ürünün fiyatı da yoktur. Form bu yüzden
 *    tek boş satırla açılıyor: "varyant ekle" düğmesini bulmak zorunda kalan
 *    satıcı, formu doldurup en sonda reddedilir.
 */
export interface YeniUrunFormuProps {
  kategoriler: KategoriSecenegi[];
}

interface VaryantSatiri {
  anahtar: string;
  sku: string;
  renk: string;
  renkKodu: string;
  beden: string;
  fiyat: string;
  stok: string;
}

const CINSIYETLER = Object.keys(CINSIYET_ETIKETLERI) as SellerGenderWire[];
const AZAMI_KURUS = 100_000_000n;
const AZAMI_STOK = 1_000_000;

function bosSatir(): VaryantSatiri {
  return {
    anahtar: crypto.randomUUID(),
    sku: '',
    renk: '',
    renkKodu: '#000000',
    beden: '',
    fiyat: '',
    stok: '0',
  };
}

export function YeniUrunFormu({ kategoriler }: YeniUrunFormuProps): React.ReactElement {
  const router = useRouter();
  const [baslik, setBaslik] = React.useState('');
  const [aciklama, setAciklama] = React.useState('');
  const [marka, setMarka] = React.useState('');
  const [cinsiyet, setCinsiyet] = React.useState<SellerGenderWire>('WOMAN');
  const [kategori, setKategori] = React.useState(kategoriler[0]?.id ?? '');
  const [sezon, setSezon] = React.useState('');
  const [satirlar, setSatirlar] = React.useState<VaryantSatiri[]>([bosSatir()]);

  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [hata, setHata] = React.useState<unknown>(null);
  const [alanHatalari, setAlanHatalari] = React.useState<Record<string, string>>({});
  const [yerelHata, setYerelHata] = React.useState<string | null>(null);

  function satirGuncelle(anahtar: string, yama: Partial<VaryantSatiri>): void {
    setSatirlar((oncekiler) =>
      oncekiler.map((satir) => (satir.anahtar === anahtar ? { ...satir, ...yama } : satir)),
    );
  }

  async function gonder(olay: React.FormEvent): Promise<void> {
    olay.preventDefault();
    setHata(null);
    setAlanHatalari({});
    setYerelHata(null);

    const variants = [];
    for (const [sira, satir] of satirlar.entries()) {
      // ⚠️ Para metinden `bigint`e; `Number()` parayı sessizce bozar.
      const kurus = kurusCoz(satir.fiyat, AZAMI_KURUS);
      if (kurus === null || kurus <= 0n) {
        setYerelHata(`${sira + 1}. varyantın fiyatını 1.290,00 gibi yazın.`);
        return;
      }
      const adet = adetCoz(satir.stok, AZAMI_STOK);
      if (adet === null) {
        setYerelHata(`${sira + 1}. varyantın stoğu sıfır veya daha büyük bir tam sayı olmalı.`);
        return;
      }
      variants.push({
        sku: satir.sku.trim().toUpperCase(),
        color: satir.renk.trim(),
        colorHex: satir.renkKodu.toUpperCase(),
        size: satir.beden.trim(),
        priceMinor: kurus.toString(),
        stock: adet,
        sortOrder: sira,
      });
    }

    setGonderiliyor(true);
    try {
      const yanit = await apiFetch<SellerProductDetailWire, '/seller/products'>(
        '/seller/products',
        {
          method: 'POST',
          json: {
            title: baslik,
            description: aciklama,
            categoryId: kategori,
            brandName: marka,
            gender: cinsiyet,
            ...(sezon.trim() === '' ? {} : { season: sezon.trim() }),
            variants,
          },
        },
      );
      // Yeni ürünün ilk işi görsel yüklemek; oraya en yakın ekran detaydır.
      router.push(`/satici/urunler/${yanit.data.id}`);
    } catch (istekHatasi) {
      if (isApiFailure(istekHatasi) && istekHatasi.fields.length > 0) {
        setAlanHatalari(fieldErrorMap(istekHatasi.fields));
      }
      setHata(istekHatasi);
      setGonderiliyor(false);
    }
  }

  return (
    <form onSubmit={(olay) => void gonder(olay)} className="flex max-w-3xl flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-metin">Ürün adı</span>
        <Input value={baslik} onChange={(olay) => setBaslik(olay.target.value)} required />
        {alanHatalari['title'] ? (
          <span className="text-sm text-tehlike">{alanHatalari['title']}</span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-metin">Açıklama</span>
        <textarea
          value={aciklama}
          onChange={(olay) => setAciklama(olay.target.value)}
          rows={4}
          required
          className="w-full rounded-md border border-kenar bg-zemin p-3 text-sm text-metin"
        />
        <span className="text-xs text-metin-soluk">En az 10 karakter.</span>
        {alanHatalari['description'] ? (
          <span className="text-sm text-tehlike">{alanHatalari['description']}</span>
        ) : null}
      </label>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-metin">Marka</span>
          <Input value={marka} onChange={(olay) => setMarka(olay.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-metin">Cinsiyet</span>
          <select
            value={cinsiyet}
            onChange={(olay) => setCinsiyet(olay.target.value as SellerGenderWire)}
            className="h-10 rounded-md border border-kenar bg-zemin px-2 text-sm text-metin"
          >
            {CINSIYETLER.map((deger) => (
              <option key={deger} value={deger}>
                {CINSIYET_ETIKETLERI[deger]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-metin">Sezon</span>
          <Input
            value={sezon}
            placeholder="AW25"
            onChange={(olay) => setSezon(olay.target.value)}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-metin">Kategori</span>
        <select
          value={kategori}
          onChange={(olay) => setKategori(olay.target.value)}
          className="h-10 rounded-md border border-kenar bg-zemin px-2 text-sm text-metin"
        >
          {kategoriler.map((secenek) => (
            <option key={secenek.id} value={secenek.id}>
              {secenek.etiket}
            </option>
          ))}
        </select>
        {alanHatalari['categoryId'] ? (
          <span className="text-sm text-tehlike">{alanHatalari['categoryId']}</span>
        ) : null}
      </label>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Varyantlar</h2>
        <div className="flex flex-col gap-2">
          {satirlar.map((satir, sira) => (
            <div
              key={satir.anahtar}
              className="flex flex-wrap items-end gap-2 rounded-md border border-kenar p-3"
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs text-metin-soluk">SKU</span>
                <Input
                  value={satir.sku}
                  onChange={(olay) => satirGuncelle(satir.anahtar, { sku: olay.target.value })}
                  required
                  className="w-40 uppercase"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-metin-soluk">Renk</span>
                <Input
                  value={satir.renk}
                  onChange={(olay) => satirGuncelle(satir.anahtar, { renk: olay.target.value })}
                  required
                  className="w-32"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-metin-soluk">Renk kodu</span>
                {/* ⚠️ `#RRGGBB` ZORUNLU (şema regex'i); renk seçici bu biçimi garanti eder. */}
                <input
                  type="color"
                  value={satir.renkKodu}
                  onChange={(olay) => satirGuncelle(satir.anahtar, { renkKodu: olay.target.value })}
                  className="h-10 w-12 rounded-md border border-kenar bg-zemin"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-metin-soluk">Beden</span>
                <Input
                  value={satir.beden}
                  onChange={(olay) => satirGuncelle(satir.anahtar, { beden: olay.target.value })}
                  required
                  className="w-24"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-metin-soluk">Fiyat (₺)</span>
                <Input
                  value={satir.fiyat}
                  inputMode="decimal"
                  placeholder="1.290,00"
                  onChange={(olay) => satirGuncelle(satir.anahtar, { fiyat: olay.target.value })}
                  required
                  className="rakam w-32"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-metin-soluk">Stok</span>
                <Input
                  value={satir.stok}
                  inputMode="numeric"
                  onChange={(olay) => satirGuncelle(satir.anahtar, { stok: olay.target.value })}
                  className="rakam w-24"
                />
              </label>

              {satirlar.length > 1 ? (
                <Button
                  type="button"
                  variant="sessiz"
                  size="icon"
                  aria-label={`${sira + 1}. varyantı kaldır`}
                  onClick={() =>
                    setSatirlar((oncekiler) =>
                      oncekiler.filter((diger) => diger.anahtar !== satir.anahtar),
                    )
                  }
                >
                  <Trash2 className="size-4" strokeWidth={1.5} />
                </Button>
              ) : null}
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="ikincil"
          size="sm"
          className="mt-2"
          onClick={() => setSatirlar((oncekiler) => [...oncekiler, bosSatir()])}
        >
          Varyant ekle
        </Button>

        <p className="mt-2 text-xs text-metin-soluk">
          Aynı renk ve beden birden fazla kez eklenemez; SKU değerleri benzersiz olmalı.
        </p>
      </div>

      {yerelHata ? <p className="text-sm text-tehlike">{yerelHata}</p> : null}
      {hata !== null ? <HataGosterimi error={hata} /> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={gonderiliyor}>
          {gonderiliyor ? 'Kaydediliyor…' : 'Ürünü kaydet'}
        </Button>
        <span className="text-sm text-metin-soluk">
          Ürün taslak olarak kaydedilir. Görselleri yükleyip incelemeye gönderdiğinizde yayına
          alınır.
        </span>
      </div>
    </form>
  );
}
