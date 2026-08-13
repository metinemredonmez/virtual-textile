import type {
  AppliedFilterWire,
  InterpretationOutcomeWire,
  NaturalSearchPayloadWire,
  ProductFacetsWire,
  ProductListItemWire,
  ProductListPayloadWire,
} from '@vt/contracts';
import { isApiFailure } from '@vt/contracts';
import { list } from '@/lib/api/core';
import { serverFetch } from '@/lib/api/server';
import {
  apiSorgusu,
  listeBaglantisi,
  secimSayisi,
  type ListeSorgusu,
  type OkumaSecenekleri,
} from './liste-sorgusu';
import { AramaKutusu } from './arama-kutusu';
import { FiltreCekmecesi } from './filtre-cekmecesi';
import { FiltrePaneli } from './filtre-paneli';
import { Sayfalama } from './sayfalama';
import { SeciliFiltreler } from './secili-filtreler';
import { Siralama } from './siralama';
import { BosSonuc, UrunIzgarasi } from '@/components/urun/urun-izgarasi';
import { hataYuku } from '@/components/hata/hata-koprusu';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { YorumSeridi } from './yorum-seridi';

/**
 * LİSTE EKRANI — `/products` ve `/category/[slug]` bunun üzerine kurulur.
 *
 * ⚠️ Veri DOĞRUDAN API'den geliyor, vekilden değil: katalog uçları `@Public()`
 *    ve önbelleklenebilir. `forwardClientIp` ZORUNLU — `/products` ve
 *    `/search/*` uçları `scope:'ip'` ve 60/dk. İletilmezse tüm ziyaretçiler
 *    API'de TEK kovaya düşer ve site dakikada 60 görüntülemeden sonra herkese
 *    429 döndürür.
 */
export interface UrunListesiProps {
  sorgu: ListeSorgusu;
  /** Bağlantıların ve filtre formunun gideceği yol. */
  yol: string;
  baslik: string;
  secenekler?: OkumaSecenekleri;
  /** Kategori sayfasında kutu gerekmez; oradaki niyet zaten kategoridir. */
  aramaKutusuGoster?: boolean;
}

interface ListeVerisi {
  items: ProductListItemWire[];
  nextCursor: string | null;
  total: number | null;
  facets: ProductFacetsWire;
  didYouMean: string | null;
  /** Yalnız doğal dil aramasında dolu. */
  yorum: { outcome: InterpretationOutcomeWire; filter: AppliedFilterWire | null } | null;
}

/**
 * KURUŞ → TAM TL.
 *
 * ⚠️ BÖLME DEĞİL, DİZGİ KIRPMASI. `Number(x) / 100` para üzerinde kayan nokta
 *    aritmetiği demektir ve lint bu ifadeyi görmez. Küsuratlı bir sınır
 *    gelirse (nadir; model tam TL üretiyor) sınır en fazla 1 TL sıkışır —
 *    kabul edilir, çünkü alternatifi paranın `Number`a düşmesi.
 */
function tamTlYe(kurus: string): string | null {
  if (!/^\d+$/.test(kurus)) return null;
  const tl = kurus.slice(0, -2);
  return tl === '' ? '0' : tl;
}

/**
 * Yorumlanmış cümleyi DÜZ FİLTREYE çevirir.
 *
 * ⚠️ Bundan sonraki her gezinme (sıralama, faset, sonraki sayfa) bu sorgudan
 *    üretilir ve `GET /v1/products`e gider. Cümle bir daha yorumlanmaz; aksi
 *    hâlde tek bir aramanın maliyeti kullanıcının tıklama sayısıyla çarpılırdı.
 */
function yorumdanSorgu(taban: ListeSorgusu, filtre: AppliedFilterWire | null): ListeSorgusu {
  if (filtre === null) return { ...taban, ara: null, q: taban.ara };

  const maxFiyat = filtre.maxPriceMinor === null ? null : tamTlYe(filtre.maxPriceMinor);

  return {
    ...taban,
    ara: null,
    q: filtre.keywords.length > 0 ? filtre.keywords.join(' ') : null,
    kategori: filtre.category ?? taban.kategori,
    renk: filtre.colors,
    cinsiyet: filtre.gender,
    maxFiyat,
  };
}

