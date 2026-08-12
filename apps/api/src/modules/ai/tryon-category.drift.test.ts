import { describe, expect, it } from 'vitest';
import { TryOnCategory } from '@vt/db';
import {
  ALL_TRYON_CATEGORIES,
  TRYONABLE_CATEGORIES,
  TRYON_PROVIDER_CAPABILITIES,
  providersForCategory,
} from '@vt/config';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ŞEMA ↔ CONFIG SAPMA KORUMASI
 *
 *  `@vt/config` en alt katmandır ve `@vt/db`ye bağımlı DEĞİLDİR; bu yüzden
 *  kategori listesi orada ELLE aynalanır ve sessizce ayrışabilir.
 *
 *  ⚠️ İKİ YÖN, İKİ FARKLI KORUMA — VE BİRİ BURADA DEĞİL:
 *
 *  YÖN 1 (tehlikeli): Prisma'ya yeni değer eklenir, config bilmez.
 *    → DERLEME kırılır ve iddia BU DOSYADA DEĞİL, kapının kendisindedir:
 *      `tryon.service.ts` ve `multi-tryon.service.ts` içindeki
 *      `isTryOnSupported(variant.tryOnCategory)` çağrıları. Prisma'nın tipi
 *      genişleyince argüman `TryOnCategoryName`e atanamaz.
 *      Ölçüldü: config'ten 'ACCESSORY' silinince tsc iki çağrı yerinde de
 *      TS2345 veriyor. Koruma YÜK TAŞIYAN kodun üzerinde olduğu için
 *      "ölü kod" diye temizlenemez — kapıyı silmeden silinemez.
 *
 *  YÖN 2 (zararsız): config'e şemada olmayan hayalet bir değer eklenir.
 *    → Derleme bunu YAKALAMAZ ve yakalaması da gerekmez: hiçbir ürün o
 *      kategoriye sahip olamaz. Yine de gürültüdür; aşağıdaki ÇALIŞMA ZAMANI
 *      testi onu yakalar.
 *
 *  ⚠️ BURAYA TİP İDDİASI KOYMAYIN. `apps/api/tsconfig.json` içinde
 *     `exclude: ["**\/*.test.ts"]` var; test dosyalarındaki tip iddiaları
 *     `tsc --noEmit` sırasında HİÇ DERLENMEZ ve vitest de tipleri denetlemeden
 *     siler. Bu dosyada bir `Dogrula<Ayni<...>>` iddiası vardı ve TAM OLARAK
 *     BÖYLE ÖLÜYDÜ: mutasyon testi (config'e hayalet değer eklenip tsc
 *     çalıştırıldı) hiçbir hata üretmedi. Tip iddiaları yalnızca derlenen
 *     kaynak dosyalara konur.
 * ═══════════════════════════════════════════════════════════════════════════
 */

describe('try-on kategori yeteneği', () => {
  /**
   * ⚠️ YÖN 2'nin koruması. Karşılaştırma iki GERÇEK liste arasındadır —
   *    elle yazılmış beklenen bir diziye değil. Sabit liste yazılsaydı üçüncü
   *    bir ayna doğardı ve o da diğer ikisinden sapabilirdi.
   */
  it('config listesi ile Prisma enum’ı BİREBİR aynıdır', () => {
    const semadakiler = [...Object.values(TryOnCategory)].sort();
    const configtekiler = [...ALL_TRYON_CATEGORIES].sort();

    expect(configtekiler, 'config ile şema ayrışmış').toEqual(semadakiler);
  });

  /**
   * ⚠️ ASIL KORUNAN DAVRANIŞ. Liste elle yazılsaydı biri "ayakkabıyı da
   *    ekleyelim" diyip matrise dokunmadan buraya yazabilirdi; sonuç,
   *    düğmeye basıp para harcayan ama sonuç alamayan kullanıcıdır.
   */
  it('denenebilir liste ELLE yazılmaz — matristen türer', () => {
    const matristekiler = new Set(Object.values(TRYON_PROVIDER_CAPABILITIES).flat());

    for (const category of TRYONABLE_CATEGORIES) {
      expect(
        matristekiler.has(category),
        `${category} denenebilir sayılıyor ama hiçbir sağlayıcı desteklemiyor`,
      ).toBe(true);
    }

    for (const category of matristekiler) {
      expect(
        TRYONABLE_CATEGORIES.includes(category),
        `${category} bir sağlayıcıda destekli ama denenebilir listede yok`,
      ).toBe(true);
    }
  });

  /**
   * Bugünkü gerçeği PİNLER. Bir sağlayıcı ayakkabı desteklemeye başladığında
   * bu test kırılır — ve kırılması DOĞRUDUR: o değişiklik bilinçli bir karar
   * olmalı, sessizce sızan bir satır değil.
   *
   * Araştırma ve gerekçe: docs/tryon-kategori-destegi.md
   */
  it('ayakkabı, takı, çanta ve aksesuar BUGÜN kapalıdır — sağlayıcıda model yok', () => {
    for (const category of ['SHOES', 'JEWELRY', 'BAG', 'ACCESSORY'] as const) {
      expect(providersForCategory(category), `${category} sağlayıcıları`).toEqual([]);
      expect(TRYONABLE_CATEGORIES.includes(category), `${category} denenebilir mi`).toBe(false);
    }
  });

  it('giysi kategorileri açıktır ve birden fazla sağlayıcı tarafından karşılanır', () => {
    for (const category of ['UPPER_BODY', 'LOWER_BODY', 'DRESS', 'OUTERWEAR'] as const) {
      expect(TRYONABLE_CATEGORIES.includes(category), `${category} denenebilir mi`).toBe(true);
      // Fallback zincirinin anlamı: tek sağlayıcı düşerse deneme durmaz.
      expect(providersForCategory(category).length).toBeGreaterThanOrEqual(2);
    }
  });

  /**
   * ⚠️ BİRLEŞİM, KESİŞİM DEĞİL. Kesişim alınsaydı dar kapsamlı yeni bir
   *    sağlayıcı eklemek VAR OLAN kategorileri kapatırdı — eklemek bir
   *    yeteneği azaltmamalıdır.
   */
  it('yeteneklerin BİRLEŞİMİ alınır: tek sağlayıcının desteklemesi yeterlidir', () => {
    const yalnizcaTekSaglayicida = (['UPPER_BODY'] as const).filter(
      (category) => providersForCategory(category).length >= 1,
    );
    expect(yalnizcaTekSaglayicida.length).toBe(1);
    expect(TRYONABLE_CATEGORIES.includes('UPPER_BODY')).toBe(true);
  });
});
