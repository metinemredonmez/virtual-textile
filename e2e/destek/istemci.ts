/**
 * API İSTEMCİSİ — Playwright APIRequestContext sarmalayıcısı.
 *
 * ⚠️ TARAYICI YOK. Frontend yazılmadı; bunlar HTTP seviyesinde uçtan uca
 *    testler. Playwright burada bir tarayıcı otomasyon aracı olarak değil,
 *    çerez kavanozu ve yeniden deneme mantığı olan bir HTTP istemcisi olarak
 *    kullanılıyor.
 *
 * ⚠️ HER İSTEMCİ AYRI BİR APIRequestContext'tir. Gerekçe: refresh token
 *    httpOnly çerezde taşınıyor ve tek bir bağlam paylaşılsaydı, ikinci
 *    kullanıcının girişi birincinin çerezini ezerdi. "İkinci kullanıcı son
 *    ürünü alamıyor mu" gibi senaryolar sessizce tek kullanıcıya dönüşür ve
 *    yeşil yanardı — test edilen şey ortadan kalkmış olurdu.
 */
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { AYARLAR } from './ortam.js';

/** Sunucunun başarı zarfı: { data, meta }. */
interface BasariZarfi<T> {
  data: T;
  meta: { requestId: string; nextCursor?: string | null; total?: number };
}

/** Sunucunun hata zarfı: { error: {...} }. */
export interface HataZarfi {
  error: {
    code: string;
    message: string;
    httpStatus: number;
    retryable: boolean;
    details?: unknown;
    requestId: string;
    retryAfterSeconds?: number;
  };
}

export interface IstekSecenekleri {
  govde?: unknown;
  sorgu?: Record<string, string | number | boolean | string[]>;
  basliklar?: Record<string, string>;
  /** `@Idempotent` uçlarında tekrar denemeyi test etmek için. */
  idempotencyKey?: string;
}

/**
 * Tek bir HTTP yanıtı. Ham gövde ve durum korunur — testin "başarılı mı"
 * kararını KENDİSİ vermesi gerekir, sarmalayıcı hata fırlatarak bu kararı
 * elinden almaz. Hata zarfını doğrulayan senaryolar (hata-zarfi.spec) aksi
 * hâlde yazılamazdı.
 */
export class Yanit {
  constructor(
    readonly durum: number,
    readonly govde: unknown,
    readonly basliklar: Record<string, string>,
    readonly yol: string,
  ) {}

  /** Başarı zarfını açar. Yanıt hata ise anlaşılır biçimde patlar. */
  veri<T = unknown>(): T {
    if (!this.basarili) {
      throw new IstemciHatasi(
        `${this.yol} beklenmedik biçimde ${String(this.durum)} döndü: ${this.ozet()}`,
      );
    }
    if (this.govde === null || typeof this.govde !== 'object') {
      throw new IstemciHatasi(
        `${this.yol} gövdesiz döndü (durum ${String(this.durum)}); veri okunamaz.`,
      );
    }
    const zarf = this.govde as BasariZarfi<T>;
    return zarf.data;
  }

  meta(): BasariZarfi<unknown>['meta'] {
    return (this.govde as BasariZarfi<unknown>).meta;
  }

  get basarili(): boolean {
    return this.durum >= 200 && this.durum < 300;
  }

  /** Hata zarfındaki katalog kodu; başarı yanıtında null. */
  get hataKodu(): string | null {
    const zarf = this.govde as Partial<HataZarfi>;
    return typeof zarf.error?.code === 'string' ? zarf.error.code : null;
  }

  get hata(): HataZarfi['error'] {
    const zarf = this.govde as Partial<HataZarfi>;
    if (!zarf.error) {
      throw new IstemciHatasi(`${this.yol} bir hata zarfı döndürmedi: ${this.ozet()}`);
    }
    return zarf.error;
  }

