import type {
  OrderStatusWire,
  PackageStatusWire,
  ProductStatusWire,
  ReturnReasonWire,
  ReturnStatusWire,
  SellerStatusWire,
} from '@vt/contracts';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * DURUM → ETİKET + ROZET RENGİ. İKİ PANELİN ORTAK TABLOSU.
 *
 * ⚠️ RENK YALNIZCA DURUM TAŞIR ve izinli liste DAR (`design-system.md`): sipariş
 *    durumu, satıcı onay durumu, payout durumu, try-on eşiği, stok uyarısı.
 *    Menü ikonu, başlık, sekme ve kart kenarlığı bu dosyadan renk ALMAZ.
 *
 * ⚠️ BURADA YALNIZCA HER İKİ PANELİN DE AYNI ŞEKİLDE OKUDUĞU tablolar var.
 *    Ekrana göre DEĞİŞEN metinler bilerek dışarıda: müşteriye "Satıcı onayı
 *    bekleniyor" denen paket, satıcıya "Onayınız bekleniyor"dur. O ikisi kopya
 *    değil KARŞILIKtır ve birleştirilirse kime seslenildiğini bilmeyen bir ekran
 *    doğar (`(magaza)/hesabim/_lib/etiketler.ts` ve
 *    `(satici)/satici/siparisler/_lib/etiketler.ts`).
 *
 * ⚠️ `satisfies Record<…>` ile kapalı: sunucuya yeni bir durum eklendiği gün bu
 *    dosya DERLENMEZ. `?? 'notr'` yazılsaydı yeni durum sessizce gri bir rozet
 *    olurdu — bu depoda üç kez yaşanan "kimse fark etmedi" deseninin aynısı.
 */
type Rozet = NonNullable<BadgeProps['durum']>;

export interface DurumGorunumu {
  metin: string;
  rozet: Rozet;
}

/**
 * ÜRÜN DURUMU — satıcı katalog ekranı ve yönetim moderasyon kuyruğu AYNI
 * tabloyu okur.
 *
 * ⚠️ İKİ KOPYASI VARDI ve etiketleri bugün birebir aynıydı; ayrıştıkları gün
 *    satıcı ürününü "İncelemede" görürken yönetici aynı satıra başka bir ad
 *    verirdi ve destek çağrısında iki taraf aynı şeyi konuştuklarını anlamazdı.
 *
 * ⚠️ Beş durumdan YALNIZ İKİSİ renk taşır. DRAFT / PENDING_REVIEW / ARCHIVED
 *    birer ARA DURUMDUR; "İncelemede"yi uyarı rengiyle boyamak yanlış olurdu:
 *    ortada bir sorun yok, sıra bekleniyor. Beşi de renkliyse renk hiçbir şey
 *    söylemez ve gerçek uyarı (REJECTED) kalabalıkta kaybolur.
 */
export const URUN_DURUMU = {
  DRAFT: { metin: 'Taslak', rozet: 'notr' },
  PENDING_REVIEW: { metin: 'İncelemede', rozet: 'notr' },
  PUBLISHED: { metin: 'Yayında', rozet: 'olumlu' },
  REJECTED: { metin: 'Reddedildi', rozet: 'tehlike' },
  ARCHIVED: { metin: 'Arşivde', rozet: 'notr' },
} satisfies Record<ProductStatusWire, DurumGorunumu>;

/**
 * SATICI ONAY DURUMU.
 *
 * ⚠️ Her rengin AYRI bir anlamı olmak zorunda; aynı rengi iki farklı sebeple
 *    kullanmak sinyali harcar:
 *      PENDING   → nötr: bekleyen başvuru bir sorun değil, bir KUYRUK öğesidir.
 *      APPROVED  → olumlu.
 *      SUSPENDED → uyarı: GERİ ALINABİLİR (`SUSPENDED → APPROVED` geçişi var).
 *      REJECTED  → tehlike: kalıcı sonuç, satıcıya bildirim gitti.
 *    İkisi aynı rengi alsaydı yönetici listede askı ile reddi ayırt etmek için
 *    metni okumak zorunda kalır, yani rozet işe yaramazdı.
 */
export const SATICI_DURUMU = {
  PENDING: { metin: 'Başvuru bekliyor', rozet: 'notr' },
  APPROVED: { metin: 'Onaylı', rozet: 'olumlu' },
  SUSPENDED: { metin: 'Askıda', rozet: 'uyari' },
  REJECTED: { metin: 'Reddedildi', rozet: 'tehlike' },
} satisfies Record<SellerStatusWire, DurumGorunumu>;

