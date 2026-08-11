/**
 * KOMİSYON VERSİYONLAMA — SAF ÇEKİRDEK
 *
 * Buradaki hiçbir fonksiyon veritabanına, saate veya isteğe dokunmaz.
 * Nedeni: komisyon oranı satıcının cirosundan ne kesileceğini belirler ve
 * sipariş kalemine SNAPSHOT'lanır. Yanlış bir versiyon zaman çizelgesi,
 * "bu sipariş hangi orandan kesildi" sorusunu cevaplanamaz hâle getirir ve
 * mutabakat haftalar sonra patlar. Bu yüzden kural motoru veritabanından
 * ayrıldı: doğruluğu bir entegrasyon testine değil, hızlı bir birim testine
 * bağlı olmalı.
 *
 * ⚠️ TEMEL KURAL: KOMİSYON KURALI GÜNCELLENMEZ.
 *    Her değişiklik YENİ BİR VERSİYON yazar; eski versiyonun `validTo`'su
 *    kapatılır. Mevcut satır UPDATE edilseydi, o oranla oluşmuş siparişlerin
 *    dayanağı geriye dönük olarak değişir ve OrderItem.commissionRateBps ile
 *    kural kaydı çelişirdi.
 *
 * ⚠️ ARALIK YARI AÇIKTIR: [validFrom, validTo)
 *    validTo AN'I yeni versiyona aittir, eskiye değil. Kapalı aralık
 *    kullanılsaydı devir anında iki versiyon birden geçerli olurdu — tam da
 *    yasaklamamız gereken durum.
 */

import { FINANCE } from '@vt/config';
import { appError } from '@vt/contracts';

/** Admin bu oranın üstünde kural tanımlayamaz. */
export const MAX_COMMISSION_BPS = FINANCE.maxCommissionBps;

export interface CommissionVersionSnapshot {
  readonly id: string;
  /** 1250 = %12,50 */
  readonly rateBps: number;
  readonly fixedFeeMinor: bigint;
  readonly validFrom: Date;
  /** null = hâlâ geçerli (açık uçlu). */
  readonly validTo: Date | null;
}

export interface NewVersionRequest {
  readonly rateBps: number;
  readonly fixedFeeMinor: bigint;
  /** Yürürlük başlangıcı. Geçmişe dönük olamaz. */
  readonly validFrom: Date;
}

export interface CommissionVersionPlan {
  /** Kapatılacak açık versiyon — ilk versiyonda null. */
  readonly close: { readonly versionId: string; readonly validTo: Date } | null;
  /** Yazılacak yeni versiyon. Her zaman açık uçlu doğar. */
  readonly create: {
    readonly rateBps: number;
    readonly fixedFeeMinor: bigint;
    readonly validFrom: Date;
    readonly validTo: null;
  };
}

// ── Geçerlilik sorguları ──────────────────────────────────────────────────

/** [validFrom, validTo) — bitiş anı HARİÇ. */
export function isActiveAt(version: CommissionVersionSnapshot, at: Date): boolean {
  const t = at.getTime();
  return (
    version.validFrom.getTime() <= t && (version.validTo === null || t < version.validTo.getTime())
  );
}

/**
 * Belirli bir andaki geçerli versiyon.
 *
 * Birden fazla bulursa hata fırlatır — sessizce ilkini döndürmek, bozuk veriyi
 * para hesabına taşımak demektir.
 */
export function activeVersionAt(
  versions: readonly CommissionVersionSnapshot[],
  at: Date,
): CommissionVersionSnapshot | null {
  const active = versions.filter((version) => isActiveAt(version, at));
  if (active.length > 1) {
    throw appError('INTERNAL_ERROR', {
      internalMessage: `Aynı anda ${active.length} geçerli komisyon versiyonu: ${active
        .map((version) => version.id)
        .join(', ')} (an: ${at.toISOString()})`,
    });
  }
  return active[0] ?? null;
}

/**
 * ⚠️ VERİTABANI KISITININ KOD TARAFINDAKİ İKİZİ.
 *
 * Şemada aynı kural için tek açık versiyona izin veren kısıt var; burada da
 * kontrol ediliyor çünkü kısıt yalnızca "açık" (validTo IS NULL) versiyonları
 * yakalar — geçmişte ÇAKIŞAN iki kapalı aralık veritabanı için sorunsuzdur
 * ama "3 Mart'ta hangi oran geçerliydi" sorusunu belirsiz bırakır.
 */
