import type { PackageStatusWire } from '@vt/contracts';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * PAKET DURUMU → SATICI DİLİ.
 *
 * ⚠️ `(magaza)/account/_lib/etiketler.ts` içindeki `PAKET_DURUMU`nun KOPYASI
 *    DEĞİL, KARŞILIĞIDIR: metinler bilerek farklı. Müşteri ekranında
 *    `AWAITING_APPROVAL` "Satıcı onayı bekleniyor" diye okunur; satıcının
 *    kendisine aynı cümleyi göstermek, kime seslenildiğini bilmeyen bir ekran
 *    üretir. Aynı sebeple `CANCELLED` burada bir eylemin sonucudur, bir haber
 *    değil.
 *
 * ⚠️ `satisfies Record<PackageStatusWire, Durum>` — sunucuya yeni bir paket
 *    durumu eklendiği gün BU DOSYA DERLENMEZ. `?? 'notr'` yazılsaydı yeni durum
 *    sessizce gri bir rozet olurdu.
 *
 * ⚠️ Renk burada DURUM taşıyor, yani izinli olduğu tek yerde. Tablo başlığı,
 *    sekme ve ikonlar bu dosyadan renk ALMAZ.
 */
type Rozet = NonNullable<BadgeProps['durum']>;

export interface Durum {
  metin: string;
  rozet: Rozet;
}

export const PAKET_DURUMU = {
  /** Satıcının YAPACAK bir işi var → uyarı. Nötr olsaydı bekleyen sipariş, kapanmış siparişle aynı tonda görünürdü. */
  AWAITING_APPROVAL: { metin: 'Onayınız bekleniyor', rozet: 'uyari' },
  PREPARING: { metin: 'Hazırlanıyor', rozet: 'notr' },
  SHIPPED: { metin: 'Kargoya verildi', rozet: 'notr' },
  DELIVERED: { metin: 'Teslim edildi', rozet: 'olumlu' },
  CANCELLED: { metin: 'İptal edildi', rozet: 'tehlike' },
  RETURN_REQUESTED: { metin: 'İade talebi açık', rozet: 'uyari' },
  RETURNED: { metin: 'İade alındı', rozet: 'uyari' },
} satisfies Record<PackageStatusWire, Durum>;

/**
 * Liste süzgeci — sekme sırası ekranın önceliğidir.
 *
 * ⚠️ İlk iki sekme satıcının İŞİ olan durumlar; `sla` sekmesi ayrı bir sorgu
 *    parametresidir (durum değil), o yüzden ayrı tutuluyor.
 */
export const SUZGEC_SIRASI: readonly PackageStatusWire[] = [
  'AWAITING_APPROVAL',
  'PREPARING',
  'SHIPPED',
  'DELIVERED',
  'RETURN_REQUESTED',
  'RETURNED',
  'CANCELLED',
];
