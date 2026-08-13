import { VARSAYILAN_LOCALE, type ApiErrorDetailField, type Locale } from '@vt/contracts';
import { sozluk } from '@/i18n/sozluk';

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
 * ═══ ÇOK DİLLİLİK — İKİ AYRI DELİK, İKİSİ DE ÖLÇÜLDÜ ═══
 *
 * ⚠️ BİRİNCİSİ: metinler bu dosyaya SABİT yazılıydı ve fonksiyon `locale`
 *    ALMIYORDU. 16 çağrı yeri var (giriş, kayıt, adres, şifre, ürün, kupon,
 *    kargo, iade, payout, komisyon formları); İngilizce arayüzde her alanın
 *    ALTINDA Türkçe bir cümle çıkardı. Kataloğun iki dilli olması bunu
 *    kapatmıyor çünkü bu metinler kataloğa hiç uğramıyor. Artık metin
 *    sözlükten geliyor (`sozluk(locale).alanHatasi.*`).
 *
 * ⚠️ İKİNCİSİ VE DAHA SİNSİSİ: "sunucunun Türkçe cümlesi KAZANIR" kuralı dilden
 *    bağımsızdı. `packages/contracts/src/schemas/` içinde 9 Türkçe `message:`
 *    var ("Şifre en az bir harf ve bir rakam içermeli.", "Geçerli bir T.C.
 *    kimlik numarası girin." …); hiçbiri `INGILIZCE_KALIP`e uymadığı için
 *    İngilizce arayüzde de olduğu gibi basılırdı — üstelik sözlük düzeltilse
 *    bile, çünkü tablo hiç okunmazdı. Kural artık `locale === 'tr'` ile
 *    KOŞULLU (`kaynakDili`).
 *
 * ⚠️ BEDELİ AÇIKÇA: İngilizce arayüzde sunucunun ÖZEL cümlesi ("Gerekçe en az
 *    10 karakter olmalı.") kaybolur ve yerine genel "too short" metni geçer,
 *    yani KAÇ KARAKTER gerektiği bilgisi düşer. Türkçe bir cümleyi İngilizce
 *    arayüzde basmak ile bilgiyi genelleştirmek arasında ikincisi seçildi.
 *    Kalıcı çözüm aynı: `packages/contracts/src/schemas/` mesajları koda
 *    çevrilip kataloğa taşınırsa bu dosya SİLİNİR (`docs/i18n.md` §8.G).
 */

/**
 * ZOD KURAL KODU → SÖZLÜK ANAHTARI.
 *
 * ⚠️ Zod'un iç adları (`too_small`) SÖZLÜĞE GİRMEZ: bir kütüphane yükseltmesi
 *    o adı değiştirdiğinde çeviri anahtarı kırılırdı. Kırılganlık bu tabloda
 *    tutuluyor, sözlükte değil.
 */
const KURAL_ANAHTARI = {
  invalid_type: 'zorunlu',
  too_small: 'cokKisa',
  too_big: 'cokUzun',
  invalid_string: 'bicim',
  invalid_enum_value: 'secim',
  invalid_email: 'eposta',
  custom: 'gecersiz',
} as const satisfies Record<string, keyof ReturnType<typeof sozluk>['alanHatasi']>;

/**
 * Zod'un İngilizce varsayılanlarını tanımak için.
 *
 * ⚠️ BU DESEN TÜRKÇE YÜZEYDE BİRİNCİ KAPI, yedek değil — sıra DEĞİŞTİ ve sebebi
 *    ölçüldü. Eski sıra önce `rule` tablosuna bakıyordu ve sunucunun ÖZELLİKLE
 *    yazdığı Türkçe cümleyi çöpe atıyordu:
 *      gönderilen: `{path:"reason", rule:"too_small",
 *                    message:"Gerekçe en az 10 karakter olmalı."}`
 *      gösterilen: "Girilen değer çok kısa."   ← kaç karakter olduğunu SÖYLEMEZ
 *    Aynısı kargo formunda da görüldü: `rule:'custom'` taşıyan
 *    "Kargoya verilen pakette kargo firması ve takip numarası zorunludur."
 *    cümlesi "Girilen değer geçersiz."e düşüyordu.
 *
 *    Türkçe yüzeyde sıra: sunucunun metni İngilizce Zod varsayılanı DEĞİLSE
 *    olduğu gibi gösterilir; kural tablosu yalnızca varsayılan cümleler için
 *    YEDEKtir. Bu, `AGENTS.md` §4'teki "mesaj yeniden yazılmaz" kuralının bu
 *    istisnaya daraltılmış hâli: yalnızca kullanıcı için ÜRETİLMEMİŞ metinler
 *    değişir.
 */
const INGILIZCE_KALIP = /^(Required|Expected|String must|Number must|Invalid|Too )/;

/**
 * ⚠️ SUNUCUNUN ŞEMA METİNLERİNİN DİLİ. Bugün `packages/contracts/src/schemas/`
 *    içindeki her `message:` Türkçe; yani sunucunun özel cümlesi yalnızca Türkçe
 *    yüzeyde gösterilebilir. Sabit bir `'tr'` yazmak yerine bu adın olması,
 *    şemalar bir gün koda çevrildiğinde değişecek TEK satırı işaretliyor.
 */
const SEMA_METIN_DILI: Locale = 'tr';

export function fieldMessage(
  field: ApiErrorDetailField,
  locale: Locale = VARSAYILAN_LOCALE,
): string {
  const metinler = sozluk(locale).alanHatasi;

  // Sunucu bu alan için ÖZEL bir cümle yazmışsa — ve gösterilen dil o cümlenin
  // dili ise — o cümle KAZANIR. Dil ayrıştığında kazanamaz: doğru bilgiyi
  // yanlış dilde göstermek, genel bilgiyi doğru dilde göstermekten kötüdür.
  if (locale === SEMA_METIN_DILI && field.message && !INGILIZCE_KALIP.test(field.message)) {
    return field.message;
  }

  const anahtar = field.rule
    ? KURAL_ANAHTARI[field.rule as keyof typeof KURAL_ANAHTARI]
    : undefined;
  return anahtar ? metinler[anahtar] : metinler.gecersiz;
}

/** `react-hook-form` `setError` ile kullanılmak üzere: alan yolu → gösterilecek metin. */
export function fieldErrorMap(
  fields: readonly ApiErrorDetailField[],
  locale: Locale = VARSAYILAN_LOCALE,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const field of fields) {
    // `headers.Idempotency-Key` gibi form dışı yollar forma yazılmaz.
    if (field.path.startsWith('headers.')) continue;
    map[field.path] = fieldMessage(field, locale);
  }
  return map;
}
