import type { BadgeProps } from '@/components/ui/badge';
import type {
  ConsentTypeWire,
  OrderStatusWire,
  PackageStatusWire,
  ReturnReasonWire,
  ReturnStatusWire,
  WardrobeCategoryWire,
} from '@vt/contracts';

/**
 * DURUM → METİN + RENK.
 *
 * ⚠️ TÜM TABLOLAR `satisfies Record<…>` İLE KAPALI. Sunucuya yeni bir durum
 *    eklendiği gün bu dosya DERLENMEZ. Varsayılan bir dal (`?? 'notr'`)
 *    yazılsaydı yeni durum sessizce gri bir rozet olurdu ve kimse fark etmezdi
 *    — bu depoda üç kez yaşanan "kopuk bağlantı" hatasının tam deseni.
 *
 * ⚠️ RENK YALNIZCA DURUM TAŞIR (design-system.md). Buradaki renkler sipariş,
 *    paket, iade ve rıza DURUMLARIDIR — yani tam olarak rengin izinli olduğu
 *    yer. Başlık, ikon, sekme, kart kenarlığı bu dosyadan renk ALMAZ.
 */
type Rozet = NonNullable<BadgeProps['durum']>;

interface Durum {
  metin: string;
  rozet: Rozet;
}

/**
 * ⚠️ `PENDING_PAYMENT` "uyari": kullanıcının YAPACAK bir işi var (ödeme).
 *    "notr" olsaydı ekranda bekleyen ödeme, tamamlanmış siparişle aynı sessiz
 *    tonda görünürdü ve rezervasyon süresi dolardı.
 */
export const SIPARIS_DURUMU = {
  PENDING_PAYMENT: { metin: 'Ödeme bekleniyor', rozet: 'uyari' },
  PAYMENT_FAILED: { metin: 'Ödeme başarısız', rozet: 'tehlike' },
  EXPIRED: { metin: 'Süresi doldu', rozet: 'tehlike' },
  PAID: { metin: 'Ödendi', rozet: 'olumlu' },
  PARTIALLY_SHIPPED: { metin: 'Kısmen kargoda', rozet: 'notr' },
  SHIPPED: { metin: 'Kargoda', rozet: 'notr' },
  DELIVERED: { metin: 'Teslim edildi', rozet: 'olumlu' },
  COMPLETED: { metin: 'Tamamlandı', rozet: 'olumlu' },
  CANCELLED: { metin: 'İptal edildi', rozet: 'tehlike' },
  REFUNDED: { metin: 'İade edildi', rozet: 'uyari' },
} satisfies Record<OrderStatusWire, Durum>;

export const PAKET_DURUMU = {
  AWAITING_APPROVAL: { metin: 'Satıcı onayı bekleniyor', rozet: 'uyari' },
  PREPARING: { metin: 'Hazırlanıyor', rozet: 'notr' },
  SHIPPED: { metin: 'Kargoda', rozet: 'notr' },
  DELIVERED: { metin: 'Teslim edildi', rozet: 'olumlu' },
  CANCELLED: { metin: 'İptal edildi', rozet: 'tehlike' },
  RETURN_REQUESTED: { metin: 'İade talebi açık', rozet: 'uyari' },
  RETURNED: { metin: 'İade alındı', rozet: 'uyari' },
} satisfies Record<PackageStatusWire, Durum>;

export const IADE_DURUMU = {
  REQUESTED: { metin: 'Talep alındı', rozet: 'uyari' },
  APPROVED: { metin: 'Onaylandı', rozet: 'notr' },
  REJECTED: { metin: 'Reddedildi', rozet: 'tehlike' },
  IN_TRANSIT: { metin: 'Yolda', rozet: 'notr' },
  RECEIVED: { metin: 'Satıcıya ulaştı', rozet: 'notr' },
  REFUNDED: { metin: 'Ücret iadesi yapıldı', rozet: 'olumlu' },
  CANCELLED: { metin: 'İptal edildi', rozet: 'tehlike' },
} satisfies Record<ReturnStatusWire, Durum>;

export const IADE_SEBEBI = {
  SIZE_TOO_SMALL: 'Beden küçük geldi',
  SIZE_TOO_LARGE: 'Beden büyük geldi',
  NOT_AS_DESCRIBED: 'Ürün açıklamaya uymuyor',
  DAMAGED: 'Ürün hasarlı geldi',
  WRONG_ITEM: 'Yanlış ürün gönderildi',
  CHANGED_MIND: 'Vazgeçtim',
  QUALITY: 'Kalitesi beklediğim gibi değil',
  OTHER: 'Diğer',
} satisfies Record<ReturnReasonWire, string>;

export const GARDIROP_KATEGORISI = {
  UPPER_BODY: 'Üst giyim',
  LOWER_BODY: 'Alt giyim',
  DRESS: 'Elbise',
  OUTERWEAR: 'Dış giyim',
  SHOES: 'Ayakkabı',
  JEWELRY: 'Takı',
  BAG: 'Çanta',
  ACCESSORY: 'Aksesuar',
} satisfies Record<WardrobeCategoryWire, string>;

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
