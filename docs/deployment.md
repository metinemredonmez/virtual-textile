# Kurulum ve Dağıtım

> **Docker yalnızca yerel geliştirmede kullanılır.** Sunucuda konteyner yoktur:
> PostgreSQL, Redis ve Node doğrudan makineye kurulur, süreçler PM2 veya systemd
> ile yönetilir.

|                | Yerel                             | Üretim                   |
| -------------- | --------------------------------- | ------------------------ |
| PostgreSQL     | Docker (`vt-postgres`, port 5433) | Sistem paketi, port 5432 |
| Redis          | Docker (`vt-redis`, port 6380)    | Sistem paketi, port 6379 |
| Node süreçleri | `pnpm dev`                        | PM2 / systemd            |
| Depolama       | MinIO (Docker)                    | S3 uyumlu servis         |

Yerelde 5433/6380 kullanılıyor çünkü geliştirici makinesinde zaten bir Postgres veya
Redis çalışıyor olabilir.

---

## 1. Yerel geliştirme

```bash
pnpm install
cp .env.example .env
```

Anahtarları üret ve `.env`'e yaz:

```bash
openssl rand -hex 64   # JWT_ACCESS_SECRET
openssl rand -hex 64   # JWT_REFRESH_SECRET
openssl rand -hex 32   # FIELD_ENCRYPTION_KEY
openssl rand -hex 24   # INTERNAL_API_TOKEN
```

Sonra:

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Sıfırdan başlamak için (⚠️ yerel veriyi siler):

```bash
pnpm infra:reset && pnpm db:migrate && pnpm db:seed
```

---

## 2. Sunucu hazırlığı (Ubuntu 24.04)

### 2.1 Sistem kullanıcısı ve dizinler

```bash
sudo useradd --system --create-home --home-dir /srv/virtual-textile --shell /bin/bash vt
sudo mkdir -p /var/log/virtual-textile /etc/virtual-textile
sudo chown vt:vt /var/log/virtual-textile
sudo chmod 750 /etc/virtual-textile
```

### 2.2 Node 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pnpm@9 pm2
```

### 2.3 PostgreSQL 17 + pgvector

```bash
sudo apt-get install -y postgresql-17 postgresql-17-pgvector
```

Veritabanını **ICU Türkçe koleksiyonuyla** oluştur — sıralamada i/İ ve ı/I doğru çalışsın:

```bash
sudo -u postgres createuser vt --pwprompt
sudo -u postgres createdb virtual_textile \
  --owner=vt --encoding=UTF8 \
  --locale-provider=icu --icu-locale=tr-TR --template=template0
```

> Eklentiler (`vector`, `pg_trgm`, `unaccent`, `btree_gin`, `pgcrypto`) ve Türkçe arama
> yapılandırması **migration tarafından** kurulur. Elle `CREATE EXTENSION` çalıştırma —
> Prisma bunu sapma (drift) olarak görür.

Eklenti kurulumu superuser gerektirir. Ya `vt` kullanıcısına geçici `SUPERUSER` ver ve
ilk migration'dan sonra geri al, ya da eklentileri bir kez `postgres` ile kur.

### 2.4 Redis

```bash
sudo apt-get install -y redis-server
```

`/etc/redis/redis.conf` içinde en az şunlar:

```
maxmemory 1gb
maxmemory-policy allkeys-lru
appendonly yes
bind 127.0.0.1 ::1
```

> ⚠️ Redis'i **dışarıya açma.** Kuyruk ve oturum verisi burada.

### 2.5 Ortam dosyası

```bash
sudo install -o vt -g vt -m 600 /dev/null /etc/virtual-textile/api.env
sudo -u vt nano /etc/virtual-textile/api.env
```

`.env.example`'ı temel al. **Üretimde `NODE_ENV=production` zorunlu ek kontrolleri
tetikler** ([`packages/config/src/env.ts`](../packages/config/src/env.ts)):

- Ödeme, depolama, AI ve Sentry anahtarları boş bırakılamaz
- Sandbox ödeme adresi reddedilir
- Kullanıcı fotoğrafı kovası ile ürün görseli kovası aynı olamaz
- `CORS_ORIGINS` içinde `localhost` bulunamaz

Bir tanesi eksikse **süreç başlamaz** ve hangi değişkenin neden gerektiğini yazar.

---

## 3. Dağıtım

```bash
sudo -u vt -i
cd /srv/virtual-textile

git fetch --all && git checkout main && git pull
pnpm install --frozen-lockfile --prod=false
pnpm build

