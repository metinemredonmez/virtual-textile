import { describe, expect, it } from 'vitest';
import { FINANCE } from '@vt/config';
import { AppError } from '@vt/contracts';
import {
  activeVersionAt,
  applyPlan,
  assertRateWithinCap,
  assertTimelineConsistent,
  isActiveAt,
  MAX_COMMISSION_BPS,
  planCommissionVersion,
  type CommissionVersionSnapshot,
} from './commission-version.js';

const at = (iso: string): Date => new Date(iso);

const version = (
  id: string,
  rateBps: number,
  validFrom: string,
  validTo: string | null = null,
): CommissionVersionSnapshot => ({
  id,
  rateBps,
  fixedFeeMinor: 0n,
  validFrom: at(validFrom),
  validTo: validTo === null ? null : at(validTo),
});

const NOW = at('2026-03-01T00:00:00.000Z');

/** Hata kodunu ve kodun beklenen aileye ait olduğunu birlikte doğrular. */
const expectAppError = (fn: () => unknown, code: string): AppError => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  throw new Error(`Hata bekleniyordu (${code}) ama fonksiyon başarıyla döndü.`);
};

describe('planCommissionVersion — versiyonlama', () => {
  it('ilk versiyonda kapatılacak kayıt yoktur ve versiyon açık uçlu doğar', () => {
    const plan = planCommissionVersion(
      [],
      { rateBps: 1200, fixedFeeMinor: 0n, validFrom: NOW },
      NOW,
    );

    expect(plan.close).toBeNull();
    expect(plan.create.rateBps).toBe(1200);
    expect(plan.create.validTo).toBeNull();
  });

  it('⚠️ mevcut versiyonu GÜNCELLEMEZ — yeni versiyon yazar, eskisini kapatır', () => {
    const existing = [version('v1', 1200, '2026-01-01T00:00:00.000Z')];
    const effective = at('2026-04-01T00:00:00.000Z');

    const plan = planCommissionVersion(
      existing,
      { rateBps: 1500, fixedFeeMinor: 250n, validFrom: effective },
      NOW,
    );

    // Eski versiyonda yalnızca aralık kapanır; oran/ücret alanlarına dokunulmaz.
    expect(plan.close).toEqual({ versionId: 'v1', validTo: effective });
    expect(plan.create).toEqual({
      rateBps: 1500,
      fixedFeeMinor: 250n,
      validFrom: effective,
      validTo: null,
    });

    // Kaynak dizi mutasyona uğramamış olmalı.
    expect(existing[0]!.rateBps).toBe(1200);
    expect(existing[0]!.validTo).toBeNull();
  });

  it('⚠️ plan uygulandığında hiçbir anda birden fazla geçerli versiyon olmaz', () => {
    const existing = [version('v1', 1200, '2026-01-01T00:00:00.000Z')];
    const effective = at('2026-04-01T00:00:00.000Z');
    const plan = planCommissionVersion(
      existing,
      { rateBps: 1500, fixedFeeMinor: 0n, validFrom: effective },
      NOW,
    );
    const timeline = applyPlan(existing, plan, 'v2');

    // Devir anından önce, tam devir anında ve sonrasında tek tek kontrol.
    const probes = [
      '2026-01-01T00:00:00.000Z',
      '2026-03-15T12:00:00.000Z',
      '2026-03-31T23:59:59.999Z',
      '2026-04-01T00:00:00.000Z',
      '2026-04-01T00:00:00.001Z',
      '2030-01-01T00:00:00.000Z',
    ];
    for (const probe of probes) {
      const active = timeline.filter((v) => isActiveAt(v, at(probe)));
      expect(active, `${probe} anında geçerli versiyon sayısı`).toHaveLength(1);
    }

    // Sınır anı YENİ versiyona aittir (yarı açık aralık: [validFrom, validTo)).
    expect(activeVersionAt(timeline, effective)?.id).toBe('v2');
    expect(activeVersionAt(timeline, new Date(effective.getTime() - 1))?.id).toBe('v1');
  });

  it('ileri tarihli versiyon planlanabilir; devire kadar eski oran yürürlükte kalır', () => {
    const existing = [version('v1', 1200, '2026-01-01T00:00:00.000Z')];
    const effective = at('2026-06-01T00:00:00.000Z');
    const timeline = applyPlan(
      existing,
      planCommissionVersion(
        existing,
        { rateBps: 900, fixedFeeMinor: 0n, validFrom: effective },
        NOW,
      ),
      'v2',
    );

    expect(activeVersionAt(timeline, NOW)?.rateBps).toBe(1200);
    expect(activeVersionAt(timeline, at('2026-06-01T00:00:00.000Z'))?.rateBps).toBe(900);
  });

  it('zincirleme versiyonlarda çizelge tutarlı kalır', () => {
    let timeline: CommissionVersionSnapshot[] = [];
    const steps: Array<{ rate: number; from: string; id: string }> = [
      { rate: 1000, from: '2026-03-01T00:00:00.000Z', id: 'v1' },
      { rate: 1200, from: '2026-04-01T00:00:00.000Z', id: 'v2' },
      { rate: 1350, from: '2026-05-01T00:00:00.000Z', id: 'v3' },
    ];

    for (const step of steps) {
      const plan = planCommissionVersion(
        timeline,
        { rateBps: step.rate, fixedFeeMinor: 0n, validFrom: at(step.from) },
        NOW,
      );
      timeline = applyPlan(timeline, plan, step.id);
    }

    expect(() => assertTimelineConsistent(timeline)).not.toThrow();
    expect(timeline.filter((v) => v.validTo === null)).toHaveLength(1);
    expect(activeVersionAt(timeline, at('2026-04-15T00:00:00.000Z'))?.id).toBe('v2');
    expect(activeVersionAt(timeline, at('2026-09-09T00:00:00.000Z'))?.id).toBe('v3');
  });
});

