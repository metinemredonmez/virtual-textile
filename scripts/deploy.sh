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

# ⚠️ apps/web'in dinlediği port. `ecosystem.config.cjs` ile AYNI olmak zorunda.
#    3000 DEĞİL: bu makinede dört proje barınıyor ve 3000 başka bir projenin
#    Next sunucusunda. Bir kez 3000 varsayıldı ve nginx bizim adresimizden
#    KOMŞU PROJENİN panelini servis etti — kimse hata görmedi, sayfa 200 döndü.
WEB_PORT="${VT_WEB_PORT:-3020}"

# ⚠️ KABUKTAN MİRAS ALINMAMASI GEREKEN DEĞİŞKENLER.
#
#    Next.js `.env.production` dosyasını var olan `process.env` ÜZERİNE YAZMAZ —
#    bu belgelenmiş ve bilinçli bir davranıştır. Dolayısıyla kabukta kirli bir
#    değer varsa uygulamanın kendi yapılandırması SESSİZCE ezilir.
#
#    ⚠️ BU GERÇEKTEN OLDU VE SİTEYİ KIRDI: `api.env` içinde API'nin kendi
#       `APP_URL`i var (`:3000` ekli). Bir yerde kabuğa export edilmiş, PM2 onu
#       miras almış ve `vt-web` süreci `APP_URL=http://91.99.183.64:3000`
#       görmüş. CSRF denetimi tarayıcının `Origin: http://91.99.183.64`
#       başlığını bununla karşılaştırıp reddetti: HER POST 403 döndü. Kayıt,
#       giriş, sepete ekleme, ödeme — hiçbiri çalışmadı. Sayfalar 200 döndüğü
#       için dışarıdan site SAĞLIKLI görünüyordu.
#
#    Aynı kirlilik daha önce `DATABASE_URL` üzerinden başka bir projenin
#    migration'larını bizim veritabanımıza uygulatmıştı. Kalıp aynı: kabuk
#    ortamı, dosyadaki yapılandırmayı yener.
VT_WEB_MIRAS_ALINMAZ=(APP_URL API_URL SESSION_REDIS_URL SESSION_SECRET NEXT_PUBLIC_MEDIA_URL NODE_ENV)

# `vt-web` süreci PM2'de yoksa BAŞLATIR, varsa yeniden yükler.
#
# ⚠️ VARLIK SEBEBİ BİR HATA: eski tek `vt-worker` topolojisindeki dal yalnızca
#    `vt-api` ve `vt-worker`ı yeniden yüklüyor, `vt-web`e HİÇ DOKUNMUYORDU.
#    Sonuç: web derleniyor (BUILD_ID yerinde), dağıtım "başarılı" diyor, ama
#    süreç hiç açılmıyor. Port boş kaldığı için nginx isteği KOMŞU PROJEYE
#    düşürdü ve dışarıdan bakınca site ÇALIŞIYOR göründü — 200 dönüyordu.
web_baslat_veya_yukle() {
  [ -d "$KOK/apps/web" ] || { bilgi "apps/web yok — web süreci atlandı"; return 0; }

  # `env -u` ile kirli değişkenler SİLİNEREK çağrılır; süreç onları
  # `.env.production`dan okumak ZORUNDA kalır.
  local temiz=(env)
  local ad
  for ad in "${VT_WEB_MIRAS_ALINMAZ[@]}"; do temiz+=("-u" "$ad"); done

  if pm2 describe vt-web >/dev/null 2>&1; then
    # ⚠️ `pm2 reload vt-web --update-env` YETMEZ ve ZARARLIDIR: `--update-env`
    #    O ANKİ KABUK ortamını sürece basar, yani kirliliği taze taze geri
    #    getirir. Ayrıca ecosystem dosyası verilmediği için `env_production`
    #    bloğu (NODE_ENV=production) uygulanmaz — süreç `NODE_ENV=staging`
    #    ile kaldı ve Next bunu "non-standard NODE_ENV" diye uyardı.
    "${temiz[@]}" pm2 reload ecosystem.config.cjs --env production --only vt-web --update-env
  else
    bilgi "vt-web ilk kez başlatılıyor"
    "${temiz[@]}" pm2 start ecosystem.config.cjs --env production --only vt-web
  fi

  # ⚠️ ÖLÇ, VARSAYMA. Yukarıdaki temizlik sessizce başarısız olabilir (PM2
  #    daemon'ın kendi ortamı da mirasa karışır). Sürecin GERÇEKTEN gördüğü
  #    değeri okuyup dosyadakiyle karşılaştır.
  local pid beklenen goruluyor
  pid=$(pm2 pid vt-web 2>/dev/null | tr -d '[:space:]')
  beklenen=$(grep '^APP_URL=' "$KOK/apps/web/.env.production" | cut -d= -f2- | tr -d '"')

  if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
    goruluyor=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^APP_URL=' | cut -d= -f2- || true)
    if [ -n "$goruluyor" ] && [ "$goruluyor" != "$beklenen" ]; then
      hata "vt-web YANLIŞ APP_URL ile çalışıyor — CSRF her POST'u reddeder."
      hata "    dosyada : $beklenen"
      hata "    süreçte : $goruluyor"
      hata "Kirlilik KABUKTA DEĞİL, PM2 DAEMON'ında. Çözüm:"
      hata "    cd $KOK && git pull    # ecosystem.config.cjs değeri AÇIKÇA verir"
      hata "    pm2 delete vt-web && ./scripts/deploy.sh"
      hata ""
      # ⚠️ BU SATIR BİR DÜZELTMEDİR. Burada eskiden `pm2 kill` yazıyordu ve
      #    O TAVSİYE YANLIŞTI: daemon'ı öldürmek bu makinedeki DİĞER ÜÇ
      #    PROJEYİ (celine-*, od-*) de düşürür. Bir kez yapıldı ve komşu
      #    projeler gitti; `pm2 resurrect` ile geri getirildi.
      hata "⚠️ 'pm2 kill' KULLANMA — bu makinede üç proje daha var, hepsi düşer."
      hata "   'pm2 delete vt-web' yalnız bizim süreci kaldırır, komşulara dokunmaz."
      exit 1
    fi
    bilgi "vt-web APP_URL doğrulandı: ${goruluyor:-$beklenen}"
  fi
}

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
# ⚠️ İKİ FARKLI DURUM, İKİ FARKLI SONUÇ — karıştırmak yanlış alarm üretir.
#    `git reset --hard` yalnızca İZLENEN dosyalardaki değişiklikleri geri alır;
#    izlenmeyen (`??`) dosyalara DOKUNMAZ. Burada bir dönem hepsi "KAYBOLACAK"
#    diye gösteriliyordu ve sunucuda kazara oluşmuş dört boş dosya yüzünden
#    dağıtım gereksiz yere onay bekledi.
DEGISEN=$(git status --porcelain | grep -v '^??' || true)
IZLENMEYEN=$(git status --porcelain | grep '^??' || true)

