/**
 * PM2 süreç tanımı — ÜRETİM.
 *
 * ⚠️ Docker YALNIZCA yerel geliştirme içindir (infra/docker-compose.yml).
 *    Sunucuda konteyner yok: PostgreSQL, Redis ve Node doğrudan makinede kurulu.
 *    Kurulum adımları: docs/deployment.md
 *
 * Kullanım:
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 reload  vt-api          # kesintisiz yeniden yükleme
 *   pm2 logs    vt-api
 *   pm2 monit
 *
 * systemd altında çalıştırmak için: infra/systemd/vt.service
 */
/**
 * ⚠️ SUNUCU ORTAMI — KABUKTAN DEĞİL DOSYADAN.
 *
 *    `apps/api` ve `apps/worker` ortamı KENDİLERİ YÜKLEMİYOR: `main.ts` içindeki
 *    `loadEnv()` yalnızca `process.env`e bakar. Sunucuda o değerler PM2'nin İLK
 *    BAŞLATILDIĞI KABUKTAN miras alınıyordu — yazılı hiçbir yerde olmayan,
 *    tamamen tesadüfi bir bağımlılık.
 *
 *    ⚠️ BEDELİ ÖLÇÜLDÜ: `pm2 kill` ile daemon yeniden doğduğunda o miras
 *       kayboldu ve `vt-api` ÇÖKME DÖNGÜSÜNE girdi — ortam doğrulaması
 *       başarısız, uygulama hiç açılmıyor. Aynı kabuk kirliliği daha önce
 *       `vt-web`e yanlış `APP_URL` geçirip her POST'u 403 yapmıştı.
 *
 *    Artık ortam DOSYADAN okunuyor ve süreç kendi kendine yeter hâle geldi.
 *
 * ⚠️ Node `--env-file` VAR OLAN DEĞİŞKENİ EZMEZ: kabukta bir değer varsa o
 *    kazanır. Yani bu satır kirliliği ÇÖZMEZ, yalnızca EKSİKLİĞİ kapatır.
 *    Kirliliğe karşı savunma `scripts/deploy.sh` içindeki `env -u` temizliği
 *    ve ardından gelen `/proc/<pid>/environ` ölçümüdür.
 *
 * ⚠️ Dosya yoksa Node BAŞLAMAZ ve bu DOĞRUDUR: eksik ortamla ayakta kalan bir
 *    API, sağlıklı görünürken yanlış veritabanına yazabilir.
 */
const API_ENV_DOSYASI = '--env-file=/etc/virtual-textile/api.env';

/**
 * ⚠️ WEB ORTAMI PM2'YE AÇIKÇA VERİLİR — VE BU CANLIDA ÖLÇÜLEREK EKLENDİ.
 *
 *  Yaşanan: kullanıcı doğru şifreyle giriş denedi, "Bu işlem için yetkiniz
 *  yok" (403) gördü. Dağıtımın doğrulaması sebebi yakaladı:
 *
 *      dosyada : http://91.99.183.64
 *      süreçte : http://91.99.183.64:3000
 *
 *  ⚠️ KİRLİLİK KABUKTA DEĞİL, PM2 DAEMON'INDAYDI. `deploy.sh` çağrıyı
 *     `env -u APP_URL …` ile temizliyor; ama süreci açan şey kabuk değil
 *     DAEMON ve o, ilk başlatıldığı günden kalma `APP_URL=…:3000` değerini
 *     taşıyor. Temizlik yanlış yeri temizliyordu.
 *
 *  ⚠️ VE NEXT BUNU DÜZELTEMEZ: `.env.production` var olan `process.env`
 *     ÜZERİNE YAZMAZ (belgelenmiş, bilinçli davranış). Yani daemon bir kez
 *     kirli değer enjekte ettiğinde dosyadaki doğru değer hiç okunmaz.
 *
 *  ÇÖZÜM: değerleri PM2'ye AÇIKÇA veriyoruz. `env_production` bloğu sürece
 *  doğrudan yazılır ve daemon'dan gelen mirası EZER. Süreç artık daemon'ın
 *  geçmişinden bağımsız.
 *
 *  ⚠️ DEĞER YİNE TEK KAYNAKTAN: `apps/web/.env.production` (o da
 *     `/etc/virtual-textile/web.env`e simgesel bağ). Buraya elle yazmak
 *     ikinci bir kaynak açardı ve ikisi ayrıştığında hangisinin kazandığı
 *     belirsiz olurdu.
 *
 *  ⚠️ `pm2 kill` ALTERNATİFİ DEĞERLENDİRİLDİ VE REDDEDİLDİ: daemon'ı
 *     öldürmek bu makinedeki DİĞER ÜÇ PROJEYİ de düşürür (celine-*, od-*).
 *     Bir kez yapıldı ve komşu projeler gitti. Süreci kendi kendine yeter
 *     hâle getirmek, daemon'a dokunmadan aynı sonucu veriyor.
 */
