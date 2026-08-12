import type { ReturnStatusWire } from '@vt/contracts';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * İADE DURUMU — SATICININ DİLİ.
 *
 * ⚠️ `IADE_SEBEBI` BURADA TANIMLI DEĞİL, `lib/durum-etiketleri.ts`ten yeniden
 *    dışa vuruluyor. İkinci kopyaydı ve bedeli somuttu: metinler ayrışırsa
 *    müşteri "Beden küçük geldi" yazan bir talep gönderir, satıcı başka bir
 *    cümle okur ve ikisi aynı talebi konuşmadıklarını fark etmez.
 *
 * ⚠️ DURUM METİNLERİ İSE KOPYA DEĞİL, KARŞILIK: müşteri ekranındaki "Talep
 *    alındı" satıcı ekranında "Kararınız bekleniyor"dur — satıcının yapacak işi
 *    olduğunu söyleyen tek yer burası. Bu yüzden paylaşılana TAŞINMADI.
 */
type Rozet = NonNullable<BadgeProps['durum']>;

export interface Durum {
  metin: string;
  rozet: Rozet;
}

export const IADE_DURUMU = {
  /** Satıcının KARAR vermesi gereken tek durum → uyarı. */
  REQUESTED: { metin: 'Kararınız bekleniyor', rozet: 'uyari' },
  APPROVED: { metin: 'Onayladınız', rozet: 'notr' },
  REJECTED: { metin: 'Reddettiniz', rozet: 'tehlike' },
  IN_TRANSIT: { metin: 'Ürün yolda', rozet: 'notr' },
  RECEIVED: { metin: 'Ürün elinize ulaştı', rozet: 'notr' },
  REFUNDED: { metin: 'Müşteriye iade edildi', rozet: 'olumlu' },
  CANCELLED: { metin: 'Müşteri vazgeçti', rozet: 'notr' },
} satisfies Record<ReturnStatusWire, Durum>;

export { IADE_SEBEBI } from '@/lib/durum-etiketleri';

/** Süzgeç sekmelerinin sırası — satıcının işi olan durum başta. */
export const SUZGEC_SIRASI: readonly ReturnStatusWire[] = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'IN_TRANSIT',
  'RECEIVED',
  'REFUNDED',
  'CANCELLED',
];
