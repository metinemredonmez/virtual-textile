import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Layers, Ruler, Search, Shirt, ShoppingBag, Sparkles } from 'lucide-react';
import type { ProductListItemWire, ProductListPayloadWire, SiteImageWire } from '@vt/contracts';
import { list } from '@/lib/api/core';
import { serverFetch } from '@/lib/api/server';
import { mediaUrl } from '@/lib/media';
import { UrunGorseli } from '@/components/urun/urun-gorseli';
import { Button } from '@/components/ui/button';
import { Fiyat } from '@/components/fiyat/fiyat';
import { AramaKutusu } from './products/_liste/arama-kutusu';
import { UrunKarti } from '@/components/urun/urun-karti';
import { Ray, RayKarti } from '@/components/vitrin/ray';
import { BolumBasligi } from '@/components/vitrin/bolum-basligi';
import { AfisKarti } from '@/components/vitrin/afis-karti';
import { afisGetir, kapaklariGetir } from '@/components/vitrin/site-gorseli';
import { kategoriAgaci, vitrinKategorileri } from '@/lib/kategori';
import { KOLEKSIYON_LISTESI } from './collection/koleksiyonlar';

/**
 * VİTRİN — ON BÖLÜM, PAZARYERİ SIRASIYLA.
 *
 *    1. Afiş            — ekranın çoğu; pazaryerinin vaadi
 *    2. Kategoriler     — alışverişin ilk kapısı
 *    3. Yeni gelenler   — tazelik sinyali (sort=newest)
 *    4. Öne çıkanlar    — relevance
 *    5. İndirimdekiler  — liste fiyatının altındakiler
 *    6. Koleksiyonlar   — dört iniş sayfası
 *    7. Mağazalar       — çok satıcılı olduğumuzun görünür kanıtı
 *    8. Nasıl çalışır   — sanal deneme akışı, üç adım
 *    9. Neler yapabilirsiniz — bugün çalışan özellikler
 *   10. Stil danışmanı + Satıcı ol — AI'a ve ARZ tarafına giriş
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ SIRALAMA BU TURDA DEĞİŞTİ VE SEBEBİ BİR ÜRÜN DÜZELTMESİ.
 *
 *    Eski sırada afişin hemen altında "Nasıl çalışır" (deneme akışı) vardı ve
 *    afiş başlığı "Satın almadan önce üzerinizde görün" diyordu. Yani ana
 *    sayfa kendini bir SANAL DENEME ARACI olarak tanıtıyordu.
 *
 *    Burası ÖNCE BİR PAZARYERİ: küçük markalar kendi ürünlerini satıyor,
 *    müşteri platformun. Sanal deneme bu işin BİR ÖZELLİĞİ — en ayırt edici
 *    olanı, ama işin kendisi değil. Sıra buna göre kuruldu: önce alışveriş
 *    yolları, sonra deneme anlatısı, en sonda arz tarafı.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ BURADA BİR DÖNEM "ÜÇ BÖLÜM, DAHA FAZLASI DEĞİL" YAZIYORDU ve o kural
 *    YANLIŞTI. Gerekçesi `design-system.md`nin öğe bütçesiydi ve o bütçe
 *    SSENSE'e bakılarak yazılmıştı. Kaçırılan şey şu: SSENSE'in ziyaretçisi
 *    markayı ZATEN TANIYOR ve oradaki tek iş ürünü göstermektir. Bir
 *    pazaryerinin ana sayfasının işi başka: hangi markaların olduğunu, ne
 *    satıldığını ve nereden gireceğini göstermek.
 *
 * ⚠️ SADELİK KURALI DURUYOR, YALNIZCA YERİ DEĞİŞTİ. Bölüm sayısı arttı ama
 *    her bölüm hâlâ akromatik, kenarlıksız, süssüz. "Az bölüm" ile "az süs"
 *    aynı şey değil; bu depoda karıştırılmıştı. Bir bölüm eklemek için şart:
 *    VAR OLAN bir yeteneğe kapı açıyor olmalı. Pazarlama dolgusu ("neden biz",
 *    "bültene abone ol") hâlâ eklenmez — eklenen altı bölümün her biri ya bir
 *    uca (sort=newest, indirim) ya bir ekrana (koleksiyon, hesaplayıcı) çıkıyor.
 */
