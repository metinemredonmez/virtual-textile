import { afterEach, describe, expect, it, vi } from 'vitest';
import { rastgeleUuid } from './client';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  `crypto.randomUUID` YOKKEN DE UUID ÜRETİLMELİ.
 *
 *  ⚠️ BU TEST CANLI BİR ARIZADAN DOĞDU (2026-08-14). `crypto.randomUUID()`
 *     tarayıcıda YALNIZCA GÜVENLİ BAĞLAMDA tanımlıdır (HTTPS ya da
 *     `localhost`). Site `http://91.99.183.64` üzerinde servis ediliyor —
 *     güvenli bağlam DEĞİL — ve fonksiyon HİÇ YOKTU.
 *
 *     Sonuç: sanal deneme fotoğrafı R2'ye yükleniyordu (PUT 200), ardından
 *     `POST /me/photos/:id/confirm` HİÇ GÖNDERİLMİYORDU; istek kurulmadan
 *     anahtar üretimi patlıyordu. Ağ sekmesinde `confirm` satırı yoktu,
 *     ekranda yalnızca "Beklenmeyen bir hata oluştu" vardı.
 *
 *  ⚠️ YERELDE ASLA GÖRÜNMEZ: `localhost` güvenli bağlam sayılır. Bu yüzden
 *     test `randomUUID`i KASTEN SİLİYOR — yoksa test de yerelde yeşil yanar
 *     ve hiçbir şey ölçmez.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('rastgeleUuid — güvenli bağlam olmadan', () => {
  const gercek = globalThis.crypto.randomUUID;

  afterEach(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: gercek,
      configurable: true,
      writable: true,
    });
  });

  /** `randomUUID`i sil — HTTP üzerindeki tarayıcının gördüğü durum. */
  function guvensizBaglam(): void {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }

  it('randomUUID varken onu kullanır', () => {
    const casus = vi.fn(() => '11111111-2222-4333-8444-555555555555' as const);
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: casus,
      configurable: true,
      writable: true,
    });
    expect(rastgeleUuid()).toBe('11111111-2222-4333-8444-555555555555');
    expect(casus).toHaveBeenCalledOnce();
  });

  it('randomUUID YOKKEN de geçerli bir v4 UUID üretir', () => {
    guvensizBaglam();
    const uuid = rastgeleUuid();
    // ⚠️ Mutasyon: yedek yol silinince bu satır `TypeError` ile düşer.
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('ürettiği anahtarlar ÇAKIŞMAZ — idempotency anahtarı olacak', () => {
    guvensizBaglam();
    // ⚠️ Tahmin edilebilir bir anahtar BAŞKASININ idempotency kaydına çarpar;
    //    o yüzden `Math.random()` değil `crypto.getRandomValues` kullanılıyor.
    const kume = new Set(Array.from({ length: 500 }, () => rastgeleUuid()));
    expect(kume.size).toBe(500);
  });
});
