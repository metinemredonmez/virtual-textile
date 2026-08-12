import Link from 'next/link';
import type { Metadata } from 'next';
import { ALL_TRYON_CATEGORIES, TRYONABLE_CATEGORIES } from '@vt/config/constants';
import type { TryOnCategoryName } from '@vt/config/constants';
import { Button } from '@/components/ui/button';
import { Hesaplayici } from './hesaplayici';
import { VARSAYIM_TANIMLARI } from './varsayimlar';

/**
 * TRY-ON HESAPLAYICI — satıcıya yönelik sayfa.
 *
 * ⚠️ BU SAYFANIN İŞİ SATMAK DEĞİL, BÜYÜKLÜK VERMEKTİR. Uydurma kesinlik satan
 *    bir hesaplayıcı ilk gerçek müşteride tutmaz ve o an kaybedilen şey
 *    hesaplayıcı değil, ürünün tamamına duyulan güvendir. Bu yüzden:
 *      • varsayımlar sayfada AÇIKÇA yazılı ve DEĞİŞTİRİLEBİLİR,
 *      • sonuç tek sayı değil ARALIK,
 *      • "tahmindir, garanti değildir" cümlesi sonuçların yanında duruyor,
 *      • satıcının kendi verisinden çıkan taban, varsayımla üretilen tahminden
 *        görsel olarak AYRI.
 *
 * ⚠️ Sayfanın kendisi Sunucu Bileşenidir ve hiçbir API çağrısı yapmaz: hesap
 *    tamamen kullanıcının girdiğinden çıkar, sunucunun bilebileceği bir şey yok.
 *    Yalnızca form istemcide çalışır.
 */

const YOL = '/hesaplayici';

/**
 * ⚠️ `Record<TryOnCategoryName, string>` — TAM kapsam zorunlu. Sağlayıcı
 *    matrisine yeni bir kategori eklendiğinde bu tablo DERLENMEZ ve eksik etiket
 *    hemen görünür. Kategori adlarını düz metin olarak yazmak, matris
 *    değiştiğinde sayfanın eski listeyi göstermesi demekti — `TRYONABLE_CATEGORIES`
 *    zaten tam da bu yüzden elle yazılmıyor, matristen türetiliyor.
 */
const KATEGORI_ETIKETLERI: Record<TryOnCategoryName, string> = {
  UPPER_BODY: 'üst giyim',
  LOWER_BODY: 'alt giyim',
  DRESS: 'elbise',
  OUTERWEAR: 'dış giyim',
  SHOES: 'ayakkabı',
  JEWELRY: 'takı',
  BAG: 'çanta',
  ACCESSORY: 'aksesuar',
};

function etiketle(kategoriler: readonly TryOnCategoryName[]): string {
  return kategoriler.map((k) => KATEGORI_ETIKETLERI[k]).join(', ');
}

const KAPALI_KATEGORILER = ALL_TRYON_CATEGORIES.filter((k) => !TRYONABLE_CATEGORIES.includes(k));

const ACIKLAMA =
  'Sanal denemenin cironuza ve iade oranınıza tahmini etkisini kendi sayılarınızla hesaplayın. Kullanılan varsayımların tamamı sayfada açıkça yazılı ve değiştirilebilir.';

export const metadata: Metadata = {
  title: 'Try-On Hesaplayıcı',
  description: ACIKLAMA,
  alternates: { canonical: YOL },
  openGraph: {
    type: 'website',
    url: YOL,
    title: 'Try-On Hesaplayıcı · Virtual Textile',
    description: ACIKLAMA,
  },
};

