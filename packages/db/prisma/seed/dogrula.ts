/**
 * SEED'İN KENDİ ÜRETTİĞİNİ GERİ OKUMASI.
 *
 * ⚠️ PLANIN ASIL OMURGASI BU DOSYA. Eski seed ürettiği verinin kullanılabilir
 *    olup olmadığını HİÇ doğrulamıyordu ve üç ayrı noktada kullanılamaz veri
 *    üretiyordu — üçünde de konsola yeşil basarak:
 *      · görseller uygulamanın hiç üretmediği bir anahtar biçimine yazılıyordu,
 *      · demo müşteri giriş yapamıyordu (`passwordHash: null`),
 *      · kapanışta `/magaza/atolye-nord` basıyordu; o adres 404 çünkü
 *        `(magaza)` bir rota GRUBU, URL segmenti değil.
 *    Üstüne konsol `'✓ 3 ürün, 15 varyant'` diyordu; gerçek 11'di — sabit
 *    yazılmış metin, döngü sayımı değil.
 *
 * Bu yüzden buradaki her iddia GERİ OKUMAYA dayanır: nesne kovada var mı,
 * basılacak adres rota ağacında var mı, hesap gerçekten giriş yapabiliyor mu.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StorageProvider } from '@vt/adapters';
import type { PrismaClient } from '../../generated/client/index.js';
import { AI_MODELLERI } from './denetim.js';
import { KUPONLAR } from './ticaret.js';
import { DEMO_PAROLA, HESAPLAR, KATEGORILER, SATICILAR, URUNLER } from './veri.js';

export interface DogrulamaBulgusu {
  readonly seviye: 'hata' | 'uyari' | 'bilgi';
  readonly mesaj: string;
}

// ── 1. Depolama: her anahtar GERÇEKTEN kovada mı ───────────────────────────

export async function gorselleriDogrula(
  storage: StorageProvider | null,
  anahtarlar: readonly string[],
): Promise<DogrulamaBulgusu[]> {
  if (!storage) {
    return [
      {
        seviye: 'uyari',
        mesaj:
          `Depolama yapılandırılmamış (R2_* boş) — ${anahtarlar.length} görsel YÜKLENMEDİ. ` +
          'Veritabanı satırları yazıldı ama vitrinde görsel çıkmaz. ' +
          "Anahtarları kök .env dosyasına ekleyip seed'i tekrar çalıştırın.",
      },
    ];
  }

  const eksik: string[] = [];
  for (const anahtar of anahtarlar) {
    if (!(await storage.exists(anahtar, 'public'))) eksik.push(anahtar);
  }

  if (eksik.length > 0) {
    return [
      {
        seviye: 'hata',
        mesaj: `${eksik.length}/${anahtarlar.length} görsel kovada YOK. İlki: ${eksik[0]}`,
      },
    ];
  }

  return [
    {
      seviye: 'bilgi',
      mesaj: `${anahtarlar.length} görselin tamamı kovada doğrulandı (HeadObject).`,
    },
  ];
}

// ── 2. Rota tablosu: basılan adres gerçekten var mı ────────────────────────

/**
 * `apps/web/app` ağacından rota listesi TÜRETİLİR, elle yazılmaz.
 *
 * ⚠️ Parantezli klasörler (`(magaza)`, `(satici)`, `(yonetim)`) ROTA GRUBUDUR
 *    ve URL'ye GİRMEZ. Eski seed'in bastığı `/magaza/atolye-nord` tam olarak bu
 *    yüzden 404'tü: klasör adı URL sanılmıştı.
 *
 * ⚠️ Bu tarama `apps/web` ağacına bağlı ve rota göçü sırasında klasör adları
 *    değişiyor. Ağaç bulunamazsa kontrol HATA değil UYARI verir — seed'in
 *    frontend deposunun şekline sıkı bağlanması, seed'i frontend'in rehinesi
 *    yapardı.
 */
