'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { isApiFailure } from '@vt/contracts';
import { apiFetch, newIdempotencyKey } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { TBody, THead, TD, TH, TR, Table } from '@/components/ui/table';
import type { BulkUploadErrorDetailWire, BulkUploadResultWire } from '@vt/contracts';

/**
 * CSV TOPLU YÜKLEME.
 *
 * ⚠️ `multipart/form-data` DEĞİL: uç dosyayı JSON gövdede METİN olarak alıyor
 *    (`{fileName, content}`) çünkü API'de multer bağımlılığı yok
 *    (`seller.schema.ts` gerekçesi). Dosya bu yüzden tarayıcıda `text()` ile
 *    okunuyor.
 *
 * ⚠️ `@Idempotent` ZORUNLU ve anahtar `useRef`te: uç yüzlerce ürün yaratıyor.
 *    Ağ zaman aşımından sonra tekrar denendiğinde AYNI anahtar gitmeli, yoksa
 *    aynı dosya ikinci kez işlenir. Anahtar başarılı yüklemeden sonra ve dosya
 *    değiştiğinde sıfırlanır — o noktada yeni bir kullanıcı niyeti başlar.
 *
 * ⚠️ HATA DURUMUNDA HİÇBİR SATIR YAZILMAZ (hep-ya-hiç). Bu yüzden hata tablosu
 *    "şunlar geçti, şunlar geçmedi" değil, "dosyayı düzeltip yeniden yükleyin"
 *    anlamına gelir; metin bunu söylüyor.
 */
const SUTUNLAR = [
  'productRef',
  'title',
  'description',
  'categorySlug',
  'brandName',
  'gender',
  'sku',
  'color',
  'colorHex',
  'size',
  'priceMinor',
  'listPriceMinor',
  'barcode',
  'stock',
] as const;

/** `MAX_CSV_BYTES` (`seller-csv.ts`) — 2 MB. */
const AZAMI_BAYT = 2 * 1024 * 1024;
/** `MAX_CSV_ROWS` — 2000 satır. */
const AZAMI_SATIR = 2_000;

