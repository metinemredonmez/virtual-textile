import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '@vt/contracts';
import { RedisService } from '../../infra/redis.service.js';
import { safeCompare } from './password.service.js';

export type OtpPurpose = 'PHONE_VERIFICATION' | 'LOGIN' | 'PASSWORD_RESET';

const TTL_SECONDS = 180; // 3 dakika
const MAX_ATTEMPTS = 3;

/**
 * TEK KULLANIMLIK KOD
 *
 * Redis'te tutulur — kalıcı olması gerekmez ve TTL'i veritabanı yerine
 * Redis'in yönetmesi hem daha ucuz hem daha doğrudur.
 *
 * Korumalar:
 *  - 3 dakika ömür
 *  - 3 yanlış deneme sonrası kod imha edilir (kaba kuvvet)
 *  - Sabit zamanlı karşılaştırma
 *  - Gönderim hızı `RateLimit` guard'ı ile ayrıca sınırlanır (3/saat)
 *
 * ⚠️ Kod log'a YAZILMAZ. Geliştirmede konsola basmak için ayrı bir kanal
 *    kullanılır (bkz. NotificationAdapter mock'u), pino redaction listesinde
 *    `otpCode` zaten gizlidir.
 */
@Injectable()
export class OtpService {
  constructor(private readonly redis: RedisService) {}

  private key(phone: string, purpose: OtpPurpose): string {
    return `otp:${purpose}:${phone}`;
  }

  private attemptsKey(phone: string, purpose: OtpPurpose): string {
    return `otp:attempts:${purpose}:${phone}`;
  }

  /** 6 haneli kod üretir ve saklar. Dönen kodu SMS adapter'ı gönderir. */
  async issue(phone: string, purpose: OtpPurpose): Promise<{ code: string; ttlSeconds: number }> {
    // randomInt kriptografik olarak güvenli — Math.random DEĞİL.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.redis
      .multi()
      .set(this.key(phone, purpose), code, 'EX', TTL_SECONDS)
      .del(this.attemptsKey(phone, purpose))
      .exec();

    return { code, ttlSeconds: TTL_SECONDS };
  }

  /**
   * Kodu doğrular ve TÜKETİR (tek kullanımlık).
   * Yanlışsa deneme sayacını artırır; sınır aşılırsa kodu imha eder.
   */
  async verify(phone: string, purpose: OtpPurpose, submitted: string): Promise<void> {
    const key = this.key(phone, purpose);
    const stored = await this.redis.get(key);

    if (!stored) {
      throw new AppError('AUTH_OTP_EXPIRED');
    }

    if (!safeCompare(stored, submitted)) {
      const attempts = await this.redis.incr(this.attemptsKey(phone, purpose));
      await this.redis.expire(this.attemptsKey(phone, purpose), TTL_SECONDS);

      if (attempts >= MAX_ATTEMPTS) {
        // Kaba kuvvet: kodu imha et, kullanıcı yeni kod istemek zorunda kalsın.
        await this.redis.del(key, this.attemptsKey(phone, purpose));
        throw new AppError('AUTH_OTP_EXPIRED', {
          internalMessage: `OTP azami deneme aşıldı (${String(attempts)})`,
        });
      }

      throw new AppError('AUTH_OTP_INVALID');
    }

    // Başarılı — kod tüketilir, tekrar kullanılamaz.
    await this.redis.del(key, this.attemptsKey(phone, purpose));
  }
}