export function rotalariTopla(webKoku: string): Set<string> | null {
  const appKoku = join(webKoku, 'app');
  if (!existsSync(appKoku)) return null;

  const rotalar = new Set<string>();

  const yuru = (klasor: string, url: string): void => {
    for (const giris of readdirSync(klasor, { withFileTypes: true })) {
      if (giris.isFile()) {
        if (giris.name === 'page.tsx' || giris.name === 'page.ts') rotalar.add(url || '/');
        continue;
      }
      if (!giris.isDirectory()) continue;
      if (giris.name.startsWith('_') || giris.name === 'node_modules') continue;
      // Rota grubu ve paralel rota URL'ye girmez.
      const grup = giris.name.startsWith('(') || giris.name.startsWith('@');
      yuru(join(klasor, giris.name), grup ? url : `${url}/${giris.name}`);
    }
  };

  yuru(appKoku, '');
  return rotalar;
}

/**
 * `/product/keten-gomlek` → `/product/[slug]` kalıbıyla eşleşmeli.
 *
 * ⚠️ DİL ÖNEKİ BİLEREK GÖRMEZDEN GELİNİR. Rota ağacı `app/[locale]/...` hâline
 *    geçtiğinde seed'in bastığı `/products` (1 segment) ile ağaçtaki
 *    `[locale]/products` (2 segment) uzunluk tutmadığı için eşleşmez; bu
 *    kontrol o gün 11 adresi birden "ÖLÜ" ilan eder, `seviye: 'hata'` üzerinden
 *    seed'i THROW ettirir ve veri kusursuzken koşu düşer. Yani doğrulama adımı
 *    doğruladığı şeyi değil KENDİNİ kırar.
 *
 *    Bu yüzden kök seviyedeki dinamik segmentler (yalnız `[locale]` değil, kökte
 *    ne varsa) opsiyonel bir ön ek olarak da denenir. Kontrol GEVŞEMİYOR:
 *    ön ek eklendikten sonra da her segment tek tek eşleşmek zorunda; yalnızca
 *    "dil önekinin altına taşındı" hâli ölü bağlantı sayılmıyor.
 */
function rotaVarMi(rotalar: Set<string>, adres: string): boolean {
  if (rotalar.has(adres)) return true;
  const parcalar = adres.split('/').filter(Boolean);

  // Kökte duran dinamik segmentler — `[locale]` bunlardan biri.
  const kokOnekleri = new Set<string>();
  for (const rota of rotalar) {
    const ilk = rota.split('/').filter(Boolean)[0];
    if (ilk?.startsWith('[')) kokOnekleri.add(ilk);
  }

  const adaylar = [parcalar, ...[...kokOnekleri].map((onek) => [onek, ...parcalar])];

  for (const rota of rotalar) {
    const kalip = rota.split('/').filter(Boolean);
    for (const aday of adaylar) {
      if (kalip.length !== aday.length) continue;
      const uyuyor = kalip.every((segment, i) => segment.startsWith('[') || segment === aday[i]);
      if (uyuyor) return true;
    }
  }
  return false;
}

export function adresleriDogrula(webKoku: string, adresler: readonly string[]): DogrulamaBulgusu[] {
  const rotalar = rotalariTopla(webKoku);
  if (!rotalar) {
    return [
      {
        seviye: 'uyari',
        mesaj: `Rota ağacı bulunamadı (${join(webKoku, 'app')}) — basılan adresler doğrulanamadı.`,
      },
    ];
  }

  const olu = adresler.filter((adres) => !rotaVarMi(rotalar, adres));
  if (olu.length > 0) {
    return [
      {
        seviye: 'hata',
        mesaj: `Seed'in bastığı ${olu.length} adres rota ağacında YOK: ${olu.join(' · ')}`,
      },
    ];
  }

  return [
    {
      seviye: 'bilgi',
      mesaj: `Basılan ${adresler.length} adresin tamamı rota ağacında var (${rotalar.size} rota tarandı).`,
    },
  ];
}

// ── 3. Hesaplar GERÇEKTEN giriş yapabiliyor mu ─────────────────────────────

