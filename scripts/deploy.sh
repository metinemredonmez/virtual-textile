#!/usr/bin/env bash
#
# ═══════════════════════════════════════════════════════════════════════════
#  ÜRETİM DAĞITIMI — virtual-textile
#
#  Sunucuda, kök dizinde çalıştırılır:
#      /var/www/virtual/scripts/deploy.sh
#
#  ⚠️ DOCKER YOK. Sunucuda PostgreSQL, Redis ve Node doğrudan makinede kurulu;
#     süreçleri PM2 yönetir (bkz. ecosystem.config.cjs, docs/deployment.md).
#
#  Bu betikteki her kontrol, bu projede GERÇEKTEN yaşanmış bir arızadan
#  doğdu. Hiçbiri "olur da" diye eklenmedi; her birinin altında yazan
#  gerekçe bir kez canımızı yaktı.
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Ayarlar ────────────────────────────────────────────────────────────────
KOK="${VT_KOK:-/var/www/virtual}"
ENV_DOSYASI="${VT_ENV:-/etc/virtual-textile/api.env}"
YEDEK_DIZINI="${VT_YEDEK:-/var/backups/virtual-textile}"
DAL="${VT_DAL:-main}"
SAGLIK_DENEME=15          # 15 × 2 sn = 30 sn tolerans
SAGLIK_BEKLEME=2

# Bayraklar
YEDEK_ATLA=0
BUILD_ATLA=0
TOPOLOJI_GOCU=0

for arg in "$@"; do
  case "$arg" in
    --yedeksiz)          YEDEK_ATLA=1 ;;
    --build-atla)        BUILD_ATLA=1 ;;
    --worker-topoloji-goc) TOPOLOJI_GOCU=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -20
      echo
      echo "Bayraklar:"
      echo "  --yedeksiz             veritabanı yedeğini atla (ÖNERİLMEZ)"
      echo "  --build-atla           yalnızca migration + reload"
      echo "  --worker-topoloji-goc  eski tek vt-worker'ı core/media ikilisine geçir"
      exit 0 ;;
    *) echo "Bilinmeyen bayrak: $arg" >&2; exit 2 ;;
  esac
done

# ── Yardımcılar ────────────────────────────────────────────────────────────
adim()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
bilgi() { printf '  %s\n' "$*"; }
uyari() { printf '\033[1;33m  ⚠️  %s\033[0m\n' "$*"; }
hata()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; }

ONCEKI_COMMIT=""

hata_tuzagi() {
  local kod=$?
  [ "$kod" -eq 0 ] && return 0
  printf '\n\033[1;31m═══ DAĞITIM DURDU (çıkış kodu %s) ═══\033[0m\n' "$kod" >&2
  if [ -n "$ONCEKI_COMMIT" ]; then
    cat >&2 <<GERI
  Kod geri alma:
      cd $KOK && git reset --hard $ONCEKI_COMMIT && pnpm install --frozen-lockfile
      pnpm exec turbo run build --filter @vt/api --filter @vt/worker
      pm2 reload vt-api && pm2 reload all

  ⚠️ VERİTABANI GERİ ALINMAZ. Migration'lar ileri yönlüdür.
     Bu turdaki migration'lar EKLEMELİdir (yeni tablo / yeni enum değeri),
     bu yüzden ESKİ KOD YENİ ŞEMAYLA ÇALIŞIR — kodu geri almak güvenlidir.
     Bu her zaman doğru DEĞİLDİR: kolon silen ya da tip daraltan bir
     migration'dan sonra kodu geri almak uygulamayı kırar. O durumda
     yedekten dönmek gerekir:
         $YEDEK_DIZINI/  (en son pre-deploy-*.sql.gz)
GERI
  fi
  exit "$kod"
}
trap hata_tuzagi EXIT

