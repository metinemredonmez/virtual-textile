import { isApiFailure } from '@vt/contracts';
import { INVENTORY } from '@vt/config/constants';
import type { ProductStatusWire } from '@vt/contracts';
import { URUN_DURUMU, type DurumGorunumu } from '@/lib/durum-etiketleri';

/**
 * ÜRÜN DURUMU VE STOK — EKRANDAKİ KARŞILIKLARI.
 *
 * ⚠️ RENK YALNIZCA DURUM TAŞIR ve durum listesi DAR (`design-system.md`).
 *    Beş ürün durumundan yalnız İKİSİ renk alıyor:
 *      • PUBLISHED → olumlu  (vitrinde, satılabilir)
 *      • REJECTED  → tehlike (satıcının eylem alması gereken tek durum)
 *    DRAFT / PENDING_REVIEW / ARCHIVED nötr. "İncelemede"yi uyarı rengiyle
 *    boyamak yanlış olurdu: ortada bir sorun yok, sıra bekleniyor. Beş durumun
 *    beşi de renkliyse renk hiçbir şey söylemez ve gerçek uyarı (REJECTED)
 *    kalabalıkta kaybolur.
 */
interface DurumBilgisi extends DurumGorunumu {
  /** Satıcının o durumda ne beklediğini söyleyen tek cümle. */
  readonly aciklama: string;
}

/**
 * ⚠️ AÇIKLAMA CÜMLESİ YALNIZCA SATICININ GÖRDÜĞÜ ŞEY — bu yüzden burada.
 *    Etiket ve rozet rengi `lib/durum-etiketleri.ts`ten geliyor ve yönetim
 *    moderasyon kuyruğuyla AYNI tablodan okunuyor: bir dönem iki kopyaydılar,
 *    ayrıştıkları gün satıcı ürününü "İncelemede" görürken yönetici aynı satıra
 *    başka bir ad verirdi.
 */
const ACIKLAMALAR: Record<ProductStatusWire, string> = {
  DRAFT: 'Vitrinde görünmüyor. İncelemeye göndermeden yayına alınamaz.',
  PENDING_REVIEW: 'Ekibimizin onayı bekleniyor. Bu sırada düzenleme yapabilirsiniz.',
  PUBLISHED: 'Vitrinde görünüyor ve satın alınabilir.',
  REJECTED: 'Gerekçeyi giderip yeniden incelemeye gönderin.',
  ARCHIVED: 'Vitrinde görünmüyor. İncelemeye göndererek geri alabilirsiniz.',
};

export function urunDurumu(status: ProductStatusWire): DurumBilgisi {
  return { ...URUN_DURUMU[status], aciklama: ACIKLAMALAR[status] };
}

/** Sekme çubuğu — sıralama satıcının iş akışını izler: önce eli değecekler. */
export const DURUM_SEKMELERI: ReadonlyArray<{
  readonly deger: ProductStatusWire | null;
  readonly etiket: string;
}> = [
  { deger: null, etiket: 'Tümü' },
  { deger: 'DRAFT', etiket: 'Taslak' },
  { deger: 'PENDING_REVIEW', etiket: 'İncelemede' },
  { deger: 'PUBLISHED', etiket: 'Yayında' },
  { deger: 'REJECTED', etiket: 'Reddedildi' },
  { deger: 'ARCHIVED', etiket: 'Arşivde' },
];

export function durumMu(deger: string | undefined): deger is ProductStatusWire {
  return deger !== undefined && deger in URUN_DURUMU;
}

/**
 * STOK UYARISI — renk taşıyan beş şeyden biri.
 *
 * ⚠️ Eşik `INVENTORY.lowStockThreshold` (3) — ekrana rakam GÖMÜLMEZ. Sunucu
 *    "bu adedin altına düşünce satıcıya uyarı gider" diyor; arayüz farklı bir
 *    sayı kullanırsa satıcı bildirimi aldığında listede uyarı göremez.
 */
export function stokDurumu(satilabilir: number): DurumGorunumu | null {
  if (satilabilir <= 0) return { rozet: 'tehlike', metin: 'Tükendi' };
  if (satilabilir <= INVENTORY.lowStockThreshold) {
    return { rozet: 'uyari', metin: `Stok az · ${satilabilir}` };
  }
  return null;
}

export const CINSIYET_ETIKETLERI = {
  WOMAN: 'Kadın',
  MAN: 'Erkek',
  UNISEX: 'Unisex',
  KIDS: 'Çocuk',
} as const;

/**
 * "İncelemeye gönder" ÖNCESİ ENGELLER.
 *
 * ⚠️ ÖLÇÜLDÜ: `PATCH {status:'PENDING_REVIEW'}` bu koşullar sağlanmasa da
 *    KABUL EDİLİYOR; reddedilen yer admin onayı (`POST /admin/products/:id/
 *    approve` → 400, `details.fields`):
 *      aiTagsApproved → "Satıcı yapay zekâ etiketlerini onaylamadan ürün
 *                        yayınlanamaz."
 *      images         → "Yayınlanacak üründe en az bir görsel olmalı."
 *    Yani engel arayüzde gösterilmezse satıcı ürünü gönderir, sırada bekler ve
 *    günler sonra reddedilir. İki alan da `GET /seller/products` yanıtında var
 *    (`aiTagsApproved`, `imageKey`), yani bu kontrol liste ekranında da
 *    yapılabiliyor — detaya girmeye gerek yok.
 */
export function incelemeEngelleri(urun: {
  aiTagsApproved: boolean;
  imageKey: string | null;
}): string[] {
  const engeller: string[] = [];
  if (urun.imageKey === null) engeller.push('görsel eklenmemiş');
  if (!urun.aiTagsApproved) engeller.push('yapay zekâ etiketleri onaylanmamış');
  return engeller;
}

/**
 * Hata nesnesinden KULLANICI metnini alır.
 *
 * ⚠️ `error.message` DEĞİL: `ApiFailure` `Error.message`ı `"KOD: metin"`
 *    biçiminde LOG için kuruyor (`api-failure.ts:29`). Kullanıcıya gösterilecek
 *    metin `userMessage`tadır; karıştırmak ekrana `PAYOUT_PENDING_EXISTS: …`
 *    gibi bir satır basar.
 *
 * ⚠️ Tek gösterici `<HataGosterimi>`dir ve tek hata için o kullanılır. Bu
 *    yardımcı yalnızca N istekten K'sının patladığı, hata BAŞINA BİR SATIR
 *    gereken listelerde çağrılır.
 */
export function kullaniciMesaji(hata: unknown): string {
  if (isApiFailure(hata)) return hata.userMessage;
  return 'Beklenmeyen bir hata oluştu.';
}
