import { describe, expect, it, vi } from 'vitest';
import type { Env } from '@vt/config';

/**
 * ═══════════════════ BAĞLANTI DUMAN TESTİ — worker ═══════════════════
 *
 * ⚠️⚠️ BU DOSYANIN VAR OLMA SEBEBİ:
 *
 *    `SchedulerService`, KVKK işlerini `@Optional()` ile enjekte ediyor. Bu
 *    bilinçli bir karar (eksik kayıt worker'ın TAMAMINI öldürmesin diye), ama
 *    bedeli şu: sağlayıcılar `infra.module.ts`e hiç yazılmasaydı TypeScript
 *    şikâyet etmez, `scheduler.kvkk.test.ts` de geçerdi — o test servisi ELLE
 *    kurup işleri kendisi veriyor. Tek belirti, üretimde her cron turunda
 *    yazılan bir `lastError` olurdu.
 *
 *    Burada ölçülen şey servisin davranışı değil, MODÜLÜN NE KAYDETTİĞİDİR.
 *
 * ⚠️ Modül AYAĞA KALDIRILMAZ. `RedisConnection` yapıcısında gerçek bir Redis
 *    bağlantısı açıyor, `BullMqKvkkNotifier` da BullMQ kuyruğu kuruyor; ikisi
 *    de birim testinde canlı altyapı ister. Bunun yerine Nest'in modül
 *    metadata'sı okunuyor: hangi token'ların sağlandığı ve dışa açıldığı.
 *    (DI grafiğinin GERÇEKTEN çözüldüğü, ayrıca çalışan bir worker prosesiyle
 *    doğrulandı.)
 */

vi.mock('@vt/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vt/config')>();
  return { ...actual, env: (): Env => ({ WORKER_ROLE: 'core' }) as Env };
});

const { InfraModule, STORAGE, STORAGE_STATUS, WORKER_LOGGER } = await import('./infra.module.js');
const { AccountDeletionJob, KVKK_NOTIFIER } = await import('./jobs/account-deletion.job.js');
const { DataExportJob } = await import('./jobs/data-export.job.js');
const { PhotoRetentionJob, ReservationReleaseJob } = await import('./jobs/photo-retention.job.js');
const { OutboxDispatcher } = await import('./jobs/outbox.dispatcher.js');

type ProviderLike = { provide?: unknown } | (new (...args: never[]) => unknown);

function providedTokens(): unknown[] {
  const providers = (Reflect.getMetadata('providers', InfraModule) ?? []) as ProviderLike[];
  return providers.map((provider) =>
    typeof provider === 'object' && provider !== null && 'provide' in provider
      ? provider.provide
      : provider,
  );
}

function exportedTokens(): unknown[] {
  return (Reflect.getMetadata('exports', InfraModule) ?? []) as unknown[];
}

describe('InfraModule kablolaması — KVKK işleri', () => {
  /**
   * ⚠️ Bu üçü kayıtlı DEĞİLSE hesap silme ve veri indirme talepleri hiç
   *    işlenmez: silme talebi 30 gün sonra da askıda kalır, veri indirme
   *    bağlantısı hiç üretilmez.
   */
  it('AccountDeletionJob, DataExportJob ve KVKK_NOTIFIER sağlanır', () => {
    const tokens = providedTokens();

    expect(tokens).toContain(AccountDeletionJob);
    expect(tokens).toContain(DataExportJob);
    expect(tokens).toContain(KVKK_NOTIFIER);
  });

  /**
   * ⚠️ Sağlanmak YETMEZ, DIŞA AÇILMALI. `SchedulerService` `WorkerModule`
   *    içindedir; InfraModule bu token'ları export etmezse `@Optional()`
   *    enjeksiyonlar sessizce `undefined` kalır — kaydın hiç yapılmamasıyla
   *    aynı sonuç, aynı sessizlik.
   */
  it('⚠️ üçü de DIŞA AÇILIR — export edilmezse @Optional() sessizce boş kalır', () => {
    const exported = exportedTokens();

    expect(exported).toContain(AccountDeletionJob);
    expect(exported).toContain(DataExportJob);
    expect(exported).toContain(KVKK_NOTIFIER);
  });

  it('önceden bağlı işler korunuyor — yeni kayıtlar hiçbirini düşürmedi', () => {
    const exported = exportedTokens();

    for (const token of [
      OutboxDispatcher,
      PhotoRetentionJob,
      ReservationReleaseJob,
      STORAGE,
      STORAGE_STATUS,
      WORKER_LOGGER,
    ]) {
      expect(exported).toContain(token);
    }
  });

  /**
   * ⚠️ Fabrikaların `inject` dizisi ile yapıcının parametre SIRASI aynı olmalı.
   *    Sıra karışsaydı token'lar yine çözülür, ama işe depo yerine bildirim
   *    göndericisi girerdi — ve bu ancak üretimde, gerçek bir silme turunda
   *    anlaşılırdı.
   */
  it('AccountDeletionJob ve DataExportJob aynı dört bağımlılığı aynı sırada alır', () => {
    const providers = (Reflect.getMetadata('providers', InfraModule) ?? []) as Array<{
      provide?: unknown;
      inject?: unknown[];
    }>;

    const expected = [expect.anything(), STORAGE, KVKK_NOTIFIER, WORKER_LOGGER];

    for (const target of [AccountDeletionJob, DataExportJob]) {
      const entry = providers.find((provider) => provider.provide === target);
      expect(entry?.inject).toHaveLength(4);
      expect(entry?.inject?.[1]).toBe(expected[1]);
      expect(entry?.inject?.[2]).toBe(expected[2]);
      expect(entry?.inject?.[3]).toBe(expected[3]);
    }
  });
});
