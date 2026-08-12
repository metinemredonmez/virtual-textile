/**
 * SAHTE iyzico SAĞLAYICISI
 *
 * ═══════════════════════ NEDEN VAR ═══════════════════════════════════════
 *
 * Ödeme sağlayıcısı FAIL-CLOSED bağlanıyor (checkout/index.ts): anahtar yoksa
 * her çağrıda hata veren yer tutucu devreye giriyor. Anahtar VARSA da gerçek
 * 3DS akışı bankanın HTML formunu ve OTP girişini gerektirir — tarayıcısız bir
 * API testinden tamamlanamaz.
 *
 * Sonuç: `checkout/pay` ötesine geçilemez ve sipariş asla PAID olmaz. Oysa
 * defter (SALE / COMMISSION), stok düşümü ve iade ters kayıtlarının HEPSİ
 * `confirmPaid` içinde yazılıyor. Bu adım atlanırsa 6. ve 7. senaryolar
 * yazılamaz; asıl risk tam olarak orada.
 *
 * ⚠️ ÇÖZÜM: sunucu kodu DEĞİŞTİRİLMİYOR. Yalnızca `IYZICO_BASE_URL` bu sahte
 *    sunucuya çevriliyor. Böylece `initiate3ds → complete3ds → confirmPaid →
 *    LedgerEntry` zincirinin TAMAMI gerçek üretim koduyla çalışır; sahte olan
 *    tek şey üçüncü tarafın kendisidir. Testte "confirmPaid'in yaptığı işi
 *    elle veritabanına yazmak" bilinçli olarak REDDEDİLDİ: o yol, doğrulaması
 *    gereken mantığı testin içinde yeniden üretmek olurdu ve test hiçbir şey
 *    kanıtlamazdı.
 *
 * ⚠️ Sahte sunucu YALNIZCA 127.0.0.1'e bağlanır. Ödeme "başarılı" diyen bir
 *    uç noktanın ağa açılması, geliştirme ortamında bile kabul edilemez.
 *
 * Uyguladığı uçlar (bkz. packages/adapters/.../iyzico.config.ts → IYZICO_PATH):
 *   POST /payment/3dsecure/initialize
 *   POST /payment/3dsecure/auth
 *   POST /payment/detail
 *   POST /payment/refund
 *   POST /onboarding/submerchant
 *   POST /payment/iyzipos/settlement/approve
 *
 * Ayrıca teste özel bir yönetim yüzeyi (`/_test/...`) sunar: senaryolar
 * conversationId'yi buradan öğrenir, sonraki çağrının başarısız dönmesini
 * buradan ister.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/** Sağlayıcıya giden bir çağrının kaydı. */
export interface SaglayiciCagrisi {
  yol: string;
  govde: Record<string, unknown>;
  zaman: number;
}

/** `initiate3ds` çağrısından öğrenilen, ödemeyi tamamlamak için gereken bilgi. */
export interface OdemeBaglami {
  conversationId: string;
  paymentId: string;
  /** Sağlayıcıya bildirilen toplam tutar (kuruş). */
  tutarMinor: bigint;
  /** Kalem başına satıcı hakedişi — split doğruluğunu sınamak için. */
  kalemler: Array<{ orderItemId: string; tutarMinor: bigint; saticiyaKalanMinor: bigint }>;
  callbackUrl: string;
}

/** Bir sonraki ödeme sonucunun ne olacağı. */
export type OdemeSonucu = 'CAPTURED' | 'DECLINED';

interface KayitliOdeme {
  conversationId: string;
  paymentId: string;
  tutarMinor: bigint;
  sonuc: OdemeSonucu;
  yakalandi: boolean;
}

const DESTEKLENEN_YOLLAR = new Set([
  '/payment/3dsecure/initialize',
  '/payment/3dsecure/auth',
  '/payment/detail',
  '/payment/refund',
  '/onboarding/submerchant',
  '/payment/iyzipos/settlement/approve',
]);

