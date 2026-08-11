import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '@vt/config';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor() {
    super(env().REDIS_URL, {
      maxRetriesPerRequest: 3,
      // Bağlantı koparsa komutlar kuyruğa alınmasın — hızlı hata daha iyi;
      // aksi hâlde istekler sessizce birikir ve zaman aşımına uğrar.
      enableOfflineQueue: false,
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 200, 3000),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}
