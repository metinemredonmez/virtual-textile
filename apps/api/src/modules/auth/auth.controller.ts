import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  AppError,
  changePasswordSchema,
  loginSchema,
  registerSchema,
  sendOtpSchema,
  verifyOtpSchema,
  type AuthenticatedUser,
  type AuthSessionResponse,
  type JwtPayload,
  type SessionSummary,
} from '@vt/contracts';
import { env } from '@vt/config';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { NotificationService } from '../notification/notification.service.js';
import { CurrentUser, Public } from './auth.guard.js';
import { AuthService, type RequestMeta } from './auth.service.js';
import type { IssuedTokens } from './token.service.js';

const REFRESH_COOKIE = 'vt_rt';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly notifications: NotificationService,
  ) {}

  private meta(request: Request): RequestMeta {
    return {
      ipAddress: request.ip ?? 'unknown',
      userAgent: request.header('User-Agent')?.slice(0, 256) ?? 'unknown',
    };
  }

  /**
   * ⚠️ Refresh token GÖVDEDE DÖNMEZ.
   * httpOnly → JavaScript okuyamaz (XSS ile çalınamaz)
   * SameSite=Strict → CSRF ile başka siteden gönderilemez
   * path     → yalnızca yenileme ve çıkış uçlarına gider, her isteğe değil
   *
   * ⚠️ `secure` ŞEMADAN TÜRETİLİR, `NODE_ENV`DEN DEĞİL — canlıda ölçüldü.
   *
   *    Eskiden `env().NODE_ENV === 'production'` yazıyordu. Sunucu üretim
   *    modunda ama site HTTP üzerinden servis ediliyor (alan adı/TLS henüz
   *    yok). `Secure` bayraklı çerezi tarayıcı HTTP'de SESSİZCE ATAR: sunucu
   *    200 döner, çerez hiç yazılmaz, kullanıcı giriş yapamaz.
   *
   *    ⚠️ VE BU `curl` İLE GÖRÜNMEZ — curl `Secure` kuralını uygulamaz.
   *       Web tarafındaki `vt_sid` çerezinde birebir aynı arıza vardı
   *       (bkz. `apps/web/src/lib/session/cookies.ts`); ikisi ayrı kod
   *       yollarında AYNI yanlış sinyale bakıyordu.
   *
   *    `NODE_ENV` "bu bir üretim derlemesi" der, "bu bağlantı şifreli" DEMEZ.
   *    `APP_URL` tam olarak onu söylüyor ve TLS geldiği gün bayrak
   *    KENDİLİĞİNDEN açılır.
   *
   * ⚠️ GÜVENLİK GEVŞETMESİ DEĞİL: HTTP üzerinde `Secure` hiçbir şey
   *    korumuyordu, çerez zaten hiç yazılmıyordu. Asıl koruma TLS'tir ve ayrı
   *    bir iş olarak duruyor.
   */
  private setRefreshCookie(response: Response, issued: IssuedTokens): void {
    response.cookie(REFRESH_COOKIE, issued.refreshToken, {
      httpOnly: true,
      secure: env().APP_URL.startsWith('https://'),
      sameSite: 'strict',
      path: '/v1/auth',
      expires: issued.refreshExpiresAt,
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
  }

  @Public()
  @Post('register')
  @RateLimit({ name: 'register', scope: 'ip' })
  async register(
    @Body(zodBody(registerSchema)) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const input = body as Parameters<AuthService['register']>[0];
    const { response: payload, issued } = await this.auth.register(input, this.meta(request));
    this.setRefreshCookie(response, issued);
    return payload;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  // IP + e-posta ile anahtarlanır: tek IP'den çok hesaba da, çok IP'den tek
  // hesaba da yapılan denemeleri yakalar.
  @RateLimit({ name: 'login', scope: 'ip+body', bodyField: 'identifier' })
  async login(
    @Body(zodBody(loginSchema)) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const input = body as Parameters<AuthService['login']>[0];
    const { response: payload, issued } = await this.auth.login(input, this.meta(request));
    this.setRefreshCookie(response, issued);
    return payload;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const token = (request.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!token) {
      throw new AppError('AUTH_TOKEN_MISSING', {
        internalMessage: 'Refresh çerezi yok',
      });
    }

    try {
      const { response: payload, issued } = await this.auth.refresh(token, this.meta(request));
      this.setRefreshCookie(response, issued);
      return payload;
    } catch (error) {
      // Token geçersiz/çalınmış: çerezi temizle ki istemci döngüye girmesin.
      this.clearRefreshCookie(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(user.sid);
    this.clearRefreshCookie(response);
  }

  @Get('me')
  async me(@CurrentUser() user: JwtPayload): Promise<AuthenticatedUser> {
    return this.auth.me(user.sub);
  }

  // ── Oturum yönetimi ──────────────────────────────────────────────────────

  @Get('sessions')
  async sessions(@CurrentUser() user: JwtPayload): Promise<SessionSummary[]> {
    return this.auth.listSessions(user.sub, user.sid);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(
    @CurrentUser() user: JwtPayload,
    @Param('id') sessionId: string,
  ): Promise<void> {
    await this.auth.revokeSession(user.sub, sessionId);
  }

  // ── OTP ──────────────────────────────────────────────────────────────────

  @Public()
  @Post('otp/send')
  @HttpCode(202)
  @RateLimit({ name: 'otpSend', scope: 'ip+body', bodyField: 'phone' })
  async sendOtp(@Body(zodBody(sendOtpSchema)) body: unknown): Promise<{ ttlSeconds: number }> {
    const { phone, purpose } = body as {
      phone: string;
      purpose: 'PHONE_VERIFICATION' | 'LOGIN' | 'PASSWORD_RESET';
    };
    const { code, ttlSeconds } = await this.auth.sendOtp(phone, purpose);

    // ⚠️ Kod BURADAN ÇIKMAZ: `notifications.sendOtp` onu yalnızca şablona
    //    doldurur, hiçbir log satırına yazmaz. Geliştirmede kodu görmek için
    //    konsola basan sağlayıcı devreye girer (ConsoleSmsProvider) — karar
    //    burada değil, sağlayıcı fabrikasındadır.
    //
    // ⚠️ Hata YUTULMAZ. Gönderim başarısızsa 202 dönüp "kod yolda" demek,
    //    kullanıcıyı gelmeyecek bir SMS için bekletmektir.
    await this.notifications.sendOtp({ phone, purpose, code, ttlSeconds });

    // ⚠️ Yanıt, numaranın kayıtlı olup olmadığını sızdırmaz.
    return { ttlSeconds };
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body(zodBody(verifyOtpSchema)) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse | { verified: true }> {
    const { phone, purpose, code } = body as {
      phone: string;
      purpose: 'PHONE_VERIFICATION' | 'LOGIN' | 'PASSWORD_RESET';
      code: string;
    };

    const result = await this.auth.verifyOtp(phone, purpose, code, this.meta(request));
    if (!result) return { verified: true };

    this.setRefreshCookie(response, result.issued);
    return result.response;
  }

  // ── Şifre ────────────────────────────────────────────────────────────────

  @Post('password/change')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(changePasswordSchema)) body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ revokedSessions: number }> {
    const { currentPassword, newPassword } = body as {
      currentPassword: string;
      newPassword: string;
    };
    const result = await this.auth.changePassword(user.sub, currentPassword, newPassword);
    // Tüm oturumlar düştü — bu istemcinin de yeniden giriş yapması gerekir.
    this.clearRefreshCookie(response);
    return result;
  }
}
