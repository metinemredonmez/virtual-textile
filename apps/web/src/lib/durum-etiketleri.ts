import {
  VARSAYILAN_LOCALE,
  type Locale,
  type OrderStatusWire,
  type PackageStatusWire,
  type ProductStatusWire,
  type ReturnReasonWire,
  type ReturnStatusWire,
  type SellerStatusWire,
} from '@vt/contracts';
import type { BadgeProps } from '@/components/ui/badge';
import { sozluk } from '@/i18n/sozluk';

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
 *    doğar (`(magaza)/account/_lib/etiketler.ts` ve
 *    `(satici)/seller/orders/_lib/etiketler.ts`).
 *
 * ⚠️ `satisfies Record<…>` ile kapalı: sunucuya yeni bir durum eklendiği gün bu
 *    dosya DERLENMEZ. `?? 'notr'` yazılsaydı yeni durum sessizce gri bir rozet
 *    olurdu — bu depoda üç kez yaşanan "kimse fark etmedi" deseninin aynısı.
 *
 * ═══ ÇOK DİLLİLİK ═══
 *
 * ⚠️ METİN SÖZLÜKTEN, ROZET BURADAN. Ayrım keyfi değil: rozet rengi bir
 *    DAVRANIŞ kararı ve dile göre değişmez. Sözlüğe konsaydı iki dilde farklı
 *    renk vermek MÜMKÜN olurdu ve `design-system.md`in "renk yalnızca DURUM
 *    taşır" kuralı ölçülemez hâle gelirdi.
 *
 * ⚠️ ESKİ SABİTLER (`URUN_DURUMU` vb.) KOPYA DEĞİL, TÜRETİLMİŞ. Onlarca çağrı
 *    yeri bugün bu adları okuyor ve hepsini aynı turda değiştirmek — üstelik o
 *    dosyalar şu anda taşınırken — kaçınılmaz bir çakışma olurdu. Sabitler
 *    Türkçe görünümü veriyor, dile duyarlı çağrılar fonksiyonu kullanıyor;
 *    ikisi de AYNI sözlükten besleniyor, yani ayrışmaları imkânsız.
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
const URUN_DURUMU_ROZET = {
  DRAFT: 'notr',
  PENDING_REVIEW: 'notr',
  PUBLISHED: 'olumlu',
  REJECTED: 'tehlike',
  ARCHIVED: 'notr',
} satisfies Record<ProductStatusWire, Rozet>;

export function urunDurumu(
  locale: Locale = VARSAYILAN_LOCALE,
): Record<ProductStatusWire, DurumGorunumu> {
  return gorunum(URUN_DURUMU_ROZET, sozluk(locale).durum.urun);
}

/** Türkçe görünüm — `urunDurumu('tr')`nin kısayolu, ikinci bir tablo DEĞİL. */
export const URUN_DURUMU = urunDurumu();

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
const SATICI_DURUMU_ROZET = {
  PENDING: 'notr',
  APPROVED: 'olumlu',
  SUSPENDED: 'uyari',
  REJECTED: 'tehlike',
} satisfies Record<SellerStatusWire, Rozet>;

export function saticiDurumu(
  locale: Locale = VARSAYILAN_LOCALE,
): Record<SellerStatusWire, DurumGorunumu> {
  return gorunum(SATICI_DURUMU_ROZET, sozluk(locale).durum.satici);
}

/** Türkçe görünüm — `saticiDurumu('tr')`nin kısayolu, ikinci bir tablo DEĞİL. */
export const SATICI_DURUMU = saticiDurumu();

/**
 * ═══ MÜŞTERİ DİLİNDEKİ DURUMLAR ═══
 *
 * Aşağıdaki üç tablo müşterinin gördüğü metindir ve İKİ ekran okur: müşterinin
 * kendi hesabı (`(magaza)/account`) ve yönetim paneli — çünkü yönetici destek
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
 *    `(satici)/seller/orders/_lib/etiketler.ts` ve
 *    `(satici)/seller/returns/_lib/etiketler.ts` içinde, gerekçesiyle birlikte.
 *
 * ⚠️ `PENDING_PAYMENT` "uyari": kullanıcının YAPACAK bir işi var (ödeme).
 *    "notr" olsaydı bekleyen ödeme, tamamlanmış siparişle aynı sessiz tonda
 *    görünürdü ve rezervasyon süresi dolardı.
 */
