/**
 * ═══════════════ VİTRİN SEED — PARAYA DOKUNMAYAN DEMO VERİSİ ═══════════════
 *
 * Tam seed (`seed.ts`) uzak veritabanında BİLEREK çalışmıyor ve o karar
 * DOĞRUDUR: `seed/kapi.ts` gerekçesini yazıyor — tam seed
 * `finance_ledger_entries`e SALE/COMMISSION satırları yazar, ledger
 * APPEND-ONLY'dir ve bir kez koşarsa sahte finansal kayıtlar GERİ ALINAMAZ.
 * Aynı dosya "demo modu bayrağı da eklenmez" diyor, çünkü o bayrak bir gün
 * "sadece bir kez, canlıyı göstermek için" diye kullanılırdı.
 *
 * ⚠️ BU DOSYA O KARARI ZAYIFLATMAZ — KAPSAMI DARALTIR.
 *
 *    İtiraz FİNANSAL KAYITLARA aitti. Ölçüldü: ledger ve payout'a yazan tek
 *    modül `seed/ticaret.ts`. Bu giriş noktası onu HİÇ ÇAĞIRMAZ; çağıramaz da,
 *    içe bile aktarılmamıştır. Yani "yanlışlıkla açılabilecek bir bayrak"
 *    değil, ticaret kodunun ULAŞILAMAZ olduğu ayrı bir yol.
 *
 *    Yazdıkları (ölçüldü, `grep prisma\.[a-z]+\.(create|upsert)`):
 *      katalog  → category · seller · product · variant · inventory ·
 *                 productImage · priceHistory · commissionRule(+Version) ·
 *                 sellerDocument
 *      hesap    → user (rol ve mağaza üyeliğiyle)
 *      müşteri  → cart · cartItem · favorite · review · digitalWardrobeItem
 *
 *    YAZMADIKLARI: ledger · sipariş · paket · iade · payout · ödeme.
 *
 * ⚠️ NEDEN GEREKLİ: canlı vitrinde 3 ürün ve 1 kök kategori vardı; seed oraya
 *    hiç gitmemişti. Ekranlar doğru çiziliyordu ama gösterecek şeyleri yoktu.
 *    Ayrıca `Favorite` ve `Review` tabloları AI tarafından OKUNUYOR
 *    (`stylist.gateway.ts` favorileri, `ai.gateway.ts` + `fit-learning.gateway.ts`
 *    yorumları) — boş kaldıklarında stil önerisi ve beden motoru sinyalsiz
 *    çalışıyordu.
 *
 * ⚠️ KABUL EDİLEN BEDEL, AÇIKÇA: demo satıcılarının `ibanEnc` değeri
 *    `demo:not-encrypted`. Bu satıcılar için payout akışı çözme aşamasında
 *    PATLAR. Staging'de kabul edilebilir çünkü gerçek para yok; ÜRETİMDE
 *    kabul edilemez ve aşağıdaki kapı bu yüzden `NODE_ENV=production`u
 *    koşulsuz reddeder.
 *
 * Kullanım (sunucuda):
 *   cd /var/www/virtual/packages/db
 *   DATABASE_URL="..." VT_VITRIN_ONAY=evet pnpm exec tsx prisma/seed-vitrin.ts
 */
import { PrismaClient } from '../generated/client/index.js';
import { hesaplariYaz } from './seed/hesap.js';
import { katalogYaz } from './seed/katalog.js';
import { musteriYaz } from './seed/musteri.js';
import { depolamaKur } from './seed/gorsel.js';

/**
 * KAPI — tam seed'inkinden DAR ama daha az değil.
 *
 * ⚠️ İki şart birden. `NODE_ENV=production` KOŞULSUZ ret: onay değişkeni bile
 *    geçemez, çünkü üretimde sahte satıcı ve `demo:not-encrypted` IBAN'ın
 *    doğru olduğu bir senaryo yoktur.
 *
 * ⚠️ Uzak veritabanı için AÇIK ONAY istenir. Değişkenin adı uzun ve değeri
 *    Türkçe: sekme tamamlamayla ya da alışkanlıkla yazılmaz, bilerek yazılır.
 */
