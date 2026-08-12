/**
 * SENARYO KURULUMU — test verisi üreticileri.
 *
 * ⚠️ SEED'E BAĞIMLILIK YOK. Her senaryo kendi kullanıcısını, satıcısını,
 *    kategorisini ve ürününü sıfırdan üretir. Gerekçe pratik: `pnpm db:seed`
 *    çalıştırılmış bir makinede yeşil, temiz bir CI veritabanında kırmızı
 *    yanan bir takım, kırmızı yandığında kimseye güven vermez.
 *
 * ⚠️ ÜRETİM YOLU MÜMKÜN OLAN HER YERDE GERÇEK HTTP. Satıcı başvurusu, admin
 *    onayı, ürün oluşturma ve moderasyon uçlardan geçer — böylece kurulumun
 *    kendisi de uçtan uca akışın bir parçası olur. Veritabanına yalnızca
 *    karşılığı olmayan adımlarda iniliyor (bkz. veritabani.ts).
 */
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { basariBekle, yeniIstemci, type Istemci } from './istemci.js';
import { lira } from './para.js';
import {
  altUyeIsyeriBagla,
  hizLimitiSifirla,
  rolAta,
  urunGorseliEkle,
  type TemizlikDefteri,
} from './veritabani.js';

/** Testler arası çakışmayı imkânsız kılan benzersiz ek. */
export function benzersiz(onek = 'e2e'): string {
  return `${onek}-${randomUUID().slice(0, 12)}`;
}

/**
 * Ek, izole bir istemci açar.
 *
 * ⚠️ İkiden fazla aktör gereken senaryolarda (iki satıcı + admin + müşteri)
 *    ZORUNLU: aynı bağlamı paylaşan iki satıcı, birbirinin refresh çerezini
 *    ezer ve testler birbirinin kimliğiyle istek atmaya başlar.
 *
 * ⚠️ Çağıran taraf sonunda `istekBaglami.dispose()` çağırmalı; aksi hâlde
 *    Playwright süreci açık bağlantı yüzünden kapanmaz.
 */
export async function yeniIstemciyle(
  playwright: Parameters<typeof yeniIstemci>[0],
): Promise<Istemci> {
  return yeniIstemci(playwright);
}

/** TR cep telefonu üretir — phoneSchema `+905XXXXXXXXX` bekliyor. */
export function telefonUret(): string {
  const govde = String(Math.floor(100_000_000 + Math.random() * 899_999_999));
  return `+905${govde.slice(0, 9)}`;
}

export interface Kullanici {
  id: string;
  eposta: string;
  sifre: string;
  ad: string;
  soyad: string;
  token: string;
  rol: 'CUSTOMER' | 'SELLER_USER' | 'SUPPORT' | 'ADMIN';
}

export interface Satici {
  sellerId: string;
  storeSlug: string;
  kullanici: Kullanici;
  /** Satıcı paneli için hazır istemci (token'ı sellerIds taşır). */
  istemci: Istemci;
}

export interface Urun {
  productId: string;
  slug: string;
  baslik: string;
  varyantlar: Array<{ id: string; sku: string; renk: string; beden: string; fiyatMinor: bigint }>;
}

const VARSAYILAN_SIFRE = 'PLACEHOLDER-NOT-A-SECRET-PW1';

// ── Kullanıcı ─────────────────────────────────────────────────────────────

/**
 * Kayıt olur ve token'ı istemciye yazar.
 *
 * ⚠️ Kayıt hız limiti IP başına SAATTE 3. Tüm testler 127.0.0.1'den geldiği
 *    için sayaç her kayıttan önce temizleniyor; aksi hâlde üçüncü kullanıcıdan
 *    sonra bütün takım 429 alırdı. Limitin KENDİSİ hata-zarfi.spec içinde,
 *    bilinçli olarak ve kendi temizliğiyle sınanıyor.
 */
