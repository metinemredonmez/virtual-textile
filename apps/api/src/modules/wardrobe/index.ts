/**
 * DİJİTAL GARDIROP MODÜLÜ
 *
 * Sahip olduğu tablo: `DigitalWardrobeItem` (`user_wardrobe_items`).
 *
 * ⚠️ MODÜL ARTIK CANLI. Tablo `20260812131500_digital_wardrobe` migration'ı
 *    ile açıldı, adaptörler `wardrobe.gateway.ts` içinde yazıldı ve modül
 *    `app.module.ts`e kaydedildi. Bundan önceki hâlinde dört port da
 *    `useValue: null` idi: modül derleniyor, testleri geçiyor ama DI grafiğine
 *    hiç girmiyordu — yani ölü koddu.
 *
 * Başka modülün verisine erişim (kural 3):
 *   • kombin önerisi → `StylistModule` (renk uyumu kural motoru orada)
 *   • sanal deneme   → `AiModule` (rıza/kota/bütçe kapıları orada)
 *   • fotoğraf deposu→ `MediaModule` (`MEDIA_STORAGE`, private kovaya
 *                       sabitlenmiş dar bir sarmalayıcının arkasında)
 */

import { Module } from '@nestjs/common';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { AiModule, MultiTryOnService } from '../ai/index.js';
import { MediaModule } from '../media/index.js';
import { MEDIA_STORAGE, type MediaStoragePort } from '../media/media.ports.js';
import { StylistModule, StylistService } from '../stylist/index.js';
import { WardrobeController } from './wardrobe.controller.js';
import { WardrobeService } from './wardrobe.service.js';
import {
  MultiTryOnWardrobeAdapter,
  PrismaWardrobeRepository,
  StylistWardrobeAdapter,
  WardrobePhotoStorage,
} from './wardrobe.gateway.js';
import {
  WARDROBE_PHOTO_STORAGE,
  WARDROBE_REPOSITORY,
  WARDROBE_STYLIST,
  WARDROBE_TRYON,
} from './wardrobe.ports.js';

@Module({
  /**
   * ⚠️ Üçü de AÇIKÇA import edilir. Nest modülleri tekildir; bu modüllerin
   *    başka yerlerde de import edilmesi ikinci bir servis örneği üretmez.
   */
  imports: [MediaModule, StylistModule, AiModule],
  controllers: [WardrobeController],
  providers: [
    {
      provide: WARDROBE_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaWardrobeRepository(prisma),
    },

    /**
     * ⚠️ `MEDIA_STORAGE` porta DOĞRUDAN bağlanmaz, `WardrobePhotoStorage`
     *    sarmalayıcısından geçer. Doğrudan bağlansaydı porta `publicUrl()` de
     *    gelirdi ve gardırop fotoğrafı için kalıcı, imzasız bir CDN adresi
     *    üretmek mümkün hâle gelirdi (bkz. wardrobe.ports.ts başlığı).
     */
    {
      provide: WARDROBE_PHOTO_STORAGE,
      inject: [MEDIA_STORAGE],
      useFactory: (storage: MediaStoragePort) => new WardrobePhotoStorage(storage),
    },

    {
      provide: WARDROBE_STYLIST,
      inject: [StylistService],
      useFactory: (stylist: StylistService) => new StylistWardrobeAdapter(stylist),
    },

    {
      provide: WARDROBE_TRYON,
      inject: [MultiTryOnService],
      useFactory: (tryOn: MultiTryOnService) => new MultiTryOnWardrobeAdapter(tryOn),
    },

    {
      provide: WardrobeService,
      inject: [
        WARDROBE_REPOSITORY,
        WARDROBE_PHOTO_STORAGE,
        WARDROBE_STYLIST,
        WARDROBE_TRYON,
        APP_LOGGER,
      ],
      useFactory: (...args: ConstructorParameters<typeof WardrobeService>) =>
        new WardrobeService(...args),
    },
  ],
  exports: [WardrobeService],
})
export class WardrobeModule {}

export {
  MultiTryOnWardrobeAdapter,
  PrismaWardrobeRepository,
  StylistWardrobeAdapter,
  WardrobePhotoStorage,
} from './wardrobe.gateway.js';
export { WardrobeService } from './wardrobe.service.js';
export type { WardrobeItemView, WardrobeUploadTicket } from './wardrobe.service.js';
export { WardrobeController } from './wardrobe.controller.js';
export {
  isWardrobeTrigger,
  planAutoAdd,
  readDeliveredPayload,
  WARDROBE_TRIGGER_EVENT,
} from './wardrobe.auto-add.js';
export type { AutoAddPlan, DeliveredItemSnapshot, SkipReason } from './wardrobe.auto-add.js';
export {
  isOwnWardrobeKey,
  isWardrobeKey,
  wardrobeKeys,
  WARDROBE_KEY_PREFIX,
} from './wardrobe.keys.js';
export {
  WARDROBE_PHOTO_STORAGE,
  WARDROBE_REPOSITORY,
  WARDROBE_STYLIST,
  WARDROBE_TRYON,
} from './wardrobe.ports.js';
export type {
  WardrobeAutoAddCommand,
  WardrobeItem,
  WardrobeManualAddCommand,
  WardrobeOutfitSuggestion,
  WardrobePhotoStoragePort,
  WardrobeRepositoryPort,
  WardrobeSource,
  WardrobeStylistPort,
  WardrobeSuggestionInput,
  WardrobeTryOnPort,
} from './wardrobe.ports.js';
