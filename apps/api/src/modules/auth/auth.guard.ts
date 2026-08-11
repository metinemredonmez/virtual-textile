import {
  Injectable,
  SetMetadata,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError, type AuthenticatedUser, type JwtPayload } from '@vt/contracts';
import { getContext } from '../../common/request-context.js';
import { TokenService } from './token.service.js';

export const PUBLIC_KEY = 'vt:public';
export const ROLES_KEY = 'vt:roles';

/** Kimlik doğrulaması gerektirmeyen uç. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);

/** Bu uca yalnızca belirtilen roller erişebilir. */
export const Roles = (...roles: AuthenticatedUser['role'][]): MethodDecorator =>
  SetMetadata(ROLES_KEY, roles);

/** Denetleyicide `@CurrentUser() user: JwtPayload` olarak kullanılır. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload => {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    if (!request.user) {
      throw new AppError('AUTH_TOKEN_MISSING');
    }
    return request.user;
  },
);

/**
 * KİMLİK DOĞRULAMA
 *
 * Varsayılan KAPALI: bir uç açıkça `@Public()` ile işaretlenmediyse token ister.
 * Tersi (varsayılan açık) tehlikelidir — yeni bir uç eklerken guard koymayı
 * unutmak, o ucu herkese açık bırakır.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload; userId?: string; sellerId?: string }>();

    const token = this.extractToken(request);

    // Public uçlarda token varsa yine de çözülür — misafir/üye ayrımı yapan
    // uçlar (ör. ürün listeleme kişiselleştirmesi) kullanıcıyı görebilsin.
    if (!token) {
      if (isPublic) return true;
      throw new AppError('AUTH_TOKEN_MISSING');
    }

    let payload: JwtPayload;
    try {
      payload = await this.tokens.verifyAccessToken(token);
    } catch (error) {
      if (isPublic) return true; // bozuk token public ucu engellemez
      throw error;
    }

    // ⚠️ Access token iptal edilemez ama OTURUM edilebilir.
    // Çıkış yapıldıysa, şifre değiştiyse veya token hırsızlığı tespit
    // edildiyse, kalan 15 dakikalık ömür kullanılamasın.
    if (!(await this.tokens.isSessionActive(payload.sid))) {
      if (isPublic) return true;
      throw new AppError('AUTH_TOKEN_INVALID', {
        internalMessage: `Oturum ${payload.sid} artık geçerli değil`,
      });
    }

    request.user = payload;
    request.userId = payload.sub;

    // İstek bağlamını zenginleştir — log ve audit kayıtları bunu okur.
    const ctx = getContext();
    if (ctx) {
      ctx.userId = payload.sub;
      ctx.role = payload.role;
    }

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.header('Authorization');
    if (!header) return undefined;
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;
    return value;
  }
}

/**
 * ROL TABANLI YETKİLENDİRME
 *
 * `@Roles('ADMIN')` ile işaretlenmemiş uçlarda çalışmaz — yetki kontrolü
 * her ucun kendi sorumluluğudur ve açıkça yazılır.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AuthenticatedUser['role'][]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;

    if (!user) throw new AppError('AUTH_TOKEN_MISSING');

    if (!required.includes(user.role)) {
      throw new AppError('AUTH_FORBIDDEN', {
        internalMessage: `Rol ${user.role}, gereken: ${required.join('|')}`,
      });
    }

    return true;
  }
}

/**
 * MAĞAZA SAHİPLİĞİ
 *
 * Satıcı uçlarında `:sellerId` parametresinin kullanıcının erişebildiği
 * mağazalardan biri olduğunu doğrular.
 *
 * ⚠️ Bu kontrol olmadan bir satıcı, URL'deki kimliği değiştirerek başka bir
 *    mağazanın siparişlerini ve cirosunu görebilir.
 */
@Injectable()
export class SellerScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload; sellerId?: string }>();
    const user = request.user;
    if (!user) throw new AppError('AUTH_TOKEN_MISSING');

    // Admin ve destek tüm mağazaları görebilir.
    if (user.role === 'ADMIN' || user.role === 'SUPPORT') return true;

    const requested =
      (request.params as Record<string, string | undefined>).sellerId ??
      request.header('X-Seller-Id');

    // Parametre verilmediyse: kullanıcının tek mağazası varsa onu kullan.
    if (!requested) {
      if (user.sellerIds.length === 1) {
        request.sellerId = user.sellerIds[0];
        return true;
      }
      throw new AppError('AUTH_FORBIDDEN', {
        internalMessage: 'Mağaza seçilmedi ve kullanıcının birden fazla mağazası var',
      });
    }

    if (!user.sellerIds.includes(requested)) {
      throw new AppError('AUTH_FORBIDDEN', {
        internalMessage: `Kullanıcı ${user.sub} mağaza ${requested} için yetkisiz`,
      });
    }

    request.sellerId = requested;
    return true;
  }
}