  /**
   * `Set-Cookie` başlığından tek bir çerezin ham DEĞERİNİ çıkarır.
   *
   * Token hırsızlığı senaryosunun temel taşı: Playwright'ın çerez kavanozu
   * eski refresh token'ı otomatik olarak yenisiyle değiştirir, dolayısıyla
   * "eski token'ı tekrar gönder" testi kavanoza güvenerek YAZILAMAZ. Değer
   * burada elle yakalanıp sonra elle geri gönderilir.
   *
   * Playwright birden fazla Set-Cookie başlığını `\n` ile birleştirir.
   */
  cerez(ad: string): string | null {
    const setCookie = this.basliklar['set-cookie'];
    if (setCookie === undefined) return null;

    for (const parca of setCookie.split('\n')) {
      const ilkCift = parca.split(';')[0] ?? '';
      const esitlik = ilkCift.indexOf('=');
      if (esitlik === -1) continue;
      if (ilkCift.slice(0, esitlik).trim() === ad) return ilkCift.slice(esitlik + 1).trim();
    }
    return null;
  }

  ozet(): string {
    const metin = JSON.stringify(this.govde);
    return metin.length > 600 ? `${metin.slice(0, 600)}…` : metin;
  }
}

/**
 * Bir kullanıcının (veya misafirin) API oturumu.
 *
 * `token` set edildiğinde her isteğe Authorization eklenir. Misafir sepeti
 * için `oturumKimligi` kullanılır — sunucu token varsa `X-Session-Id`'yi
 * BİLEREK yok sayar (bkz. cart.owner.ts), test de bu davranışa güvenir.
 */
export class Istemci {
  token: string | null = null;
  oturumKimligi: string | null = null;
  /** Satıcı birden fazla mağazaya üyeyse hangisi — `X-Seller-Id`. */
  saticiKimligi: string | null = null;

  constructor(private readonly baglam: APIRequestContext) {}

  get istekBaglami(): APIRequestContext {
    return this.baglam;
  }

  kimlikSil(): void {
    this.token = null;
  }

  async get(yol: string, secenekler: IstekSecenekleri = {}): Promise<Yanit> {
    return this.gonder('get', yol, secenekler);
  }

  async post(yol: string, secenekler: IstekSecenekleri = {}): Promise<Yanit> {
    return this.gonder('post', yol, secenekler);
  }

  async patch(yol: string, secenekler: IstekSecenekleri = {}): Promise<Yanit> {
    return this.gonder('patch', yol, secenekler);
  }

  async delete(yol: string, secenekler: IstekSecenekleri = {}): Promise<Yanit> {
    return this.gonder('delete', yol, secenekler);
  }

  private async gonder(
    yontem: 'get' | 'post' | 'patch' | 'delete',
    yol: string,
    secenekler: IstekSecenekleri,
  ): Promise<Yanit> {
    const basliklar: Record<string, string> = {
      Accept: 'application/json',
      ...secenekler.basliklar,
    };

    if (this.token !== null) basliklar['Authorization'] = `Bearer ${this.token}`;
    if (this.oturumKimligi !== null) basliklar['X-Session-Id'] = this.oturumKimligi;
    if (this.saticiKimligi !== null) basliklar['X-Seller-Id'] = this.saticiKimligi;
    if (secenekler.idempotencyKey !== undefined) {
      basliklar['Idempotency-Key'] = secenekler.idempotencyKey;
    }

    const tamYol = yolBirlestir(yol, secenekler.sorgu);

    const yanit: APIResponse = await this.baglam.fetch(tamYol, {
      method: yontem,
      headers: basliklar,
      ...(secenekler.govde === undefined ? {} : { data: secenekler.govde }),
      // Yönlendirme İZLENMEZ: 3DS geri dönüşü gibi uçlarda yönlendirme
      // hedefinin kendisi test edilen şeydir; sessizce takip edilirse
      // hangi ucun ne döndürdüğü kaybolur.
      maxRedirects: 0,
      failOnStatusCode: false,
    });

    return new Yanit(yanit.status(), await govdeyiCoz(yanit), yanit.headers(), `${yontem} ${yol}`);
  }
}

