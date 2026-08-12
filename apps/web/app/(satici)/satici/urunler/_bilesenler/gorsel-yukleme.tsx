'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { MEDIA } from '@vt/config/constants';
import type { UploadTicketWire } from '@vt/contracts';
import { apiFetch, newIdempotencyKey } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import type { ProductImageConfirmWire } from '@vt/contracts';

/**
 * ÜRÜN GÖRSELİ YÜKLEME — ÜÇ ADIM, ORTADAKİ ADIM VEKİLDEN GEÇMEZ.
 *
 *   1. `POST /seller/products/:id/images`            → imzalı bilet (vekilden)
 *   2. `PUT <uploadUrl>`                              → DOĞRUDAN R2'ye
 *   3. `POST .../images/:uploadId/confirm`            → satır + skor (vekilden)
 *
 * ⚠️ 2. ADIM VEKİLE ALINAMAZ: 10 MB'a kadar her dosya Next sürecinin belleğine
 *    tamponlanırdı (`proxy.ts` gövdeyi 401 tekrarı için tampona alıyor).
 *    Gerekçe `wire/media.ts` başlığında da yazılı.
 *
 * ⚠️ BU ADIM BUGÜN TARAYICIDA ÇALIŞMIYOR — KABUL KAPISI, DİPNOT DEĞİL.
 *    `infra/R2-CORS.md`: özel kovada CORS tanımlı olmadığı için ön uçuş
 *    `OPTIONS` 403 dönüyor; aynı imzalı adrese `curl PUT` 200. Ham dosya
 *    ürün görselinde de ÖZEL kovaya iniyor (`media-product.service.ts`:
 *    `visibility: 'private'`, EXIF/GPS temizliği public'e yazmadan önce
 *    yapılıyor), yani kullanıcı fotoğrafıyla AYNI duvar. Kova ayarı yapılıp
 *    `OPTIONS` 204 dönene kadar bu ekranda yükleme tamamlanamaz; ekran bunu
 *    gizlemiyor, PUT düştüğünde hatayı olduğu gibi gösteriyor.
 *
 * ⚠️ IDEMPOTENCY ANAHTARI `useRef`te ve KULLANICI NİYETİ BAŞINA BİR KEZ
 *    üretiliyor: onay adımı görsel satırı yaratıp public kovaya nesne yazıyor
 *    ve skoru güncelliyor. Büyük bir yüklemenin ardından gelen ağ zaman
 *    aşımında tekrar denenirse anahtar aynı kalmalı, yoksa aynı görsel ürüne
 *    İKİ KEZ eklenir. Başarıdan sonra sıfırlanır — sıradaki dosya yeni bir
 *    niyettir.
 */
export interface GorselYuklemeProps {
  productId: string;
}

const ACILAR = [
  { deger: 'FRONT', etiket: 'Ön' },
  { deger: 'BACK', etiket: 'Arka' },
  { deger: 'SIDE', etiket: 'Yan' },
  { deger: 'MODEL', etiket: 'Model üzerinde' },
  { deger: 'DETAIL', etiket: 'Detay' },
  { deger: 'FLATLAY', etiket: 'Düz çekim' },
] as const;

type Aci = (typeof ACILAR)[number]['deger'];

