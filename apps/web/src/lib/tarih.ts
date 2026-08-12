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
 * ⚠️ `'tr-TR'` de sabit: `undefined` bırakmak sunucuda `en-US` üretirdi.
 */
const DILIM = 'Europe/Istanbul';

const GUN = new Intl.DateTimeFormat('tr-TR', {
  timeZone: DILIM,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const GUN_SAAT = new Intl.DateTimeFormat('tr-TR', {
  timeZone: DILIM,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "12 Ağustos 2026" */
export function tarih(iso: string): string {
  return GUN.format(new Date(iso));
}

/** "12 Ağustos 2026 17:04" */
export function tarihSaat(iso: string): string {
  return GUN_SAAT.format(new Date(iso));
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

/** Verilen an geçmişte mi? İade penceresi ve indirme bağlantısı için. */
export function gecmisMi(iso: string | null, simdi: number = Date.now()): boolean {
  if (!iso) return true;
  return new Date(iso).getTime() <= simdi;
}
