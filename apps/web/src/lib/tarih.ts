import { INTL_ETIKET, VARSAYILAN_LOCALE, type Locale } from '@vt/contracts';

/**
 * TARİH BİÇİMİ — TEK NOKTA.
 *
 * ⚠️ `timeZone` AÇIKÇA YAZILIR ve bu bir tercih değil, HİDRASYON kuralıdır:
 *    varsayılana bırakılırsa Sunucu Bileşeni Next sürecinin saat diliminde
 *    (üretimde çoğunlukla UTC), tarayıcı kullanıcının diliminde biçimlendirir.
 *    React aynı düğümde iki farklı metin görür ve o ağacı sessizce istemcide
 *    yeniden çizer; kullanıcı siparişini bir an "11 Ağustos", sonra
 *    "12 Ağustos" olarak görür. Sabit dilim iki tarafı da aynı cümleye zorlar.
 *
 * ⚠️ SAAT DİLİMİ DİLE BAĞLI DEĞİL ve olmamalı. İngilizce arayüz de
 *    `Europe/Istanbul` görür: sipariş saati mağazanın saatidir, okuyanın değil.
 *    Diline göre kaydırılsaydı aynı siparişin kargo son tarihi iki ekranda iki
 *    farklı gün görünürdü.
 *
 * ⚠️ YEREL AYAR ARTIK PARAMETRE, ama VARSAYILANI Türkçe: onlarca çağrı yeri
 *    ikinci argüman vermeden çalışmaya devam ediyor. Bu turda dokunulmaması
 *    gereken (ve şu anda taşınmakta olan) dosyaları değiştirmemenin tek yolu.
 */
const DILIM = 'Europe/Istanbul';

/**
 * ⚠️ BİÇİMLENDİRİCİLER ÖNBELLEKLENİR. `Intl.DateTimeFormat` kurucusu bu
 *    depodaki en pahalı gösterim çağrısı ve sipariş listesi tek çizimde
 *    onlarca tarih basıyor; çağrı başına kurmak ölçülebilir bir gerileme olur.
 */
const GUN_BICIMLEYICI = new Map<Locale, Intl.DateTimeFormat>();
const GUN_SAAT_BICIMLEYICI = new Map<Locale, Intl.DateTimeFormat>();

function bicimleyici(
  onbellek: Map<Locale, Intl.DateTimeFormat>,
  locale: Locale,
  secenekler: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let hazir = onbellek.get(locale);
  if (!hazir) {
    hazir = new Intl.DateTimeFormat(INTL_ETIKET[locale], { timeZone: DILIM, ...secenekler });
    onbellek.set(locale, hazir);
  }
  return hazir;
}

/**
 * `2026-08-12T09:58:44.074Z` → `2026-08-12`. `<input type="date">` için.
 *
 * ⚠️ `toISOString().slice(0,10)` YAZILMAZ: UTC'ye göre keser ve Türkiye
 *    saatiyle 03:00 öncesi her an bir GÜN GERİ kayar. Aynı `DILIM` kullanılıyor
 *    — form alanına yazılan gün ile ekranda okunan gün ayrışırsa rapor aralığı
 *    bir gün kayar ve kimse fark etmez. Biçimlendirici bir dönem
 *    `_finans/bicim.ts` içinde ikinci kez, kendi `Europe/Istanbul` dizgisiyle
 *    kuruluydu; tarih dilimi bu depoda TEK yerde yazılır.
 *
 * ⚠️ Yerel ayar `en-CA`: `YYYY-MM-DD` üreten tek yerleşik ayar. `tr-TR`
 *    `12.08.2026` üretir ve `<input type="date">` onu kabul etmez.
 *
 * ⚠️ BU SATIR LOCALE'E BAĞLANMAZ — ve bu, çok dillilikte yapılması en kolay
 *    hatalardan biri. `en-CA` burada bir DİL seçimi değil, tarayıcının form
 *    alanından beklediği makine biçimi. Kullanıcının diline bağlansaydı Türkçe
 *    arayüzde `<input type="date">` "12.08.2026" alır ve alanı SESSİZCE boş
 *    bırakırdı; rapor aralığı hiç uygulanmazdı.
 */
const ISO_GUN = new Intl.DateTimeFormat('en-CA', {
  timeZone: DILIM,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function isoGun(kaynak: Date | string): string {
  return ISO_GUN.format(typeof kaynak === 'string' ? new Date(kaynak) : kaynak);
}

/** "12 Ağustos 2026" (tr) · "12 August 2026" (en) */
export function tarih(iso: string, locale: Locale = VARSAYILAN_LOCALE): string {
  return bicimleyici(GUN_BICIMLEYICI, locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/** "12 Ağustos 2026 17:04" (tr) · "12 August 2026 at 17:04" (en) */
export function tarihSaat(iso: string, locale: Locale = VARSAYILAN_LOCALE): string {
  return bicimleyici(GUN_SAAT_BICIMLEYICI, locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Kalan gün sayısı — YUKARI yuvarlanır.
 *
 * ⚠️ Aşağı yuvarlanırsa hesap silme ekranı hâlâ 6 saatlik geri alma hakkı olan
 *    kullanıcıya "0 gün kaldı" der. Sunucu da (`account-deletion.ts` →
 *    `remainingGraceDays`) yukarı yuvarlıyor; iki taraf farklı yuvarlarsa aynı
 *    ekranda iki farklı sayı görünür.
 */
export function kalanGun(iso: string, simdi: number = Date.now()): number {
  const kalanMs = new Date(iso).getTime() - simdi;
  if (kalanMs <= 0) return 0;
  return Math.ceil(kalanMs / (24 * 60 * 60 * 1000));
}

/**
 * Kalan saat — YUKARI yuvarlanır (`kalanGun` ile aynı gerekçe).
 *
 * ⚠️ "GECİKTİ" KARARI BURADAN GELMEZ — o karar sunucunun `slaBreached` alanıdır
 *    ve üç şartı BİRLİKTE arar (`shippedAt === null` + son tarih geçmiş + durum
 *    AWAITING_APPROVAL/PREPARING). Burada hesaplanan tek şey YAKINLIK: son
 *    tarihe az kaldığında satıcıyı uyarmak için. İki kavram karıştırılırsa
 *    arayüz kargolanmış bir paketi de "gecikmiş" gösterir.
 *
 * ⚠️ Yalnızca Sunucu Bileşeninde çağrılır. İstemcide de çağrılsaydı sunucu ile
 *    tarayıcı arasındaki saat farkı iki farklı sayı üretir ve React o düğümü
 *    sessizce yeniden çizerdi (bu dosyanın başındaki hidrasyon gerekçesi).
 */
export function kalanSaat(iso: string, simdi: number = Date.now()): number {
  const kalanMs = new Date(iso).getTime() - simdi;
  if (kalanMs <= 0) return 0;
  return Math.ceil(kalanMs / (60 * 60 * 1000));
}

/** Verilen an geçmişte mi? İade penceresi ve indirme bağlantısı için. */
export function gecmisMi(iso: string | null, simdi: number = Date.now()): boolean {
  if (!iso) return true;
  return new Date(iso).getTime() <= simdi;
}
