import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Camera, Ruler, Sparkles } from 'lucide-react';
import { isTryOnSupported } from '@vt/config/constants';
import type { CategoryNodeWire, ProductListItemWire, ProductListPayloadWire } from '@vt/contracts';
import { list } from '@/lib/api/core';
import { serverFetch } from '@/lib/api/server';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { koleksiyonBul, type Koleksiyon } from '../koleksiyonlar';
import { UrunIzgarasi } from '@/components/urun/urun-izgarasi';

/**
 * İNİŞ SAYFASI — DÖRDÜ DE BU DOSYADAN ÇIKAR.
 *
 * Kalıp `(magaza)/products/page.tsx`ten alındı: Sunucu Bileşeni, veri DOĞRUDAN
 * API'den, zarf `list()` ile açılıyor, para `<Fiyat>` ile gösteriliyor.
 * Farkı, listeleme sayfası değil bir PAZARLAMA sayfası olması: ürün rayı
 * boş dönse bile sayfanın geri kalanı (vaat, kapsam, SSS) ayakta kalmalı,
 * çünkü bu sayfanın işi aramadan gelen ziyaretçiye ne yaptığımızı anlatmak.
 */

/**
 * ═══ YUMUŞAK 404 — İKİ YANLIŞ TEŞHİS VE GERÇEK SEBEP ═══
 *
 * ÖLÇÜLDÜ (`next build && next start`; ⚠️ `next dev` DEĞİL — dev'de bu adres
 * 404 dönüyordu ve bu fark bir ölçüm tablosunun tamamını geçersiz kıldı):
 *
 *     /collection/canta 200   /collection/yok-boyle 200   /collection/xyz 200
 *
 * 1) Burada `export const dynamic = 'force-dynamic'` VARDI ve
 *    `generateStaticParams`ı devre dışı bırakıyordu. Kaldırıldı — ama TEK
 *    BAŞINA HİÇBİR ŞEYİ DEĞİŞTİRMEDİ, yeniden ölçüldü: hâlâ 200.
 *
 * 2) Sebep: sayfa `serverFetch(..., { forwardClientIp: true })` ile
 *    `headers()` okuyor. Bu tek başına rotayı DİNAMİK yapıyor (`next build`
 *    tablosunda `ƒ`), ve dinamik bir rotada `dynamicParams = false`
 *    yönlendirici düzeyinde bir kapı KURMUYOR. Yani bayrak `legal/[belge]`
 *    gibi gerçekten statik üretilen rotalarda çalışır, burada çalışmaz.
 *    Bu yüzden `dynamicParams` da kaldırıldı: çalışmadığı ölçülmüş bir kapıyı
 *    yerinde bırakmak, bu deponun üç kez yaşadığı "yazıldı, derlendi, hiçbir
 *    şey yapmıyor" deseninin ta kendisi olurdu.
 *
 * 3) Durum kodunu GERÇEKTEN belirleyen şey Suspense sınırıydı: sayfa çalışıp
 *    `notFound()` çağırıyor, ama çağrı `koleksiyon/loading.tsx` +
 *    `koleksiyon/[koleksiyon]/loading.tsx` sınırının ARDINDA kaldığı için Next
 *    kabuğu 200 ile çoktan gönderilmiş oluyor ve kod artık değiştirilemiyor.
 *    İki `loading.tsx` SİLİNDİ; AGENTS.md §8'in asıl kuralı budur:
 *    **`notFound()` çağıran bir rotanın üstünde `loading.tsx` olmaz.**
 *
 * ⚠️ Bedeli dürüstçe: bu bölümde artık iskelet yok. İskelet geri isteniyorsa
 *    şartı `headers()` okumayı bırakmaktır — ama o da `/products` ucunda
 *    (`scope:'ip'`, 60/dk) tüm ziyaretçileri API'de tek kovaya düşürür. İki
 *    seçenek arasında SEO tercih edildi: bu sayfaların TEK İŞİ aramadan gelen
 *    ziyaretçi ve 200 dönen bir "bulunamadı" sayfası indekslenir.
 *
 * ═══ `generateStaticParams` KALDIRILDI — derlemeyi API'ye bağlıyordu ═══
 *
 * "Üretim için değil, dört slug'ın bir yerde SAYILMASI için" diye duruyordu.
 * Amaç zararsız görünüyordu, BEDELİ ölçülmemişti: fonksiyon var olduğu sürece
 * Next dört slug'ı DERLEME ANINDA ön-render etmeye çalışır ve her biri
 * `/products` ucuna istek atar. Yani `next build` AYAKTA BİR API İSTİYORDU:
 *   · CI'da API yok  → derleme ECONNREFUSED ile düştü (arıza böyle görüldü),
 *   · sunucuda API var → derleme GEÇER ama ürünler o anki hâliyle GÖMÜLÜRDÜ
 *     ve kimse bir hata görmezdi. Sessiz olan bu ikincisi.
 *
 * Sayma amacı zaten karşılanıyordu: tek kaynak `koleksiyonlar.ts` →
 * `KOLEKSIYON_SLUGLARI`. Bu fonksiyon o listenin kopyası değil TÜKETİCİSİYDİ;
 * silinmesi ikinci bir liste doğurmuyor.
 *
 * ⚠️ Sayfa `headers()` okuduğu için (yukarıdaki 2. madde) HER HÂLÜKÂRDA
 *    dinamikti — yani bu fonksiyonun üretimde hiçbir kazancı yoktu, yalnızca
 *    derlemeye bir dış bağımlılık ekliyordu.
 */