export async function musteriOlustur(
  istemci: Istemci,
  defter: TemizlikDefteri,
  secenekler: { eposta?: string; sifre?: string } = {},
): Promise<Kullanici> {
  await hizLimitiSifirla('register');

  const eposta = secenekler.eposta ?? `${benzersiz('musteri')}@e2e.test`;
  const sifre = secenekler.sifre ?? VARSAYILAN_SIFRE;

  const yanit = await istemci.post('/v1/auth/register', {
    govde: {
      email: eposta,
      password: sifre,
      firstName: 'Test',
      lastName: 'Kullanici',
      acceptedTerms: true,
    },
  });
  basariBekle(yanit, 201);

  const veri = yanit.veri<{
    user: { id: string; role: Kullanici['rol'] };
    tokens: { accessToken: string };
  }>();

  defter.kullaniciIdleri.push(veri.user.id);
  istemci.token = veri.tokens.accessToken;

  return {
    id: veri.user.id,
    eposta,
    sifre,
    ad: 'Test',
    soyad: 'Kullanici',
    token: veri.tokens.accessToken,
    rol: veri.user.role,
  };
}

/** Var olan kullanıcıyla giriş yapar ve token'ı istemciye yazar. */
export async function girisYap(istemci: Istemci, kullanici: Kullanici): Promise<string> {
  await hizLimitiSifirla('login');

  const yanit = await istemci.post('/v1/auth/login', {
    govde: { identifier: kullanici.eposta, password: kullanici.sifre },
  });
  basariBekle(yanit, 200);

  const veri = yanit.veri<{ tokens: { accessToken: string } }>();
  istemci.token = veri.tokens.accessToken;
  return veri.tokens.accessToken;
}

/**
 * Yönetici hesabı üretir.
 *
 * Kayıt HTTP'den geçiyor (şifre gerçekten argon2 ile hash'leniyor), rol
 * veritabanından yükseltiliyor, sonra TEKRAR GİRİŞ yapılıyor — yeni rolün
 * token'a işlemesi için. Rol token'da taşınıyor; eski token'la devam etmek
 * "yetkim var ama yok" gibi anlaşılmaz hatalar üretirdi.
 */
export async function yoneticiOlustur(
  istemci: Istemci,
  defter: TemizlikDefteri,
  rol: 'ADMIN' | 'SUPPORT' = 'ADMIN',
): Promise<Kullanici> {
  const kullanici = await musteriOlustur(istemci, defter, {
    eposta: `${benzersiz('admin')}@e2e.test`,
  });

  await rolAta(kullanici.id, rol);
  const token = await girisYap(istemci, kullanici);

  return { ...kullanici, rol, token };
}

// ── Satıcı ────────────────────────────────────────────────────────────────

/**
 * Onaylanmış, sipariş alabilir bir satıcı üretir.
 *
 * Akış:
 *  1. kullanıcı kaydı                     → HTTP
 *  2. satıcı başvurusu                    → HTTP  (POST /v1/seller/apply)
 *  3. admin onayı                         → HTTP  (POST /v1/admin/sellers/:id/approve)
 *  4. alt üye işyeri anahtarı             → DB    (finans işçisi yazılmadı)
 *  5. SELLER_USER rolü                    → DB    (⚠️ kod hiçbir yerde atamıyor)
 *  6. tekrar giriş                        → HTTP  (token'a sellerIds ve rol işlesin)
 */
export async function saticiOlustur(
  istemci: Istemci,
  yoneticiIstemcisi: Istemci,
  defter: TemizlikDefteri,
  secenekler: { magazaAdi?: string } = {},
): Promise<Satici> {
  const kullanici = await musteriOlustur(istemci, defter, {
    eposta: `${benzersiz('satici')}@e2e.test`,
  });

  const magazaSlug = benzersiz('magaza');
  const basvuru = await istemci.post('/v1/seller/apply', {
    govde: {
      legalName: secenekler.magazaAdi ?? `E2E Tekstil ${magazaSlug}`,
      displayName: secenekler.magazaAdi ?? `E2E Mağaza ${magazaSlug.slice(-6)}`,
      // Geçerli 10 haneli VKN — taxNumberSchema 10 hane VEYA geçerli TCKN ister.
      taxNumber: '1234567890',
      taxOffice: 'Beşiktaş',
      // mod-97 kontrolünden geçen gerçek biçimli bir test IBAN'ı.
      iban: 'TR330006100519786457841326',
      contactEmail: `${magazaSlug}@e2e.test`,
      contactPhone: telefonUret(),
      storeSlug: magazaSlug,
      storeDescription: 'E2E senaryosu için üretilmiş mağaza.',
    },
    idempotencyKey: randomUUID(),
  });
  basariBekle(basvuru);

  const sellerId = basvuru.veri<{ id: string }>().id;
  defter.saticiIdleri.push(sellerId);

  const onay = await yoneticiIstemcisi.post(`/v1/admin/sellers/${sellerId}/approve`, {
    govde: { note: 'E2E otomatik onay' },
  });
  basariBekle(onay, 200);

  await altUyeIsyeriBagla(sellerId);
  await rolAta(kullanici.id, 'SELLER_USER');
  const token = await girisYap(istemci, kullanici);

  return {
    sellerId,
    storeSlug: magazaSlug,
    kullanici: { ...kullanici, rol: 'SELLER_USER', token },
    istemci,
  };
}

