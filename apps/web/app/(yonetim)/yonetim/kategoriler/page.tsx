import type { Metadata } from 'next';
import { ALL_TRYON_CATEGORIES, isTryOnSupported } from '@vt/config/constants';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { SayfaBasligi } from '@/components/panel/duzen';
import { listeOku } from '@/lib/api/okuma';
import type { AdminCategoryWire } from '@vt/contracts';
import { TRYON_KATEGORI_ETIKETI } from '@/components/tryon/kategori-etiketleri';
import { KategoriAgaci } from './agac';

/**
 * KATEGORİ YÖNETİMİ.
 *
 * ⚠️ SAYFALAMA YOK ÇÜNKÜ UÇTA YOK: `GET /admin/categories` ağacın tamamını tek
 *    yanıtta döndürüyor (`{ items }`, imleç yok). Ağacı parça parça çizmek
 *    zaten anlamsız olurdu — bir kategorinin yeri, üstlerini görmeden anlaşılmaz.
 *
 * ⚠️ SİLME YOK ve eklenmemeli: uç yok. Kategori silmek, altındaki ürünleri
 *    sahipsiz bırakır; sunucunun sunduğu tek "kaldırma" yolu `isActive: false`.
 */
export const metadata: Metadata = {
  title: 'Kategoriler',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * ⚠️ KAPALI KATEGORİ LİSTESİ TÜRETİLİR, ELLE YAZILMAZ. `TRYONABLE_CATEGORIES`
 *    sağlayıcı yetenek matrisinden hesaplanıyor; buraya "ayakkabı, takı, çanta,
 *    aksesuar" diye yazmak, matris değiştiğinde ekranın eski gerçeği anlatması
 *    demek olurdu (`docs/tryon-kategori-destegi.md`in açıkça uyardığı şey).
 */
const KAPALI_KATEGORILER = ALL_TRYON_CATEGORIES.filter((kategori) => !isTryOnSupported(kategori));

export default async function KategorilerPage(): Promise<React.ReactElement> {
  const okuma = await listeOku<AdminCategoryWire, '/admin/categories'>(
    '/admin/categories',
    '/yonetim/kategoriler',
  );

  return (
    <section>
      <SayfaBasligi
        baslik="Kategoriler"
        aciklama="Kategori ağacı komisyon kuralının kapsamını da belirler (kural bir kategoriye bağlanabilir), bu yüzden her değişiklik denetim kaydına yazılır."
      />

      {/*
        ⚠️ BU BLOK EKRANIN EN ÖNEMLİ CÜMLESİNİ TAŞIYOR. Sanal deneme
           kategorisi atamak, o kategoride deneme düğmesinin AÇILACAĞI anlamına
           gelmiyor; sekiz enum değerinden yalnız dördünü sağlayıcı
           giydirebiliyor. Uyarı hem burada (genel) hem de seçimin yanında
           (bağlamsal) duruyor: yalnız birinde olsaydı ya hiç okunmaz ya da
           yalnızca formu açan görürdü.
      */}
      <p className="mb-6 max-w-prose rounded-md border border-kenar bg-yuzey p-3 text-sm text-metin-soluk">
        Sanal deneme bugün yalnızca giysi kategorilerinde çalışıyor. Şu kategorilerde deneme{' '}
        <strong className="text-metin">kapalıdır</strong> ve kategori ataması bunu değiştirmez —
        sağlayıcının bu ürün tipleri için modeli yok:{' '}
        {KAPALI_KATEGORILER.map((kategori) =>
          TRYON_KATEGORI_ETIKETI[kategori].toLocaleLowerCase('tr'),
        ).join(', ')}
        . Ürünler bu kategorilerde satılır, yalnızca “Üzerimde Dene” düğmesi çıkmaz.
      </p>

      {!okuma.tamam ? (
        <SunucuHatasi govde={okuma.hata} />
      ) : okuma.veri.items.length === 0 ? (
        <p className="py-8 text-sm text-metin-soluk">
          Hiç kategori yok. Ürünler kategorisiz yayınlanamaz; önce bir kök kategori açın.
        </p>
      ) : (
        <KategoriAgaci kategoriler={okuma.veri.items} />
      )}
    </section>
  );
}
