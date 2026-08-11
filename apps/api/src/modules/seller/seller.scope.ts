import {
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppError, type JwtPayload } from '@vt/contracts';
import { ROLES_KEY, SellerScopeGuard } from '../auth/auth.guard.js';

/**
 * SATICI PANELİ KORUMASI — rol + mağaza kapsamı, TEK parça.
 *
 * ⚠️ İkisi ayrı ayrı yazılabilseydi biri konup diğeri unutulabilirdi ve
 *    o uç yarı korumalı kalırdı: yalnızca `@Roles('SELLER_USER')` olan bir
 *    uçta herhangi bir satıcı, URL'deki kimliği değiştirip BAŞKA MAĞAZANIN
 *    cirosunu okuyabilirdi. Tek dekoratör bu ihtimali ortadan kaldırır.
 *
 * Sınıfa uygulanır: yeni eklenen her uç otomatik olarak korunur (varsayılan
 * KAPALI). `@Roles` doğrudan kullanılmıyor çünkü `MethodDecorator` olarak
 * tiplenmiş; aynı metadata anahtarı sınıf düzeyinde yazılıyor ve `RolesGuard`
 * bunu `getAllAndOverride([handler, class])` ile okuyor.
 */
export const SellerPanel = (): ClassDecorator & MethodDecorator =>
  applyDecorators(
    SetMetadata(ROLES_KEY, ['SELLER_USER']),
    UseGuards(SellerScopeGuard),
  ) as ClassDecorator & MethodDecorator;

/**
 * `SellerScopeGuard`'ın çözdüğü mağaza kimliğini denetleyiciye taşır.
 *
 * ⚠️ Kimlik gövdeden veya sorgu dizesinden ASLA okunmaz — yalnızca guard'ın
 *    `request.sellerId`'ye yazdığı değer kullanılır. Guard, bu kimliğin
 *    token'daki `sellerIds` listesinde olduğunu doğrulamıştır; başka bir
 *    kaynaktan okunsaydı satıcı URL'deki kimliği değiştirip başka mağazanın
 *    cirosunu görebilirdi.
 *
 * Guard çalışmadan bu dekoratör kullanılırsa değer boş olur ve istek reddedilir:
 * sessizce "tüm mağazalar" gibi davranmak, tam da engellemek istediğimiz
 * sızıntıdır.
 */
export const SellerId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { sellerId?: string; user?: JwtPayload }>();

    const sellerId = request.sellerId;
    if (!sellerId) {
      throw new AppError('AUTH_FORBIDDEN', {
        internalMessage:
          'request.sellerId boş — uç noktada SellerScopeGuard eksik olabilir. Mağaza kapsamı doğrulanmadan işlem yapılmaz.',
      });
    }
    return sellerId;
  },
);
