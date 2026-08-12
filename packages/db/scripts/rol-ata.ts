/**
 * ROL ATAMA — GELİŞTİRME/ÖLÇÜM KAPISI.
 *
 * ⚠️ BU BETİK BİR KOLAYLIK DEĞİL, KAPALI BİR ÇEMBERİN TEK ÇIKIŞI. Rol
 *    yükseltmenin uygulamadaki tek kod yolu `seller-role.service.ts` ve o da
 *    ancak bir **ADMIN**'in `POST /admin/sellers/:id/approve` çağırmasıyla
 *    tetikleniyor — yani ilk ADMIN'i doğuracak hiçbir yol yok.
 *    `POST /v1/auth/register` her kullanıcıyı CUSTOMER açıyor, rolü değiştiren
 *    uç yok. Sonucu somuttu: satıcı ve yönetim panelleri GERÇEK VERİYLE HİÇ
 *    ÖLÇÜLEMEDİ; kanıtlanabilen tek şey oturumsuz erişimin `/giris`e
 *    yönlenmesiydi. `e2e/destek/veritabani.ts` de aynı boşluğu kendi içinde
 *    belgeliyor ("kod tabanında `role = 'SELLER_USER'` ataması hiç yok").
 *
 * ⚠️ PAROLA BURADA ÜRETİLMEZ. Kullanıcı önce `POST /v1/auth/register` ile
 *    NORMAL yoldan açılır, betik yalnızca ROLÜ yükseltir. Aksi hâlde parola
 *    özetleme (argon2 parametreleri, pepper) ikinci bir yerde uygulanır ve iki
 *    uygulama ayrıştığı gün "kayıt oluyor ama giriş yapamıyor" hatası doğar.
 *
 * ⚠️ ÜRETİMDE ÇALIŞMAZ. `NODE_ENV=production` altında hemen çıkar; bir kabuk
 *    erişimini kalıcı yönetici yetkisine çeviren bir betiğin üretimde
 *    bulunması, uygulamadaki tüm yetki kapılarının etrafından dolaşmaktır.
 *
 * Kullanım:
 *   pnpm --filter @vt/db rol:ata -- --eposta=yonetici@ornek.test --rol=ADMIN
 *   pnpm --filter @vt/db rol:ata -- --eposta=satici@ornek.test --rol=SELLER_USER \
 *        --magaza=olcum-magazasi
 */
import { PrismaClient, type Role } from '../generated/client/index.js';

const prisma = new PrismaClient();

const ROLLER = ['CUSTOMER', 'SELLER_USER', 'SUPPORT', 'ADMIN'] as const;
type AtanabilirRol = (typeof ROLLER)[number];

function arguman(ad: string): string | null {
  const onek = `--${ad}=`;
  const bulunan = process.argv.find((parca) => parca.startsWith(onek));
  return bulunan ? bulunan.slice(onek.length) : null;
}

function rolMu(deger: string): deger is AtanabilirRol {
  return (ROLLER as readonly string[]).includes(deger);
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('rol-ata üretim ortamında çalıştırılamaz.');
  }

  const eposta = arguman('eposta');
  const rolHam = arguman('rol');
  const magazaSlug = arguman('magaza');

  if (!eposta || !rolHam) {
    throw new Error(
      'Kullanım: --eposta=<adres> --rol=CUSTOMER|SELLER_USER|SUPPORT|ADMIN [--magaza=<slug>]',
    );
  }
  if (!rolMu(rolHam)) {
    throw new Error(`Bilinmeyen rol: ${rolHam}. Geçerli: ${ROLLER.join(', ')}`);
  }

  const kullanici = await prisma.user.findUnique({
    where: { email: eposta },
    select: { id: true, email: true, role: true },
  });

  if (!kullanici) {
    // ⚠️ Kullanıcı BURADA YARATILMAZ (parola özeti gerekçesi başlıkta).
    throw new Error(`${eposta} bulunamadı. Önce normal yoldan kayıt olun: POST /v1/auth/register`);
  }

  await prisma.user.update({
    where: { id: kullanici.id },
    data: { role: rolHam as Role, emailVerifiedAt: new Date() },
  });
  console.log(`✓ ${eposta}: ${kullanici.role} → ${rolHam}`);

  if (rolHam !== 'SELLER_USER') {
    await prisma.$disconnect();
    return;
  }

  /*
   * ⚠️ SELLER_USER ROLÜ TEK BAŞINA YETMEZ. `SellerScopeGuard`
   *    `request.sellerId`i `seller_users` üzerinden çözüyor; üyeliği olmayan
   *    bir SELLER_USER panele girer ama HER uç 403 döner. Ekranların dolu
   *    hâlini ölçebilmek için mağaza da APPROVED olmalı: `requireActive`
   *    onaylanmamış satıcının bütün yazma uçlarını kapatıyor.
   */
  const mevcutUyelik = await prisma.sellerUser.findFirst({
    where: { userId: kullanici.id },
    select: { sellerId: true },
  });

  if (mevcutUyelik) {
    await prisma.seller.update({
      where: { id: mevcutUyelik.sellerId },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
    console.log(`✓ mevcut mağaza APPROVED: ${mevcutUyelik.sellerId}`);
    await prisma.$disconnect();
    return;
  }

  const slug = magazaSlug ?? `magaza-${kullanici.id.slice(0, 8)}`;
  const satici = await prisma.seller.create({
    data: {
      legalName: `${slug} Tekstil A.Ş.`,
      displayName: slug,
      /*
       * ⚠️ ŞİFRELİ ALANLAR BURADA ŞİFRELENMİYOR ve bu bilinçli: gerçek yolda
       *    `taxNumberEnc`/`ibanEnc` uygulama katmanında AES-256-GCM ile
       *    yazılıyor. Buradaki değerler ÇÖZÜLEMEZ; payout gönderimi bu
       *    mağazada denenirse orada patlar ve patlaması doğrudur — sahte bir
       *    IBAN'ın çözülebilir görünmesi çok daha kötü olurdu.
       */
      taxNumberEnc: `gelistirme:${slug}`,
      taxOffice: 'Geliştirme',
      ibanEnc: `gelistirme:${slug}`,
      contactEmail: eposta,
      contactPhone: '+905000000000',
      status: 'APPROVED',
      approvedAt: new Date(),
      store: { create: { slug, name: slug } },
      members: { create: { userId: kullanici.id, storeRole: 'owner' } },
    },
    select: { id: true },
  });

  console.log(`✓ mağaza oluşturuldu ve APPROVED: ${satici.id} (slug: ${slug})`);
  await prisma.$disconnect();
}

main().catch((hata: unknown) => {
  console.error(hata instanceof Error ? hata.message : hata);
  void prisma.$disconnect();
  process.exitCode = 1;
});