// ── Katalog ───────────────────────────────────────────────────────────────

/** Sanal denemeye uygun (tryOnCategory dolu) bir kategori açar. */
export async function kategoriOlustur(
  yoneticiIstemcisi: Istemci,
  defter: TemizlikDefteri,
  secenekler: {
    ad?: string;
    tryOn?: 'UPPER_BODY' | 'LOWER_BODY' | 'DRESS' | 'OUTERWEAR' | null;
  } = {},
): Promise<{ id: string; slug: string }> {
  const slug = benzersiz('kategori');
  const yanit = await yoneticiIstemcisi.post('/v1/admin/categories', {
    govde: {
      slug,
      name: secenekler.ad ?? 'E2E Üst Giyim',
      tryOnCategory: secenekler.tryOn === undefined ? 'UPPER_BODY' : secenekler.tryOn,
      sortOrder: 1,
      isActive: true,
    },
  });
  basariBekle(yanit);

  const id = yanit.veri<{ id: string }>().id;
  defter.kategoriIdleri.push(id);
  return { id, slug };
}

export interface VaryantTanimi {
  renk: string;
  renkHex: string;
  beden: string;
  fiyat: number;
  stok: number;
}

/**
 * Ürünü YAYINA kadar götürür.
 *
 * Zincir: satıcı ürünü açar → görsel eklenir → satıcı AI etiketlerini onaylar
 * ve incelemeye gönderir → admin yayına alır. Her adım gerçek uçtan geçiyor;
 * yalnızca görsel veritabanından ekleniyor (bkz. urunGorseliEkle).
 *
 * ⚠️ `aiTagsApproved` ve en az bir görsel olmadan admin onayı 422 döner —
 *    ikisi de decideProduct içinde ayrıca kontrol ediliyor.
 */
