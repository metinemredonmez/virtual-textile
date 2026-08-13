import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SITE_IMAGE_SLOTS } from '@vt/config/constants';
import type { AdminCategoryWire, AdminSiteImageWire, SiteImageSlotWire } from '@vt/contracts';
import { SunucuHatasi } from '@/components/hata/sunucu-hatasi';
import { BosSonuc, SayfaBasligi, Sekmeler } from '@/components/panel/duzen';
import { listeOku } from '@/lib/api/okuma';
import { baglanti, tekil, type AramaParametreleri } from '@/lib/sorgu';
import { SITE_GORSELLERI_YOLU, SLOT_HEDEFI } from './_lib/tipler';
import { KOLEKSIYON_LISTESI } from '../../../(magaza)/collection/koleksiyonlar';
import { AfisYukle } from './afis-yukle';
import { GorselSatiri } from './gorsel-satiri';

/**
 * SİTE GÖRSELLERİ — ADMİNDEN YÖNETİLEN VİTRİN AFİŞİ VE KAPAKLAR.
 *
 * Bugün ana sayfadaki vitrin görseli İLK ÜRÜNÜN fotoğrafı; yönetici seçemiyor.
 * Bu ekran o seçimi veriyor. Yönetilen yüzey ÜÇ ve hepsi tek tablodan gelir:
 * vitrin afişi, kategori kapağı, koleksiyon kapağı.
 *
 * ⚠️ BU BİR CMS DEĞİL ve olmayacak. Rastgele bölüm/sayfa/blok düzenleyici YOK.
 *    Yeni bir yüzey, `@vt/config`teki slot listesine tek satır + yazma
 *    doğrulaması + sözlükte bir etiket demek; migration gerektirmez.
 *
 * ⚠️ BOŞ DURUM SİTEYİ KIRMAZ ve bu ekranın en önemli cümlesi o: afiş
 *    tanımlanmamışsa ana sayfa bugünkü davranışına (ilk ürünün görseli) düşer.
 *    Yönetici hiçbir şey yapmadan da site çalışır — boş durum metni bunu
 *    SÖYLER (`siteGorselleri.bos.HEROAciklama`), yoksa yönetici "sayfa bozuldu
 *    mu" diye bakar.
 *
 * ⚠️ DETAY SAYFASI (`/site-gorselleri/[id]`) BİLEREK YOK. İkinci bir rota,
 *    ikinci bir menü satırı ve ikinci bir test yüzeyi demekti; yönetilen alan
 *    dört metin kutusu kadar ve satır içinde duruyor.
 *
 * ⚠️ SAYFALAMA YOK ÇÜNKÜ UÇTA YOK: `siteImageListQuerySchema` yalnız `slot`
 *    alıyor, imleç almıyor. Uydurma bir "sonraki sayfa" bağlantısı olmayan bir
 *    yeteneği varmış gibi göstermek olurdu. Kategori kapağı sayısı kategori
 *    sayısına yaklaşırsa uçta imleç açılması gerekir; o gün buraya
 *    `ImlecSayfalama` eklenir.
 */
