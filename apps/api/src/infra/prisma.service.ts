import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createPrismaClient, PrismaClient } from '@vt/db';
import { env } from '@vt/config';
import { createLogger, type Logger } from '../common/logger.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log: Logger;

  constructor() {
    const config = env();
    const log = createLogger({
      level: config.LOG_LEVEL,
      pretty: config.NODE_ENV === 'development',
      service: 'prisma',
    });

    const client = createPrismaClient({
      databaseUrl: config.DATABASE_URL,
      slowQueryMs: 500,
      onSlowQuery: ({ query, durationMs }) => {
        // ⚠️ Sorgu METNİ loglanır, PARAMETRELER loglanmaz — parametreler
        // kişisel veri ve token içerebilir.
        log.warn({ durationMs, query: query.slice(0, 500) }, 'Yavaş sorgu');
      },
    });

    super();
    this.log = log;
    // createPrismaClient'ın kurduğu olay dinleyicilerini bu örneğe taşı
    Object.assign(this, client);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.log.info('Veritabanı bağlantısı kuruldu');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
