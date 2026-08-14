#!/usr/bin/env bash
#
# ═══════════════════════════════════════════════════════════════════════════
#  SANAL DENEME TANISI — zincirin TAMAMINI tek komutta gösterir.
#
#  Sunucuda:  /var/www/virtual/scripts/deneme-tani.sh
#
#  ⚠️ VARLIK SEBEBİ: bu akış BİR GÜNDE YEDİ AYRI YERDE kopuk çıktı ve her
#     birinde şu döngü yaşandı — kullanıcı ekran görüntüsü atıyor, hangi
#     halkanın koptuğu bilinmiyor, tek tek komut isteniyor, bir sonraki halka
#     çıkıyor. Yedi tur. Bu betik o döngüyü kapatır: HER halkanın durumunu
#     aynı anda basar.
#
#  Kopan halkalar (hepsi ölçülerek bulundu):
#     1. CSRF — kirli APP_URL            → giriş yapılamıyordu
#     2. `Secure` çerez HTTP'de          → oturum açılmıyordu
#     3. R2 CORS kuralı yok              → yükleme başlamıyordu
#     4. imzalı adreste boş CRC32        → yükleme reddediliyordu
#     5. `crypto.randomUUID` HTTP'de yok → confirm hiç gönderilmiyordu
#     6. `tryon.requested` okuyan yok    → iş kuyruğa hiç girmiyordu
#     7. fal `description` eksik         → her üretim 422
#     8. imzalı URL'de sabit `private`   → ürün görseli için kova karışması
#                                          (provider=NULL, latencyMs=NULL)
#
#  ⚠️ SALT OKUMA. Hiçbir şeyi değiştirmez, silmez, yeniden başlatmaz.
#     Komşu projelere (celine-*, od-*) dokunmaz.
# ═══════════════════════════════════════════════════════════════════════════

set -uo pipefail

KOK="${VT_KOK:-/var/www/virtual}"
ENV_DOSYASI="${VT_ENV:-/etc/virtual-textile/api.env}"
WEB_ENV="${VT_WEB_ENV:-/etc/virtual-textile/web.env}"