export const metadata: Metadata = {
  title: 'Site görselleri',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** `?slot=` geçersizse ilk slot. */
function slotOku(ham: string | null): SiteImageSlotWire {
  const bulunan = SITE_IMAGE_SLOTS.find((aday) => aday === ham);
  return bulunan ?? SITE_IMAGE_SLOTS[0];
}

export default async function SiteGorselleriPage({
  searchParams,
}: {
  searchParams: Promise<AramaParametreleri>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const t = await getTranslations('siteGorselleri');
  const slot = slotOku(tekil(params.slot));
  const donusYolu = baglanti(SITE_GORSELLERI_YOLU, { slot });

  const okuma = await listeOku<AdminSiteImageWire, '/admin/site-images'>(
    '/admin/site-images',
    donusYolu,
    { query: { slot } },
  );

  /**
   * Kategori listesi hem yükleme formu hem satır etiketi için gerekiyor:
   * `CATEGORY_COVER`ın hedefi `Category.id` ve yöneticiye kimlik okutulamaz.
   *
   * ⚠️ YALNIZCA O SEKMEDE ÇEKİLİYOR. Her sekmede çekilseydi vitrin afişi ekranı
   *    hiç kullanılmayacak 300+ satırlık bir yanıtı her açılışta beklerdi —
   *    sayfa `force-dynamic`, yani bu gecikme HER görüntülemede ödenir.
   *
   * ⚠️ HATASI SAYFAYI ÇÖKERTMEZ: kategori okuması düşerse görsel listesi yine
   *    görünür, yalnızca yeni kapak yüklenemez ve sebebi formda yazar.
   */
  const kategoriler =
    slot === 'CATEGORY_COVER'
      ? await listeOku<AdminCategoryWire, '/admin/categories'>('/admin/categories', donusYolu)
      : null;

  const kategoriSecenekleri =
    kategoriler !== null && kategoriler.tamam
      ? kategoriler.veri.items.map((kategori) => ({
          deger: kategori.id,
          etiket: `${kategori.name} (/${kategori.slug})`,
        }))
      : [];

  const koleksiyonSecenekleri = KOLEKSIYON_LISTESI.map((koleksiyon) => ({
    deger: koleksiyon.slug,
    // ⚠️ `baslik` DEĞİL `h1`: `baslik` bir `<title>` metni ("Denim — Üzerinizde
    //    Deneyin") ve seçenek listesinde okunmaz uzunlukta.
    etiket: `${koleksiyon.h1} (/${koleksiyon.slug})`,
  }));

  /**
   * `targetKey` → okunabilir ad.
   *
   * ⚠️ BU EŞLEME TELDE GELMİYOR ve gelmesi de gerekmiyor: kategori adı zaten bu
   *    sayfada, koleksiyon başlığı zaten kodda. Sözleşmeye `targetLabel`
   *    eklemek aynı bilginin ikinci kopyasını üretirdi.
   *
   * ⚠️ EŞLEŞME BULUNAMAZSA SATIR GİZLENMEZ. Kategori sonradan silinmişse okuma
   *    tarafı o kapağı yok sayıyor (sayfa kırılmıyor) ama yönetici "kapak niye
   *    çıkmıyor" sorusunun cevabını başka hiçbir yerde bulamaz.
   */
  const hedefEtiketleri = new Map<string, string>(
    (SLOT_HEDEFI[slot] === 'kategori' ? kategoriSecenekleri : koleksiyonSecenekleri).map(
      (secenek) => [secenek.deger, secenek.etiket],
    ),
  );

  return (
    <section>
      <SayfaBasligi baslik={t('baslik')} aciklama={t('aciklama')} />

      <Sekmeler
        etiket={t('yuzeySekmesi')}
        className="mb-6"
        sekmeler={SITE_IMAGE_SLOTS.map((aday) => ({
          etiket: t(`slot.${aday}`),
          yol: baglanti(SITE_GORSELLERI_YOLU, { slot: aday }),
          secili: aday === slot,
        }))}
      />

      {/*
        ⚠️ `key={slot}` BİR SÜS DEĞİL, DURUM SIFIRLAMANIN DOĞRU ARACI. Sekme
           değişince form aynı bileşen örneği olarak kalsaydı, kategori
           sekmesinde seçilmiş bir kategori KİMLİĞİ koleksiyon sekmesine taşınır
           ve slug bekleyen sunucuya gönderilirdi. `useEffect` içinde `setState`
           ile sıfırlamak aynı işi fazladan bir render turuyla yapardı; React'in
           kendi kuralı (ve `react-hooks/set-state-in-effect`) `key`i işaret
           ediyor.
      */}
      <AfisYukle
        key={slot}
        slot={slot}
        kategoriSecenekleri={kategoriSecenekleri}
        koleksiyonSecenekleri={koleksiyonSecenekleri}
        kategoriOkunamadi={kategoriler !== null && !kategoriler.tamam}
      />

      {!okuma.tamam ? (
        <SunucuHatasi govde={okuma.hata} className="mt-6" />
      ) : okuma.veri.items.length === 0 ? (
        <div className="mt-6">
          <BosSonuc baslik={t(`bos.${slot}`)} aciklama={t(`bos.${slot}Aciklama`)} />
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {okuma.veri.items.map((gorsel) => (
            <li key={gorsel.id}>
              <GorselSatiri
                gorsel={gorsel}
                hedefEtiketi={
                  gorsel.targetKey === null ? null : (hedefEtiketleri.get(gorsel.targetKey) ?? null)
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