describe('planCommissionVersion — reddedilen girdiler', () => {
  it('⚠️ FINANCE.maxCommissionBps üstündeki oranı reddeder', () => {
    // ⚠️ Tavan aşımının kendi kodu var (422/domain). Genel VALIDATION_FAILED
    //    olsaydı admin panelinde "oran çok yüksek" ile "oran biçimi bozuk"
    //    aynı kutuya düşerdi.
    const error = expectAppError(
      () =>
        planCommissionVersion(
          [],
          { rateBps: FINANCE.maxCommissionBps + 1, fixedFeeMinor: 0n, validFrom: NOW },
          NOW,
        ),
      'COMMISSION_RATE_ABOVE_CAP',
    );
    // Kullanıcı mesajı tavanı SAYIYLA söylemeli — yer tutucu kalmamalı.
    expect(error.userMessage).toContain(`%${MAX_COMMISSION_BPS / 100}`);
    expect(error.userMessage).not.toContain('{maxPercent}');

    // Tam tavan kabul edilir — sınır dahil.
    expect(() =>
      planCommissionVersion(
        [],
        { rateBps: MAX_COMMISSION_BPS, fixedFeeMinor: 0n, validFrom: NOW },
        NOW,
      ),
    ).not.toThrow();
  });

  it('negatif, kesirli oranı ve negatif sabit ücreti reddeder', () => {
    // ⚠️ Bunlar tavan aşımı DEĞİL şema hatasıdır; COMMISSION_RATE_ABOVE_CAP'e
    //    çevrilmemeli — "daha düşük bir oran girin" mesajı yanıltıcı olurdu.
    expectAppError(() => assertRateWithinCap(-1), 'VALIDATION_FAILED');
    expectAppError(() => assertRateWithinCap(12.5), 'VALIDATION_FAILED');
    expectAppError(
      () => planCommissionVersion([], { rateBps: 1200, fixedFeeMinor: -1n, validFrom: NOW }, NOW),
      'VALIDATION_FAILED',
    );
  });

  it('geçmişe dönük yürürlüğü reddeder — snapshot alınmış siparişlerle çelişirdi', () => {
    expectAppError(
      () =>
        planCommissionVersion(
          [version('v1', 1200, '2026-01-01T00:00:00.000Z')],
          { rateBps: 1500, fixedFeeMinor: 0n, validFrom: at('2026-02-01T00:00:00.000Z') },
          NOW,
        ),
      'VALIDATION_FAILED',
    );
  });

  it('yürürlükteki versiyonla aynı anda veya öncesinde başlamayı reddeder', () => {
    const existing = [version('v1', 1200, '2026-05-01T00:00:00.000Z')];

    // Aynı an: eski versiyon sıfır uzunlukta aralığa düşerdi.
    expectAppError(
      () =>
        planCommissionVersion(
          existing,
          { rateBps: 1500, fixedFeeMinor: 0n, validFrom: at('2026-05-01T00:00:00.000Z') },
          NOW,
        ),
      'VALIDATION_FAILED',
    );

    // Öncesi: aralık ters dönerdi.
    expectAppError(
      () =>
        planCommissionVersion(
          existing,
          { rateBps: 1500, fixedFeeMinor: 0n, validFrom: at('2026-04-01T00:00:00.000Z') },
          NOW,
        ),
      'VALIDATION_FAILED',
    );
  });

  it('⚠️ zaten iki açık versiyon varsa üstüne yazmaz — bozuk çizelgeyi büyütmez', () => {
    const corrupt = [
      version('v1', 1200, '2026-01-01T00:00:00.000Z'),
      version('v2', 1500, '2026-02-01T00:00:00.000Z'),
    ];

    expectAppError(() => assertTimelineConsistent(corrupt), 'COMMISSION_VERSION_OVERLAP');
    expectAppError(
      () =>
        planCommissionVersion(
          corrupt,
          { rateBps: 1000, fixedFeeMinor: 0n, validFrom: at('2026-06-01T00:00:00.000Z') },
          NOW,
        ),
      'COMMISSION_VERSION_OVERLAP',
    );
  });
});

