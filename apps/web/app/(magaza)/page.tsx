import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ProductListItemWire, ProductListPayloadWire } from '@vt/contracts';
import { list } from '@/lib/api/core';
import { serverFetch } from '@/lib/api/server';
import { mediaUrl } from '@/lib/media';
import { UrunGorseli } from '@/components/urun/urun-gorseli';
import { Button } from '@/components/ui/button';
import { Fiyat } from '@/components/fiyat/fiyat';
import { AramaKutusu } from './products/_liste/arama-kutusu';
import { UrunKarti } from '@/components/urun/urun-karti';
import { Ray, RayKarti } from '@/components/vitrin/ray';
import { kategoriAgaci, vitrinKategorileri } from '@/lib/kategori';
import { KOLEKSIYON_LISTESI } from './collection/koleksiyonlar';

/**
 * VİTRİN — YEDİ BÖLÜM.
 *
 *   1. Vitrin görseli   — ekranın çoğu, ayrıştırıcının vaadi
 *   2. Nasıl çalışır    — üç adım
 *   3. Öne çıkanlar     — sekiz ürün
 *   4. Koleksiyonlar    — dört iniş sayfası
 *   5. Kategoriler      — giriş kapıları
 *   6. Mağazalar        — çok satıcılı olduğumuzun tek görünür kanıtı
 *   7. Stil danışmanı   — AI özelliğine giriş
 *
 * ⚠️ BURADA BİR DÖNEM "ÜÇ BÖLÜM, DAHA FAZLASI DEĞİL" YAZIYORDU ve o kural
 *    YANLIŞTI. Gerekçesi `design-system.md`nin öğe bütçesiydi ve o bütçe
 *    SSENSE'e bakılarak yazılmıştı. Kaçırılan şey şu: SSENSE'in ziyaretçisi
 *    markayı ZATEN TANIYOR ve oradaki tek iş ürünü göstermektir. Bu ana
 *    sayfanın iki işi daha var — kendini anlatmak ve SANAL DENEMEYİ göstermek.
 *
 *    Ölçüldü: sayfa "üzerinizde görün" diyor ama göstermiyor; ve yazılmış
 *    özelliklerin hiçbiri buradan görünmüyordu —
 *      · dört koleksiyon iniş sayfası  → ana sayfada YOK
 *      · stil danışmanı                → yalnızca menüde
 *      · çok satıcılı yapı             → hiçbir yerde
 *    Yani sorun "fazla sade" değil, YAPILAN İŞİN GÖRÜNMEMESİYDİ.
 *
 * ⚠️ SADELİK KURALI DURUYOR, YALNIZCA YERİ DEĞİŞTİ. Bölüm sayısı arttı ama
 *    her bölüm hâlâ akromatik, kenarlıksız, süssüz. "Az bölüm" ile "az süs"
 *    aynı şey değil; bu depoda karıştırılmıştı. Bir bölüm eklemek için şart:
 *    VAR OLAN bir yeteneğe kapı açıyor olmalı. Pazarlama dolgusu ("neden biz",
 *    "bültene abone ol") hâlâ eklenmez.
 */
export const dynamic = 'force-dynamic';

/** 1 vitrin + 8 ızgara. Tek istek; ikisi için iki çağrı atmak boşuna. */
const VITRIN_URUN_SAYISI = 9;
const VITRIN_KATEGORI_SAYISI = 8;

export default async function VitrinPage(): Promise<React.ReactElement> {
  const t = await getTranslations('vitrin');
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

      <NasilCalisir />

      {izgara.length > 0 ? (
        <Ray baslik={t('oneCikanlar')} tumuAdres="/products" tumuEtiket={t('tumunuGor')}>
          {izgara.map((urun) => (
            <RayKarti key={urun.id}>
              <UrunKarti urun={urun} />
            </RayKarti>
          ))}
        </Ray>
      ) : null}

      <Ozellikler />

      <Koleksiyonlar />

      <Kategoriler agac={agac} />

      <Magazalar urunler={items} />

      <Danisman />
    </div>
  );
}

/**
 * ÖZELLİKLER — platformun BUGÜN yapabildikleri.
 *
 * ⚠️ HER MADDE ÇALIŞAN BİR ŞEYE İŞARET EDER. Burası bir vaat listesi değil;
 *    yazılmamış bir özelliği buraya koymak, kullanıcıyı olmayan bir düğmeyi
 *    aramaya göndermektir. Yol haritasındaki işler (favori, yorum, adres
 *    defteri) BİLEREK yok — henüz ucu bile yazılmadı.
 *
 * ⚠️ Ayakkabı, takı ve çanta denemesi de yok: sağlayıcıda model yok
 *    (`docs/tryon-kategori-destegi.md`, ölçülerek yazıldı). "Yakında" demek
 *    bile taahhüttür; ölçülmemiş bir tarihi buraya yazmayız.
 */