/**
 * ═══ MÜŞTERİ DİLİNDEKİ DURUMLAR ═══
 *
 * Aşağıdaki üç tablo müşterinin gördüğü metindir ve İKİ ekran okur: müşterinin
 * kendi hesabı (`(magaza)/hesabim`) ve yönetim paneli — çünkü yönetici destek
 * çağrısında müşterinin GÖRDÜĞÜ cümleye bakmak zorundadır.
 *
 * ⚠️ İKİ BİREBİR KOPYASI VARDI. Bedeli metinler ayrıştığı gün ödenirdi: aynı
 *    sipariş müşteri ekranında "Kargoda", yönetim ekranında başka bir şey
 *    gösterir ve iki taraf aynı siparişi konuştuklarını anlamaz.
 *
 * ⚠️ SATICININ GÖRDÜĞÜ METİNLER BURADA DEĞİL ve buraya taşınmamalı:
 *    `AWAITING_APPROVAL` müşteriye "Satıcı onayı bekleniyor", satıcıya
 *    "Onayınız bekleniyor"dur. O ikisi kopya değil KARŞILIKtır; birleştirmek
 *    kime seslenildiğini bilmeyen bir ekran üretir. Satıcı tabloları
 *    `(satici)/satici/siparisler/_lib/etiketler.ts` ve
 *    `(satici)/satici/iadeler/_lib/etiketler.ts` içinde, gerekçesiyle birlikte.
 *
 * ⚠️ `PENDING_PAYMENT` "uyari": kullanıcının YAPACAK bir işi var (ödeme).
 *    "notr" olsaydı bekleyen ödeme, tamamlanmış siparişle aynı sessiz tonda
 *    görünürdü ve rezervasyon süresi dolardı.
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
} satisfies Record<OrderStatusWire, DurumGorunumu>;

export const PAKET_DURUMU = {
  AWAITING_APPROVAL: { metin: 'Satıcı onayı bekleniyor', rozet: 'uyari' },
  PREPARING: { metin: 'Hazırlanıyor', rozet: 'notr' },
  SHIPPED: { metin: 'Kargoda', rozet: 'notr' },
  DELIVERED: { metin: 'Teslim edildi', rozet: 'olumlu' },
  CANCELLED: { metin: 'İptal edildi', rozet: 'tehlike' },
  RETURN_REQUESTED: { metin: 'İade talebi açık', rozet: 'uyari' },
  RETURNED: { metin: 'İade alındı', rozet: 'uyari' },
} satisfies Record<PackageStatusWire, DurumGorunumu>;

export const IADE_DURUMU = {
  REQUESTED: { metin: 'Talep alındı', rozet: 'uyari' },
  APPROVED: { metin: 'Onaylandı', rozet: 'notr' },
  REJECTED: { metin: 'Reddedildi', rozet: 'tehlike' },
  IN_TRANSIT: { metin: 'Yolda', rozet: 'notr' },
  RECEIVED: { metin: 'Satıcıya ulaştı', rozet: 'notr' },
  REFUNDED: { metin: 'Ücret iadesi yapıldı', rozet: 'olumlu' },
  CANCELLED: { metin: 'İptal edildi', rozet: 'tehlike' },
} satisfies Record<ReturnStatusWire, DurumGorunumu>;

/*
 * ⚠️ PAYOUT DURUMU BURADA YOK ve bu bir eksik değil, bir KARAR. Satıcı ile
 *    yönetici aynı satırda farklı şey okur: `REQUESTED` satıcıya "Talep alındı"
 *    (bilgi), yöneticiye "Karar bekliyor" (İŞ). Tek tabloya indirilseydi
 *    biri için yanlış cümle olurdu. İki tablo da kendi ekranının `_lib`inde ve
 *    ikisi de aynı `PayoutStatusWire` ile kapalı — sunucuya yeni bir durum
 *    eklendiğinde İKİSİ birden derlemeyi kırar.
 */

/**
 * İADE SEBEBİ — MÜŞTERİNİN SEÇTİĞİ, SATICININ OKUDUĞU metin.
 *
 * ⚠️ İKİ KOPYASI VARDI (`hesabim/_lib/etiketler.ts` ve satıcı iade ekranı) ve
 *    bedeli somut olurdu: müşteri "Beden küçük geldi" yazan bir talep gönderir,
 *    satıcı başka bir cümle okur ve ikisi aynı talebi konuşmadıklarını fark
 *    etmez. Durum metinleri (talep alındı / kararınız bekleniyor) AYNI dosyada
 *    DEĞİL — onlar kime seslenildiğine göre farklı ve öyle kalmalı.
 */
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
