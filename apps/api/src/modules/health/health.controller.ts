import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { RedisService } from '../../infra/redis.service.js';

interface DependencyStatus {
  status: 'ok' | 'error';
  latencyMs?: number;
  error?: string;
}

/**
 * İki ayrı sağlık ucu:
 *
 *  GET /health       → yük dengeleyici için. Hızlı, bağımlılık kontrol etmez.
 *                      Bağımlılık kontrol ederse, DB'nin bir saniyelik takılması
 *                      tüm sunucuları havuzdan düşürür.
 *  GET /health/deep  → izleme servisi için. Bağımlılıkları gerçekten yoklar.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  liveness(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Get('deep')
  async readiness(): Promise<{
    status: 'ok' | 'degraded';
    checks: Record<string, DependencyStatus>;
  }> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    const checks = { database, redis };
    const status = Object.values(checks).every((c) => c.status === 'ok') ? 'ok' : 'degraded';

    return { status, checks };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', latencyMs: Date.now() - started };
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.name : 'unknown' };
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    const started = Date.now();
    try {
      await this.redis.ping();
      return { status: 'ok', latencyMs: Date.now() - started };
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.name : 'unknown' };
    }
  }
}
