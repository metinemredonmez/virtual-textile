#!/usr/bin/env bash
#
# ═══════════════════════════════════════════════════════════════════════════
#  MEDYA ONARIMI — "bütün görseller kırık" durumundan çıkış.
#
#  Sunucuda, root olarak:
#      /var/www/virtual/scripts/medya-onar.sh
#
#  ⚠️ NEDEN AYRI BİR BETİK: bu iş dört adımdı ve elle yapmak İKİ KEZ yarım
#     kaldı. Her seferinde farklı bir adım atlandı ve sonuç aynı oldu —
#     ekranda kırık görsel. Adımlar arasında sıra bağımlılığı var
#     (env → nginx → build → seed) ve biri atlanınca sonraki sessizce
#     yanlış çalışıyor. Betik sırayı zorluyor ve SONUNDA ÖLÇÜYOR.
#
#  ⚠️ `deploy.sh`E EKLENMEDİ, AYRI DURUYOR: bu bir KURULUM işi, her dağıtımda
#     tekrarlanmaz. Dağıtımın içine konsaydı her `deploy.sh` seed koşturur,
#     yani demo veriyi üretim verisinin üstüne yazardı.
#
#  ⚠️ SADECE vt-* DOKUNUR. Bu makinede başka projeler barınıyor; buradaki
#     hiçbir komut onların süreçlerine, portlarına ya da veritabanlarına
#     dokunmaz. `pm2 kill` / `pm2 delete all` GEÇMİŞTE KOMŞU PROJELERİ
#     DÜŞÜRDÜ — bu betikte o komutlar YOK ve eklenmeyecek.
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

KOK="${VT_KOK:-/var/www/virtual}"
API_ENV="${VT_ENV:-/etc/virtual-textile/api.env}"
WEB_ENV="${VT_WEB_ENV:-/etc/virtual-textile/web.env}"
SUNUCU_ADRES="${VT_ADRES:-http://91.99.183.64}"

adim()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
bilgi() { printf '  %s\n' "$*"; }
uyari() { printf '\033[1;33m  ⚠️  %s\033[0m\n' "$*"; }
hata()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; }

[ -r "$API_ENV" ] || { hata "$API_ENV okunamıyor"; exit 1; }
[ -r "$WEB_ENV" ] || { hata "$WEB_ENV okunamıyor"; exit 1; }
[ -d "$KOK/.git" ] || { hata "$KOK bir git deposu değil"; exit 1; }

# ── 1/5 ────────────────────────────────────────────────────────────────────
adim "1/5  Medya kökü"

MEVCUT=$(grep '^NEXT_PUBLIC_MEDIA_URL=' "$WEB_ENV" | cut -d= -f2- | tr -d '"' || true)
HEDEF="$SUNUCU_ADRES/medya"

if [ "$MEVCUT" = "$HEDEF" ]; then
  bilgi "zaten doğru: $HEDEF"
else
  bilgi "eski : ${MEVCUT:-(tanımsız)}"
  bilgi "yeni : $HEDEF"
  if grep -q '^NEXT_PUBLIC_MEDIA_URL=' "$WEB_ENV"; then
    sed -i "s|^NEXT_PUBLIC_MEDIA_URL=.*|NEXT_PUBLIC_MEDIA_URL=$HEDEF|" "$WEB_ENV"
  else
    printf 'NEXT_PUBLIC_MEDIA_URL=%s\n' "$HEDEF" >> "$WEB_ENV"
  fi
  # ⚠️ DEĞER `next build` SIRASINDA PAKETE GÖMÜLÜR. PM2 restart yetmez;
  #    aşağıdaki 4. adım tam da bu yüzden yeniden derliyor.
  bilgi "yazıldı — yeniden derleme ZORUNLU (adım 4)"
fi

# ── 2/5 ────────────────────────────────────────────────────────────────────
adim "2/5  nginx: önbellek havuzu + /medya/ bloğu"

# ⚠️ HAVUZ AYRI DOSYADA OLMAK ZORUNDA: `proxy_cache_path` yalnızca `http{}`
#    bağlamında geçerli. `vt.conf` baştan sona tek bir `server{}` bloğu;
#    oraya konsaydı `nginx -t` "directive is not allowed here" derdi.
install -d -o www-data -g www-data -m 0700 /var/cache/nginx/vt-medya
cp "$KOK/infra/nginx/vt-cache.conf" /etc/nginx/conf.d/vt-cache.conf
cp "$KOK/infra/nginx/vt.conf" /etc/nginx/sites-available/vt
bilgi "vt-cache.conf + vt.conf kopyalandı"

# ⚠️ `nginx -t` BAŞARISIZSA DURULUR. Bozuk yapılandırmayla reload etmek,
#    çalışan siteyi (ve aynı nginx'i paylaşan KOMŞU PROJELERİ) düşürür.
if ! nginx -t; then
  hata "nginx yapılandırması geçersiz — reload YAPILMADI."
  hata "Eski dosyalar yerinde; site çalışmaya devam ediyor."
  exit 1
fi
systemctl reload nginx
bilgi "nginx yeniden yüklendi"

# ── 3/5 ────────────────────────────────────────────────────────────────────
adim "3/5  Seed — görseller R2'ye yükleniyor"

