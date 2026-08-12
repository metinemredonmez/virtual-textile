import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { JwtPayload } from '@vt/contracts';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../auth/auth.guard.js';
import {
  WardrobeService,
  type WardrobeItemView,
  type WardrobeUploadTicket,
} from './wardrobe.service.js';
import type { WardrobeOutfitSuggestion } from './wardrobe.ports.js';
import {
  outfitSuggestionQuerySchema,
  wardrobeCreateSchema,
  type WardrobeCreateInput,
} from './wardrobe.schema.js';

/**
 * ════════════════════════ DİJİTAL GARDIROP UÇLARI ═══════════════════════════
 *
 * ⚠️ SINIF DÜZEYİNDE `@Public()` YOK ve OLMAMALI. Gardırop, kullanıcının ne
 *    giydiğini ve evinde ne bulunduğunu gösterir; misafir erişimi anlamsız,
 *    kimliksiz erişim tehlikelidir.
 *
 * ⚠️ Hiçbir uç `userId` PARAMETRESİ ALMAZ. Kimlik her zaman oturumdan okunur
 *    (`user.sub`). Yoldan/gövdeden alınsaydı kimliği değiştiren biri
 *    başkasının gardırobunu listeleyebilir ve fotoğraflarına imzalı URL
 *    alabilirdi (me.controller.ts'deki aynı kural).
 */
@Controller('wardrobe')
export class WardrobeController {
  constructor(private readonly wardrobe: WardrobeService) {}

  /** Kullanıcının gardırobu. Fotoğraflar KISA ÖMÜRLÜ imzalı URL ile döner. */
  @Get()
  async list(@CurrentUser() user: JwtPayload): Promise<WardrobeItemView[]> {
    return this.wardrobe.list(user.sub);
  }

  /**
   * Platformda satılmayan bir parçayı ekler — 1. adım.
   *
   * ⚠️ 202 ve iki adım: bu uç yalnızca imzalı YÜKLEME adresi döner, kayıt
   *    henüz açılmaz. Fotoğraf istemciden doğrudan private kovaya gider;
   *    API sunucusundan geçseydi her yükleme sunucu belleğine tam dosya
   *    olarak inerdi.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestUpload(
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(wardrobeCreateSchema)) body: WardrobeCreateInput,
  ): Promise<WardrobeUploadTicket> {
    return this.wardrobe.requestUpload(user.sub, body);
  }

  /**
   * Parça ekleme — 2. adım (yükleme onayı).
   *
   * ⚠️ Depo anahtarı GÖVDEDEN ALINMAZ; `user.sub` + `itemId` ile sunucuda
   *    yeniden üretilir. Alınsaydı istemci `user-photos/<başkası>/...` yazıp
   *    başkasının özel fotoğrafını kendi gardırobuna bağlayabilir ve imzalı
   *    URL ile okuyabilirdi.
   */
  @Post(':id/confirm')
  @HttpCode(HttpStatus.CREATED)
  async confirmUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) itemId: string,
    @Body(zodBody(wardrobeCreateSchema)) body: WardrobeCreateInput,
  ): Promise<WardrobeItemView> {
    return this.wardrobe.confirmUpload(user.sub, itemId, body);
  }

  /**
   * Parçayı gardıroptan siler; fotoğrafı da depodan kaldırır.
   *
   * ⚠️ Başkasının parçası için 404 döner, 403 değil — varlık bilgisi sızmasın.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    await this.wardrobe.remove(user.sub, itemId);
  }

  /**
   * Gardıroptaki parçalarla kombin önerir.
   *
   * ⚠️ Öneri mantığı bu modülde DEĞİL, stil danışmanı modülündedir.
   */
  @Get('outfit-suggestions')
  async outfitSuggestions(
    @CurrentUser() user: JwtPayload,
    @Query('limit') rawLimit?: string,
  ): Promise<WardrobeOutfitSuggestion[]> {
    const { limit } = outfitSuggestionQuerySchema.parse({ limit: rawLimit });
    return this.wardrobe.suggestOutfits(user.sub, limit);
  }
}
