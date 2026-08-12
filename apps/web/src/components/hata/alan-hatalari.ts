import type { ApiErrorDetailField } from '@vt/contracts';

/**
 * ALAN HATALARI — "mesajı yeniden yazma" kuralının TEK İSTİSNASI.
 *
 * ⚠️ `details.fields[].message` TÜRKÇE OLMAYABİLİR. `zodBody` pipe'ı
 *    `ZodError.issues[].message`ı ham geçiriyor; bazı şemalarda Türkçe mesaj var
 *    (passwordSchema, emailSchema), bazılarında Zod varsayılanı kalıyor:
 *    `"Required"`, `"String must contain at least 3 character(s)"`.
 *
 *    Bu bir ihlal DEĞİL: "mesajı yeniden yazma" kuralı `error.message` içindir
 *    ve o metin kullanıcıya gösterilmek üzere üretilmiştir. Buradaki metin
 *    üretilmemiştir.
 *
 * ⚠️ EŞLEME `rule` (Zod issue kodu) ÜZERİNDEN yapılır, mesaj metninden değil.
 *    Metne bakan bir eşleme, Zod bir sürümde cümleyi değiştirdiğinde sessizce
 *    İngilizceye düşerdi.
 *
 * KALICI DÜZELTME (ayrı backend kartı): `packages/contracts/src/schemas/common.ts`
 * içindeki her `.min()/.max()` çağrısına Türkçe mesaj eklenir; o gün bu tablo
 * SİLİNİR.
 */
const KURAL_METINLERI: Record<string, string> = {
  invalid_type: 'Bu alan zorunlu.',
  too_small: 'Girilen değer çok kısa.',
  too_big: 'Girilen değer çok uzun.',
  invalid_string: 'Biçim geçersiz.',
  invalid_enum_value: 'Geçersiz seçim.',
  invalid_email: 'Geçerli bir e-posta adresi girin.',
  custom: 'Girilen değer geçersiz.',
};

/** Zod'un İngilizce varsayılanlarını tanımak için — yalnızca yedek yolda. */
const INGILIZCE_KALIP = /^(Required|Expected|String must|Number must|Invalid)/;

export function fieldMessage(field: ApiErrorDetailField): string {
  const eslesme = field.rule ? KURAL_METINLERI[field.rule] : undefined;
  if (eslesme) return eslesme;
  // Eşleme yoksa sunucu mesajı yedek; ama İngilizce varsayılansa genel metin.
  if (INGILIZCE_KALIP.test(field.message)) return 'Girilen değer geçersiz.';
  return field.message;
}

/** `react-hook-form` `setError` ile kullanılmak üzere: alan yolu → Türkçe metin. */
export function fieldErrorMap(fields: readonly ApiErrorDetailField[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const field of fields) {
    // `headers.Idempotency-Key` gibi form dışı yollar forma yazılmaz.
    if (field.path.startsWith('headers.')) continue;
    map[field.path] = fieldMessage(field);
  }
  return map;
}
