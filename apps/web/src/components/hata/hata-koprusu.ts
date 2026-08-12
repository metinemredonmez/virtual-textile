import { isApiFailure, type ApiErrorBody } from '@vt/contracts';

/**
 * SUNUCU BİLEŞENİNDEN İSTEMCİ BİLEŞENİNE HATA GEÇİRME.
 *
 * ⚠️ `ApiFailure` BİR SINIF ÖRNEĞİDİR ve RSC sınırından GEÇEMEZ. React'ın
 *    akış serileştiricisi yalnızca düz nesneleri ve birkaç yerleşik tipi
 *    kabul eder; bir `Error` alt sınıfını prop olarak vermek
 *    "Only plain objects … can be passed to Client Components" hatasıyla
 *    SAYFANIN TAMAMINI düşürür. Yani hatayı göstermeye çalışmak, hatanın
 *    kendisinden daha büyük bir hataya yol açar.
 *
 *    Aynı sınır `<Fiyat>` başlığında para için yazılı (`Money`/`bigint` prop
 *    olmaz); bu, o kuralın hata nesneleri için karşılığıdır.
 *
 * ⚠️ Alanlar TEK TEK kopyalanır, `{...failure}` yazılmaz: `Error`ın kendi
 *    alanları (`stack`, `cause`) sayılabilir olmadığı için yayılma sessizce
 *    boş nesne üretir ve kullanıcı "Beklenmeyen bir hata" görür — gerçek
 *    sebep elimizdeyken.
 *
 * ⚠️ `details` bilinçli olarak TAŞINIR: alan bazlı doğrulama hataları
 *    (`details.fields`) düz JSON'dur ve formun altına yazılması gereken tek
 *    bilgi odur.
 */
/**
 * ⚠️ NEXT'İN GEZİNME SİNYALLERİ HATA DEĞİLDİR — ve bunu bilmeyen bir `catch`
 *    kullanıcıyı yanlış ekranda bırakır.
 *
 *    `redirect()` ve `notFound()` işlerini bir `throw` ile yapar. Panel
 *    sayfaları veriyi `try/catch` içinde okuduğu için o sinyal buraya
 *    düşüyordu: `hesapFetch` oturumsuz kullanıcıyı `/giris`e atmak isterken
 *    çağıran onu yakalıyor ve "Beklenmeyen bir hata oluştu" kutusu basıyordu.
 *    Yani oturumu düşmüş kullanıcı giriş ekranı yerine bir hata görüyordu.
 *    Aynısı `notFound()` için de geçerli: 404 gövdesi yerine hata kutusu.
 *
 *    ⚠️ Sinyal, sınıfından değil `digest` alanından tanınır. `instanceof`
 *       çalışmaz — hata RSC sınırını geçerken yeniden kurulur. Biçim bu depoda
 *       ÖLÇÜLDÜ: üretim derlemesinden çekilen RSC yükünde
 *       `E{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"}` satırı var.
 *
 *    ⚠️ Kontrol ÇAĞIRANDA DEĞİL BURADA: sunucuda yakalanan her hata bu
 *       fonksiyondan geçiyor, yani kapı tek yerde. Her `catch` bloğuna ayrı
 *       ayrı yazılsaydı bir sonraki ekranda unutulurdu.
 */
const GEZINME_SINYALLERI = ['NEXT_REDIRECT', 'NEXT_HTTP_ERROR_FALLBACK'];

function gezinmeSinyaliMi(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const digest: unknown = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && GEZINME_SINYALLERI.some((ad) => digest.startsWith(ad));
}

export function hataYuku(error: unknown): ApiErrorBody {
  if (gezinmeSinyaliMi(error)) throw error;

  if (isApiFailure(error)) {
    return {
      code: error.code as ApiErrorBody['code'],
      message: error.userMessage,
      httpStatus: error.httpStatus,
      retryable: error.retryable,
      details: error.details,
      requestId: error.requestId,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  // ⚠️ Zarfsız hata (ağ kopması, JSON olmayan yanıt) da AYNI şekle sokulur.
  //    İki farklı şekil olsaydı istemci tarafı ikisini de bilmek zorunda kalır
  //    ve bilmediği biçimi "sunucuya ulaşılamıyor" diye gösterirdi.
  console.error('[hata-koprusu] zarfsız hata', error);
  return {
    code: 'INTERNAL_ERROR',
    message: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.',
    httpStatus: 500,
    retryable: true,
    requestId: 'yok',
  };
}
