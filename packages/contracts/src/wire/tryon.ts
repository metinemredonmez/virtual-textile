import type { ErrorCode } from '../errors/error-catalog.js';

/**
 * SANAL DENEME — telde görünen şekil.
 *
 * ⚠️ DURUM ENUM'I ALTI DEĞERLİ, DÖRT DEĞİL. `schema.prisma` → `JobStatus`
 *    `FAILED_PERMANENT` ve `CANCELLED` da içeriyor; üstelik `TryOnJobView.status`
 *    tipi API tarafında düz `string`. Dört değerlik bir switch yazan istemcide
 *    FAILED_PERMANENT hiçbir dalı tutmaz ve kullanıcı sonsuza kadar dönen çark
 *    izler. Union burada ZORUNLU tutuluyor ve switch'lerde `assertNever` ile
 *    kapatılıyor — yeni bir durum eklenirse derleme kırılır.
 */
export type TryOnStatusWire =
  'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'FAILED_PERMANENT' | 'CANCELLED';

export type TryOnModeWire = 'FAST' | 'QUALITY';

/**
 * `POST /v1/tryon` yanıtı.
 *
 * ⚠️ Dallanma HTTP durum koduyla DEĞİL, `cached` alanıyla yapılır. Önbellek
 *    isabetinde uç 200 + hazır sonuç döner; 202 varsayan istemci HAZIR bir
 *    görseli 2 saniye boyunca yoklar.
 */
export type TryOnCreateResponseWire =
  | {
      cached: true;
      jobId: string;
      status: 'SUCCEEDED';
      resultUrl: string | null;
      visualConfidence: number | null;
      lowConfidence: boolean;
    }
  | {
      cached: false;
      jobId: string;
      status: 'QUEUED';
      /**
       * Kuyruk derinliğini içerir (base + bekleyen/4). Söz değil, tahmindir;
       * arayüz aşıldığında negatif sayı göstermez.
       */
      estimatedSeconds: number;
    };

/**
 * `GET /v1/tryon/:jobId` yanıtı.
 *
 * ⚠️ `estimatedSeconds` BURADA YOK — yalnızca POST yanıtında var. Geri sayım
 *    bileşen state'inde tutulursa sayfa yenilemesinde kaybolur; submit anında
 *    yakalanıp jobId ile anahtarlanmış sorgu önbelleğinde tutulur, geçen süre
 *    `queuedAt`tan hesaplanır.
 */
export interface TryOnJobWire {
  jobId: string;
  status: TryOnStatusWire;
  variantId: string;
  mode: TryOnModeWire;
  /** ⚠️ İmzalı URL, ömrü 900 sn. Sekme uzun süre gizli kalırsa ölür. */
  resultUrl: string | null;
  visualConfidence: number | null;
  lowConfidence: boolean;
  /** Katalogdaki bir koda karşılık gelir; hata zarfıyla aynı görselleştiriciye girer. */
  errorCode: ErrorCode | string | null;
  queuedAt: string;
  finishedAt: string | null;
}

/**
 * ⚠️ `@vt/adapters` → `OutfitLayerCategory` ile aynı olmak zorunda. Oradan
 * import EDİLEMEZ: adapters Node'a özgü şeyler taşıyor, contracts tarayıcıda
 * çalışabilir kalmalı.
 */
export type OutfitLayerCategoryWire =
  'UPPER_BODY' | 'LOWER_BODY' | 'DRESS' | 'OUTERWEAR' | 'ACCESSORY';

export interface OutfitStepWire {
  layerIndex: number;
  variantId: string;
  category: OutfitLayerCategoryWire;
  jobId: string | null;
  status: 'PENDING' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'FAILED_PERMANENT';
  /**
   * ⚠️ `true` ise bu katman için HİÇBİR yükleme göstergesi çizilmez. Önek
   * önbelleği sayesinde katman yeniden üretilmedi; onu da "yükleniyor" diye
   * göstermek kazancı görünmez kılar.
   */
  reused: boolean;
}

interface OutfitResultBaseWire {
  steps: OutfitStepWire[];
  reusedStepCount: number;
}

/**
 * `POST /v1/tryon/outfit` yanıtı.
 *
 * ⚠️ YOKLAMA AYNI GÖVDEYLE TEKRAR POST'tur ve her yoklama YENİ bir
 *    Idempotency-Key ile gider. Anahtar sabit tutulursa idempotency katmanı ilk
 *    yanıtı (`QUEUED`) 24 saat boyunca aynen geri oynatır: iş sunucuda biter,
 *    arayüz sonsuza kadar bekler. Çift üretimi engelleyen şey idempotency değil,
 *    sunucudaki önek önbelleğidir (aynı gövde → aynı önek anahtarları).
 */
export type OutfitTryOnResultWire = OutfitResultBaseWire &
  (
    | {
        outcome: 'CACHED';
        jobId: string;
        resultUrl: string | null;
        visualConfidence: number | null;
        lowConfidence: boolean;
      }
    | {
        outcome: 'QUEUED';
        jobId: string;
        estimatedSeconds: number;
        generatedStepCount: number;
      }
    | {
        /** Yarım kombin GÖSTERİLİR — bu başarısız bir istek değil, sonucun kendisi. */
        outcome: 'PARTIAL';
        jobId: string;
        resultUrl: string | null;
        visualConfidence: number | null;
        lowConfidence: boolean;
        appliedCount: number;
        missing: {
          variantId: string;
          category: OutfitLayerCategoryWire;
          errorCode: ErrorCode | string | null;
        };
      }
    | {
        outcome: 'FAILED';
        errorCode: ErrorCode | string | null;
        failedVariantId: string;
      }
  );

/**
 * FAILED_PERMANENT'a düşüren kodlar — "Tekrar dene" GÖSTERİLMEZ.
 * Üçüncü denemede de fotoğrafta kişi bulunmayacaktır; düğme kullanıcıyı
 * aynı duvara üç kez çarptırır.
 */
export const PERMANENT_TRYON_FAILURE_CODES = [
  'PHOTO_NO_PERSON',
  'PHOTO_QUALITY_LOW',
  'TRYON_CONTENT_BLOCKED',
] as const;

export type PermanentTryOnFailureCode = (typeof PERMANENT_TRYON_FAILURE_CODES)[number];