export function TopluYuklemeFormu(): React.ReactElement {
  const router = useRouter();
  const anahtar = React.useRef<string | null>(null);

  const [dosya, setDosya] = React.useState<File | null>(null);
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [hata, setHata] = React.useState<unknown>(null);
  const [yerelHata, setYerelHata] = React.useState<string | null>(null);
  const [satirHatalari, setSatirHatalari] = React.useState<BulkUploadErrorDetailWire | null>(null);
  const [sonuc, setSonuc] = React.useState<BulkUploadResultWire | null>(null);

  async function gonder(olay: React.FormEvent): Promise<void> {
    olay.preventDefault();
    setHata(null);
    setYerelHata(null);
    setSatirHatalari(null);
    setSonuc(null);

    if (!dosya) {
      setYerelHata('Önce bir CSV dosyası seçin.');
      return;
    }
    if (dosya.size > AZAMI_BAYT) {
      setYerelHata('Dosya en fazla 2 MB olabilir.');
      return;
    }

    anahtar.current ??= newIdempotencyKey();
    setGonderiliyor(true);

    try {
      const icerik = await dosya.text();
      const yanit = await apiFetch<BulkUploadResultWire, '/seller/products/bulk-upload'>(
        '/seller/products/bulk-upload',
        {
          method: 'POST',
          json: { fileName: dosya.name, content: icerik },
          idempotencyKey: anahtar.current,
        },
      );
      setSonuc(yanit.data);
      anahtar.current = null;
      router.refresh();
    } catch (istekHatasi) {
      /**
       * ⚠️ `BULK_UPLOAD_INVALID`ın `details`i satır/sütun/Türkçe mesaj üçlüsü
       *    taşıyor. Yalnız zarf mesajını göstermek ("3 satırda hata var")
       *    satıcıya hangi satırı düzelteceğini SÖYLEMEZ — 2000 satırlık bir
       *    dosyada bu, hatayı hiç göstermemekle aynı şey.
       */
      if (isApiFailure(istekHatasi) && istekHatasi.code === 'BULK_UPLOAD_INVALID') {
        const detay = istekHatasi.details as BulkUploadErrorDetailWire | undefined;
        if (detay && Array.isArray(detay.errors)) setSatirHatalari(detay);
      }
      setHata(istekHatasi);
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-prose text-sm text-metin-soluk">
        <p>
          Dosyanın ilk satırı başlık olmalı. Aynı <span className="text-metin">productRef</span>{' '}
          değerini taşıyan satırlar aynı ürünün varyantları olarak yüklenir. En fazla{' '}
          <span className="rakam">{AZAMI_SATIR}</span> satır, 2 MB.
        </p>
        <p className="mt-2">
          Sütunlar (sıra önemsiz): <span className="text-metin">{SUTUNLAR.join(', ')}</span>.
          Zorunlu olmayanlar: description, listPriceMinor, barcode.
        </p>
        <p className="mt-2">
          {/* ⚠️ Bu cümle şart: `priceMinor` KURUŞ. "149,90" yazan satıcı 1,4990 ₺ yükler. */}
          <span className="text-metin">priceMinor</span> kuruş cinsindendir: 149,90 ₺ için{' '}
          <span className="rakam text-metin">14990</span> yazın.
        </p>
      </div>

      <form onSubmit={(olay) => void gonder(olay)} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-metin">CSV dosyası</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(olay) => {
              setDosya(olay.target.files?.[0] ?? null);
              // Yeni dosya = yeni niyet: eski anahtar yeniden kullanılamaz.
              anahtar.current = null;
            }}
            className="text-sm text-metin"
          />
        </label>

        {yerelHata ? <p className="text-sm text-tehlike">{yerelHata}</p> : null}

        <div>
          <Button type="submit" disabled={gonderiliyor}>
            {gonderiliyor ? 'Yükleniyor…' : 'Dosyayı yükle'}
          </Button>
        </div>
      </form>

      {hata !== null ? <HataGosterimi error={hata} className="max-w-xl" /> : null}

      {satirHatalari ? (
        <div>
          <p className="mb-2 text-sm text-metin">
            Dosyadaki hiçbir satır yazılmadı. Aşağıdaki satırları düzeltip dosyayı yeniden yükleyin.
            {satirHatalari.truncated ? ' (İlk hatalar gösteriliyor.)' : ''}
          </p>
          <Table>
            <THead>
              <TR>
                <TH sayisal>Satır</TH>
                <TH>Sütun</TH>
                <TH>Sorun</TH>
              </TR>
            </THead>
            <TBody>
              {satirHatalari.errors.map((satir, sira) => (
                <TR key={`${satir.row}-${satir.column}-${sira}`}>
                  {/* ⚠️ `row` 1 tabanlı DOSYA satırı: başlık 1, ilk veri 2. */}
                  <TD sayisal>{satir.row}</TD>
                  <TD>{satir.column}</TD>
                  <TD>{satir.message}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      ) : null}

      {sonuc ? (
        <div className="max-w-xl rounded-md border border-kenar bg-yuzey p-4 text-sm">
          <p className="text-metin">
            {sonuc.fileName} işlendi: <span className="rakam">{sonuc.createdProducts}</span> yeni
            ürün, <span className="rakam">{sonuc.updatedProducts}</span> güncellenen ürün,{' '}
            <span className="rakam">{sonuc.createdVariants}</span> yeni varyant,{' '}
            <span className="rakam">{sonuc.updatedVariants}</span> güncellenen varyant.
          </p>
          {/* ⚠️ ÖLÇÜLDÜ: CSV ile gelen ürün de DRAFT doğar. */}
          <p className="mt-1 text-metin-soluk">
            Yüklenen ürünler taslak durumundadır; görsellerini yükleyip incelemeye gönderin.
          </p>
        </div>
      ) : null}
    </div>
  );
}
