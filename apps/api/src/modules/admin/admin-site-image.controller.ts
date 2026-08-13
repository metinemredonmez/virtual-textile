import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { JwtPayload } from '@vt/contracts';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor.js';
import { CurrentUser, Public, Roles } from '../auth/auth.guard.js';
import { adminActor } from './audit.js';
import {
  AdminSiteImageService,
  type AdminSiteImageView,
  type SiteImageUploadTicket,
  type SiteImageView,
} from './admin-site-image.service.js';
import {
  siteImageCardSchema,
  siteImageConfirmSchema,
  siteImageListQuerySchema,
  siteImagePublicQuerySchema,
  siteImageUpdateSchema,
  siteImageUploadSchema,
  type SiteImageCardInput,
  type SiteImageConfirmInput,
  type SiteImageListQuery,
  type SiteImagePublicQuery,
  type SiteImageUpdateInput,
  type SiteImageUploadInput,
} from './admin-site-image.schema.js';

/**
 * ═══════════════ SİTE GÖRSELLERİ — YÖNETİM YÜZEYİ ═══════════════════════════
 *
 *   POST   /admin/site-images                       (ADMIN)  → yükleme bileti
 *   POST   /admin/site-images/:id/confirm           (ADMIN)  @Idempotent
 *   GET    /admin/site-images                       (ADMIN)
 *   PATCH  /admin/site-images/:id                   (ADMIN)  isActive/sortOrder/metin
 *   DELETE /admin/site-images/:id                   (ADMIN)
 *   POST   /admin/site-images/:id/cards             (ADMIN)
 *   DELETE /admin/site-images/:id/cards/:productId  (ADMIN)
 *
 * ⚠️⚠️ @Roles HER UCA AYRI YAZILIR, SINIFA DEĞİL — ve bu, bu depoda ölçülmüş
 *      bir sessizliğin kapısıdır: `RolesGuard` metadata YOKSA `return true`
 *      der (auth.guard.ts:123). Yani `@Roles` unutulan bir uç, kimliği
 *      doğrulanmış HERKESE — CUSTOMER dahil — açıktır ve bunu ne derleyici ne
 *      de var olan testler söyler. Site içeriği bir KARARDIR, rapor değil:
 *      SUPPORT'a okuma bile açılmaz, hepsi `@Roles('ADMIN')`.
 *
 *      Sınıf düzeyinde yazmak "hepsi korunur" gibi görünürdü ama asıl riski
 *      GİZLERDİ: yeni bir uç eklerken rolü düşünmek gerekmezdi. Kararın her
 *      satırda tekrar edilmesi, unutulduğunda testin görebilmesi demek —
 *      `admin-site-image.controller.test.ts` bu sınıftaki HER handler'ı
 *      sayarak tarıyor, elle yazılmış bir liste üzerinden değil.
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Controller('admin/site-images')
export class AdminSiteImageController {
  constructor(private readonly siteImages: AdminSiteImageService) {}

  /**
   * İmzalı yükleme adresi üretir.
   *
   * @Idempotent GEREKMEZ ve bilinçli olarak yazılmadı: bu uç veritabanına
   * YAZMAZ. Tekrarlanan istek yalnızca yeni bir kimlik ve yeni bir imzalı
   * adres üretir, yan etkisi yoktur (emsal: media.controller.ts:36-40).
   */
  @Post()
  @Roles('ADMIN')
  async createUploadUrl(
    @Body(zodBody(siteImageUploadSchema)) body: SiteImageUploadInput,
  ): Promise<SiteImageUploadTicket> {
    return this.siteImages.requestUpload(body);
  }

  /**
   * @Idempotent: bu uç satırı YARATIR ve public kovaya nesne yazar. Büyük bir
   * yüklemenin ardından gelen ağ zaman aşımında istemci onayı tekrarlar;
   * anahtar olmasaydı aynı afiş iki kez listelenirdi.
   */
  @Post(':id/confirm')
  @Idempotent()
  @Roles('ADMIN')
  async confirmUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id') siteImageId: string,
    @Body(zodBody(siteImageConfirmSchema)) body: SiteImageConfirmInput,
  ): Promise<AdminSiteImageView> {
    return this.siteImages.confirm(adminActor(user), siteImageId, body);
  }

  @Get()
  @Roles('ADMIN')
  async list(
    @Query(zodBody(siteImageListQuerySchema)) query: SiteImageListQuery,
  ): Promise<{ items: AdminSiteImageView[] }> {
    return this.siteImages.list(query);
  }

  /**
   * Yayına alma/kaldırma, sıralama ve metin — TEK UÇ.
   *
   * ⚠️ "Pasifleştir" ve "sıra değiştir" için ayrı uçlar açılmadı: üçü de aynı
   *    satırın aynı yetkiyle güncellenmesi. Ayrı uçlar üç kez aynı rol
   *    kontrolü, üç kez aynı denetim kaydı ve üç kez aynı test demekti.
   */
  @Patch(':id')
  @Roles('ADMIN')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') siteImageId: string,
    @Body(zodBody(siteImageUpdateSchema)) body: SiteImageUpdateInput,
  ): Promise<AdminSiteImageView> {
    return this.siteImages.update(adminActor(user), siteImageId, body);
  }

  /**
   * @Idempotent KULLANILMAZ: silme zaten tekrarlanabilir ve yöneticinin "sil"
   * isteği bir anahtar bulunamadı diye reddedilmemeli. İkinci çağrı
   * `SITE_IMAGE_NOT_FOUND` döner — kayıp değil, zaten yapılmış demektir.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') siteImageId: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.siteImages.remove(adminActor(user), siteImageId);
  }

  @Post(':id/cards')
  @Roles('ADMIN')
  async addCard(
    @CurrentUser() user: JwtPayload,
    @Param('id') siteImageId: string,
    @Body(zodBody(siteImageCardSchema)) body: SiteImageCardInput,
  ): Promise<AdminSiteImageView> {
    return this.siteImages.addCard(adminActor(user), siteImageId, body);
  }

  @Delete(':id/cards/:productId')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  async removeCard(
    @CurrentUser() user: JwtPayload,
    @Param('id') siteImageId: string,
    @Param('productId') productId: string,
  ): Promise<AdminSiteImageView> {
    return this.siteImages.removeCard(adminActor(user), siteImageId, productId);
  }
}

/**
 * ═══════════════ SİTE GÖRSELLERİ — GENEL OKUMA YÜZEYİ ═══════════════════════
 *
 *   GET /site-images/hero            → vitrin afişi + üzerindeki ürün kartları
 *   GET /site-images?slot=…&targetKey=…  → kategori / koleksiyon kapağı
 *
 * ⚠️ AYRI BİR SINIF, VE BU AYRIM GÜVENLİKTİR. Genel okuma uçları yönetim
 *    sınıfının içine konsaydı, aynı dosyada `@Roles('ADMIN')` taşıyan ve
 *    taşımayan metotlar yan yana dururdu; "bu metotta neden yok" sorusunun
 *    cevabı ancak yorumdan okunabilirdi. Ayrı sınıfta kural sınıfın
 *    kendisidir: burada HİÇBİR metot `@Roles` taşımaz, hepsi `@Public`.
 *
 * ⚠️ `@Public()` ZORUNLU: `JwtAuthGuard` varsayılan olarak KAPALIdır, token
 *    ister. Unutulsaydı vitrin misafir kullanıcıda 401 alır ve afiş yalnızca
 *    giriş yapmış kullanıcılara görünürdü.
 *
 * ⚠️ Bu iki uç YÖNETİM MODÜLÜNDE duruyor çünkü `SiteImage` tablosunun sahibi
 *    o modül. Yeni bir modül açmak `app.module.ts`e dokunmayı gerektirirdi —
 *    ve bu depoda "yazıldı, derlendi, testler yeşil, ama hiçbir yerden
 *    ulaşılamıyor" arızası altı kez yaşandı; `AdminModule` zaten kayıtlı
 *    olduğu için bu uçlar kaydedildikleri anda CANLI.
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Controller('site-images')
export class SiteImageController {
  constructor(private readonly siteImages: AdminSiteImageService) {}

  /**
   * ⚠️ `/hero` rotası `/` DESENİNDEN ÖNCE tanımlı olmalı; Nest rotaları
   *    tanım sırasına göre eşler. Sırf bu yüzden burada ilk metot.
   *
   * Yanıt `{ image: null }` olabilir ve bu bir hata değildir — bkz. servis.
   */
  @Public()
  @Get('hero')
  async hero(): Promise<{ image: SiteImageView | null }> {
    return this.siteImages.readHero();
  }

  @Public()
  @Get()
  async bySlot(
    @Query(zodBody(siteImagePublicQuerySchema)) query: SiteImagePublicQuery,
  ): Promise<{ items: SiteImageView[] }> {
    return this.siteImages.readBySlot(query.slot, query.targetKey);
  }
}
