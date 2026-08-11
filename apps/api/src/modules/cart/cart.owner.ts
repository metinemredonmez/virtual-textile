import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { appError, type JwtPayload } from '@vt/contracts';
import type { CartOwner } from './cart.service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sepetin sahibini belirler: giriş yapmış kullanıcı ya da misafir oturumu.
 *
 * ⚠️ Token varsa `X-Session-Id` BAŞLIĞI YOK SAYILIR. Aksi hâlde bir üye,
 * başkasının misafir oturum kimliğini başlığa koyarak o sepeti okuyabilir ve
 * değiştirebilirdi. Misafir sepetini üyeye taşımanın tek meşru yolu
 * POST /cart/merge'dir; orası kimliği gövdeden ve bilinçli olarak alır.
 *
 * ⚠️ Oturum kimliği bir SIRDIR (bilen sepete erişir). UUID biçimi zorunlu
 * tutulur ki tahmin edilebilir değerler ("guest-1") kullanılamasın; log'a da
 * yazılmaz.
 */
export const CartOwnerParam = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CartOwner => {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();

    if (request.user) return { kind: 'user', userId: request.user.sub };

    const sessionId = request.header('X-Session-Id');
    if (!sessionId || !UUID_PATTERN.test(sessionId)) {
      throw appError('VALIDATION_FAILED', {
        internalMessage: 'Misafir sepeti için geçerli X-Session-Id başlığı gerekli',
        details: {
          fields: [
            {
              path: 'headers.X-Session-Id',
              message: 'Misafir sepeti için geçerli bir oturum kimliği gönderilmelidir.',
            },
          ],
        },
      });
    }

    return { kind: 'guest', sessionId };
  },
);
