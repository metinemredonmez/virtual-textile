import { describe, expect, it, vi } from 'vitest';
import { FalTryOnProvider, falIstekGovdesi } from './fal.js';
import type { TryOnRequest } from './tryon.provider.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FAL — KUYRUK UCU.
 *
 *  ⚠️ CANLI ARIZADAN DOĞDU (2026-08-14). Sağlayıcı `https://fal.run/{model}`
 *     yani SENKRON ucu kullanıyordu: bağlantıyı açık tutup üretimin bitmesini
 *     bekliyor. Ölçüldü:
 *
 *         fal: TIMEOUT (25001ms)   → süre sınırı 25 sn iken
 *         fal: TIMEOUT (~60000ms)  → sınır 60 sn'ye çıkarıldıktan SONRA
 *
 *     Yani süreyi büyütmek çözmedi. Sebep büyük olasılıkla soğuk başlangıç:
 *     model uzun süre çağrılmamışsa fal onu yüklerken istek kuyrukta bekliyor.
 *     Düşük trafikte bu kuraldır, istisna değil.
 *
 *  ⚠️ `FalTryOnProvider`IN HİÇ TESTİ YOKTU. Sağlayıcı sınıfı sahte `fetch` ile
 *     bir kez bile çalıştırılmamıştı; `description` alanının eksikliği de
 *     (her üretimi 422 ile düşüren hata) tam bu yüzden ancak canlıda görüldü.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ISTEK: TryOnRequest = {
  personImageUrl: 'https://ornek/kisi.jpg',
  garmentImageUrl: 'https://ornek/urun.jpg',
  category: 'DRESS',
  mode: 'FAST',
  idempotencyKey: 'anahtar-1',
};