export async function urunYayinla(
  saticiIstemcisi: Istemci,
  yoneticiIstemcisi: Istemci,
  girdi: {
    kategoriId: string;
    baslik?: string;
    marka?: string;
    varyantlar?: VaryantTanimi[];
  },
): Promise<Urun> {
  const ek = benzersiz('u').slice(-8);
  const baslik = girdi.baslik ?? `E2E Gömlek ${ek}`;
  const varyantTanimlari: VaryantTanimi[] = girdi.varyantlar ?? [
    { renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 899.9, stok: 10 },
    { renk: 'Siyah', renkHex: '#000000', beden: 'L', fiyat: 899.9, stok: 10 },
  ];

  const olustur = await saticiIstemcisi.post('/v1/seller/products', {
    govde: {
      title: baslik,
      description: 'E2E senaryosu için üretilmiş ürün açıklaması. En az on karakter olmalı.',
      categoryId: girdi.kategoriId,
      brandName: girdi.marka ?? `E2EMarka${ek.slice(-4)}`,
      gender: 'WOMAN',
      variants: varyantTanimlari.map((varyant, sira) => ({
        sku: `E2E-${ek}-${String(sira)}`.toUpperCase(),
        color: varyant.renk,
        colorHex: varyant.renkHex,
        size: varyant.beden,
        // ⚠️ Tutarlar API sınırında STRING taşınır (minorAmountSchema).
        priceMinor: lira(varyant.fiyat).toString(),
        stock: varyant.stok,
        sortOrder: sira,
      })),
    },
  });
  basariBekle(olustur);

  const urun = olustur.veri<{
    id: string;
    slug: string;
    variants: Array<{ id: string; sku: string; color: string; size: string; priceMinor: string }>;
  }>();

  await urunGorseliEkle(urun.id);

  const guncelle = await saticiIstemcisi.patch(`/v1/seller/products/${urun.id}`, {
    govde: { aiTagsApproved: true, status: 'PENDING_REVIEW' },
  });
  basariBekle(guncelle);

  const onay = await yoneticiIstemcisi.post(`/v1/admin/products/${urun.id}/approve`, {});
  basariBekle(onay, 200);

  // ⚠️ Arama vektörü ELLE TAZELENMİYOR: `catalog_products.searchVector` bir
  //    GENERATED ALWAYS kolonu (bkz. 20260811095048 migrasyonu), yazılamaz ve
  //    başlık/marka değiştiği anda Postgres tarafından kendiliğinden güncellenir.

  return {
    productId: urun.id,
    slug: urun.slug,
    baslik,
    varyantlar: urun.variants.map((varyant) => ({
      id: varyant.id,
      sku: varyant.sku,
      renk: varyant.color,
      beden: varyant.size,
      fiyatMinor: BigInt(varyant.priceMinor),
    })),
  };
}

// ── Komisyon ──────────────────────────────────────────────────────────────

/**
 * Satıcıya özel komisyon kuralı tanımlar.
 *
 * ⚠️ ZORUNLU: geçerli bir kural bulunamazsa `checkout/init`
 *    COMMISSION_RULE_NOT_FOUND ile reddeder — varsayılan orana BİLEREK
 *    düşülmüyor (uydurulmuş oranın denetlenebilir kaynağı olmaz).
 *
 * ⚠️ Kural SATICIYA özel açılıyor, platform geneline değil: paralel çalışan
 *    başka bir senaryonun oranını değiştirmek, onun defter iddiasını
 *    sessizce bozardı.
 */
export async function komisyonKuraliTanimla(
  yoneticiIstemcisi: Istemci,
  defter: TemizlikDefteri,
  girdi: { sellerId: string; oranBps: number; sabitUcretMinor?: bigint },
): Promise<{ id: string; oranBps: number; sabitUcretMinor: bigint }> {
  const sabitUcret = girdi.sabitUcretMinor ?? 0n;

  const yanit = await yoneticiIstemcisi.post('/v1/admin/commission-rules', {
    govde: {
      sellerId: girdi.sellerId,
      label: `E2E kural ${String(girdi.oranBps)}bps`,
      rateBps: girdi.oranBps,
      fixedFeeMinor: sabitUcret.toString(),
    },
  });
  basariBekle(yanit);

  const kural = yanit.veri<{ id: string }>();
  defter.komisyonKuraliIdleri.push(kural.id);

  return { id: kural.id, oranBps: girdi.oranBps, sabitUcretMinor: sabitUcret };
}

// ── Sepet & sipariş ───────────────────────────────────────────────────────

/** Sepete kalem ekler ve sepet görünümünü döndürür. */
export async function sepeteEkle(
  istemci: Istemci,
  variantId: string,
  adet = 1,
): Promise<Record<string, unknown>> {
  const yanit = await istemci.post('/v1/cart/items', {
    govde: { variantId, quantity: adet },
  });
  basariBekle(yanit, 200);
  return yanit.veri<Record<string, unknown>>();
}

/** checkout/init için geçerli bir teslimat adresi gövdesi. */
export function adresGovdesi(): Record<string, unknown> {
  return {
    title: 'Ev',
    firstName: 'Test',
    lastName: 'Kullanici',
    phone: telefonUret(),
    city: 'İstanbul',
    district: 'Kadıköy',
    line1: 'E2E Mahallesi, Test Sokak No 1 Daire 2',
    postalCode: '34710',
  };
}

