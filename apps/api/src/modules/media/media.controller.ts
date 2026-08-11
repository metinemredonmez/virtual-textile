import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { JwtPayload } from '@vt/contracts';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor.js';
import { CurrentUser } from '../auth/auth.guard.js';
import { SellerId, SellerPanel } from '../seller/seller.scope.js';
import { MediaProductService, type ProductImageConfirmResult } from './media-product.service.js';
import { MediaService, type UploadTicket, type UserPhotoView } from './media.service.js';
import {
  productImageConfirmSchema,
  productImageUploadSchema,
  userPhotoConfirmSchema,
  userPhotoUploadSchema,
  type ProductImageConfirmInput,
  type ProductImageUploadInput,
  type UserPhotoConfirmInput,
  type UserPhotoUploadInput,
} from './media.schema.js';

/**
 * ═══════════════════════ SATICI: ÜRÜN GÖRSELİ ═══════════════════════════════
 *
 * ⚠️ SINIF DÜZEYİNDE `@SellerPanel()` (rol + mağaza kapsamı). Metot metot
 *    yazılsaydı ileride eklenen bir uçta unutulur ve o uç korumasız kalırdı;
 *    sınıf düzeyinde varsayılan KAPALI olur.
 *
 *    Kapsam kimliği yalnızca guard'ın çözdüğü `@SellerId()`'den okunur —
 *    gövdeden veya sorgudan ASLA. Aksi hâlde satıcı, başka mağazanın ürününe
 *    görsel ekleyebilirdi.
 */
@Controller('seller/products')
@SellerPanel()
export class SellerMediaController {
  constructor(private readonly media: MediaProductService) {}

  /**
   * İmzalı yükleme adresi üretir. Veritabanına yazmaz, bu yüzden
   * @Idempotent GEREKMEZ: tekrarlanan istek yalnızca yeni bir kimlik ve yeni
   * bir imzalı adres üretir, yan etkisi yoktur.
   */
  @Post(':productId/images')
  async createUploadUrl(
    @SellerId() sellerId: string,
    @Param('productId') productId: string,
    @Body(zodBody(productImageUploadSchema)) body: ProductImageUploadInput,
  ): Promise<UploadTicket> {
    return this.media.requestUpload(sellerId, productId, body);
  }

  /**
   * @Idempotent: bu uç görsel satırı YARATIR, public kovaya nesne yazar ve
   * ürünün skorunu günceller. Büyük bir yüklemenin ardından gelen ağ zaman
   * aşımında istemci onayı tekrarlar; anahtar olmasaydı aynı görsel ürüne
   * iki kez eklenirdi.
   */
  @Post(':productId/images/:imageId/confirm')
  @Idempotent()
  async confirmUpload(
    @SellerId() sellerId: string,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
    @Body(zodBody(productImageConfirmSchema)) body: ProductImageConfirmInput,
  ): Promise<ProductImageConfirmResult> {
    return this.media.confirmUpload(sellerId, productId, imageId, body);
  }
}

/**
 * ═══════════════════════ KULLANICI FOTOĞRAFI ════════════════════════════════
 *
 * ⚠️ `@Public()` YOK: fotoğraf yükleme kimlik doğrulaması ister. Fotoğrafın
 *    sahibi HER ZAMAN oturumdaki kullanıcıdır (`user.sub`); gövdeden veya
 *    yoldan kullanıcı kimliği okunmaz, dolayısıyla başkası adına fotoğraf
 *    yüklenemez veya silinemez.
 */
@Controller('me/photos')
export class MeMediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  async createUploadUrl(
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(userPhotoUploadSchema)) body: UserPhotoUploadInput,
  ): Promise<UploadTicket> {
    return this.media.requestUpload(user.sub, body);
  }

  /**
   * @Idempotent: fotoğraf satırını yaratan ve saklama süresini başlatan uç
   * budur. Tekrarlanan onay ikinci bir kayıt açmamalı.
   */
  @Post(':photoId/confirm')
  @Idempotent()
  async confirmUpload(
    @CurrentUser() user: JwtPayload,
    @Param('photoId') photoId: string,
    @Body(zodBody(userPhotoConfirmSchema)) body: UserPhotoConfirmInput,
  ): Promise<UserPhotoView> {
    return this.media.confirmUpload(user.sub, photoId, body);
  }

  /**
   * KVKK silme talebi.
   *
   * @Idempotent KULLANILMAZ: silme zaten doğası gereği tekrarlanabilir ve
   * kullanıcının "sil" isteği bir anahtar bulunamadı diye reddedilmemeli.
   * İkinci çağrı PHOTO_NOT_FOUND döner — kayıp değil, zaten yapılmış demektir.
   */
  @Delete(':photoId')
  @HttpCode(HttpStatus.OK)
  async deletePhoto(
    @CurrentUser() user: JwtPayload,
    @Param('photoId') photoId: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.media.deletePhoto(user.sub, photoId);
  }
}
