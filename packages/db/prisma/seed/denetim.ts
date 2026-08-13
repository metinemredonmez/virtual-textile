/**
 * DENETİM İZİ, AI MALİYET KAYITLARI ve ARAMA EŞ ANLAMLILARI.
 *
 * ⚠️ `AuditLog` ve `AiUsageLog` APPEND-ONLY; ikisinde de doğal anahtar
 *    (action, entityType, entityId) / (feature, createdAt) üzerinden varlık
 *    kontrolü yapılıyor. Var olan satır GÜNCELLENMEZ.
 *
 * ⚠️ AI maliyet paneli BAŞARISIZ çağrıları da sayar (`success: false`) —
 *    "fatura neden yüksek" sorusunun cevabı çoğu zaman orada. Yalnızca
 *    başarılı kayıt yazan bir demo, o panelin en önemli sütununu boş bırakır.
 */
import type { AiFeature, PrismaClient, Prisma, Role } from '../../generated/client/index.js';

const GUN = 24 * 60 * 60 * 1000;

export interface DenetimSonucu {
  readonly denetimSayisi: number;
  readonly aiKayitSayisi: number;
  readonly esAnlamliSayisi: number;
}

interface AiKayit {
  readonly feature: AiFeature;
  readonly provider: string;
  readonly model: string;
  readonly basarili: boolean;
  readonly onbellek: boolean;
  readonly maliyetMikroUsd: bigint;
  readonly gecikmeMs: number;
  readonly saatOnce: number;
  readonly girisTokeni?: number;
  readonly cikisTokeni?: number;
  readonly gorselSayisi?: number;
  readonly hataKodu?: string;
}

/**
 * ⚠️ Modül seviyesinde ve DIŞA AÇIK: `dogrula.ts` sayımları bu listedeki
 *    modellere daraltıyor. Aynı liste iki yere yazılsaydı, seed yeni bir model
 *    eklediğinde doğrulama sayımı sessizce eksik kalırdı.
 */
export const AI_KAYITLARI: readonly AiKayit[] = [
  {
    feature: 'TRYON',
    provider: 'fal',
    model: 'fashn/tryon-v1.6',
    basarili: true,
    onbellek: false,
    maliyetMikroUsd: 38_000n,
    gecikmeMs: 21_400,
    saatOnce: 2,
    gorselSayisi: 1,
  },
  {
    feature: 'TRYON',
    provider: 'fal',
    model: 'fashn/tryon-v1.6',
    basarili: true,
    onbellek: true,
    maliyetMikroUsd: 0n,
    gecikmeMs: 180,
    saatOnce: 3,
    gorselSayisi: 1,
  },
  {
    feature: 'TRYON',
    provider: 'fal',
    model: 'fashn/tryon-v1.6',
    basarili: false,
    onbellek: false,
    maliyetMikroUsd: 38_000n,
    gecikmeMs: 30_100,
    saatOnce: 5,
    gorselSayisi: 1,
    hataKodu: 'TRYON_PROVIDER_TIMEOUT',
  },
  {
    feature: 'STYLIST',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    basarili: true,
    onbellek: false,
    maliyetMikroUsd: 12_400n,
    gecikmeMs: 4_800,
    saatOnce: 6,
    girisTokeni: 3_120,
    cikisTokeni: 640,
  },
  {
    feature: 'STYLIST',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    basarili: true,
    onbellek: false,
    maliyetMikroUsd: 9_800n,
    gecikmeMs: 3_900,
    saatOnce: 26,
    girisTokeni: 2_480,
    cikisTokeni: 510,
  },
  {
    feature: 'TAGGING',
    provider: 'google',
    model: 'gemini-2.5-flash',
    basarili: true,
    onbellek: false,
    maliyetMikroUsd: 1_900n,
    gecikmeMs: 1_450,
    saatOnce: 30,
    gorselSayisi: 2,
  },
  {
    feature: 'DESCRIPTION',
    provider: 'anthropic',
    model: 'claude-haiku-4-6',
    basarili: true,
    onbellek: false,
    maliyetMikroUsd: 800n,
    gecikmeMs: 1_100,
    saatOnce: 48,
    girisTokeni: 900,
    cikisTokeni: 320,
  },
  {
    feature: 'EMBEDDING',
    provider: 'fal',
    model: 'siglip-so400m',
    basarili: true,
    onbellek: false,
    maliyetMikroUsd: 400n,
    gecikmeMs: 620,
    saatOnce: 52,
    gorselSayisi: 4,
  },
  {
    feature: 'MODERATION',
    provider: 'google',
    model: 'gemini-2.5-flash',
    basarili: true,
    onbellek: false,
    maliyetMikroUsd: 600n,
    gecikmeMs: 890,
    saatOnce: 70,
    gorselSayisi: 1,
  },
  {
    feature: 'SEARCH_NL',
    provider: 'anthropic',
    model: 'claude-haiku-4-6',
    basarili: true,
    onbellek: false,
    maliyetMikroUsd: 300n,
    gecikmeMs: 740,
    saatOnce: 8,
    girisTokeni: 420,
    cikisTokeni: 90,
  },
  {
    feature: 'SEARCH_NL',
    provider: 'anthropic',
    model: 'claude-haiku-4-6',
    basarili: false,
    onbellek: false,
    maliyetMikroUsd: 300n,
    gecikmeMs: 9_900,
    saatOnce: 9,
    girisTokeni: 410,
    cikisTokeni: 0,
    hataKodu: 'AI_RATE_LIMITED',
  },
];