# Migration'ları uygula — ÖNCE, uygulama yeniden yüklenmeden.
cd packages/db && pnpm exec prisma migrate deploy && cd ../..
```

### Migration kuralı: expand/contract

Kolon silme veya yeniden adlandırma **tek deploy'da yapılmaz**. Eski sürüm hâlâ
çalışırken şema değişirse istekler patlar:

```
1) Yeni kolonu ekle (nullable)
2) Çift yaz (hem eski hem yeni)
3) Geri doldur
4) Okumayı yeni kolona çevir
5) SONRAKİ sürümde eski kolonu sil
```

---

## 4. Süreç yönetimi

### Seçenek A — PM2 (cluster desteği)

```bash
sudo cp infra/systemd/vt.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vt
```

```bash
sudo -u vt pm2 reload vt-api    # kesintisiz yeniden yükleme
sudo -u vt pm2 logs vt-api
sudo -u vt pm2 monit
```

API stateless olduğu için cluster modu güvenlidir: oturum ve kuyruk Redis'te, bellekte
durum tutulmuyor.

> ⚠️ Worker yazıldığında **fork** modunda ve tek örnek çalışmalıdır. Cluster'a alınırsa
> aynı iş birden fazla süreç tarafından işlenebilir.

### Seçenek B — Doğrudan systemd (PM2 yok)

```bash
sudo cp infra/systemd/vt-api-direct.service /etc/systemd/system/vt-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now vt-api
sudo journalctl -u vt-api -f
```

Daha az katman, journald ile bütünleşik log; cluster yok. Birden fazla örnek gerekirse
systemd template (`vt-api@.service`) + her örneğe ayrı `PORT` + nginx upstream.

**Hangisi:** Tek sunucuda başlıyorsanız B daha sade. Cluster, canlı reload ve süreç
paneli istiyorsanız A.

---

## 5. Ters proxy (nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name api.example.com;

  ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

  # Fotoğraf yüklemesi doğrudan depoya imzalı URL ile gider; buradan geçmez.
  client_max_body_size 2m;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Stil danışmanı yanıtları SSE ile akıyor — tamponlama kapalı olmalı.
    proxy_buffering off;
    proxy_read_timeout 120s;
  }

  location = /health {
    proxy_pass http://127.0.0.1:3001/health;
    access_log off;
  }
}
```

> Uygulamada `app.set('trust proxy', 1)` ayarlı — yalnızca **bir** proxy'ye güvenilir.
> `true` demek istemcinin gönderdiği `X-Forwarded-For` zincirine güvenmek olurdu ve
> saldırgan başlığı uydurup hız limitini atlatabilirdi. Proxy sayısı değişirse bu
> sayı da güncellenmelidir.

---

## 6. Sağlık kontrolü

| Uç                 | Kim kullanır             | Bağımlılık yoklar mı |
| ------------------ | ------------------------ | -------------------- |
| `GET /health`      | Yük dengeleyici, systemd | ❌ hayır — hızlı     |
| `GET /health/deep` | İzleme servisi           | ✅ Postgres + Redis  |

`/health` bilinçli olarak bağımlılık yoklamaz: veritabanının bir saniyelik takılması tüm
sunucuların havuzdan düşmesine yol açmamalı.

---

## 7. Yedekleme

```bash
# Günlük tam yedek
pg_dump -Fc virtual_textile > /var/backups/vt-$(date +%F).dump
```

En az şunlar kurulmalı:

- Günlük tam yedek + WAL arşivi (PITR, 7 gün)
- Yedeğin **başka bir makinede** kopyası
- **Ayda bir geri yükleme tatbikatı** — test edilmemiş yedek yedek değildir

---

## 8. Canlıya çıkmadan önce

- [ ] `NODE_ENV=production` ve tüm zorunlu anahtarlar dolu
- [ ] `/etc/virtual-textile/api.env` izinleri `600`, sahibi `vt`
- [ ] Redis dışarıya kapalı
- [ ] TLS + HSTS aktif
- [ ] Yedekleme çalışıyor ve **geri yükleme denendi**
- [ ] Sentry ve uptime izleme bağlı
- [ ] Kullanıcı fotoğrafı kovasında **sürümleme kapalı** (bkz. [privacy.md](privacy.md))
- [ ] Fotoğraf silme cron'u çalışıyor ve **çalışmazsa alarm veriyor**
- [ ] Log rotasyonu kurulu (`/var/log/virtual-textile`)
- [ ] Runbook'lar yazıldı (`docs/runbook/`)