export function GorselYukleme({ productId }: GorselYuklemeProps): React.ReactElement {
  const router = useRouter();
  const anahtar = React.useRef<string | null>(null);

  const [dosya, setDosya] = React.useState<File | null>(null);
  const [aci, setAci] = React.useState<Aci>('FRONT');
  const [birincil, setBirincil] = React.useState(false);
  const [sira, setSira] = React.useState('0');
  const [adim, setAdim] = React.useState<'bekliyor' | 'bilet' | 'yukleme' | 'onay'>('bekliyor');
  const [hata, setHata] = React.useState<unknown>(null);
  const [yerelHata, setYerelHata] = React.useState<string | null>(null);
  const [sonuc, setSonuc] = React.useState<ProductImageConfirmWire | null>(null);

  const calisiyor = adim !== 'bekliyor';

  async function yukle(olay: React.FormEvent): Promise<void> {
    olay.preventDefault();
    setHata(null);
    setYerelHata(null);
    setSonuc(null);

    if (!dosya) {
      setYerelHata('Önce bir dosya seçin.');
      return;
    }

    /*
      ⚠️ İSTEMCİ TARAFI DENETİM SUNUCUYU DEĞİL KULLANICIYI KORUYOR: sunucu
         biçimi baytlardan okuyor ve boyutu onay adımında yeniden ölçüyor.
         Buradaki amaç 9 MB'lık bir dosyayı yükledikten SONRA reddedilmemek.
         Sınırlar `@vt/config/constants`tan — ekrana rakam gömülmüyor.
    */
    if (!(MEDIA.allowedMimeTypes as readonly string[]).includes(dosya.type)) {
      setYerelHata('Yalnızca JPG, PNG veya WebP yükleyebilirsiniz.');
      return;
    }
    if (dosya.size > MEDIA.maxUploadBytes) {
      setYerelHata(
        `Dosya en fazla ${Math.floor(MEDIA.maxUploadBytes / (1024 * 1024))} MB olabilir.`,
      );
      return;
    }

    const siraSayisi = Number.parseInt(sira, 10);
    if (!Number.isInteger(siraSayisi) || siraSayisi < 0 || siraSayisi > 100) {
      setYerelHata('Sıra 0 ile 100 arasında bir tam sayı olmalı.');
      return;
    }

    anahtar.current ??= newIdempotencyKey();

    try {
      setAdim('bilet');
      const bilet = await apiFetch<UploadTicketWire, `/seller/products/${string}/images`>(
        `/seller/products/${productId}/images`,
        {
          method: 'POST',
          json: { angle: aci, contentType: dosya.type, sizeBytes: dosya.size },
        },
      );

      setAdim('yukleme');
      /**
       * ⚠️ `requiredContentType` AYNEN gönderiliyor: istemcinin beyanı imzaya
       *    gömülü, farklı bir tip depoda reddedilir.
       * ⚠️ `apiFetch` KULLANILMIYOR — bu adres bizim kökenimiz değil, R2.
       *    Zarf yok, `credentials` yok; ham `fetch`.
       */
      const yanit = await fetch(bilet.data.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': bilet.data.requiredContentType },
        body: dosya,
      });
      if (!yanit.ok) {
        throw new Error(`Dosya depoya yüklenemedi (HTTP ${yanit.status}).`);
      }

      setAdim('onay');
      const onay = await apiFetch<
        ProductImageConfirmWire,
        `/seller/products/${string}/images/${string}/confirm`
      >(`/seller/products/${productId}/images/${bilet.data.uploadId}/confirm`, {
        method: 'POST',
        json: { angle: aci, isPrimary: birincil, sortOrder: siraSayisi },
        idempotencyKey: anahtar.current,
      });

      setSonuc(onay.data);
      anahtar.current = null;
      setDosya(null);
      setBirincil(false);
      router.refresh();
    } catch (istekHatasi) {
      /**
       * ⚠️ PUT adımının hatası ZARF DEĞİLDİR (R2 CORS'ta `TypeError`).
       *    `HataGosterimi` bunu "bilinmeyen hata" dalında gösterir ve
       *    "Tekrar dene" düğmesi çıkar — doğrusu da bu: aynı anahtarla
       *    tekrarlanabilir bir iş.
       */
      setHata(istekHatasi);
    } finally {
      setAdim('bekliyor');
    }
  }

  return (
    <div>
      <form onSubmit={(olay) => void yukle(olay)} className="flex max-w-xl flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-metin">Dosya</span>
          <input
            type="file"
            accept={MEDIA.allowedMimeTypes.join(',')}
            onChange={(olay) => setDosya(olay.target.files?.[0] ?? null)}
            className="text-sm text-metin"
          />
        </label>

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-metin">Açı</span>
            <select
              value={aci}
              onChange={(olay) => setAci(olay.target.value as Aci)}
              className="h-10 rounded-md border border-kenar bg-zemin px-2 text-sm text-metin"
            >
              {ACILAR.map((secenek) => (
                <option key={secenek.deger} value={secenek.deger}>
                  {secenek.etiket}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-metin">Sıra</span>
            <input
              inputMode="numeric"
              value={sira}
              onChange={(olay) => setSira(olay.target.value)}
              className="rakam h-10 w-20 rounded-md border border-kenar bg-zemin px-3 text-sm text-metin"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={birincil}
            onChange={(olay) => setBirincil(olay.target.checked)}
          />
          <span className="text-metin">Birincil görsel yap</span>
        </label>

        {yerelHata ? <p className="text-sm text-tehlike">{yerelHata}</p> : null}
        {hata !== null ? <HataGosterimi error={hata} /> : null}

        <div>
          <Button type="submit" disabled={calisiyor}>
            {adim === 'bilet'
              ? 'Adres alınıyor…'
              : adim === 'yukleme'
                ? 'Yükleniyor…'
                : adim === 'onay'
                  ? 'İşleniyor…'
                  : 'Görseli yükle'}
          </Button>
        </div>
      </form>

      {/*
        ⚠️ ONAY YANITINDAKİ ÖNERİLER OLDUĞU GİBİ BASILIYOR. Backend bu cümleleri
           kaç görselde ne sorun olduğunu SAYARAK üretiyor ("3 görselde arka
           plan kalabalık"); frontend'de yeniden yazmak o sayıyı kaybettirir ve
           ikinci bir metin kaynağı doğurur.
      */}
      {sonuc ? (
        <div className="mt-4 max-w-xl rounded-md border border-kenar bg-yuzey p-4 text-sm">
          <p className="text-metin">
            Görsel eklendi. Sanal deneme uygunluğu:{' '}
            <span className="rakam font-semibold">{sonuc.tryOnScore}</span>/100
          </p>
          {sonuc.suggestions.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-2">
              {sonuc.suggestions.map((oneri) => (
                <li key={oneri.issue} className="flex gap-2">
                  <span className="rakam shrink-0 text-metin-soluk">+{oneri.gain}</span>
                  <span className="text-metin">{oneri.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