async function veriGetir(sorgu: ListeSorgusu): Promise<{ veri: ListeVerisi; etkin: ListeSorgusu }> {
  if (sorgu.ara !== null) {
    try {
      const sonuc = await serverFetch<NaturalSearchPayloadWire, '/search/natural'>(
        '/search/natural',
        {
          method: 'POST',
          json: { query: sorgu.ara },
          forwardClientIp: true,
        },
      );
      const { items, nextCursor, total } = list<ProductListItemWire>(sonuc);
      const yorum = sonuc.data.interpretation;
      return {
        veri: {
          items,
          nextCursor,
          total,
          facets: sonuc.data.facets,
          didYouMean: sonuc.data.didYouMean,
          yorum,
        },
        etkin: yorumdanSorgu(sorgu, yorum.filter),
      };
    } catch (hata) {
      /**
       * ⚠️ DOĞAL DİL UCUNUN HATASI LİSTEYİ ÇÖKERTMEZ. Bu uç hız limitli
       *    (`scope:'user'`, kimliksizken IP) ve kota/bütçe kapıları var;
       *    429 alındığında sayfanın tamamını hata sınırına düşürmek, aranan
       *    ürünler veritabanında yerli yerinde dururken kullanıcıya boş ekran
       *    göstermek olurdu. Sunucunun kendi felsefesi de bu: yorumlanamayan
       *    cümle anahtar kelime aramasına düşer.
       */
      if (!isApiFailure(hata)) throw hata;
      const dusulmus: ListeSorgusu = { ...sorgu, ara: null, q: sorgu.ara };
      const veri = await duzListe(dusulmus);
      return {
        veri: { ...veri, yorum: { outcome: 'PROVIDER_ERROR', filter: null } },
        etkin: dusulmus,
      };
    }
  }

  return { veri: await duzListe(sorgu), etkin: sorgu };
}

async function duzListe(sorgu: ListeSorgusu): Promise<ListeVerisi> {
  try {
    return await urunleriCek(sorgu);
  } catch (hata) {
    /**
     * ⚠️ TANINMAYAN İMLEÇ HATA DEĞİL, İLK SAYFADIR. ÖLÇÜLDÜ:
     *      GET /v1/products?cursor=bozukimlec → 400 VALIDATION_FAILED
     *    ve bu, sayfanın tamamını hata sınırına düşürüyordu — kullanıcı
     *    bağlantıyı kırpılmış bir adresten (mesaj uygulamaları uzun URL'leri
     *    böler) açtığında BOŞ EKRAN görüyordu. İmleç bir sayfa göstergesidir;
     *    göstergeyi kaybetmenin bedeli baştan başlamaktır, ekranı kaybetmek
     *    değil.
     *
     * ⚠️ Yalnızca imleç varken ve YALNIZCA doğrulama hatasında yutulur. 429 ya
     *    da 500 buradan geçmez; onları yutmak gerçek bir arızayı "sonuç yok"
     *    diye göstermek olurdu.
     */
    if (sorgu.imlec === null || !isApiFailure(hata) || hata.code !== 'VALIDATION_FAILED') {
      throw hata;
    }
    return urunleriCek({ ...sorgu, imlec: null });
  }
}

async function urunleriCek(sorgu: ListeSorgusu): Promise<ListeVerisi> {
  const sonuc = await serverFetch<ProductListPayloadWire, '/products'>('/products', {
    query: apiSorgusu(sorgu),
    forwardClientIp: true,
  });
  const { items, nextCursor, total } = list<ProductListItemWire>(sonuc);
  return {
    items,
    nextCursor,
    total,
    facets: sonuc.data.facets,
    didYouMean: sonuc.data.didYouMean,
    yorum: null,
  };
}

