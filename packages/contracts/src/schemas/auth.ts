import { z } from 'zod';
import { emailSchema, otpCodeSchema, passwordSchema, phoneSchema } from './common.js';

/** Kayıt: e-posta VEYA telefon zorunlu — ikisi birden de olabilir. */
export const registerSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
    firstName: z.string().trim().min(2).max(60),
    lastName: z.string().trim().min(2).max(60),
    /**
     * Aydınlatma metni ve kullanım koşulları onayı.
     * Kabul edilmeden kayıt tamamlanmaz.
     */
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'Kullanım koşullarını kabul etmelisiniz.' }),
    }),
    marketingConsent: z.boolean().default(false),
  })
  .refine((data) => data.email ?? data.phone, {
    message: 'E-posta veya telefon numarası girmelisiniz.',
    path: ['email'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  /** E-posta veya telefon — tek alan, sunucu ayırt eder. */
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(1, 'Şifre boş olamaz.'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const sendOtpSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(['PHONE_VERIFICATION', 'LOGIN', 'PASSWORD_RESET']),
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: otpCodeSchema,
  purpose: z.enum(['PHONE_VERIFICATION', 'LOGIN', 'PASSWORD_RESET']),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

/**
 * Oturum açma yanıtı.
 *
 * ⚠️ Refresh token GÖVDEDE DÖNMEZ — httpOnly + Secure + SameSite=Strict
 * çerezle taşınır. Gövdede dönerse XSS ile çalınabilir.
 */
export interface AuthTokens {
  accessToken: string;
  /** Saniye cinsinden. İstemci buna göre sessiz yenileme zamanlar. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  role: 'CUSTOMER' | 'SELLER_USER' | 'SUPPORT' | 'ADMIN';
  emailVerified: boolean;
  phoneVerified: boolean;
  /** Satıcı paneli kullanıcısıysa erişebildiği mağazalar. */
  sellerIds: string[];
}

export interface AuthSessionResponse {
  user: AuthenticatedUser;
  tokens: AuthTokens;
}

export interface SessionSummary {
  id: string;
  deviceLabel: string | null;
  ipAddress: string;
  createdAt: string;
  lastUsedAt: string;
  /** İsteği yapan oturumun kendisi mi — arayüzde "bu cihaz" olarak gösterilir. */
  current: boolean;
}

/** Access token içeriği. Yetki kararları BUNA göre verilir. */
export interface JwtPayload {
  /** Kullanıcı kimliği */
  sub: string;
  role: AuthenticatedUser['role'];
  /** Satıcı paneli erişimi olan mağazalar */
  sellerIds: string[];
  /** Oturum kimliği — token iptalini oturum bazında yapabilmek için. */
  sid: string;
  /** Token kimliği */
  jti: string;
  iat: number;
  exp: number;
}
