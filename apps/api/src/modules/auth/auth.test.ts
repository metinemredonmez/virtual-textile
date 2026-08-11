import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAppError, type AppError } from '@vt/contracts';
import { PasswordService, safeCompare } from './password.service.js';
import { OtpService } from './otp.service.js';
import { TokenService } from './token.service.js';

const codeOf = (error: unknown): string => {
  if (!isAppError(error)) throw error;
  return (error as AppError).code;
};

// ── Sahte Redis: OTP mantığını gerçek bağlantı olmadan sınamak için ────────
class FakeRedis {
  private store = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }
  incr(key: string): Promise<number> {
    const next = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(next));
    return Promise.resolve(next);
  }
  expire(): Promise<number> {
    return Promise.resolve(1);
  }
  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed += 1;
    return Promise.resolve(removed);
  }
  multi(): {
    set: (k: string, v: string) => ReturnType<FakeRedis['multi']>;
    del: (k: string) => ReturnType<FakeRedis['multi']>;
    exec: () => Promise<unknown>;
  } {
    const chain = {
      set: (k: string, v: string) => {
        this.store.set(k, v);
        return chain;
      },
      del: (k: string) => {
        this.store.delete(k);
        return chain;
      },
      exec: () => Promise.resolve([]),
    };
    return chain;
  }
  /** Test yardımcısı: üretilen kodu doğrudan okumak için. */
  peek(key: string): string | undefined {
    return this.store.get(key);
  }
}

describe('PasswordService', () => {
  const service = new PasswordService();

  it('özetler ve doğrular', async () => {
    const hash = await service.hash('CokGuclu2026!');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(service.verify(hash, 'CokGuclu2026!')).resolves.toBe(true);
    await expect(service.verify(hash, 'YanlisSifre')).resolves.toBe(false);
  });

  it('aynı parola her seferinde FARKLI özet üretir (salt)', async () => {
    const a = await service.hash('AyniParola1!');
    const b = await service.hash('AyniParola1!');
    expect(a).not.toBe(b);
  });

  it('bozuk özette patlamaz, false döner', async () => {
    await expect(service.verify('bu-bir-ozet-degil', 'x')).resolves.toBe(false);
  });

  it('geçerli özet yeniden özetleme gerektirmez', async () => {
    const hash = await service.hash('AyniParola1!');
    expect(service.needsRehash(hash)).toBe(false);
  });
});

describe('safeCompare', () => {
  it('eşit değerleri doğrular', () => {
    expect(safeCompare('123456', '123456')).toBe(true);
  });

  it('farklı değerleri reddeder', () => {
    expect(safeCompare('123456', '123457')).toBe(false);
  });

  it('farklı uzunlukta patlamaz', () => {
    // timingSafeEqual eşit uzunluk ister; sarmalayıcı bunu ele almalı.
    expect(safeCompare('123', '123456')).toBe(false);
  });
});

describe('OtpService', () => {
  let redis: FakeRedis;
  let otp: OtpService;
  const phone = '+905321112233';

  beforeEach(() => {
    redis = new FakeRedis();
    otp = new OtpService(redis as never);
  });

  it('6 haneli kod üretir', async () => {
    const { code, ttlSeconds } = await otp.issue(phone, 'LOGIN');
    expect(code).toMatch(/^\d{6}$/);
    expect(ttlSeconds).toBe(180);
  });

  it('doğru kodu kabul eder', async () => {
    const { code } = await otp.issue(phone, 'LOGIN');
    await expect(otp.verify(phone, 'LOGIN', code)).resolves.toBeUndefined();
  });

  it('⚠️ kod TEK KULLANIMLIK — ikinci kez kullanılamaz', async () => {
    const { code } = await otp.issue(phone, 'LOGIN');
    await otp.verify(phone, 'LOGIN', code);

    await expect(otp.verify(phone, 'LOGIN', code)).rejects.toSatisfy(
      (e) => codeOf(e) === 'AUTH_OTP_EXPIRED',
    );
  });

  it('yanlış kodu reddeder', async () => {
    const { code } = await otp.issue(phone, 'LOGIN');
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(otp.verify(phone, 'LOGIN', wrong)).rejects.toSatisfy(
      (e) => codeOf(e) === 'AUTH_OTP_INVALID',
    );
  });

  it('⚠️ 3 yanlış denemeden sonra kodu İMHA eder (kaba kuvvet)', async () => {
    const { code } = await otp.issue(phone, 'LOGIN');
    const wrong = code === '000000' ? '111111' : '000000';

    await expect(otp.verify(phone, 'LOGIN', wrong)).rejects.toSatisfy(
      (e) => codeOf(e) === 'AUTH_OTP_INVALID',
    );
    await expect(otp.verify(phone, 'LOGIN', wrong)).rejects.toSatisfy(
      (e) => codeOf(e) === 'AUTH_OTP_INVALID',
    );
    // 3. yanlış: kod imha edilir
    await expect(otp.verify(phone, 'LOGIN', wrong)).rejects.toSatisfy(
      (e) => codeOf(e) === 'AUTH_OTP_EXPIRED',
    );

    // Artık DOĞRU kod bile çalışmaz — yeni kod istenmeli.
    await expect(otp.verify(phone, 'LOGIN', code)).rejects.toSatisfy(
      (e) => codeOf(e) === 'AUTH_OTP_EXPIRED',
    );
  });

  it('kod yoksa süresi dolmuş sayar', async () => {
    await expect(otp.verify(phone, 'LOGIN', '123456')).rejects.toSatisfy(
      (e) => codeOf(e) === 'AUTH_OTP_EXPIRED',
    );
  });

  it('farklı amaçlar birbirinin kodunu kabul etmez', async () => {
    const { code } = await otp.issue(phone, 'LOGIN');
    await expect(otp.verify(phone, 'PASSWORD_RESET', code)).rejects.toSatisfy(
      (e) => codeOf(e) === 'AUTH_OTP_EXPIRED',
    );
  });
});

