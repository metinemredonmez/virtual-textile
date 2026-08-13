/**
 * DEMO HESAPLAR — kullanıcı, rol, mağaza üyeliği, adres, rıza, beden profili.
 *
 * ⚠️ BUGÜNKÜ EN KRİTİK KİLİT BURADA AÇILIYOR. Ölçüldü: `seller_users` tablosu
 *    BOŞ ve tek kullanıcı CUSTOMER'dı. `SellerScopeGuard` `request.sellerId`i
 *    `seller_users` üzerinden çözüyor; üyeliği olmayan kullanıcı panele girer
 *    ama HER UÇ 403 döner. Yani satıcı ve yönetim panellerinin TAMAMI
 *    ölçülemez durumdaydı — "derleniyor" ile "çalışıyor" arasındaki farkın
 *    tam olarak görülemediği yer.
 *
 * ⚠️ GÜVENLİK GEREKÇESİ — rol atamak neden yeni bir kapı AÇMIYOR:
 *    1. Seed üretimde hiç çalışmıyor (bkz. kapi.ts, üç bağımsız şart).
 *    2. `packages/db/scripts/rol-ata.ts` ile AYNI kapı; yeni bir yetki yolu
 *       değil, var olanın demo veriye uygulanmış hâli.
 *    3. Veritabanına yazabilen biri zaten `UPDATE user_users SET role='ADMIN'`
 *       yazabilir. Buradaki kod bir ayrıcalık kazandırmıyor, yalnızca
 *       geliştiricinin elindeki yetkiyi okunabilir hâle getiriyor.
 *
 * ⚠️ PAROLA ÖZETİ — `rol-ata.ts` bunu bilinçli olarak YAPMIYOR ve gerekçesi
 *    "argon2 parametreleri + pepper ikinci bir yerde uygulanırsa 'kayıt oluyor
 *    ama giriş yapamıyor' arızası doğar". Gerekçe ciddiye alındı ve ÖLÇÜLDÜ:
 *      · `apps/api/.../password.service.ts` PEPPER KULLANMIYOR — argon2id,
 *        memoryCost 19456, timeCost 2, parallelism 1, başka gizli girdi yok.
 *      · argon2 parametreleri ÖZETİN İÇİNDE kodlu; API parametreleri bir gün
 *        sıkılaştırsa bile `argon2.verify` bu özeti doğrulamaya devam eder ve
 *        `auth.service.ts:137` `needsRehash` ile ilk girişte yükseltir.
 *    Yani parametre sapması burada girişi KIRMIYOR. Buna rağmen iki yerde iki
 *    tanım durması bir borçtur — raporun BÜTÜNLEMEYE bölümünde tek sabite
 *    taşınması öneriliyor. Alternatif (`POST /v1/auth/register` çağırmak)
 *    ELENDİ: `RATE_LIMITS.register` saatte 3 kayıt/IP; dokuz demo hesabın
 *    altısı sessizce açılmadan kalırdı.
 */
import * as argon2 from 'argon2';
import type { PrismaClient } from '../../generated/client/index.js';
import { DEMO_PAROLA, HESAPLAR, type HesapTanimi } from './veri.js';

/** ⚠️ `apps/api/src/modules/auth/password.service.ts` → OPTIONS ile AYNI. */
const ARGON2_SECENEKLERI: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export interface HesapSonucu {
  readonly kullaniciId: ReadonlyMap<string, string>;
  readonly parolaAtlanan: readonly string[];
}

export async function hesaplariYaz(
  prisma: PrismaClient,
  saticiId: ReadonlyMap<string, string>,
): Promise<HesapSonucu> {
  const kullaniciId = new Map<string, string>();
  const parolaAtlanan: string[] = [];

  // ⚠️ Özet BİR KEZ hesaplanır. argon2 bilerek yavaş (19 MiB, 2 tur); dokuz
  //    hesap için dokuz kez çağırmak seed'e birkaç saniye ekler ve hiçbir şey
  //    kazandırmaz — parolalar zaten aynı.
  const parolaOzeti = await argon2.hash(DEMO_PAROLA, ARGON2_SECENEKLERI);

  for (const hesap of HESAPLAR) {
    const varOlan = await prisma.user.findUnique({
      where: { email: hesap.eposta },
      select: { id: true, passwordHash: true },
    });

    /*
     * ⚠️ VAR OLAN BİR HESABIN PAROLASI EZİLMEZ. Bu veritabanında e2e koşuları
     *    ve elle açılmış hesaplar var; seed'in birinin parolasını sessizce
     *    değiştirmesi "dün giriyordum, bugün giremiyorum" arızasıdır. Yalnızca
     *    parolası HİÇ olmayan (seed'in kendi açtığı) hesaplara yazılır.
     */
    const parolaYaz = !varOlan || varOlan.passwordHash === null;
    if (varOlan && varOlan.passwordHash !== null) parolaAtlanan.push(hesap.eposta);

    const kullanici = await prisma.user.upsert({
      where: { email: hesap.eposta },
      update: {
        firstName: hesap.ad,
        lastName: hesap.soyad,
        phone: hesap.telefon,
        role: hesap.rol,
        status: 'ACTIVE',
        emailVerifiedAt: new Date('2026-02-10T08:00:00Z'),
        ...(parolaYaz ? { passwordHash: parolaOzeti } : {}),
      },
      create: {
        email: hesap.eposta,
        phone: hesap.telefon,
        firstName: hesap.ad,
        lastName: hesap.soyad,
        role: hesap.rol,
        passwordHash: parolaOzeti,
        emailVerifiedAt: new Date('2026-02-10T08:00:00Z'),
        locale: 'tr-TR',
      },
      select: { id: true },
    });

    kullaniciId.set(hesap.eposta, kullanici.id);

    await rizalariYaz(prisma, kullanici.id);
    await adresYaz(prisma, kullanici.id, hesap);

    if (hesap.rol === 'CUSTOMER') await bedenProfiliYaz(prisma, kullanici.id, hesap);

    if (hesap.rol === 'SELLER_USER' && hesap.saticiSlug) {
      const sellerId = saticiId.get(hesap.saticiSlug);
      if (!sellerId) throw new Error(`Satıcı üyeliği çözülemedi: ${hesap.saticiSlug}`);
      await prisma.sellerUser.upsert({
        where: { sellerId_userId: { sellerId, userId: kullanici.id } },
        update: { storeRole: hesap.magazaRolu ?? 'staff' },
        create: { sellerId, userId: kullanici.id, storeRole: hesap.magazaRolu ?? 'staff' },
      });
    }
  }

  return { kullaniciId, parolaAtlanan };
}

