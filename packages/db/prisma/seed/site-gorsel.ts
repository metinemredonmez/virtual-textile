/**
 * SİTE GÖRSELLERİ — afiş, kategori kapağı, koleksiyon kapağı.
 *
 * ⚠️ BU MODÜLÜN VARLIK SEBEBİ, `SiteImage` TABLOSUNUN BOŞ OLMASIYDI.
 *    Şema, uç, admin ekranı ve okuma yolu (`vitrin/site-gorseli.ts`) yazıldı;
 *    tabloya HİÇBİR ŞEY YAZILMADI. Sonuç, bu deponun altı kez yaşadığı sınıfın
 *    yedincisi: "yazıldı, derlendi, test edildi — ama hiç beslenmedi."
 *
 *    Görünen arıza şuydu: ana sayfa afişi `afis?.storageKey ?? urun?.imageKey`
 *    yedeğine düşüyor, yani 3:4 bir ürün fotoğrafı 16:7 kutuya kırpılıyor ve
 *    ekranın en büyük öğesi gri bir dikdörtgene dönüyordu.
 *
 * ⚠️ `isActive: true` YAZILIYOR. Yönetici uçları yeni afişi PASİF açar (kasıt:
 *    yanlışlıkla yayına çıkmasın). Seed'de bu ters olurdu — demo veriyi
 *    kurup ana sayfayı yine boş bırakırdı.
 *
 * ⚠️ KATEGORİ KAPAĞI `Category.id` İLE BAĞLANIR, SLUG İLE DEĞİL. Slug
 *    `@unique` ama DEĞİŞMEZ değil; yönetici bir slug'ı düzelttiğinde kapak
 *    sessizce boşa düşerdi. Eşleme `katalogYaz` dönüşündeki `kategoriId`
 *    haritasından yapılır.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SITE_BANNER_WIDTHS } from '@vt/config';
import { storageKeys, type StorageProvider } from '@vt/adapters';
import sharp from 'sharp';
import type { PrismaClient } from '../../generated/client/index.js';
import { VARLIKLAR, vitrinDosyaAdi, koleksiyonKapsamiDogrula } from '../seed-assets/vitrin.js';

const VITRIN_KLASORU = join(__dirname, '..', 'seed-assets', 'vitrin');

export interface SiteGorselSonucu {
  readonly yazilan: number;
  readonly atlanan: string[];
  readonly depolamaAnahtarlari: string[];
}

/**
 * ⚠️ EKSİK DOSYA SESSİZ GEÇMEZ AMA SEED'İ DE DÜŞÜRMEZ — ve bu ayrım kasıtlı.
 *    Ürün görselinde eksik dosya ATAR (katalog o görsel olmadan anlamsız).
 *    Site görselinde ise atmak yanlış olurdu: `seed:vitrin-varlik` FAL_KEY
 *    ister, CI'da anahtar yok. Orada afişsiz bir demo hâlâ geçerli bir demo;
 *    ana sayfa bugünkü yedeğine düşer. Atlananlar İSİMLERİYLE raporlanır.
 */
async function dosyaOku(ad: string): Promise<Buffer | null> {
  try {
    return await readFile(join(VITRIN_KLASORU, vitrinDosyaAdi(ad)));
  } catch {
    return null;
  }
}

