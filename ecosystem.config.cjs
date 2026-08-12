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
module.exports = {
  apps: [
    {
      name: 'vt-api',
      cwd: '/var/www/virtual/apps/api',
      script: 'dist/main.js',

      // Cluster: CPU başına bir süreç. API stateless olduğu için güvenli —
      // oturum Redis'te, iş kuyruğu Redis'te, hiçbir şey bellekte tutulmuyor.
      exec_mode: 'cluster',
      instances: 'max',

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
        NODE_ENV: 'production',
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

      env_production: { NODE_ENV: 'production', WORKER_ROLE: 'core' },
    },

    {
      name: 'vt-worker-media',
      cwd: '/var/www/virtual/apps/worker',
      script: 'dist/main.js',

      // Bu rol cron ÇALIŞTIRMAZ, yalnızca kuyruk tüketir — bu yüzden birden
      // fazla örnek güvenlidir. BullMQ işi tek tüketiciye verir.
      //
      // ⚠️ Ölçekleme sinyali CPU DEĞİL, KUYRUK DERİNLİĞİ olmalıdır. CPU'ya
      //    bakarsan, işler dış API yanıtını beklerken (IO) düşük CPU görürsün
      //    ve kuyruk büyürken ölçeklemezsin.
      exec_mode: 'fork',
      instances: 2,

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

      env_production: { NODE_ENV: 'production', WORKER_ROLE: 'media' },
    },
  ],
};
