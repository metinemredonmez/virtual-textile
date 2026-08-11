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
      cwd: '/srv/virtual-textile/apps/api',
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

    {
      name: 'vt-worker',
      cwd: '/srv/virtual-textile/apps/worker',
      script: 'dist/main.js',

      // ⚠️ FORK ve TEK ÖRNEK — cluster DEĞİL.
      // Zamanlanmış işler her örnekte tetiklenir: iki örnek olsaydı fotoğraf
      // silme ve outbox dağıtımı iki kez çalışır, rezervasyon serbest bırakma
      // stoğu iki kez artırırdı. BullMQ eşzamanlılığı zaten iş içinde
      // yönetiliyor (queues.ts → CONCURRENCY).
      exec_mode: 'fork',
      instances: 1,

      // Çalışan işin bitmesini bekle. Yarıda kesilen bir fotoğraf silme veya
      // ödeme dağıtımı tutarsız durum bırakır.
      kill_timeout: 30000,

      max_memory_restart: '900M',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 2000,

      error_file: '/var/log/virtual-textile/worker.error.log',
      out_file: '/var/log/virtual-textile/worker.out.log',
      merge_logs: true,
      time: false,

      env_production: { NODE_ENV: 'production' },
    },
  ],
};