export class SahteIyzico {
  private sunucu: Server | null = null;
  private readonly cagrilar: SaglayiciCagrisi[] = [];
  private readonly odemeler = new Map<string, KayitliOdeme>();
  /** paymentId → conversationId */
  private readonly odemeDizini = new Map<string, string>();
  /** Bir sonraki `initialize` çağrısının sonucu. Varsayılan: başarı. */
  private sonrakiSonuc: OdemeSonucu = 'CAPTURED';

  constructor(
    private readonly port: number,
    private readonly webhookSirri: string,
  ) {}

  async baslat(): Promise<void> {
    if (this.sunucu !== null) return;

    const sunucu = createServer((istek, yanit) => {
      void this.yonlendir(istek, yanit).catch((hata: unknown) => {
        yanit.writeHead(500, { 'Content-Type': 'application/json' });
        yanit.end(JSON.stringify({ status: 'failure', errorMessage: String(hata) }));
      });
    });

    await new Promise<void>((coz, reddet) => {
      sunucu.once('error', reddet);
      // ⚠️ Yalnızca döngü arayüzü — ağa açılmaz.
      sunucu.listen(this.port, '127.0.0.1', () => {
        sunucu.removeListener('error', reddet);
        coz();
      });
    });

    this.sunucu = sunucu;
  }

  async durdur(): Promise<void> {
    const sunucu = this.sunucu;
    if (sunucu === null) return;
    this.sunucu = null;
    await new Promise<void>((coz) => {
      sunucu.close(() => {
        coz();
      });
    });
  }

  get temelUrl(): string {
    return `http://127.0.0.1:${String(this.port)}`;
  }

  // ── Test yüzeyi ─────────────────────────────────────────────────────────

  /** Bir sonraki ödeme reddedilsin (kart reddi senaryosu). */
  sonrakiOdemeyiReddet(): void {
    this.sonrakiSonuc = 'DECLINED';
  }

  sifirla(): void {
    this.cagrilar.length = 0;
    this.odemeler.clear();
    this.odemeDizini.clear();
    this.sonrakiSonuc = 'CAPTURED';
  }

  /**
   * Belirli bir sipariş için `initiate3ds` çağrısını bulur.
   *
   * ⚠️ conversationId sunucuda üretilip PaymentIntent'e yazılıyor; istemciye
   *    HİÇ dönmüyor. Test onu ancak sağlayıcıya ulaşan istekten öğrenebilir —
   *    veritabanını okumak yerine bu yol seçildi, çünkü sağlayıcıya giden
   *    tutarın doğruluğu da aynı anda sınanmış oluyor.
   */
  odemeBaglamiBul(orderId: string): OdemeBaglami | null {
    for (let i = this.cagrilar.length - 1; i >= 0; i -= 1) {
      const cagri = this.cagrilar[i];
      if (cagri === undefined) continue;
      if (cagri.yol !== '/payment/3dsecure/initialize') continue;
      if (cagri.govde['basketId'] !== orderId) continue;

      const conversationId = String(cagri.govde['conversationId']);
      const kayit = this.odemeler.get(conversationId);
      if (kayit === undefined) continue;

      const hamKalemler = Array.isArray(cagri.govde['basketItems'])
        ? (cagri.govde['basketItems'] as Array<Record<string, unknown>>)
        : [];

      return {
        conversationId,
        paymentId: kayit.paymentId,
        tutarMinor: ondalikKurusa(cagri.govde['paidPrice']),
        kalemler: hamKalemler.map((kalem) => ({
          orderItemId: String(kalem['id']),
          tutarMinor: ondalikKurusa(kalem['price']),
          saticiyaKalanMinor: ondalikKurusa(kalem['subMerchantPrice']),
        })),
        callbackUrl: String(cagri.govde['callbackUrl']),
      };
    }
    return null;
  }

  cagriSayisi(yol: string): number {
    return this.cagrilar.filter((cagri) => cagri.yol === yol).length;
  }