/**
 * ⚠️ "Satır yazıldı" ile "giriş yapılabiliyor" AYNI ŞEY DEĞİL — bu deponun altı
 *    arızasının ortak deseni. `auth.service.ts:125` `passwordHash` boşsa
 *    kullanıcıyı YOK sayıyor; eski seed'in `demo@example.com` hesabı ekranda
 *    yazılıydı ama giriş HİÇ ÇALIŞMIYORDU.
 *
 * API ayakta değilse bu kontrol ATLANIR (CI'da API yok). Atlanması sessiz
 * değildir: raporda uyarı olarak görünür.
 *
 * ⚠️ ÖNCE SEED'İN KENDİ BAĞLANTISI, SONRA API — VE BU SIRA BİR ARIZANIN
 *    ARDINDAN YAZILDI. Bu adım bir süre YALNIZCA HTTP atıyordu; o sürecin kendi
 *    `DATABASE_URL`i var ve seed'inkiyle aynı olmak ZORUNDA DEĞİL.
 *    ÖLÇÜLDÜ: seed `DATABASE_URL=…vt_kanit` ile koşarken `API_URL` kök
 *    `.env`ten `http://localhost:3001` geliyordu ve oradaki API
 *    `virtual_textile`e bağlıydı. İki API aynı slug için FARKLI satır
 *    döndürüyordu (`yuksek-bel-mom-jean` → `019ff80d-…` ve `019ff89e-…`) ama
 *    seed üç koşuda da "✓ Giriş doğrulandı (API)" bastı. Yani ONAY, seed'in o
 *    koşuda HİÇ DOKUNMADIĞI bir veritabanından geliyordu — `DATABASE_URL` ile
 *    `API_URL` ayrıştığı her kurulumda (ikinci yerel DB, CI, çok ortamlı
 *    makine) sessiz bir yalancı.
 *
 *    Kapatan üç adım, sırayla:
 *      1. Hesap seed'in KENDİ Prisma bağlantısında var mı ve `passwordHash`
 *         dolu mu — bu, HTTP'siz de ölçülebilen tek gerçek iddia.
 *      2. API ile seed AYNI veritabanına mı bakıyor: demo bir slug'ın kimliği
 *         iki tarafta karşılaştırılır. Ayrışıyorsa giriş denemesi YAPILMAZ,
 *         çünkü sonucu ne olursa olsun bu koşu hakkında bir şey söylemez.
 *      3. Ancak o zaman `POST /v1/auth/login`.
 *
 *    ⚠️ AYRIŞMA "hata" DEĞİL "uyari": iki ortamlı bir makinede çalışmak bir
 *       arıza değil; arıza olan, ölçülmemişi ölçülmüş göstermekti.
 *
 *    ⚠️ DUYARLILIK KONTROL KOŞUSUYLA KANITLANDI — bir kapının "eklendi" olması
 *       "çalışıyor" demek değil, ve bu depo tam olarak o karışıklığı altı kez
 *       yaşadı. `/health`i `ok`, `/v1/auth/login`i `200`, `/v1/products/:slug`i
 *       BAŞKA bir kimlikle dönen bir taklit sunucuya karşı koşuldu:
 *         eski davranış  → `✓ Giriş doğrulandı (API)`
 *         bugünkü çıktı  → `⚠️ … BAŞKA bir veritabanına bakıyor
 *                           (aynı slug, farklı kimlik: 019ff042-… ≠ 00000000-…)
 *                           — giriş doğrulaması ATLANDI`
 *       Gerçek API'ye karşı aynı fonksiyon `✓ Giriş doğrulandı` basıyor, yani
 *       kapı yalnızca ayrışmada kapanıyor.
 */