export async function UrunListesi({
  sorgu,
  yol,
  baslik,
  secenekler = {},
  aramaKutusuGoster = true,
}: UrunListesiProps): Promise<React.ReactElement> {
  /**
   * ⚠️ HATA BURADA YAKALANIR, `error.tsx`E BIRAKILMAZ — VE SEBEBİ ÖLÇÜLDÜ.
   *
   *    Yakalanmayan hata `(magaza)/error.tsx` sınırına düşüyordu ve o sınıra
   *    ULAŞAN NESNE `ApiFailure` DEĞİLDİR: RSC sınırında düz `Error`a
   *    sadeleşiyor, geriye yalnız `message`/`digest` kalıyor. Yani `code` ve
   *    `retryAfterSeconds` KAYBOLUYOR.
   *
   *    ÖLÇÜLDÜ (60 sn içinde 330 istek → API `429 RATE_LIMITED`,
   *    `retryAfterSeconds: 50`): `/products?q=zzz1` → **HTTP 200**, gövde
   *    38 733 bayt, ürün kartı **0**, ekranda "Beklenmeyen bir hata" +
   *    "Tekrar dene". Kullanıcı "50 saniye sonra tekrar deneyin" YERİNE genel
   *    kutuyu görüyor ve "Tekrar dene"ye basınca aynı duvara çarpıyordu —
   *    `retry-policy.ts`in `RATE_LIMITED` için seçtiği davranış tam olarak
   *    "düğme YOK, geri sayım VAR" iken.
   *
   *    `hataYuku` gövdeyi düz JSON'a çeviriyor, `SunucuHatasi` `ApiFailure`ı
   *    İSTEMCİDE yeniden kuruyor; böylece `HataGosterimi` yine katalog metnini,
   *    doğru davranışı ve geri sayımı gösterebiliyor.
   *
   * ⚠️ `hataYuku` `redirect()`/`notFound()` sinyallerini YENİDEN FIRLATIR, yani
   *    bu `catch` gezinmeyi yutmaz (gerekçe `hata-koprusu.ts`te).
   *
   * ⚠️ İKİNCİ SONUCU DAHA AĞIR VE ÖLÇÜMLE İLGİLİ: hata sınırına düşen sayfa
   *    **200** döner. Durum koduna bakan bir bağlantı taraması bu sayfayı
   *    SAĞLAM sayar. Kabul ölçütü bu yüzden §12'de genişletildi: tarama
   *    sırasında SUNUCU LOGUNDA hata satırı olmayacak.
   */
  let veri: ListeVerisi;
  let etkin: ListeSorgusu;
  try {
    ({ veri, etkin } = await veriGetir(sorgu));
  } catch (hata) {
    return (
      <section>
        <h1 className="mb-6 text-xl font-semibold tracking-tight">{baslik}</h1>
        <SunucuHatasi govde={hataYuku(hata)} className="max-w-md" />
      </section>
    );
  }

  const panel = (
    <FiltrePaneli
      sorgu={etkin}
      facets={veri.facets}
      yol={yol}
      secenekler={secenekler}
      baslikGoster={false}
    />
  );

  return (
    <section>
      <header className="mb-6 flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">{baslik}</h1>
          {veri.total !== null ? (
            <span className="rakam shrink-0 text-sm text-metin-soluk">{veri.total} ürün</span>
          ) : null}
        </div>

        {aramaKutusuGoster ? (
          <AramaKutusu baslangic={sorgu.ara ?? etkin.q ?? ''} className="max-w-xl" />
        ) : null}

        {sorgu.ara !== null && veri.yorum !== null ? (
          <YorumSeridi
            cumle={sorgu.ara}
            outcome={veri.yorum.outcome}
            filtre={veri.yorum.filter}
            filtreHref={listeBaglantisi(yol, etkin, {}, secenekler)}
          />
        ) : null}
      </header>

      <div className="flex items-center justify-between gap-4 border-y border-kenar py-3">
        {/* Çekmece YALNIZCA mobilde; masaüstünde panel zaten kenar çubuğunda. */}
        <div className="lg:hidden">
          <FiltreCekmecesi secimSayisi={secimSayisi(etkin)}>{panel}</FiltreCekmecesi>
        </div>
        <div className="hidden lg:block" />
        <Siralama sorgu={etkin} yol={yol} secenekler={secenekler} />
      </div>

      <div className="mt-8 flex gap-10">
        <aside className="hidden w-60 shrink-0 lg:block">
          <FiltrePaneli sorgu={etkin} facets={veri.facets} yol={yol} secenekler={secenekler} />
        </aside>

        <div className="min-w-0 flex-1">
          <SeciliFiltreler sorgu={etkin} yol={yol} secenekler={secenekler} />

          <div className="mt-4">
            {veri.items.length === 0 ? (
              <BosSonuc
                temizleHref={listeBaglantisi(
                  yol,
                  etkin,
                  {
                    q: null,
                    marka: [],
                    renk: [],
                    beden: [],
                    minFiyat: null,
                    maxFiyat: null,
                    cinsiyet: null,
                  },
                  secenekler,
                )}
                didYouMean={veri.didYouMean}
                duzeltmeHref={
                  veri.didYouMean
                    ? listeBaglantisi(yol, etkin, { q: veri.didYouMean }, secenekler)
                    : null
                }
              />
            ) : (
              <>
                <UrunIzgarasi
                  urunler={veri.items}
                  boyutlar="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 20vw"
                />
                <Sayfalama
                  sorgu={etkin}
                  yol={yol}
                  nextCursor={veri.nextCursor}
                  urunSayisi={veri.items.length}
                  secenekler={secenekler}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
