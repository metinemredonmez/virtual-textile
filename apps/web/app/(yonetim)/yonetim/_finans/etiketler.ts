import type { AiFeatureWire, CommissionScopeWire, PayoutStatusWire } from '@vt/contracts';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * YÖNETİME ÖZGÜ ETİKETLER.
 *
 * ⚠️ MÜŞTERİ DİLİNDEKİ DURUM TABLOLARI BURADA DEĞİL. `SIPARIS_DURUMU`,
 *    `PAKET_DURUMU` ve `IADE_DURUMU` bir dönem burada BİREBİR ikinci kopya
 *    olarak duruyordu; `src/lib/durum-etiketleri.ts`e taşındılar ve bu dosya
 *    onları yeniden dışa vuruyor, yeniden TANIMLAMIYOR. Yeniden vurma sebebi
 *    ekranların tek yerden okuması; kopya olsaydı metinler ayrışabilirdi.
 *
 * ⚠️ RENK YALNIZCA DURUM TAŞIR. Kapsam (`KAPSAM_ADI`) ve AI özelliği
 *    (`AI_OZELLIGI`) durum değil, SINIFLANDIRMADIR; düz metin dönerler, rozet
 *    değil.
 */
export {
  IADE_DURUMU,
  PAKET_DURUMU,
  SIPARIS_DURUMU,
  type DurumGorunumu,
} from '@/lib/durum-etiketleri';

type Rozet = NonNullable<BadgeProps['durum']>;

export interface Durum {
  metin: string;
  rozet: Rozet;
}

/**
 * PAYOUT DURUMU.
 *
 * ⚠️ `APPROVED` metni "Ödendi" DEĞİL, "Onaylandı — gönderim bekliyor".
 *    Ölçüldü: `SellerFinanceService.recordPayoutSettlement` yazılmış ama
 *    ÇAĞIRANI YOK, ve `status: 'SENT'` yazan tek satır bile yok. Yani onay
 *    parayı göndermiyor, defterde `PAYOUT` satırı oluşmuyor, satıcının bakiyesi
 *    azalmıyor. "Ödendi" yazmak, olmamış bir para hareketini olmuş göstermek
 *    olurdu.
 *
 * ⚠️ `SENT` ve `FAILED` bugün ULAŞILAMAZ durumlardır (onları yazan kod yok).
 *    Yine de tabloda duruyorlar: enum'da varlar, gönderim işçisi yazıldığı gün
 *    ekranın kendiliğinden doğru davranması gerekiyor.
 */
export const PAYOUT_DURUMU = {
  REQUESTED: { metin: 'Karar bekliyor', rozet: 'uyari' },
  APPROVED: { metin: 'Onaylandı — gönderim bekliyor', rozet: 'notr' },
  SENT: { metin: 'Gönderildi', rozet: 'olumlu' },
  FAILED: { metin: 'Gönderim başarısız', rozet: 'tehlike' },
  CANCELLED: { metin: 'Reddedildi', rozet: 'tehlike' },
} satisfies Record<PayoutStatusWire, Durum>;

/**
 * ⚠️ RENK TAŞIMAZ — kapsam bir DURUM değil, kuralın kime uygulandığıdır.
 *    Rozet yapılsaydı komisyon listesinde her satır renkli olur ve gerçek
 *    uyarı ("bugün yürürlükte oran yok") ayırt edilemezdi.
 */
export const KAPSAM_ADI = {
  PLATFORM: 'Platform varsayılanı',
  CATEGORY: 'Kategori',
  SELLER: 'Satıcı',
  SELLER_CATEGORY: 'Satıcı + kategori',
} satisfies Record<CommissionScopeWire, string>;

/**
 * ⚠️ YEDİ ANAHTAR. `SEARCH_NL` veritabanı enum'ında VAR ve panel onu
 *    döndürüyor; `admin.schema.ts` → `aiFeatureSchema` içinde YOK.
 *    Altı anahtarlı bir tablo yazılsaydı bugün ölçülen gerçek veri
 *    (`SEARCH_NL: 4 çağrı`) ekranda `undefined` olurdu.
 */
export const AI_OZELLIGI = {
  TRYON: 'Sanal deneme',
  STYLIST: 'Stil danışmanı',
  TAGGING: 'Otomatik etiketleme',
  DESCRIPTION: 'Ürün açıklaması',
  EMBEDDING: 'Vektör üretimi',
  MODERATION: 'İçerik denetimi',
  SEARCH_NL: 'Doğal dil arama',
} satisfies Record<AiFeatureWire, string>;

/**
 * Sipariş olay tipleri serbest metin (`OrderEvent.type` şemada `String`).
 * ⚠️ Bu yüzden `satisfies` YOK ve olmamalı: kapalı bir tablo, sunucunun
 *    yazabildiği her yeni olayda ekranı boş bırakırdı. Bilinmeyen tip HAM
 *    gösterilir — teknik ama doğru; uydurma bir Türkçe cümleden iyidir.
 */
const OLAY_ADI: Record<string, string> = {
  'order.created': 'Sipariş oluşturuldu',
  'payment.captured': 'Ödeme tahsil edildi',
  'payment.failed': 'Ödeme başarısız',
  'package.shipped': 'Paket kargoya verildi',
  'package.delivered': 'Paket teslim edildi',
  'order.cancelled': 'Sipariş iptal edildi',
  'return.requested': 'İade talebi açıldı',
  'return.approved': 'İade onaylandı',
  'return.rejected': 'İade reddedildi',
};

export function olayAdi(type: string): string {
  return OLAY_ADI[type] ?? type;
}

export const AKTOR_ADI = {
  SYSTEM: 'Sistem',
  CUSTOMER: 'Müşteri',
  SELLER: 'Satıcı',
  ADMIN: 'Yönetici',
} satisfies Record<'SYSTEM' | 'CUSTOMER' | 'SELLER' | 'ADMIN', string>;
