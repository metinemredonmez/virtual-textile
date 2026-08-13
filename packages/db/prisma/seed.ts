/**
 * KAPSAMLI DEMO VERİ.
 *
 * Amaç "ekranda bir şey görünsün" değil: vitrini, filtreleri, arama fasetlerini,
 * satıcı panelini ve yönetim panelini GERÇEKTEN dolduran, komisyon
 * versiyonlamayı ve append-only ledger'ı çalışır hâlde gösteren bir veri seti
 * üretmek — ve ürettiğini GERİ OKUYUP doğrulamak.
 *
 * Çalıştır:
 *   pnpm db:seed                       (kök .env'i kendisi yükler)
 *   pnpm --filter @vt/db seed:varlik   (yer tutucu görselleri yeniden üretir)
 *
 * ═══ İKİ DEĞİŞMEZ ═══
 *
 * 1. İDEMPOTENT — ve bu bir NÖBETÇİ BAYRAĞINA DEĞİL, YAZIM BİÇİMİNE dayanır.
 *    Eski seed tek bir satıra bakıyordu (`store.findUnique({slug:'atolye-nord'})`)
 *    ve o bir TUZAKTI: mağaza satırı dururken ürün/sipariş tabloları boşaltılıp
 *    seed tekrar koşulduğunda "Demo veri zaten yüklü" basıp `products 0 ·
 *    orders 0` bırakıyordu. Bu seed erken çıkmaz; her yazım doğal bir anahtar
 *    üzerinden upsert ya da "yoksa yaz" biçiminde yapılır. Sonucu: yarım kalmış
 *    bir koşu ikinci koşuda KENDİNİ ONARIR.
 *
 * 2. HİÇBİR VERİ SİLİNMEZ. Ledger append-only; bir kez `wipe` yapan bir seed
 *    finansal geçmişi geri alınamaz biçimde bozardı. Bu depoda var olan e2e
 *    kalıntıları da silinmez — seed onların yanına yazar.
 */
import { join } from 'node:path';
import { PrismaClient } from '../generated/client/index.js';
import { denetimYaz } from './seed/denetim.js';
import {
  adresleriDogrula,
  girisiDogrula,
  gorselleriDogrula,
  sayimlariOku,
  vitrinKirliligi,
} from './seed/dogrula.js';
import { depolamaKur } from './seed/gorsel.js';
import { hesaplariYaz } from './seed/hesap.js';
import { ortamKapisi } from './seed/kapi.js';
import { katalogYaz } from './seed/katalog.js';
import { musteriYaz } from './seed/musteri.js';
import { kurusYaz } from './seed/para.js';
import { ticaretYaz } from './seed/ticaret.js';
import { DEMO_PAROLA, HESAPLAR, URUNLER } from './seed/veri.js';

const prisma = new PrismaClient();

/** Seed'in tamamlandığını işaretleyen kayıt — `/admin/audit` ekranında görünür. */
const SEED_SURUMU = 'seed:v2';

const WEB_KOKU = join(__dirname, '..', '..', '..', 'apps', 'web');