/** 1×1 PNG — indirilen görsel gerçek baytlar olmalı. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function yanit(govde: unknown, tur = 'application/json'): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': tur }),
    text: () => Promise.resolve(JSON.stringify(govde)),
    arrayBuffer: () => Promise.resolve(PNG.buffer.slice(0) as ArrayBuffer),
  } as unknown as Response;
}

function gorselYaniti(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'image/png', 'content-length': String(PNG.byteLength) }),
    text: () => Promise.resolve(''),
    arrayBuffer: () => Promise.resolve(PNG.buffer.slice(0) as ArrayBuffer),
  } as unknown as Response;
}

const SONUC_GOVDESI = { images: [{ url: 'https://ornek/sonuc.png', content_type: 'image/png' }] };

describe('FalTryOnProvider — kuyruk akışı', () => {
  it('⚠️ SENKRON UCA DEĞİL, KUYRUK UCUNA gönderir — asıl düzeltme bu', async () => {
    const adresler: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const adres = String(url);
      adresler.push(adres);
      if (adres.includes('queue.fal.run/fal-ai')) {
        return yanit({
          request_id: 'r1',
          status_url: 'https://queue.fal.run/durum/r1',
          response_url: 'https://queue.fal.run/sonuc/r1',
        });
      }
      if (adres.includes('/durum/')) return yanit({ status: 'COMPLETED' });
      if (adres.includes('/sonuc/')) return yanit(SONUC_GOVDESI);
      return gorselYaniti();
    }) as unknown as typeof fetch;

    const saglayici = new FalTryOnProvider({
      apiKey: 'k',
      model: 'fal-ai/idm-vton',
      fetchImpl,
      now: () => 0,
    });

    const sonuc = await saglayici.generate(ISTEK);

    expect(sonuc.status).toBe('SUCCEEDED');
    // İlk istek kuyruk köküne gitmeli; `fal.run/fal-ai` (senkron) OLMAMALI.
    expect(adresler[0]).toBe('https://queue.fal.run/fal-ai/idm-vton');
    expect(adresler.some((a) => a.startsWith('https://fal.run/'))).toBe(false);
  });

  it('IN_QUEUE ve IN_PROGRESS aşamalarında beklemeye devam eder', async () => {
    let durumSayisi = 0;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const adres = String(url);
      if (adres.includes('queue.fal.run/fal-ai')) {
        return yanit({
          status_url: 'https://queue.fal.run/durum/r1',
          response_url: 'https://queue.fal.run/sonuc/r1',
        });
      }
      if (adres.includes('/durum/')) {
        durumSayisi += 1;
        if (durumSayisi === 1) return yanit({ status: 'IN_QUEUE' });
        if (durumSayisi === 2) return yanit({ status: 'IN_PROGRESS' });
        return yanit({ status: 'COMPLETED' });
      }
      if (adres.includes('/sonuc/')) return yanit(SONUC_GOVDESI);
      return gorselYaniti();
    }) as unknown as typeof fetch;

    const saglayici = new FalTryOnProvider({
      apiKey: 'k',
      model: 'fal-ai/idm-vton',
      fetchImpl,
      now: () => 0,
    });

    const sonuc = await saglayici.generate(ISTEK);

    expect(sonuc.status).toBe('SUCCEEDED');
    expect(durumSayisi).toBe(3);
  });

  it('⚠️ KUYRUK ADRESİ YOKSA GÖVDE ZATEN SONUÇTUR — sonsuz yoklamaya girmez', async () => {
    // fal bazı modellerde doğrudan sonucu döndürüyor. Körü körüne yoklamaya
    // girseydik, hazır sonuç elimizdeyken sonsuza kadar "durum" arardık.
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('queue.fal.run')) return yanit(SONUC_GOVDESI);
      return gorselYaniti();
    }) as unknown as typeof fetch;

    const saglayici = new FalTryOnProvider({
      apiKey: 'k',
      model: 'fal-ai/idm-vton',
      fetchImpl,
      now: () => 0,
    });

    await expect(saglayici.generate(ISTEK)).resolves.toMatchObject({ status: 'SUCCEEDED' });
  });

  it('⚠️ BİLİNMEYEN AŞAMA HATADIR — bütçeyi boşa yakıp zaman aşımına düşmez', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const adres = String(url);
      if (adres.includes('queue.fal.run/fal-ai')) {
        return yanit({
          status_url: 'https://queue.fal.run/durum/r1',
          response_url: 'https://queue.fal.run/sonuc/r1',
        });
      }
      return yanit({ status: 'BILINMEYEN_ASAMA' });
    }) as unknown as typeof fetch;

    const saglayici = new FalTryOnProvider({
      apiKey: 'k',
      model: 'fal-ai/idm-vton',
      fetchImpl,
      now: () => 0,
    });

    // ⚠️ `generate` ASLA fırlatmaz — sınıflandırılmış başarısızlık döner,
    //    yoksa `generateWithFallback` zinciri kaybeder ve yedek denenmez.
    const sonuc = await saglayici.generate(ISTEK);
    expect(sonuc.status).toBe('FAILED');
  });

  it('gönderim gövdesi `description` alanını TAŞIR — yokluğu 422 üretiyordu', async () => {
    let gonderilen: unknown;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const adres = String(url);
      if (adres.includes('queue.fal.run/fal-ai')) {
        gonderilen = JSON.parse(String(init?.body));
        return yanit({
          status_url: 'https://queue.fal.run/durum/r1',
          response_url: 'https://queue.fal.run/sonuc/r1',
        });
      }
      if (adres.includes('/durum/')) return yanit({ status: 'COMPLETED' });
      if (adres.includes('/sonuc/')) return yanit(SONUC_GOVDESI);
      return gorselYaniti();
    }) as unknown as typeof fetch;

    const saglayici = new FalTryOnProvider({
      apiKey: 'k',
      model: 'fal-ai/idm-vton',
      fetchImpl,
      now: () => 0,
    });

    await saglayici.generate(ISTEK);

    expect(gonderilen).toMatchObject({
      human_image_url: ISTEK.personImageUrl,
      garment_image_url: ISTEK.garmentImageUrl,
    });
    expect((gonderilen as Record<string, unknown>)['description']).toBeTruthy();
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MODEL BAZLI İSTEK GÖVDESİ.
 *
 *  ⚠️ HER MODELİN ŞEMASI FARKLI. Bu depo bunu bir kez pahalıya öğrendi:
 *     `idm-vton`'un zorunlu `description` alanı gönderilmiyordu ve HER üretim
 *     HTTP 422 ile düşüyordu. Birim testlerde `fetch` sahtelendiği için sahte
 *     uç gövdeyi doğrulamıyordu — arıza yalnızca gerçek uçta görülebilirdi.
 *
 *  Bu testler o sınıfı kapatmıyor (gerçek şemayı ancak gerçek uç doğrular)
 *  ama BİLDİĞİMİZ şemaların bozulmasını engelliyor.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('falIstekGovdesi — model bazlı şema', () => {
  it('⚠️ fashn ile idm-vton ALAN ADLARI FARKLI — karıştırmak 422 üretir', () => {
    const fashn = falIstekGovdesi('fal-ai/fashn/tryon/v1.6', ISTEK);
    const idm = falIstekGovdesi('fal-ai/idm-vton', ISTEK);

    expect(fashn['model_image']).toBe(ISTEK.personImageUrl);
    expect(fashn['garment_image']).toBe(ISTEK.garmentImageUrl);
    expect(fashn['human_image_url']).toBeUndefined();

    expect(idm['human_image_url']).toBe(ISTEK.personImageUrl);
    expect(idm['garment_image_url']).toBe(ISTEK.garmentImageUrl);
    expect(idm['model_image']).toBeUndefined();
  });

  it('⚠️ KATEGORİ SÖZLÜĞÜ DE FARKLI — idm-vton adları fashn’de geçersiz', () => {
    expect(falIstekGovdesi('fal-ai/fashn/tryon/v1.6', ISTEK)['category']).toBe('one-pieces');
    expect(falIstekGovdesi('fal-ai/idm-vton', ISTEK)['category']).toBe('dresses');
  });

  it('idm-vton gövdesi `description` taşır — yokluğu her üretimi düşürüyordu', () => {
    expect(falIstekGovdesi('fal-ai/idm-vton', ISTEK)['description']).toBeTruthy();
  });

  it('FAST → performance, QUALITY → quality', () => {
    expect(falIstekGovdesi('fal-ai/fashn/tryon/v1.6', ISTEK)['mode']).toBe('performance');
    expect(
      falIstekGovdesi('fal-ai/fashn/tryon/v1.6', { ...ISTEK, mode: 'QUALITY' })['mode'],
    ).toBe('quality');
  });

  it('⚠️ ÖNEK EŞLEŞMESİ — yeni sürüm sessizce varsayılana DÜŞMEZ', () => {
    // Tam eşitlik yazılsaydı v1.7 çıktığında fashn gövdesi yerine idm-vton
    // gövdesi gider ve her üretim 422 olurdu.
    expect(falIstekGovdesi('fal-ai/fashn/tryon/v9.9', ISTEK)['model_image']).toBeTruthy();
  });

  it('bilinmeyen model idm-vton şemasına düşer — sessiz yanlış gövde değil', () => {
    expect(falIstekGovdesi('fal-ai/bilinmeyen-model', ISTEK)['human_image_url']).toBeTruthy();
  });
});