export const dynamic = 'force-dynamic';

type Params = Promise<{ koleksiyon: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { koleksiyon } = await params;
  const kayit = koleksiyonBul(koleksiyon);
  // Bilinmeyen slug: metadata boş döner, sayfanın kendisi `notFound()` çağırır.
  if (!kayit) return {};

  const yol = `/collection/${kayit.slug}`;

  return {
    title: kayit.baslik,
    description: kayit.aciklama,
    // `metadataBase` kök düzende; göreli canonical oradan tamamlanır.
    alternates: { canonical: yol },
    openGraph: {
      type: 'website',
      url: yol,
      title: `${kayit.baslik} · Virtual Textile`,
      description: kayit.aciklama,
    },
  };
}

/**
 * Yapılandırılmış kategori adaylarından GERÇEKTEN var olanı seçer.
 *
 * ⚠️ ÖLÇÜLDÜ: `GET /v1/products?category=olmayan-slug` hata döndürmez —
 *    HTTP 200 + `total: 0` döner. Yani taksonomi değişip slug kaydığında sayfa
 *    kırılmaz, SESSİZCE boşalır ve bunu kimse fark etmez. Bu deponun üç
 *    klasik hatasının (yazıldı, derlendi, ama hiçbir yere bağlanmadı) aynı
 *    deseni. Bu yüzden slug göndermeden önce kategori ağacında doğrulanır;
 *    hiçbiri yoksa filtre GÖNDERİLMEZ ve sayfa arama terimiyle çalışır.
 */
async function kategoriSlugCoz(adaylar: readonly string[]): Promise<string | undefined> {
  if (adaylar.length === 0) return undefined;

  /**
   * ⚠️ Kategori ağacı `data` içinde ÇIPLAK DİZİdir (sayfalı değil), bu yüzden
   *    `list()` değil doğrudan `data` okunuyor. `forwardClientIp` de yok:
   *    `/categories` ucunda hız limiti tanımlı değil, istemci IP'si taşımak
   *    yalnızca rotayı gereksiz yere dinamikleştirirdi.
   */
  const sonuc = await serverFetch<CategoryNodeWire[], '/categories'>('/categories', {
    next: { revalidate: 3600 },
  });

  const mevcut = new Set<string>();
  const gez = (dugum: CategoryNodeWire): void => {
    mevcut.add(dugum.slug);
    for (const cocuk of dugum.children) gez(cocuk);
  };
  for (const kok of sonuc.data) gez(kok);

  return adaylar.find((slug) => mevcut.has(slug));
}

