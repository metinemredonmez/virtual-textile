import Link from 'next/link';
import type { ProductListItemWire, ProductListPayloadWire } from '@vt/contracts';
import { list } from '@/lib/api/core';
import { serverFetch } from '@/lib/api/server';
import { mediaUrl } from '@/lib/media';
import { UrunGorseli } from '@/components/urun/urun-gorseli';
import { Button } from '@/components/ui/button';
import { Fiyat } from '@/components/fiyat/fiyat';
import { AramaKutusu } from './products/_liste/arama-kutusu';
import { UrunIzgarasi } from '@/components/urun/urun-izgarasi';
import { kategoriAgaci, vitrinKategorileri } from '@/lib/kategori';

/**
 * VİTRİN — ÜÇ BÖLÜM, DAHA FAZLASI DEĞİL.
 *
 *   1. Vitrin görseli  — ekranın çoğu
 *   2. Öne çıkanlar    — sekiz ürün
 *   3. Kategoriler     — giriş kapıları
 *
 * ⚠️ Dördüncü bölüm eklenmez. `design-system.md` → öğe bütçesi: ana sayfa
 *    azami 3 bölüm. "Bültene abone ol", "neden biz", "yorumlar" gibi bir blok
 *    gerekiyorsa yeni bir EKRAN gerekiyordur, sıkıştırma değil. Sıkıştırılan
 *    her blok vitrin görselinden yer çalar ve bu platformun ayrıştırıcısı o
 *    görseldir.
 */
export const dynamic = 'force-dynamic';

/** 1 vitrin + 8 ızgara. Tek istek; ikisi için iki çağrı atmak boşuna. */
const VITRIN_URUN_SAYISI = 9;
const VITRIN_KATEGORI_SAYISI = 8;

export default async function VitrinPage(): Promise<React.ReactElement> {
  const [urunSonucu, agac] = await Promise.all([
    serverFetch<ProductListPayloadWire, '/products'>('/products', {
      // Varsayılan `relevance` sıralaması popülerlik + tazelik + mağaza
      // kalitesini birlikte tartıyor; vitrin için doğru olan bu, "en yeni" değil.
      query: { limit: VITRIN_URUN_SAYISI },
      forwardClientIp: true,
    }),
    kategoriAgaci(),
  ]);

  const { items } = list<ProductListItemWire>(urunSonucu);
  const [vitrin, ...izgara] = items;

  return (
    <div className="flex flex-col gap-20 py-4">
      <Vitrin urun={vitrin} />

      {izgara.length > 0 ? (
        <section>
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold tracking-tight">Öne çıkanlar</h2>
            <Link href="/products" className="text-sm text-metin-soluk hover:text-metin">
              Tümünü gör
            </Link>
          </div>
          <UrunIzgarasi urunler={izgara} />
        </section>
      ) : null}

      <Kategoriler agac={agac} />
    </div>
  );
}

/**
 * ⚠️ BAŞLIK GÖRSELİN ÜSTÜNE BİNMEZ, ALTINA YAZILIR.
 *
 *    Vitrin görseli bir ürün fotoğrafıdır ve hangi fotoğrafın geleceği
 *    satıcının elindedir: açık zemin de gelir, koyu zemin de. Üstüne yazılan
 *    metnin okunabilirliği garanti edilemez; garanti etmenin tek yolu görselin
 *    üzerine karartma koymaktır ve bu, görseli — yani asıl işi yapan şeyi —
 *    bozar. Metni altına almak hem okunaklı hem de görseli el değmemiş bırakır.
 *
 * ⚠️ Ayrıca ölçüldü: geliştirme ortamında R2 nesneleri 404 dönüyor. Görsel
 *    yüklenemediğinde bu düzen nötr bir gri panele iner ve başlık okunur
 *    kalır; bindirmeli bir düzende aynı durum okunamayan bir ekran olurdu.
 */
function Vitrin({ urun }: { urun: ProductListItemWire | undefined }): React.ReactElement {
  const gorsel = urun ? mediaUrl(urun.imageKey) : null;

  return (
    <section className="flex flex-col gap-8">
      <div className="relative aspect-urun w-full overflow-hidden rounded-lg bg-urun-zemin md:aspect-[16/7]">
        {/* ⚠️ Ham `next/image` DEĞİL — gerekçe `components/urun/urun-gorseli.tsx`te.
            `oncelikli`: ilk ekranın en büyük öğesi; tembel yüklenirse LCP odur. */}
        <UrunGorseli src={urun ? gorsel : null} alt={urun?.title ?? ''} sizes="100vw" oncelikli />
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight">
            Satın almadan önce üzerinizde görün.
          </h1>
          <p className="max-w-xl text-metin-soluk">
            Sanal deneme ile kıyafetin üzerinizde nasıl durduğunu görün, bedeninize uygun olup
            olmadığını ayrı bir skorla değerlendirin.
          </p>
        </div>

        <AramaKutusu className="max-w-xl" />

        <div className="flex flex-wrap items-center gap-6">
          <Button asChild size="lg">
            <Link href="/products">Ürünleri keşfet</Link>
          </Button>

          {urun ? (
            <Link href={`/product/${urun.slug}`} className="group flex flex-col gap-0.5 text-sm">
              <span className="text-xs uppercase tracking-wide text-metin-soluk">Vitrinde</span>
              {/* Ürün adı birincil, mağaza ikincil gri, fiyat birincil. */}
              <span className="font-semibold group-hover:underline">{urun.title}</span>
              <span className="text-metin-soluk">{urun.brandName}</span>
              <Fiyat value={urun.priceMinor} listValue={urun.listPriceMinor} className="text-sm" />
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Kategoriler({
  agac,
}: {
  agac: Awaited<ReturnType<typeof kategoriAgaci>>;
}): React.ReactElement | null {
  const gosterilecek = vitrinKategorileri(agac, VITRIN_KATEGORI_SAYISI);
  if (gosterilecek.length === 0) return null;

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Kategoriler</h2>
        <Link href="/category" className="text-sm text-metin-soluk hover:text-metin">
          Tüm kategoriler
        </Link>
      </div>

      {/* Kenarlıklar RENKSİZ; kategori bir durum değil, bir kapıdır. */}
      <ul className="flex flex-wrap gap-2">
        {gosterilecek.map((kategori) => (
          <li key={kategori.id}>
            <Link
              href={`/category/${kategori.slug}`}
              className="inline-block rounded-md border border-kenar px-4 py-2 text-sm hover:bg-yuzey-vurgulu"
            >
              {kategori.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