if [ -n "$IZLENMEYEN" ]; then
  uyari "İzlenmeyen dosyalar var (KORUNACAK, silinmez):"
  echo "$IZLENMEYEN" | sed 's/^/      /'
fi

if [ -n "$DEGISEN" ]; then
  uyari "İzlenen dosyalarda değişiklik var — BUNLAR KAYBOLACAK:"
  echo "$DEGISEN" | sed 's/^/      /'
  read -r -p "  Devam edilsin mi? [e/H] " yanit
  [ "$yanit" = "e" ] || [ "$yanit" = "E" ] || { hata "İptal edildi"; exit 1; }
fi

# ⚠️ WEB ORTAMI DERLEMEDEN ÖNCE YERİNDE OLMALI.
#    `NEXT_PUBLIC_*` değerleri `next build` sırasında pakete GÖMÜLÜR. Bağ
#    kopukken derlersek paket boş değerlerle çıkar, derleme YEŞİL döner ve hata
#    ancak kullanıcı kırık görsel gördüğünde anlaşılır. Kontrol build'den önce.
# ⚠️ PORT ÇAKIŞMASI — BU MAKİNEDE DÖRT PROJE BARINIYOR.
#    Portu "boş sayıp" nginx'i oraya yönlendirmek, komşu projenin uygulamasını
#    bizim adresimizden servis etmek demektir. Bu GERÇEKTEN oldu: 3000
#    varsayıldı, orada başka bir Next sunucusu vardı, site 200 döndü ve
#    yanlış uygulama görüntülendi. Sessiz arıza; kimse fark etmez.
#
#    Kontrol: port ya BOŞ olmalı ya da SAHİBİ BİZ olmalıyız (vt-web zaten
#    çalışıyor). Başkasınınsa dağıtım DURUR.
if [ -d "$KOK/apps/web" ]; then
  PORT_SAHIBI=$(ss -lntp 2>/dev/null | grep -E "[:.]${WEB_PORT}\b" | head -1 || true)
  if [ -n "$PORT_SAHIBI" ] && ! pm2 describe vt-web >/dev/null 2>&1; then
    hata "Port $WEB_PORT DOLU ve sahibi vt-web değil:"
    hata "    $PORT_SAHIBI"
    hata "Boş bir port seçip İKİ yerde birden güncelleyin:"
    hata "    ecosystem.config.cjs → vt-web args"
    hata "    infra/nginx/vt.conf  → proxy_pass (İKİ location)"
    hata "Ya da geçici olarak: VT_WEB_PORT=<port> $0"
    exit 1
  fi
  bilgi "web portu $WEB_PORT uygun"
fi

if [ -d "$KOK/apps/web" ]; then
  if [ ! -e "$KOK/apps/web/.env.production" ]; then
    hata "apps/web/.env.production yok. Bir kez kurun:"
    hata "    ln -sfn /etc/virtual-textile/web.env $KOK/apps/web/.env.production"
    exit 1
  fi
  # ⚠️ NEXT_PUBLIC_MEDIA_URL BU LİSTEDE: değeri `next build` sırasında pakete
  #    GÖMÜLÜR. Eksikse `mediaUrl()` her anahtara `null` döndürür ve site
  #    GÖRSELSİZ derlenir — derleme yeşil, sayfa 200, tek belirti kırık vitrin.
  for anahtar in API_URL APP_URL SESSION_SECRET NEXT_PUBLIC_MEDIA_URL; do
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
adim "2b/9  Medya kökü ve nginx önbelleği"
#
# ⚠️ SIRA: KOD ÇEKİLDİKTEN SONRA, DERLEMEDEN ÖNCE. Sonra olmalı çünkü aşağıdaki
#    karşılaştırma DEPODAKİ nginx dosyalarını okur ve onlar bu adımdan önce
#    güncellenmiş olmalı. Önce olmalı çünkü `NEXT_PUBLIC_MEDIA_URL` `next build`
#    sırasında pakete GÖMÜLÜR — yanlışsa derlemeye hiç girmemek gerekir.
#
# ⚠️ BU BLOK BİR ARIZADAN DOĞDU: `pub-<hash>.r2.dev` Cloudflare'in GELİŞTİRME
#    adresidir ve hız sınırlıdır. Ölçüldü — aynı anahtara 8 istekte 4'ü TLS el
#    sıkışmasında düşüyor (curl çıkış kodu 35, 429 değil). Çözüm: görseller
#    kendi nginx'imizden önbelleklenerek servis edilir (`/medya/`).
#    Gerekçe ve ölçümler: docs/medya-dagitimi.md
#
# Burada iki şey KANITLANIR, varsayılmaz:
#   1. Medya kökü BİZE bakıyorsa nginx tarafı GERÇEKTEN kurulu mu,
#   2. Depodaki nginx dosyaları sunucudakiyle aynı mı.
MEDYA_KOK=""
MEDYA_YOLU=""
if [ -r "$KOK/apps/web/.env.production" ]; then
  MEDYA_KOK=$(grep '^NEXT_PUBLIC_MEDIA_URL=' "$KOK/apps/web/.env.production" | cut -d= -f2- | tr -d '"')