export const dynamic = 'force-dynamic';

const VITRIN_KATEGORI_SAYISI = 8;

/**
 * ⚠️ TEK GENİŞ İSTEK, DÖRT BÖLÜM. Vitrin, öne çıkanlar, indirimdekiler ve
 *    mağaza şeridi AYNI kayıt kümesinden türetiliyor. Bölüm başına ayrı istek
 *    dört tur demekti ve üçü aynı tablodan aynı sırayla okuyacaktı.
 *    `SEARCH.maxPageSize` 100; 48 hem tavanın altında hem dördünü besleyecek
 *    kadar geniş.
 *
 * ⚠️ İNDİRİM VE MAĞAZA İÇİN AYRI UÇ YOK — ve bunun bir bedeli var, saklamıyoruz:
 *    katalog sorgusunda indirim filtresi bulunmuyor (`catalog.schema.ts`),
 *    mağaza listesi ucu ise yalnız satıcının kendi paneli için var. İki şerit de
 *    "tüm indirimler" / "tüm mağazalar" DEĞİL, bu örneklemde geçenler.
 *    Katalog büyüdüğünde ikisi de kendi ucunu ister; o gün gelene kadar bir
 *    şeridi boş bırakmaktansa örneklemle doldurmak doğru olan.
 */
const GENIS_LISTE_SAYISI = 48;

/** Şerit başına azami kart — daha fazlası kaydırmayı yorucu yapıyor. */
const RAY_URUN_SAYISI = 12;

/**
 * AFİŞİN ÜZERİNDEKİ AZAMİ KART.
 *
 * ⚠️ ÜÇ, VE SAYI ÖLÇÜLDÜ. Kart 15rem (240px), aralık 16px; üç kart
 *    3×240 + 2×16 = 752px eder. `lg`de (1024px) kap 992px, afişin iç
 *    boşluğu (`inset-x-6`) düşünce 944px kalıyor → sığar. Dördüncü kart
 *    1008px eder ve 1024px'te TAŞAR; yönetici dörtten fazla bağlarsa
 *    fazlası çizilmez, düzen bozulmaz.
 */
const AZAMI_AFIS_KARTI = 3;

