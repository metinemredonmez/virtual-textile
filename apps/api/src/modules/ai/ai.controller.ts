import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { JwtPayload } from '@vt/contracts';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor.js';
import { CurrentUser, Public } from '../auth/auth.guard.js';
import { TryOnService } from './tryon.service.js';
import { SizeService } from './size.service.js';
import {
  sizeRecommendSchema,
  tryOnCreateSchema,
  tryOnHistoryQuerySchema,
  type SizeRecommendInput,
  type TryOnCreateInput,
  type TryOnHistoryQuery,
} from './ai.schema.js';

/**
 * AI GATEWAY
 *
 * ⚠️ Sanal deneme uçları PUBLIC DEĞİLDİR. Rıza kaydı kullanıcıya bağlıdır
 *    (ConsentRecord.userId); misafirin rızası kanıtlanamaz, dolayısıyla
 *    fotoğrafı işlenemez. Beden önerisi ise kişisel veri gerektirmez ve
 *    misafire de açıktır — ölçüler gövdede gelir, saklanmaz.
 */
@Controller()
export class AiController {
  constructor(
    private readonly tryOn: TryOnService,
    private readonly size: SizeService,
  ) {}

  /**
   * Sanal deneme başlatır.
   *
   * ⚠️ SENKRON BEKLEME YOK: iş kuyruğa alınır ve 202 döner. İstemci
   *    `GET /tryon/:jobId` ile durumu yoklar; kullanıcı bu sırada gezinir.
   *
   * ⚠️ `@Idempotent()` — üretim PARA HARCAR. Ağ zaman aşımında istemci isteği
   *    tekrarlar; bu katman olmadan aynı deneme iki kez üretilir ve iki kez
   *    faturalanır. (Önbellek ikinci savunma hattıdır, birincisi bu.)
   */
  @Post('tryon')
  @Idempotent()
  async create(
    @Body(zodBody(tryOnCreateSchema)) body: TryOnCreateInput,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.tryOn.create(body, { userId: user.sub });

    if (result.outcome === 'CACHED') {
      // Önbellek isabeti: sonuç HAZIR. 202 dönmek istemciyi var olmayan bir
      // işi yoklamaya iter; 200 ile görsel anında gösterilir.
      response.status(200);
      return {
        jobId: result.jobId,
        status: result.status,
        cached: true,
        resultUrl: result.resultUrl,
        visualConfidence: result.visualConfidence,
        lowConfidence: result.lowConfidence,
      };
    }

    response.status(202);
    return {
      jobId: result.jobId,
      status: 'QUEUED',
      cached: false,
      estimatedSeconds: result.estimatedSeconds,
    };
  }

  /**
   * ⚠️ SIRA ÖNEMLİ: bu tanım `tryon/:jobId`den ÖNCE gelmeli.
   * Aksi hâlde "history" bir iş kimliği sanılır ve geçmiş ucu hiç çalışmaz.
   */
  @Get('tryon/history')
  async history(
    @Query(zodBody(tryOnHistoryQuerySchema)) query: TryOnHistoryQuery,
    @CurrentUser() user: JwtPayload,
  ): Promise<unknown> {
    // EnvelopeInterceptor `items` + `nextCursor`'ı zarf meta'sına taşır.
    return this.tryOn.history(query, { userId: user.sub });
  }

  /**
   * ⚠️ KVKK: kullanıcının geçmişini ve ÜRETİLEN GÖRSELLERİ siler.
   * Depodaki nesnelerin silinmesi outbox üzerinden worker'a devredilir.
   */
  @Delete('tryon/history')
  async deleteHistory(@CurrentUser() user: JwtPayload): Promise<unknown> {
    return this.tryOn.deleteHistory({ userId: user.sub });
  }

  @Get('tryon/:jobId')
  async findOne(@Param('jobId') jobId: string, @CurrentUser() user: JwtPayload): Promise<unknown> {
    return this.tryOn.findJob(jobId, { userId: user.sub });
  }

  /**
   * Beden önerisi.
   *
   * `@Public()` — misafir de öneri alabilmeli; ölçüler gövdeden gelir ve
   * KAYDEDİLMEZ. Token varsa guard onu yine çözer ve kayıtlı vücut profili
   * kullanılır.
   *
   * ⚠️ POST kullanılıyor çünkü vücut ölçüleri kişisel veridir: query string'e
   *    konulsaydı erişim loglarına, proxy'lere ve tarayıcı geçmişine yazılırdı.
   */
  @Public()
  @Post('size/recommend')
  async recommendSize(
    @Body(zodBody(sizeRecommendSchema)) body: SizeRecommendInput,
    @Req() request: Request & { user?: JwtPayload },
  ): Promise<unknown> {
    return this.size.recommend(body, request.user?.sub ?? null);
  }
}
