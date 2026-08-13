import type { ConsentTypeWire } from '@vt/contracts';

/**
 * HESAP EKRANLARININ ETİKETLERİ.
 *
 * ⚠️ RENK YALNIZCA DURUM TAŞIR (design-system.md). Başlık, ikon, sekme, kart
 *    kenarlığı bu dosyadan renk ALMAZ.
 */

/**
 * ⚠️ SİPARİŞ / PAKET / İADE DURUMU VE İADE SEBEBİ BURADA TANIMLI DEĞİL.
 *    `src/lib/durum-etiketleri.ts`e taşındılar çünkü yönetim paneli de AYNI
 *    metinleri okuyor (destek çağrısında yönetici müşterinin GÖRDÜĞÜ cümleye
 *    bakmak zorunda) ve iki kopya vardı. Buradan yeniden dışa vuruluyorlar:
 *    hesap ekranları tek yerden okusun, ama tanım tek yerde kalsın.
 */
export {
  IADE_DURUMU,
  IADE_SEBEBI,
  PAKET_DURUMU,
  SIPARIS_DURUMU,
  type DurumGorunumu,
} from '@/lib/durum-etiketleri';

/**
 * GARDIROP KATEGORİSİ — ⚠️ AYNI SEKİZ ANAHTARI ÇEVİREN TABLO ÜÇ YERDEYDİ
 *    (burası, hesaplayıcı, yönetim kategori ekranı). Tek ev
 *    `components/tryon/kategori-etiketleri.ts`; burada yalnız yeniden dışa
 *    vurum var, çünkü gardırop ekranı bu tabloyu `WardrobeCategoryWire` ile
 *    indeksliyor ve o tip bugün `TryOnCategoryName` ile aynı sekiz değeri
 *    taşıyor. Ayrıştıkları gün DERLEME KIRILIR — istenen davranış budur.
 */
export { TRYON_KATEGORI_ETIKETI as GARDIROP_KATEGORISI } from '@/components/tryon/kategori-etiketleri';

/**
 * RIZA METİNLERİ.
 *
 * ⚠️ `aciklama` alanı SÜS DEĞİL. KVKK açık rızayı "BİLGİLENDİRİLMEYE dayanan"
 *    beyan olarak tanımlıyor (md.3): yalnızca `MARKETING` yazan bir anahtar,
 *    hukuken geçerli bir rıza toplamaz. Metin kısaltılacaksa hukuk onayıyla
 *    kısaltılır.
 *
 * ⚠️ `CROSS_BORDER_TRANSFER` AYRI bir satır ve ayrı bir anahtar; fotoğraf
 *    işleme rızasının içine gömülemez. Backend de ayrı kod döndürüyor
 *    (`CONSENT_CROSS_BORDER_REQUIRED`).
 */
export const RIZA_METNI = {
  PHOTO_PROCESSING: {
    baslik: 'Fotoğrafımın işlenmesi',
    aciklama:
      'Yüklediğiniz fotoğrafın sanal deneme görüntüsü üretmek için işlenmesine izin verirsiniz. Bu rıza olmadan sanal deneme çalışmaz.',
  },
  CROSS_BORDER_TRANSFER: {
    baslik: 'Yurt dışına aktarım',
    aciklama:
      'Sanal deneme sağlayıcısı yurt dışında bulunduğu için fotoğrafınız işlenmek üzere yurt dışına aktarılır. Ayrı bir rızadır; yalnızca bunu geri çekmek de sanal denemeyi durdurur.',
  },
  PHOTO_STORAGE: {
    baslik: 'Fotoğrafımın saklanması',
    aciklama:
      'Fotoğrafınız profilinizde saklanır ve sonraki denemelerde yeniden yüklemeniz gerekmez. Kapalıysa fotoğraf tek kullanımlıktır ve 24 saat içinde silinir.',
  },
  MODEL_TRAINING: {
    baslik: 'Model geliştirmede kullanım',
    aciklama:
      'Fotoğraflarınızın sanal deneme kalitesini geliştirmek için kullanılmasına izin verirsiniz. Tamamen isteğe bağlıdır; kapalı olması hizmetin hiçbir bölümünü kısıtlamaz.',
  },
  MARKETING: {
    baslik: 'Ticari elektronik ileti',
    aciklama:
      'Kampanya ve indirim duyurularını e-posta veya SMS ile almak istediğinizi belirtirsiniz. Sipariş ve kargo bildirimleri bu rızaya bağlı değildir; onlar her hâlükârda gönderilir.',
  },
} satisfies Record<ConsentTypeWire, { baslik: string; aciklama: string }>;

/**
 * Geri çekildiğinde FOTOĞRAFLARI silinmeye gönderen rızalar.
 *
 * ⚠️ Kaynağı `consent.history.ts` → `PHOTO_BEARING_CONSENTS`. Burada ikinci bir
 *    kopya duruyor çünkü o dosya `apps/api` içinde ve web ondan import edemez.
 *    Kopya OLDUĞU açıkça yazılıyor: sapması hâlinde kullanıcıya yanlış uyarı
 *    gösterilir, davranış değişmez — karar sunucudadır.
 */
export const FOTOGRAF_TASIYAN_RIZALAR: readonly ConsentTypeWire[] = [
  'PHOTO_PROCESSING',
  'CROSS_BORDER_TRANSFER',
];
