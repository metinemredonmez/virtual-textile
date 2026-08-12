import { Bulunamadi } from '@/components/hata/bulunamadi';
import MagazaLayout from './(magaza)/layout';

/**
 * KÖK 404 — hiçbir rotaya uymayan adresler.
 *
 * ⚠️ İKİ 404 DOSYASI VAR VE İKİSİ DE GEREKLİ. `(magaza)/not-found.tsx` yalnızca
 *    o rota grubunun İÇİNDEN `notFound()` çağrıldığında devreye girer; hiçbir
 *    rotaya uymayan bir adres (ya da `dynamicParams:false` olan bir rotanın
 *    yönlendirici düzeyindeki 404'ü — `/koleksiyon/canta` ölçüldü) grubun
 *    dışında kalır ve buraya düşer. Bu dosya olmasaydı aynı hata iki farklı
 *    ekran gösterirdi: biri vitrin kabuğunda Türkçe, diğeri Next'in İngilizce
 *    varsayılanı.
 *
 * ⚠️ Vitrin düzeni BURADA ELLE sarmalanıyor: kök `not-found.tsx` rota
 *    gruplarının düzenlerini MİRAS ALMAZ, yalnızca `app/layout.tsx`i alır.
 *    Sarmalanmasaydı 404 ekranında ne başlık ne gezinme olurdu — yani
 *    kullanıcının çıkabileceği tek kapı sayfa gövdesindeki bağlantılar olurdu.
 */
export default function KokBulunamadi(): React.ReactElement {
  return (
    <MagazaLayout>
      <Bulunamadi />
    </MagazaLayout>
  );
}