fi

# Kök `/medya` taşıyorsa önbellek yolu KULLANILIYOR demektir.
case "$MEDYA_KOK" in
  */medya|*/medya/) MEDYA_YOLU=1 ;;
esac

# ⚠️ GÖRELİ ADRES SESSİZCE KIRAR. Next `/` ile başlayan `src`i YEREL sayıp
#    kendi istek işleyicisine yönlendirir; nginx'i hiç görmez ve her görsel
#    404 olur. Derleme ve testler bunu göremez.
case "$MEDYA_KOK" in
  /*) hata "NEXT_PUBLIC_MEDIA_URL GÖRELİ ($MEDYA_KOK) — mutlak olmalı."
      hata "    doğrusu: http://91.99.183.64/medya"
      exit 1 ;;
esac

if [ -n "$MEDYA_YOLU" ]; then
  bilgi "medya kökü bize bakıyor: $MEDYA_KOK"

  # ⚠️ ÖNBELLEK DİZİNİ — YOKSA nginx `location /medya/`yı hiç servis edemez.
  #    `proxy_cache_path` dizini kendi yaratabilir ama ÜST dizin ve sahiplik
  #    tutmazsa nginx başlangıçta düşer.
  if [ "$(id -u)" = "0" ]; then
    if [ ! -d /var/cache/nginx/vt-medya ]; then
      install -d -o www-data -g www-data -m 0700 /var/cache/nginx/vt-medya
      bilgi "/var/cache/nginx/vt-medya oluşturuldu (soğuk önbellek)"
    else
      bilgi "/var/cache/nginx/vt-medya var ($(du -sh /var/cache/nginx/vt-medya 2>/dev/null | cut -f1))"
    fi
  else
    uyari "root değilsin — önbellek dizini kontrol edilemedi. Bir kez:"
    uyari "    sudo install -d -o www-data -g www-data -m 0700 /var/cache/nginx/vt-medya"
  fi

  # ⚠️ HAVUZ TANIMI OLMADAN `location /medya/` `nginx -t`i düşürür
  #    ("zone vt_medya not found"). Yani env çevrilmiş ama conf.d dosyası
  #    kopyalanmamışsa TÜM SİTE görselsiz kalır. Bunu dağıtımdan önce söyle.
  if [ ! -r /etc/nginx/conf.d/vt-cache.conf ]; then
    hata "NEXT_PUBLIC_MEDIA_URL /medya'ya bakıyor ama nginx önbellek havuzu KURULU DEĞİL."
    hata "    /etc/nginx/conf.d/vt-cache.conf yok → her ürün görseli 404 olur."
    hata "Bir kez kurun:"
    hata "    cp $KOK/infra/nginx/vt-cache.conf /etc/nginx/conf.d/vt-cache.conf"
    hata "    cp $KOK/infra/nginx/vt.conf       /etc/nginx/sites-available/vt"
    hata "    nginx -t && systemctl reload nginx"
    exit 1
  fi
else
  # ⚠️ BU ARTIK "ARALIKLI" DEĞİL, ÖLÇÜLMÜŞ BİR ARIZA. 2026-08-13 ölçümü:
  #    aynı anahtara 8 istek → 8 zaman aşımı (curl rc=28). TCP kuruluyor, TLS
  #    el sıkışması düşürülüyor; aynı anda cloudflare.com 200, R2'nin S3 ucu
  #    400 (yani kova ayakta). Yani r2.dev kökü ile site GÖRSELSİZ açılır.
  hata "NEXT_PUBLIC_MEDIA_URL doğrudan R2'ye bakıyor: ${MEDYA_KOK:-tanımsız}"
  hata "    r2.dev ölçüldü: 8 istekte 8 zaman aşımı — TÜM görseller kırılır."
  hata "    Doğrusu: /etc/virtual-textile/web.env içinde"
  hata "        NEXT_PUBLIC_MEDIA_URL=http://91.99.183.64/medya"
  hata "    (nginx /medya/ bloğu artık vt-api'nin /v1/media ucunu vekilliyor)"
  exit 1
fi

# ⚠️ nginx YAPILANDIRMASI DEPODA DEĞİŞİP SUNUCUDA GÜNCELLENMEMİŞ OLABİLİR.
#    `git reset --hard` dosyayı depoda günceller; /etc altındaki KOPYAYA
#    dokunmaz. Bu sessizliği bu betik kapatır: fark varsa yüksek sesle söyle.
#    ⚠️ Dağıtımı DURDURMAZ — nginx'i buradan reload etmek, çalışan siteyi
#       gözden geçirilmemiş bir yapılandırmayla değiştirmek olurdu.
nginx_farki_bildir() {
  local depo="$1" kurulu="$2"
  [ -r "$depo" ] || return 0
  if [ ! -r "$kurulu" ]; then
    uyari "nginx: $kurulu YOK (depoda $depo var)"
    uyari "    cp $depo $kurulu && nginx -t && systemctl reload nginx"
    return 0
  fi
  if ! cmp -s "$depo" "$kurulu"; then
    uyari "nginx yapılandırması DEĞİŞMİŞ ama sunucuya uygulanmamış:"
    uyari "    depo   : $depo"
    uyari "    kurulu : $kurulu"
    uyari "    cp $depo $kurulu && nginx -t && systemctl reload nginx"
    diff -u "$kurulu" "$depo" 2>/dev/null | head -20 | sed 's/^/      /' || true
  fi
}
nginx_farki_bildir "$KOK/infra/nginx/vt.conf"       /etc/nginx/sites-available/vt
nginx_farki_bildir "$KOK/infra/nginx/vt-cache.conf" /etc/nginx/conf.d/vt-cache.conf

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
  web_baslat_veya_yukle

elif [ -n "$ESKI_WORKER" ] && [ "$TOPOLOJI_GOCU" -eq 1 ]; then
  uyari "Topoloji göçü: vt-worker → vt-worker-core + vt-worker-media"
  # ⚠️ SIRA ÖNEMLİ: önce eskisi DURDURULUR, sonra yenileri açılır. Ters sırada
  #    ikisi bir an için birlikte çalışır ve o an cron penceresine denk
  #    gelirse yukarıdaki çift çalıştırma gerçekleşir.
  pm2 delete vt-worker
  pm2 start ecosystem.config.cjs --env production --only vt-worker-core,vt-worker-media
  pm2 reload vt-api --update-env
  web_baslat_veya_yukle
  pm2 save

else
  # ⚠️ `vt-web` BU KOMUTTAN HARİÇ TUTULUYOR VE SEBEBİ CANLIDA ÖLÇÜLDÜ.
  #
  #    `pm2 reload … --update-env` O ANKİ KABUK ORTAMINI sürece basar. Kabukta
  #    kirli bir `APP_URL` varsa (`api.env` içindeki `:3000`'li değer bir kez
  #    export edilmişti) `vt-web` onu miras alır ve CSRF denetimi her POST'u
  #    reddeder:
  #
  #        POST /api/auth/login → 403  "Bu işlem için yetkiniz yok"
  #        (istek no: vekil — `lib/api/csrf.ts` → `origin !== appUrl()`)
  #
  #    Sayfalar 200 döndüğü için site dışarıdan SAĞLIKLI görünür; kimse giriş
  #    yapamaz, kayıt olamaz, sepete ekleyemez.
  #
  #    ⚠️ ASIL KUSUR ŞUYDU: `web_baslat_veya_yukle` bu korumayı zaten yazıyordu
  #       (kirli değişkenleri `env -u` ile siler, sonra `/proc/<pid>/environ`
  #       okuyup DOĞRULAR) ama YALNIZCA eski-worker dallarından çağrılıyordu.
  #       Normal dağıtımda — yani HER GÜN koşan dalda — hiç çalışmıyordu.
  #       Yazılmış, test edilmiş, mutlu yolda ölü bir koruma.
  # ⚠️ `--update-env` KALDIRILDI VE SEBEBİ CANLIDA ÖLÇÜLDÜ.
  #
  #    Bu bayrak O ANKİ KABUK ORTAMINI sürece basar. Kabukta bir kez
  #    `NODE_ENV=production` export edilmişti; `vt-api` onu miras aldı ve
  #    `@vt/config` → `env.ts` üretim modunda ZORUNLU kıldığı anahtarları
  #    bulamayınca uygulama HİÇ AÇILMADI:
  #
  #        ✗ IYZICO_API_KEY: Üretim ortamında zorunlu…
  #        ✗ RESEND_API_KEY / SENTRY_DSN / CORS_ORIGINS …
  #        ORTAM DEĞİŞKENİ DOĞRULAMASI BAŞARISIZ — uygulama başlatılmadı
  #
  #    Bu sunucu STAGING (bkz. ecosystem.config.cjs → VT_CALISMA_MODU); o
  #    anahtarlar burada yok ve olmaması DOĞRU. Yani doğrulama haklıydı,
  #    yanlış olan ona verilen NODE_ENV'di.
  #
  # ⚠️ ARIZANIN SİNSİLİĞİ: küme iki örnekli. Biri ayakta kalıp diğeri çökünce
  #    istekler DÖNÜŞÜMLÜ dağılıyor — `POST /me/photos` 201 dönüyor, hemen
  #    ardından `confirm` düşüyor. Kullanıcı "bazen oluyor bazen olmuyor"
  #    görüyor ve hata fotoğraf akışında sanılıyor. `/health` de 200 dönüyordu,
  #    çünkü sağlıklı örneğe denk gelmişti.
  #
  #    Aynı gerekçe `web_baslat_veya_yukle` içinde vt-web için zaten yazılıydı;
  #    api/worker dalında uygulanmamıştı.
  pm2 reload ecosystem.config.cjs --env production --only vt-api,vt-worker-core,vt-worker-media
  web_baslat_veya_yukle
fi

# ═══════════════════════════════════════════════════════════════════════════
#  TOPOLOJİ UZLAŞTIRMA — `instances` değişikliği YÜRÜRLÜĞE GİRSİN
#
#  ⚠️ VARLIK SEBEBİ ÖLÇÜLMÜŞ BİR ARIZA. `ecosystem.config.cjs` içinde
#     `vt-api` 4'ten 2'ye, `vt-worker-media` 2'den 1'e indirildi, dağıtım
#     KOŞTU, "✓ Dağıtım tamam" yazdı — ve `pm2 list` hâlâ 4 + 2 gösterdi.
#
#     Sebep: `pm2 reload` var olan süreçleri YERİNDE yeniden başlatır;
#     `instances` alanını YENİDEN OKUMAZ. Yani ecosystem dosyasındaki her
#     örnek sayısı değişikliği SESSİZCE yok sayılıyordu. Bu deponun altı kez
#     yaşadığı sınıfın bir örneği daha: yazıldı, commit edildi, dağıtıldı —
#     ve hiçbir etkisi olmadı.
#
#  ⚠️ YALNIZCA vt-* DOKUNULUR. Bu makinede üç proje daha barınıyor
#     (celine-*, od-*). Aşağıdaki döngü adları ecosystem dosyamızdan okuyor,
#     `pm2 jlist`ten değil — yani bizim tanımlamadığımız bir sürece hiçbir
#     koşulda dokunamaz.
adim "8b/9  Süreç sayıları uzlaştırılıyor"

# İstenen sayılar ecosystem dosyasından; çalışanlar pm2'den.
ISTENEN=$(node -e "
  const c = require('$KOK/ecosystem.config.cjs');
  for (const a of c.apps) console.log(a.name, a.instances, a.exec_mode || 'fork');
" 2>/dev/null || true)

if [ -z "$ISTENEN" ]; then
  uyari "ecosystem.config.cjs okunamadı — süreç sayıları uzlaştırılmadı."
else
  while read -r AD ADET MOD; do
    [ -n "$AD" ] || continue
    # ⚠️ `'max'` gibi sayı olmayan değerler uzlaştırılmaz: kaç olması
    #    gerektiğini burada hesaplamak, PM2'nin işini ikinci bir yerde
    #    tekrar etmek olurdu ve ikisi ayrışırdı.
    case "$ADET" in ''|*[!0-9]*) continue ;; esac

    MEVCUT=$(pm2 jlist 2>/dev/null | node -e "
      let g='';process.stdin.on('data',d=>g+=d).on('end',()=>{
        try { console.log(JSON.parse(g).filter(p=>p.name==='$AD').length) }
        catch { console.log(0) }
      })" || echo 0)

    [ "$MEVCUT" = "$ADET" ] && { bilgi "$AD: $ADET ✓"; continue; }

    uyari "$AD: çalışan $MEVCUT, istenen $ADET — düzeltiliyor"

    if [ "$MOD" = "cluster" ]; then
      # ⚠️ `pm2 scale` YALNIZCA cluster modunda çalışır; fork modunda
      #    "app not in cluster mode" der ve hiçbir şey yapmaz.
      pm2 scale "$AD" "$ADET"
    else
      # ⚠️ FORK MODUNDA SİL-YENİDEN AÇ TEK YOL. Kısa bir kesinti doğar ve
      #    kabul edilebilir: bu roller kuyruk tüketicisi, işler Redis'te
      #    bekler, kaybolmaz. `vt-web` fork ama instances=1 olduğu için bu
      #    dala hiç girmez.
      pm2 delete "$AD" >/dev/null 2>&1 || true
      pm2 start "$KOK/ecosystem.config.cjs" --env production --only "$AD"
    fi
  done <<< "$ISTENEN"

  # ⚠️ `pm2 save` ZORUNLU: kaydedilmezse sunucu yeniden başladığında PM2
  #    ESKİ listeyi (4 + 2) diriltir ve uzlaştırma boşa gider.
  pm2 save >/dev/null 2>&1 || uyari "pm2 save başarısız — yeniden başlatmada eski liste dönebilir."
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

# ⚠️ WEB DE SORULUR — VE İÇİNE BAKILIR.
#    "200 döndü" yetmez: yanlış port yüzünden nginx KOMŞU PROJEYE düştüğünde de
#    200 dönüyordu. Bu yüzden yanıtın BİZİM uygulamamız olduğu, bize özgü bir
#    işaretle doğrulanır.
if [ -d "$KOK/apps/web" ]; then
  WEB_SAGLIKLI=0
  for _ in $(seq "$SAGLIK_DENEME"); do
    if curl -s --max-time 10 "http://127.0.0.1:$WEB_PORT/" -o /tmp/vt-web.html; then
      WEB_SAGLIKLI=1
      break
    fi
    sleep "$SAGLIK_BEKLEME"
  done

  if [ "$WEB_SAGLIKLI" -ne 1 ]; then
    hata "Web $((SAGLIK_DENEME * SAGLIK_BEKLEME)) sn içinde yanıt vermedi (port $WEB_PORT)"
    hata "Log:  pm2 logs vt-web --lines 50 --nostream"
    exit 1
  fi

  # `.tema-` sınıf öneki ve Türkçe gezinme metni bu uygulamaya özgüdür.
  if grep -qE 'tema-|Üzerimde Dene|Sanal deneme|virtual-textile' /tmp/vt-web.html; then
    bilgi "web :$WEB_PORT → BİZİM uygulama doğrulandı"
  else
    hata "Port $WEB_PORT yanıt veriyor ama içerik BİZİM uygulamamız DEĞİL."
    hata "Büyük ihtimalle port başka bir projeye ait. İlk 200 karakter:"
    head -c 200 /tmp/vt-web.html >&2; echo >&2
    exit 1
  fi
fi

# Dışarıdan da bak: nginx ile PM2 arasındaki bağ kopmuş olabilir ve bu,
# yalnızca doğrudan porta sorulduğunda GÖRÜNMEZ.
#
# ⚠️ `Host` BAŞLIĞI ŞART. Burada bir dönem düz `http://127.0.0.1/health`
#    çağrılıyordu ve HER dağıtımda 404 dönüyordu: nginx sunucu bloğunu
#    `server_name` ile seçer, bizimki `91.99.183.64` diyor, `127.0.0.1` ona
#    uymuyor ve istek makinedeki BAŞKA BİR PROJENİN varsayılan bloğuna
#    düşüyordu. Yani kontrol, kendi kurduğu tuzağa düşüp yanlış alarm üretti —
#    site çalışırken dağıtım "başarısız" dedi.
NGINX_HOST=$(grep '^APP_URL=' "$ENV_DOSYASI" | cut -d= -f2- | tr -d '"' | sed -E 's#^https?://##; s#/.*$##')
NGINX_HOST="${NGINX_HOST:-localhost}"

DIS_KOD=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
  -H "Host: $NGINX_HOST" "http://127.0.0.1/health" || true)

if [ "$DIS_KOD" = "200" ]; then
  bilgi "nginx :80 (Host: $NGINX_HOST) → 200"
else
  uyari "nginx üzerinden /health → ${DIS_KOD:-yanıt yok}"
  uyari "  Host: $NGINX_HOST ile soruldu. Sunucu bloğu bu adı tanıyor mu?"
  uyari "  nginx -t && systemctl reload nginx"
fi

# ── CSRF: GİRİŞ GERÇEKTEN ÇALIŞIYOR MU ─────────────────────────────────────
#
# ⚠️ BU KONTROL BİR KULLANICI ŞİKÂYETİNDEN DOĞDU, "olur da"dan değil.
#    Site açılıyordu, sayfalar 200 dönüyordu, /health yeşildi — ama giriş
#    formuna doğru şifre yazan kullanıcı şunu gördü:
#
#        "Bu işlem için yetkiniz yok."   (istek no: vekil)
#
#    Sebep: `vt-web` süreci kirli bir `APP_URL` miras almıştı ve
#    `lib/api/csrf.ts` → `origin !== appUrl()` HER POST'u reddediyordu.
#    Kayıt, giriş, sepete ekleme, ödeme — hiçbiri çalışmıyordu.
#
# ⚠️ SEBEBİ DEĞİL BELİRTİYİ ÖLÇÜYOR. Yukarıdaki `web_baslat_veya_yukle`
#    `APP_URL`i karşılaştırıyor (sebep); bu kontrol asıl soruyu soruyor:
#    "bir POST isteği CSRF'e takılıyor mu?" İkisi farklı şeyler — env doğru
#    görünüp `csrf.ts` mantığı bozulsaydı yalnızca bu kontrol yakalardı.
#
# ⚠️ KASTEN YANLIŞ ŞİFRE gönderiliyor. Beklenen cevap 401 (kimlik hatalı).
#    403 gelirse istek CSRF'e takılmış demektir — yani DOĞRU şifreyle de
#    takılırdı. Gerçek bir hesabın şifresini betiğe yazmak gerekmiyor.
# ── HER ÖRNEK GERÇEKTEN AYAKTA MI ─────────────────────────────────────────
#
# ⚠️ BU KONTROL BİR ARIZADAN DOĞDU: `vt-api` iki örnekli ve BİRİ ÇÖKÜP
#    DURUYORDU (kirli `NODE_ENV=production` → ortam doğrulaması başarısız →
#    "uygulama başlatılmadı"). Ama `/health` 200 dönüyordu, çünkü istek
#    sağlıklı örneğe denk gelmişti.
#
#    Kullanıcı tarafında bu "bazen oluyor bazen olmuyor" diye görünüyor:
#    `POST /me/photos` 201, hemen ardından `confirm` düşüyor. Hata fotoğraf
#    akışında sanılıyor, oysa örneklerin yarısı ölü.
#
# ⚠️ TEK BİR `/health` İSTEĞİ KÜMEYİ ÖLÇMEZ. Bu blok PM2'ye soruyor: kaç örnek
#    var, kaçı `online`, kaçı ÇÖKEREK yeniden başlamış.
adim "9b2/9  Küme sağlığı (her örnek)"

KUME=$(pm2 jlist 2>/dev/null | node -e "
  let g='';process.stdin.on('data',d=>g+=d).on('end',()=>{
    let liste;
    try { liste = JSON.parse(g) } catch { console.log('OKUNAMADI'); return }
    const bizim = liste.filter(p => (p.name||'').startsWith('vt-'));
    const bozuk = bizim.filter(p =>
      (p.pm2_env||{}).status !== 'online' || ((p.pm2_env||{}).unstable_restarts||0) > 0);
    for (const p of bozuk) {
      const e = p.pm2_env||{};
      console.log(\`BOZUK \${p.name} durum=\${e.status} cokme=\${e.unstable_restarts||0} NODE_ENV=\${(e.env||{}).NODE_ENV||'?'}\`);
    }
    if (bozuk.length === 0) console.log('TEMIZ ' + bizim.length);
  })" || echo 'OKUNAMADI')

case "$KUME" in
  TEMIZ\ *)
    bilgi "${KUME#TEMIZ } vt-* örneğinin hepsi online, çökme yok ✓"
    ;;
  OKUNAMADI)
    uyari "pm2 jlist okunamadı — küme sağlığı ölçülemedi."
    ;;
  *)
    hata "BİR YA DA BİRDEN FAZLA ÖRNEK BOZUK:"
    printf '%s\n' "$KUME" | while read -r satir; do hata "    $satir"; done
    hata ""
    hata "⚠️ Küme kısmen ölü olduğunda istekler DÖNÜŞÜMLÜ dağılır: bazı istekler"
    hata "   çalışır, bazıları düşer. Kullanıcıda 'bazen oluyor' diye görünür."
    hata ""
    hata "NODE_ENV=production görüyorsan: bu sunucu STAGING. Kirli değişken"
    hata "kabuktan ya da PM2 daemon'ından gelmiş olabilir. Süreci tazele:"
    hata "    pm2 delete vt-api && ./scripts/deploy.sh"
    hata "⚠️ 'pm2 kill' KULLANMA — bu makinede üç proje daha var, hepsi düşer."
    exit 1
    ;;
esac

adim "9c/9  Giriş yolu (CSRF)"

# ⚠️ KÖK `vt-web`İN KENDİ DOSYASINDAN OKUNUYOR, api.env'den DEĞİL. CSRF
#    karşılaştırması `appUrl()` üzerinden yapılıyor ve o değer web'in
#    `.env.production`ından geliyor. api.env'deki APP_URL BAŞKA bir değer
#    (`:3000` ekli) ve bu depoda tam olarak o karışıklık siteyi kırmıştı.
SUNUCU_KOK=$(grep '^APP_URL=' "$KOK/apps/web/.env.production" | cut -d= -f2- | tr -d '"' | sed 's#/*$##')

CSRF_KOD=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST "http://127.0.0.1:$WEB_PORT/api/auth/login" \
  -H "content-type: application/json" \
  -H "origin: $SUNUCU_KOK" \
  -H "sec-fetch-site: same-origin" \
  -d '{"identifier":"dagitim-kontrolu@example.invalid","password":"kasten-yanlis-parola"}' || true)

case "$CSRF_KOD" in
  401|400|429)
    bilgi "POST /api/auth/login → $CSRF_KOD (CSRF geçildi ✓)"
    ;;
  403)
    hata "POST /api/auth/login → 403: CSRF HER POST'U REDDEDİYOR."
    hata "    Kimse giriş yapamaz, kayıt olamaz, sepete ekleyemez."
    hata "    `vt-web` sürecinin gördüğü APP_URL, tarayıcının gönderdiği"
    hata "    Origin ile uyuşmuyor. Karşılaştır:"
    hata "        grep '^APP_URL=' $KOK/apps/web/.env.production"
    hata "        tr '\\0' '\\n' < /proc/\$(pm2 pid vt-web)/environ | grep APP_URL"
    exit 1
    ;;
  *)
    uyari "POST /api/auth/login → ${CSRF_KOD:-yanıt yok} (beklenmeyen; elle bakın)"
    ;;
esac

# ── Medya önbelleği: ÖLÇ ve ISIT ───────────────────────────────────────────
#
# ⚠️ SOĞUK ÖNBELLEK DALGASI, DÜZELTMENİN KENDİSİNİN EN RİSKLİ ANIDIR.
#    `NEXT_PUBLIC_MEDIA_URL` değişince Next'in görsel önbelleği tamamen
#    geçersizleşir (anahtar tam adresi içerir) ve nginx önbelleği de boştur.
#    İlk trafik dalgası %100 MISS → r2.dev'e ardışık yüzlerce taze istek → hız
#    sınırını tetiklemek için İDEAL koşul. `proxy_cache_use_stale` burada
#    TANIMI GEREĞİ yardım edemez: elde bayat kopya yoktur.
#    ÖLÇÜLDÜ (2026-08-13, 9 gerçek anahtar, soğuk önbellek):
#        doğrudan r2.dev  : 2/8 başarılı
#        nginx üzerinden  : 4/8 başarılı   ← tek deneme YETMİYOR
#        6 denemeye kadar : 9/9 başarılı, toplam 14 istek
#    Yani ısıtma DENEMELİ olmalı; tek geçişlik bir döngü işe yaramaz.
if [ -n "${MEDYA_YOLU:-}" ] && [ -s /tmp/vt-web.html ]; then
  adim "9b/9  Medya önbelleği"

  # Ana sayfanın kendi HTML'inden gerçek anahtarları çıkar — sabit liste
  # tutmak, listenin bir gün gerçekle ayrışması demektir.
  MEDYA_ANAHTARLARI=$(python3 - "$MEDYA_KOK" <<'PY' || true
import re, sys, urllib.parse
kok = sys.argv[1].rstrip('/')
try:
    html = open('/tmp/vt-web.html', encoding='utf-8', errors='replace').read()
except OSError:
    sys.exit(0)
bulunan = []
for ham in re.findall(r'/_next/image\?url=([^&"\']+)', html):
    # ⚠️ TEK çözme. İki kez çözmek, anahtarında `%` geçen bir nesneyi bozardı;
    #    `url=` parametresi zaten tek kez kodlanmış (canlı HTML'de ölçüldü).
    adres = urllib.parse.unquote(ham)
    if adres.startswith(kok + '/'):
        anahtar = adres[len(kok) + 1:]
        if anahtar and anahtar not in bulunan:
            bulunan.append(anahtar)
print('\n'.join(bulunan))
PY
)

  if [ -z "$MEDYA_ANAHTARLARI" ]; then
    uyari "Ana sayfada $MEDYA_KOK kökünden görsel bulunamadı."
    uyari "  Ya sayfada görsel yok ya da paket ESKİ kökle derlenmiş."
    uyari "  Değer derleme zamanında gömülür: PM2 restart YETMEZ, 'next build' gerekir."
  else
    ISINAN=0; TOPLAM=0; BASARISIZ=""
    while IFS= read -r anahtar || [ -n "$anahtar" ]; do
      [ -n "$anahtar" ] || continue
      TOPLAM=$((TOPLAM + 1))
      for _ in 1 2 3 4 5 6; do
        MK=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
             -H "Host: $NGINX_HOST" "http://127.0.0.1/medya/$anahtar" || true)
        [ "$MK" = "200" ] && break
        sleep 2
      done
      if [ "$MK" = "200" ]; then
        ISINAN=$((ISINAN + 1))
      else
        BASARISIZ="$BASARISIZ $anahtar"
      fi
    done <<EOF
$MEDYA_ANAHTARLARI
EOF

    bilgi "ısıtıldı: $ISINAN/$TOPLAM anahtar"
    [ -n "$BASARISIZ" ] && uyari "ısınmayan:$BASARISIZ"

    # ⚠️ KABUL ÖLÇÜTÜ. Başlık HİÇ YOKSA `location /medya/` devrede değildir:
    #    istek `location /`a düşüp Next'e gitmiştir ve HER ürün görseli kırıktır.
    #    Bu, bu deponun altı kez yaşadığı "yazıldı ama bağlanmadı" sınıfıdır ve
    #    tam olarak burada yakalanır.
    ILK_ANAHTAR=$(printf '%s\n' "$MEDYA_ANAHTARLARI" | head -1)
    MEDYA_BASLIK=$(curl -s -D - -o /dev/null --max-time 25 \
      -H "Host: $NGINX_HOST" "http://127.0.0.1/medya/$ILK_ANAHTAR" \
      | grep -i '^x-medya-onbellek:' | tr -d '\r' | cut -d' ' -f2- || true)

    if [ -z "$MEDYA_BASLIK" ]; then
      hata "X-Medya-Onbellek başlığı YOK → nginx 'location /medya/' devrede değil."
      hata "    Site görselsiz servis ediliyor olabilir. Kur ve yeniden yükle:"
      hata "    cp $KOK/infra/nginx/vt.conf       /etc/nginx/sites-available/vt"
      hata "    cp $KOK/infra/nginx/vt-cache.conf /etc/nginx/conf.d/vt-cache.conf"
      hata "    nginx -t && systemctl reload nginx"
      exit 1
    fi
    bilgi "X-Medya-Onbellek: $MEDYA_BASLIK  (HIT bekleniyor)"
    [ "$MEDYA_BASLIK" = "HIT" ] || uyari "HIT değil — önbellek yazmıyor olabilir (izin? disk?)"
  fi
fi

# Süreçler gerçekten ayakta mı — 'online' yetmez, ÇÖKÜP DURUYOR olabilir.
#
# ⚠️ `set -euo pipefail` ALTINDA GREP'İN BOŞ DÖNMESİ BETİĞİ ÖLDÜRÜR. Buradaki
#    kırılgan `tr | grep -o` zinciri hiçbir şey eşleştiremediğinde 1 dönüyor,
#    `pipefail` bunu boru hattının sonucu yapıyor ve `set -e` dağıtımı SON
#    ADIMDA hataya çeviriyordu — her şey başarıyla bitmişken. Ayrıştırma artık
#    Python'a bırakıldı ve `|| true` ile hata yolu kapatıldı: bir DURUM RAPORU,
#    dağıtımı başarısız sayacak bir kapı değildir.
pm2 jlist 2>/dev/null | python3 -c '
import json, sys
try:
    surecler = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for p in surecler:
    ad = p.get("name", "")
    if not ad.startswith("vt-"):
        continue
    ortam = p.get("pm2_env", {})
    durum = ortam.get("status", "?")
    # ⚠️ İKİ AYRI SAYAÇ VAR VE YANLIŞINA BAKIYORDUK.
    #
    #    `restart_time`      = TOPLAM yeniden başlatma — `pm2 reload` DE artırır.
    #    `unstable_restarts` = ÇÖKME sonrası yeniden başlatma.
    #
    #    Eski kontrol `restart_time > 20` diyordu ve bugün 24 dağıtım yapılmış
    #    sağlıklı bir süreçte HER SEFERİNDE uyarı bastı. Her dağıtımda çıkan
    #    bir uyarı, okunmayan bir uyarıdır: gerçek bir çökme döngüsü aynı
    #    satırın arasında kaybolurdu. Doğru sinyal `unstable_restarts`.
    toplam = ortam.get("restart_time", 0)
    kararsiz = ortam.get("unstable_restarts", 0)
    if durum != "online":
        print(f"  \033[1;33m⚠️  {ad} durumu: {durum}\033[0m")
    elif kararsiz > 0:
        print(
            f"  \033[1;33m⚠️  {ad} ÇÖKÜP yeniden başlamış: {kararsiz} kez"
            f" (toplam yeniden başlatma {toplam})\033[0m"
        )
' || true

trap - EXIT
printf '\n\033[1;32m✓ Dağıtım tamam — %s\033[0m\n\n' "$(git log --oneline -1)"
