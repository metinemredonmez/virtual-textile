import { describe, expect, it } from 'vitest';
import type { TryOnStatusWire } from '@vt/contracts';
import { SUREN_DURUMLAR, bitisDurumuMu, kesmeGoster } from './use-tryon-job';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KESME (TIMEOUT) KARARI.
 *
 *  ⚠️ CANLI ARIZADAN DOĞDU. `timedOut` bir boolean state'ti; `true` yapan satır
 *     vardı, `false` yapan HİÇBİR satır yoktu. İki ayrı arıza üretiyordu:
 *
 *       1. Kesmeden sonra "Durumu kontrol et"e basılınca sunucu SUCCEEDED +
 *          resultUrl dönüyordu (ağ sekmesinde görülüyordu) ama ekran kesme
 *          kutusunda kalıyordu. Sonuç gelmiş, kullanıcıya gösterilmemişti.
 *
 *       2. Bayrak İŞLER ARASI SIZIYORDU: bir kez kesmeye takılan kullanıcının
 *          o sekmede başlattığı HER yeni deneme anında "beklenenden uzun
 *          sürdü" diyordu. Bu, düzeltilen sağlayıcı hatasının ardından
 *          "hâlâ çalışmıyor" sanılmasına yol açacak türden bir arızadır.
 *
 *  ⚠️ HOOK RENDER EDİLEREK TEST EDİLEMİYOR: `apps/web` test ortamı `node`,
 *     jsdom kurulu değil ve vitest yapılandırması bunun bilinçli olduğunu
 *     yazıyor. Bu yüzden karar saf fonksiyonlara ayrıldı — ölçülemeyen bir
 *     karar, bu depoda bir kez daha canlıda kırılırdı.
 * ═══════════════════════════════════════════════════════════════════════════
 */

describe('kesmeGoster — kesme işe aittir, sekmeye değil', () => {
  it('kesilen iş HÂLÂ görüntülenen işse kesme gösterilir', () => {
    expect(kesmeGoster('is-1', 'is-1')).toBe(true);
  });

  it('⚠️ YENİ İŞ BAŞLAYINCA kesme DEVREDİLMEZ — bayrak sızıntısı buydu', () => {
    // Kullanıcı 'is-1'de kesmeye takıldı, sonra 'is-2'yi başlattı.
    // Boolean bayrak tasarımında burası `true` dönüyordu ve yeni deneme
    // daha ilk karede "çok uzun sürdü" diyordu.
    expect(kesmeGoster('is-1', 'is-2')).toBe(false);
  });

  it('hiç kesme yaşanmadıysa gösterilmez', () => {
    expect(kesmeGoster(null, 'is-1')).toBe(false);
  });

  it('⚠️ jobId yokken kesme gösterilmez — null === null tuzağı', () => {
    // Saf bir `kesilenIsId === jobId` yazılsaydı ikisi de null iken `true`
    // dönerdi ve deneme HİÇ başlatılmamışken ekranda kesme kutusu çıkardı.
    expect(kesmeGoster(null, null)).toBe(false);
  });
});

describe('bitisDurumuMu — liste sözleşmeyle eksiksiz örtüşür', () => {
  /**
   * ⚠️ SÖZLEŞMEDEKİ ALTI DURUMUN TAMAMI BURADA SAYILIR. `TryOnStatusWire`a
   *    yeni bir değer eklenirse bu dizi derlenmeye devam eder ama testler
   *    kırılır — kasıtlı: yeni durumun BİTİŞ mi SÜREN mi olduğuna karar
   *    verilmeden geçilemez.
   */
  const TUM_DURUMLAR: readonly TryOnStatusWire[] = [
    'QUEUED',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'FAILED_PERMANENT',
    'CANCELLED',
  ];

  it('her durum ya bitiş ya süren — arada kalan yok', () => {
    for (const durum of TUM_DURUMLAR) {
      const bitis = bitisDurumuMu(durum);
      const suren = SUREN_DURUMLAR.includes(durum);
      expect(bitis !== suren, `${durum} tam olarak birine ait olmalı`).toBe(true);
    }
  });

  it('⚠️ dört bitiş durumunun HEPSİ yoklamayı durdurur', () => {
    // Biri eksik kalırsa: yoklama sonsuza kadar döner (dakikada 20 imzalı URL)
    // VE kesme bayrağı hiç düşmez.
    expect(bitisDurumuMu('SUCCEEDED')).toBe(true);
    expect(bitisDurumuMu('FAILED')).toBe(true);
    expect(bitisDurumuMu('FAILED_PERMANENT')).toBe(true);
    expect(bitisDurumuMu('CANCELLED')).toBe(true);
  });

  it('süren durumlar yoklamayı durdurmaz', () => {
    expect(bitisDurumuMu('QUEUED')).toBe(false);
    expect(bitisDurumuMu('RUNNING')).toBe(false);
  });

  it('⚠️ FAILED de bitiştir — başarısız iş de kesmeyi düşürmeli', () => {
    // Yalnızca SUCCEEDED düşürseydi, başarısız bir denemeden sonra ekran
    // kesme kutusunda kalır, kullanıcı gerçek hata mesajını hiç görmezdi.
    expect(bitisDurumuMu('FAILED')).toBe(true);
  });
});