function vitrinKapisi(): { uzak: boolean; host: string } {
  const nodeEnv = process.env['NODE_ENV'] ?? '(tanımsız)';
  if (nodeEnv === 'production') {
    throw new Error(
      'Vitrin seed üretim ortamında çalıştırılamaz (NODE_ENV=production). ' +
        'Demo satıcıların IBAN alanı şifrelenmemiş yer tutucudur ve payout akışını kırar.',
    );
  }

  const databaseUrl = process.env['DATABASE_URL'] ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL tanımlı değil.');

  let host = '';
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error('DATABASE_URL ayrıştırılamadı.');
  }

  const yerel = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  if (!yerel && process.env['VT_VITRIN_ONAY'] !== 'evet') {
    throw new Error(
      `Veritabanı yerel değil (host: "${host}"). Uzak bir veritabanına demo verisi ` +
        'yazmak BİLEREK yapılan bir iştir; onaylamak için VT_VITRIN_ONAY=evet verin.\n' +
        'Yazılacaklar: kategori, satıcı, ürün, varyant, stok, görsel, hesap, favori, yorum, sepet.\n' +
        'YAZILMAYACAKLAR: ledger, sipariş, paket, iade, payout, ödeme.',
    );
  }

  return { uzak: !yerel, host };
}

async function main(): Promise<void> {
  const kapi = vitrinKapisi();
  const prisma = new PrismaClient();

  console.log(
    `\n▸ Vitrin seed — veritabanı: ${kapi.host}${kapi.uzak ? ' (UZAK, onaylandı)' : ' (yerel)'}`,
  );
  console.log('  ⚠️ Ledger, sipariş ve payout YAZILMAYACAK.\n');

  try {
    const storage = depolamaKur();
    if (!storage) {
      console.warn(
        '⚠️  DEPOLAMA YAPILANDIRILMAMIŞ — görseller yüklenmeyecek, satırlar yine yazılacak.\n',
      );
    }

    const katalog = await katalogYaz(prisma, storage);
    console.log(
      `  ✓ katalog: ${katalog.kategoriId.size} kategori · ${katalog.saticiId.size} satıcı · ` +
        `${katalog.urunId.size} ürün · ${katalog.varyantSayisi} varyant`,
    );
    console.log(
      `  ✓ görsel: ${katalog.yuklenenGorsel} yüklendi · ${katalog.atlananGorsel} atlandı`,
    );

    const hesap = await hesaplariYaz(prisma, katalog.saticiId);
    console.log(`  ✓ hesap: ${hesap.kullaniciId.size} kullanıcı (rol + mağaza üyeliği ile)`);
    if (hesap.parolaAtlanan.length > 0) {
      console.log(`    ↳ ${hesap.parolaAtlanan.length} hesabın parolası KORUNDU (zaten vardı)`);
    }

    /**
     * ⚠️ Favori ve yorum SÜS DEĞİL. `stylist.gateway.ts` favorileri, beden
     *    motoru (`ai.gateway.ts` + `fit-learning.gateway.ts`) yorumları okuyor.
     *    Bu tablolar boşken AI sinyalsiz çalışıyor ve öneriler zayıf çıkıyor.
     */
    const musteri = await musteriYaz(prisma, hesap.kullaniciId, katalog.urunId);
    console.log(
      `  ✓ müşteri: ${musteri.yorumSayisi} yorum · ${musteri.favoriSayisi} favori · ` +
        `${musteri.sepetKalemi} sepet kalemi · ${musteri.gardiropSayisi} gardırop parçası`,
    );

    console.log('\n✅ Vitrin seed tamam. Ledger ve sipariş tablolarına DOKUNULMADI.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((hata: unknown) => {
  console.error(`\n❌ Vitrin seed başarısız: ${hata instanceof Error ? hata.message : hata}\n`);
  process.exitCode = 1;
});
