import { describe, expect, it } from 'vitest';
import { TRYON } from '@vt/config';
import { TRYON_LOCK_DURATION_MS } from './tryon.processor.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KİLİT SÜRESİ ↔ SAĞLAYICI SÜRE SINIRI İLİŞKİSİ.
 *
 *  ⚠️ CANLI ARIZADAN DOĞDU (2026-08-14). Sağlayıcı süre sınırı FAST için
 *     25 saniyeydi ve `fal-ai/idm-vton` bunu düzenli olarak aşıyordu:
 *
 *         zincir: [{ saglayici: "fal", sebep: "TIMEOUT", ms: 25001 }, …]
 *
 *     Sınır 60/120 saniyeye çıkarıldı. AMA BullMQ kilidi ayarlanmamıştı ve
 *     varsayılanı 30 SANİYE. Sınır büyütülüp kilit olduğu yerde bırakılsaydı
 *     iş "takıldı" sayılıp YENİDEN çalıştırılırdı — aynı üretim iki kez
 *     ödenir, kullanıcı kotasından iki kez düşerdi. Bu arıza log'da
 *     görünmezdi; yalnızca faturada.
 *
 *  ⚠️ BU TEST İKİ SAYININ AYRIŞMASINI ENGELLER. Biri değişip diğeri
 *     unutulduğunda kapı burada kırılır.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('BullMQ kilit süresi', () => {
  it('⚠️ EN UZUN sağlayıcı sınırından BÜYÜK olmalı — yoksa çift üretim', () => {
    expect(TRYON_LOCK_DURATION_MS).toBeGreaterThan(TRYON.timeoutMs.QUALITY);
  });

  it('FAST sınırından da büyük — iki mod da aynı kuyruğu kullanıyor', () => {
    expect(TRYON_LOCK_DURATION_MS).toBeGreaterThan(TRYON.timeoutMs.FAST);
  });

  it('⚠️ BullMQ varsayılanı 30 sn — onun üstünde olmak ZORUNDA', () => {
    // Varsayılanla kalınsaydı 60 saniyelik bir FAST üretimi "takıldı" sayılırdı.
    expect(TRYON_LOCK_DURATION_MS).toBeGreaterThan(30_000);
  });

  it('filigran ve yükleme için en az 30 sn pay bırakır', () => {
    // Sağlayıcı çağrısı bittikten sonra iş bitmiyor: filigran gömülüyor,
    // görsel depoya yükleniyor. Kilit işin TAMAMINI kapsamalı.
    expect(TRYON_LOCK_DURATION_MS - TRYON.timeoutMs.QUALITY).toBeGreaterThanOrEqual(30_000);
  });

  it('⚠️ FAST sınırı 25 sn OLAMAZ — idm-vton bunu düzenli aşıyor', () => {
    // Ölçüldü: fal TIMEOUT (25001ms). Sınır 25 sn'ye geri çekilirse bu kırılır.
    expect(TRYON.timeoutMs.FAST).toBeGreaterThan(30_000);
  });
});