export function assertTimelineConsistent(versions: readonly CommissionVersionSnapshot[]): void {
  const open = versions.filter((version) => version.validTo === null);
  if (open.length > 1) {
    throw appError('INTERNAL_ERROR', {
      internalMessage: `Bir kuralda ${open.length} açık komisyon versiyonu var: ${open
        .map((version) => version.id)
        .join(', ')}`,
    });
  }

  for (const version of versions) {
    if (version.validTo !== null && version.validTo.getTime() <= version.validFrom.getTime()) {
      throw appError('INTERNAL_ERROR', {
        internalMessage: `Komisyon versiyonu ${version.id} ters/boş aralığa sahip: ${version.validFrom.toISOString()} → ${version.validTo.toISOString()}`,
      });
    }
  }

  const sorted = [...versions].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;

    // Açık uçlu versiyon yalnızca EN SONDA olabilir; ortada olursa
    // kendisinden sonraki her versiyonla çakışır.
    if (previous.validTo === null) {
      throw appError('INTERNAL_ERROR', {
        internalMessage: `Açık komisyon versiyonu ${previous.id}, ${current.id} ile çakışıyor`,
      });
    }
    if (previous.validTo.getTime() > current.validFrom.getTime()) {
      throw appError('INTERNAL_ERROR', {
        internalMessage: `Komisyon versiyonları çakışıyor: ${previous.id} (bitiş ${previous.validTo.toISOString()}) ve ${current.id} (başlangıç ${current.validFrom.toISOString()})`,
      });
    }
  }
}

// ── Girdi doğrulama ───────────────────────────────────────────────────────

/**
 * ⚠️ TAVAN KONTROLÜ. `checkout/commission.ts` aynı kontrolü hesap anında
 * tekrar yapar; oradaki savunma bozuk KAYIT içindir, buradaki ise admin
 * GİRDİSİ içindir. Bu yüzden hata kodları da farklı: burada 400 (kullanıcı
 * düzeltebilir), orada 500 (veri bozuk).
 */
export function assertRateWithinCap(rateBps: number): void {
  if (!Number.isInteger(rateBps) || rateBps < 0) {
    throw appError('VALIDATION_FAILED', {
      internalMessage: `Geçersiz komisyon oranı: ${rateBps}`,
      details: {
        fields: [{ path: 'rateBps', message: 'Komisyon oranı negatif olmayan tam sayı olmalı.' }],
      },
    });
  }
  if (rateBps > MAX_COMMISSION_BPS) {
    throw appError('VALIDATION_FAILED', {
      internalMessage: `Komisyon oranı tavanı aşıyor: ${rateBps} > ${MAX_COMMISSION_BPS}`,
      details: {
        fields: [
          {
            path: 'rateBps',
            message: `Komisyon oranı en fazla %${MAX_COMMISSION_BPS / 100} olabilir.`,
          },
        ],
      },
    });
  }
}

export function assertFixedFeeValid(fixedFeeMinor: bigint): void {
  if (fixedFeeMinor < 0n) {
    throw appError('VALIDATION_FAILED', {
      internalMessage: `Negatif sabit ücret: ${fixedFeeMinor}`,
      details: { fields: [{ path: 'fixedFeeMinor', message: 'Sabit ücret negatif olamaz.' }] },
    });
  }
}

// ── Plan üretimi ──────────────────────────────────────────────────────────

/**
 * Yeni versiyon planı üretir. Veritabanına HİÇBİR ŞEY yazmaz.
 *
 * Dönen plan iki işten oluşur ve ikisi de AYNI transaction'da uygulanmalıdır:
 *   1. `close` : mevcut açık versiyonun validTo'su kapatılır (tek izinli UPDATE —
 *      oran/ücret alanlarına DOKUNULMAZ, yalnızca aralık kapanır).
 *   2. `create`: yeni versiyon açık uçlu olarak yazılır.
 *
 * Sadece biri uygulanırsa ya iki açık versiyon (fazla kesinti riski) ya da hiç
 * geçerli versiyon (COMMISSION_RULE_NOT_FOUND ile duran checkout) oluşur.
 */
