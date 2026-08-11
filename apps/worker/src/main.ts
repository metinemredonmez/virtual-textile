import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@vt/config';
import { WorkerModule } from './worker.module.js';

/**
 * Worker, API'den AYRI bir prosestir.
 *
 * Sebep: ağır ve yavaş işler (sanal deneme üretimi, görsel işleme) ticaret
 * akışını bloklamamalıdır. Aynı proseste çalışsalardı, GPU API'sini bekleyen
 * bir istek olay döngüsünü ve bağlantı havuzunu meşgul ederdi.
 *
 * ⚠️ Cluster modunda ÇALIŞTIRILMAZ. Tek örnek olmalıdır; aksi hâlde
 *    zamanlanmış işler her örnekte tetiklenir ve aynı iş birden fazla kez
 *    işlenir. Bkz. ecosystem.config.cjs
 */
async function bootstrap(): Promise<void> {
  loadEnv();

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn'],
  });

  app.enableShutdownHooks();

  // Kapanırken çalışan işin bitmesini bekle — yarıda kesilen bir ödeme
  // dağıtımı veya fotoğraf silme işi tutarsız durum bırakır.
  const shutdown = (signal: string): void => {
    process.stdout.write(`\n${signal} alındı, worker kapanıyor...\n`);
    void app.close().then(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  process.stdout.write('Worker ayakta — zamanlanmış işler çalışıyor\n');
}

void bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
