import Link from 'next/link';
import type { FacetBucketWire, ProductFacetsWire } from '@vt/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listeBaglantisi, type ListeSorgusu, type OkumaSecenekleri } from './liste-sorgusu';

/**
 * FİLTRE PANELİ — DÜZ BİR `GET` FORMU.
 *
 * Neden form, neden istemci durumu değil:
 *   • Ekranın tüm durumu URL'de; form gönderimi doğrudan yeni bir URL üretir.
 *   • JavaScript çalışmadan da çalışır ve bu bir Sunucu Bileşenidir — mobil
 *     çekmeceye de, masaüstü kenar çubuğuna da AYNI ağaç veriliyor. İki kopya
 *     olsaydı biri diğerinden sessizce ayrışırdı.
 *   • Global durum kütüphanesi yok kuralının doğal sonucu.
 *
 * ⚠️ FORMDA `imlec` YOK. Olsaydı üçüncü sayfadayken bir renk seçen kullanıcı,
 *    yeni sonuç kümesinin üçüncü sayfasına düşerdi; sıralama değişiminde ise
 *    doğrudan HTTP 500 alırdı (bkz. liste-sorgusu.ts, ölçülmüş gerekçe).
 *
 * ⚠️ FORMDA `ara` YOK. Doğal dil cümlesi bir kez yorumlanır ve sonucu düz
 *    filtreye dönüşür. Formda taşınsaydı her onay kutusu tıklaması aynı cümle
 *    için yeni bir LLM çağrısı olurdu.
 *
 * ⚠️ Gönderim sonrası adres `?minFiyat=&maxFiyat=&renk=Bej` gibi BOŞ parametre
 *    taşır (ölçüldü); tarayıcı boş alanları da gönderir. Bilerek katlanılıyor:
 *    temizlemenin tek yolu formu JavaScript'e bağlamak ve o zaman filtre
 *    JavaScript'siz çalışmaz olur. `sorguyuOku` boş dizgiyi zaten "yok" sayıyor
 *    ve sonraki her gezinme bağlantılardan üretildiği için adres kendiliğinden
 *    temizleniyor.
 */
export interface FiltrePaneliProps {
  sorgu: ListeSorgusu;
  facets: ProductFacetsWire;
  /** Formun gideceği yol: `/products` ya da `/category/<slug>`. */
  yol: string;
  secenekler?: OkumaSecenekleri;
  /** Çekmecede başlık zaten var; kenar çubuğunda gerekiyor. */
  baslikGoster?: boolean;
}

