'use client';

import * as React from 'react';
import Link from 'next/link';
import { isApiFailure, type ApiFailure, type CartWire } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';
import { hataKapsami } from '@/lib/api/hata-kapsami';
import { Paket } from './paket';
import { Alinamayanlar } from './alinamayanlar';
import { Kupon } from './kupon';
import { Ozet } from './ozet';

/**
 * SEPETİN TEK YAZMA NOKTASI.
 *
 * ⚠️ SEPET DURUMU BURADA TUTULUR AMA HESAPLANMAZ. Her mutasyon sunucudan TAM
 *    sepet görünümü döndürüyor (ÖLÇÜLDÜ: PATCH/DELETE/coupon uçlarının hepsi
 *    200 + `CartWire`); gelen nesne olduğu gibi state'e YAZILIR. İyimser bir
 *    adet güncellemesi yapıp toplamı yerelde düzeltmek, kullanıcının bir tutar
 *    görüp başka tutar ödemesi demektir — sunucu indirimi `Money.allocate()`
 *    ile kuruş kaybı olmadan paylaştırıyor ve o dağıtım burada tekrarlanamaz.
 *
 * ⚠️ Global durum kütüphanesi YOK (değişmez kural 6). Sepet SUNUCU DURUMUDUR;
 *    ilk değer SSR'dan geliyor, sonraki her değer sunucu yanıtından.
 */