baslik() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
bilgi()  { printf '  %s\n' "$*"; }
iyi()    { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
kotu()   { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

db() {
  local url
  url=$(grep '^DATABASE_URL=' "$ENV_DOSYASI" | cut -d= -f2- | tr -d '"' | sed 's/?schema=public//')
  psql "$url" -tA "$@" 2>/dev/null
}

# ── 1 ──────────────────────────────────────────────────────────────────────
baslik "1/6  Dağıtılmış sürüm"
cd "$KOK" 2>/dev/null && bilgi "$(git log --oneline -1)"

# ⚠️ Bu akışı onaran commit'ler. Sunucu bunlardan öncedeyse arıza ZATEN
#    bilinen bir arızadır ve tanıya gerek yok — dağıtmak yeter.
for c in 05ca62b:"kova görünürlüğü" eb533a2:"fal description" 482b503:"tryon dispatch" c493bb3:"randomUUID"; do
  sha="${c%%:*}"; ad="${c#*:}"
  if git merge-base --is-ancestor "$sha" HEAD 2>/dev/null; then
    iyi "$ad düzeltmesi var ($sha)"
  else
    kotu "$ad düzeltmesi YOK ($sha) — önce ./scripts/deploy.sh"
  fi
done

# ── 2 ──────────────────────────────────────────────────────────────────────
baslik "2/6  Son deneme işleri (veritabanı)"
db -c 'SELECT "queuedAt", status, COALESCE(provider,'"'"'—'"'"') AS saglayici,
              COALESCE("errorCode",'"'"'—'"'"') AS hata, attempts,
              COALESCE("latencyMs"::text,'"'"'—'"'"') AS ms
       FROM ai_tryon_jobs ORDER BY "queuedAt" DESC LIMIT 5;' \
  | awk -F'|' '{printf "  %-26s %-10s %-8s %-24s %s deneme  %s ms\n",$1,$2,$3,$4,$5,$6}'

# ── 3 ──────────────────────────────────────────────────────────────────────
#  ⚠️ EN KRİTİK HALKA. API kuyruğa DOĞRUDAN yazmaz; outbox'a olay yazar ve
#     `vt-worker-core` onu `domain-event` kuyruğuna, oradan `TryOnDispatchHandler`
#     `tryon` kuyruğuna taşır. Zincir bir gün tam burada koptu: olayı OKUYAN
#     kimse yoktu, iş sonsuza kadar QUEUED kaldı.
baslik "3/6  Outbox — olay yayınlandı mı"
db -c "SELECT \"createdAt\", type, CASE WHEN \"publishedAt\" IS NULL THEN 'YAYINLANMADI' ELSE 'yayınlandı' END, attempts
       FROM infra_outbox_events WHERE type = 'tryon.requested'
       ORDER BY \"createdAt\" DESC LIMIT 5;" \
  | awk -F'|' '{printf "  %-26s %-18s %-14s %s deneme\n",$1,$2,$3,$4}'

BEKLEYEN=$(db -c "SELECT count(*) FROM infra_outbox_events WHERE \"publishedAt\" IS NULL;" | tr -d ' ')
if [ "${BEKLEYEN:-0}" -gt 0 ]; then
  kotu "$BEKLEYEN outbox olayı YAYINLANMAMIŞ — vt-worker-core dağıtıcısı çalışmıyor"
else
  iyi "yayınlanmamış outbox olayı yok"
fi

# ── 4 ──────────────────────────────────────────────────────────────────────
baslik "4/6  BullMQ kuyruğu"
# ⚠️ `redis-cli` ÇIPLAK ÇAĞRILAMAZ — ilk sürümde öyleydi ve YANILTTI.
#    Çıplak `redis-cli` her zaman localhost:6379 db 0'a bağlanır; uygulama ise
#    `REDIS_URL`in gösterdiği yere. İkisi ayrıysa betik "hiç anahtar yok" der,
#    oysa anahtarlar BAŞKA bir veritabanındadır — yani var olmayan bir arıza
#    icat eder. Ölçüldü: işler FAILED'a geçmişken sayaçlar 0 görünüyordu.
REDIS_URL=$(grep '^REDIS_URL=' "$ENV_DOSYASI" | cut -d= -f2- | tr -d '"')
rc() { redis-cli ${REDIS_URL:+-u "$REDIS_URL"} "$@" 2>/dev/null; }
bilgi "redis: ${REDIS_URL:-(REDIS_URL tanımsız — varsayılan localhost:6379/0)}"
# ⚠️ Redis bu makinede BAŞKA PROJELERLE PAYLAŞILIYOR ve bizim tarafta önek yok.
#    Bugün ad çakışması yok ama bu bir zaman bombası (ayrı kart).
for durum in wait active delayed; do
  n=$(rc llen "bull:tryon:$durum" | tr -d '() a-z')
  bilgi "tryon:$durum = ${n:-0}"
done
bilgi "tryon:failed    = $(rc zcard bull:tryon:failed | tr -d '() a-z')"
bilgi "tryon:completed = $(rc zcard bull:tryon:completed | tr -d '() a-z')"

TOPLAM=$(rc --scan --pattern 'bull:tryon*' | wc -l | tr -d ' ')
if [ "${TOPLAM:-0}" -eq 0 ]; then
  kotu "bull:tryon* HİÇ ANAHTAR YOK — iş kuyruğa hiç konmamış (halka 6)"
else
  iyi "$TOPLAM adet bull:tryon* anahtarı var"
fi

# ── 5 ──────────────────────────────────────────────────────────────────────
baslik "5/6  Süreçler ve sağlayıcı"
pm2 jlist 2>/dev/null | node -e "
  let g='';process.stdin.on('data',d=>g+=d).on('end',()=>{
    let l; try { l = JSON.parse(g) } catch { console.log('  (pm2 okunamadı)'); return }
    for (const p of l.filter(x=>(x.name||'').startsWith('vt-'))) {
      const e = p.pm2_env||{};
      console.log('  ' + p.name.padEnd(18) + (e.status||'?').padEnd(10) +
        'çökme=' + (e.unstable_restarts||0) + '  NODE_ENV=' + ((e.env||{}).NODE_ENV||'?'));
    }
  })"

if [ "$(grep -c '^FAL_KEY=..*' "$ENV_DOSYASI" 2>/dev/null)" -gt 0 ]; then
  iyi "FAL_KEY tanımlı"
else
  kotu "FAL_KEY YOK ya da BOŞ — sağlayıcı çağrılamaz"
fi
bilgi "model: $(grep '^FAL_TRYON_MODEL=' "$ENV_DOSYASI" 2>/dev/null | cut -d= -f2- || echo 'tanımsız (varsayılan fal-ai/idm-vton)')"

# ⚠️ HTTP/HTTPS: yedi halkanın İKİSİ doğrudan TLS yokluğundan doğdu
#    (`Secure` çerez ve `crypto.randomUUID`). Kök hâlâ http ise not düşülür.
case "$(grep '^APP_URL=' "$WEB_ENV" 2>/dev/null | cut -d= -f2- | tr -d '"')" in
  https://*) iyi "APP_URL https" ;;
  *) bilgi "⚠️ APP_URL http — güvenli bağlam gerektiren tarayıcı API'leri yok sayılır" ;;
esac

# ── 6 ──────────────────────────────────────────────────────────────────────
baslik "6/6  Worker — son deneme satırları"
# ⚠️ `Connection is closed` gürültüsü elenir: her yeniden yüklemede ioredis
#    kapanış hatası basıyor ve gerçek satırları gömüyor.
pm2 logs vt-worker-media --lines 200 --nostream 2>/dev/null \
  | grep -viE "Connection is closed|at .*node_modules|at Object|at Socket|at TCP|at Map|at Function|at Iterator|at call" \
  | grep -iE "tryon|deneme|fal|hata|error|kuyru" | tail -12

printf '\n'
