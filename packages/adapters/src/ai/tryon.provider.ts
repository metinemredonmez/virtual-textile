/**
 * SANAL DENEME SAĞLAYICISI ARAYÜZÜ
 *
 * MVP'de kendi GPU havuzumuz yok: barındırılan model API'leri kullanılır.
 * Bu arayüz sayesinde sağlayıcı değiştirmek (veya biri çöktüğünde diğerine
 * düşmek) uygulama kodunu etkilemez.
 *
 * ⚠️ Sağlayıcıya kullanıcı fotoğrafı gider. Bu YURT DIŞINA AKTARIMDIR;
 *    çağrı öncesi CROSS_BORDER_TRANSFER rızası kontrol edilmelidir.
 *    Fotoğraf imzalı, kısa ömürlü, TEK KULLANIMLIK URL ile paylaşılır.
 */

import type { SupportedTryOnCategory } from '@vt/config';

/**
 * ⚠️ ELLE YAZILMAZ — sağlayıcı yetenek matrisinden türer
 *    (@vt/config → TRYON_PROVIDER_CAPABILITIES).
 *
 *    Katalogdaki `TryOnCategory` sekiz değerlidir (ayakkabı, takı, çanta,
 *    aksesuar dahil); bu tip yalnızca EN AZ BİR SAĞLAYICININ giydirebildiği
 *    alt kümedir. Ayrım tipte tutulur çünkü desteklenmeyen bir kategoriyi
 *    sağlayıcıya göndermek DERLENMEMELİDİR: çalışma zamanı `if`i ile
 *    korunsaydı, o kontrolü atlayan yeni bir çağrı yolu eklemek sessizce
 *    mümkün olur ve hatayı sağlayıcının faturası haber verirdi.
 */
export type TryOnGarmentCategory = SupportedTryOnCategory;

export interface TryOnRequest {
  /** İmzalı, kısa ömürlü URL. Kalıcı bağlantı verilmez. */
  personImageUrl: string;
  garmentImageUrl: string;
  category: TryOnGarmentCategory;
  /** FAST: düşük çözünürlük/az adım — varsayılan. QUALITY: kullanıcı isterse. */
  mode: 'FAST' | 'QUALITY';
  /** Sonuç önbelleği anahtarı — sağlayıcı tarafında da tekilleştirme için. */
  idempotencyKey: string;
}

export interface TryOnSuccess {
  status: 'SUCCEEDED';
  /** Üretilen görselin ham baytları — filigran eklenip depoya yazılır. */
  image: Buffer;
  contentType: string;
  /** 0-100. Sağlayıcı skoru + kendi kalite kontrolümüzün bileşimi. */
  visualConfidence: number;
  /** Gerçek maliyet (mikro-dolar). Tahmin değil, sağlayıcının bildirdiği. */
  costMicroUsd: bigint;
  latencyMs: number;
  model: string;
}

export type TryOnFailureReason =
  /** Girdi geçersiz — TEKRAR DENEME, para yakar. */
  | 'INVALID_INPUT'
  /** İçerik güvenlik filtresine takıldı — TEKRAR DENEME. */
  | 'CONTENT_BLOCKED'
  /** Fotoğrafta kişi bulunamadı — TEKRAR DENEME. */
  | 'NO_PERSON_DETECTED'
  /** Geçici — başka model veya sağlayıcıyla tekrar denenebilir. */
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  /**
   * ⚠️ BİZİM anahtarımız/iznimiz hatalı (401/403) — kullanıcının fotoğrafıyla
   * ilgisi YOK.
   *
   * "Kalıcı" DEĞİLDİR ve olmamalıdır: kalıcı işaretlemek `generateWithFallback`
   * zincirini KESER (aşağıya bakınız), oysa yedek sağlayıcının anahtarı
   * farklıdır ve büyük ihtimalle çalışır. Kendi yapılandırma hatamız yüzünden
   * çalışan yolu kapatmak, kullanıcıya bedelini ödetmektir.
   *
   * Aynı sağlayıcıda TEKRAR DENENMEZ: `isTryOnRetryable` 401/403'ü zaten
   * reddediyor — anahtar düzelmeden sonuç değişmez, yalnızca para yanar.
   *
   * PROVIDER_ERROR'dan ayrılmasının tek nedeni ALARM: gerçek kesinti ile
   * kendi eksik yapılandırmamız aynı kutuya düşerse, ikincisi haftalarca
   * "sağlayıcı arızası" diye okunur.
   */
  | 'MISCONFIGURED';