const SIPARIS_DURUMU_ROZET = {
  PENDING_PAYMENT: 'uyari',
  PAYMENT_FAILED: 'tehlike',
  EXPIRED: 'tehlike',
  PAID: 'olumlu',
  PARTIALLY_SHIPPED: 'notr',
  SHIPPED: 'notr',
  DELIVERED: 'olumlu',
  COMPLETED: 'olumlu',
  CANCELLED: 'tehlike',
  REFUNDED: 'uyari',
} satisfies Record<OrderStatusWire, Rozet>;

export function siparisDurumu(
  locale: Locale = VARSAYILAN_LOCALE,
): Record<OrderStatusWire, DurumGorunumu> {
  return gorunum(SIPARIS_DURUMU_ROZET, sozluk(locale).durum.siparis);
}

/** Türkçe görünüm — `siparisDurumu('tr')`nin kısayolu, ikinci bir tablo DEĞİL. */
export const SIPARIS_DURUMU = siparisDurumu();

const PAKET_DURUMU_ROZET = {
  AWAITING_APPROVAL: 'uyari',
  PREPARING: 'notr',
  SHIPPED: 'notr',
  DELIVERED: 'olumlu',
  CANCELLED: 'tehlike',
  RETURN_REQUESTED: 'uyari',
  RETURNED: 'uyari',
} satisfies Record<PackageStatusWire, Rozet>;

export function paketDurumu(
  locale: Locale = VARSAYILAN_LOCALE,
): Record<PackageStatusWire, DurumGorunumu> {
  return gorunum(PAKET_DURUMU_ROZET, sozluk(locale).durum.paket);
}

/** Türkçe görünüm — `paketDurumu('tr')`nin kısayolu, ikinci bir tablo DEĞİL. */
export const PAKET_DURUMU = paketDurumu();

const IADE_DURUMU_ROZET = {
  REQUESTED: 'uyari',
  APPROVED: 'notr',
  REJECTED: 'tehlike',
  IN_TRANSIT: 'notr',
  RECEIVED: 'notr',
  REFUNDED: 'olumlu',
  CANCELLED: 'tehlike',
} satisfies Record<ReturnStatusWire, Rozet>;

export function iadeDurumu(
  locale: Locale = VARSAYILAN_LOCALE,
): Record<ReturnStatusWire, DurumGorunumu> {
  return gorunum(IADE_DURUMU_ROZET, sozluk(locale).durum.iade);
}

/** Türkçe görünüm — `iadeDurumu('tr')`nin kısayolu, ikinci bir tablo DEĞİL. */
export const IADE_DURUMU = iadeDurumu();

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
export function iadeSebebi(locale: Locale = VARSAYILAN_LOCALE): Record<ReturnReasonWire, string> {
  return sozluk(locale).iadeSebebi;
}

/** Türkçe görünüm — ikinci bir tablo DEĞİL. */
export const IADE_SEBEBI = iadeSebebi();

/**
 * Rozet tablosu + sözlük dalını `{metin, rozet}` görünümüne birleştirir.
 *
 * ⚠️ Anahtar kümeleri iki tarafta da tam olmak zorunda; rozet tarafı
 *    `satisfies Record<…Wire, Rozet>` ile, sözlük tarafı `en.ts`in
 *    `satisfies Sozluk`u ve `sozluk.test.ts` ile kapalı. Yani sunucuya yeni bir
 *    durum eklendiğinde önce rozet tablosu derlemeyi kırar, çeviri eksikse de
 *    test kırılır — iki kapı, iki ayrı hata sınıfı.
 */
function gorunum<K extends string>(
  rozetler: Record<K, Rozet>,
  metinler: Record<K, string>,
): Record<K, DurumGorunumu> {
  const sonuc = {} as Record<K, DurumGorunumu>;
  for (const anahtar of Object.keys(rozetler) as K[]) {
    sonuc[anahtar] = { metin: metinler[anahtar], rozet: rozetler[anahtar] };
  }
  return sonuc;
}
