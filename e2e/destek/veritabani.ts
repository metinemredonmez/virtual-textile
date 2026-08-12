/**
 * VERİTABANI KAÇIŞ KAPISI
 *
 * ═══════════════════ KULLANIM KURALI ═══════════════════════════════════════
 *
 * ⚠️ Buradaki her fonksiyon bir BORÇTUR. Kural: bir işin HTTP karşılığı varsa
 *    test onu HTTP üzerinden yapar. Buraya yalnızca API'si OLMAYAN işler
 *    girer ve her biri NEDEN API'si olmadığını yazar. Aksi hâlde test,
 *    doğrulaması gereken iş kurallarını atlayarak veriyi kendi kurar ve
 *    yeşil yanan ama hiçbir şey kanıtlamayan bir takım hâline gelir.
 *
 * ⚠️ İDDİALAR ASLA BURADAN OKUNMAZ. Doğrulama her zaman API yanıtı üzerinden
 *    yapılır. Veritabanını hem yazıp hem okuyan bir test, uçların o veriyi
 *    doğru sunup sunmadığını göremez.
 *
 * ⚠️ Temizlik burada, çünkü silme uçları yok (ürün arşivlenir, sipariş
 *    silinmez — bilinçli tasarım). Senaryolar kendi ürettiklerini kayıt
 *    altına alır ve sonunda ters bağımlılık sırasıyla siler.
 */
import { PrismaClient, type Prisma } from '@vt/db';
// ⚠️ Adlandırılmış `Redis` içe aktarımı — varsayılan (`import Redis from`) DEĞİL.
//    Bu paket NodeNext/ESM; ioredis ise ESM biçimli tip dosyası olan bir CJS
//    paketi. Varsayılan içe aktarım o birleşimde SINIF değil ad alanı çözer ve
//    `tsc` "Cannot use namespace 'Redis' as a type" der. Çalışma zamanında
//    ikisi de çalıştığı için hata yalnızca tip kontrolünde görünür.
import { Redis } from 'ioredis';
import { AYARLAR } from './ortam.js';

let istemci: PrismaClient | null = null;

export function db(): PrismaClient {
  istemci ??= new PrismaClient({ datasources: { db: { url: AYARLAR.veritabaniUrl } } });
  return istemci;
}

export async function baglantiyiKapat(): Promise<void> {
  if (istemci !== null) {
    await istemci.$disconnect();
    istemci = null;
  }
  if (redis !== null) {
    redis.disconnect();
    redis = null;
  }
}

// ── Rol ───────────────────────────────────────────────────────────────────

/**
 * Kullanıcı rolünü yükseltir.
 *
 * NEDEN API YOK: `POST /v1/auth/register` her kullanıcıyı CUSTOMER olarak
 * açar ve rolü değiştiren HİÇBİR uç yok. Yönetici hesabı, sistemin kendi
 * arayüzünden yaratılamaz — ilk yönetici bir şekilde veritabanına elle
 * konmak zorunda.
 *
 * ⚠️ SELLER_USER için bu bir GEÇİCİ ÇÖZÜM DEĞİL, ÖRTÜLEN BİR HATADIR:
 *    kod tabanında `role = 'SELLER_USER'` ataması hiç yok, dolayısıyla
 *    onaylanmış bir satıcı satıcı paneline giremiyor. Buna adanmış iddia
 *    `senaryolar/yetki.spec.ts` içinde ve BİLEREK kırmızı yanacak. Burada
 *    rolü elle vermemizin tek sebebi, o tek hatanın diğer sekiz senaryoyu
 *    da düşürüp gerçek kapsamı gizlemesini engellemek.
 */
export async function rolAta(
  userId: string,
  rol: 'CUSTOMER' | 'SELLER_USER' | 'SUPPORT' | 'ADMIN',
): Promise<void> {
  await db().user.update({ where: { id: userId }, data: { role: rol } });
}