describe('assertTimelineConsistent', () => {
  it('çakışan kapalı aralıkları yakalar', () => {
    expectAppError(
      () =>
        assertTimelineConsistent([
          version('v1', 1200, '2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
          version('v2', 1500, '2026-02-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'),
        ]),
      'COMMISSION_VERSION_OVERLAP',
    );
  });

  it('bitişik aralıkları (validTo === sonraki validFrom) geçerli sayar', () => {
    expect(() =>
      assertTimelineConsistent([
        version('v1', 1200, '2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
        version('v2', 1500, '2026-03-01T00:00:00.000Z'),
      ]),
    ).not.toThrow();
  });

  it('ters ve sıfır uzunluklu aralığı reddeder', () => {
    expectAppError(
      () =>
        assertTimelineConsistent([
          version('v1', 1200, '2026-03-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ]),
      'COMMISSION_VERSION_OVERLAP',
    );
    expectAppError(
      () =>
        assertTimelineConsistent([
          version('v1', 1200, '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
        ]),
      'COMMISSION_VERSION_OVERLAP',
    );
  });

  it('boşluklu çizelgeye izin verir ama boşlukta geçerli versiyon yoktur', () => {
    const timeline = [
      version('v1', 1200, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      version('v2', 1500, '2026-03-01T00:00:00.000Z'),
    ];
    expect(() => assertTimelineConsistent(timeline)).not.toThrow();
    expect(activeVersionAt(timeline, at('2026-02-15T00:00:00.000Z'))).toBeNull();
  });
});

describe('activeVersionAt', () => {
  it('bozuk veride sessizce ilkini seçmez, hata fırlatır', () => {
    expectAppError(
      () =>
        activeVersionAt(
          [
            version('v1', 1200, '2026-01-01T00:00:00.000Z'),
            version('v2', 3000, '2026-01-01T00:00:00.000Z'),
          ],
          NOW,
        ),
      'COMMISSION_VERSION_OVERLAP',
    );
  });
});