export interface SiparisSonucu {
  orderId: string;
  orderNumber: string;
  grandTotalMinor: bigint;
  itemsTotalMinor: bigint;
  shippingTotalMinor: bigint;
  discountMinor: bigint;
  paketler: Array<{ sellerId: string; itemsTotalMinor: bigint; shippingMinor: bigint }>;
}

/** Sepeti siparişe çevirir (stok REZERVE edilir, ödeme YAPILMAZ). */
export async function checkoutBaslat(
  istemci: Istemci,
  defter: TemizlikDefteri,
  secenekler: { eposta?: string; fiyatDegisimiKabul?: boolean } = {},
): Promise<SiparisSonucu> {
  const yanit = await istemci.post('/v1/checkout/init', {
    govde: {
      shipping: { address: adresGovdesi() },
      email: secenekler.eposta ?? `${benzersiz('alici')}@e2e.test`,
      acceptPriceChange: secenekler.fiyatDegisimiKabul ?? false,
    },
    idempotencyKey: randomUUID(),
  });
  basariBekle(yanit);

  const veri = yanit.veri<{
    orderId: string;
    orderNumber: string;
    grandTotalMinor: string;
    itemsTotalMinor: string;
    shippingTotalMinor: string;
    discountMinor: string;
    packages: Array<{ sellerId: string; itemsTotalMinor: string; shippingMinor: string }>;
  }>();

  defter.siparisIdleri.push(veri.orderId);

  return {
    orderId: veri.orderId,
    orderNumber: veri.orderNumber,
    grandTotalMinor: BigInt(veri.grandTotalMinor),
    itemsTotalMinor: BigInt(veri.itemsTotalMinor),
    shippingTotalMinor: BigInt(veri.shippingTotalMinor),
    discountMinor: BigInt(veri.discountMinor),
    paketler: veri.packages.map((paket) => ({
      sellerId: paket.sellerId,
      itemsTotalMinor: BigInt(paket.itemsTotalMinor),
      shippingMinor: BigInt(paket.shippingMinor),
    })),
  };
}

/**
 * Siparişi PAID durumuna götürür — GERÇEK ödeme zinciriyle.
 *
 * `checkout/pay` → sahte sağlayıcı `initialize` → `payments/3ds/callback`
 * → sunucunun `complete3ds` çağrısı → `confirmPaid`.
 *
 * ⚠️ Defter satırları, stok düşümü ve sipariş durumu ÜRETİM KODU tarafından
 *    yazılır; test hiçbirini elle yazmaz. Yazsaydı, doğrulaması gereken
 *    mantığı testin içinde tekrar üretmiş olur ve hiçbir şey kanıtlamazdı.
 */
export async function odemeyiTamamla(
  istemci: Istemci,
  sahteIyzico: {
    odemeBaglamiBul: (orderId: string) => { conversationId: string; paymentId: string } | null;
  },
  siparis: { orderId: string },
  secenekler: { misafirEpostasi?: string } = {},
): Promise<void> {
  const ode = await istemci.post('/v1/checkout/pay', {
    govde: {
      orderId: siparis.orderId,
      installment: 1,
      ...(secenekler.misafirEpostasi === undefined ? {} : { email: secenekler.misafirEpostasi }),
    },
    idempotencyKey: randomUUID(),
  });
  basariBekle(ode);

  const baglam = sahteIyzico.odemeBaglamiBul(siparis.orderId);
  expect(
    baglam,
    'Sahte sağlayıcıya 3DS başlatma isteği ulaşmadı — API IYZICO_BASE_URL değerini sahte sunucuya çeviriyor mu?',
  ).not.toBeNull();
  if (baglam === null) return;

  const geriDonus = await istemci.post('/v1/payments/3ds/callback', {
    govde: {
      conversationId: baglam.conversationId,
      paymentId: baglam.paymentId,
      // ⚠️ mdStatus '1' dışındaki HER değer başarısızlıktır (checkout.service).
      mdStatus: '1',
      status: 'success',
    },
  });
  basariBekle(geriDonus, 200);

  const sonuc = geriDonus.veri<{ status: string }>();
  expect(sonuc.status, `3DS geri dönüşü PAID beklenirken ${sonuc.status} döndü`).toBe('PAID');
}