async function Ozellikler(): Promise<React.ReactElement> {
  const t = await getTranslations('vitrin');

  // ⚠️ Anahtarlar ÇİFTLER hâlinde: başlık + metin. Biri sözlükte yoksa
  //    derleme kırılır (en.ts `satisfies typeof tr`), yani yarım çeviri
  //    ekrana ham anahtar olarak DÜŞEMEZ.
  const anahtarlar = ['Deneme', 'Kombin', 'Beden', 'Danisman', 'Gardirop', 'Arama'] as const;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold tracking-tight">{t('ozellikler')}</h2>
      <p className="mb-6 max-w-xl text-sm text-metin-soluk">{t('ozelliklerNot')}</p>

      <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {anahtarlar.map((anahtar) => (
          <li key={anahtar} className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold tracking-tight">{t(`ozellik${anahtar}`)}</h3>
            <p className="text-sm leading-relaxed text-metin-soluk">
              {t(`ozellik${anahtar}Metin`)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * NASIL ÇALIŞIR — üç adım.
 *
 * ⚠️ Ana sayfa sanal denemeyi ANLATIYOR ama akışın nasıl işlediğini
 *    söylemiyordu. Kullanıcı "üzerinizde görün" cümlesini okuyup ürün
 *    sayfasına gidiyor ve orada fotoğraf isteyen bir ekranla karşılaşıyordu.
 *    Beklenti burada kurulmazsa fotoğraf isteği sürpriz olur; özel nitelikli
 *    veri isteyen bir akışta sürpriz, terk demektir.
 *
 * ⚠️ Numaralar RENKSİZ. `design-system.md`: renk yalnızca DURUM taşır; adım
 *    numarası bir durum değil, sıradır.
 */
async function NasilCalisir(): Promise<React.ReactElement> {
  const t = await getTranslations('vitrin');
  const adimlar = [1, 2, 3] as const;

  return (
    <section>
      <h2 className="mb-6 text-sm font-semibold tracking-tight">{t('nasilCalisir')}</h2>
      <ol className="grid gap-8 sm:grid-cols-3">
        {adimlar.map((sira) => (
          <li key={sira} className="flex flex-col gap-2">
            <span className="text-xs tabular-nums text-metin-soluk">0{sira}</span>
            <h3 className="text-sm font-semibold tracking-tight">{t(`adim${sira}Baslik`)}</h3>
            <p className="text-sm leading-relaxed text-metin-soluk">{t(`adim${sira}Metin`)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * KOLEKSİYONLAR — dört iniş sayfasının ana sayfadaki kapısı.
 *
 * ⚠️ Bu sayfalar YAZILMIŞTI ve ana sayfadan hiçbir bağlantı verilmiyordu.
 *    Tek giriş yolu doğrudan adres yazmak ya da aramadan gelmekti — yani
 *    site içinde gezinen bir kullanıcı için YOKTULAR. Bu depoda aynı hata
 *    daha önce satıcı menüsünde yaşandı: altı ekran yazılmış, menüde bağlantı
 *    olmadığı için hiçbirine ulaşılamıyordu.
 */
async function Koleksiyonlar(): Promise<React.ReactElement> {
  const t = await getTranslations('vitrin');
  return (
    <Ray baslik={t('koleksiyonlar')} aciklama={t('koleksiyonlarNot')} tumuAdres="/collection">
      {KOLEKSIYON_LISTESI.map((koleksiyon) => (
        <RayKarti key={koleksiyon.slug}>
          <Link
            href={`/collection/${koleksiyon.slug}`}
            className="flex h-full flex-col gap-2 rounded-lg border border-kenar p-4 transition-colors hover:bg-yuzey-vurgulu"
          >
            <span className="text-sm font-semibold tracking-tight">{koleksiyon.h1}</span>
            <span className="line-clamp-3 text-sm text-metin-soluk">{koleksiyon.girisMetni}</span>
          </Link>
        </RayKarti>
      ))}
    </Ray>
  );
}

/**
 * MAĞAZALAR — çok satıcılı olduğumuzun ana sayfadaki TEK kanıtı.
 *
 * ⚠️ Ayrıştırıcımız "bir mağazanın ceketi + ikincinin pantolonu, tek sepette"
 *    ama ana sayfada birden fazla mağaza olduğuna dair hiçbir işaret yoktu.
 *
 * ⚠️ AYRI BİR UÇ YOK ve İSTENMEDİ: mağaza adları zaten çekilmiş ürün
 *    listesinden türetiliyor. İkinci bir istek atmak, yalnızca bir şerit için
 *    ana sayfanın gecikmesini artırırdı. Bedeli dürüstçe: yalnızca vitrindeki
 *    dokuz üründe geçen mağazalar görünür — tam liste değil, bir örneklem.
 */
async function Magazalar({
  urunler,
}: {
  urunler: ProductListItemWire[];
}): Promise<React.ReactElement | null> {
  const t = await getTranslations('vitrin');
  /**
   * ⚠️ `seller` alanı liste tipinde YOK, yalnızca ürün DETAY tipinde var
   *    (ölçüldü: `ProductListItemWire` → `brandName` + `storeSlug`). Detay
   *    tipini kullanmak dokuz ürün için dokuz ek istek demekti.
   */
  const magazalar = new Map<string, string>();
  for (const urun of urunler) {
    if (urun.storeSlug && !magazalar.has(urun.storeSlug)) {
      magazalar.set(urun.storeSlug, urun.brandName);
    }
  }

  // Tek mağaza varsa "çok satıcılı" iddiası kurulamaz; şerit gösterilmez.
  if (magazalar.size < 2) return null;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold tracking-tight">{t('magazalar')}</h2>
      <p className="mb-6 max-w-xl text-sm text-metin-soluk">{t('magazalarNot')}</p>

      <ul className="flex flex-wrap gap-2">
        {[...magazalar.entries()].map(([slug, ad]) => (
          <li key={slug}>
            {/* ⚠️ Filtre parametresi `marka` — liste sayfasının kendi sözlüğü
                (bkz. products/_liste/liste-sorgusu.ts). `magaza` yazmak sessizce
                filtresiz bir liste açardı. */}
            <Link
              href={`/products?marka=${encodeURIComponent(ad)}`}
              className="inline-block rounded-md border border-kenar px-4 py-2 text-sm hover:bg-yuzey-vurgulu"
            >
              {ad}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * STİL DANIŞMANI — yazılmış bir AI ekranına ana sayfadan giriş.
 *
 * ⚠️ Danışman yalnızca üst menüde duruyordu. Menü ikonu, ne yaptığını
 *    bilmeyen bir kullanıcıya hiçbir şey anlatmaz; bu şerit onun karşılığı.
 */
async function Danisman(): Promise<React.ReactElement> {
  const t = await getTranslations('vitrin');
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-kenar p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight">
          Ne giyeceğinize karar veremiyorsanız
        </h2>
        <p className="max-w-xl text-sm text-metin-soluk">{t('danismanMetin')}</p>
      </div>
      <Button asChild variant="ikincil">
        <Link href="/stylist">{t('danismanDugme')}</Link>
      </Button>
    </section>
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
async function Vitrin({
  urun,
}: {
  urun: ProductListItemWire | undefined;
}): Promise<React.ReactElement> {
  const t = await getTranslations('vitrin');
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
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight">{t('baslik')}</h1>
          <p className="max-w-xl text-metin-soluk">{t('aciklama')}</p>
        </div>

        <AramaKutusu className="max-w-xl" />

        <div className="flex flex-wrap items-center gap-6">
          <Button asChild size="lg">
            <Link href="/products">{t('urunleriKesfet')}</Link>
          </Button>

          {urun ? (
            <Link href={`/product/${urun.slug}`} className="group flex flex-col gap-0.5 text-sm">
              <span className="text-xs uppercase tracking-wide text-metin-soluk">
                {t('vitrinde')}
              </span>
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

async function Kategoriler({
  agac,
}: {
  agac: Awaited<ReturnType<typeof kategoriAgaci>>;
}): Promise<React.ReactElement | null> {
  const t = await getTranslations('vitrin');
  const gosterilecek = vitrinKategorileri(agac, VITRIN_KATEGORI_SAYISI);
  if (gosterilecek.length === 0) return null;

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-tight">{t('kategoriler')}</h2>
        <Link href="/category" className="text-sm text-metin-soluk hover:text-metin">
          {t('tumKategoriler')}
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
