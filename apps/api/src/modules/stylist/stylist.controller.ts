import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { idSchema, type JwtPayload } from '@vt/contracts';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor.js';
import { CurrentUser } from '../auth/auth.guard.js';
import { StylistService, type StylistEvent } from './stylist.service.js';
import {
  createConversationSchema,
  sendMessageSchema,
  type CreateConversationInput,
  type SendMessageInput,
} from './stylist.schema.js';

/**
 * STİL DANIŞMANI UÇLARI
 *
 * ⚠️ Hiçbiri @Public() DEĞİL. Sepet ve katalog misafire açıktır çünkü
 *    maliyetleri sabittir; danışmanın her mesajı sağlayıcıya para ödetir ve
 *    kota kullanıcı başına tanımlıdır (AI_STYLIST_DAILY_PER_USER). Kimliksiz
 *    kullanım, kotasız kullanım demek olurdu.
 */
@Controller('stylist')
export class StylistController {
  constructor(private readonly stylist: StylistService) {}

  @Post('conversations')
  @HttpCode(201)
  @Idempotent()
  @RateLimit({ name: 'global', scope: 'user' })
  async createConversation(
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(createConversationSchema)) body: CreateConversationInput,
  ): Promise<unknown> {
    return this.stylist.createConversation(user.sub, body);
  }

  @Get('conversations/:id')
  async getConversation(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.stylist.getConversation(user.sub, idSchema.parse(id));
  }

  /**
   * MESAJ GÖNDER — yanıt SSE ile akar.
   *
   * ⚠️ Nest'in `@Sse()` dekoratörü KULLANILMIYOR. Global EnvelopeInterceptor
   *    her dönen değeri `{data, meta}` zarfına sarıyor; SSE'de her olay ayrı
   *    bir kare olduğundan bu zarf her karenin içine girer ve istemci `event`
   *    adını göremez. `@Res()` ile yanıtı doğrudan yazınca Nest dönüş değerini
   *    hiç işlemez ve zarf devreye girmez.
   *
   * ⚠️ @Idempotent() KULLANILMIYOR: idempotency katmanı yanıt gövdesini
   *    kaydedip tekrar oynatır. Akış yanıtının gövdesi yok; kaydedilen "boş"
   *    yanıt, tekrar denemede kullanıcıya boş bir sohbet olarak dönerdi.
   */
  @Post('conversations/:id/messages')
  @RateLimit({ name: 'global', scope: 'user' })
  async sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(zodBody(sendMessageSchema)) body: SendMessageInput,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const conversationId = idSchema.parse(id);

    // ⚠️ Kapılar akış AÇILMADAN önce: başlıklar gittikten sonra 429/503
    //    dönmenin yolu kalmaz, istemci de Retry-After göremez.
    await this.stylist.assertCanSend(user.sub, conversationId);

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    // Ters proxy'de tamponlama SSE'yi öldürür: olaylar bağlantı kapanana
    // kadar biriktirilir ve "canlı yazıyor" etkisi kaybolur.
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    // İstemci sekmeyi kapatırsa sağlayıcı çağrısı da kesilir; kesilmezse
    // kimsenin okumadığı bir yanıt için token ödemeye devam ederiz.
    const abort = new AbortController();
    request.on('close', () => abort.abort());

    const emit = (event: StylistEvent): void => {
      if (response.writableEnded) return;
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };

    try {
      await this.stylist.streamTurn(user.sub, conversationId, body, emit, abort.signal);
    } finally {
      if (!response.writableEnded) response.end();
    }
  }
}
