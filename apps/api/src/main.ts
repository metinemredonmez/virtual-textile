import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { env, loadEnv } from '@vt/config';
import { AppModule } from './app.module.js';
import { createLogger } from './common/logger.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';

async function bootstrap(): Promise<void> {
  // ⚠️ İLK İŞ: env doğrulaması. Eksik anahtarla açılmaktansa hiç açılma.
  loadEnv();
  const config = env();

  const logger = createLogger({
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
    service: 'api',
  });

  const app = await NestFactory.create(AppModule, {
    // Nest'in kendi renkli logger'ı yerine yapılandırılmış JSON log
    logger: ['error', 'warn'],
    bodyParser: true,
  });

  app.use(
    helmet({
      // Bu bir API; tarayıcıya HTML servis etmiyoruz.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true, // refresh token httpOnly cookie ile taşınıyor
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'Idempotent-Replay'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix('v1', { exclude: ['health', 'health/deep'] });

  app.useGlobalFilters(
    new GlobalExceptionFilter(logger, {
      integrationSampleRate: 0.1,
      // Sentry bağlandığında buraya takılır.
      report: config.SENTRY_DSN
        ? (error, context) => {
            logger.error({ ...context, err: error }, 'Raporlanacak hata');
          }
        : undefined,
    }),
  );

  app.enableShutdownHooks();

  await app.listen(config.PORT);
  logger.info(
    { port: config.PORT, env: config.NODE_ENV },
    `API ayakta — http://localhost:${config.PORT}`,
  );
}

void bootstrap().catch((error: unknown) => {
  // Env doğrulama hatası buraya düşer: okunabilir mesaj, yığın izi değil.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
