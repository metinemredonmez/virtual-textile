import type { BadgeProps } from '@/components/ui/badge';
import type { LedgerTypeWire, PayoutStatusWire } from '@vt/contracts';

/**
 * DEFTER TÜRÜ VE PAYOUT DURUMU → METİN.
 *
 * ⚠️ `satisfies Record<…>` ile kapalı: sunucuya yeni bir `LedgerType` veya
 *    `PayoutStatus` eklendiği gün BU DOSYA DERLENMEZ. Varsayılan bir dal
 *    yazılsaydı yeni tür deftere adsız bir satır olarak düşer ve satıcı parasının
 *    nereye gittiğini okuyamazdı.
 */
type Rozet = NonNullable<BadgeProps['durum']>;

export interface DefterTuru {
  metin: string;
  /**
   * Bu satır bir TERS KAYIT mı?
   *
   * ⚠️ Ekranın en kritik ayrımı. Defter APPEND-ONLY: iade olduğunda satış satırı
   *    SİLİNMEZ, karşısına ters işaretli yeni satırlar yazılır. Arayüz bunu
   *    göstermezse satıcı "satışım kayboldu" ya da "iki kez sayılmış" diye
   *    okur; ikisi de yanlış ve ikisi de destek çağrısı üretir.
   */
  tersKayit: boolean;
  /** Satırın altına yazılan tek cümlelik gerekçe. */
  aciklama: string;
}

export const DEFTER_TURU = {
  SALE: {
    metin: 'Satış',
    tersKayit: false,
    aciklama: 'Müşterinin ödediği ürün tutarı defterinize alacak olarak yazıldı.',
  },
  COMMISSION: {
    metin: 'Komisyon',
    tersKayit: false,
    aciklama: 'Platform komisyonu, satış anındaki oranla kesildi.',
  },
  SHIPPING_SHARE: {
    metin: 'Kargo payı',
    tersKayit: false,
    aciklama: 'Kargo bedelinin size düşen payı.',
  },
  REFUND: {
    metin: 'İade — satış geri alındı',
    tersKayit: true,
    aciklama: 'İade onaylandı; satış satırı silinmedi, karşısına ters kayıt yazıldı.',
  },
  COMMISSION_REVERSAL: {
    metin: 'İade — komisyon iadesi',
    tersKayit: true,
    aciklama: 'İade edilen kalemin komisyonu size geri verildi.',
  },
  SHIPPING_REVERSAL: {
    metin: 'İade — kargo payı iadesi',
    tersKayit: true,
    aciklama: 'İade edilen kalemin kargo payı size geri verildi.',
  },
  PAYOUT: {
    metin: 'Ödeme',
    tersKayit: false,
    aciklama: 'Hesabınıza yapılan ödeme; bakiyenizden düşer.',
  },
  ADJUSTMENT: {
    metin: 'Düzeltme',
    tersKayit: false,
    aciklama: 'Elle yapılan bakiye düzeltmesi.',
  },
} satisfies Record<LedgerTypeWire, DefterTuru>;

/** Özet dökümünün sabit sırası — `breakdown` anahtarlarının sırası garanti değil. */
export const DEFTER_TURU_SIRASI: readonly LedgerTypeWire[] = [
  'SALE',
  'COMMISSION',
  'SHIPPING_SHARE',
  'REFUND',
  'COMMISSION_REVERSAL',
  'SHIPPING_REVERSAL',
  'PAYOUT',
  'ADJUSTMENT',
];

export interface PayoutDurumu {
  metin: string;
  rozet: Rozet;
  aciklama: string;
}

/**
 * ⚠️ METİNLER BUGÜNKÜ BACKEND'E GÖRE YAZILDI, iyimser değil:
 *      • `APPROVED` "Ödendi" DEMEZ. Onay yalnızca talebi onaylar; ödemeyi
 *        gönderen bir işçi bugün YOK ve `PAYOUT` defter satırı hiç oluşmuyor.
 *        "Ödendi" yazsaydık satıcı parasını beklerken ödendi sanardı.
 *      • `SENT`/`FAILED` durumlarını yazan bir kod yolu da bugün yok; tanımlı
 *        oldukları için burada duruyorlar, tabloyu kapalı tutmak zorunda
 *        olduğumuz için.
 */
export const PAYOUT_DURUMU = {
  REQUESTED: {
    metin: 'Talep alındı',
    rozet: 'uyari',
    aciklama: 'Talebiniz yönetim onayı bekliyor.',
  },
  APPROVED: {
    metin: 'Onaylandı — ödeme hazırlanıyor',
    rozet: 'notr',
    aciklama: 'Talebiniz onaylandı. Ödeme gönderildiğinde bu satır güncellenir.',
  },
  SENT: {
    metin: 'Gönderildi',
    rozet: 'olumlu',
    aciklama: 'Ödeme bankanıza gönderildi.',
  },
  FAILED: {
    metin: 'Başarısız',
    rozet: 'tehlike',
    aciklama: 'Ödeme gönderilemedi. Hesap bilgilerinizi kontrol edip destek ile iletişime geçin.',
  },
  CANCELLED: {
    metin: 'İptal edildi',
    rozet: 'tehlike',
    aciklama: 'Talep yönetim tarafından reddedildi veya iptal edildi.',
  },
} satisfies Record<PayoutStatusWire, PayoutDurumu>;