# ⚠️ DEĞİŞKENLER ALT KABUKTA KALIR, ANA KABUĞA SIZMAZ.
#    Bu depoda bir kez `set -a; . api.env` yapıldı, `DATABASE_URL` kabuğa
#    yayıldı ve BAŞKA BİR PROJENİN migration'ı bizim veritabanımıza
#    uygulanmaya çalıştı. Kalıntısını haftalarca temizledik.
#
# ⚠️ SADECE `DATABASE_URL` ve `R2_*` alınır. `api.env` içinde
#    `NODE_ENV=production` var ve seed kapısı üretimde KOŞULSUZ reddediyor —
#    o değişkeni almamak ve açıkça `development` vermek zorundayız.
#    (Kapı doğru; burada aşılan şey "üretim veritabanı" değil, "üretim
#    ETİKETİ" — veritabanı zaten demo verisi taşıyor.)
(
  set -a
  # shellcheck disable=SC1090
  . <(grep -E '^(DATABASE_URL|R2_)' "$API_ENV")
  set +a

  [ -n "${R2_ENDPOINT:-}" ] || {
    hata "R2_ENDPOINT $API_ENV içinde YOK — görseller yüklenemez."
    hata "Beklenen değişkenler: R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY"
    hata "                      R2_BUCKET_PUBLIC R2_BUCKET_PRIVATE R2_PUBLIC_URL"
    exit 1
  }

  cd "$KOK/packages/db"
  VT_VITRIN_ONAY=evet NODE_ENV=development pnpm exec tsx prisma/seed-vitrin.ts
)

# ── 4/5 ────────────────────────────────────────────────────────────────────
adim "4/5  Web yeniden derleniyor (yeni medya kökü pakete gömülüyor)"

cd "$KOK"
pnpm exec turbo run build --filter @vt/web

# ⚠️ `--only vt-web`: komşu projelerin süreçlerine DOKUNULMAZ.
#    `env -u` ile kirli değişkenler silinerek çağrılır — gerekçe deploy.sh'ta.
env -u APP_URL -u API_URL -u NODE_ENV -u NEXT_PUBLIC_MEDIA_URL \
  pm2 reload ecosystem.config.cjs --env production --only vt-web --update-env
bilgi "vt-web yeniden yüklendi"

# ── 5/5 ────────────────────────────────────────────────────────────────────
adim "5/5  ÖLÇÜM — varsayma, bak"

sleep 3
HATA=0

# (a) API doğrudan nesneyi verebiliyor mu?
ANAHTAR=$(
  ( set -a; . <(grep -E '^(DATABASE_URL)' "$API_ENV"); set +a
    psql "${DATABASE_URL%%\?*}" -tAc \
      "SELECT \"storageKey\" FROM content_site_images WHERE slot='HERO' AND \"isActive\" LIMIT 1;" 2>/dev/null || true
  )
)
if [ -z "$ANAHTAR" ]; then
  hata "veritabanında aktif HERO afişi YOK — seed site görseli yazmamış."
  HATA=1
else
  bilgi "afiş anahtarı: $ANAHTAR"
  KOD=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://127.0.0.1:3010/v1/media/$ANAHTAR")
  if [ "$KOD" = "200" ]; then
    bilgi "API  /v1/media  → 200 ✓"
  else
    hata "API  /v1/media  → $KOD  (nesne kovada yok ya da API kapalı)"
    HATA=1
  fi

  # (b) nginx önbelleği aynı nesneyi verebiliyor mu?
  BASLIK=$(curl -s -o /dev/null -D - --max-time 20 "$SUNUCU_ADRES/medya/$ANAHTAR" | tr -d '\r')
  KOD2=$(printf '%s' "$BASLIK" | head -1 | awk '{print $2}')
  ONBELLEK=$(printf '%s\n' "$BASLIK" | grep -i '^x-medya-onbellek:' | cut -d' ' -f2- || true)
  if [ "$KOD2" = "200" ]; then
    bilgi "nginx /medya/    → 200 ✓  (önbellek: ${ONBELLEK:-yok})"
  else
    hata "nginx /medya/    → ${KOD2:-bağlanamadı}"
    HATA=1
  fi
fi

# (c) Ana sayfa gerçekten afişi mi çiziyor?
SAYFA=$(curl -s --max-time 40 "$SUNUCU_ADRES/" || true)
AFIS_SAYISI=$(printf '%s' "$SAYFA" | grep -o 'site%2Fbanner\|site/banner' | wc -l | tr -d ' ')
if [ "${AFIS_SAYISI:-0}" -gt 0 ]; then
  bilgi "ana sayfa: $AFIS_SAYISI site görseli adresi ✓"
else
  hata "ana sayfa hiç site görseli çizmiyor — afiş yine ürün fotoğrafı yedeğinde."
  HATA=1
fi

if [ "$HATA" -eq 0 ]; then
  printf '\n\033[1;32m✅ Medya yolu uçtan uca çalışıyor.\033[0m\n\n'
else
  printf '\n\033[1;31m✗ Bir yer hâlâ kırık — yukarıdaki ✗ satırları hangi halkanın koptuğunu söylüyor.\033[0m\n\n'
  exit 1
fi