async function govdeyiCoz(yanit: APIResponse): Promise<unknown> {
  const metin = await yanit.text();
  if (metin === '') return null;
  try {
    return JSON.parse(metin) as unknown;
  } catch {
    // 204 dışı boş olmayan ama JSON olmayan gövde: HTML hata sayfası veya
    // ham metin. Olduğu gibi taşınır ki hata-zarfi.spec "her yanıt JSON
    // zarfında mı" sorusunu gerçekten sorabilsin.
    return metin;
  }
}

function yolBirlestir(
  yol: string,
  sorgu: Record<string, string | number | boolean | string[]> | undefined,
): string {
  if (sorgu === undefined) return yol;

  const parcalar: string[] = [];
  for (const [anahtar, deger] of Object.entries(sorgu)) {
    // Tekrarlanan parametreler dizi olarak gider: ?color=Siyah&color=Bej
    // (bkz. catalog.schema.ts → stringArray)
    for (const tek of Array.isArray(deger) ? deger : [deger]) {
      parcalar.push(`${encodeURIComponent(anahtar)}=${encodeURIComponent(String(tek))}`);
    }
  }

  if (parcalar.length === 0) return yol;
  return `${yol}${yol.includes('?') ? '&' : '?'}${parcalar.join('&')}`;
}

/** Playwright'ın `playwright` fixture'ından yeni, izole bir istemci üretir. */
export async function yeniIstemci(
  playwright: { request: { newContext: (o: { baseURL: string }) => Promise<APIRequestContext> } },
  temelUrl: string = AYARLAR.temelUrl,
): Promise<Istemci> {
  return new Istemci(await playwright.request.newContext({ baseURL: temelUrl }));
}

// ── Ortak iddialar ────────────────────────────────────────────────────────

/**
 * Hata zarfının BİÇİMİNİ doğrular — yalnızca kodu değil.
 *
 * Zarf biçimi tek tek uçlarda değil, tek bir filtrede üretiliyor
 * (GlobalExceptionFilter). Bu iddia her senaryoda tekrarlandığı için
 * filtrenin bir uçta atlanması derhâl görünür olur.
 */
export function hataBekle(yanit: Yanit, beklenenKod: string, beklenenDurum?: number): void {
  expect(yanit.hataKodu, `${yanit.yol} → ${beklenenKod} bekleniyordu, gelen: ${yanit.ozet()}`).toBe(
    beklenenKod,
  );

  const hata = yanit.hata;
  expect(hata.httpStatus, 'Gövdedeki httpStatus HTTP durumuyla aynı olmalı').toBe(yanit.durum);
  expect(typeof hata.message, 'Kullanıcıya gösterilecek mesaj string olmalı').toBe('string');
  expect(hata.message.length, 'Hata mesajı boş olamaz').toBeGreaterThan(0);
  expect(typeof hata.retryable, 'retryable alanı zorunlu').toBe('boolean');
  expect(typeof hata.requestId, 'requestId alanı zorunlu').toBe('string');

  if (beklenenDurum !== undefined) {
    expect(yanit.durum, `${yanit.yol} HTTP durumu`).toBe(beklenenDurum);
  }
}

export function basariBekle(yanit: Yanit, beklenenDurum?: number): void {
  expect(yanit.basarili, `${yanit.yol} başarısız oldu: ${yanit.ozet()}`).toBe(true);

  if (beklenenDurum !== undefined) {
    expect(yanit.durum, `${yanit.yol} HTTP durumu`).toBe(beklenenDurum);
  }

  // ⚠️ 204'ün gövdesi YOKTUR; zarf araması burada yanlış olurdu. Çıkış ve
  //    oturum kapatma uçları bilinçli olarak 204 dönüyor.
  if (yanit.durum === 204 || yanit.govde === null) return;

  const zarf = yanit.govde as Partial<BasariZarfi<unknown>>;
  expect(zarf.meta, `${yanit.yol} yanıtında meta yok — zarf uygulanmamış olabilir`).toBeDefined();
  expect(typeof zarf.meta?.requestId).toBe('string');
}

export class IstemciHatasi extends Error {
  override readonly name = 'IstemciHatasi';
}