export async function siteGorselleriYaz(
  prisma: PrismaClient,
  storage: StorageProvider | null,
  kategoriId: ReadonlyMap<string, string>,
  yoneticiId: string,
): Promise<SiteGorselSonucu> {
  koleksiyonKapsamiDogrula();

  const atlanan: string[] = [];
  const depolamaAnahtarlari: string[] = [];
  let yazilan = 0;

  /**
   * ⚠️ DEPOLAMA YOKSA HİÇBİR SATIR YAZILMAZ — ve bu, ürün görselinden FARKLI
   *    davranmak demek. Fark kasıtlı, sebebi sunucuda ÖLÇÜLDÜ:
   *
   *    Seed R2 değişkenleri olmadan koşturuldu. Ürün tarafında sonuç zararsız:
   *    satır yazılır, görsel gelmez, kart nötr yer tutucuya düşer. Ama site
   *    görselinde sonuç DAHA KÖTÜ oldu:
   *
   *      · satır yazılıyor → `afisGetir()` artık `null` DÖNMÜYOR
   *      · yani ana sayfa ürün fotoğrafı yedeğine DÜŞEMİYOR
   *      · nesne kovada olmadığı için afiş 404 → ekranın en büyük öğesi
   *        KIRIK GÖRSEL
   *
   *    Yani yarım seed, hiç seed'den kötü bir ekran üretti. Kural: afiş satırı
   *    ancak NESNESİ GERÇEKTEN YÜKLENDİYSE yazılır.
   *
   * ⚠️ Var olan satırlara DOKUNULMAZ (silinmez): önceki doğru bir koşunun
   *    yazdığı afişi, depolamasız bir koşunun silmesi gerileme olurdu.
   */
  if (!storage) {
    return {
      yazilan: 0,
      atlanan: VARLIKLAR.map((v) => `${v.ad} (depolama yapılandırılmamış)`),
      depolamaAnahtarlari: [],
    };
  }

  for (const [sira, varlik] of VARLIKLAR.entries()) {
    const govde = await dosyaOku(varlik.ad);
    if (!govde) {
      atlanan.push(`${varlik.ad} (dosya yok)`);
      continue;
    }

    /**
     * ⚠️ KATEGORİ KAPAĞI, KATEGORİ YOKSA YAZILMAZ. Var olmayan bir
     *    `targetKey` ile satır açmak, okuma tarafında sessizce yok sayılan
     *    ölü bir kayıt bırakırdı — ve tabloya bakan biri "kapak var" sanırdı.
     */
    let hedef: string | null = null;
    if (varlik.slot === 'CATEGORY_COVER') {
      hedef = kategoriId.get(varlik.hedef ?? '') ?? null;
      if (!hedef) {
        atlanan.push(`${varlik.ad} (kategori yok: ${varlik.hedef ?? '—'})`);
        continue;
      }
    } else if (varlik.slot === 'COLLECTION_COVER') {
      hedef = varlik.hedef;
    }

    /**
     * ⚠️ KİMLİK ÜRETİLMEDEN ÖNCE VAR OLAN SATIR ARANIR. `id` depolama
     *    anahtarına giriyor (`site/banner/{id}/…`); her koşuda yeni kimlik
     *    üretilseydi seed idempotent olmaktan çıkar, kovada her çalıştırmada
     *    bir kopya daha birikirdi.
     */
    const varOlan = await prisma.siteImage.findFirst({
      where: { slot: varlik.slot, targetKey: hedef },
      select: { id: true },
    });
    const id = varOlan?.id ?? randomUUID();

    const anahtar = storageKeys.siteImageOriginal(id);
    await storage.put({
      key: anahtar,
      visibility: 'public',
      body: govde,
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    depolamaAnahtarlari.push(anahtar);

    /**
     * ⚠️ KAYNAKTAN BÜYÜK TÜREV ÜRETİLMEZ. Afiş kaynağı 2048 px, kapak 1024;
     *    `SITE_BANNER_WIDTHS` dördünü de listeliyor. 1024 px bir kapağı
     *    2048'e çıkarmak bilgi eklemez, yalnız dosyayı ve süreyi büyütür —
     *    aynı gerekçe `gorsel.ts`te ürün görseli için de yazılı.
     */
    for (const genislik of SITE_BANNER_WIDTHS.filter((w) => w <= varlik.genislik)) {
      const turev = await sharp(govde).resize({ width: genislik }).webp({ quality: 82 }).toBuffer();
      const turevAnahtar = storageKeys.siteImage(id, genislik);
      await storage.put({
        key: turevAnahtar,
        visibility: 'public',
        body: turev,
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      });
      depolamaAnahtarlari.push(turevAnahtar);
    }

    const alanlar = {
      slot: varlik.slot,
      targetKey: hedef,
      storageKey: anahtar,
      widthPx: varlik.genislik,
      heightPx: varlik.yukseklik,
      isActive: true,
      sortOrder: sira,
      createdBy: yoneticiId,
    };

    await prisma.siteImage.upsert({
      where: { id },
      create: { id, ...alanlar },
      update: alanlar,
    });
    yazilan += 1;
  }

  return { yazilan, atlanan, depolamaAnahtarlari };
}
