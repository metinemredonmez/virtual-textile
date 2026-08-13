import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { SITE_IMAGE_SLOTS } from '@vt/config';
import { PUBLIC_KEY, ROLES_KEY } from '../auth/auth.guard.js';
import { IDEMPOTENT_KEY } from '../../common/interceptors/idempotency.interceptor.js';
import { AdminModule } from './index.js';
import { AdminSiteImageController, SiteImageController } from './admin-site-image.controller.js';
import { siteImageSlotSchema } from './admin-site-image.schema.js';

/**
 * ═══════════ SİTE GÖRSELİ UÇLARI — KABLO VE YETKİ TESTİ ═════════════════════
 *
 * ⚠️⚠️ BU DOSYANIN VAR OLMA SEBEBİ İKİ ÖLÇÜLMÜŞ SESSİZLİKTİR:
 *
 *   (1) `RolesGuard` metadata YOKSA `return true` der (auth.guard.ts:123).
 *       Yani `@Roles` unutulan bir uç, kimliği doğrulanmış HERKESE — CUSTOMER
 *       dahil — açıktır. Bugün 30 admin ucunun 30'unda `@Roles` var ve
 *       SIFIRINDA testi vardı. Site içeriğinde bu, herhangi bir müşterinin
 *       ana sayfa afişini değiştirebilmesi demek olurdu.
 *
 *   (2) Controller `AdminModule.controllers` dizisinden düşerse uç 404 döner
 *       ve DERLEME BUNU GÖREMEZ: `controllers` bir dizidir, eksik eleman tip
 *       hatası değildir. Bu depoda "yazıldı, derlendi, testler yeşil, ama
 *       hiçbir yerden ulaşılamıyor" arızası ALTI kez yaşandı.
 *
 * Burada ölçülen şey MANTIK değil, VARLIK ve BAĞLANTIdır.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Prototipteki handler adları — ELLE YAZILMIŞ BİR LİSTE DEĞİL.
 *
 * ⚠️ Fark kritik: elle liste yazılsaydı, yarın eklenen ve `@Roles` unutulan
 *    bir uç listede olmadığı için test tarafından HİÇ GÖRÜLMEZDİ — yani test
 *    tam da yakalaması gereken durumda sessiz kalırdı. Sayarak taranınca yeni
 *    uç otomatik olarak kapsama giriyor.
 */
function handlerNames(controller: abstract new (...args: never[]) => object): string[] {
  return Object.getOwnPropertyNames(controller.prototype).filter((name) => name !== 'constructor');
}

describe('site görseli uçları — kablolama', () => {
  it('⚠️ AdminSiteImageController, AdminModule controller listesinde kayıtlıdır', () => {
    const controllers = Reflect.getMetadata('controllers', AdminModule) as unknown[];

    expect(controllers).toContain(AdminSiteImageController);
  });

  /**
   * ⚠️ Genel okuma ucu kaydedilmezse vitrin afişi HİÇ görünmez: admin ekranı
   *    çalışır, görsel yüklenir, satır yazılır — ve ana sayfa boş duruma
   *    düşüp bugünkü davranışına geri döner. Yani özellik "çalışıyor" gibi
   *    görünürken hiçbir şey değişmemiş olur.
   */
  it('⚠️ SiteImageController (genel okuma) da kayıtlıdır', () => {
    const controllers = Reflect.getMetadata('controllers', AdminModule) as unknown[];

    expect(controllers).toContain(SiteImageController);
  });

  it('yönetim ucu yedi handler taşır (bilet, onay, liste, güncelle, sil, kart ekle/çıkar)', () => {
    expect(handlerNames(AdminSiteImageController)).toHaveLength(7);
  });
});

