import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * 404 EKRANININ GÖVDESİ — TEK KOPYA.
 *
 * İki yerden çiziliyor ve ikisi de gerekli:
 *   `app/(magaza)/not-found.tsx` → `notFound()` çağıran sayfalar (kategori,
 *      ürün, hukuki belge). Vitrin kabuğunun İÇİNDE açılır.
 *   `app/not-found.tsx`          → hiçbir rotaya uymayan adresler ve
 *      `dynamicParams:false` olan rotaların yönlendirici düzeyindeki 404'ü
 *      (`/koleksiyon/canta` ölçüldü). Rota grubunun dışında olduğu için
 *      kabuğu kendisi kurar.
 * İkisinin metni ayrışırsa kullanıcı aynı hatada iki farklı ekran görür.
 *
 * ⚠️ BU DOSYA TEK BAŞINA YETMEZ, VE ASIL İŞ SİLİNEN DOSYALARDAYDI. ÖLÇÜLDÜ:
 *    `notFound()` bir Suspense sınırının ARDINDA çağrıldığında Next kabuğu
 *    zaten 200 ile göndermiş olur ve durum kodu artık DEĞİŞTİRİLEMEZ —
 *    `/kategori/yok-boyle` **HTTP 200** + "bulunamadı" gövdesi dönüyordu.
 *    Kullanıcı doğru ekranı görüyor, arama motoru uydurma her adresi
 *    indekslenebilir bir sayfa sanıyordu. Bu yüzden `notFound()` çağıran
 *    rotaların üzerindeki `loading.tsx` dosyaları KALDIRILDI:
 *      • `(magaza)/loading.tsx`        → tüm grubu kapsıyordu
 *      • `urun/[slug]/loading.tsx`     → ürün 404'ünü yutuyordu
 *      • `urun/[slug]/dene/loading.tsx`→ deneme kapısının 404'ünü yutuyordu
 *
 * ⚠️ YENİ BİR `loading.tsx` EKLERKEN: o segmentin altında `notFound()` çağıran
 *    bir sayfa varsa iskelet o sayfanın durum kodunu 200'e sabitler. İskelet
 *    gerçekten gerekiyorsa (`/urunler`, `/sepet`, `/odeme`, `/hesabim` gibi
 *    404 üretmeyen ekranlar) sorun yok; 404 üreten bir rotada iskelet istiyorsa
 *    çözüm `generateStaticParams` + `dynamicParams: false`
 *    (`koleksiyon/[koleksiyon]/page.tsx` bu yolu kullanıyor).
 */
export function Bulunamadi(): React.ReactElement {
  return (
    <div className="flex flex-col items-start gap-6 py-24">
      <div className="flex flex-col gap-3">
        {/* ⚠️ Renk YOK: "sayfa bulunamadı" bir hata durumu değil, bir adres
            sonucudur. Kırmızı kutu kullanıcıya bir şeyi bozduğunu düşündürür. */}
        <h1 className="text-3xl font-semibold tracking-tight">Bu sayfa bulunamadı.</h1>
        <p className="max-w-xl text-metin-soluk">
          Aradığınız adres değişmiş, ürün yayından kalkmış ya da bağlantı hatalı olabilir.
        </p>
      </div>

      {/* Boş durum NE YAPILACAĞINI söyler; "geri dön" demek yeterli değil. */}
      <div className="flex flex-wrap items-center gap-4">
        <Button asChild size="lg">
          <Link href="/urunler">Ürünlere göz atın</Link>
        </Button>
        <Link href="/koleksiyon" className="text-sm text-vurgu hover:underline">
          Koleksiyonlar
        </Link>
        <Link href="/kategori" className="text-sm text-vurgu hover:underline">
          Tüm kategoriler
        </Link>
      </div>
    </div>
  );
}