export default async function VitrinPage(): Promise<React.ReactElement> {
  const t = await getTranslations('vitrin');
  const [urunSonucu, yeniSonucu, agac, afis, kategoriKapaklari, koleksiyonKapaklari] =
    await Promise.all([
      serverFetch<ProductListPayloadWire, '/products'>('/products', {
        // Varsayılan `relevance` sıralaması popülerlik + tazelik + mağaza
        // kalitesini birlikte tartıyor; vitrin için doğru olan bu, "en yeni" değil.
        query: { limit: GENIS_LISTE_SAYISI },
        forwardClientIp: true,
      }),
      // ⚠️ "Yeni gelenler" AYRI BİR İSTEK olmak zorunda: aynı listeyi iki farklı
      //    sırada okuyamayız ve `relevance` içindeki tazelik ağırlığı (0,2)
      //    "en yeni"yi göstermez — popüler eski ürün yeniyi öne geçirir.
      serverFetch<ProductListPayloadWire, '/products'>('/products', {
        query: { limit: RAY_URUN_SAYISI, sort: 'newest' },
        forwardClientIp: true,
      }),
      kategoriAgaci(),
      // ⚠️ HEPSİ TEK TURDA: aynı `Promise.all` içinde paralel gidiyor. Uçlardan
      //    biri düşerse yalnız o bölüm bugünkü hâline düşer; sayfa kırılmaz
      //    (gerekçe `site-gorseli.ts`).
      afisGetir(),
      kapaklariGetir('CATEGORY_COVER'),
      kapaklariGetir('COLLECTION_COVER'),
    ]);

  const { items } = list<ProductListItemWire>(urunSonucu);
  const { items: yeniler } = list<ProductListItemWire>(yeniSonucu);
  const [vitrin, ...kalan] = items;
  const oneCikanlar = kalan.slice(0, RAY_URUN_SAYISI);

  /**
   * ⚠️ İNDİRİM SUNUCUDA SÜZÜLÜYOR, İSTEMCİDE DEĞİL — bu bir Sunucu Bileşeni,
   *    yani süzme tarayıcıya hiç inmiyor. `listPriceMinor` yoksa indirim de yok;
   *    eşitlik durumu (liste = satış) indirim SAYILMAZ, yoksa "%0 indirim"
   *    rozetli kartlar çizerdik.
   */
  const indirimliler = items
    .filter((u) => u.listPriceMinor !== null && u.listPriceMinor > u.priceMinor)
    .slice(0, RAY_URUN_SAYISI);

  return (
    <div className="flex flex-col gap-20 py-4">
      <Vitrin afis={afis} urun={vitrin} />

      {/*
        ⚠️ SIRALAMA BU TURDA DEĞİŞTİ VE SEBEBİ ÜRÜN KARARI: burası ÖNCE bir
           pazaryeri, sanal deneme onun BİR ÖZELLİĞİ. Eski sırada afişin hemen
           altında "Nasıl çalışır" (deneme akışı) vardı; yani sayfa kendini bir
           sanal deneme aracı olarak tanıtıyordu. Şimdi önce alışveriş yolları
           (kategori · yeni · öne çıkan · indirim · koleksiyon · mağaza), sonra
           deneme anlatısı geliyor.
      */}
      <Kategoriler agac={agac} kapaklar={kategoriKapaklari} />

      {yeniler.length > 0 ? (
        <Ray
          baslik={t('yeniGelenler')}
          aciklama={t('yeniGelenlerNot')}
          /* ⚠️ `sirala=newest` — `yeni` DEĞİL. Değer sunucunun enum'ıyla AYNI
             yazılıyor (`liste-sorgusu.ts` → SIRALAMALAR); Türkçeleştirilmiş bir
             değer beyaz listeye takılır ve sessizce `relevance`a düşerdi:
             bağlantı çalışır görünür, sıralama yanlış olurdu. */
          tumuAdres="/products?sirala=newest"
          tumuEtiket={t('tumunuGor')}
        >
          {yeniler.map((urun) => (
            <RayKarti key={urun.id}>
              <UrunKarti urun={urun} />
            </RayKarti>
          ))}
        </Ray>
      ) : null}

      {oneCikanlar.length > 0 ? (
        <Ray baslik={t('oneCikanlar')} tumuAdres="/products" tumuEtiket={t('tumunuGor')}>
          {oneCikanlar.map((urun) => (
            <RayKarti key={urun.id}>
              <UrunKarti urun={urun} />
            </RayKarti>
          ))}
        </Ray>
      ) : null}

      {/* ⚠️ Şerit BOŞSA ÇİZİLMEZ — "İndirimdekiler" başlığı altında boş bir
          kaydırma alanı, indirim olmadığını söylemenin en kötü yoludur. */}
      {indirimliler.length > 0 ? (
        <Ray
          baslik={t('indirimdekiler')}
          aciklama={t('indirimdekilerNot')}
          tumuAdres="/products"
          tumuEtiket={t('tumunuGor')}
        >
          {indirimliler.map((urun) => (
            <RayKarti key={urun.id}>
              <UrunKarti urun={urun} />
            </RayKarti>
          ))}
        </Ray>
      ) : null}

      <Koleksiyonlar kapaklar={koleksiyonKapaklari} />

      <Magazalar urunler={items} />

      <NasilCalisir />

      <Ozellikler />

      <Danisman />

      <SaticiOl />
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
  /**
   * ⚠️ HER MADDE BİR EKRANA GİDER. Özellik listesi bir dönem yalnızca METİNDİ:
   *    kullanıcı "Dijital gardırop" okuyup nereye gideceğini bilmiyordu.
   *    Şimdi her kart bir bağlantı — ve HEDEFLER ÖLÇÜLDÜ, hepsi var olan
   *    rotalar. Olmayan bir sayfaya kart açmak, bu listeyi bir vaat listesine
   *    çevirirdi ve dosya başlığındaki kural tam da bunu yasaklıyor.
   *
   * ⚠️ İKONLAR AKROMATİK (`text-ikon`). `design-system.md`: renk yalnız DURUM
   *    taşır. Altı renkli ikon, sayfadaki tek renkli sinyal olan "indirim"
   *    rozetini harcardı. Aynı gerekçe üst çubukta da yazılı.
   */
  const maddeler = [
    { anahtar: 'Deneme', ikon: Shirt, adres: '/products' },
    { anahtar: 'Kombin', ikon: Layers, adres: '/collection' },
    { anahtar: 'Beden', ikon: Ruler, adres: '/calculator' },
    { anahtar: 'Danisman', ikon: Sparkles, adres: '/stylist' },
    { anahtar: 'Gardirop', ikon: ShoppingBag, adres: '/account/wardrobe' },
    { anahtar: 'Arama', ikon: Search, adres: '/products' },
  ] as const;

  return (
    <section>
      <BolumBasligi baslik={t('ozellikler')} aciklama={t('ozelliklerNot')} />

      {/*
        ⚠️ KARTLAR ARTIK GERÇEKTEN KART. Önce altı paragraf yan yanaydı; kenarlık
           yok, zemin yok, ikon yok. Ekranda "özellik listesi" değil "duvar
           metni" gibi duruyordu — kullanıcının ilk yorumu buydu.

        ⚠️ KENARLIK VAR AMA GÖLGE YOK. `design-system.md` gölgeyi eler; kenarlık
           ise bir sınırı BİLDİRİR, süslemez. Kartın tıklanabilir olduğunu
           `hover:bg-yuzey-vurgulu` söylüyor, gölge değil.
      */}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {maddeler.map(({ anahtar, ikon: Ikon, adres }) => (
          <li key={anahtar}>
            <Link
              href={adres}
              className="flex h-full flex-col gap-2 rounded-lg border border-kenar p-5 transition-colors hover:bg-yuzey-vurgulu"
            >
              <Ikon className="size-5 shrink-0 text-ikon" aria-hidden />
              <h3 className="text-[0.9375rem] font-semibold tracking-tight">
                {t(`ozellik${anahtar}`)}
              </h3>
              <p className="text-sm leading-relaxed text-metin-soluk">
                {t(`ozellik${anahtar}Metin`)}
              </p>
            </Link>
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
      <BolumBasligi baslik={t('nasilCalisir')} aciklama={t('nasilCalisirNot')} />

      {/*
        ⚠️ ÜÇ ADIM ARTIK KENDİ YÜZEYİNDE. Önce çıplak metindi: üç sütun, hepsi
           `text-sm`, arada 32px boşluk. Ekranda "yazı bloğu" gibi duruyordu,
           bir AKIŞ gibi değil. Yüzey (`bg-yuzey-vurgulu`) üçünü tek bir şey
           olarak bağlıyor — kutu değil zemin, yani çerçeve gürültüsü yok.

        ⚠️ NUMARALAR BÜYÜDÜ (`text-3xl`) VE SOLDU. Adım numarası bir DURUM
           değil SIRA olduğu için renk taşımaz (`design-system.md`); ama görsel
           çıpa olması gerekiyordu — 12px bir "01" hiçbir şeye çıpa olamaz.
           Büyük ve soluk: göze sırayı verir, okumayı çalmaz.

        ⚠️ `sm:` altında TEK SÜTUN ve numara solda kalır: 375px'te üç sütun
           satır başına ~110px düşürüyordu ve başlıklar iki-üç satıra kırılıyordu.
      */}
      <ol className="grid gap-px overflow-hidden rounded-lg bg-kenar sm:grid-cols-3">
        {adimlar.map((sira) => (
          <li key={sira} className="flex flex-col gap-2 bg-yuzey-vurgulu p-6">
            <span className="text-3xl font-semibold tabular-nums leading-none text-ikon">
              0{sira}
            </span>
            <h3 className="mt-1 text-[0.9375rem] font-semibold tracking-tight">
              {t(`adim${sira}Baslik`)}
            </h3>
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
async function Koleksiyonlar({
  kapaklar,
}: {
  kapaklar: Map<string, SiteImageWire>;
}): Promise<React.ReactElement> {
  const t = await getTranslations('vitrin');
  /**
   * ⚠️ KAPAK ALANI YA HEPSİNDE VAR YA HİÇBİRİNDE. Kapaklı ve kapaksız kartları
   *    aynı şeritte karıştırmak, yükseklikleri ayrışan bir sıra üretirdi.
   *    Yönetici hiçbir kapak yüklemediyse bölüm BUGÜNKÜ hâlinde (yalnız metin)
   *    kalır; ilk kapak yüklendiği an bölüm görsele terfi eder ve kapağı
   *    olmayan koleksiyonlar adlarını taşıyan nötr kutuya düşer
   *    (`urun-gorseli.tsx` yedeği). Boş durumda kod da ekran da değişmez.
   */
  const gorselli = kapaklar.size > 0;

  return (
    <Ray baslik={t('koleksiyonlar')} aciklama={t('koleksiyonlarNot')} tumuAdres="/collection">
      {KOLEKSIYON_LISTESI.map((koleksiyon) => (
        <RayKarti key={koleksiyon.slug}>
          <Link
            href={`/collection/${koleksiyon.slug}`}
            className="flex h-full flex-col gap-2 overflow-hidden rounded-lg border border-kenar p-4 transition-colors hover:bg-yuzey-vurgulu"
          >
            {gorselli ? (
              /* ⚠️ `-m*` ile kart kenarına taşıyor: iç boşluğun içinde duran
                 bir kapak, çerçeve içinde çerçeve olurdu. */
              <div className="relative -mx-4 -mt-4 mb-1 aspect-[4/3] w-[calc(100%+2rem)] overflow-hidden bg-urun-zemin">
                <UrunGorseli
                  src={mediaUrl(kapaklar.get(koleksiyon.slug)?.storageKey)}
                  alt={koleksiyon.h1}
                  sizes="(max-width: 640px) 15rem, 17rem"
                />
              </div>
            ) : null}
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
  /**
   * ⚠️ MAĞAZA BAŞINA BİR ÜRÜN GÖRSELİ SAKLANIYOR. Mağazanın kendi logosu
   *    (`Store.logoKey`) liste tipinde YOK; ikinci bir uç açmak yerine o
   *    mağazanın örneklemdeki İLK ürününün fotoğrafı kapak yapılıyor. Kart bir
   *    ürünü değil mağazayı temsil ettiği için hangi ürün olduğu önemsiz —
   *    önemli olan mağazanın ne sattığının görünmesi.
   */
  const magazalar = new Map<string, { ad: string; gorsel: string | null; adet: number }>();
  for (const urun of urunler) {
    if (!urun.storeSlug) continue;
    const kayit = magazalar.get(urun.storeSlug);
    if (kayit) kayit.adet += 1;
    else magazalar.set(urun.storeSlug, { ad: urun.brandName, gorsel: urun.imageKey, adet: 1 });
  }

  // Tek mağaza varsa "çok satıcılı" iddiası kurulamaz; şerit gösterilmez.
  if (magazalar.size < 2) return null;

  return (
    <Ray baslik={t('magazalar')} aciklama={t('magazalarNot')}>
      {[...magazalar.entries()].map(([slug, magaza]) => (
        <RayKarti key={slug}>
          {/* ⚠️ Filtre parametresi `marka` — liste sayfasının kendi sözlüğü
              (bkz. products/_liste/liste-sorgusu.ts). `magaza` yazmak sessizce
              filtresiz bir liste açardı. */}
          <Link
            href={`/products?marka=${encodeURIComponent(magaza.ad)}`}
            className="flex h-full flex-col gap-2 overflow-hidden rounded-lg border border-kenar transition-colors hover:bg-yuzey-vurgulu"
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-urun-zemin">
              <UrunGorseli
                src={mediaUrl(magaza.gorsel ?? undefined)}
                alt={magaza.ad}
                sizes="(max-width: 640px) 15rem, 17rem"
              />
            </div>
            <div className="flex flex-col gap-0.5 px-4 pb-4">
              <span className="text-sm font-semibold tracking-tight">{magaza.ad}</span>
              {/* ⚠️ "Örneklemdeki ürün sayısı", "mağazadaki ürün sayısı" DEĞİL.
                  Metin bu yüzden "bu seçkide" diyor — sayıyı toplam gibi
                  göstermek ölçmediğimiz bir şeyi iddia etmek olurdu. */}
              <span className="text-sm text-metin-soluk">
                {t('magazaUrunSayisi', { adet: String(magaza.adet) })}
              </span>
            </div>
          </Link>
        </RayKarti>
      ))}
    </Ray>
  );
}

/**
 * SATICI OL — pazaryerinin ARZ tarafı.
 *
 * ⚠️ VARLIK SEBEBİ: burası bir pazaryeri ve ana sayfa yalnızca alıcıya
 *    sesleniyordu. Küçük markanın "ben burada nasıl satarım" sorusunun sayfada
 *    hiçbir karşılığı yoktu.
 *
 * ⚠️ DÜĞME `/seller/apply`YE GİTMİYOR, `/calculator`A GİDİYOR — ve bu bilinçli.
 *    `POST /seller/apply` ucu VAR ama BAŞVURU EKRANI YAZILMADI (ölçüldü).
 *    Olmayan bir ekrana düğme koymak, kullanıcıyı 404'e göndermektir. Bugün
 *    çalışan şey hesaplayıcı: satıcı komisyonu ve eline geçecek tutarı
 *    görüyor. Başvuru ekranı yazıldığında birincil düğme o olur.
 */
async function SaticiOl(): Promise<React.ReactElement> {
  const t = await getTranslations('vitrin');
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-kenar p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight">{t('saticiOl')}</h2>
        <p className="max-w-xl text-sm text-metin-soluk">{t('saticiOlMetin')}</p>
      </div>
      <Button asChild variant="ikincil">
        <Link href="/calculator">{t('saticiOlDugme')}</Link>
      </Button>
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
        <h2 className="text-sm font-semibold tracking-tight">{t('danismanBaslik')}</h2>
        <p className="max-w-xl text-sm text-metin-soluk">{t('danismanMetin')}</p>
      </div>
      <Button asChild variant="ikincil">
        <Link href="/stylist">{t('danismanDugme')}</Link>
      </Button>
    </section>
  );
}

/**
 * ⚠️ BAŞLIK GÖRSELİN ÜSTÜNE BİNMEZ, ALTINA YAZILIR — VE BU KURAL DURUYOR.
 *
 *    Vitrin görselini kim koyarsa koysun (satıcının ürün fotoğrafı ya da
 *    yöneticinin afişi) tonunu biz bilmiyoruz: açık zemin de gelir, koyu zemin
 *    de. Üstüne yazılan DÜZ metnin okunabilirliği garanti edilemez; garanti
 *    etmenin tek yolu görselin üzerine karartma koymaktır ve bu, görseli —
 *    yani asıl işi yapan şeyi — bozar.
 *
 * ⚠️ KARTLAR İSE GÖRSELİN ÜZERİNE BİNER, VE BU ÇELİŞKİ DEĞİL. Yukarıdaki
 *    kuralın konusu ÇIPLAK METİN. Kartın kendi OPAK zemini var (`bg-zemin`),
 *    yani metin fotoğrafın değil kartın üstünde duruyor ve kontrast fotoğraftan
 *    bağımsız. Çözüm KART ZEMİNİ, görseli karartmak DEĞİL.
 *
 * ⚠️ NEDEN KART VAR: sayfa "üzerinizde görün" DİYOR ama GÖSTERMİYORDU. Vaadi
 *    metinle tekrar etmek yerine, afişteki parçaların üzerinde denenebilir
 *    olduğunu EKRANDA göstermek gerekiyordu. (Gerekçe bu; "falanca site böyle
 *    yapıyor" değil — `design-system.md`nin DRESSX uyarısı sanal deneme
 *    EKRANININ düzeni için yazılmıştır ve orada geçerliliğini koruyor.)
 *
 * ⚠️ MOBİLDE KARTLAR GÖRSELİ KAPATMAZ, ALTINA İNER. 375px'te afiş 429px
 *    yüksekliğinde; üstüne binen bir kart şeridi görselin yarısını yerdi.
 *    Bindirme yalnızca `lg` ve üstünde — gerekçe `AZAMI_AFIS_KARTI`de.
 *
 * ⚠️ BOŞ DURUM KOD YAZMADAN KORUNUR: `afis` yoksa ifade bugünkü değere düşer
 *    (ilk ürünün fotoğrafı), kart listesi boşalır ve bölüm eskisiyle aynı olur.
 *    Yönetici hiçbir şey yapmadan da site çalışır.
 *
 * ⚠️ Ayrıca ölçüldü: R2 nesneleri aralıklı 404/500 dönüyor. Görsel
 *    yüklenemediğinde düzen nötr bir gri panele iner ve başlık okunur kalır;
 *    kartlar opak olduğu için onlar da okunur kalır.
 */
async function Vitrin({
  afis,
  urun,
}: {
  afis: SiteImageWire | null;
  urun: ProductListItemWire | undefined;
}): Promise<React.ReactElement> {
  const t = await getTranslations('vitrin');
  /** Afiş anahtarı da AYNI `mediaUrl`den geçer; ikinci bir URL kurucu yazılmaz. */
  const gorsel = mediaUrl(afis?.storageKey ?? urun?.imageKey);
  const kartlar = (afis?.cards ?? []).slice(0, AZAMI_AFIS_KARTI);

  /**
   * ⚠️ YALNIZCA SİTE İÇİ YOL KABUL EDİLİR. `linkHref` yönetici tarafından
   *    yazılan serbest bir metin; `https://…` yazıldığında ana sayfanın en
   *    büyük öğesi siteden çıkaran bir bağlantıya dönerdi. Kapı burada, çünkü
   *    açık yönlendirme kapısını "yönetici zaten güvenilir" diye atlamak bu
   *    depoda `?next=` için de denenmiş ve `lib/donus-yolu.ts` yazılmıştı.
   */
  const afisYolu = afis?.linkHref?.startsWith('/') ? afis.linkHref : null;

  const gorselKutusu = (
    <div className="relative aspect-urun w-full overflow-hidden rounded-lg bg-urun-zemin md:aspect-[16/7]">
      {/* ⚠️ Ham `next/image` DEĞİL — gerekçe `components/urun/urun-gorseli.tsx`te.
          `oncelikli`: ilk ekranın en büyük öğesi; tembel yüklenirse LCP odur. */}
      <UrunGorseli src={gorsel} alt={afis?.title ?? urun?.title ?? ''} sizes="100vw" oncelikli />
    </div>
  );

  return (
    <section className="flex flex-col gap-8">
      {/* ⚠️ Kartlar bağlantının İÇİNDE DEĞİL KARDEŞİ: içine konsaydı düğmeler
          bir `<a>`nın içinde kalırdı (iç içe etkileşimli öğe) ve karta basmak
          afişin hedefine giderdi. */}
      <div className="relative">
        {afisYolu ? (
          <Link href={afisYolu} className="block">
            {gorselKutusu}
          </Link>
        ) : (
          gorselKutusu
        )}

        {kartlar.length > 0 ? (
          /*
           * ⚠️ TEK DOM, İKİ DÜZEN. Mobil şerit ile masaüstü bindirmesi AYNI
           *    düğümler: `hidden`/`lg:hidden` ile iki kopya yazmak aynı
           *    düğmeleri ekran okuyucuya iki kez okuturdu.
           *
           * ⚠️ `lg:` — `md:` DEĞİL. 768px'te kap 736px, afiş iç boşluğu düşünce
           *    688px kalıyor ve üç kart 752px istiyor; `md:`de bindirme TAŞARDI.
           *
           * ⚠️ Kaydırma kartların KENDİ kabında (`overflow-x-auto`), sayfada
           *    değil — `ray.tsx`teki kural. `-mx-4 px-4` kabın kenar boşluğunu
           *    telafi eder, yani şerit ekranın kenarından girip çıkar.
           */
          <div
            className="-mx-4 mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 scroll-pl-4 lg:absolute lg:inset-x-6 lg:bottom-6 lg:mx-0 lg:mt-0 lg:overflow-visible lg:px-0 lg:pb-0"
            tabIndex={0}
            role="group"
            aria-label={t('afistekiParcalar')}
          >
            {kartlar.map((kart) => (
              <div key={kart.productId} className="w-[15rem] shrink-0 snap-start sm:w-[17rem]">
                <AfisKarti kart={kart} />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          {/* ⚠️ Yöneticinin metni VARSA o basılır — yoksa sözlük. Alan yazılıp
              hiçbir yerden okunmasaydı, bu deponun altı kez yaşadığı sınıfın
              ta kendisi olurdu. */}
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight">
            {afis?.title ?? t('baslik')}
          </h1>
          <p className="max-w-xl text-metin-soluk">{afis?.subtitle ?? t('aciklama')}</p>
        </div>

        <AramaKutusu className="max-w-xl" />

        <div className="flex flex-wrap items-center gap-6">
          <Button asChild size="lg">
            <Link href="/products">{t('urunleriKesfet')}</Link>
          </Button>

          {/* ⚠️ AFİŞİN KARTLARI VARSA BU BLOK ÇİZİLMEZ. "Vitrinde" ilk ürünü
              gösteriyor; afiş yöneticinin seçtiği BAŞKA parçaları gösterirken
              aynı ekranda ikinci bir "vitrindeki ürün" iddiası, hangisinin
              afişte olduğunu belirsizleştirirdi. */}
          {urun && kartlar.length === 0 ? (
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

/**
 * KATEGORİLER — kapak varsa görselli şerit, yoksa bugünkü hap listesi.
 *
 * ⚠️ HAP LİSTESİ SİLİNMEDİ. Kapak yüklenmemişken sekiz kategoriyi sekiz gri
 *    kutuya çevirmek, yöneticinin hiçbir şey yapmadığı durumu BUGÜNKÜNDEN
 *    KÖTÜ hâle getirirdi. Boş durum kuralı burada da geçerli: hiçbir kapak
 *    yoksa bölüm bugünküyle bit be bit aynı.
 *
 * ⚠️ ANAHTAR `Category.id`, slug DEĞİL. Slug `@unique` ama DEĞİŞMEZ değil;
 *    yönetici bir kategorinin slug'ını düzelttiğinde kapak sessizce
 *    kaybolurdu ve kimse bunu bir arıza olarak görmezdi.
 */
async function Kategoriler({
  agac,
  kapaklar,
}: {
  agac: Awaited<ReturnType<typeof kategoriAgaci>>;
  kapaklar: Map<string, SiteImageWire>;
}): Promise<React.ReactElement | null> {
  const t = await getTranslations('vitrin');
  const gosterilecek = vitrinKategorileri(agac, VITRIN_KATEGORI_SAYISI);
  if (gosterilecek.length === 0) return null;

  if (kapaklar.size > 0) {
    return (
      <Ray baslik={t('kategoriler')} tumuAdres="/category" tumuEtiket={t('tumKategoriler')}>
        {gosterilecek.map((kategori) => (
          <RayKarti key={kategori.id}>
            <Link href={`/category/${kategori.slug}`} className="group flex h-full flex-col gap-2">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-urun-zemin">
                <UrunGorseli
                  src={mediaUrl(kapaklar.get(kategori.id)?.storageKey)}
                  alt={kategori.name}
                  sizes="(max-width: 640px) 15rem, 17rem"
                />
              </div>
              <span className="text-sm font-semibold tracking-tight group-hover:underline">
                {kategori.name}
              </span>
            </Link>
          </RayKarti>
        ))}
      </Ray>
    );
  }

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