export function SepetIstemci({
  baslangic,
  sunucudaOkunamadi,
}: {
  baslangic: CartWire;
  /** SSR sepeti okuyamadı (oturum yenileme gerekti) — ilk işte vekilden çekilir. */
  sunucudaOkunamadi: boolean;
}): React.ReactElement {
  const [sepet, setSepet] = React.useState<CartWire>(baslangic);
  const [sayfaHatasi, setSayfaHatasi] = React.useState<ApiFailure | null>(null);
  /** itemId → o satıra ait hata. Sayfanın tepesine ASLA taşınmaz. */
  const [satirHatalari, setSatirHatalari] = React.useState<Record<string, ApiFailure>>({});
  const [kuponHatasi, setKuponHatasi] = React.useState<ApiFailure | null>(null);
  const [meshgul, setMesgul] = React.useState<string | null>(null);

  /**
   * Sepeti vekilden yeniden çek.
   *
   * ⚠️ `useCallback` + `exhaustive-deps`: bu fonksiyon aşağıdaki `useEffect`in
   *    bağımlılığı. Sarılmasaydı efekt her render'da yeniden çalışır ve sayfa
   *    sonsuz bir yeniden çekme döngüsüne girerdi.
   */
  const yenidenCek = React.useCallback(async () => {
    try {
      const { data } = await apiFetch<CartWire, '/cart'>('/cart');
      setSepet(data);
      setSayfaHatasi(null);
    } catch (error) {
      if (isApiFailure(error)) setSayfaHatasi(error);
      else throw error;
    }
  }, []);

  React.useEffect(() => {
    if (sunucudaOkunamadi) void yenidenCek();
  }, [sunucudaOkunamadi, yenidenCek]);

  /**
   * Mutasyonların ORTAK gövdesi: başarıda sepet değişir, hatada hata KAPSAMINA
   * göre yerleşir.
   *
   * ⚠️ `satirId` verilmezse satır hatası da olamaz — kupon ve sepet düzeyindeki
   *    işlerde bu doğru davranış.
   */
  const calistir = React.useCallback(
    async (
      anahtar: string,
      istek: () => Promise<{ data: CartWire }>,
      satirId?: string,
    ): Promise<void> => {
      setMesgul(anahtar);
      if (satirId) setSatirHatalari((onceki) => temizle(onceki, satirId));
      else setKuponHatasi(null);
      setSayfaHatasi(null);

      try {
        const { data } = await istek();
        setSepet(data);
        // Başarılı bir işlem sepetin TAMAMINI tazeler; artık geçerliliği
        // kalmamış satır hataları ekranda asılı kalmasın.
        setSatirHatalari({});
      } catch (error) {
        if (!isApiFailure(error)) throw error;

        switch (hataKapsami(error.code)) {
          case 'satir':
            // ⚠️ ÖLÇÜLDÜ: reddedilen bir PATCH sepeti DEĞİŞTİRMİYOR, dolayısıyla
            //    sepeti yeniden çekmek `maxAvailable`ı DOLDURMAZ (satırın adedi
            //    hâlâ stoğun altında olduğu için `issue` da `null` kalıyor).
            //    Azami adet YALNIZCA bu mesajın içinde; mesaj olduğu gibi
            //    satırın altına basılır ve içinden sayı AYIKLANMAZ.
            if (satirId) setSatirHatalari((onceki) => ({ ...onceki, [satirId]: error }));
            else setSayfaHatasi(error);
            break;
          case 'kupon':
            setKuponHatasi(error);
            break;
          case 'sepet':
            // ⚠️ SIRA: önce tazele, SONRA hatayı yaz. `yenidenCek` başarılı
            //    olduğunda `sayfaHatasi`nı temizliyor; ters sırada kullanıcı
            //    boşalmış bir sepete SEBEP GÖRMEDEN bakardı ("Sepetiniz boş"
            //    yazar, sepetinin neden süresinin dolduğunu asla öğrenmez).
            await yenidenCek();
            setSayfaHatasi(error);
            break;
          case 'sayfa':
            setSayfaHatasi(error);
            break;
        }
      } finally {
        setMesgul(null);
      }
    },
    [yenidenCek],
  );

  const adetDegistir = React.useCallback(
    (itemId: string, adet: number) =>
      calistir(
        `adet:${itemId}`,
        () =>
          apiFetch<CartWire, `/cart/items/${string}`>(`/cart/items/${itemId}`, {
            method: 'PATCH',
            json: { quantity: adet },
          }),
        itemId,
      ),
    [calistir],
  );

  const satirSil = React.useCallback(
    (itemId: string) =>
      calistir(
        `sil:${itemId}`,
        () =>
          apiFetch<CartWire, `/cart/items/${string}`>(`/cart/items/${itemId}`, {
            method: 'DELETE',
          }),
        itemId,
      ),
    [calistir],
  );

  const kuponUygula = React.useCallback(
    (kod: string) =>
      calistir('kupon', () =>
        apiFetch<CartWire, '/cart/coupon'>('/cart/coupon', {
          method: 'POST',
          json: { code: kod },
        }),
      ),
    [calistir],
  );

  const kuponKaldir = React.useCallback(
    () =>
      calistir('kupon', () =>
        apiFetch<CartWire, '/cart/coupon'>('/cart/coupon', { method: 'DELETE' }),
      ),
    [calistir],
  );

  const bosMu = sepet.packages.length === 0 && sepet.unavailableItems.length === 0;

  if (bosMu) {
    return (
      <div className="py-16 text-center">
        <p className="text-metin">Sepetiniz boş.</p>
        {/* ⚠️ Boş durum NE YAPILACAĞINI söyler (referans sayfa kalıbı). */}
        <Link href="/products" className="mt-2 inline-block text-sm text-vurgu hover:underline">
          Ürünlere göz atın
        </Link>
        {sayfaHatasi ? (
          <HataGosterimi
            error={sayfaHatasi}
            onRetry={() => void yenidenCek()}
            className="mx-auto mt-6 max-w-md text-left"
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-start">
      <div className="flex flex-col gap-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Sepetim</h1>
          <span className="rakam text-sm text-metin-soluk">{sepet.itemCount} ürün</span>
        </header>

        {sayfaHatasi ? (
          <HataGosterimi error={sayfaHatasi} onRetry={() => void yenidenCek()} />
        ) : null}

        {sepet.packages.map((paket) => (
          <Paket
            key={paket.sellerId}
            paket={paket}
            satirHatalari={satirHatalari}
            meshgul={meshgul}
            onAdet={adetDegistir}
            onSil={satirSil}
          />
        ))}

        {sepet.unavailableItems.length > 0 ? (
          <Alinamayanlar kalemler={sepet.unavailableItems} meshgul={meshgul} onSil={satirSil} />
        ) : null}
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
        <Kupon
          kupon={sepet.coupon}
          hata={kuponHatasi}
          calisiyor={meshgul === 'kupon'}
          onUygula={kuponUygula}
          onKaldir={kuponKaldir}
        />
        <Ozet sepet={sepet} />
      </aside>
    </div>
  );
}

function temizle(kayit: Record<string, ApiFailure>, anahtar: string): Record<string, ApiFailure> {
  if (!(anahtar in kayit)) return kayit;
  const kopya = { ...kayit };
  delete kopya[anahtar];
  return kopya;
}
