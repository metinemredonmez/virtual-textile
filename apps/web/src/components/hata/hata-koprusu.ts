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
export function hataYuku(error: unknown): ApiErrorBody {
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
