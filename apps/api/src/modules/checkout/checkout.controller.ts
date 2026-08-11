import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '@vt/contracts';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor.js';
import { Public } from '../auth/auth.guard.js';
import { CheckoutService, type CheckoutActor } from './checkout.service.js';
import {
  checkoutInitSchema,
  checkoutPaySchema,
  threeDsCallbackSchema,
  type CheckoutInitInput,
  type CheckoutPayInput,
  type ThreeDsCallbackInput,
} from './checkout.schema.js';
import { RawBody, plainHeaders } from './raw-body.js';

/**
 * Misafir sepetinin tarayıcı oturumu.
 * ⚠️ Sepet modülüyle AYNI başlık adı kullanılır; farklı olsaydı misafir
 * kullanıcının sepeti checkout'ta bulunamazdı.
 */
const CART_SESSION_HEADER = 'X-Session-Id';

@Controller()
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /**
   * Sepeti siparişe çevirir, stoğu rezerve eder.
   *
   * `@Public()` çünkü MİSAFİR CHECKOUT desteklenir; token varsa guard yine de
   * çözer ve `request.user` dolar. Kayıt zorunluluğu dönüşümü ölçülebilir
   * biçimde düşürür.
   */
  @Public()
  @Post('checkout/init')
  @RateLimit({ name: 'checkout', scope: 'user' })
  async init(
    @Body(zodBody(checkoutInitSchema)) body: CheckoutInitInput,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.checkout.init(body, actorOf(request));
  }

  /**
   * 3DS akışını başlatır.
   *
   * ⚠️ `@Idempotent()` ZORUNLU. Ağ zaman aşımında istemci isteği tekrarlar;
   *    bu katman olmadan aynı sipariş için ikinci bir ödeme oturumu açılır.
   *    Kart verisi bu uçtan GEÇMEZ — kullanıcı kartını sağlayıcının formuna girer.
   */
  @Public()
  @Post('checkout/pay')
  @Idempotent()
  @RateLimit({ name: 'checkout', scope: 'user' })
  async pay(
    @Body(zodBody(checkoutPaySchema)) body: CheckoutPayInput,
    @Req() request: Request,
  ): Promise<unknown> {
    const result = await this.checkout.pay(body, actorOf(request));
    return {
      orderId: result.orderId,
      providerRef: result.providerRef,
      // Tarayıcı bunu iframe içinde render eder; banka formu doğrudan
      // sağlayıcıya post eder, bize uğramaz.
      threeDsHtml: result.htmlContent,
    };
  }

  /**
   * Bankadan dönen 3DS sonucu.
   *
   * ⚠️ `@Public()` zorunlu: isteği kullanıcının tarayıcısı bankadan yönlendirme
   *    ile yapar, elinde access token yoktur. Güvenlik gövdeden değil,
   *    `conversationId` + sağlayıcıya SORULAN durumdan gelir.
   */
  @Public()
  @Post('payments/3ds/callback')
  @HttpCode(200)
  async threeDsCallback(
    @Body(zodBody(threeDsCallbackSchema)) body: ThreeDsCallbackInput,
  ): Promise<unknown> {
    return this.checkout.threeDsCallback(body);
  }

  /**
   * Sağlayıcı bildirimi.
   *
   * ⚠️ HER DURUMDA 200 döner — imza geçersiz olsa, olay zaten işlenmiş olsa,
   *    işleme sırasında hata çıksa bile. 2xx dışı yanıt sağlayıcının bizi
   *    sonsuz retry kuyruğuna almasına yol açar; asıl hata kaydı
   *    `WebhookEvent.lastError` alanında ve logda tutulur.
   */
  @Public()
  @Post('webhooks/iyzico')
  @HttpCode(200)
  async iyzicoWebhook(@RawBody() rawBody: Buffer, @Req() request: Request): Promise<unknown> {
    return this.checkout.handleWebhook(rawBody, plainHeaders(request));
  }
}

/**
 * İstek bağlamından checkout aktörünü çıkarır.
 *
 * `@CurrentUser()` kullanılmıyor çünkü o dekoratör kullanıcı yoksa hata
 * fırlatır; burada misafir de geçerli bir aktördür.
 */
function actorOf(request: Request & { user?: JwtPayload }): CheckoutActor {
  return {
    userId: request.user?.sub,
    sessionId: request.header(CART_SESSION_HEADER) ?? undefined,
    // ⚠️ `trust proxy` ayarlı (main.ts); aksi hâlde burası hep proxy'nin
    //    IP'si olurdu ve sağlayıcının fraud skoru anlamsızlaşırdı.
    ipAddress: request.ip ?? request.socket.remoteAddress ?? '0.0.0.0',
  };
}