# `DATABASE_URL`i KABUĞA yazmayan çalıştırıcı.
#
# ⚠️ BU FONKSİYONUN VARLIK SEBEBİ GERÇEK BİR OLAY: bir dağıtım betiği
#    `set -a; . api.env` yapmıştı. Değişken kabuğa yayıldı, ardından BAŞKA bir
#    projenin dağıtımı aynı kabukta koştu ve `dotenv` var olan değişkenin
#    üzerine YAZMADIĞI için o projenin migration'ları BİZİM veritabanımıza
#    uygulanmaya çalıştı. Bugün hâlâ temizlediğimiz bir kalıntı bıraktı.
#    Değişken burada yalnızca TEK KOMUTUN ömrü boyunca yaşar.
db_ile() {
  local url
  url=$(grep '^DATABASE_URL=' "$ENV_DOSYASI" | cut -d= -f2- | tr -d '"')
  [ -n "$url" ] || { hata "DATABASE_URL $ENV_DOSYASI içinde bulunamadı"; return 1; }
  DATABASE_URL="$url" "$@"
}

# ═══════════════════════════════════════════════════════════════════════════
adim "1/9  Uçuş öncesi kontroller"

[ -d "$KOK/.git" ]   || { hata "$KOK bir git deposu değil"; exit 1; }
[ -r "$ENV_DOSYASI" ] || { hata "$ENV_DOSYASI okunamıyor"; exit 1; }
command -v pnpm >/dev/null || { hata "pnpm bulunamadı"; exit 1; }
command -v pm2  >/dev/null || { hata "pm2 bulunamadı"; exit 1; }

cd "$KOK"

# Sunucuda elle yapılmış düzeltmeler `git reset --hard` ile SESSİZCE silinir.
# Silinmeden önce görünsün.
if [ -n "$(git status --porcelain)" ]; then
  uyari "Çalışma ağacı temiz değil — aşağıdakiler KAYBOLACAK:"
  git status --short | sed 's/^/      /'
  read -r -p "  Devam edilsin mi? [e/H] " yanit
  [ "$yanit" = "e" ] || [ "$yanit" = "E" ] || { hata "İptal edildi"; exit 1; }
fi

# ⚠️ WEB ORTAMI DERLEMEDEN ÖNCE YERİNDE OLMALI.
#    `NEXT_PUBLIC_*` değerleri `next build` sırasında pakete GÖMÜLÜR. Bağ
#    kopukken derlersek paket boş değerlerle çıkar, derleme YEŞİL döner ve hata
#    ancak kullanıcı kırık görsel gördüğünde anlaşılır. Kontrol build'den önce.
if [ -d "$KOK/apps/web" ]; then
  if [ ! -e "$KOK/apps/web/.env.production" ]; then
    hata "apps/web/.env.production yok. Bir kez kurun:"
    hata "    ln -sfn /etc/virtual-textile/web.env $KOK/apps/web/.env.production"
    exit 1
  fi
  for anahtar in API_URL APP_URL SESSION_SECRET; do
    grep -q "^$anahtar=" "$KOK/apps/web/.env.production" \
      || { hata "web ortamında $anahtar eksik"; exit 1; }
  done
  bilgi "web ortamı yerinde"
fi

BOS_MB=$(df -Pm "$KOK" | awk 'NR==2 {print $4}')
[ "$BOS_MB" -gt 2048 ] || uyari "Disk alanı düşük: ${BOS_MB} MB"

KULLANILABILIR_MB=$(free -m | awk '/^Mem:/ {print $7}')
bilgi "Disk: ${BOS_MB} MB boş · Bellek: ${KULLANILABILIR_MB} MB kullanılabilir"

PORT=$(grep '^PORT=' "$ENV_DOSYASI" | cut -d= -f2- | tr -d '"')
PORT="${PORT:-3010}"

# ═══════════════════════════════════════════════════════════════════════════
adim "2/9  Kod çekiliyor ($DAL)"

ONCEKI_COMMIT=$(git rev-parse HEAD)
bilgi "önceki : $(git log --oneline -1)"

git fetch origin "$DAL" --quiet
git reset --hard "origin/$DAL" --quiet

bilgi "yeni   : $(git log --oneline -1)"

if [ "$ONCEKI_COMMIT" = "$(git rev-parse HEAD)" ]; then
  bilgi "(değişiklik yok — yine de derlenip yeniden yüklenecek)"
fi

# ═══════════════════════════════════════════════════════════════════════════
adim "3/9  Bağımlılıklar"