export function planCommissionVersion(
  existing: readonly CommissionVersionSnapshot[],
  request: NewVersionRequest,
  now: Date,
): CommissionVersionPlan {
  assertRateWithinCap(request.rateBps);
  assertFixedFeeValid(request.fixedFeeMinor);

  // Mevcut durum zaten bozuksa üstüne yazma — önce onarılmalı.
  assertTimelineConsistent(existing);

  // ⚠️ GERİYE DÖNÜK YÜRÜRLÜK YASAK. Geçmişe tarihli bir versiyon, o aralıkta
  // oluşmuş siparişlerin snapshot'ladığı oranla çelişir; rapor ile muhasebe
  // ayrışır. İleri tarih serbesttir (planlı zam/indirim).
  if (request.validFrom.getTime() < now.getTime()) {
    throw appError('VALIDATION_FAILED', {
      internalMessage: `Geçmişe dönük yürürlük: ${request.validFrom.toISOString()} < ${now.toISOString()}`,
      details: {
        fields: [{ path: 'validFrom', message: 'Komisyon değişikliği geçmişe dönük uygulanamaz.' }],
      },
    });
  }

  const open = existing.find((version) => version.validTo === null) ?? null;

  if (open === null) {
    const plan: CommissionVersionPlan = {
      close: null,
      create: {
        rateBps: request.rateBps,
        fixedFeeMinor: request.fixedFeeMinor,
        validFrom: request.validFrom,
        validTo: null,
      },
    };
    assertTimelineConsistent(applyPlan(existing, plan, 'yeni'));
    return plan;
  }

  // Yeni versiyon mevcut olanı KAPATIR; eşit veya önce başlarsa eski versiyon
  // sıfır/negatif uzunlukta bir aralığa düşer — yani hiç yürürlükte olmamış
  // gibi görünür. Bu neredeyse her zaman operatör hatasıdır.
  if (request.validFrom.getTime() <= open.validFrom.getTime()) {
    throw appError('VALIDATION_FAILED', {
      internalMessage: `Yeni versiyon (${request.validFrom.toISOString()}) mevcut versiyondan (${open.validFrom.toISOString()}) sonra başlamalı`,
      details: {
        fields: [
          {
            path: 'validFrom',
            message: 'Yeni komisyon versiyonu, yürürlükteki versiyondan sonra başlamalıdır.',
          },
        ],
      },
    });
  }

  const plan: CommissionVersionPlan = {
    close: { versionId: open.id, validTo: request.validFrom },
    create: {
      rateBps: request.rateBps,
      fixedFeeMinor: request.fixedFeeMinor,
      validFrom: request.validFrom,
      validTo: null,
    },
  };

  // Plan uygulandıktan SONRAKİ çizelge de tutarlı olmalı — kapatma ile yeni
  // kaydın birlikte doğru olduğunu tek yerde kanıtlıyoruz.
  assertTimelineConsistent(applyPlan(existing, plan, 'yeni'));
  return plan;
}

/**
 * Planı bellekte uygular — YALNIZCA doğrulama ve test için.
 * Gerçek yazma servis katmanında, transaction içinde yapılır.
 */
export function applyPlan(
  existing: readonly CommissionVersionSnapshot[],
  plan: CommissionVersionPlan,
  newVersionId: string,
): CommissionVersionSnapshot[] {
  const closed = existing.map((version) =>
    plan.close !== null && version.id === plan.close.versionId
      ? { ...version, validTo: plan.close.validTo }
      : version,
  );
  return [...closed, { id: newVersionId, ...plan.create }];
}

// TODO(kod-gerekli): COMMISSION_RATE_ABOVE_CAP — tavan aşımı şu an genel
// VALIDATION_FAILED ile dönüyor; arayüz "tavan" durumunu ayrıştıramıyor.
// TODO(kod-gerekli): COMMISSION_VERSION_OVERLAP — çakışan versiyon çizelgesi
// şu an INTERNAL_ERROR (500) ile dönüyor; kendi kodu olmalı ki alarm kuralı
// genel 500 gürültüsünden ayrılabilsin.