export interface TryOnFailure {
  status: 'FAILED';
  reason: TryOnFailureReason;
  /** Sağlayıcı kodu — loglanır, kullanıcıya gösterilmez. */
  providerCode?: string;
  /** Başarısız çağrı da para harcamış olabilir; maliyet yine kaydedilir. */
  costMicroUsd: bigint;
  latencyMs: number;
}

export type TryOnResult = TryOnSuccess | TryOnFailure;

/**
 * Kalıcı hatalar tekrar denenmez.
 * "Fotoğrafta kişi yok" hatası üçüncü denemede de kişi bulmayacaktır —
 * sadece maliyet üretir ve kullanıcıyı bekletir.
 *
 * ⚠️ MISCONFIGURED bilinçli olarak BU LİSTEDE DEĞİL. Buradaki "kalıcı",
 *    `generateWithFallback` için "zinciri kes" anlamına gelir; yapılandırma
 *    hatası fotoğrafın değil BİZİM sorunumuzdur ve yedek sağlayıcıda
 *    tekrarlanmaz. Bkz. TryOnFailureReason → 'MISCONFIGURED'.
 */
export const PERMANENT_TRYON_FAILURES: readonly TryOnFailureReason[] = [
  'INVALID_INPUT',
  'CONTENT_BLOCKED',
  'NO_PERSON_DETECTED',
];

export function isPermanentFailure(reason: TryOnFailureReason): boolean {
  return PERMANENT_TRYON_FAILURES.includes(reason);
}

export interface TryOnProvider {
  readonly name: string;
  /** Bu sağlayıcının desteklediği kategoriler — desteklenmeyende denenmez. */
  readonly supportedCategories: readonly TryOnGarmentCategory[];

  generate(request: TryOnRequest): Promise<TryOnResult>;
}

/**
 * FALLBACK ZİNCİRİ
 *
 * Sıra: birincil sağlayıcı → aynı sağlayıcının alternatif modeli → yedek sağlayıcı.
 * Hepsi başarısızsa ZARİF DÜŞÜŞ: kullanıcı kotası GERİ VERİLİR ve ürünün
 * orijinal model görseli + beden tablosu gösterilir.
 *
 * ⚠️ Her durumda ticaret akışı çalışmaya devam eder: try-on çökse bile
 *    kullanıcı ürünü sepete atıp satın alabilir.
 */
export interface TryOnChainResult {
  result: TryOnResult;
  /** Hangi sağlayıcılar denendi — gözlemlenebilirlik için. */
  attempted: Array<{ provider: string; reason?: TryOnFailureReason; latencyMs: number }>;
  totalCostMicroUsd: bigint;
}

export async function generateWithFallback(
  providers: readonly TryOnProvider[],
  request: TryOnRequest,
): Promise<TryOnChainResult> {
  const attempted: TryOnChainResult['attempted'] = [];
  let totalCost = 0n;
  let lastFailure: TryOnFailure | undefined;

  for (const provider of providers) {
    if (!provider.supportedCategories.includes(request.category)) continue;

    const result = await provider.generate(request);
    totalCost += result.costMicroUsd;

    if (result.status === 'SUCCEEDED') {
      attempted.push({ provider: provider.name, latencyMs: result.latencyMs });
      return { result, attempted, totalCostMicroUsd: totalCost };
    }

    attempted.push({ provider: provider.name, reason: result.reason, latencyMs: result.latencyMs });
    lastFailure = result;

    // Kalıcı hata: sıradaki sağlayıcı da aynı sonucu verir. Zinciri kes.
    if (isPermanentFailure(result.reason)) break;
  }

  return {
    result: lastFailure ?? {
      status: 'FAILED',
      reason: 'PROVIDER_ERROR',
      costMicroUsd: 0n,
      latencyMs: 0,
    },
    attempted,
    totalCostMicroUsd: totalCost,
  };
}