# ⚠️ `--frozen-lockfile` ZORUNLU. Onsuz pnpm lockfile'ı sunucuda GÜNCELLER ve
#    sunucu, CI'da test edilenden FARKLI sürümlerle çalışmaya başlar. Aradaki
#    fark bir gün bir hata olarak döner ve yerelde asla üretilemez.
pnpm install --frozen-lockfile

# ═══════════════════════════════════════════════════════════════════════════
adim "4/9  Prisma istemcisi"

db_ile pnpm --filter @vt/db exec prisma generate >/dev/null
bilgi "üretildi"

# ═══════════════════════════════════════════════════════════════════════════
if [ "$YEDEK_ATLA" -eq 1 ]; then
  adim "5/9  Veritabanı yedeği — ATLANDI (--yedeksiz)"
  uyari "Migration geri alınamaz; yedeksiz ilerliyorsun."
else
  adim "5/9  Veritabanı yedeği"

  mkdir -p "$YEDEK_DIZINI"
  DAMGA=$(date +%Y%m%d-%H%M%S)
  YEDEK="$YEDEK_DIZINI/pre-deploy-$DAMGA.sql.gz"

  # ⚠️ `?schema=public` SÖKÜLÜR. Prisma'ya özgü bu sorgu parametresini pg_dump
  #    KABUL ETMEZ ("invalid URI query parameter") ve boru hattı sessizce BOŞ
  #    bir dosya üretir.
  DB_URL_HAM=$(grep '^DATABASE_URL=' "$ENV_DOSYASI" | cut -d= -f2- | tr -d '"')
  pg_dump "${DB_URL_HAM%%\?*}" | gzip > "$YEDEK"

  # ⚠️ YEDEK DOĞRULANMADAN GEÇİLMEZ — VE `gzip -t` YETMEZ.
  #    Bu tam olarak yaşandı: pg_dump hata verdi, 20 baytlık boş bir .gz kaldı,
  #    `gzip -t` ona "OK" dedi. Geçerli biçimde SIKIŞTIRILMIŞ HİÇLİK. Yedeğin
  #    var olduğunu değil, İÇİNDE VERİ olduğunu kanıtlamak gerekir.
  TABLO_SAYISI=$(zcat "$YEDEK" | grep -c '^CREATE TABLE' || true)
  VERI_BLOGU=$(zcat "$YEDEK" | grep -c '^COPY ' || true)

  if [ "$TABLO_SAYISI" -lt 10 ] || [ "$VERI_BLOGU" -lt 10 ]; then
    hata "Yedek şüpheli: $TABLO_SAYISI tablo, $VERI_BLOGU veri bloğu ($YEDEK)"
    hata "Dağıtım durduruldu — yedeksiz migration uygulanmaz."
    exit 1
  fi

  bilgi "$(du -h "$YEDEK" | cut -f1) · $TABLO_SAYISI tablo · $VERI_BLOGU veri bloğu"
  bilgi "$YEDEK"

  # 30 günden eski yedekler temizlenir; disk sessizce dolmasın.
  find "$YEDEK_DIZINI" -name 'pre-deploy-*.sql.gz' -mtime +30 -delete 2>/dev/null || true
fi

# ═══════════════════════════════════════════════════════════════════════════
adim "6/9  Migration"

# ⚠️ ÖNCE DURUM. `migrate deploy` başarısız bir migration kaydı görünce
#    reddeder ve hata metni ilk bakışta anlaşılmaz. Bu gerçekten oldu: BAŞKA
#    bir projenin migration'ı bizim veritabanımızda başarısız kayıt bırakmıştı
#    (0 adım uygulamış, yani şemaya dokunmamıştı) ve bizim migration'larımızı
#    haftalarca bloklayabilirdi. Durumu ÖNCE göstermek, o kaydı hata mesajının
#    içinde aramaktan iyidir.
if ! db_ile pnpm --filter @vt/db exec prisma migrate status 2>&1 | tee /tmp/vt-migrate-status.log; then
  if grep -q 'not found locally\|failed to apply' /tmp/vt-migrate-status.log; then
    hata "Veritabanında bu depoya AİT OLMAYAN ya da BAŞARISIZ bir migration kaydı var."
    hata "Yukarıdaki isme bak. Yabancı/başarısız bir kayıtsa (applied_steps_count = 0):"
    hata "    db_ile prisma migrate resolve --rolled-back <migration_adı>"
    hata "Şemaya GERÇEKTEN dokunmuş bir kayıtsa önce ne yaptığını çöz — körlemesine resolve etme."
    exit 1
  fi
