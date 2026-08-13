import type { SiteImageSlotWire } from '@vt/contracts';

/**
 * EKRANA ÖZGÜ SABİTLER.
 *
 * ⚠️ SLOT LİSTESİ BURADA YOK ve yazılmayacak: tek kaynak `@vt/config`
 *    (`SITE_IMAGE_SLOTS`), uç şeması Zod enum'ını oradan TÜRETİYOR
 *    (`admin-site-image.schema.ts`). Ekran ikinci bir liste tutsaydı config'e
 *    dördüncü bir yüzey eklendiğinde sekme çıkmaz, hata da vermezdi.
 *
 * ⚠️ SLOT ETİKETLERİ DE BURADA DEĞİL, SÖZLÜKTE (`siteGorselleri.slot.*`).
 *    Bir ara burada bir `Record` olarak duruyordu; `gomulu-metin.test.ts`
 *    circiri onu doğru biçimde ÇEVİRİ BORCU olarak saydı — kullanıcının
 *    gördüğü metin, `.ts` sabitine taşınmakla çevrilmiş olmuyor.
 *
 * ⚠️ Tel tipleri (`AdminSiteImageWire`, `SiteImageCardWire`) `@vt/contracts`ten
 *    gelir, burada YENİDEN TANIMLANMAZ.
 */

/**
 * Slot → hedefin ne olduğu.
 *
 * ⚠️ ÇEVİRİ BORCU DEĞİL: bu üç değer ekranda GÖRÜNMEZ, hangi seçicinin
 *    çizileceğini seçer. Tek yerde olmasının sebebi, `if (slot === 'HERO')`
 *    dallanmasının üç ayrı dosyaya dağılmaması — dördüncü yüzey eklendiğinde
 *    biri güncellenir diğeri unutulurdu.
 */
export const SLOT_HEDEFI: Record<SiteImageSlotWire, 'yok' | 'kategori' | 'koleksiyon'> = {
  HERO: 'yok',
  CATEGORY_COVER: 'kategori',
  COLLECTION_COVER: 'koleksiyon',
};

/** Ekranın kendi adresi — sekme bağlantıları ve `donusYolu` buradan. */
export const SITE_GORSELLERI_YOLU = '/admin/site-gorselleri';
