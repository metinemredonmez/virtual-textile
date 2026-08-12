'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { isApiFailure } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { Input } from '@/components/ui/input';
import { fieldErrorMap } from '@/components/hata/alan-hatalari';
import { CINSIYET_ETIKETLERI } from '../_lib/durum';
import type { KategoriSecenegi } from '../../_lib/kategoriler';
import type { SellerGenderWire, SellerProductDetailWire } from '@vt/contracts';

/**
 * ÜRÜN BİLGİ FORMU.
 *
 * ⚠️ YAYINDAKİ ÜRÜNDE DEĞİŞİKLİK ANINDA CANLIYA GİDER. ÖLÇÜLDÜ:
 *      PATCH {"title":"… — DUZENLENDI"} → status PUBLISHED kaldı, başlık
 *      değişti; kategori değişiminde de aynı.
 *    `seller.bridges.ts:379` mevcut durumu okuyor ama `existing.status`ı hiçbir
 *    yerde KULLANMIYOR. Yani "değişiklik yeniden incelenecek" yazan bir arayüz
 *    metni YALAN olurdu. Ekran bugünkü davranışı olduğu gibi söylüyor; kararın
 *    kendisi backend'e taşınmalı (rapor).
 *
 * ⚠️ ALAN HATALARI `details.fields[].message`tan OLDUĞU GİBİ basılmaz:
 *    `alan-hatalari.ts`ten geçirilir. Ölçüldü, bu uçta İngilizce dönebiliyor:
 *      "Invalid enum value. Expected 'DRAFT' | … received 'PUBLISHED'".
 */
export interface UrunFormuProps {
  urun: SellerProductDetailWire;
  kategoriler: KategoriSecenegi[];
}

const CINSIYETLER = Object.keys(CINSIYET_ETIKETLERI) as SellerGenderWire[];

