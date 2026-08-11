import { Global, Module } from '@nestjs/common';
import { env } from '@vt/config';
import { createLogger, type Logger } from '../common/logger.js';
import { PrismaService } from './prisma.service.js';
import { RedisService } from './redis.service.js';

export const APP_LOGGER = 'APP_LOGGER';

/**
 * Paylaşılan altyapı: veritabanı, Redis, logger.
 *
 * @Global çünkü bunlar her modülün ihtiyaç duyduğu, tekil ve durumsuz
 * kaynaklardır; her modülde tekrar import etmek gürültüden başka bir şey
 * üretmez. İş modülleri Global YAPILMAZ — sınırların anlamı kalmaz.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    RedisService,
    {
      provide: APP_LOGGER,
      useFactory: (): Logger => {
        const config = env();
        return createLogger({
          level: config.LOG_LEVEL,
          pretty: config.NODE_ENV === 'development',
          service: 'api',
        });
      },
    },
  ],
  exports: [PrismaService, RedisService, APP_LOGGER],
})
export class InfraModule {}