export default async function KoleksiyonPage({ params }: { params: Params }) {
  const { koleksiyon } = await params;
  const kayit = koleksiyonBul(koleksiyon);
  if (!kayit) notFound();

  const kategoriSlug = await kategoriSlugCoz(kayit.kategoriAdaylari);

  const sonuc = await serverFetch<ProductListPayloadWire, '/products'>('/products', {
    query: {
      q: kayit.aramaTerimi,
      category: kategoriSlug,
      sort: 'relevance',
      limit: 8,
    },
    forwardClientIp: true,
  });

  const { items, total } = list<ProductListItemWire>(sonuc);

  // Aynı filtre, tam liste sayfasının kendi parametre adlarıyla.
  const tumunuGorAdresi = `/products?q=${encodeURIComponent(kayit.aramaTerimi)}${
    kategoriSlug ? `&kategori=${encodeURIComponent(kategoriSlug)}` : ''
  }`;

  const denemeAcik = isTryOnSupported(kayit.tryOnKategorisi);

  return (
    <div className="flex flex-col gap-16 py-8">
      <Giris kayit={kayit} denemeAcik={denemeAcik} adres={tumunuGorAdresi} />

      <UrunRayi
        kayit={kayit}
        items={items}
        total={total}
        adres={tumunuGorAdresi}
        kategoriSlug={kategoriSlug}
      />

      <NasilCalisir kayit={kayit} denemeAcik={denemeAcik} />

      <SikSorulanlar kayit={kayit} />
    </div>
  );
}

function Giris({
  kayit,
  denemeAcik,
  adres,
}: {
  kayit: Koleksiyon;
  denemeAcik: boolean;
  adres: string;
}) {
  return (
    <section className="flex max-w-2xl flex-col items-start gap-6">
      {denemeAcik ? (
        <Badge durum="notr">Bu koleksiyonda sanal deneme açık</Badge>
      ) : (
        /**
         * ⚠️ Bugün dört koleksiyonun dördünde de bu dal ÇALIŞMIYOR (hepsi
         *    desteklenen kategoriler). Yine de duruyor: yarın "çanta" iniş
         *    sayfası eklendiğinde sayfa, veremeyeceği sözü kendiliğinden
         *    vermeyi bırakır. Kapı burada olmasaydı vaat metni elle
         *    silinmek zorunda kalırdı — ve unutulurdu.
         */
        <Badge durum="uyari">Bu kategoride sanal deneme henüz açık değil</Badge>
      )}

      <h1 className="text-3xl font-semibold tracking-tight">{kayit.h1}</h1>
      <p className="text-metin-soluk">{kayit.girisMetni}</p>

      <Button asChild size="lg">
        <Link href={adres}>Koleksiyonu gör</Link>
      </Button>
    </section>
  );
}

function UrunRayi({
  kayit,
  items,
  total,
  adres,
  kategoriSlug,
}: {
  kayit: Koleksiyon;
  items: ProductListItemWire[];
  total: number | null;
  adres: string;
  kategoriSlug: string | undefined;
}) {
  return (
    <section>
      <header className="mb-8 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight">{kayit.h1} ürünleri</h2>
        {total !== null && total > 0 ? (
          <Link href={adres} className="rakam text-sm text-vurgu hover:underline">
            {total} ürünün tümü
          </Link>
        ) : null}
      </header>

      {items.length === 0 ? (
        /**
         * ⚠️ Boş durum NE OLDUĞUNU söyler. "Ürün bulunamadı" demek burada
         *    yetmez: iniş sayfası hep aynı sabit filtreyle çalıştığı için boşluk
         *    ziyaretçinin yaptığı bir seçimden değil, katalogda o terimle eşleşen
         *    ürün olmamasından gelir. Hangi filtrenin uygulandığını yazmak, bunu
         *    gören ilk kişinin (çoğu zaman biziz) doğru yere bakmasını sağlar.
         */
        <div className="rounded-md border border-kenar bg-yuzey p-6 text-sm">
          <p className="text-metin">
            Bu koleksiyonda şu anda yayında ürün yok. Katalogda &laquo;{kayit.aramaTerimi}&raquo;
            {kategoriSlug ? ` terimi ve ${kategoriSlug} kategorisi` : ' terimi'} ile eşleşen yayında
            ürün bulunamadı.
          </p>
          <Link href="/products" className="mt-2 inline-block text-vurgu hover:underline">
            Tüm ürünlere göz atın
          </Link>
        </div>
      ) : (
        <UrunIzgarasi urunler={items} />
      )}
    </section>
  );
}