export function FiltrePaneli({
  sorgu,
  facets,
  yol,
  secenekler = {},
  baslikGoster = true,
}: FiltrePaneliProps): React.ReactElement {
  return (
    <form method="get" action={yol} className="flex flex-col gap-6 text-sm">
      {baslikGoster ? <h2 className="text-sm font-semibold tracking-tight">Filtreler</h2> : null}

      {/*
        Formun kapsamadığı ama korunması gereken durum. `sirala` gizli alan
        olarak taşınır: kullanıcı "artan fiyat"ı seçip sonra bir renk işaretlediğinde
        sıralamasının sessizce sıfırlanması, sayfanın kendi kendine değişmesi gibi
        okunur.
      */}
      {sorgu.q ? <input type="hidden" name="q" value={sorgu.q} /> : null}
      {sorgu.kategori && !secenekler.sabitKategori ? (
        <input type="hidden" name="kategori" value={sorgu.kategori} />
      ) : null}
      {sorgu.sirala !== 'relevance' ? (
        <input type="hidden" name="sirala" value={sorgu.sirala} />
      ) : null}
      {sorgu.cinsiyet ? <input type="hidden" name="cinsiyet" value={sorgu.cinsiyet} /> : null}

      <FiyatAraligi sorgu={sorgu} />

      <FasetGrubu baslik="Renk" alan="renk" kovalar={facets.colors} secili={sorgu.renk} />
      <FasetGrubu baslik="Beden" alan="beden" kovalar={facets.sizes} secili={sorgu.beden} />
      <FasetGrubu baslik="Mağaza" alan="marka" kovalar={facets.brands} secili={sorgu.marka} />

      <div className="flex items-center gap-3 border-t border-kenar pt-4">
        <Button type="submit" size="sm">
          Uygula
        </Button>
        {/* Temizleme bir gönderim değil, adres — "hiç filtre yok" hâli tek URL'dir. */}
        <Link
          href={listeBaglantisi(
            yol,
            sorgu,
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
          className="text-metin-soluk hover:text-metin hover:underline"
        >
          Temizle
        </Link>
      </div>
    </form>
  );
}

/**
 * ⚠️ FİYAT SINIRI TAM TL ALIR, KURUŞ DEĞİL. Kullanıcı "1500" yazar; kuruşa
 *    çevrim `liste-sorgusu.ts` içinde ve dizgi ekiyle yapılır. Buraya kuruş
 *    yazdırmak (150000) hem anlaşılmaz hem de ilk yanlış girişte sonuçları
 *    yüz katına taşır.
 *
 * ⚠️ `rakam` sınıfı burada da var: alanlara girilen tutar da bir tutardır ve
 *    orantısız rakam genişliği iki kutuyu farklı okutur.
 */
function FiyatAraligi({ sorgu }: { sorgu: ListeSorgusu }): React.ReactElement {
  return (
    <fieldset className="flex flex-col gap-2">
      {/* Para birimi BAŞLIKTA. Kutuların yanına konduğunda 240px'lik kenar
          çubuğunda taşıp kırpılıyordu (ekran görüntüsüyle görüldü). */}
      <legend className="mb-2 font-medium">Fiyat aralığı (₺)</legend>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          name="minFiyat"
          defaultValue={sorgu.minFiyat ?? ''}
          inputMode="numeric"
          pattern="\d*"
          placeholder="En az"
          aria-label="En düşük fiyat (TL)"
          className="rakam h-9 min-w-0"
        />
        <span aria-hidden className="text-metin-soluk">
          –
        </span>
        <Input
          name="maxFiyat"
          defaultValue={sorgu.maxFiyat ?? ''}
          inputMode="numeric"
          pattern="\d*"
          placeholder="En çok"
          aria-label="En yüksek fiyat (TL)"
          className="rakam h-9 min-w-0"
        />
      </div>
    </fieldset>
  );
}

interface FasetGrubuProps {
  baslik: string;
  alan: 'renk' | 'beden' | 'marka';
  kovalar: FacetBucketWire[];
  secili: string[];
}

/**
 * ⚠️ SEÇİLİ AMA KOVA LİSTESİNDE OLMAYAN DEĞER YİNE ÇİZİLİR. Fasetler sonuç
 *    kümesi ÜZERİNDEN sayılıyor; dar bir filtrede seçtiğiniz değerin kendisi
 *    listeden düşebiliyor. Düşerse onay kutusu kaybolur ve kullanıcı seçtiği
 *    filtreyi KALDIRAMAZ — ekran kilitlenir. Bu yüzden birleştiriliyor.
 */
function FasetGrubu({ baslik, alan, kovalar, secili }: FasetGrubuProps): React.ReactElement | null {
  const eksikler = secili
    .filter((deger) => !kovalar.some((kova) => kova.value === deger))
    .map((deger) => ({ value: deger, label: deger, count: 0 }));
  const tumu = [...kovalar, ...eksikler];

  if (tumu.length === 0) return null;

  return (
    <fieldset className="border-t border-kenar pt-4">
      <legend className="mb-2 font-medium">{baslik}</legend>
      {/* Sınırlı yükseklik + kaydırma: liste kırpılmıyor, panel de taşmıyor. */}
      <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
        {tumu.map((kova) => (
          <label key={kova.value} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              name={alan}
              value={kova.value}
              defaultChecked={secili.includes(kova.value)}
              className="size-4 accent-metin"
            />
            <span className="flex-1 truncate">{kova.label}</span>
            {kova.count > 0 ? (
              <span className="rakam text-xs text-metin-soluk">{kova.count}</span>
            ) : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
