import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { JwtPayload } from '@vt/contracts';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor.js';
import { CurrentUser } from '../auth/auth.guard.js';
import { MultiTryOnService } from './multi-tryon.service.js';
import { outfitTryOnCreateSchema, type OutfitTryOnCreateInput } from './multi-tryon.schema.js';

/**
 * ÇOKLU ÜRÜN (KOMBİN) DENEME UCU
 *
 * ⚠️ PUBLIC DEĞİLDİR — tek ürün denemesindeki gerekçenin aynısı: rıza kaydı
 *    kullanıcıya bağlıdır, misafirin rızası kanıtlanamaz.
 *
 * Ayrı bir controller olmasının nedeni akışın ayrı olması değil, dosya
 * sınırının ayrı olmasıdır: kombin uçları tek dosyada toplu durur ve tek ürün
 * akışının uçlarıyla karışmaz.
 */
@Controller()
export class MultiTryOnController {
  constructor(private readonly outfit: MultiTryOnService) {}

  /**
   * Kombin denemesi başlatır — VE ilerlemeyi yoklar.
   *
   * ⚠️ Aynı gövdeyle tekrar çağrılmak yeni üretim BAŞLATMAZ: önek anahtarları
   *    aynıdır, devam eden katmanlar için hiçbir şey yazılmaz. İstemci parça
   *    değiştirdiğinde de bu uca yazar; hangi katmanın yeniden üretileceğine
   *    sunucu karar verir.
   *
   * ⚠️ `@Idempotent()` — üretim PARA HARCAR ve kombinde bu bedel parça sayısıyla
   *    çarpılır. Ağ zaman aşımında istemci isteği tekrarlar; bu katman olmadan
   *    aynı kombin iki kez üretilir. (Önek önbelleği ikinci savunma hattıdır.)
   *
   * Durum kodları tek ürün akışıyla tutarlıdır:
   *   202 → üretim kuyrukta, istemci yoklayacak.
   *   200 → söylenecek bir şey HAZIR: tam kombin, yarım kombin ya da
   *         "üretilemedi" bilgisi. Bunlar başarısız İSTEK değil, sonucun
   *         kendisidir; hata koduyla döndürmek istemciyi yeniden denemeye iter.
   */
  @Post('tryon/outfit')
  @Idempotent()
  async create(
    @Body(zodBody(outfitTryOnCreateSchema)) body: OutfitTryOnCreateInput,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.outfit.create(body, { userId: user.sub });

    response.status(result.outcome === 'QUEUED' ? 202 : 200);

    return result;
  }
}