export default function HesaplayiciPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-16 py-8">
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Try-On Hesaplayıcı</h1>
        <p className="text-metin-soluk">
          Sanal deneme mağazanızda ne kadar fark yaratır? Aşağıya kendi dört sayınızı yazın;
          hesaplayıcı bir aralık üretsin. Aralığın genişliği rahatsız edici gelebilir — o genişlik
          bilerek orada: elimizde bu sayıları daraltacak ölçüm henüz yok.
        </p>
      </section>

      <section>
        <Hesaplayici />
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">Varsayımlar nereden geliyor</h2>

        <p className="mt-4 text-sm text-metin-soluk">
          Açık konuşalım: bu sayılar{' '}
          <strong className="font-medium text-metin">bizim ölçümümüz değil</strong>. Platformda
          henüz gerçek satıcı trafiği yok, dolayısıyla &laquo;sanal deneme cironuzu şu kadar
          artırır&raquo; diyecek tek bir ölçülmüş veri noktamız bile bulunmuyor. Aşağıdaki
          aralıklar, sanal deneme sağlayıcılarının kendi yayımladıkları vaka çalışmalarında dolaşan
          büyüklüklerdir; bağımsız olarak doğrulanmamıştır ve sektöre, ürün fotoğrafı kalitesine,
          trafik kaynağına göre büyük ölçüde değişir.
        </p>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-kenar text-left">
                <th className="py-2 font-medium text-metin-soluk">Varsayım</th>
                <th className="py-2 text-right font-medium text-metin-soluk">Temkinli</th>
                <th className="py-2 text-right font-medium text-metin-soluk">İyimser</th>
              </tr>
            </thead>
            <tbody>
              {VARSAYIM_TANIMLARI.map((tanim) => (
                <tr key={tanim.anahtar} className="border-b border-kenar align-top">
                  <td className="py-3 pr-4">
                    <span className="font-medium text-metin">{tanim.etiket}</span>
                    <p className="mt-1 text-xs text-metin-soluk">{tanim.aciklama}</p>
                  </td>
                  <td className="rakam py-3 text-right">%{tanim.dusukBps / 100}</td>
                  <td className="rakam py-3 text-right">%{tanim.yuksekBps / 100}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-sm text-metin-soluk">
          İlk gerçek satıcı verisi geldiğinde bu tablo ölçümle değişir ve bu paragraf da onunla
          birlikte güncellenir. O güne kadar en doğru sayı, kendi mağazanızdan ölçtüğünüz sayıdır —
          hesaplayıcının altındaki bölümden varsayımların üçünü de değiştirebilirsiniz.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">Hesap nasıl yapılıyor</h2>

        <ol className="mt-4 flex list-decimal flex-col gap-3 pl-5 text-sm text-metin-soluk">
          <li>
            Aylık ziyaretçinin, &laquo;denemeyi kullanan ziyaretçi oranı&raquo; kadarı deneme yapar.
          </li>
          <li>
            Bu ziyaretçilerin, mevcut dönüşüm oranınız kadarı zaten sipariş verecekti; ek sipariş,
            yalnızca bu grubun üzerine gelen göreli artıştan sayılır.
          </li>
          <li>Ek ciro = ek sipariş × sepet ortalaması.</li>
          <li>
            İade düşüşü yalnızca <strong className="font-medium text-metin">denenerek</strong>{' '}
            alınan siparişlerin cirosuna uygulanır, kataloğun tamamına değil.
          </li>
        </ol>

        <p className="mt-4 text-sm text-metin-soluk">
          Sık yapılan hatayı bilerek yapmıyoruz: dönüşüm artışını tüm siparişlere uygulamak.
          Denemeye hiç dokunmamış ziyaretçileri kazanç hanesine yazmak, sonucu birkaç katına çıkarır
          ve hesabı anlamsızlaştırır.
        </p>

        <p className="mt-4 text-sm text-metin-soluk">
          Tutarlar kuruş cinsinden tam sayı olarak işlenir, oranlar basis point (%2,15 → 215) olarak
          taşınır; kayan noktalı sayı hiçbir adımda kullanılmaz. Adet hesapları her adımda aşağı
          yuvarlanır, yani sonuç iyimser tarafa değil temkinli tarafa kayar.
        </p>
      </section>

      <section className="rounded-md border border-kenar bg-yuzey p-6">
        <h2 className="text-sm font-semibold">Denemenin bugünkü kapsamı</h2>
        <p className="mt-2 text-sm text-metin-soluk">
          Sanal deneme bugün <span className="rakam">{TRYONABLE_CATEGORIES.length}</span> kategoride
          açık: {etiketle(TRYONABLE_CATEGORIES)}. {etiketle(KAPALI_KATEGORILER)} denenemiyor —
          sebebi tercih değil, kullandığımız modellerin bu kategoriler için eğitilmemiş olması. Bu
          ürünler mağazanızda satılmaya devam eder; yalnızca deneme düğmesi çıkmaz. Hesaplayıcıya
          yazacağınız ziyaretçi sayısını buna göre daraltmanız, sonucu gerçeğe yaklaştırır.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/satici">Satıcı paneline git</Link>
          </Button>
          <Button asChild variant="ikincil">
            <Link href="/koleksiyon">Koleksiyonları gör</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