const fs = require('node:fs');

/** Kabuktan/daemon'dan MİRAS ALINMAMASI gereken web değişkenleri. */
const WEB_MIRAS_ALINMAZ = [
  'APP_URL',
  'API_URL',
  'SESSION_REDIS_URL',
  'SESSION_SECRET',
  'NEXT_PUBLIC_MEDIA_URL',
];

function webOrtami() {
  const yol = '/var/www/virtual/apps/web/.env.production';
  const ortam = { NODE_ENV: 'production' };

  let ham;
  try {
    ham = fs.readFileSync(yol, 'utf8');
  } catch {
    /**
     * ⚠️ SESSİZCE GEÇİLİYOR VE SEBEBİ VAR: bu dosya YEREL geliştirmede yok
     *    (ecosystem yalnız sunucuda kullanılıyor ama `require` edilebiliyor —
     *    testler ve `node -e` ile okunuyor). Sunucuda dosya gerçekten yoksa
     *    `deploy.sh` 7. adımda zaten durduruyor: "apps/web/.env.production
     *    yok. Bir kez kurun: ln -sfn …".
     */
    return ortam;
  }

  for (const satir of ham.split(/\r?\n/)) {
    const eslesme = /^([A-Z0-9_]+)=(.*)$/.exec(satir.trim());
    if (!eslesme) continue;
    const [, anahtar, ham2] = eslesme;
    if (!WEB_MIRAS_ALINMAZ.includes(anahtar)) continue;
    ortam[anahtar] = ham2.trim().replace(/^["']|["']$/g, '');
  }
  return ortam;
}

/**
 * ⚠️ BU SUNUCU ÜRETİM DEĞİL, STAGING. VE BU BİLİNÇLİ BİR İLANDIR.
 *
 *    `@vt/config` → `env.ts`, `NODE_ENV=production` altında şunları ZORUNLU
 *    kılıyor: IYZICO_API_KEY / SECRET / WEBHOOK_SECRET, RESEND_API_KEY,
 *    SENTRY_DSN, sandbox olmayan IYZICO_BASE_URL, localhost içermeyen
 *    CORS_ORIGINS. Bugün bunların hiçbiri yok:
 *      · iyzico başvurusu kullanıcı tarafından BİLİNÇLİ ertelendi,
 *      · Resend ve Sentry hesapları açılmadı,
 *      · TLS yok — şifreler ağda açık metin gidiyor.
 *
 *    ⚠️ ASIL BULGU: bu sunucu bugüne kadar da hiç üretim modunda çalışmadı.
 *       Kabuktan miras alınan `NODE_ENV=staging` yüzünden yukarıdaki
 *       kontrollerin TAMAMI sessizce atlanıyordu. Kirlilik temizlenince
 *       kontrol devreye girdi ve API açılmadı — koruma bozulmadı, ÇALIŞMAYA
 *       BAŞLADI.
 *
 *    Seçenek üçtü: (a) sahte anahtarlarla kontrolü kandırmak, (b) kontrolü
 *    gevşetmek, (c) ortamın gerçekte ne olduğunu YAZMAK. (a) ve (b) ödeme
 *    alınan bir sistemde webhook imzasının doğrulanmadığını gizlerdi.
 *
 * ⚠️ ÜRETİME GEÇERKEN: `VT_MOD=production` verilir ve yukarıdaki altı anahtar
 *    `/etc/virtual-textile/api.env` içine yazılır. Kontrol o an gerçekten
 *    çalışır ve eksik bir şey varsa uygulama AÇILMAZ. İstenen budur.
 */
const VT_CALISMA_MODU = process.env.VT_MOD || 'staging';

module.exports = {
  apps: [
    {
      name: 'vt-api',
      cwd: '/var/www/virtual/apps/api',
      script: 'dist/main.js',
      node_args: API_ENV_DOSYASI,

      /**
       * Cluster: API stateless olduğu için güvenli — oturum Redis'te, iş
       * kuyruğu Redis'te, hiçbir şey bellekte tutulmuyor.
       *
       * ⚠️ `'max'` İDİ VE GERİ ALINDI. `'max'` = CPU başına bir süreç; bu
       *    makinede 4 çekirdek var, yani DÖRT `vt-api` açılıyordu. Ölçüldü
       *    (`pm2 list`, 2026-08-14):
       *
       *        vt-api × 4        662 MB
       *        vt-web            755 MB
       *        vt-worker-media×2 282 MB
       *        vt-worker-core    156 MB
       *        ─────────────────────────
       *        vt toplam       1.855 MB
       *
       *    ⚠️ MAKİNE PAYLAŞILIYOR. Aynı sunucuda üç proje daha barınıyor
       *       (celine-api, celine-web, od-backend, od-frontend — toplam
       *       727 MB) ve hepsi aynı 8 GB'ı, aynı PostgreSQL ve Redis'i
       *       kullanıyor. `'max'` yazmak "bu makine benim" demektir; değil.
       *
       *    ⚠️ DÖRT SÜREÇ BUGÜN BİR İŞE YARAMIYOR: sitede henüz gerçek trafik
       *       yok. Cluster'ın kazancı eşzamanlı istek altında ortaya çıkar;
       *       boştaki dört süreç yalnızca bellek tutar ve her dağıtımda dört
       *       kez yeniden başlar.
       *
       *    İKİ, SIFIR DEĞİL: tek süreçte `pm2 reload` sırasında kısa bir
       *    kesinti penceresi doğar (yeni süreç ayağa kalkana kadar istek
       *    düşer). İki süreçle reload sırayla yapılır, kesinti olmaz.
       *
       *    Trafik geldiğinde bu sayı ÖLÇÜLEREK artırılır — CPU doygunluğuna
       *    bakılarak, "çekirdek sayısı kadar" diye değil.
       */
      exec_mode: 'cluster',
      instances: 2,

      // Uygulama hazır olmadan trafik almasın. main.ts listen sonrası
      // process.send('ready') göndermiyorsa listen_timeout devreye girer.
      wait_ready: false,
      listen_timeout: 10000,

      // Kapanırken açık istekleri tamamla (Nest enableShutdownHooks ile birlikte).
      kill_timeout: 10000,

      max_memory_restart: '700M',
      autorestart: true,
      // Sürekli çöküyorsa sonsuz döngüye girme; alarm insana ulaşsın.
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 2000,

      // Loglar systemd/journald yerine dosyaya; logrotate ile döndürülür.
      error_file: '/var/log/virtual-textile/api.error.log',
      out_file: '/var/log/virtual-textile/api.out.log',
      merge_logs: true,
      time: false, // pino zaten ISO zaman damgası yazıyor

      env_production: {
        NODE_ENV: VT_CALISMA_MODU,
      },
    },

    // ── Worker: İKİ AYRI ROL ────────────────────────────────────────────
    // Tek proseste olsalardı, ağır görüntü işleme 10 saniyede bir çalışması
    // gereken outbox dağıtıcısını aç bırakırdı — ödeme bildirimi görsel
    // kuyruğunun arkasında beklerdi. Üretim GPU inference mimarilerindeki
    // "CPU ve ağır işlem bileşenleri bağımsız ölçeklenir" ilkesinin bizim
    // ölçeğimizdeki karşılığı.

    {
      name: 'vt-worker-core',
      cwd: '/var/www/virtual/apps/worker',
      script: 'dist/main.js',
      node_args: API_ENV_DOSYASI,

      // ⚠️ TEK ÖRNEK. Zamanlanmış işler yalnızca bu rolde çalışır; ikinci bir
      // örnek aynı fotoğrafı iki kez silmeye, aynı rezervasyonu iki kez
      // serbest bırakmaya (stoğu iki kez artırmaya) kalkardı.
      exec_mode: 'fork',
      instances: 1,

      kill_timeout: 30000,
      max_memory_restart: '500M',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 2000,

      error_file: '/var/log/virtual-textile/worker-core.error.log',
      out_file: '/var/log/virtual-textile/worker-core.out.log',
      merge_logs: true,
      time: false,

      env_production: { NODE_ENV: VT_CALISMA_MODU, WORKER_ROLE: 'core' },
    },

    {
      name: 'vt-worker-media',
      cwd: '/var/www/virtual/apps/worker',
      script: 'dist/main.js',
      node_args: API_ENV_DOSYASI,

      // Bu rol cron ÇALIŞTIRMAZ, yalnızca kuyruk tüketir — bu yüzden birden
      // fazla örnek güvenlidir. BullMQ işi tek tüketiciye verir.
      //
      // ⚠️ Ölçekleme sinyali CPU DEĞİL, KUYRUK DERİNLİĞİ olmalıdır. CPU'ya
      //    bakarsan, işler dış API yanıtını beklerken (IO) düşük CPU görürsün
      //    ve kuyruk büyürken ölçeklemezsin.
      //
      // ⚠️ İKİ İDİ, BİRE İNDİ — VE BU KENDİ KURALIMIZI UYGULAMAK.
      //    Yukarıdaki satır "sinyal kuyruk derinliğidir" diyor; ölçüldü
      //    (2026-08-14): sanal deneme kuyruğunda BEKLEYEN İŞ YOK, sitede
      //    gerçek trafik yok. İki tüketici, boş bir kuyruğu iki kez
      //    yokluyor ve 282 MB tutuyordu. Kendi kuralımızı yazıp
      //    uygulamamak, kuralı hiç yazmamaktan kötüdür.
      //
      //    ⚠️ TEK ÖRNEK BURADA GÜVENLİ, `vt-worker-core`taki gibi ZORUNLU
      //       DEĞİL: bu rol cron çalıştırmıyor. Kuyruk büyüdüğünde ikinciyi
      //       açmak tek satır ve yeniden yükleme — geri dönüşü kolay bir karar.
      exec_mode: 'fork',
      instances: 1,

      // Sanal deneme işi 25-60 sn sürebilir; yarıda kesme.
      kill_timeout: 90000,
      max_memory_restart: '1200M',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      restart_delay: 5000,

      error_file: '/var/log/virtual-textile/worker-media.error.log',
      out_file: '/var/log/virtual-textile/worker-media.out.log',
      merge_logs: true,
      time: false,

      env_production: { NODE_ENV: VT_CALISMA_MODU, WORKER_ROLE: 'media' },
    },

    // ── Web (Next.js) ────────────────────────────────────────────────────
    {
      name: 'vt-web',
      cwd: '/var/www/virtual/apps/web',

      /**
       * ⚠️ `pnpm start` DEĞİL, Next ikilisi DOĞRUDAN çalıştırılır.
       *    PM2 `pnpm`i öldürdüğünde altındaki node çocuğu HAYATTA KALIR ve
       *    portu tutmaya devam eder; bu tam olarak bu projede yaşandı
       *    (Playwright'ın başlattığı sunucu ölmeyip 3001'i tutunca altı E2E
       *    testi sahte biçimde kırmızı yandı ve saatler o izde harcandı).
       *    Sarmalayıcı süreç yoksa sorun da yok.
       */
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 3020',

      /**
       * ⚠️ ORTAM BURADA VERİLMEZ — `apps/web/.env.production` ÜZERİNDEN GELİR
       *    ve o dosya `/etc/virtual-textile/web.env`e SİMGESEL BAĞDIR:
       *
       *      ln -sfn /etc/virtual-textile/web.env \
       *              /var/www/virtual/apps/web/.env.production
       *
       *    Sebebi PM2 değil DERLEME: `NEXT_PUBLIC_*` değerleri `next build`
       *    sırasında pakete GÖMÜLÜR. Ortamı yalnızca çalıştırma anında
       *    verseydik derleme onları görmez, tarayıcıya boş değer giderdi ve
       *    hata ancak görseller kırık göründüğünde fark edilirdi. Next
       *    `.env.production`u HEM derlemede HEM çalıştırmada okur; tek kaynak
       *    bu yüzden orası.
       *
       * ⚠️ `web.env` `api.env`den AYRI ve öyle kalmalı: frontend süreci
       *    JWT_*, IYZICO_*, FIELD_ENCRYPTION_KEY gibi sırları GÖRMEMELİ.
       *    Görmediği şeyi paketine gömemez (bkz. apps/web → verify:bundle).
       *
       * ⚠️ Bağ kopuksa süreç ÇÖKER (`required()` fırlatır) ve PM2 yeniden
       *    başlatma döngüsüne girer. Sessiz başarısızlıktan iyidir: eksik
       *    ortamla ayakta kalan bir web sunucusu, kullanıcıya bozuk sayfa
       *    gösterirken sağlıklı görünürdü.
       */

      /**
       * ⚠️ FORK, cluster DEĞİL. Next kendi sunucusunu yönetir; PM2 cluster
       *    modunda iki örnek aynı `.next` önbelleğine yazmaya çalışır.
       *    Ölçeklemek gerekirse örnek sayısı değil, AYRI PORTLAR + nginx
       *    upstream eklenir.
       */
      exec_mode: 'fork',
      instances: 1,

      kill_timeout: 10000,
      max_memory_restart: '800M',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 2000,

      error_file: '/var/log/virtual-textile/web.error.log',
      out_file: '/var/log/virtual-textile/web.out.log',
      merge_logs: true,
      time: true, // Next pino kullanmıyor; zaman damgasını PM2 basar

      /**
       * ⚠️ AÇIKÇA VERİLİYOR, MİRASA BIRAKILMIYOR — gerekçe `webOrtami()`
       *    başlığında: PM2 daemon'ı kirli bir `APP_URL` taşıyordu ve Next
       *    `.env.production`u onun üzerine YAZMADIĞI için her POST 403 oldu.
       */
      env_production: webOrtami(),
    },
  ],
};
