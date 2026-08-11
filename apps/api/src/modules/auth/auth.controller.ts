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
import { CurrentUser, Public } from './auth.guard.js';
import { AuthService, type RequestMeta } from './auth.service.js';
import type { IssuedTokens } from './token.service.js';

const REFRESH_COOKIE = 'vt_rt';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private meta(request: Request): RequestMeta {
    return {
      ipAddress: request.ip ?? 'unknown',
      userAgent: request.header('User-Agent')?.slice(0, 256) ?? 'unknown',
    };
  }

  /**
   * ⚠️ Refresh token GÖVDEDE DÖNMEZ.
   * httpOnly → JavaScript okuyamaz (XSS ile çalınamaz)
   * Secure   → yalnızca HTTPS
   * SameSite=Strict → CSRF ile başka siteden gönderilemez
   * path     → yalnızca yenileme ve çıkış uçlarına gider, her isteğe değil
   */
  private setRefreshCookie(response: Response, issued: IssuedTokens): void {
    response.cookie(REFRESH_COOKIE, issued.refreshToken, {
      httpOnly: true,
      secure: env().NODE_ENV === 'production',
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

    // TODO(bildirim): SMS adapter'ı yazıldığında kod buradan gönderilecek.
    // Geliştirmede kodu görebilmek için geçici çıktı; üretimde ASLA basılmaz.
    if (env().NODE_ENV === 'development') {
      // `no-console` kuralı `warn`/`error`a zaten izin veriyor — disable
      // yorumu gereksizdi ve "kullanılmayan direktif" uyarısı üretiyordu.
      console.warn(`[GELİŞTİRME] ${phone} için OTP: ${code}`);
    }

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
