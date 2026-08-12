import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { resetEnvCache } from '@vt/config';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { RedisService } from '../../infra/redis.service.js';
import { PUBLIC_KEY } from '../auth/auth.guard.js';
import { WardrobeController } from './wardrobe.controller.js';
import { WardrobeService } from './wardrobe.service.js';
import {
  MultiTryOnWardrobeAdapter,
  PrismaWardrobeRepository,
  StylistWardrobeAdapter,
  WardrobePhotoStorage,
} from './wardrobe.gateway.js';
import {
  WARDROBE_PHOTO_STORAGE,
  WARDROBE_REPOSITORY,
  WARDROBE_STYLIST,
  WARDROBE_TRYON,
} from './wardrobe.ports.js';

/**
 * ═══════════════════ BAĞLANTI DUMAN TESTİ ═══════════════════
 *
 * ⚠️⚠️ BU TESTİN VAR OLMA SEBEBİ:
 *
 *    Gardırop modülü bir tur boyunca yazılmış, derlenmiş ve 35 birim testiyle
 *    doğrulanmış hâlde durdu — ama DÖRT PORTU DA `useValue: null` idi ve modül
 *    `app.module.ts`e hiç kaydedilmemişti. Yani iş kuralları vardı, hiçbir
 *    kullanıcı isteği onlara ulaşamıyordu. Birim testleri bunu göremez, çünkü
 *    hepsi portların yerine kendi sahte nesnelerini koyup servisi ELLE kuruyor.
 *
 *    Aynı tuzağın daha önce `SIZE_LEARNING_PORT`ta yaşandığı biliniyor:
 *    opsiyonel parametrenin null varsayılanı yüzünden 990 test yeşil olduğu
 *    hâlde sinyal akmıyordu.
 *
 *    Bu dosya o boşluğu kapatır: GERÇEK `AppModule` grafiği derlenir ve her
 *    portun arkasında GERÇEK bir adaptör olduğu doğrulanır. Bir port yeniden
 *    `null`a düşerse ya da modül kökten çıkarılırsa test kırmızı yanar.
 *
 * Veritabanı ve Redis sahtedir; hiçbir sorgu çalışmaz — ölçülen tek şey
 * KABLOLAMA.
 */

/**
 * ⚠️ `AppModule` grafiği açılışta `env()` okuyor ve gerçek `env()` eksik bir
 *    değişkende FIRLATIYOR. Buradaki değerler yalnızca grafiğin derlenmesini
 *    sağlar; hiçbiri bir dış servise gitmez (sağlayıcı anahtarları KASITLI
 *    olarak verilmiyor — hepsi fail-closed yer tutucuya düşer).
 */
const REQUIRED_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  APP_URL: 'https://example.com',
  API_URL: 'https://api.example.com',
  CORS_ORIGINS: 'https://example.com',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(128),
  JWT_REFRESH_SECRET: 'b'.repeat(128),
  FIELD_ENCRYPTION_KEY: 'c'.repeat(64),
  INTERNAL_API_TOKEN: 'd'.repeat(32),
};

beforeAll(() => {
  for (const [key, value] of Object.entries(REQUIRED_ENV)) process.env[key] = value;
  resetEnvCache();
});

/**
 * ⚠️ `PrismaService`/`RedisService` gerçek sınıflarıyla bağlanırsa
 *    `onModuleInit` çalışır ve test canlı bir veritabanı arar. Override ile
 *    değiştiriliyor; grafiğin geri kalanı GERÇEK kalıyor — ölçmek istediğimiz
 *    şey tam olarak o gerçek grafik.
 */
async function compileAppGraph() {
  return Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ $connect: () => Promise.resolve(), $disconnect: () => Promise.resolve() })
    .overrideProvider(RedisService)
    .useValue({ onModuleDestroy: () => Promise.resolve() })
    .compile();
}

describe('WardrobeModule kablolaması', () => {
  it('⚠️ dört portun HİÇBİRİ null değil — hepsi gerçek adaptöre bağlı', async () => {
    const moduleRef = await compileAppGraph();

    expect(moduleRef.get(WARDROBE_REPOSITORY, { strict: false })).toBeInstanceOf(
      PrismaWardrobeRepository,
    );
    expect(moduleRef.get(WARDROBE_PHOTO_STORAGE, { strict: false })).toBeInstanceOf(
      WardrobePhotoStorage,
    );
    expect(moduleRef.get(WARDROBE_STYLIST, { strict: false })).toBeInstanceOf(
      StylistWardrobeAdapter,
    );
    expect(moduleRef.get(WARDROBE_TRYON, { strict: false })).toBeInstanceOf(
      MultiTryOnWardrobeAdapter,
    );

    await moduleRef.close();
  });

  /**
   * ⚠️ Servisin ALDIĞI bağımlılıklar ayrıca ölçülür. Token'ın çözülmesi
   *    yetmez: `inject` dizisinin SIRASI yanlış olsaydı token'lar yine
   *    çözülür ama depo, servise "stil danışmanı" olarak girerdi.
   */
  it('WardrobeService bağımlılıklarını DOĞRU SIRADA alır', async () => {
    const moduleRef = await compileAppGraph();
    const service = moduleRef.get(WardrobeService, { strict: false });

    expect(service).toBeInstanceOf(WardrobeService);

    const injected = service as unknown as Record<string, unknown>;
    expect(injected.repository).toBeInstanceOf(PrismaWardrobeRepository);
    expect(injected.storage).toBeInstanceOf(WardrobePhotoStorage);
    expect(injected.stylist).toBeInstanceOf(StylistWardrobeAdapter);
    expect(injected.tryOn).toBeInstanceOf(MultiTryOnWardrobeAdapter);
    expect(typeof (injected.logger as { info?: unknown })?.info).toBe('function');

    await moduleRef.close();
  });

  /**
   * ⚠️ Modül `app.module.ts` içinde AÇIKÇA bağlanmalı. Gardırobu import eden
   *    başka bir modül YOK; kökten çıkarılırsa `/v1/wardrobe` uçları hiç yayına
   *    çıkmaz ve hiçbir test bunu fark etmez.
   */
  it('WardrobeController kök grafikte kayıtlı', async () => {
    const moduleRef = await compileAppGraph();

    expect(moduleRef.get(WardrobeController, { strict: false })).toBeInstanceOf(WardrobeController);

    await moduleRef.close();
  });
});

/**
 * ═══════════════════ ERİŞİM KORUMASI ═══════════════════
 *
 * Gardırop, kullanıcının ne giydiğini ve evinde ne bulunduğunu gösterir.
 * `@Public()` sınıf ya da metot düzeyinde bir gün eklenirse hiçbir birim testi
 * bunu görmez — ama tüm dolaplar kimliksiz erişime açılır.
 */
describe('gardırop erişim koruması', () => {
  const reflector = new Reflector();

  it('⚠️ controller PUBLIC DEĞİL', () => {
    expect(reflector.get<boolean>(PUBLIC_KEY, WardrobeController)).toBeFalsy();
  });

  it('⚠️ hiçbir uç PUBLIC değil', () => {
    const prototype = WardrobeController.prototype as unknown as Record<string, () => unknown>;
    const handlers = Object.getOwnPropertyNames(prototype).filter((name) => name !== 'constructor');

    expect(handlers.length).toBeGreaterThan(0);
    for (const name of handlers) {
      expect(reflector.get<boolean>(PUBLIC_KEY, prototype[name]!)).toBeFalsy();
    }
  });
});