  /**
   * İmzalı webhook gövdesi ve başlıkları üretir.
   *
   * ⚠️ İmza girdisi `${timestamp}.${rawBody}` — zaman damgası imzanın İÇİNDE
   *    (bkz. iyzico.signature.ts). Testte de aynı biçim kullanılmalı, yoksa
   *    doğrulama her zaman başarısız olur ve "webhook işlenmiyor" sanılır.
   */
  webhookImzala(yuk: Record<string, unknown>): {
    govde: string;
    basliklar: Record<string, string>;
  } {
    const govde = JSON.stringify(yuk);
    const zamanDamgasi = String(Date.now());
    const imza = createHmac('sha256', this.webhookSirri)
      .update(`${zamanDamgasi}.`)
      .update(Buffer.from(govde, 'utf8'))
      .digest('hex');

    return {
      govde,
      basliklar: {
        'Content-Type': 'application/json',
        'x-iyz-signature-v3': imza,
        'x-iyz-timestamp': zamanDamgasi,
      },
    };
  }

  // ── HTTP yönlendirme ────────────────────────────────────────────────────

  private async yonlendir(istek: IncomingMessage, yanit: ServerResponse): Promise<void> {
    const yol = (istek.url ?? '').split('?')[0] ?? '';

    if (yol === '/_test/saglik') {
      this.jsonYaz(yanit, 200, { hazir: true });
      return;
    }

    if (!DESTEKLENEN_YOLLAR.has(yol)) {
      // Bilinmeyen uç SESSİZCE başarı dönmez: adapter yeni bir uca çağrı
      // yapmaya başladığında test bunu görmeli, sahte sunucu "her şey yolunda"
      // diyerek gerçeği örtmemeli.
      this.jsonYaz(yanit, 404, {
        status: 'failure',
        errorCode: 'E2E_BILINMEYEN_UC',
        errorMessage: `Sahte iyzico bu ucu tanımıyor: ${yol}`,
      });
      return;
    }

    const govde = await govdeyiOku(istek);
    this.cagrilar.push({ yol, govde, zaman: Date.now() });

    switch (yol) {
      case '/payment/3dsecure/initialize':
        this.jsonYaz(yanit, 200, this.uygulaInitialize(govde));
        return;
      case '/payment/3dsecure/auth':
        this.jsonYaz(yanit, 200, this.uygulaAuth(govde));
        return;
      case '/payment/detail':
        this.jsonYaz(yanit, 200, this.uygulaDetail(govde));
        return;
      case '/payment/refund':
        this.jsonYaz(yanit, 200, this.uygulaRefund(govde));
        return;
      default:
        // submerchant / settlement: kabul edilir, yan etkisi yoktur.
        this.jsonYaz(yanit, 200, { status: 'success', systemTime: Date.now() });
    }
  }

  private uygulaInitialize(govde: Record<string, unknown>): Record<string, unknown> {
    const conversationId = String(govde['conversationId']);
    const paymentId = `pay_${randomUUID()}`;

    this.odemeler.set(conversationId, {
      conversationId,
      paymentId,
      tutarMinor: ondalikKurusa(govde['paidPrice']),
      sonuc: this.sonrakiSonuc,
      yakalandi: false,
    });
    this.odemeDizini.set(paymentId, conversationId);
    this.sonrakiSonuc = 'CAPTURED';

    return {
      status: 'success',
      conversationId,
      paymentId,
      // Gerçek sağlayıcı base64 HTML gönderir; adapter çözüp döndürüyor.
      threeDSHtmlContent: Buffer.from(
        '<html><body>E2E sahte 3DS formu</body></html>',
        'utf8',
      ).toString('base64'),
      systemTime: Date.now(),
    };
  }