/** Sayımların daraltıldığı model kümesi — listeden TÜRETİLİR. */
export const AI_MODELLERI: readonly string[] = [...new Set(AI_KAYITLARI.map((k) => k.model))];

export async function denetimYaz(
  prisma: PrismaClient,
  girdi: {
    readonly kullaniciId: ReadonlyMap<string, string>;
    readonly saticiId: ReadonlyMap<string, string>;
    readonly urunId: ReadonlyMap<string, string>;
  },
): Promise<DenetimSonucu> {
  const simdi = Date.now();
  const yoneticiId = girdi.kullaniciId.get('yonetici@example.com') ?? 'seed';

  // ── Denetim izi ──────────────────────────────────────────────────────────
  const kayitlar: {
    action: string;
    entityType: string;
    entityId: string;
    actorRole: Role;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
    reason?: string;
    gunOnce: number;
  }[] = [];

  const eskiModa = girdi.saticiId.get('eski-moda');
  if (eskiModa) {
    kayitlar.push({
      action: 'seller.suspended',
      entityType: 'Seller',
      entityId: eskiModa,
      actorRole: 'ADMIN',
      before: { status: 'APPROVED' },
      after: { status: 'SUSPENDED' },
      reason: 'Kargo SLA ihlali ve yüksek iade oranı — inceleme sürüyor.',
      gunOnce: 11,
    });
  }

  const denimAtolyesi = girdi.saticiId.get('denim-atolyesi');
  if (denimAtolyesi) {
    kayitlar.push({
      action: 'seller.approved',
      entityType: 'Seller',
      entityId: denimAtolyesi,
      actorRole: 'ADMIN',
      before: { status: 'PENDING' },
      after: { status: 'APPROVED' },
      gunOnce: 120,
    });
    kayitlar.push({
      action: 'payout.approved',
      entityType: 'PayoutRequest',
      entityId: `PAYOUT-DEMO-denim-atolyesi`,
      actorRole: 'ADMIN',
      after: { status: 'SENT' },
      gunOnce: 18,
    });
  }

  kayitlar.push({
    action: 'commission.rule.updated',
    entityType: 'CommissionRule',
    entityId: 'kadin-ust-giyim',
    actorRole: 'ADMIN',
    before: { rateBps: 1000 },
    after: { rateBps: 1200 },
    reason: 'Yıllık komisyon revizyonu — 2026 tarifesi.',
    gunOnce: 224,
  });

  const trikoKazak = girdi.urunId.get('triko-kazak');
  if (trikoKazak) {
    kayitlar.push({
      action: 'product.approved',
      entityType: 'Product',
      entityId: trikoKazak,
      actorRole: 'ADMIN',
      after: { status: 'PUBLISHED' },
      gunOnce: 95,
    });
  }

  const demoKullanici = girdi.kullaniciId.get('demo@example.com');
  if (demoKullanici) {
    /*
     * ⚠️ BREAK-GLASS KAYDI. Yöneticinin kullanıcı fotoğrafına serbest erişimi
     *    YOK; erişim tek seferlik, gerekçeli ve denetim kaydıyla olur. Bu satır
     *    olmadan `/admin/audit` ekranındaki en hassas kayıt türü hiç
     *    görülmez ve "gerekçe alanı gerçekten dolu mu" sorusu ölçülemez.
     */
    kayitlar.push({
      action: 'user.photo.break_glass',
      entityType: 'User',
      entityId: demoKullanici,
      actorRole: 'ADMIN',
      reason: 'DESTEK-2026-0417 numaralı şikâyet: deneme görselinde başka kişi göründüğü iddiası.',
      gunOnce: 13,
    });
  }

  let denetimSayisi = 0;
  for (const kayit of kayitlar) {
    const varOlan = await prisma.auditLog.findFirst({
      where: { action: kayit.action, entityType: kayit.entityType, entityId: kayit.entityId },
    });
    if (varOlan) continue;
    await prisma.auditLog.create({
      data: {
        actorId: yoneticiId,
        actorRole: kayit.actorRole,
        action: kayit.action,
        entityType: kayit.entityType,
        entityId: kayit.entityId,
        before: kayit.before ?? undefined,
        after: kayit.after ?? undefined,
        reason: kayit.reason ?? null,
        ipAddress: '127.0.0.1',
        createdAt: new Date(simdi - kayit.gunOnce * GUN),
      },
    });
    denetimSayisi += 1;
  }

  // ── AI maliyet kayıtları ─────────────────────────────────────────────────
  const aiKayitlari = AI_KAYITLARI;

  const demoId = girdi.kullaniciId.get('demo@example.com') ?? null;
  const nordId = girdi.saticiId.get('atolye-nord') ?? null;

  let aiKayitSayisi = 0;
  for (const kayit of aiKayitlari) {
    const olusturma = new Date(simdi - kayit.saatOnce * 60 * 60 * 1000);
    const varOlan = await prisma.aiUsageLog.findFirst({
      where: {
        feature: kayit.feature,
        model: kayit.model,
        cacheHit: kayit.onbellek,
        success: kayit.basarili,
        latencyMs: kayit.gecikmeMs,
      },
    });
    if (varOlan) continue;
    await prisma.aiUsageLog.create({
      data: {
        userId: kayit.feature === 'TAGGING' || kayit.feature === 'DESCRIPTION' ? null : demoId,
        sellerId: kayit.feature === 'TAGGING' || kayit.feature === 'DESCRIPTION' ? nordId : null,
        feature: kayit.feature,
        provider: kayit.provider,
        model: kayit.model,
        inputTokens: kayit.girisTokeni ?? null,
        outputTokens: kayit.cikisTokeni ?? null,
        imageCount: kayit.gorselSayisi ?? null,
        costMicroUsd: kayit.maliyetMikroUsd,
        latencyMs: kayit.gecikmeMs,
        success: kayit.basarili,
        errorCode: kayit.hataKodu ?? null,
        cacheHit: kayit.onbellek,
        createdAt: olusturma,
      },
    });
    aiKayitSayisi += 1;
  }

  // ── Arama eş anlamlıları ─────────────────────────────────────────────────
  const esAnlamlilar: readonly { terim: string; karsilik: string[] }[] = [
    { terim: 'sneaker', karsilik: ['spor ayakkabı', 'spor ayakkabi'] },
    { terim: 'jean', karsilik: ['kot', 'denim', 'kot pantolon'] },
    { terim: 'sweatshirt', karsilik: ['sweat', 'kapüşonlu', 'hoodie'] },
    { terim: 'trençkot', karsilik: ['trenchcoat', 'trenckot'] },
    { terim: 'abiye', karsilik: ['gece elbisesi', 'davet elbisesi'] },
  ];

  let esAnlamliSayisi = 0;
  for (const kayit of esAnlamlilar) {
    await prisma.searchSynonym.upsert({
      where: { term: kayit.terim },
      update: { synonyms: kayit.karsilik },
      create: { term: kayit.terim, synonyms: kayit.karsilik },
    });
    esAnlamliSayisi += 1;
  }

  return { denetimSayisi, aiKayitSayisi, esAnlamliSayisi };
}