describe('TokenService — yeniden kullanım tespiti', () => {
  /**
   * Bu davranış projenin en kritik güvenlik kuralı:
   * iptal edilmiş bir refresh token tekrar gelirse çalınmış demektir ve
   * kullanıcının TÜM oturumları düşürülür.
   */
  function createService(session: {
    revokedAt: Date | null;
    expiresAt: Date;
    status?: 'ACTIVE' | 'SUSPENDED';
  }) {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const prisma = {
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sess-1',
          userId: 'user-1',
          deviceLabel: null,
          revokedAt: session.revokedAt,
          expiresAt: session.expiresAt,
          user: {
            id: 'user-1',
            role: 'CUSTOMER',
            status: session.status ?? 'ACTIVE',
            sellerMemberships: [],
          },
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany,
      },
    };
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const jwt = { signAsync: vi.fn().mockResolvedValue('access-token') };

    const service = new TokenService(jwt as never, prisma as never, logger as never);
    return { service, prisma, logger, updateMany };
  }

  const meta = { ipAddress: '1.2.3.4', userAgent: 'test' };
  const future = (): Date => new Date(Date.now() + 86_400_000);

  it('⚠️ iptal edilmiş token tekrar gelirse TÜM oturumları düşürür', async () => {
    const { service, updateMany, logger } = createService({
      revokedAt: new Date(), // zaten iptal edilmiş → çalınmış
      expiresAt: future(),
    });

    await expect(service.rotate('calinmis-token', meta)).rejects.toSatisfy(
      (e) => codeOf(e) === 'AUTH_REFRESH_REUSED',
    );

    // Tek oturum değil, kullanıcının HEPSİ
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', revokedAt: null } }),
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it('bilinmeyen token için oturum düşürmez', async () => {
    const { service, prisma, updateMany } = createService({
      revokedAt: null,
      expiresAt: future(),
    });
    prisma.session.findUnique.mockResolvedValue(null);

    await expect(service.rotate('yok', meta)).rejects.toSatisfy(
      (e) => codeOf(e) === 'AUTH_TOKEN_INVALID',
    );
    // Rastgele token deneyen biri başkasının oturumunu düşürememeli.
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('süresi dolmuş oturumu reddeder', async () => {
    const { service } = createService({
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(service.rotate('eski', meta)).rejects.toSatisfy(
      (e) => codeOf(e) === 'AUTH_TOKEN_EXPIRED',
    );
  });

  it('askıya alınmış kullanıcının oturumlarını düşürür', async () => {
    const { service, updateMany } = createService({
      revokedAt: null,
      expiresAt: future(),
      status: 'SUSPENDED',
    });

    await expect(service.rotate('gecerli', meta)).rejects.toSatisfy(
      (e) => codeOf(e) === 'AUTH_ACCOUNT_SUSPENDED',
    );
    expect(updateMany).toHaveBeenCalled();
  });
});
