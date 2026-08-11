import type { MappedPaymentFailure } from '../payment.provider.js';

/**
 * SAĞLAYICI HATA KODU → UYGULAMA HATA KODU
 *
 * ⚠️ Kullanıcıya ASLA ham banka/sağlayıcı kodu gösterilmez. İki nedenle:
 *  1. "Bankanız 51 hatası döndü" kullanıcıya hiçbir şey anlatmaz, destek
 *     yükünü artırır.
 *  2. Ham kod, kartın hangi kontrolde takıldığını sızdırır; kart deneme
 *     (carding) saldırılarında saldırgana geri bildirim verir.
 *
 * Ham kod YALNIZCA loglanır ve `PaymentAttempt.providerCode`'a yazılır.
 *
 * Eşlenmeyen her kod `PAYMENT_DECLINED`'a düşer — bilinmeyen bir kodu
 * "yetersiz bakiye" diye göstermek yanlış bilgilendirmedir.
 */
const CODE_MAP: Readonly<Record<string, MappedPaymentFailure>> = {
  // ── Bakiye / limit ────────────────────────────────────────────────────
  '10051': 'PAYMENT_INSUFFICIENT_FUNDS', // Kartın limiti yetersiz
  '10201': 'PAYMENT_INSUFFICIENT_FUNDS', // Yetersiz bakiye
  '10084': 'PAYMENT_LIMIT_EXCEEDED', // İşlem tutarı kart limitini aşıyor
  '10207': 'PAYMENT_LIMIT_EXCEEDED', // Taksitli işlem limiti aşıldı

  // ── Kart bilgisi ──────────────────────────────────────────────────────
  '10012': 'PAYMENT_CARD_INVALID', // Geçersiz işlem
  '10054': 'PAYMENT_CARD_INVALID', // Vadesi dolmuş kart
  '10055': 'PAYMENT_CARD_INVALID', // Geçersiz CVC/şifre
  '10056': 'PAYMENT_CARD_INVALID', // Geçersiz kart numarası
  '12001': 'PAYMENT_CARD_INVALID', // Kart numarası doğrulanamadı

  // ── Banka reddi ───────────────────────────────────────────────────────
  '10005': 'PAYMENT_BANK_REJECTED', // İşlem onaylanmadı
  '10034': 'PAYMENT_BANK_REJECTED', // Dolandırıcılık şüphesi
  '10041': 'PAYMENT_BANK_REJECTED', // Karta el koy
  '10043': 'PAYMENT_BANK_REJECTED', // Çalıntı kart
  '10057': 'PAYMENT_BANK_REJECTED', // Kart sahibi bu işlemi yapamaz
  '10058': 'PAYMENT_BANK_REJECTED', // Terminal bu işlemi yapamaz
  '10093': 'PAYMENT_BANK_REJECTED', // Kart e-ticarete kapalı

  // ── 3D Secure ─────────────────────────────────────────────────────────
  '10202': 'PAYMENT_3DS_FAILED', // 3DS doğrulaması başarısız
  '10206': 'PAYMENT_3DS_FAILED', // 3DS imzası geçersiz
  '5008': 'PAYMENT_3DS_FAILED', // 3DS oturumu bulunamadı/süresi doldu
};

export function mapProviderErrorCode(code: string | undefined): MappedPaymentFailure {
  if (!code) return 'PAYMENT_DECLINED';
  return CODE_MAP[code.trim()] ?? 'PAYMENT_DECLINED';
}

/**
 * 3DS `mdStatus` eşlemesi.
 *
 * '1' dışındaki HER değer başarısızlıktır. Bu kontrolü atlayıp yalnızca
 * `status === 'success'`e bakmak, 3DS'siz (yani sahibi doğrulanmamış) bir
 * işlemi kabul etmek demektir — ters ibraz (chargeback) riski tamamen bize kalır.
 *
 * `mdStatus` hiç gelmediyse kullanıcı banka formunu kapatmış/iptal etmiştir;
 * bu bir hata değil, vazgeçmedir ve kullanıcıya farklı bir mesaj gösterilir.
 */
export function mapThreeDsStatus(mdStatus: string | number | undefined | null): {
  authenticated: boolean;
  failure?: MappedPaymentFailure;
} {
  if (mdStatus === undefined || mdStatus === null || mdStatus === '') {
    return { authenticated: false, failure: 'PAYMENT_3DS_CANCELLED' };
  }
  return String(mdStatus).trim() === '1'
    ? { authenticated: true }
    : { authenticated: false, failure: 'PAYMENT_3DS_FAILED' };
}

/**
 * "Kayıt bulunamadı" ile "servis patladı" ayrımı.
 * `inquire()` bulunamadığında `null` döner; bunu hata sanıp retry etmek
 * hiç var olmamış bir ödemeyi sonsuza kadar sorgular.
 */
const NOT_FOUND_CODES = new Set(['1000', '100001', '5088']);

export function isNotFoundCode(code: string | undefined): boolean {
  return code !== undefined && NOT_FOUND_CODES.has(code.trim());
}
