/**
 * `?next=` PARAMETRESİNİN TEMİZLENMESİ.
 *
 * ⚠️ AÇIK YÖNLENDİRME (open redirect) KAPISI. `next` değerini olduğu gibi
 *    `router.replace()`e vermek, `/login?next=https://kotu-site.example` ile
 *    gelen bir bağlantının kullanıcıyı GİRİŞTEN HEMEN SONRA — yani en çok
 *    güvendiği anda — saldırganın kopyaladığı bir ekrana atması demektir.
 *    Kimlik avı kampanyalarının klasik taşıyıcısıdır.
 *
 * ⚠️ `//evil.example` de bir MUTLAK adrestir (protokol-göreli). Yalnızca
 *    `startsWith('/')` denetimi bunu KAÇIRIR; ikinci karakter de bakılır.
 *
 * ⚠️ `\` ters bölü de bazı tarayıcılarda `/` gibi çözülür (`/\evil.example`),
 *    bu yüzden o da reddedilir.
 *
 * ⚠️ `giris/` ve `kayit/` ekranlarının İKİSİ de bu kapıdan geçer, bu yüzden
 *    dosya ikisinin de dışında duruyor: bir ekranın altında dursaydı ikinci
 *    ekranı yazan kişi kendi kopyasını açar, biri düzeltilir diğeri açık
 *    kalırdı. `?next=` okuyan her yeni ekran da buradan geçmek zorunda.
 */

/** Yönlendirme hedefi verilmediğinde/güvenilmediğinde gidilecek yer. */
export const VARSAYILAN_HEDEF = '/account';

export function guvenliDonusYolu(next: string | null | undefined): string {
  if (!next) return VARSAYILAN_HEDEF;
  if (!next.startsWith('/')) return VARSAYILAN_HEDEF;
  if (next.startsWith('//') || next.startsWith('/\\')) return VARSAYILAN_HEDEF;
  return next;
}