// ── Satıcı ────────────────────────────────────────────────────────────────

/**
 * Alt üye işyeri (submerchant) anahtarını bağlar.
 *
 * NEDEN API YOK: admin onayı bunu BİLEREK oluşturmuyor — dış servis çağrısı
 * transaction içinde yapılamaz, işi onay olayını dinleyen finans işçisine
 * bırakılmış (admin-seller.service.ts). O işçi henüz yazılmadı.
 *
 * Anahtar olmadan `checkout/init` SELLER_NOT_APPROVED ile reddeder; yani bu
 * satır olmadan HİÇBİR sipariş oluşturulamaz.
 */
export async function altUyeIsyeriBagla(sellerId: string): Promise<string> {
  const anahtar = `e2e-submerchant-${sellerId.slice(0, 8)}`;
  await db().seller.update({ where: { id: sellerId }, data: { submerchantKey: anahtar } });
  return anahtar;
}

// ── Katalog ───────────────────────────────────────────────────────────────

/**
 * Ürüne görsel ekler.
 *
 * NEDEN API YOK: `POST /v1/seller/products/:id/images` imzalı bir R2 yükleme
 * adresi üretir; testin gerçek nesne depolamasına dosya yüklemesi gerekirdi.
 * Uçtan uca testin bir CDN'e yazması, testi ağa ve kotaya bağımlı kılar.
 *
 * Görsel ZORUNLU: admin, görselsiz ürünü yayına alamıyor (decideProduct).
 */
export async function urunGorseliEkle(productId: string): Promise<string> {
  const gorsel = await db().productImage.create({
    data: {
      productId,
      storageKey: `e2e/urun/${productId}.jpg`,
      angle: 'FRONT',
      isPrimary: true,
      widthPx: 1200,
      heightPx: 1600,
      sortOrder: 0,
    },
    select: { id: true },
  });
  return gorsel.id;
}

// ── Sipariş ───────────────────────────────────────────────────────────────

/**
 * ⚠️ `paketiTeslimEt` BU DOSYADAN ÇIKTI — borç kapandı.
 *
 *    Teslim adımı buradaydı çünkü DELIVERED'a taşıyan hiçbir uç yoktu; artık
 *    var: `POST /v1/logistics/packages/:id/delivered` (ADMIN). Yeni yeri
 *    `kurulum.ts` — HTTP'den geçen bir adım kaçış kapısı listesinde durmamalı.
 *
 *    Bu fark önemsiz değildi: doğrudan yazma `OutboxEvent` yazmıyor, yani E2E
 *    "teslim" adımı geçerken üretimde `package.delivered` olayı HİÇ doğmuyordu
 *    ve testler bunu göremiyordu.
 */

/** Rezervasyonun süresini geçmişe çeker — "rezervasyon düştü" senaryosu için. */
export async function rezervasyonuGecmiseAl(orderId: string): Promise<void> {
  await db().order.update({
    where: { id: orderId },
    data: { reservationExpiresAt: new Date(Date.now() - 60_000) },
  });
}

// ── KVKK ──────────────────────────────────────────────────────────────────

/**
 * Rıza kaydı yazar.
 *
 * NEDEN API YOK: `ConsentRecord` yazan HİÇBİR uç yok. Kayıt sırasında da
 * alınmıyor (registerSchema yalnızca `acceptedTerms` ve `marketingConsent`
 * taşıyor, ikisi de ConsentRecord'a dönüşmüyor). Yani bugün sanal denemeyi
 * kullanabilecek TEK bir kullanıcı bile yaratılamaz — kvkk.spec bu boşluğu
 * ayrıca iddia ediyor.
 *
 * ⚠️ Tablo APPEND-ONLY: geri çekme, satır güncelleyerek değil `granted=false`
 *    olan YENİ satır yazarak yapılır (consent.rules.ts).
 */
