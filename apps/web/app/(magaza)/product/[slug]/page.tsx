import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { currentUser } from '@/lib/session/guard';
import { denenebilir, urunGetir } from '../_bilesenler/urun-getir';
import { UrunGalerisi } from '../_bilesenler/urun-galerisi';
import { UrunEylemleri } from '../_bilesenler/urun-eylemleri';

/**
 * ═══════════════════════════ ÜRÜN DETAY ═════════════════════════════════════
 *
 * ⚠️ ÜÇ BLOK, FAZLASI DEĞİL (design-system.md → ekran başına öğe bütçesi):
 *      1. görsel bloğu  — galeri
 *      2. eylem bloğu   — varyant, fiyat, iki düğme, beden önerisi
 *      3. bilgi bloğu   — açıklama, etiketler, satıcı
 *    Bütçe aşılıyorsa yeni bir ekran gerekiyordur, sıkıştırma değil. Sanal
 *    deneme bu yüzden AYRI bir ekrandır (`/product/[slug]/try-on`): görselin ekranın
 *    çoğunu kaplaması gerekiyor ve burada kaplayamaz.
 */

type Yol = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Yol): Promise<Metadata> {
  const { slug } = await params;
  const urun = await urunGetir(slug);

  return {
    title: urun.title,
    description: urun.description.slice(0, 160),
  };
}

/**
 * ⚠️ `force-dynamic`: `currentUser()` çerez okuyor ve rotayı zaten dinamik
 *    yapıyor. Açıkça yazmak, bir gün birinin "neden statik değil" diye
 *    saatlerce aramasını önler. Kişiselleşen tek şey beden önerisinin
 *    açılışta sorulup sorulmadığıdır; ürün verisi herkes için aynıdır.
 */
export const dynamic = 'force-dynamic';

export default async function UrunDetayPage({ params }: Yol) {
  const { slug } = await params;
  const [urun, kullanici] = await Promise.all([urunGetir(slug), currentUser()]);

  const denemeAcik = denenebilir(urun);

  return (
    <article className="flex flex-col gap-12">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-12">
        {/* ── 1. GÖRSEL BLOĞU ────────────────────────────────────────── */}
        <UrunGalerisi gorseller={urun.images} baslik={urun.title} />

        {/* ── 2. EYLEM BLOĞU ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-6">
          <header>
            {/* Çok satıcılı gösterim: ürün adı birincil, mağaza adı ikincil. */}
            <h1 className="text-xl font-semibold tracking-tight">{urun.title}</h1>
            {/*
              ⚠️ Mağaza adına BAĞLANTI YOK: `/magaza/[slug]` ekranı henüz
                 yazılmadı. Olmayan bir sayfaya götüren bağlantı, basınca hata
                 veren düğmenin aynısıdır. Ad görünür ama ürünün önüne geçmez.
            */}
            <p className="mt-1 text-sm text-metin-soluk">{urun.brandName}</p>

            {/* Satıcı tatilde: bu bir DURUM, rengi bilgi taşıyor. */}
            {urun.seller.vacationMode ? (
              <Badge durum="uyari" className="mt-3">
                Satıcı tatil modunda
              </Badge>
            ) : null}
          </header>

          <UrunEylemleri
            varyantlar={urun.variants}
            sizeChart={urun.sizeChart}
            girisYapildi={kullanici !== null}
            /*
              ⚠️ Kapı KAPALIYSA `null` gider ve düğme HİÇ oluşmaz. Devre dışı
                 bir düğme göndermek, kullanıcıya var olmayan bir vaadi
                 göstermek olurdu (docs/tryon-kategori-destegi.md).
            */
            denemeYolu={denemeAcik ? `/product/${urun.slug}/try-on` : null}
          />
        </div>
      </div>

      {/* ── 3. BİLGİ BLOĞU ───────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-8 border-t border-kenar pt-8 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold">Ürün açıklaması</h2>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-metin-soluk">
            {urun.description}
          </p>
        </div>

        <dl className="flex flex-col gap-2 text-sm">
          {/*
            ⚠️ Yapay zekâ etiketleri YALNIZCA satıcı onayladıysa gösterilir.
               `aiTagsApproved` false iken göstermek, doğrulanmamış bir makine
               çıktısını ürün bilgisi diye sunmak olurdu.
          */}
          {urun.aiTagsApproved && urun.aiTags
            ? Object.entries(urun.aiTags).map(([anahtar, deger]) => (
                <div
                  key={anahtar}
                  className="flex justify-between gap-4 border-b border-kenar/60 py-1.5"
                >
                  <dt className="text-metin-soluk">{anahtar}</dt>
                  <dd className="text-metin">{deger}</dd>
                </div>
              ))
            : null}

          <div className="flex justify-between gap-4 border-b border-kenar/60 py-1.5">
            <dt className="text-metin-soluk">Satıcı</dt>
            <dd className="text-metin">{urun.seller.displayName}</dd>
          </div>

          {urun.collection ? (
            <div className="flex justify-between gap-4 border-b border-kenar/60 py-1.5">
              <dt className="text-metin-soluk">Koleksiyon</dt>
              <dd className="text-metin">{urun.collection}</dd>
            </div>
          ) : null}
        </dl>
      </section>
    </article>
  );
}