  private uygulaAuth(govde: Record<string, unknown>): Record<string, unknown> {
    const paymentId = String(govde['paymentId']);
    const conversationId = this.odemeDizini.get(paymentId);
    const kayit = conversationId === undefined ? undefined : this.odemeler.get(conversationId);

    if (kayit === undefined) {
      return { status: 'failure', errorCode: '1000', errorMessage: 'İşlem bulunamadı' };
    }

    if (kayit.sonuc === 'DECLINED') {
      return {
        status: 'failure',
        conversationId: kayit.conversationId,
        paymentId,
        mdStatus: 1,
        errorCode: '10051',
        errorMessage: 'Yetersiz bakiye',
        systemTime: Date.now(),
      };
    }

    kayit.yakalandi = true;
    return this.basariliOdemeYaniti(kayit);
  }

  private uygulaDetail(govde: Record<string, unknown>): Record<string, unknown> {
    const conversationId = String(govde['paymentConversationId'] ?? govde['conversationId'] ?? '');
    const kayit = this.odemeler.get(conversationId);

    // ⚠️ Bulunamadı kodu ÖNEMLİ: adapter `isNotFoundCode` ile "hiç olmamış"
    //    ile "servis patladı" ayrımını buradan yapıyor. Rastgele bir kod
    //    dönmek, olmayan bir ödemenin sonsuza kadar sorgulanmasına yol açar.
    if (kayit === undefined) {
      return { status: 'failure', errorCode: '1000', errorMessage: 'Kayıt yok' };
    }

    if (kayit.sonuc === 'DECLINED' || !kayit.yakalandi) {
      return {
        status: 'failure',
        conversationId,
        paymentId: kayit.paymentId,
        mdStatus: 0,
        errorCode: '10051',
        errorMessage: 'Tahsilat yok',
        systemTime: Date.now(),
      };
    }

    return this.basariliOdemeYaniti(kayit);
  }

  private uygulaRefund(govde: Record<string, unknown>): Record<string, unknown> {
    return {
      status: 'success',
      paymentTransactionId: String(govde['paymentTransactionId'] ?? ''),
      price: String(govde['price'] ?? '0'),
      systemTime: Date.now(),
    };
  }

  private basariliOdemeYaniti(kayit: KayitliOdeme): Record<string, unknown> {
    return {
      status: 'success',
      conversationId: kayit.conversationId,
      paymentId: kayit.paymentId,
      // mdStatus=1 → 3DS doğrulandı. Başka her değer başarısızlıktır.
      mdStatus: 1,
      paymentStatus: 'SUCCESS',
      paidPrice: kurusOndaliga(kayit.tutarMinor),
      price: kurusOndaliga(kayit.tutarMinor),
      cardAssociation: 'MASTER_CARD',
      binNumber: '552879',
      lastFourDigits: '0008',
      systemTime: Date.now(),
    };
  }

  private jsonYaz(yanit: ServerResponse, durum: number, govde: unknown): void {
    const metin = JSON.stringify(govde);
    yanit.writeHead(durum, {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(metin)),
    });
    yanit.end(metin);
  }
}

async function govdeyiOku(istek: IncomingMessage): Promise<Record<string, unknown>> {
  const parcalar: Buffer[] = [];
  for await (const parca of istek) parcalar.push(parca as Buffer);
  const metin = Buffer.concat(parcalar).toString('utf8');
  if (metin === '') return {};
  try {
    return JSON.parse(metin) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** "89.90" → 8990n. Sağlayıcı ondalık string konuşur, biz kuruş. */
function ondalikKurusa(deger: unknown): bigint {
  if (deger === undefined || deger === null) return 0n;
  const metin = String(deger).trim();
  const eslesme = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(metin);
  if (eslesme === null) return 0n;
  const [, isaret, tam, ondalik] = eslesme;
  const kurusParcasi = (ondalik ?? '').padEnd(2, '0');
  const mutlak = BigInt(tam ?? '0') * 100n + BigInt(kurusParcasi);
  return isaret === '-' ? -mutlak : mutlak;
}

/** 8990n → "89.90" */
function kurusOndaliga(minor: bigint): string {
  const negatif = minor < 0n;
  const mutlak = negatif ? -minor : minor;
  return `${negatif ? '-' : ''}${(mutlak / 100n).toString()}.${(mutlak % 100n).toString().padStart(2, '0')}`;
}
