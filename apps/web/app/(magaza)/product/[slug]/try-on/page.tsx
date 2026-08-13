import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type {
  CategoryNodeWire,
  OutfitLayerCategoryWire,
  ProductDetailWire,
  ProductListItemWire,
  ProductListPayloadWire,
} from '@vt/contracts';
import { isTryOnSupported, type TryOnCategoryName } from '@vt/config/constants';
import { list } from '@/lib/api/core';
import { serverFetch } from '@/lib/api/server';
import { currentUser } from '@/lib/session/guard';
import { Button } from '@/components/ui/button';
import { denenebilir, urunGetir } from '../../_bilesenler/urun-getir';
import { parcaKur, type Parca } from '../../_bilesenler/parca';
import { DenemeEkrani } from '../../_bilesenler/deneme-ekrani';

/**
 * ═══════════════════════ SANAL DENEME EKRANI (veri) ═════════════════════════
 *
 * Sunucu Bileşeni yalnızca VERİYİ toplar; akışın tamamı (fotoğraf, rıza,
 * üretim, yoklama) istemcide `use-deneme.ts` içindedir.
 *
 * ⚠️ BU ROTAYA DENENEMEYEN BİR ÜRÜNLE GELİNEMEZ. Ürün detayında düğme hiç
 *    çıkmıyor ama adres elle yazılabilir; kapı BURADA DA kapanır ve 404 döner.
 *    Yalnız düğmeyi gizleyip rotayı açık bırakmak, "gizlemek = korumak"
 *    yanılgısıdır.
 */

type Yol = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ varyant?: string }>;
};

export async function generateMetadata({ params }: Yol): Promise<Metadata> {
  const { slug } = await params;
  const urun = await urunGetir(slug);
  return { title: `${urun.title} — Üzerimde Dene` };
}

export const dynamic = 'force-dynamic';

/** Karusel adaylarının çekileceği azami ürün — her biri AYRI bir detay isteği. */
const AZAMI_ADAY = 4;

function duzlestir(dugumler: readonly CategoryNodeWire[]): CategoryNodeWire[] {
  return dugumler.flatMap((dugum) => [dugum, ...duzlestir(dugum.children)]);
}

/**
 * Ürünün kategorisini içeren KÖK DALI bulur.
 *
 * ⚠️ Aday parçalar aynı kökten seçilir (kadın → kadın alt giyim). Kök gözetmeyen
 *    bir seçim, kadın gömleğinin altına çocuk pantolonu önerebilirdi; ayrıca
 *    kataloğa sonradan giren ilgisiz ağaçlar (test/ithalat kalıntısı) karuseli
 *    boş ürünlerle doldururdu.
 */
function kokDali(
  agac: readonly CategoryNodeWire[],
  kategoriSlug: string,
): CategoryNodeWire[] | null {
  for (const kok of agac) {
    const dal = duzlestir([kok]);
    if (dal.some((dugum) => dugum.slug === kategoriSlug)) return dal;
  }
  return null;
}

/**
 * KOMBİN ADAYLARI — karuselin içeriği.
 *
 * ⚠️ BEDELİ DÜRÜSTÇE: burada `1 + 1 + AZAMI_ADAY` istek var. Sebebi ürün LİSTE
 *    ucunun `variantId` DÖNDÜRMEMESİ; deneme varyant bazlı çalıştığı için her
 *    aday için detay çekmek zorundayız. Kalıcı çözüm sunucuda: liste ucuna
 *    "varsayılan varyant" alanı eklenirse buradaki N istek TEK isteğe iner.
 *
 * ⚠️ ÇAKIŞMA BURADA ELENMEZ (elbise + gömlek gibi). Kural sunucudaki katman
 *    tablosunda yaşıyor ve `@vt/adapters` tarayıcıya/vitrine giremez; kopyası
 *    ayrışırdı. Sunucu `OUTFIT_LAYER_CONFLICT` döndürür, karusel işaretler.
 */