fi

db_ile pnpm --filter @vt/db exec prisma migrate deploy

# ═══════════════════════════════════════════════════════════════════════════
if [ "$BUILD_ATLA" -eq 1 ]; then
  adim "7/9  Derleme — ATLANDI (--build-atla)"
else
  adim "7/9  Derleme"

  # ⚠️ `--force`: turbo önbelleği bu makinede yanıltıcı olabilir. Dağıtım
  #    ayda birkaç kez koşar; kazanılan saniyeler, "derlendi sanılan ama
  #    derlenmemiş" bir sürümün bedelini karşılamaz.
  pnpm exec turbo run build --force

  # ⚠️ ESER DOĞRULAMASI — DERLEMENİN BAŞARILI DÖNMESİ YETMEZ.
  #    Bu tam olarak yaşandı: `nest build` dist'i siliyor ama tsbuildinfo
  #    dist'in DIŞINDA kalıyordu; tsc "değişiklik yok" deyip HİÇBİR ŞEY
  #    üretmeden BAŞARIYLA döndü. Uygulama hiç açılmadı, sebebi günlerce
  #    anlaşılmadı. Çıkış kodu değil, DOSYA sorulur.
  for eser in apps/api/dist/main.js apps/worker/dist/main.js; do
    [ -s "$eser" ] || { hata "Derleme başarılı döndü ama $eser yok/boş"; exit 1; }
    bilgi "$eser ($(du -h "$eser" | cut -f1))"
  done

  # ── Frontend ────────────────────────────────────────────────────────────
  if [ -d apps/web ]; then
    # Next.js için gerçek eser BUILD_ID'dir; `.next/` klasörü başarısız bir
    # derlemeden sonra da yarım hâlde durabilir.
    if [ -s apps/web/.next/BUILD_ID ]; then
      bilgi "apps/web/.next (BUILD_ID: $(cat apps/web/.next/BUILD_ID))"
    else
      hata "apps/web derlendi ama .next/BUILD_ID yok — derleme yarım kalmış"
      exit 1
    fi

    # ⚠️ SIR PAKETE GÖMÜLDÜ MÜ — DERLEMENİN YEŞİL DÖNMESİ YETMEZ.
    #    `@vt/contracts` ve `@vt/config` çift çıktı veriyor (CJS backend, ESM
    #    tarayıcı) ki `env.ts` ağaç sarsmayla düşsün ve sır ADLARI istemci
    #    paketine girmesin. Bu yapılandırma bir gün bozulursa derleme yine
    #    başarılı döner; tek işaret bu kontroldür.
    if ! pnpm --filter @vt/web run verify:bundle >/dev/null 2>&1; then
      hata "İstemci paketinde sır adı bulundu — dağıtım durduruldu."
      hata "  pnpm --filter @vt/web run verify:bundle   (ayrıntı için elle çalıştır)"
      exit 1
    fi
    bilgi "istemci paketi temiz (verify:bundle)"
  else
    bilgi "apps/web yok — frontend adımı atlandı"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
adim "8/9  PM2"

PM2_ADLAR=$(pm2 jlist 2>/dev/null | tr ',' '\n' | grep -o '"name":"vt-[^"]*"' | cut -d'"' -f4 | sort -u || true)
bilgi "çalışan: $(echo "$PM2_ADLAR" | tr '\n' ' ')"

# ⚠️ ÇİFT CRON TEHLİKESİ.
#    Eski topolojide tek bir `vt-worker` vardı (WORKER_ROLE varsayılanı 'all'
#    → cron ÇALIŞTIRIR). ecosystem.config.cjs ise `vt-worker-core` (yine cron
#    çalıştırır) + `vt-worker-media` tanımlıyor. İkisi AYNI ANDA ayaktaysa
#    zamanlanmış işler İKİ KEZ koşar:
#      · aynı fotoğraf iki kez silinmeye çalışılır,
#      · aynı rezervasyon iki kez serbest bırakılır → STOK İKİ KEZ ARTAR,
#      · hesap silme ve veri indirme işleri birbirinin üstüne biner.
#    Stok hatası paraya dokunur ve sessizdir. Bu yüzden geçiş OTOMATİK
#    YAPILMAZ; açıkça istenmelidir.
ESKI_WORKER=$(echo "$PM2_ADLAR" | grep -x 'vt-worker' || true)