export function UrunFormu({ urun, kategoriler }: UrunFormuProps): React.ReactElement {
  const router = useRouter();
  const [baslik, setBaslik] = React.useState(urun.title);
  const [aciklama, setAciklama] = React.useState(urun.description);
  const [marka, setMarka] = React.useState(urun.brandName);
  const [cinsiyet, setCinsiyet] = React.useState<SellerGenderWire>(urun.gender);
  const [kategori, setKategori] = React.useState(urun.categoryId);
  const [sezon, setSezon] = React.useState(urun.season ?? '');
  const [koleksiyon, setKoleksiyon] = React.useState(urun.collection ?? '');
  const [etiketOnayi, setEtiketOnayi] = React.useState(urun.aiTagsApproved);

  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [hata, setHata] = React.useState<unknown>(null);
  const [alanHatalari, setAlanHatalari] = React.useState<Record<string, string>>({});
  const [kaydedildi, setKaydedildi] = React.useState(false);

  async function kaydet(olay: React.FormEvent): Promise<void> {
    olay.preventDefault();
    setGonderiliyor(true);
    setHata(null);
    setAlanHatalari({});
    setKaydedildi(false);

    try {
      await apiFetch<SellerProductDetailWire, `/seller/products/${string}`>(
        `/seller/products/${urun.id}`,
        {
          method: 'PATCH',
          json: {
            title: baslik,
            description: aciklama,
            brandName: marka,
            gender: cinsiyet,
            categoryId: kategori,
            // ⚠️ Boş metin `null` olarak gidiyor: şema `nullable`, boş string
            //    `.max(40)`dan geçer ama vitrinde boş bir sezon etiketi üretir.
            season: sezon.trim() === '' ? null : sezon.trim(),
            collection: koleksiyon.trim() === '' ? null : koleksiyon.trim(),
            aiTagsApproved: etiketOnayi,
          },
        },
      );
      setKaydedildi(true);
      router.refresh();
    } catch (istekHatasi) {
      if (isApiFailure(istekHatasi) && istekHatasi.fields.length > 0) {
        setAlanHatalari(fieldErrorMap(istekHatasi.fields));
      }
      setHata(istekHatasi);
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <form onSubmit={(olay) => void kaydet(olay)} className="flex max-w-2xl flex-col gap-4">
      {urun.status === 'PUBLISHED' ? (
        <p className="rounded-md border border-kenar bg-yuzey p-3 text-sm text-metin-soluk">
          Bu ürün yayında. Buradaki değişiklikler yeniden incelenmeden vitrine yansır.
        </p>
      ) : null}

      <Alan etiket="Ürün adı" hata={alanHatalari['title']}>
        <Input value={baslik} onChange={(olay) => setBaslik(olay.target.value)} required />
      </Alan>

      <Alan etiket="Açıklama" hata={alanHatalari['description']}>
        <textarea
          value={aciklama}
          onChange={(olay) => setAciklama(olay.target.value)}
          rows={5}
          required
          className="w-full rounded-md border border-kenar bg-zemin p-3 text-sm text-metin"
        />
      </Alan>

      <div className="flex flex-wrap gap-4">
        <Alan etiket="Marka" hata={alanHatalari['brandName']}>
          <Input value={marka} onChange={(olay) => setMarka(olay.target.value)} required />
        </Alan>

        <Alan etiket="Cinsiyet" hata={alanHatalari['gender']}>
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
        </Alan>
      </div>

      <Alan etiket="Kategori" hata={alanHatalari['categoryId']}>
        <select
          value={kategori}
          onChange={(olay) => setKategori(olay.target.value)}
          className="h-10 w-full rounded-md border border-kenar bg-zemin px-2 text-sm text-metin"
        >
          {kategoriler.map((secenek) => (
            <option key={secenek.id} value={secenek.id}>
              {secenek.etiket}
            </option>
          ))}
        </select>
      </Alan>

      <div className="flex flex-wrap gap-4">
        <Alan etiket="Sezon" hata={alanHatalari['season']}>
          <Input
            value={sezon}
            placeholder="AW25"
            onChange={(olay) => setSezon(olay.target.value)}
          />
        </Alan>
        <Alan etiket="Koleksiyon" hata={alanHatalari['collection']}>
          <Input value={koleksiyon} onChange={(olay) => setKoleksiyon(olay.target.value)} />
        </Alan>
      </div>

      {/*
        ⚠️ AI ETİKET ONAYI BİR YAYIN ÖNKOŞULU. Admin onayı bu alan `false` iken
           400 döndürüyor ("Satıcı yapay zekâ etiketlerini onaylamadan ürün
           yayınlanamaz."). Formda sıradan bir kutu gibi durması, satıcının
           reddedilme sebebini hiç görmemesi demek olurdu.
      */}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={etiketOnayi}
          onChange={(olay) => setEtiketOnayi(olay.target.checked)}
        />
        <span>
          <span className="text-metin">Yapay zekâ etiketlerini onaylıyorum</span>
          <span className="block text-metin-soluk">
            Onaylanmadan ürün yayına alınamaz; incelemeye gönderseniz bile reddedilir.
          </span>
        </span>
      </label>

      {hata !== null ? <HataGosterimi error={hata} /> : null}
      {kaydedildi ? <p className="text-sm text-metin-soluk">Değişiklikler kaydedildi.</p> : null}

      <div>
        <Button type="submit" disabled={gonderiliyor}>
          {gonderiliyor ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
      </div>
    </form>
  );
}

/**
 * ⚠️ ETİKET GİRDİYİ SARIYOR, `htmlFor` KULLANILMIYOR: her alana ayrıca `id`
 *    vermek gerekirdi ve unutulan bir `id` ekran okuyucuda etiketsiz bir alan
 *    üretirdi — hata vermeden. Örtük bağlama unutulamaz.
 */
function Alan({
  etiket,
  hata,
  children,
}: {
  etiket: string;
  hata: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="flex min-w-48 flex-1 flex-col gap-1">
      <span className="text-sm font-medium text-metin">{etiket}</span>
      {children}
      {/* ⚠️ Hata ALANIN ALTINDA: yeri de bilgidir (`hata-kapsami.ts`). */}
      {hata ? <span className="text-sm text-tehlike">{hata}</span> : null}
    </label>
  );
}