/**
 * ⚠️ `ConsentRecord` APPEND-ONLY. Var olan kayıt güncellenmez; yoksa bir kez
 *    yazılır. Her koşuda yeni satır yazmak "rıza geçmişi"ni anlamsız kılardı.
 *
 * ⚠️ MODEL_TRAINING varsayılan olarak KAPALI. Açık gelen bir demo veri,
 *    ekranı okuyan kişiye yanlış varsayılanı öğretir.
 */
async function rizalariYaz(prisma: PrismaClient, userId: string): Promise<void> {
  const rizalar = [
    { type: 'PHOTO_PROCESSING', granted: true },
    { type: 'CROSS_BORDER_TRANSFER', granted: true },
    { type: 'PHOTO_STORAGE', granted: true },
    { type: 'MODEL_TRAINING', granted: false },
  ] as const;

  for (const riza of rizalar) {
    const varOlan = await prisma.consentRecord.findFirst({
      where: { userId, type: riza.type },
    });
    if (varOlan) continue;
    await prisma.consentRecord.create({
      data: {
        userId,
        type: riza.type,
        granted: riza.granted,
        documentVersion: 'v1.0',
        ipAddress: '127.0.0.1',
        userAgent: 'seed',
      },
    });
  }
}

const SEHIRLER = [
  {
    city: 'İstanbul',
    district: 'Kadıköy',
    line1: 'Demo Mahallesi, Örnek Sokak No: 1 Daire 2',
    postalCode: '34710',
  },
  {
    city: 'İzmir',
    district: 'Karşıyaka',
    line1: 'Bostanlı Mahallesi, Deneme Caddesi No: 12',
    postalCode: '35590',
  },
  {
    city: 'Ankara',
    district: 'Çankaya',
    line1: 'Kızılay Mahallesi, Test Sokak No: 8 Kat 3',
    postalCode: '06420',
  },
  {
    city: 'Bursa',
    district: 'Nilüfer',
    line1: 'Görükle Mahallesi, Numune Sokak No: 5',
    postalCode: '16285',
  },
];

async function adresYaz(prisma: PrismaClient, userId: string, hesap: HesapTanimi): Promise<void> {
  const sira = HESAPLAR.findIndex((h) => h.eposta === hesap.eposta);
  const adres = SEHIRLER[sira % SEHIRLER.length];
  if (!adres) return;

  const varOlan = await prisma.address.findFirst({ where: { userId, title: 'Ev' } });
  const govde = {
    title: 'Ev',
    firstName: hesap.ad,
    lastName: hesap.soyad,
    phone: hesap.telefon,
    city: adres.city,
    district: adres.district,
    line1: adres.line1,
    postalCode: adres.postalCode,
    isDefault: true,
  };

  if (varOlan) await prisma.address.update({ where: { id: varOlan.id }, data: govde });
  else await prisma.address.create({ data: { userId, ...govde } });
}

const OLCULER = [
  {
    heightCm: 168,
    weightKg: 60,
    chestCm: 90,
    waistCm: 72,
    hipCm: 96,
    usualSize: 'M',
    fitPref: 'REGULAR',
  },
  {
    heightCm: 174,
    weightKg: 66,
    chestCm: 94,
    waistCm: 76,
    hipCm: 100,
    usualSize: 'L',
    fitPref: 'OVERSIZE',
  },
  {
    heightCm: 161,
    weightKg: 54,
    chestCm: 84,
    waistCm: 66,
    hipCm: 90,
    usualSize: 'S',
    fitPref: 'SLIM',
  },
  {
    heightCm: 180,
    weightKg: 78,
    chestCm: 102,
    waistCm: 88,
    hipCm: 104,
    usualSize: 'XL',
    fitPref: 'REGULAR',
  },
] as const;

async function bedenProfiliYaz(
  prisma: PrismaClient,
  userId: string,
  hesap: HesapTanimi,
): Promise<void> {
  const sira = HESAPLAR.findIndex((h) => h.eposta === hesap.eposta);
  const olcu = OLCULER[sira % OLCULER.length];
  if (!olcu) return;
  await prisma.bodyProfile.upsert({
    where: { userId },
    update: olcu,
    create: { userId, ...olcu },
  });
}