if [ -n "$ESKI_WORKER" ] && [ "$TOPOLOJI_GOCU" -eq 0 ]; then
  uyari "Eski tek 'vt-worker' çalışıyor; ecosystem.config.cjs core/media ayrımı tanımlıyor."
  uyari "ŞU AN GÜVENLİ: yalnızca var olan süreçler yeniden yükleniyor, yeni rol AÇILMIYOR."
  uyari "Ayrıma geçmek istediğinde:  $0 --worker-topoloji-goc"

  pm2 reload vt-api --update-env
  pm2 reload vt-worker --update-env

elif [ -n "$ESKI_WORKER" ] && [ "$TOPOLOJI_GOCU" -eq 1 ]; then
  uyari "Topoloji göçü: vt-worker → vt-worker-core + vt-worker-media"
  # ⚠️ SIRA ÖNEMLİ: önce eskisi DURDURULUR, sonra yenileri açılır. Ters sırada
  #    ikisi bir an için birlikte çalışır ve o an cron penceresine denk
  #    gelirse yukarıdaki çift çalıştırma gerçekleşir.
  pm2 delete vt-worker
  pm2 start ecosystem.config.cjs --env production --only vt-worker-core,vt-worker-media
  pm2 reload vt-api --update-env
  pm2 save

else
  pm2 reload ecosystem.config.cjs --env production --update-env
fi

# ═══════════════════════════════════════════════════════════════════════════
adim "9/9  Sağlık kontrolü"

# ⚠️ SAĞLIK UCU KİMLİK İSTEMEMELİ. Bir kez `@Public()` unutuldu ve /health
#    401 döndü; load balancer ile systemd sağlıksız sanıp süreci sonsuz
#    yeniden başlatma döngüsüne sokardı. Bu yüzden JETONSUZ sorulur ve
#    yalnızca 200 kabul edilir.
SAGLIKLI=0
for _ in $(seq "$SAGLIK_DENEME"); do
  KOD=$(curl -s -o /tmp/vt-health.json -w '%{http_code}' \
        --max-time 5 "http://127.0.0.1:$PORT/health" || true)
  if [ "$KOD" = "200" ]; then SAGLIKLI=1; break; fi
  sleep "$SAGLIK_BEKLEME"
done

if [ "$SAGLIKLI" -ne 1 ]; then
  hata "API $((SAGLIK_DENEME * SAGLIK_BEKLEME)) sn içinde sağlıklı yanıt vermedi (son kod: ${KOD:-yok})"
  hata "Log:  pm2 logs vt-api --lines 50 --nostream"
  exit 1
fi
bilgi "GET /health → 200"

# Dışarıdan da bak: nginx ile PM2 arasındaki bağ kopmuş olabilir ve bu,
# yalnızca 127.0.0.1'e sorulduğunda GÖRÜNMEZ.
DIS_KOD=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/health || true)
if [ "$DIS_KOD" = "200" ]; then
  bilgi "nginx :80 → 200"
else
  uyari "nginx üzerinden /health → ${DIS_KOD:-yanıt yok}  (nginx -t && systemctl reload nginx)"
fi

# Worker gerçekten ayakta mı — 'online' yetmez, ÇÖKÜP DURUYOR olabilir.
pm2 jlist 2>/dev/null | tr '}' '\n' | grep -o '"name":"vt-[^"]*".*"status":"[^"]*"' | while read -r satir; do
  ad=$(echo "$satir" | grep -o '"name":"vt-[^"]*"' | cut -d'"' -f4)
  durum=$(echo "$satir" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  [ "$durum" = "online" ] || uyari "$ad durumu: $durum"
done

trap - EXIT
printf '\n\033[1;32m✓ Dağıtım tamam — %s\033[0m\n\n' "$(git log --oneline -1)"
