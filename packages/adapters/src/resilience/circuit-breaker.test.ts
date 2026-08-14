import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ARDIŞIK EŞİK — ÖLÜ SAĞLAYICI YAKALAMA.
 *
 *  ⚠️ CANLI ARIZADAN DOĞDU (2026-08-14). Yedek sağlayıcı `gemini` her çağrıda
 *     kota hatası veriyordu — %100 ölü. Devre HİÇ AÇILMADI.
 *
 *     Sebep aritmetikti: pencereli eşik "60 saniyede 5 hata" ister. Gerçek
 *     trafik dakikada BİR denemeye bile ulaşmıyordu, dolayısıyla pencere hiç
 *     dolmadı. Düşük trafikte kalıcı olarak ölü bir sağlayıcı sonsuza kadar
 *     denenmeye devam ediyordu.
 *
 *     Üç zararı vardı: her isteğe ölü sağlayıcının gecikmesi ekleniyordu;
 *     kullanıcıya gösterilen hata kodu zincirin SON halkasından geldiği için
 *     BİRİNCİL sağlayıcının gerçek arızasını gizliyordu; ölü servise boşuna
 *     yük biniyordu.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('devre kesici — ardışık eşik (süre sınırı yok)', () => {
  function kesici(saat: { simdi: number }) {
    return new CircuitBreaker({
      name: 'olu-saglayici',
      now: () => saat.simdi,
    });
  }

  async function dus(breaker: CircuitBreaker): Promise<void> {
    await breaker.execute(() => Promise.reject(new Error('kota'))).catch(() => undefined);
  }

  it('⚠️ ÇOK SEYREK ama ÜST ÜSTE üç hata devreyi açar — asıl düzeltme bu', async () => {
    const saat = { simdi: 0 };
    const breaker = kesici(saat);

    // Denemeler ON DAKİKA arayla. Pencereli eşik (60 sn'de 5) ASLA dolmaz.
    await dus(breaker);
    saat.simdi += 600_000;
    await dus(breaker);
    saat.simdi += 600_000;
    await dus(breaker);

    expect(breaker.getState()).toBe('OPEN');
  });

  it('iki ardışık hata YETMEZ — art arda iki ağ hatası olağandır', async () => {
    const saat = { simdi: 0 };
    const breaker = kesici(saat);

    await dus(breaker);
    saat.simdi += 600_000;
    await dus(breaker);

    expect(breaker.getState()).toBe('CLOSED');
  });

  it('⚠️ ARADA BİR BAŞARI sayacı sıfırlar — "ardışık"ın tanımı bu', async () => {
    const saat = { simdi: 0 };
    const breaker = kesici(saat);

    await dus(breaker);
    saat.simdi += 600_000;
    await dus(breaker);
    saat.simdi += 600_000;
    await breaker.execute(() => Promise.resolve('oldu'));
    saat.simdi += 600_000;
    await dus(breaker);
    saat.simdi += 600_000;
    await dus(breaker);

    // Başarıdan sonra yalnızca iki hata var → henüz açılmamalı.
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('⚠️ PENCERELİ EŞİK HÂLÂ ÇALIŞIYOR — ani kesinti yolu bozulmadı', async () => {
    const saat = { simdi: 0 };
    // Ardışık eşiği devre dışı bırakıp yalnızca pencereliyi ölçüyoruz.
    const breaker = new CircuitBreaker({
      name: 'ani-kesinti',
      consecutiveThreshold: 999,
      now: () => saat.simdi,
    });

    for (let i = 0; i < 5; i += 1) {
      await dus(breaker);
      saat.simdi += 1000;
    }

    expect(breaker.getState()).toBe('OPEN');
  });
});
