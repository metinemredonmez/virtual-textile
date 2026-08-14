import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@vt/contracts';
import { MultiTryOnService } from './multi-tryon.service.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KOMBİN DENEMESİ ÖZELLİK KAPISI.
 *
 *  ⚠️ CANLI ARIZADAN DOĞDU (2026-08-14). `POST /tryon/outfit` çalışıyordu —
 *     ama YALNIZCA kabul etmeye kadar:
 *
 *       · uç `202 QUEUED` döndü
 *       · tarayıcı 100+ saniye yokladı, ekran "1. katman üretiliyor /
 *         2. katman üretiliyor"da SONSUZA KADAR kaldı
 *       · `costMicroUsd: 60000` — günlük kota ve ~0,06 USD yandı
 *       · iş HİÇ üretilmedi: `tryon.outfit_requested` olayını okuyan işleyici
 *         yok, `composeOutfit()` de worker'da hiç çağrılmıyor
 *
 *     "Kabul et ve asla bitirme", bir istemciye verilebilecek EN KÖTÜ
 *     sözleşmedir: hata gösterilemez, yeniden deneme anlamsızdır, kullanıcı
 *     yalnızca bekler ve parası gider.
 *
 *  ⚠️ BU TEST, KAPI KALKARKEN SİLİNECEK OLANDIR. Worker tarafı (olay
 *     tüketicisi + composeOutfit + ara görsel yayıncısı) bağlandığında
 *     `KOMBIN_URETIMI_BAGLI` true olur, bu dosya silinir. Test'i "düzeltip"
 *     yaşatmak, kapının sessizce kalıcılaşması demek olurdu.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const GOVDE = {
  userPhotoId: 'foto-1',
  variantIds: ['v-ust', 'v-alt'],
  mode: 'FAST',
} as never;

const AKTOR = { userId: 'kullanici-1' };

/**
 * ⚠️ TÜM BAĞIMLILIKLAR CASUS. Amaç yalnızca "attı mı" değil, kapının
 *    HİÇBİRİNE DOKUNMADAN attığını ölçmek. Bir tanesi bile çağrılıyorsa kapı
 *    yanlış basamakta demektir ve kullanıcının kotası yanmaya devam eder.
 */
function casusServis() {
  const consents = { hasConsent: vi.fn(), assertConsent: vi.fn() };
  const catalog = { loadVariants: vi.fn(), loadVariant: vi.fn() };
  const storage = { signedUrl: vi.fn(), publicUrl: vi.fn() };
  const prisma = {
    userPhoto: { findUnique: vi.fn() },
    tryOnJob: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const service = new MultiTryOnService(
    prisma as never,
    consents as never,
    catalog as never,
    storage as never,
    logger as never,
  );

  return { service, consents, catalog, storage, prisma, logger };
}

describe('POST /tryon/outfit — özellik kapısı', () => {
  it('kombin denemesi TRYON_OUTFIT_UNAVAILABLE ile reddedilir', async () => {
    const { service } = casusServis();
    await expect(service.create(GOVDE, AKTOR)).rejects.toBeInstanceOf(AppError);
  });

  it('hata kodu ve kullanıcı mesajı tek tek denemeye yönlendirir', async () => {
    const { service } = casusServis();
    await expect(service.create(GOVDE, AKTOR)).rejects.toMatchObject({
      code: 'TRYON_OUTFIT_UNAVAILABLE',
    });
  });

  it('⚠️ RIZA KAPISINA HİÇ GİRİLMEZ — reddedilecek iş için rıza sorgulanmaz', async () => {
    const { service, consents } = casusServis();
    await expect(service.create(GOVDE, AKTOR)).rejects.toThrow();
    expect(consents.hasConsent).not.toHaveBeenCalled();
    expect(consents.assertConsent).not.toHaveBeenCalled();
  });

  it('⚠️ KOTA HARCANMAZ — asıl arıza buydu, iş yanmadan reddedilmeli', async () => {
    const { service, prisma } = casusServis();
    await expect(service.create(GOVDE, AKTOR)).rejects.toThrow();
    // Kota sayımı `tryOnJob.count`, iş açılışı `tryOnJob.create` üzerinden olur.
    expect(prisma.tryOnJob.count).not.toHaveBeenCalled();
    expect(prisma.tryOnJob.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('⚠️ FOTOĞRAF BİLE OKUNMAZ — kapı en üstte, ilk satırda', async () => {
    const { service, prisma } = casusServis();
    await expect(service.create(GOVDE, AKTOR)).rejects.toThrow();
    expect(prisma.userPhoto.findUnique).not.toHaveBeenCalled();
  });

  it('⚠️ SESSİZCE TEK PARÇAYA DÜŞÜLMEZ — sonuç dönmez, İSTİSNA atılır', async () => {
    // Kullanıcı iki parça istedi. Birini giydirip "oldu" demek, istemediği
    // şeyi istediği sanarak vermektir. Yapamadığımızı SÖYLERİZ.
    const { service } = casusServis();
    const sonuc = await service.create(GOVDE, AKTOR).then(
      () => 'çözüldü',
      () => 'reddedildi',
    );
    expect(sonuc).toBe('reddedildi');
  });
});