export async function girisiDogrula(
  prisma: PrismaClient,
  apiKoku: string,
): Promise<DogrulamaBulgusu[]> {
  const eposta = HESAPLAR.find((h) => h.rol === 'CUSTOMER')?.eposta;
  if (!eposta) return [];

  // ── 1. Seed'in KENDİ bağlantısı: satır gerçekten yazıldı mı ──────────────
  const kullanici = await prisma.user.findUnique({
    where: { email: eposta },
    select: { id: true, passwordHash: true },
  });

  if (!kullanici) {
    return [{ seviye: 'hata', mesaj: `Demo hesap seed'in yazdığı veritabanında YOK: ${eposta}` }];
  }
  if (!kullanici.passwordHash) {
    return [
      {
        seviye: 'hata',
        mesaj: `Demo hesabın parola özeti BOŞ (${eposta}) — auth.service bu kullanıcıyı YOK sayar.`,
      },
    ];
  }

  const ayakta = await erisilebilir(`${apiKoku}/health`);
  if (!ayakta) {
    return [
      {
        seviye: 'uyari',
        mesaj:
          `Hesap seed'in veritabanında var ve parola özeti dolu, ama API ayakta değil ` +
          `(${apiKoku}/health) — GİRİŞ denenmedi.`,
      },
    ];
  }

  // ── 2. API ile seed aynı veritabanına mı bakıyor ─────────────────────────
  const ayniDb = await ayniVeritabani(prisma, apiKoku);
  if (ayniDb !== true) {
    return [
      {
        seviye: 'uyari',
        mesaj:
          `API (${apiKoku}) seed'in yazdığından BAŞKA bir veritabanına bakıyor ` +
          `(${ayniDb}) — giriş doğrulaması ATLANDI. Bu koşuda ölçülen: hesap satırı ve ` +
          'parola özeti var. DATABASE_URL ile API_URL aynı veritabanını göstermeli.',
      },
    ];
  }

  /*
   * ⚠️ TEK HESAP DENENİR ve bu bir kısıt değil, ÖLÇÜLMÜŞ bir zorunluluk.
   *    `RATE_LIMITS.login` = 15 dakikada 5 deneme, `blockSeconds: 900`.
   *    Üç hesabı deneyen ilk sürüm, arka arkaya iki seed koşusunda kilidi
   *    açtırdı ve seed 423 ile DÜŞTÜ — yani doğrulama adımının kendisi seed'i
   *    kırdı. Rol başına ayrı hesap denemenin bir faydası da yoktu: sınanan
   *    şey rol değil, seed'in yazdığı argon2 özetinin API tarafından
   *    doğrulanabilmesi.
   */
  const yanit = await fetch(`${apiKoku}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: eposta, password: DEMO_PAROLA }),
  }).catch(() => null);

  if (yanit?.ok) {
    return [{ seviye: 'bilgi', mesaj: `Giriş doğrulandı (API): ${eposta}` }];
  }

  /*
   * ⚠️ 423/429 BİR BAŞARISIZLIK DEĞİL, ÖLÇÜLEMEME DURUMU. Parola yanlış olsa
   *    401 dönerdi; kilit, önceki denemelerin sayacı doldurduğunu söyler.
   *    Bunu "hata" saymak, arka arkaya iki kez seed çalıştıran herkese kırmızı
   *    ekran gösterirdi — ve gerçek bir arızayı görmeyi zorlaştırırdı.
   */
  if (yanit?.status === 423 || yanit?.status === 429) {
    return [
      {
        seviye: 'uyari',
        mesaj: `Giriş hız limiti (HTTP ${yanit.status}) — ${eposta} için doğrulama ATLANDI. Kilit ~15 dk sonra düşer.`,
      },
    ];
  }

  return [
    {
      seviye: 'hata',
      mesaj: `Giriş BAŞARISIZ: ${eposta} (HTTP ${yanit?.status ?? 'bağlanamadı'})`,
    },
  ];
}

async function erisilebilir(adres: string): Promise<boolean> {
  const iptal = AbortSignal.timeout(2_000);
  const yanit = await fetch(adres, { signal: iptal }).catch(() => null);
  return yanit !== null && yanit.ok;
}

/**
 * API ile seed AYNI veritabanına mı bakıyor.
 *
 * ⚠️ AYIRT EDİCİ OLARAK ÜRÜN KİMLİĞİ SEÇİLDİ, `/health` DEĞİL. Sağlık ucuna
 *    veritabanı adı eklemek en kolay yol olurdu ama o uç `@Public()`; bağlantı
 *    hedefini kimliksiz herkese söylemek, bir ölçüm kolaylığı için kalıcı bir
 *    bilgi sızıntısı açmak olurdu. Ürün kimliği zaten herkese açık bir
 *    yanıtta duruyor ve iki veritabanında ASLA aynı olmuyor: kimlikler
 *    veritabanı tarafında üretiliyor, slug ise ikisinde de aynı.
 *
 * ⚠️ Dönüş `true` ya da SEBEP metnidir, `false` değil. "Ayrışıyor" ile
 *    "ölçemedim" (uç yok, ürün seed edilmemiş, ağ düştü) aynı şey değil ve
 *    ikisi de uyarı metninde ayrı görünmeli — bu dosyanın tamamının kuralı.
 */
async function ayniVeritabani(prisma: PrismaClient, apiKoku: string): Promise<true | string> {
  const slug = URUNLER.find((u) => u.durum === 'PUBLISHED')?.slug;
  if (!slug) return 'karşılaştırılacak yayında demo ürün yok';

  const yerel = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
  if (!yerel) return `${slug} seed'in veritabanında bulunamadı`;

  const yanit = await fetch(`${apiKoku}/v1/products/${slug}`, {
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!yanit?.ok) return `${slug} API'den okunamadı (HTTP ${yanit?.status ?? 'bağlanamadı'})`;

  const govde = (await yanit.json().catch(() => null)) as { data?: { id?: string } } | null;
  const uzak = govde?.data?.id;
  if (!uzak) return `${slug} yanıtında ürün kimliği yok`;

  return uzak === yerel.id ? true : `aynı slug, farklı kimlik: ${yerel.id} ≠ ${uzak}`;
}

// ── 4. Vitrine DÜŞEN yabancı satırlar ──────────────────────────────────────

/**
 * SEED'İN OLMAYAN, AMA VİTRİNDE ÇİZİLEN SATIRLAR.
 *
 * ⚠️ "SEED GÖRSELLERİ 23/23 200" DOĞRU AMA EKSİK BİR CÜMLEDİR, ve eksikliği
 *    ölçüldü: `/products` ilk sayfasındaki 24 üründen biri
 *    `e2e-gomlek-730f-50c-f3d8e649` ve görseli üç denemenin üçünde de HTTP 500
 *    döndü. Yani seed'in kendi görselleri kusursuzken vitrinin İLK EKRANINDA
 *    kırık bir görsel duruyordu. Kabul cümlesi bu yüzden "seed görselleri"
 *    üzerinden değil, "vitrinde ÇİZİLEN satırlar" üzerinden kurulmalı.
 *
 * ⚠️ BU KONTROL SİLMEZ ve silmemeli (`seed.ts` → 2. değişmez: append-only
 *    ledger). Yaptığı tek şey kirliliği GÖRÜNÜR kılmak; temizlik ayrı bir iş ve
 *    ayrı bir kapı gerektiriyor (`docs/demo-veri.md` → "E2E kalıntıları").
 *
 * ⚠️ `sayimlariOku` bunu YAKALAYAMAZ: o fonksiyon sayımları bilerek demo
 *    kümesine daraltıyor (kendi başlığındaki gerekçe), yani kirliliği tam
 *    olarak GÖRMEZDEN GELİYOR. İki kontrol birbirinin yerine geçmez.
 */
export async function vitrinKirliligi(prisma: PrismaClient): Promise<DogrulamaBulgusu[]> {
  const demoSluglar = URUNLER.map((u) => u.slug);

  const [yabanciUrun, ornek, yabanciKategori] = await Promise.all([
    prisma.product.count({ where: { status: 'PUBLISHED', slug: { notIn: demoSluglar } } }),
    prisma.product.findMany({
      where: { status: 'PUBLISHED', slug: { notIn: demoSluglar } },
      select: { slug: true },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
    prisma.category.count({ where: { slug: { notIn: KATEGORILER.map((k) => k.slug) } } }),
  ]);

  if (yabanciUrun === 0 && yabanciKategori === 0) {
    return [{ seviye: 'bilgi', mesaj: 'Vitrinde seed dışı satır yok — liste ve fasetler temiz.' }];
  }

  return [
    {
      seviye: 'uyari',
      mesaj:
        `Vitrine seed DIŞI satırlar düşüyor: ${yabanciUrun} yayında ürün · ` +
        `${yabanciKategori} kategori (örnek: ${ornek.map((u) => u.slug).join(', ') || '—'}). ` +
        'Bunların görselleri seed tarafından yüklenmedi; ilk sayfada kırık görsel ' +
        'çıkabilir (zarif yedek örter, ama fotoğraf yoktur). Temizlik ayrı iş: ' +
        'seed hiçbir veriyi SİLMEZ.',
    },
  ];
}

// ── 5. Sayımlar döngüden değil VERİTABANINDAN okunur ───────────────────────

export interface Sayim {
  readonly etiket: string;
  readonly adet: number;
}

/**
 * ⚠️ SAYIMLAR DEMO KÜMESİNE DARALTILIR, TABLO TOPLAMI DEĞİLDİR.
 *
 * Bu veritabanında e2e koşularının bıraktığı yüzlerce satır var (ölçüldü: 304
 * kategori, 332 ürün, 329 satıcı — hiçbiri seed'in ürünü değil). Ham
 * `count()` basılsaydı iki koşu arasındaki farkı okumak imkânsızlaşır ve
 * "mükerrer kayıt yok" iddiası ölçülemezdi. Her sayım seed'in kendi doğal
 * anahtarıyla sınırlanıyor: demo slug'ları, `VT-DEMO-` sipariş öneki,
 * `createdBy: 'seed'`, demo hesap e-postaları.
 */
export async function sayimlariOku(prisma: PrismaClient): Promise<Sayim[]> {
  const kategoriSluglari = KATEGORILER.map((k) => k.slug);
  const urunSluglari = URUNLER.map((u) => u.slug);
  const magazaSluglari = SATICILAR.map((s) => s.slug);
  const epostalar = HESAPLAR.map((h) => h.eposta);
  const kuponKodlari = KUPONLAR.map((k) => k.kod);
  const aiModelleri = [...AI_MODELLERI];

  const demoUrun = { slug: { in: urunSluglari } };
  const demoKullanici = { email: { in: epostalar } };
  const demoSatici = { store: { slug: { in: magazaSluglari } } };

  const [
    kategori,
    satici,
    urun,
    yayindaUrun,
    moderasyonUrun,
    varyant,
    stok,
    gorsel,
    kullanici,
    saticiUyeligi,
    siparis,
    paket,
    kalem,
    ledger,
    iade,
    payout,
    kupon,
    kuponKullanimi,
    yorum,
    favori,
    sepetKalemi,
    gardirop,
    denetim,
    seedIsareti,
    aiKayit,
    komisyonVersiyonu,
    fiyatGecmisi,
    adres,
    esAnlamli,
  ] = await Promise.all([
    prisma.category.count({ where: { slug: { in: kategoriSluglari } } }),
    prisma.seller.count({ where: demoSatici }),
    prisma.product.count({ where: demoUrun }),
    prisma.product.count({ where: { ...demoUrun, status: 'PUBLISHED' } }),
    prisma.product.count({ where: { ...demoUrun, status: 'PENDING_REVIEW' } }),
    prisma.variant.count({ where: { product: demoUrun } }),
    prisma.inventory.count({ where: { variant: { product: demoUrun } } }),
    prisma.productImage.count({ where: { product: demoUrun } }),
    prisma.user.count({ where: demoKullanici }),
    prisma.sellerUser.count({ where: { user: demoKullanici } }),
    prisma.order.count({ where: { orderNumber: { startsWith: 'VT-DEMO-' } } }),
    prisma.orderPackage.count({ where: { order: { orderNumber: { startsWith: 'VT-DEMO-' } } } }),
    prisma.orderItem.count({ where: { order: { orderNumber: { startsWith: 'VT-DEMO-' } } } }),
    prisma.ledgerEntry.count({ where: { seller: demoSatici } }),
    prisma.returnRequest.count({ where: { returnNumber: { startsWith: 'IADE-DEMO-' } } }),
    prisma.payoutRequest.count({ where: { payoutRef: { startsWith: 'PAYOUT-DEMO-' } } }),
    prisma.coupon.count({ where: { code: { in: kuponKodlari } } }),
    prisma.couponRedemption.count({ where: { coupon: { code: { in: kuponKodlari } } } }),
    prisma.review.count({ where: { product: demoUrun } }),
    prisma.favorite.count({ where: { user: demoKullanici } }),
    prisma.cartItem.count({ where: { cart: { user: demoKullanici } } }),
    prisma.digitalWardrobeItem.count({ where: { user: demoKullanici } }),
    prisma.auditLog.count({
      where: {
        actorRole: 'ADMIN',
        action: { not: 'seed.completed' },
        ipAddress: '127.0.0.1',
        entityType: { in: ['Seller', 'Product', 'User', 'CommissionRule', 'PayoutRequest'] },
      },
    }),
    prisma.auditLog.count({ where: { action: 'seed.completed' } }),
    prisma.aiUsageLog.count({ where: { model: { in: aiModelleri } } }),
    prisma.commissionRuleVersion.count({ where: { createdBy: 'seed' } }),
    prisma.priceHistory.count({ where: { changedBy: 'seed' } }),
    prisma.address.count({ where: { user: demoKullanici } }),
    prisma.searchSynonym.count(),
  ]);

  return [
    { etiket: 'kategori', adet: kategori },
    { etiket: 'satıcı', adet: satici },
    { etiket: 'ürün (toplam)', adet: urun },
    { etiket: 'ürün (PUBLISHED)', adet: yayindaUrun },
    { etiket: 'ürün (PENDING_REVIEW)', adet: moderasyonUrun },
    { etiket: 'varyant', adet: varyant },
    { etiket: 'stok satırı', adet: stok },
    { etiket: 'ürün görseli', adet: gorsel },
    { etiket: 'kullanıcı', adet: kullanici },
    { etiket: 'satıcı üyeliği', adet: saticiUyeligi },
    { etiket: 'sipariş', adet: siparis },
    { etiket: 'paket', adet: paket },
    { etiket: 'sipariş kalemi', adet: kalem },
    { etiket: 'ledger kaydı', adet: ledger },
    { etiket: 'iade', adet: iade },
    { etiket: 'payout talebi', adet: payout },
    { etiket: 'kupon', adet: kupon },
    { etiket: 'kupon kullanımı', adet: kuponKullanimi },
    { etiket: 'yorum', adet: yorum },
    { etiket: 'favori', adet: favori },
    { etiket: 'sepet kalemi', adet: sepetKalemi },
    { etiket: 'gardırop parçası', adet: gardirop },
    { etiket: 'denetim kaydı', adet: denetim },
    { etiket: 'komisyon versiyonu', adet: komisyonVersiyonu },
    { etiket: 'fiyat geçmişi', adet: fiyatGecmisi },
    { etiket: 'adres', adet: adres },
    { etiket: 'AI kullanım kaydı', adet: aiKayit },
    { etiket: 'arama eş anlamlısı', adet: esAnlamli },
    // ⚠️ TEK ARTAN SAYIM ve bilerek öyle: her tam koşu append-only denetim
    //    iznine bir "seed.completed" satırı yazar. Diğer 27 sayım iki koşu
    //    arasında DEĞİŞMEZ; bu sayım koşu sayısını verir.
    { etiket: 'seed.completed işareti', adet: seedIsareti },
  ];
}
