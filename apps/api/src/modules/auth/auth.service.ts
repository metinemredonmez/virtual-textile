import { Injectable } from '@nestjs/common';
import {
  AppError,
  type AuthenticatedUser,
  type AuthSessionResponse,
  type LoginInput,
  type RegisterInput,
  type SessionSummary,
} from '@vt/contracts';
import type { Prisma } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import type { Logger } from '../../common/logger.js';
import { PasswordService } from './password.service.js';
import { TokenService, type IssuedTokens } from './token.service.js';
import { OtpService, type OtpPurpose } from './otp.service.js';
// ⚠️ Modül sınırı: `me` modülünün yalnızca yayımlanmış servis yüzeyi alınıyor.
//    `index.js` üzerinden alınsaydı `MeController` de kimlik modülünün import
//    grafiğine girerdi; ihtiyaç duyulan tek şey `cancelAccountDeletion`.
import { MeService } from '../me/me.service.js';

export interface RequestMeta {
  ipAddress: string;
  userAgent: string;
}

/** Prisma sorgusu — kullanıcıyı yetki kararı için gereken alanlarla getirir. */
const userSelect = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  passwordHash: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  // ⚠️ Girişte "silme talebi var mı" sorusunu ayrı bir sorgu açmadan
  //    cevaplayabilmek için seçiliyor (bkz. startSession). Alan HİÇBİR ZAMAN
  //    `AuthenticatedUser`'a taşınmıyor — yanıt sözleşmesi değişmedi.
  deletionRequestedAt: true,
  sellerMemberships: { select: { sellerId: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    // ⚠️ `meService` — sade `me` DEĞİL: bu sınıfta zaten `me(userId)` metodu
    //    var ve aynı ada sahip bir alan onu gölgeler (TS2300).
    private readonly meService: MeService,
    private readonly logger: Logger,
  ) {}

  private toAuthenticatedUser(user: UserRow): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      emailVerified: user.emailVerifiedAt !== null,
      phoneVerified: user.phoneVerifiedAt !== null,
      sellerIds: user.sellerMemberships.map((m) => m.sellerId),
    };
  }

  async register(
    input: RegisterInput,
    meta: RequestMeta,
  ): Promise<{ response: AuthSessionResponse; issued: IssuedTokens }> {
    const passwordHash = await this.passwords.hash(input.password);

    // Unique ihlali GlobalExceptionFilter tarafından AUTH_EMAIL_TAKEN /
    // AUTH_PHONE_TAKEN'a çevrilir — burada ayrıca kontrol etmiyoruz,
    // aksi hâlde kontrol ile insert arasında yarış durumu oluşur.
    const user = await this.prisma.user.create({
      data: {
        email: input.email ?? null,
        phone: input.phone ?? null,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: 'CUSTOMER',
        consents: {
          create: [
            {
              type: 'MARKETING',
              granted: input.marketingConsent,
              documentVersion: 'v1.0',
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
            },
          ],
        },
      },
      select: userSelect,
    });

    return this.startSession(user, meta);
  }

  async login(
    input: LoginInput,
    meta: RequestMeta,
  ): Promise<{ response: AuthSessionResponse; issued: IssuedTokens }> {
    const identifier = input.identifier.trim();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier.toLowerCase() }, { phone: identifier }],
      },
      select: userSelect,
    });

    // ⚠️ KULLANICI NUMARALANDIRMA KORUMASI
    // Kullanıcı yoksa da parola doğrulaması kadar zaman harcanır ve AYNI hata
    // döner. Aksi hâlde yanıt süresi veya hata metni "bu e-posta kayıtlı"
    // bilgisini sızdırır.
    if (!user?.passwordHash) {
      await this.passwords.wasteTime();
      throw new AppError('AUTH_INVALID_CREDENTIALS');
    }

    const valid = await this.passwords.verify(user.passwordHash, input.password);
    if (!valid) {
      throw new AppError('AUTH_INVALID_CREDENTIALS');
    }

    if (user.status === 'SUSPENDED') throw new AppError('AUTH_ACCOUNT_SUSPENDED');
    if (user.status !== 'ACTIVE') throw new AppError('AUTH_INVALID_CREDENTIALS');

    // argon2 parametreleri sıkılaştırıldıysa kademeli yükselt.
    if (this.passwords.needsRehash(user.passwordHash)) {
      const rehashed = await this.passwords.hash(input.password);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: rehashed },
      });
    }

    return this.startSession(user, meta);
  }

  private async startSession(
    user: UserRow,
    meta: RequestMeta,
  ): Promise<{ response: AuthSessionResponse; issued: IssuedTokens }> {
    const issued = await this.tokens.issue({
      userId: user.id,
      role: user.role,
      sellerIds: user.sellerMemberships.map((m) => m.sellerId),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      deviceLabel: describeDevice(meta.userAgent),
    });

    // ⚠️ KVKK — "30 gün içinde giriş yaparsan hesap silme talebin düşer".
    //
    //  • Token ÜRETİLDİKTEN SONRA çağrılıyor: `issue` düşerse kullanıcı
    //    içeri girememiş demektir, o hâlde talebi de iptal etmiş sayılmaz.
    //  • Yalnızca gerçekten bekleyen bir talep varsa çağrılıyor; alan zaten
    //    `userSelect` ile geldiği için normal girişte EK SORGU AÇILMIYOR.
    //  • Süre dolmuşsa kararı `MeService` verir ve `cancelled: false` döner —
    //    "penceresi kapanmış talebi giriş diriltir" hatası burada değil,
    //    tek bir yerde (account-deletion.ts) engellenir.
    //  • HATA YUTULUYOR: iptal yazımı düşerse giriş DÜŞMEZ. Aksi hâlde silme
    //    talebi olan kullanıcı hesabına hiç giremez, dolayısıyla vazgeçme
    //    penceresinin kendisi anlamsız kalırdı.
    if (user.deletionRequestedAt !== null) {
      try {
        const cancellation = await this.meService.cancelAccountDeletion({
          userId: user.id,
          role: user.role,
        });
        this.logger.info(
          { userId: user.id, cancelled: cancellation.cancelled },
          'Girişte hesap silme talebi değerlendirildi',
        );
      } catch (error) {
        this.logger.error(
          { userId: user.id, err: error },
          'Girişte hesap silme talebi iptal edilemedi',
        );
      }
    }

    return {
      issued,
      response: {
        user: this.toAuthenticatedUser(user),
        tokens: {
          accessToken: issued.accessToken,
          expiresIn: issued.accessExpiresInSeconds,
          tokenType: 'Bearer',
        },
      },
    };
  }

  async refresh(
    refreshToken: string,
    meta: RequestMeta,
  ): Promise<{ response: AuthSessionResponse; issued: IssuedTokens }> {
    const rotated = await this.tokens.rotate(refreshToken, meta);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: rotated.userId },
      select: userSelect,
    });

    return {
      issued: rotated,
      response: {
        user: this.toAuthenticatedUser(user),
        tokens: {
          accessToken: rotated.accessToken,
          expiresIn: rotated.accessExpiresInSeconds,
          tokenType: 'Bearer',
        },
      },
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.tokens.revokeSession(sessionId);
  }

  async me(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: userSelect,
    });
    return this.toAuthenticatedUser(user);
  }

  async listSessions(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        deviceLabel: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    return sessions.map((s) => ({
      id: s.id,
      deviceLabel: s.deviceLabel,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  /** Kullanıcı kendi oturumlarından birini kapatabilir — başkasınınkini değil. */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new AppError('NOT_FOUND', { internalMessage: 'Oturum bulunamadı veya zaten kapalı' });
    }
  }

  // ── OTP ──────────────────────────────────────────────────────────────────

  /**
   * Kod üretir. SMS gönderimi çağıran tarafın işidir (bildirim adapter'ı).
   *
   * ⚠️ Numaranın kayıtlı olup olmadığı YANITTAN anlaşılmaz — her durumda aynı
   *    yanıt döner. Aksi hâlde bu uç bir kullanıcı numaralandırma aracına dönüşür.
   */
  async sendOtp(phone: string, purpose: OtpPurpose): Promise<{ code: string; ttlSeconds: number }> {
    return this.otp.issue(phone, purpose);
  }

  async verifyOtp(
    phone: string,
    purpose: OtpPurpose,
    code: string,
    meta: RequestMeta,
  ): Promise<{ response: AuthSessionResponse; issued: IssuedTokens } | null> {
    await this.otp.verify(phone, purpose, code);

    if (purpose === 'PHONE_VERIFICATION') {
      await this.prisma.user.updateMany({
        where: { phone },
        data: { phoneVerifiedAt: new Date() },
      });
      return null;
    }

    if (purpose === 'LOGIN') {
      const user = await this.prisma.user.findUnique({ where: { phone }, select: userSelect });
      if (!user) throw new AppError('AUTH_INVALID_CREDENTIALS');
      if (user.status !== 'ACTIVE') throw new AppError('AUTH_ACCOUNT_SUSPENDED');
      return this.startSession(user, meta);
    }

    return null;
  }

  /**
   * Şifre değişimi TÜM oturumları düşürür.
   * Şifre değiştirmenin başlıca sebebi "hesabım ele geçirilmiş olabilir"dir;
   * saldırganın oturumu açık kalırsa işlem anlamsızdır.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ revokedSessions: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user.passwordHash || !(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new AppError('AUTH_INVALID_CREDENTIALS');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(newPassword) },
    });

    const revokedSessions = await this.tokens.revokeAllSessions(userId, 'password_changed');
    this.logger.info({ userId, revokedSessions }, 'Şifre değişti, oturumlar düşürüldü');

    return { revokedSessions };
  }
}

/** User-agent'tan okunabilir cihaz etiketi — oturum listesinde gösterilir. */
function describeDevice(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  const os = ua.includes('iphone')
    ? 'iPhone'
    : ua.includes('ipad')
      ? 'iPad'
      : ua.includes('android')
        ? 'Android'
        : ua.includes('mac os')
          ? 'macOS'
          : ua.includes('windows')
            ? 'Windows'
            : ua.includes('linux')
              ? 'Linux'
              : 'Bilinmeyen cihaz';

  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('chrome')
      ? 'Chrome'
      : ua.includes('firefox')
        ? 'Firefox'
        : ua.includes('safari')
          ? 'Safari'
          : null;

  return browser ? `${os} · ${browser}` : os;
}