async function main(): Promise<void> {
  const ortam = ortamKapisi();

  console.log('🌱 Kapsamlı demo veri yükleniyor...');
  console.log(
    `   ortam: NODE_ENV=${ortam.nodeEnv} · db=${ortam.veritabaniHost} · app=${ortam.appUrl ?? '(yok)'}\n`,
  );

  const storage = depolamaKur();
  if (!storage) {
    console.warn(
      '⚠️  DEPOLAMA YAPILANDIRILMAMIŞ (R2_ENDPOINT/ACCESS_KEY/SECRET boş).\n' +
        '    Görseller YÜKLENMEYECEK; veritabanı satırları yine yazılacak.\n' +
        "    Bu dal CI'da beklenen daldır. Yerelde görüyorsanız kök .env eksiktir.\n",
    );
  }

  // ── 1. Katalog ──────────────────────────────────────────────────────────
  const katalog = await katalogYaz(prisma, storage);
  console.log(
    `  ✓ katalog: ${katalog.kategoriId.size} kategori · ${katalog.saticiId.size} satıcı · ` +
      `${katalog.urunId.size} ürün · ${katalog.varyantSayisi} varyant`,
  );
  console.log(
    `  ✓ görsel: ${katalog.yuklenenGorsel} yüklendi · ${katalog.atlananGorsel} atlandı ` +
      `(${katalog.depolamaAnahtarlari.length} anahtar)`,
  );

  // ── 2. Hesaplar ─────────────────────────────────────────────────────────
  const hesap = await hesaplariYaz(prisma, katalog.saticiId);
  console.log(`  ✓ hesap: ${hesap.kullaniciId.size} kullanıcı (rol + mağaza üyeliği ile)`);
  if (hesap.parolaAtlanan.length > 0) {
    console.log(
      `    ↳ ${hesap.parolaAtlanan.length} hesabın parolası KORUNDU (zaten vardı): ${hesap.parolaAtlanan.join(', ')}`,
    );
  }

  // ── 3. Ticaret ──────────────────────────────────────────────────────────
  const ticaret = await ticaretYaz(prisma, {
    kullaniciId: hesap.kullaniciId,
    saticiId: katalog.saticiId,
    komisyon: katalog.komisyon,
  });
  console.log(
    `  ✓ ticaret: ${ticaret.siparisSayisi} sipariş · ${ticaret.paketSayisi} paket · ` +
      `${ticaret.kalemSayisi} kalem · ${ticaret.iadeSayisi} iade · ${ticaret.payoutSayisi} payout`,
  );

  // ── 4. Müşteri etkileşimi ───────────────────────────────────────────────
  const musteri = await musteriYaz(prisma, hesap.kullaniciId, katalog.urunId);
  console.log(
    `  ✓ müşteri: ${musteri.yorumSayisi} yorum · ${musteri.favoriSayisi} favori · ` +
      `${musteri.sepetKalemi} sepet kalemi · ${musteri.gardiropSayisi} gardırop parçası`,
  );

  // ── 5. Denetim / AI / arama ─────────────────────────────────────────────
  const denetim = await denetimYaz(prisma, {
    kullaniciId: hesap.kullaniciId,
    saticiId: katalog.saticiId,
    urunId: katalog.urunId,
  });
  console.log(
    `  ✓ denetim: ${denetim.denetimSayisi} yeni denetim kaydı · ${denetim.aiKayitSayisi} AI kaydı · ` +
      `${denetim.esAnlamliSayisi} eş anlamlı`,
  );

  // ── 6. Satıcı bakiyeleri — LEDGER'DAN hesaplanır ────────────────────────
  console.log('\n📊 Satıcı bakiyeleri (SUM(amount_minor), ayrı kolon YOK):');
  for (const [slug, bakiye] of ticaret.bakiye) {
    console.log(`   ${slug.padEnd(20)} ${kurusYaz(bakiye).padStart(16)}`);
  }

  // ── 7. DOĞRULAMA ────────────────────────────────────────────────────────
  console.log('\n🔎 Doğrulama:');

  const adresler = [
    '/',
    '/products',
    '/category',
    '/collection',
    '/collection/denim',
    '/cart',
    '/account/orders',
    '/seller',
    '/admin',
    ...URUNLER.filter((u) => u.durum === 'PUBLISHED')
      .slice(0, 2)
      .map((u) => `/product/${u.slug}`),
  ];

  const bulgular = [
    ...(await gorselleriDogrula(storage, katalog.depolamaAnahtarlari)),
    ...(await vitrinKirliligi(prisma)),
    ...adresleriDogrula(WEB_KOKU, adresler),
    // ⚠️ `prisma` GEÇİLİR: doğrulama, API'nin seed'in yazdığı veritabanına
    //    baktığını KARŞILAŞTIRMADAN "giriş doğrulandı" diyemez (gerekçe
    //    `dogrula.ts` → `girisiDogrula` başlığında, ölçümüyle birlikte).
    ...(await girisiDogrula(prisma, process.env['API_URL'] ?? 'http://localhost:3001')),
  ];

  for (const bulgu of bulgular) {
    const isaret = bulgu.seviye === 'hata' ? '✗' : bulgu.seviye === 'uyari' ? '⚠️ ' : '✓';
    console.log(`   ${isaret} ${bulgu.mesaj}`);
  }

  const hata = bulgular.filter((b) => b.seviye === 'hata');
  if (hata.length > 0) {
    throw new Error(`Doğrulama ${hata.length} hata ile bitti — demo veri KULLANILAMAZ.`);
  }

  // ⚠️ İşaret SAYIMDAN ÖNCE yazılır ki basılan `seed.completed` sayısı BU koşuyu
  //    da içersin; sonra yazılsaydı rapor her zaman bir eksik koşu gösterirdi.
  await tamamlanmaIsaretiYaz();

  // ── 8. Sayımlar — SABİT YAZILMAZ, veritabanından okunur ─────────────────
  console.log('\n📋 Veritabanı sayımları (geri okundu):');
  for (const sayim of await sayimlariOku(prisma)) {
    console.log(`   ${sayim.etiket.padEnd(26)} ${String(sayim.adet).padStart(5)}`);
  }

  console.log('\n✅ Demo veri hazır.\n');
  console.log(`   Parola (tüm demo hesaplar): ${DEMO_PAROLA}`);
  for (const h of HESAPLAR) {
    console.log(`   ${h.rol.padEnd(12)} ${h.eposta}`);
  }
  console.log('\n   Ekranlar:');
  for (const adres of adresler) console.log(`   · ${adres}`);
  console.log('');
}

/**
 * ⚠️ TAMAMLANMA İŞARETİ BİR NÖBETÇİ DEĞİL, BİR KAYITTIR.
 *
 * Erken çıkış için KULLANILMAZ; "son tam koşu ne zaman bitti" sorusuna cevap
 * verir ve `/admin/audit` ekranında bir satır olarak görünür. İşaretin nöbetçi
 * olarak kullanılması eski seed'in tuzağıydı: işaret duruyor diye atlanan bir
 * koşu, yarım kalmış veritabanını yarım bırakır.
 */
async function tamamlanmaIsaretiYaz(): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: 'seed',
      actorRole: 'ADMIN',
      action: 'seed.completed',
      entityType: 'Seed',
      entityId: SEED_SURUMU,
      after: { surum: SEED_SURUMU, urun: URUNLER.length },
      ipAddress: '127.0.0.1',
    },
  });
}

main()
  .catch((hata: unknown) => {
    console.error('\n❌ Seed başarısız:', hata instanceof Error ? hata.message : hata);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