export async function rizaYaz(
  userId: string,
  tur:
    'PHOTO_PROCESSING' | 'CROSS_BORDER_TRANSFER' | 'PHOTO_STORAGE' | 'MODEL_TRAINING' | 'MARKETING',
  verildi: boolean,
): Promise<void> {
  await db().consentRecord.create({
    data: {
      userId,
      type: tur,
      granted: verildi,
      documentVersion: 'e2e-v1',
      ipAddress: '127.0.0.1',
      userAgent: 'e2e',
    },
  });
}

/**
 * Kullanıcı fotoğrafı kaydı açar.
 *
 * NEDEN API YOK: `POST /v1/me/photos` imzalı R2 adresi üretir, `confirm` ise
 * nesnenin depoda GERÇEKTEN var olmasını bekler. Silme ucunun test edilmesi
 * için önce silinecek bir satır gerekiyor.
 */
export async function kullaniciFotografiEkle(userId: string): Promise<string> {
  const foto = await db().userPhoto.create({
    data: {
      userId,
      storageKey: `e2e/foto/${userId}-${Date.now().toString()}.jpg`,
      purpose: 'SAVED_PROFILE',
      qualityScore: 90,
      contentHash: `e2e${Math.random().toString(36).slice(2, 12)}`,
      widthPx: 1080,
      heightPx: 1920,
      sizeBytes: 512_000,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  return foto.id;
}

/** Fotoğraf gerçekten silindi mi — silme ucunun iddiası için. */
export async function fotografDurumu(
  photoId: string,
): Promise<{ varMi: boolean; silinmeZamani: Date | null }> {
  const foto = await db().userPhoto.findUnique({
    where: { id: photoId },
    select: { deletedAt: true },
  });
  return { varMi: foto !== null, silinmeZamani: foto?.deletedAt ?? null };
}

// ── Hız limiti ────────────────────────────────────────────────────────────

let redis: Redis | null = null;

function redisIstemcisi(): Redis {
  redis ??= new Redis(AYARLAR.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
  return redis;
}

/**
 * Hız limiti sayaçlarını temizler.
 *
 * NEDEN GEREKLİ: kayıt limiti IP başına SAATTE 3 (RATE_LIMITS.register).
 * Tüm testler 127.0.0.1'den geldiği için, sayaç sıfırlanmazsa üçüncü
 * kullanıcıdan sonra bütün takım 429 alır ve "testler kendi verisini
 * oluşturmalı" şartı yerine getirilemez.
 *
 * ⚠️ Yalnızca `rl:` önekli anahtarlar siliniyor. FLUSHALL, aynı Redis'i
 *    kullanan kuyrukları ve oturum verisini de silerdi.
 */
export async function hizLimitiSifirla(ad?: string): Promise<void> {
  const desen = ad === undefined ? 'rl:*' : `rl:${ad}*`;
  const musteri = redisIstemcisi();

  // SCAN, KEYS değil: KEYS büyük bir veritabanında Redis'i bloklar ve bu
  // yardımcı her testte çağrılıyor.
  let imlec = '0';
  do {
    const [sonrakiImlec, anahtarlar] = await musteri.scan(imlec, 'MATCH', desen, 'COUNT', 500);
    imlec = sonrakiImlec;
    if (anahtarlar.length > 0) await musteri.del(...anahtarlar);
  } while (imlec !== '0');
}

// ── Temizlik ──────────────────────────────────────────────────────────────

/** Bir senaryonun ürettiği her şeyin kaydı. */
export interface TemizlikDefteri {
  kullaniciIdleri: string[];
  saticiIdleri: string[];
  siparisIdleri: string[];
  kategoriIdleri: string[];
  komisyonKuraliIdleri: string[];
  kuponIdleri: string[];
}

export function yeniDefter(): TemizlikDefteri {
  return {
    kullaniciIdleri: [],
    saticiIdleri: [],
    siparisIdleri: [],
    kategoriIdleri: [],
    komisyonKuraliIdleri: [],
    kuponIdleri: [],
  };
}

/**
 * Senaryonun ürettiği veriyi siler.
 *
 * ⚠️ SIRA ZORUNLU ve şu FK kısıtlarından geliyor:
 *  1. LedgerEntry → OrderItem bağı CASCADE DEĞİL. Önce defter silinmezse
 *     sipariş silinemez.
 *  2. Order → User bağı da CASCADE DEĞİL (sipariş geçmişi bilinçli olarak
 *     kullanıcıdan bağımsız duruyor). Önce sipariş, sonra kullanıcı.
 *  3. Seller silinince ürün, mağaza, üyelik ve kural kayıtları CASCADE ile
 *     gider; ayrıca silmeye gerek yok.
 *
 * Hatalar YUTULMAZ ama testi düşürmez: temizlik başarısızlığı bir ürün
 * hatası değildir, yine de sessiz kalırsa veritabanı zamanla çöplenir.
 */
export async function temizle(defter: TemizlikDefteri): Promise<string[]> {
  const sorunlar: string[] = [];
  const p = db();

  const dene = async (etiket: string, is: () => Promise<unknown>): Promise<void> => {
    try {
      await is();
    } catch (hata: unknown) {
      sorunlar.push(`${etiket}: ${hata instanceof Error ? hata.message : String(hata)}`);
    }
  };

  if (defter.saticiIdleri.length > 0) {
    await dene('defter kayıtları', () =>
      p.ledgerEntry.deleteMany({ where: { sellerId: { in: defter.saticiIdleri } } }),
    );
  }

  if (defter.siparisIdleri.length > 0) {
    await dene('siparişler', () =>
      p.order.deleteMany({ where: { id: { in: defter.siparisIdleri } } }),
    );
  }

  if (defter.kullaniciIdleri.length > 0) {
    // Kullanıcının kalan siparişleri varsa (senaryo kayıt tutmayı unuttuysa)
    // silme FK'ya takılır; önce onları da temizliyoruz.
    await dene('kullanıcı siparişleri', () =>
      p.order.deleteMany({ where: { userId: { in: defter.kullaniciIdleri } } }),
    );
  }

  if (defter.kuponIdleri.length > 0) {
    await dene('kuponlar', () =>
      p.coupon.deleteMany({ where: { id: { in: defter.kuponIdleri } } }),
    );
  }

  if (defter.saticiIdleri.length > 0) {
    await dene('satıcılar', () =>
      p.seller.deleteMany({ where: { id: { in: defter.saticiIdleri } } }),
    );
  }

  if (defter.komisyonKuraliIdleri.length > 0) {
    await dene('komisyon kuralları', () =>
      p.commissionRule.deleteMany({ where: { id: { in: defter.komisyonKuraliIdleri } } }),
    );
  }

  if (defter.kullaniciIdleri.length > 0) {
    await dene('kullanıcılar', () =>
      p.user.deleteMany({ where: { id: { in: defter.kullaniciIdleri } } }),
    );
  }

  if (defter.kategoriIdleri.length > 0) {
    // ⚠️ İKİ AŞAMA: `Category.parentId` kendine referans veriyor ve
    //    `deleteMany` sıra garantisi vermez. Tek çağrıda silinmeye
    //    çalışılsaydı ebeveyn çocuğundan önce sıraya girip FK ihlali
    //    üretebilirdi. Önce çocuklar, sonra kökler.
    await dene('alt kategoriler', () =>
      p.category.deleteMany({
        where: { id: { in: defter.kategoriIdleri }, parentId: { not: null } },
      }),
    );
    await dene('kök kategoriler', () =>
      p.category.deleteMany({ where: { id: { in: defter.kategoriIdleri } } }),
    );
  }

  return sorunlar;
}

/** Prisma tip dışa aktarımı — senaryolarda gerekirse. */
export type { Prisma };