describe('site görseli uçları — yetki', () => {
  const reflector = new Reflector();

  /**
   * ⚠️ PAZARLIK DIŞI KABUL ÖLÇÜTÜ. Site içeriği bir KARARDIR, rapor değil:
   *    SUPPORT'a okuma bile açılmaz. Tek bir handler bu iddiadan düşerse
   *    testin adı hangisi olduğunu söyler.
   */
  it.each(handlerNames(AdminSiteImageController))('⚠️ %s yalnızca ADMIN rolüne açıktır', (name) => {
    const handler = (AdminSiteImageController.prototype as Record<string, unknown>)[name];
    const roles = reflector.get<string[]>(ROLES_KEY, handler as () => unknown);

    expect(roles).toEqual(['ADMIN']);
  });

  /**
   * ⚠️ TERS YÖN. Yönetim ucuna yanlışlıkla `@Public()` eklenirse `JwtAuthGuard`
   *    token istemeden geçirir; `RolesGuard` o zaman `request.user` bulamaz ve
   *    `AUTH_TOKEN_MISSING` fırlatır — yani uç 401 döner ve yönetici afiş
   *    yükleyemez. Sessiz bir açık değil ama sessiz bir ARIZA; burada ölçülüyor.
   */
  it.each(handlerNames(AdminSiteImageController))('%s @Public DEĞİLDİR', (name) => {
    const handler = (AdminSiteImageController.prototype as Record<string, unknown>)[name];

    expect(reflector.get<boolean>(PUBLIC_KEY, handler as () => unknown)).toBeUndefined();
  });

  /**
   * ⚠️ Genel okuma ucunda `@Public()` UNUTULURSA arıza sessizdir ve yanlış
   *    yerde görünür: derleme geçer, testler geçer, yönetici afişi yükler ve
   *    görür (oturumu var) — ama SİTEYE GELEN MİSAFİR 401 alır. Yani afiş
   *    yalnızca giriş yapmış kullanıcılara görünür olurdu.
   */
  it.each(handlerNames(SiteImageController))('genel okuma ucu %s @Public taşır', (name) => {
    const handler = (SiteImageController.prototype as Record<string, unknown>)[name];

    expect(reflector.get<boolean>(PUBLIC_KEY, handler as () => unknown)).toBe(true);
  });

  it.each(handlerNames(SiteImageController))('genel okuma ucu %s rol İSTEMEZ', (name) => {
    const handler = (SiteImageController.prototype as Record<string, unknown>)[name];

    expect(reflector.get<string[]>(ROLES_KEY, handler as () => unknown)).toBeUndefined();
  });
});

describe('site görseli uçları — idempotentlik', () => {
  const reflector = new Reflector();

  /**
   * ⚠️ Onay ucu satır YARATIR ve public kovaya nesne yazar. Büyük bir
   *    yüklemenin ardından gelen ağ zaman aşımında istemci onayı tekrarlar.
   */
  it('onay ucu Idempotency-Key ister', () => {
    expect(
      reflector.get<boolean>(IDEMPOTENT_KEY, AdminSiteImageController.prototype.confirmUpload),
    ).toBe(true);
  });

  /**
   * ⚠️ Bilet ucu VERİTABANINA YAZMAZ; anahtar İSTEMEMESİ bilinçli bir karar,
   *    eksiklik değil. Test bu kararı sabitliyor ki bir gün "tutarlılık olsun"
   *    diye eklenip yükleme akışına gereksiz bir zorunlu başlık girmesin.
   */
  it('bilet ucu Idempotency-Key İSTEMEZ (veritabanına yazmıyor)', () => {
    expect(
      reflector.get<boolean>(IDEMPOTENT_KEY, AdminSiteImageController.prototype.createUploadUrl),
    ).toBeUndefined();
  });
});

/**
 * ⚠️ SLOT LİSTESİNİN KAPISI — planın açıkça şart koştuğu test.
 *
 * `slot` PostgreSQL enum'ı DEĞİL, serbest bir `String` kolonu. Bu seçim
 * geri alınamaz migration'dan kaçınmak için yapıldı, ama bedeli şu: veritabanı
 * artık hiçbir değeri reddetmiyor. Tek kapı, ucun kabul ettiği değerlerin
 * config listesiyle BİREBİR aynı olması. Bu test olmasaydı serbest listenin
 * bütün dezavantajı geri gelirdi: `home.her0` yazan bir istek 201 döner, satır
 * yazılır ve vitrinde hiçbir şey değişmezdi.
 */
describe('slot listesi — uç ↔ config sapması', () => {
  it('⚠️ ucun kabul ettiği her slot config listesindedir', () => {
    expect([...siteImageSlotSchema.options]).toEqual([...SITE_IMAGE_SLOTS]);
  });

  it('config listesindeki her slot uçta kabul edilir', () => {
    for (const slot of SITE_IMAGE_SLOTS) {
      expect(siteImageSlotSchema.safeParse(slot).success).toBe(true);
    }
  });

  it('listede olmayan slot reddedilir', () => {
    expect(siteImageSlotSchema.safeParse('home.her0').success).toBe(false);
    expect(siteImageSlotSchema.safeParse('HERO_V2').success).toBe(false);
  });
});
