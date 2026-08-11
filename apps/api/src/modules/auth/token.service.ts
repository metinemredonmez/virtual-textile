import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppError, type JwtPayload } from '@vt/contracts';
import { env } from '@vt/config';
import { PrismaService } from '../../infra/prisma.service.js';
import type { Logger } from '../../common/logger.js';

export interface IssueTokensInput {
  userId: string;
  role: JwtPayload['role'];
  sellerIds: string[];
  ipAddress: string;
  userAgent: string;
  deviceLabel?: string;
  /** Rotasyonda: yerine geçilen oturum. */
  replacesSessionId?: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  accessExpiresInSeconds: number;
  refreshExpiresAt: Date;
}

/**
 * TOKEN YAŞAM DÖNGÜSÜ
 *
 * Access  : 15 dk, JWT, bellekte tutulur. İptal edilemez — kısa ömrü budur.
 * Refresh : 30 gün, rastgele 32 bayt, httpOnly çerezde. Veritabanında
 *           yalnızca SHA-256 ÖZETİ saklanır.
 *
 * ⚠️ Refresh token'ın kendisi veritabanına yazılmaz. Veritabanı sızarsa
 *    saldırgan oturumları ele geçiremesin diye. Özet karşılaştırması yapılır.
 *
 * ROTASYON: her yenilemede eski token iptal edilir, yenisi verilir.
 * YENİDEN KULLANIM TESPİTİ: iptal edilmiş bir refresh token tekrar
 * kullanılırsa, bu token'ın çalındığı anlamına gelir (meşru istemci artık
 * yeni token'a sahiptir). O kullanıcının TÜM oturumları düşürülür.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}

  /** Refresh token'ı yalnızca özetiyle sakla. */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseDurationToSeconds(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) throw new Error(`Geçersiz süre biçimi: ${value}`);
    const amount = Number(match[1]);
    const unit = match[2] as 's' | 'm' | 'h' | 'd';
    return amount * { s: 1, m: 60, h: 3600, d: 86_400 }[unit];
  }

  async issue(input: IssueTokensInput): Promise<IssuedTokens> {
    const config = env();
    const accessTtl = this.parseDurationToSeconds(config.JWT_ACCESS_TTL);
    const refreshTtl = this.parseDurationToSeconds(config.JWT_REFRESH_TTL);

    const sessionId = randomUUID();
    // 32 bayt = 256 bit entropi. Tahmin edilemez.
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + refreshTtl * 1000);

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: input.userId,
        refreshTokenHash: this.hash(refreshToken),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        deviceLabel: input.deviceLabel ?? null,
        expiresAt: refreshExpiresAt,
      },
    });

    if (input.replacesSessionId) {
      await this.prisma.session.update({
        where: { id: input.replacesSessionId },
        data: { replacedBySessionId: sessionId },
      });
    }

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: input.userId,
      role: input.role,
      sellerIds: input.sellerIds,
      sid: sessionId,
      jti: randomUUID(),
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: config.JWT_ACCESS_SECRET,
      expiresIn: accessTtl,
    });

    return {
      accessToken,
      refreshToken,
      sessionId,
      accessExpiresInSeconds: accessTtl,
      refreshExpiresAt,
    };
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: env().JWT_ACCESS_SECRET,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw new AppError(
        name === 'TokenExpiredError' ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID',
        {
          cause: error,
        },
      );
    }
  }

  /**
   * Refresh token'ı doğrular ve YENİSİYLE DEĞİŞTİRİR.
   *
   * Yeniden kullanım tespit edilirse kullanıcının tüm oturumları düşürülür ve
   * `AUTH_REFRESH_REUSED` fırlatılır.
   */
  async rotate(
    refreshToken: string,
    context: { ipAddress: string; userAgent: string },
  ): Promise<IssuedTokens & { userId: string }> {
    const tokenHash = this.hash(refreshToken);

    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: tokenHash },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            status: true,
            sellerMemberships: { select: { sellerId: true } },
          },
        },
      },
    });

    if (!session) {
      throw new AppError('AUTH_TOKEN_INVALID', {
        internalMessage: 'Bilinmeyen refresh token özeti',
      });
    }

    // ⚠️ YENİDEN KULLANIM TESPİTİ
    // İptal edilmiş bir token tekrar geldi. Meşru istemci çoktan yeni token'a
    // geçmişti; bu isteği yapan taraf token'ı çalmış demektir. Hangisinin
    // saldırgan olduğunu bilemeyiz, bu yüzden HEPSİNİ düşürürüz.
    if (session.revokedAt) {
      await this.revokeAllSessions(session.userId, 'refresh_token_reuse');
      this.logger.error(
        { userId: session.userId, sessionId: session.id, ip: context.ipAddress },
        'Refresh token yeniden kullanıldı — tüm oturumlar düşürüldü',
      );
      throw new AppError('AUTH_REFRESH_REUSED');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new AppError('AUTH_TOKEN_EXPIRED');
    }

    if (session.user.status !== 'ACTIVE') {
      await this.revokeAllSessions(session.userId, 'user_not_active');
      throw new AppError('AUTH_ACCOUNT_SUSPENDED');
    }

    // Eski oturumu kapat, yenisini aç.
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });

    const issued = await this.issue({
      userId: session.user.id,
      role: session.user.role,
      sellerIds: session.user.sellerMemberships.map((m) => m.sellerId),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      deviceLabel: session.deviceLabel ?? undefined,
      replacesSessionId: session.id,
    });

    return { ...issued, userId: session.user.id };
  }

  /** Tek oturumu kapatır (çıkış). */
  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Tüm oturumları kapatır — şifre değişimi, hesap askıya alma, token hırsızlığı. */
  async revokeAllSessions(userId: string, reason: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: {
        revokedAt: new Date(),
        reusedAt: reason === 'refresh_token_reuse' ? new Date() : null,
      },
    });
    return result.count;
  }

  /**
   * Oturumun hâlâ geçerli olduğunu doğrular.
   *
   * Access token 15 dakika geçerlidir ve iptal edilemez; ancak oturum
   * düşürüldüyse (çıkış, şifre değişimi, token hırsızlığı) o access token'ın
   * kalan ömrü boyunca kullanılmasını engellemek isteriz.
   */
  async isSessionActive(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });
    if (!session) return false;
    return session.revokedAt === null && session.expiresAt.getTime() > Date.now();
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.prisma.session
      .update({ where: { id: sessionId }, data: { lastUsedAt: new Date() } })
      .catch(() => {
        // Oturum silinmişse sorun değil; yetki kontrolü zaten reddedecek.
      });
  }
}
