import { Bulunamadi } from '@/components/hata/bulunamadi';

/**
 * VİTRİN İÇİ 404 — `notFound()` çağıran sayfaların düştüğü yer.
 *
 * ⚠️ BU DOSYA TEK BAŞINA YETMEZ; ASIL DÜZELTME SİLİNEN DOSYALARDAYDI. ÖLÇÜLDÜ:
 *    `notFound()` bir Suspense sınırının ARDINDA çağrıldığında Next kabuğu
 *    zaten 200 ile göndermiş olur ve durum kodu artık DEĞİŞTİRİLEMEZ —
 *    `/kategori/yok-boyle` **HTTP 200** + "bulunamadı" gövdesi dönüyordu.
 *    Kullanıcı doğru ekranı görüyor, arama motoru uydurma her adresi
 *    indekslenebilir bir sayfa sanıyordu. Bu yüzden `notFound()` çağıran
 *    rotaların üzerindeki iskeletler KALDIRILDI:
 *      • `(magaza)/loading.tsx`         → tüm grubu kapsıyordu
 *      • `urun/[slug]/loading.tsx`      → ürün 404'ünü yutuyordu
 *      • `urun/[slug]/dene/loading.tsx` → deneme kapısının 404'ünü yutuyordu
 *    ÖLÇÜM (sonra): `/kategori/yok-boyle` → 404, `/urun/yok-boyle` → 404.
 *
 * ⚠️ YENİ BİR `loading.tsx` EKLERKEN: o segmentin altında `notFound()` çağıran
 *    bir sayfa varsa iskelet, o sayfanın durum kodunu 200'e sabitler. 404
 *    üretmeyen ekranlarda (`/urunler`, `/sepet`, `/odeme`, `/hesabim`) iskelet
 *    duruyor ve sorun yok. 404 üreten bir rotada iskelet isteniyorsa çözüm
 *    `generateStaticParams` + `dynamicParams: false` — `koleksiyon/[koleksiyon]`
 *    ve `hukuki/[belge]` bu yolu kullanıyor.
 *
 * ⚠️ `hesabim/loading.tsx` BİLEREK DURUYOR: altındaki `siparisler/[siparisNo]`
 *    `notFound()` çağırıyor ve orada da yumuşak 404 üretiyor — ama o ekran
 *    girişin arkasında, indekslenmiyor. Bedeli SEO değil, yalnızca yanlış
 *    durum kodu; karşılığında hesap ekranlarının iskeleti korunuyor.
 */
export default function VitrinBulunamadi(): React.ReactElement {
  return <Bulunamadi />;
}
