import { describe, expect, it, vi } from 'vitest';
import type { DomainEventJobData } from '../queues.js';

/**
 * ⚠️ `bullmq` SAHTELENİYOR: gerçek `Queue` yapıcısı canlı Redis ister.
 *    Ölçtüğümüz şey ağ değil KARAR — hangi olay kuyruğa girer, hangi
 *    `jobId` ile girer, bozuk yükte ne olur.
 */
const eklenenler: Array<{ ad: string; veri: unknown; secenek: unknown }> = [];

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(
      public ad: string,
      public ayar: unknown,
    ) {}
    async add(ad: string, veri: unknown, secenek: unknown): Promise<void> {
      eklenenler.push({ ad, veri, secenek });
    }
    async close(): Promise<void> {}
  },
}));

const { TryOnDispatchHandler } = await import('./tryon.dispatch.js');

const logger = {
  info: vi.fn(),
  error: vi.fn(),
} as unknown as Parameters<typeof TryOnDispatchHandler.prototype.constructor>[1];

function isleyici(): InstanceType<typeof TryOnDispatchHandler> {
  eklenenler.length = 0;
  return new TryOnDispatchHandler({} as never, logger as never);
}

function olay(over: Partial<DomainEventJobData> = {}): DomainEventJobData {
  return {
    outboxEventId: 'olay-1',
    aggregate: 'tryon',
    aggregateId: 'is-1',
    type: 'tryon.requested',
    payload: {
      tryOnJobId: 'is-1',
      userPhotoId: 'foto-1',
      variantId: 'varyant-1',
      mode: 'FAST',
      cacheKey: 'anahtar-1',
    },
    ...over,
  } as DomainEventJobData;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ BU DOSYA BİR MUTASYON ÖLÇÜMÜNDEN DOĞDU.
 *
 *  `TryOnDispatchHandler` yazıldıktan sonra tür süzgeci (`event.type !==
 *  'tryon.requested'`) KASTEN silindi ve 171 worker testinin HİÇBİRİ
 *  kırılmadı. Yani işleyici kabloda olduğu ölçülüyordu ama NE YAPTIĞI hiç
 *  ölçülmüyordu — kablo testi tek başına yetmiyor.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('TryOnDispatchHandler', () => {
  it('tryon.requested olayını kuyruğa koyar', async () => {
    const h = isleyici();
    const sonuc = await h.process(olay());

    expect(sonuc).toEqual({ enqueued: 1 });
    expect(eklenenler).toHaveLength(1);
    expect(eklenenler[0]!.veri).toMatchObject({
      tryOnJobId: 'is-1',
      userPhotoId: 'foto-1',
      variantId: 'varyant-1',
      mode: 'FAST',
    });
  });

  it('⚠️ jobId = tryOnJobId — aynı olay iki kez gelirse İKİNCİ ÜRETİM OLMAZ', () => {
    // Fanout en-az-bir-kez teslim ediyor. Sabit `jobId` olmasaydı kullanıcı
    // bir kez istediği hâlde iki kez para yakardık.
    return isleyici()
      .process(olay())
      .then(() => {
        expect(eklenenler[0]!.secenek).toMatchObject({ jobId: 'is-1' });
      });
  });

  it('⚠️ İLGİSİZ OLAYI KUYRUĞA KOYMAZ — mutasyonla ölçüldü', async () => {
    // Bu satır silinince test kırılmalı: fanout HER olayı HER işleyiciye
    // veriyor; süzgeç olmazsa her sipariş olayı bir try-on işi doğururdu.
    const h = isleyici();
    const sonuc = await h.process(olay({ type: 'package.delivered' }));

    expect(sonuc).toEqual({ enqueued: 0 });
    expect(eklenenler).toHaveLength(0);
  });

  it('bozuk yükte ATMAZ, log basıp geçer — tek satır tüm kuyruğu tıkamasın', async () => {
    const h = isleyici();
    const sonuc = await h.process(olay({ payload: { tryOnJobId: 'is-1' } }));

    expect(sonuc).toEqual({ enqueued: 0 });
    expect(eklenenler).toHaveLength(0);
  });

  it('geçersiz mode reddedilir (FAST/QUALITY dışı)', async () => {
    const h = isleyici();
    const sonuc = await h.process(
      olay({
        payload: {
          tryOnJobId: 'is-1',
          userPhotoId: 'foto-1',
          variantId: 'varyant-1',
          mode: 'TURBO',
          cacheKey: 'anahtar-1',
        },
      }),
    );

    expect(sonuc).toEqual({ enqueued: 0 });
  });

  /**
   * ⚠️ Bayat olay sınırı YOK ve bu bilinçli: kullanıcı fotoğrafını yükleyip
   *    bekledi, sonucu hâlâ istiyor. Gerçek sınırı fotoğrafın saklama süresi
   *    koyuyor (24 saat), burada ikinci bir sayı tutmuyoruz.
   */
  it('bayat olay sınırı null', () => {
    expect(isleyici().maxEventAgeMs).toBeNull();
  });
});