async function kombinAdaylari(urun: ProductDetailWire): Promise<Parca[]> {
  const { data } = await serverFetch<CategoryNodeWire[], '/categories'>('/categories');
  const agac = Array.isArray(data) ? data : [];

  const dal = kokDali(agac, urun.category.slug) ?? duzlestir(agac);

  const tamamlayici = dal.find(
    (dugum) =>
      dugum.slug !== urun.category.slug &&
      dugum.tryOnCategory !== urun.category.tryOnCategory &&
      isTryOnSupported(dugum.tryOnCategory as TryOnCategoryName | null),
  );
  if (!tamamlayici) return [];

  // ⚠️ `/products` `@RateLimit({scope:'ip'})` taşıyor — IP taşınmazsa TÜM
  //    ziyaretçiler API'de tek kovaya düşer ve site 60 istek/dk'da 429 verir.
  const liste = await serverFetch<ProductListPayloadWire, '/products'>('/products', {
    query: { category: tamamlayici.slug, limit: AZAMI_ADAY },
    forwardClientIp: true,
  });

  const adaySluglari = list<ProductListItemWire>(liste)
    .items.filter((aday) => aday.slug !== urun.slug && aday.tryOnable)
    .slice(0, AZAMI_ADAY)
    .map((aday) => aday.slug);

  const detaylar = await Promise.all(adaySluglari.map((slug) => urunGetir(slug)));

  return detaylar.flatMap((aday) => {
    if (!denenebilir(aday)) return [];
    const varyant = aday.variants.find((secenek) => secenek.available);
    if (!varyant) return [];

    return [parcaKur(aday, varyant, aday.category.tryOnCategory as OutfitLayerCategoryWire)];
  });
}

export default async function DenemePage({ params, searchParams }: Yol) {
  const [{ slug }, { varyant: istenenVaryant }] = await Promise.all([params, searchParams]);
  const urun = await urunGetir(slug);

  if (!denenebilir(urun)) notFound();

  /*
   * ⚠️ SANAL DENEME GİRİŞ İSTER ve bu bir ürün tercihi değil: rıza kaydı
   *    kullanıcıya bağlı (`ConsentRecord.userId`), misafirin rızası
   *    kanıtlanamaz. Kullanıcıyı önce ekrana alıp sonra ilk düğmede 401'e
   *    çarptırmak yerine durum baştan söylenir.
   */
  const kullanici = await currentUser();

  if (!kullanici) {
    return (
      <section className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-lg font-semibold tracking-tight">{urun.title}</h1>
        <p className="mt-3 text-sm text-metin-soluk">
          Sanal deneme, fotoğrafınızın işlenmesine izin vermenizi gerektiriyor ve bu izin hesabınıza
          kaydediliyor. Devam etmek için giriş yapın.
        </p>
        <Button asChild className="mt-6">
          <Link href={`/login?next=/product/${urun.slug}/try-on`}>Giriş yap</Link>
        </Button>
        <p className="mt-4 text-sm">
          <Link href={`/product/${urun.slug}`} className="text-vurgu hover:underline">
            Ürüne geri dön
          </Link>
        </p>
      </section>
    );
  }

  // İstenen varyant ürüne ait değilse sessizce ilk satılabilir varyanta düşülür:
  // elle yazılmış bir adres yüzünden ekranın çökmesi kullanıcının sorunu değil.
  const secili =
    urun.variants.find((aday) => aday.id === istenenVaryant && aday.available) ??
    urun.variants.find((aday) => aday.available) ??
    urun.variants[0];

  if (!secili) notFound();

  const taban = parcaKur(urun, secili, urun.category.tryOnCategory as OutfitLayerCategoryWire);
  const adaylar = await kombinAdaylari(urun);

  return <DenemeEkrani taban={taban} adaylar={adaylar} magazaAdi={urun.seller.displayName} />;
}