function NasilCalisir({ kayit, denemeAcik }: { kayit: Koleksiyon; denemeAcik: boolean }) {
  const adimlar = [
    {
      Ikon: Camera,
      baslik: 'Fotoğrafınızı yükleyin',
      metin:
        'Önden çekilmiş, gövdesi görünen tek kişilik bir fotoğraf yeterli. Fotoğrafın ne kadar saklanacağına siz karar verirsiniz.',
    },
    {
      Ikon: Sparkles,
      baslik: 'Ürünü üzerinizde görün',
      metin:
        'Deneme arka planda çalışır, ekranı bekletmeniz gerekmez. Sonuç görselinin üzerinde yapay zekâ uyarısı bulunur.',
    },
    {
      Ikon: Ruler,
      baslik: 'Beden uyumunu ayrı okuyun',
      metin:
        'Görsel benzerliği ile beden uyumu AYRI iki sayıdır. Kıyafetin görselde iyi durması fiziksel olarak uyacağı anlamına gelmez.',
    },
  ];

  return (
    <section>
      <h2 className="mb-8 text-xl font-semibold tracking-tight">Nasıl çalışır</h2>

      <ol className="grid gap-8 md:grid-cols-3">
        {adimlar.map(({ Ikon, baslik, metin }) => (
          <li key={baslik} className="flex flex-col gap-2">
            {/* ⚠️ İkon RENKSİZ ve metinden bir ton soluk — renk yalnızca durum taşır. */}
            <Ikon className="size-5 text-ikon" />
            <h3 className="text-sm font-semibold">{baslik}</h3>
            <p className="text-sm text-metin-soluk">{metin}</p>
          </li>
        ))}
      </ol>

      <div className="mt-10 rounded-md border border-kenar bg-yuzey p-6">
        <h3 className="text-sm font-semibold">{kayit.h1} denemede neyi değiştiriyor</h3>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-metin-soluk">
          {kayit.denemeGerekcesi.map((madde) => (
            <li key={madde}>{madde}</li>
          ))}
        </ul>

        {/*
          ⚠️ DÜRÜSTLÜK NOTU — sayfadan silinmez. Deneme görseli üretilmiş bir
             görüntüdür; buna rağmen "gerçek gibi" sunulursa ilk yanlış sonuçta
             kaybedilen şey ürünün kendisi değil, güvendir.
        */}
        <p className="mt-4 text-xs text-metin-soluk">
          Deneme görselleri yapay zekâ ile üretilir; kumaşın dökümü ve ürünün gerçek kalıbı
          farklılık gösterebilir. Görsel bir satın alma tavsiyesi değil, bir ön izlemedir.
          {denemeAcik ? '' : ' Bu kategoride deneme bugün kapalıdır; ürünler satılmaya devam eder.'}
        </p>
      </div>
    </section>
  );
}

function SikSorulanlar({ kayit }: { kayit: Koleksiyon }) {
  return (
    <section>
      <h2 className="mb-8 text-xl font-semibold tracking-tight">Sık sorulanlar</h2>

      <dl className="flex max-w-2xl flex-col divide-y divide-kenar border-y border-kenar">
        {kayit.sss.map(({ soru, cevap }) => (
          <div key={soru} className="py-5">
            <dt className="text-sm font-semibold">{soru}</dt>
            <dd className="mt-2 text-sm text-metin-soluk">{cevap}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
