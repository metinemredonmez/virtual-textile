import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';

/**
 * BullMQ `Worker` gerçek bir Redis bağlantısı açar; testte yalnızca
 * "açıldı mı, hangi kuyruk için açıldı" sorusu önemli.
 */
const { workerCtor, workerClose } = vi.hoisted(() => ({
  workerCtor: vi.fn(),
  workerClose: vi.fn(() => Promise.resolve()),
}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(name: string, processor: unknown, options: unknown) {
      workerCtor(name, processor, options);
    }
    on(): this {
      return this;
    }
    close(): Promise<void> {
      return workerClose();
    }
  },
}));

import { CONCURRENCY, QUEUE, QUEUE_OPTIONS } from '../queues.js';
import {
  TryOnQueueConsumer,
  consumesTryOnQueue,
  createTryOnProviders,
} from './tryon.registration.js';

function createLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

function createDeps(logger: Logger) {
  return {
    prisma: {} as never,
    connection: {} as never,
    providers: [],
    watermarker: { embed: vi.fn() },
    storage: { name: 'test' } as never,
    urls: { issue: vi.fn() },
    logger,
  };
}

beforeEach(() => {
  workerCtor.mockClear();
  workerClose.mockClear();
});

describe('rol ayrımı — QUEUE.TRYON tüketicisi', () => {
  it('yalnızca media ve all rolleri ağır kuyruğu tüketir', () => {
    expect(consumesTryOnQueue('media')).toBe(true);
    expect(consumesTryOnQueue('all')).toBe(true);
    // ⚠️ core rolü hafif ve gecikmeye duyarlı işleri taşır; try-on üretimi
    // outbox dağıtıcısını aç bırakırdı.
    expect(consumesTryOnQueue('core')).toBe(false);
  });

  it('⚠️ core rolünde işleyici HİÇ kurulmaz ve kuyruk tüketilmez', () => {
    const logger = createLogger();
    const consumer = new TryOnQueueConsumer('core', createDeps(logger), logger);

    consumer.onModuleInit();

    expect(consumer.active).toBe(false);
    expect(workerCtor).not.toHaveBeenCalled();
  });

  it('media rolünde QUEUE.TRYON tüketicisi açılır', () => {
    const logger = createLogger();
    const consumer = new TryOnQueueConsumer('media', createDeps(logger), logger);

    consumer.onModuleInit();

    expect(consumer.active).toBe(true);
    expect(workerCtor).toHaveBeenCalledTimes(1);

    const [queueName, , options] = workerCtor.mock.calls[0] as [string, unknown, unknown];
    expect(queueName).toBe(QUEUE.TRYON);
    // Dış API hız limitine takılmamak için eşzamanlılık düşük tutulur.
    expect(options).toMatchObject({ concurrency: CONCURRENCY[QUEUE.TRYON] });
  });

  it('all rolü (yerel geliştirme) da tüketir', () => {
    const logger = createLogger();
    const consumer = new TryOnQueueConsumer('all', createDeps(logger), logger);

    consumer.onModuleInit();

    expect(consumer.active).toBe(true);
    expect(workerCtor).toHaveBeenCalledTimes(1);
  });

  it('core rolünde kapanış sessizce geçer, media rolünde tüketici kapatılır', async () => {
    const coreLogger = createLogger();
    const core = new TryOnQueueConsumer('core', createDeps(coreLogger), coreLogger);
    core.onModuleInit();
    await core.onModuleDestroy();
    expect(workerClose).not.toHaveBeenCalled();

    const mediaLogger = createLogger();
    const media = new TryOnQueueConsumer('media', createDeps(mediaLogger), mediaLogger);
    media.onModuleInit();
    await media.onModuleDestroy();
    expect(workerClose).toHaveBeenCalledTimes(1);
  });
});

describe('sağlayıcı zinciri', () => {
  const base = {
    FAL_KEY: '',
    FAL_TRYON_MODEL: 'fal-ai/idm-vton',
    GOOGLE_AI_API_KEY: '',
    GOOGLE_AI_IMAGE_MODEL: 'gemini-2.5-flash-image',
  };

  it('sıra fallback sırasıdır: önce fal, sonra gemini', () => {
    const providers = createTryOnProviders(
      { ...base, FAL_KEY: 'k1', GOOGLE_AI_API_KEY: 'k2' },
      createLogger(),
    );
    expect(providers.map((p) => p.name)).toEqual(['fal', 'gemini']);
  });

  it('⚠️ anahtarı olmayan sağlayıcı zincire konmaz', () => {
    const providers = createTryOnProviders({ ...base, FAL_KEY: 'k1' }, createLogger());
    expect(providers.map((p) => p.name)).toEqual(['fal']);
  });

  it('hiç sağlayıcı yoksa zincir boş kalır ve uyarı basılır', () => {
    const logger = createLogger();
    const providers = createTryOnProviders(base, logger);

    expect(providers).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('kuyruk ayarları', () => {
  it('⚠️ TRYON kuyruğunda BullMQ retry KAPALI kalmalı (attempts: 1)', () => {
    // Fallback zinciri işin İÇİNDE yürür. Kuyruk da yeniden denerse
    // "fotoğrafta kişi yok" gibi kalıcı hatalar boşuna para yakar.
    expect(QUEUE_OPTIONS[QUEUE.TRYON]?.attempts).toBe(1);
  });
});
