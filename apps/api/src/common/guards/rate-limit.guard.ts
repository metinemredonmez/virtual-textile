import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { RateLimiterRedis, type RateLimiterRes } from 'rate-limiter-flexible';
import { AppError } from '@vt/contracts';
import { RATE_LIMITS } from '@vt/config';

export const RATE_LIMIT_KEY = 'vt:rateLimit';

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitOptions {
  name: RateLimitName;
  /**
   * Anahtar nasıl türetilsin.
   *  - `ip`         : IP başına (varsayılan)
   *  - `user`       : giriş yapmışsa kullanıcı, değilse IP
   *  - `ip+body`    : IP + gövdedeki alan (ör. e-posta) — kullanıcı sayımı
   */
  scope?: 'ip' | 'user' | 'ip+body';
  /** `ip+body` için gövde alanı adı. */
  bodyField?: string;
}

/**
 * Hız limiti.
 *
 * Giriş denemesinde anahtar IP + e-posta'dır: tek IP'den çok hesaba saldırıyı
 * da, çok IP'den tek hesaba saldırıyı da yakalar.
 */
export const RateLimit = (options: RateLimitOptions): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiters = new Map<RateLimitName, RateLimiterRedis>();

  constructor(
    private readonly redis: Redis,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const limiter = this.getLimiter(options.name);
    const key = this.buildKey(options, request);

    try {
      await limiter.consume(key);
      return true;
    } catch (error) {
      // rate-limiter-flexible limit aşımında RateLimiterRes fırlatır (Error değil).
      if (error instanceof Error) throw error;

      const res = error as RateLimiterRes;
      const retryAfter = Math.max(1, Math.ceil(res.msBeforeNext / 1000));

      // Giriş denemesi limiti aşıldıysa hesap kilidi mesajı daha doğru.
      if (options.name === 'login') {
        throw new AppError('AUTH_ACCOUNT_LOCKED', {
          params: { minutes: Math.ceil(retryAfter / 60) },
          retryAfterSeconds: retryAfter,
        });
      }

      throw new AppError('RATE_LIMITED', {
        params: { retryAfter },
        retryAfterSeconds: retryAfter,
      });
    }
  }

  private getLimiter(name: RateLimitName): RateLimiterRedis {
    let limiter = this.limiters.get(name);
    if (!limiter) {
      const config = RATE_LIMITS[name];
      limiter = new RateLimiterRedis({
        storeClient: this.redis,
        keyPrefix: `rl:${name}`,
        points: config.points,
        duration: config.durationSeconds,
        blockDuration: config.blockSeconds,
      });
      this.limiters.set(name, limiter);
    }
    return limiter;
  }

  private buildKey(options: RateLimitOptions, request: Request & { userId?: string }): string {
    const ip = request.ip ?? 'unknown';

    switch (options.scope ?? 'ip') {
      case 'user':
        return request.userId ? `u:${request.userId}` : `ip:${ip}`;
      case 'ip+body': {
        const body = request.body as Record<string, unknown> | undefined;
        const raw = options.bodyField ? body?.[options.bodyField] : undefined;
        // Kişisel veriyi Redis anahtarında düz metin tutmamak için kısaltıyoruz.
        const suffix = typeof raw === 'string' ? raw.toLowerCase().slice(0, 64) : 'anon';
        return `ip:${ip}|f:${suffix}`;
      }
      default:
        return `ip:${ip}`;
    }
  }
}
