/**
 * HATA KODU KATALOĞU — tek doğruluk kaynağı.
 *
 * Buradaki her kayıt hem HTTP davranışını hem kullanıcıya gösterilecek
 * mesajı hem de "bu hata Sentry'ye gitmeli mi" kararını belirler.
 *
 * Kural: yeni bir hata durumu eklerken ÖNCE buraya kod eklenir, sonra fırlatılır.
 * `throw new Error('...')` kullanılmaz.
 *
 * `message` içinde `{param}` yer tutucuları kullanılabilir; `appError()` çağrısında
 * `params` ile doldurulur.
 *
 * ═══ ÇOK DİLLİLİK — "MESAJI FRONTEND YENİDEN YAZMAZ" KURALI NASIL KORUNUYOR ═══
 *
 * Kural "metin telde gelir" DEĞİL, "metin KATALOĞA yazılır"dır. `hata-gosterimi.tsx`
 * bunu kendi yorumunda zaten böyle söylüyor: *"Metin değişikliği ERROR_CATALOG'ta
 * yapılır."* Çok dilde de öyle kalıyor — değişen tek şey kataloğun artık iki
 * dosyası olması:
 *
 *   - `error-catalog.ts`     → KAYNAK metin (Türkçe), bu dosya.
 *   - `error-catalog.en.ts`  → aynı anahtar kümesi, İngilizce.
 *
 * Sunucu telde KOD + PARAMETRE gönderir; metni gösterileceği dilde kuran taraf
 * `error-message.ts`tir ve o da SADECE bu iki dosyadan okur. Frontend hiçbir
 * yerde kendi cümlesini yazmaz.
 *
 * ⚠️ `message` TELDE GİTMEYE DEVAM EDİYOR ve bu bir çelişki değil, SÜRÜM SAPMASI
 *    YEDEĞİ: yeni bir kod açıldığında eski frontend derlemesi o kodu tanımaz;
 *    telden gelen hazır metin sayesinde kullanıcı boş kutu değil doğru cümleyi
 *    görür (yalnız sunucunun dilinde). `api-failure.ts` bu yedeği bilerek
 *    koruyor.
 */

/**
 * Hata aileleri — loglama ve raporlama davranışını belirler.
 *
 * - `validation` : girdi şeması tutmadı. Beklenen. Sentry'ye GİTMEZ.
 * - `domain`     : iş kuralı reddetti (stok yok, kupon geçersiz). Beklenen. Sentry'ye GİTMEZ.
 * - `integration`: dış servis hatası. Sentry'ye ÖRNEKLENEREK gider.
 * - `system`     : bizim hatamız. Sentry'ye gider + alarm.
 *
 * "Stok yetersiz" bir hata değil, bir iş sonucudur. Sentry'ye gönderilirse
 * gerçek hatalar gürültü içinde kaybolur.
 */
export type ErrorFamily = 'validation' | 'domain' | 'integration' | 'system';

/**
 * Yer tutucu değerinin TÜRÜ — biçimlendirme kararını bu belirler.
 *
 * ⚠️ `para` OLMADAN OLMAZ, VE BU ÖLÇÜLMÜŞ BİR ARIZANIN KAPISIDIR: bugün
 *    `COUPON_MIN_AMOUNT` ile `PAYOUT_BELOW_MINIMUM` parametreyi sunucuda
 *    `Money.formatMoney(...)`ten geçirip TELE HAZIR TÜRKÇE DİZGİ olarak
 *    ("1.000,00 ₺") koyuyordu. Metin İngilizceye çevrilince cümle İngilizce,
 *    içindeki tutar Türkçe ayraçlı kalırdı ("at least 1.000,00 ₺") — derleme
 *    geçer, test geçer, yalnız kullanıcı görür. Artık telde KURUŞ DİZGİSİ
 *    gider ("100000") ve biçim gösterildiği yerde, gösterildiği dile göre kurulur.
 *
 * ⚠️ `para` değerleri `Number()`a UĞRAMAZ; `BigInt` → `Money.formatMoney`
 *    yolundan geçer (`error-message.ts`). `sayi` ise gerçekten sayıdır (adet,
 *    gün, dakika) ve ÇOĞUL SEÇİMİ için sayısal kalmak zorundadır.
 */
export type ErrorParamKind = 'metin' | 'sayi' | 'para';

export interface ErrorDefinition {
  /** HTTP durum kodu */
  readonly status: number;
  readonly family: ErrorFamily;
  /** İstemci aynı isteği tekrar deneyebilir mi? */
  readonly retryable: boolean;
  /**
   * KAYNAK metin (Türkçe). Çevirisi `error-catalog.en.ts`te; ikisi
   * `error-catalog.test.ts` ile anahtar anahtar EŞİT tutulur.
   */
  readonly message: string;
  /**
   * Mesajdaki `{yerTutucu}` adlarının türü.
   *
   * ⚠️ Yer tutucusu olan HER kodda dolu olmak ZORUNDA ve testle kapalı: yeni
   *    bir yer tutucu ekleyip türünü bildirmeyi unutmak, o değerin biçimsiz
   *    basılması demek. Türsüz bırakılsaydı `sayi` ile `para` arasındaki fark
   *    kaybolur ve kuruş tutarı ekrana "100000" diye çıkardı.
   */
  readonly params?: Readonly<Record<string, ErrorParamKind>>;
}

const define = <T extends Record<string, ErrorDefinition>>(catalog: T): T => catalog;

export const ERROR_CATALOG = define({
  // ── KİMLİK & YETKİ ────────────────────────────────────────────────────
  AUTH_INVALID_CREDENTIALS: {
    status: 401,
    family: 'domain',
    retryable: false,
    message: 'E-posta veya şifre hatalı.',
  },
  AUTH_TOKEN_MISSING: {
    status: 401,
    family: 'domain',
    retryable: false,
    message: 'Bu işlem için giriş yapmalısınız.',
  },
  AUTH_TOKEN_INVALID: {
    status: 401,
    family: 'domain',
    retryable: false,
    message: 'Oturum bilgisi geçersiz, tekrar giriş yapın.',
  },
  AUTH_TOKEN_EXPIRED: {
    status: 401,
    family: 'domain',
    retryable: false,
    message: 'Oturumunuz sona erdi, tekrar giriş yapın.',
  },
  /** Refresh token yeniden kullanıldı → token hırsızlığı şüphesi, tüm oturumlar düşürülür. */
  AUTH_REFRESH_REUSED: {
    status: 401,
    family: 'domain',
    retryable: false,
    message: 'Güvenlik nedeniyle tüm oturumlarınız kapatıldı. Lütfen tekrar giriş yapın.',
  },
  AUTH_OTP_INVALID: {
    status: 400,
    family: 'domain',
    retryable: false,
    message: 'Doğrulama kodu hatalı.',
  },
  AUTH_OTP_EXPIRED: {
    status: 400,
    family: 'domain',
    retryable: false,
    message: 'Kodun süresi doldu, yeni kod isteyin.',
  },
  AUTH_ACCOUNT_LOCKED: {
    status: 423,
    family: 'domain',
    retryable: true,
    message: 'Çok fazla hatalı deneme yapıldı. {minutes} dakika sonra tekrar deneyin.',
    params: { minutes: 'sayi' },
  },
  AUTH_ACCOUNT_SUSPENDED: {
    status: 403,
    family: 'domain',
    retryable: false,
    message: 'Hesabınız askıya alınmış. Destek ile iletişime geçin.',
  },
  AUTH_EMAIL_NOT_VERIFIED: {
    status: 403,
    family: 'domain',
    retryable: false,
    message: 'Devam etmek için e-posta adresinizi doğrulayın.',
  },
  AUTH_FORBIDDEN: {
    status: 403,
    family: 'domain',
    retryable: false,
    message: 'Bu işlem için yetkiniz yok.',
  },
  AUTH_EMAIL_TAKEN: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu e-posta adresi zaten kayıtlı.',
  },
  AUTH_PHONE_TAKEN: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu telefon numarası zaten kayıtlı.',
  },

  // ── KATALOG ───────────────────────────────────────────────────────────
  PRODUCT_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Ürün bulunamadı veya yayından kaldırıldı.',
  },
  VARIANT_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Seçtiğiniz renk/beden bulunamadı.',
  },
  VARIANT_UNAVAILABLE: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Seçtiğiniz renk/beden şu an satışta değil.',
  },
  CATEGORY_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Kategori bulunamadı.',
  },
  SELLER_ON_VACATION: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu mağaza geçici olarak siparişe kapalı.',
  },

  // ── SEPET & STOK ──────────────────────────────────────────────────────
  CART_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Sepet bulunamadı.',
  },
  CART_EMPTY: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Sepetiniz boş.',
  },
  CART_EXPIRED: {
    status: 410,
    family: 'domain',
    retryable: false,
    message: 'Sepetinizin süresi doldu, ürünleri tekrar ekleyin.',
  },
  CART_PRICE_CHANGED: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Sepetinizdeki bir ürünün fiyatı güncellendi. Yeni tutarı onaylayın.',
  },
  INSUFFICIENT_STOCK: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Yeterli stok kalmadı. Bu üründen en fazla {available} adet alabilirsiniz.',
    params: { available: 'sayi' },
  },
  MAX_QUANTITY_EXCEEDED: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Bu üründen tek siparişte en fazla {max} adet alabilirsiniz.',
    params: { max: 'sayi' },
  },
  /**
   * Adet tavanından (MAX_QUANTITY_EXCEEDED) AYRI: burada sınır tek varyantın
   * adedi değil, sepetteki FARKLI ürün sayısıdır. Aynı kodla dönülürse
   * kullanıcı "10 adetten fazla alamazsınız" okur ve adedi düşürerek çözmeye
   * çalışır — oysa bir ürünü çıkarması gerekir.
   */
  CART_TOO_MANY_ITEMS: {
    status: 422,
    family: 'domain',
    retryable: false,
    message:
      'Sepetinize en fazla {max} farklı ürün ekleyebilirsiniz. Bir ürünü çıkarıp tekrar deneyin.',
    params: { max: 'sayi' },
  },
  COUPON_INVALID: {
    status: 400,
    family: 'domain',
    retryable: false,
    message: 'Kupon kodu geçersiz.',
  },
  COUPON_EXPIRED: {
    status: 400,
    family: 'domain',
    retryable: false,
    message: 'Kuponun süresi dolmuş.',
  },
  COUPON_MIN_AMOUNT: {
    status: 400,
    family: 'domain',
    retryable: false,
    message: 'Bu kupon için en az {minAmount} tutarında alışveriş yapmalısınız.',
    params: { minAmount: 'para' },
  },
  COUPON_ALREADY_USED: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu kuponu daha önce kullandınız.',
  },
  /**
   * COUPON_EXPIRED'dan AYRI: kupon hâlâ tarih olarak geçerli, ama toplam
   * kontenjanı bitti. "Süresi doldu" demek yanlış bilgi olurdu — kullanıcı
   * tarihi kontrol edip geçerli görünce destek kaydı açar.
   */
  COUPON_USAGE_LIMIT_REACHED: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu kupon için ayrılan kontenjan doldu. Başka bir kupon deneyebilirsiniz.',
  },
  COUPON_NOT_APPLICABLE: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Kupon sepetinizdeki ürünler için geçerli değil.',
  },
  SHIPPING_UNAVAILABLE: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Bu adrese kargo gönderimi yapılamıyor.',
  },
  ADDRESS_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Adres bulunamadı.',
  },

  // ── ÖDEME ─────────────────────────────────────────────────────────────
  PAYMENT_DECLINED: {
    status: 402,
    family: 'domain',
    retryable: false,
    message: 'Ödeme tamamlanamadı. Lütfen kart bilgilerinizi kontrol edin.',
  },
  PAYMENT_INSUFFICIENT_FUNDS: {
    status: 402,
    family: 'domain',
    retryable: false,
    message: 'Kartınızda yeterli bakiye yok.',
  },
  PAYMENT_LIMIT_EXCEEDED: {
    status: 402,
    family: 'domain',
    retryable: false,
    message: 'Kart limitiniz yetersiz. Taksitli ödemeyi deneyebilirsiniz.',
  },
  PAYMENT_CARD_INVALID: {
    status: 402,
    family: 'domain',
    retryable: false,
    message: 'Kart bilgileri geçersiz veya kartın süresi dolmuş.',
  },
  PAYMENT_3DS_FAILED: {
    status: 402,
    family: 'domain',
    retryable: true,
    message: '3D Secure doğrulaması tamamlanamadı.',
  },
  PAYMENT_3DS_CANCELLED: {
    status: 402,
    family: 'domain',
    retryable: true,
    message: '3D Secure doğrulaması iptal edildi.',
  },
  PAYMENT_BANK_REJECTED: {
    status: 402,
    family: 'domain',
    retryable: false,
    message: 'Bankanız işlemi onaylamadı. Bankanızla görüşün veya başka bir kart deneyin.',
  },
  PAYMENT_TIMEOUT: {
    status: 504,
    family: 'integration',
    retryable: true,
    message:
      'Ödeme yanıtı alınamadı. Siparişlerinizi kontrol edin, tutar çekildiyse siparişiniz oluşmuştur.',
  },
  PAYMENT_ALREADY_CAPTURED: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu sipariş zaten ödendi.',
  },
  PAYMENT_PROVIDER_DOWN: {
    status: 503,
    family: 'integration',
    retryable: true,
    message: 'Ödeme sistemi geçici olarak kullanılamıyor. Kısa süre sonra tekrar deneyin.',
  },
  PAYMENT_AMOUNT_MISMATCH: {
    status: 409,
    family: 'system',
    retryable: false,
    message: 'Ödeme tutarında uyuşmazlık var. İşlem güvenlik nedeniyle durduruldu.',
  },
  REFUND_EXCEEDS_PAYMENT: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'İade tutarı ödeme tutarını aşamaz.',
  },
  /**
   * REFUND_EXCEEDS_PAYMENT'tan AYRI: orada tahsilat VAR ama tutar fazla,
   * burada tahsilat HİÇ yok. Operatörün yapması gereken iş farklı — iade
   * değil sipariş iptali. Aynı kodla dönmek yanlış işleme yönlendirir.
   */
  REFUND_NO_CAPTURED_PAYMENT: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Bu siparişte tahsil edilmiş ödeme yok. İade yerine sipariş iptalini kullanın.',
  },
  /**
   * Webhook imzası tutmadı → istek sahte veya secret döndürülmüş.
   *
   * ⚠️ Aile `domain`, `integration` DEĞİL: sahte bildirim BEKLENEN bir olaydır
   *    (uç nokta herkese açık). Sentry'ye gitseydi tarayan botlar gerçek
   *    entegrasyon alarmlarını gürültüye boğardı. Gerçek secret uyuşmazlığı
   *    imza reddi oranından izlenir, tek tek hatalardan değil.
   */
  WEBHOOK_SIGNATURE_INVALID: {
    status: 401,
    family: 'domain',
    retryable: false,
    message: 'Bildirimin imzası doğrulanamadı. Geçerli bir imza ile tekrar gönderin.',
  },
  REFUND_WINDOW_CLOSED: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'İade süresi ({days} gün) dolmuş.',
    params: { days: 'sayi' },
  },

  // ── SİPARİŞ & İADE ────────────────────────────────────────────────────
  ORDER_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Sipariş bulunamadı.',
  },
  ORDER_NOT_CANCELLABLE: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Kargoya verilmiş sipariş iptal edilemez. İade talebi oluşturabilirsiniz.',
  },
  ORDER_INVALID_TRANSITION: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu durum değişikliği yapılamaz.',
  },
  PACKAGE_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Paket bulunamadı.',
  },
  PACKAGE_ALREADY_SHIPPED: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Paket zaten kargolandı.',
  },
  RETURN_NOT_ALLOWED: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Bu ürün için iade talebi oluşturulamaz.',
  },
  RETURN_ALREADY_EXISTS: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu ürün için zaten açık bir iade talebiniz var.',
  },
  /**
   * CART_EXPIRED'dan AYRI: sepet değil, siparişe AYRILMIŞ stok düştü. Sepet
   * hâlâ duruyor olabilir; kullanıcının yapması gereken sepeti doldurmak
   * değil, ödemeyi yeniden başlatmak.
   */
  ORDER_RESERVATION_EXPIRED: {
    status: 410,
    family: 'domain',
    retryable: false,
    message: 'Siparişiniz için ayrılan stok süresi doldu. Sepetinizden yeniden sipariş oluşturun.',
  },
  /**
   * Satış kaydı kendi içinde tutarsız (ör. satıcı hakedişi brütten büyük).
   *
   * ⚠️ Aile `system` + 500: bu bir kullanıcı hatası DEĞİL, veri bozukluğudur.
   *    Muhasebe kayıtları yanlışsa her iade yanlış tutar üretir; sessizce
   *    geçilirse fark ancak mutabakatta, günler sonra fark edilir. ALARM ŞART.
   */
  LEDGER_INCONSISTENT: {
    status: 500,
    family: 'system',
    retryable: false,
    message:
      'Sipariş kaydında tutarsızlık var, işlem güvenlik nedeniyle durduruldu. Destek ekibine şu kodu iletin: {requestId}',
    params: { requestId: 'metin' },
  },

  // ── AI / SANAL DENEME ─────────────────────────────────────────────────
  CONSENT_REQUIRED: {
    status: 403,
    family: 'domain',
    retryable: false,
    message: 'Devam etmek için fotoğraf işleme izni vermeniz gerekiyor.',
  },
  CONSENT_CROSS_BORDER_REQUIRED: {
    status: 403,
    family: 'domain',
    retryable: false,
    message:
      'Sanal deneme için fotoğrafınızın yurt dışındaki hizmet sağlayıcısına aktarılmasına izin vermelisiniz.',
  },
  PHOTO_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Fotoğraf bulunamadı veya süresi dolmuş.',
  },
  PHOTO_TOO_LARGE: {
    status: 413,
    family: 'validation',
    retryable: false,
    message: 'Fotoğraf boyutu {maxMb} MB’ı aşamaz.',
    params: { maxMb: 'sayi' },
  },
  PHOTO_INVALID_FORMAT: {
    status: 422,
    family: 'validation',
    retryable: false,
    message: 'Yalnızca JPG, PNG veya WebP formatında fotoğraf yükleyebilirsiniz.',
  },
  PHOTO_QUALITY_LOW: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Fotoğraf kalitesi yetersiz: {reason}',
    params: { reason: 'metin' },
  },
  PHOTO_NO_PERSON: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Fotoğrafta kişi tespit edilemedi. Tam boy bir fotoğraf ile tekrar deneyin.',
  },
  PHOTO_MULTIPLE_PERSONS: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Fotoğrafta birden fazla kişi var. Yalnız olduğunuz bir fotoğraf yükleyin.',
  },
  PRODUCT_NOT_TRYONABLE: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Bu ürün için sanal deneme desteklenmiyor.',
  },
  /**
   * ÇOKLU DENEME (KOMBİN) RETLERİ — üçü de KULLANICI SEÇİMİNİN sonucudur.
   *
   * ⚠️ Neden genel `VALIDATION_FAILED` yetmiyor: üç retten de aynı mesaj
   *    dönüyordu ("Gönderilen bilgiler geçersiz"), oysa kullanıcının yapması
   *    gereken üç ayrı şey var — bir parçayı çıkarmak, parça sayısını
   *    düzeltmek, tekrarı silmek. Kullanıcı ne yapacağını anlamadığı için
   *    aynı kombini tekrar tekrar gönderiyordu.
   *
   * Aile `domain`, `validation` DEĞİL: şema tutuyor (kimlikler geçerli, sayı
   * sınır içinde), reddeden şey GİYİM KURALI — elbisenin üstüne pantolon
   * giydirilemez. Zod'un yakaladığı biçim hataları `VALIDATION_FAILED`
   * kalmaya devam eder.
   *
   * 422 + `domain` → Sentry'ye gitmez; beklenen bir iş sonucudur.
   */
  OUTFIT_LAYER_CONFLICT: {
    status: 422,
    family: 'domain',
    retryable: false,
    /**
     * ⚠️ Mesaj bölge adı vermiyor (üst/alt/dış): çakışmanın hangi bölgede
     *    olduğu bilgisi ret sonucunda YAPILANDIRILMIŞ olarak taşınmıyor, yalnız
     *    log metnindeki serbest açıklamada var. "Üst giyimden birini bırakın"
     *    demek elbise + pantolon çakışmasında YANLIŞ yönlendirme olurdu.
     *    Kural cümlesi üç bölgeyi birden anlattığı için her durumda doğrudur.
     */
    message:
      'Aynı vücut bölgesi için iki parça seçilemez. Üst, alt ve dış giyimden yalnızca birer parça bırakın; elbise hem üstü hem altı kapladığı için yanına üst ya da alt giyim eklenemez.',
  },
  /**
   * Alt ve üst sınır TEK KOD: kullanıcı için ikisi de "parça sayısını düzelt"
   * eylemidir ve mesaj iki sınırı birden söylediği için hangi tarafa taştığı
   * ayrıca kodlanmasına gerek kalmadan anlaşılır. Ayrım gereken taraf —
   * log ve panel — `details.reason` alanından okur.
   */
  OUTFIT_PIECE_COUNT_INVALID: {
    status: 422,
    family: 'domain',
    retryable: false,
    /** Sınırlar parametre: sabit yazılsaydı @vt/adapters'taki değer değişince mesaj yalan söylerdi. */
    message: 'Kombin denemesi için en az {min}, en fazla {max} parça seçebilirsiniz.',
    params: { min: 'sayi', max: 'sayi' },
  },
  OUTFIT_DUPLICATE_PIECE: {
    status: 422,
    family: 'domain',
    retryable: false,
    message:
      'Aynı ürünü kombine iki kez ekleyemezsiniz. Tekrar eden parçayı çıkarın veya farklı bir ürünle değiştirin.',
  },
  TRYON_QUOTA_EXCEEDED: {
    status: 429,
    family: 'domain',
    retryable: true,
    message: 'Günlük sanal deneme hakkınız doldu ({used}/{limit}). Yarın tekrar deneyebilirsiniz.',
    params: { used: 'sayi', limit: 'sayi' },
  },
  TRYON_JOB_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Deneme kaydı bulunamadı.',
  },
  TRYON_PROVIDER_ERROR: {
    status: 503,
    family: 'integration',
    retryable: true,
    message: 'Sanal deneme oluşturulamadı. Birazdan tekrar deneyin.',
  },
  TRYON_TIMEOUT: {
    status: 504,
    family: 'integration',
    retryable: true,
    message: 'Sanal deneme çok uzun sürdü. Tekrar deneyebilirsiniz.',
  },
  TRYON_CONTENT_BLOCKED: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Fotoğrafınız işlenemedi. Lütfen farklı bir fotoğraf deneyin.',
  },
  /**
   * Platform AI harcama tavanı doldu — hem sanal deneme hem stil danışmanı.
   *
   * ⚠️ Mesaj bilinçli olarak GENEL: yalnızca "sanal deneme" deseydi, aynı kod
   *    stil danışmanında kullanıldığında kullanıcıya hiç denemediği bir
   *    özellikten söz edilirdi. Özellik adı geçmediği için her iki akışta da
   *    doğru okunur.
   */
  AI_BUDGET_EXCEEDED: {
    status: 503,
    family: 'domain',
    retryable: true,
    message: 'Yapay zekâ özellikleri geçici olarak kullanılamıyor. Kısa süre sonra tekrar deneyin.',
  },
  STYLIST_UNAVAILABLE: {
    status: 503,
    family: 'integration',
    retryable: true,
    message: 'Stil danışmanı şu an yanıt veremiyor. Birazdan tekrar deneyin.',
  },
  STYLIST_RATE_LIMITED: {
    status: 429,
    family: 'domain',
    retryable: true,
    message: 'Çok hızlı mesaj gönderiyorsunuz. Biraz bekleyip tekrar deneyin.',
  },
  /**
   * STYLIST_UNAVAILABLE'dan AYRI: sağlayıcı ayakta ama YAVAŞ.
   *
   * Neden ayrı kod: ikisi tek kodda toplanınca "kesinti mi, yavaşlık mı"
   * ayrımı alarm kuralında yapılamıyordu. Zaman aşımı oranı yükselmesi
   * genelde kapasite sorunudur ve kesintiden farklı bir müdahale gerektirir.
   */
  STYLIST_TIMEOUT: {
    status: 504,
    family: 'integration',
    retryable: true,
    message: 'Stil danışmanı yanıt vermekte gecikti. Tekrar deneyebilirsiniz.',
  },
  /**
   * Sağlayıcı 401/403 döndü → anahtar/izin YANLIŞ.
   *
   * ⚠️ Aile `integration` DEĞİL `system`: kök neden dış servis kesintisi değil,
   *    BİZİM yapılandırmamız. Integration sayılırsa "sağlayıcı çökmüş" diye
   *    beklenir ve kendiliğinden düzelmesi umulur; oysa kimse anahtarı
   *    düzeltmeden hizmet geri gelmez. Alarm bize bakmamızı söylemeli.
   */
  AI_PROVIDER_MISCONFIGURED: {
    status: 503,
    family: 'system',
    retryable: false,
    message: 'Stil danışmanı şu an kullanılamıyor. Ekibimiz durumdan haberdar.',
  },
  /** Sanal deneme sağlayıcısında aynı durum — bkz. AI_PROVIDER_MISCONFIGURED. */
  TRYON_PROVIDER_MISCONFIGURED: {
    status: 503,
    family: 'system',
    retryable: false,
    message: 'Sanal deneme şu an kullanılamıyor. Ekibimiz durumdan haberdar.',
  },
  /**
   * Sağlayıcı beklenen boyutta olmayan vektör döndürdü.
   *
   * ⚠️ Aile `system`: bu sessizce geçilirse arama indeksi eksik kalır ve
   *    "benzer ürünler" listesi kimseye hata göstermeden bozulur. Sabit
   *    kosinüs eşiğimiz yanlış boyutta anlamını yitirir (bkz. l2Normalize).
   */
  EMBEDDING_DIMENSION_MISMATCH: {
    status: 500,
    family: 'system',
    retryable: false,
    message: 'Ürün araması güncellenemedi. Destek ekibine şu kodu iletin: {requestId}',
    params: { requestId: 'metin' },
  },
  /** Gömme sağlayıcısı yanıt vermedi — genel UPSTREAM_UNAVAILABLE yerine. */
  EMBEDDING_PROVIDER_ERROR: {
    status: 503,
    family: 'integration',
    retryable: true,
    message: 'Ürün araması geçici olarak güncellenemiyor. Kısa süre sonra tekrar deneyin.',
  },

  // ── SATICI ────────────────────────────────────────────────────────────
  SELLER_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Mağaza bulunamadı.',
  },
  SELLER_NOT_APPROVED: {
    status: 403,
    family: 'domain',
    retryable: false,
    message: 'Mağazanız henüz onaylanmadı. Onay sonrası bilgilendirileceksiniz.',
  },
  SELLER_SUSPENDED: {
    status: 403,
    family: 'domain',
    retryable: false,
    message: 'Mağazanız askıya alındı. Destek ile iletişime geçin.',
  },
  SELLER_APPLICATION_EXISTS: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Zaten bekleyen bir başvurunuz var.',
  },
  /** DUPLICATE_RESOURCE yerine: hangi alanın çakıştığı mesajın kendisinde. */
  SELLER_STORE_SLUG_TAKEN: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu mağaza adresi kullanılıyor, farklı bir adres deneyin.',
  },
  /** DUPLICATE_RESOURCE yerine: satıcı aynı kupon kodunu ikinci kez girdi. */
  COUPON_CODE_TAKEN: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu kupon kodu zaten kullanımda, farklı bir kod deneyin.',
  },
  /**
   * Satıcı fiziksel stoğu, müşteri sepetlerinde REZERVE olan adedin altına
   * çekmek istedi.
   *
   * INSUFFICIENT_STOCK'tan AYRI: o kod müşteriye "en fazla N adet
   * alabilirsiniz" der. Satıcı panelinde bu cümlenin karşılığı yok — satıcı
   * satın almıyor, stok düzeltiyor. Sayı aynı, anlatılan iş farklı.
   */
  STOCK_BELOW_RESERVED: {
    status: 409,
    family: 'domain',
    retryable: false,
    message:
      'Bu varyanttan {reserved} adet müşteri sepetlerinde rezerve. Stoğu bu adedin altına indiremezsiniz.',
    params: { reserved: 'sayi' },
  },
  /**
   * Şifreli alan çözülemedi (anahtar rotasyonu veya bozuk kayıt).
   *
   * ⚠️ Ayrı kod olmasının nedeni ALARM: INTERNAL_ERROR gürültüsü içinde
   *    kaybolursa, IBAN'ı çözülemeyen satıcıların ödemesi sessizce yapılamaz.
   *    Kullanıcıya teknik ayrıntı SIZDIRILMAZ — mesaj bilinçli olarak genel.
   */
  FIELD_DECRYPT_FAILED: {
    status: 500,
    family: 'system',
    retryable: false,
    message:
      'Kayıtlı bilgileriniz okunamadı, işlem tamamlanamadı. Destek ekibine şu kodu iletin: {requestId}',
    params: { requestId: 'metin' },
  },
  /**
   * PAYOUT_PENDING_EXISTS'ten AYRI: orada satıcıya "zaten talebin var" denir,
   * burada ADMİNE "bu talep çoktan karara bağlanmış" denir. İki farklı kitle,
   * iki farklı eylem — satıcı bekler, admin listeyi tazeler.
   */
  PAYOUT_INVALID_STATE: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu ödeme talebi zaten karara bağlanmış ({status}). Listeyi yenileyip tekrar bakın.',
    params: { status: 'metin' },
  },
  /** Komisyon oranı politika tavanını aştı — genel VALIDATION_FAILED yerine. */
  COMMISSION_RATE_ABOVE_CAP: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Komisyon oranı en fazla %{maxPercent} olabilir. Daha düşük bir oran girin.',
    params: { maxPercent: 'sayi' },
  },
  /**
   * Komisyon versiyon çizelgesi çakışıyor (aynı anda iki açık versiyon vb.).
   *
   * ⚠️ Aile `system`: operatör girdisi değil, VERİ bozuk. Çakışan çizelgede
   *    hangi oranın uygulandığı belirsizdir — yanlış komisyon kesilir ve hata
   *    mutabakata kadar görünmez. Genel 500 gürültüsünden ayrılmalı ki alarm
   *    kuralı bu duruma özel eşik koyabilsin.
   */
  COMMISSION_VERSION_OVERLAP: {
    status: 500,
    family: 'system',
    retryable: false,
    message:
      'Komisyon çizelgesinde çakışma var, işlem durduruldu. Destek ekibine şu kodu iletin: {requestId}',
    params: { requestId: 'metin' },
  },
  BULK_UPLOAD_INVALID: {
    status: 422,
    family: 'validation',
    retryable: false,
    message: 'Yüklediğiniz dosyada {count} satırda hata var. Detayları inceleyip tekrar deneyin.',
    params: { count: 'sayi' },
  },
  PAYOUT_INSUFFICIENT_BALANCE: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Çekilebilir bakiyeniz yetersiz.',
  },
  PAYOUT_PENDING_EXISTS: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bekleyen bir ödeme talebiniz var. Sonuçlanmasını bekleyin.',
  },
  PAYOUT_BELOW_MINIMUM: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Ödeme talebi en az {minAmount} tutarında olmalıdır.',
    params: { minAmount: 'para' },
  },
  COMMISSION_RULE_NOT_FOUND: {
    status: 404,
    family: 'system',
    retryable: false,
    message: 'Komisyon kuralı bulunamadı. İşlem tamamlanamadı.',
  },

  // ── SİSTEM & ALTYAPI ──────────────────────────────────────────────────
  VALIDATION_FAILED: {
    status: 400,
    family: 'validation',
    retryable: false,
    message: 'Gönderilen bilgilerde hata var.',
  },
  NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Kayıt bulunamadı.',
  },
  DUPLICATE_RESOURCE: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu kayıt zaten mevcut.',
  },
  INVALID_REFERENCE: {
    status: 400,
    family: 'domain',
    retryable: false,
    message: 'Geçersiz bir kayda referans verildi.',
  },
  RATE_LIMITED: {
    status: 429,
    family: 'domain',
    retryable: true,
    message: 'Çok fazla istek gönderdiniz. {retryAfter} saniye sonra tekrar deneyin.',
    params: { retryAfter: 'sayi' },
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Aynı işlem anahtarı farklı bir istekle kullanıldı.',
  },
  IDEMPOTENCY_IN_PROGRESS: {
    status: 409,
    family: 'domain',
    retryable: true,
    message: 'İsteğiniz işleniyor, lütfen bekleyin.',
  },
  CONCURRENCY_CONFLICT: {
    status: 409,
    family: 'domain',
    retryable: true,
    message: 'Kayıt başka bir işlem tarafından güncellendi. Lütfen tekrar deneyin.',
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    family: 'validation',
    retryable: false,
    message: 'Gönderilen veri çok büyük.',
  },
  UPSTREAM_UNAVAILABLE: {
    status: 503,
    family: 'integration',
    retryable: true,
    message: 'Servis geçici olarak kullanılamıyor. Kısa süre sonra tekrar deneyin.',
  },
  UPSTREAM_TIMEOUT: {
    status: 504,
    family: 'integration',
    retryable: true,
    message: 'İşlem zaman aşımına uğradı. Tekrar deneyin.',
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    family: 'system',
    retryable: true,
    message: 'Sistem bakımda. Kısa süre sonra tekrar deneyin.',
  },
  INTERNAL_ERROR: {
    status: 500,
    family: 'system',
    retryable: false,
    message:
      'Beklenmeyen bir hata oluştu. Sorun devam ederse destek ekibine şu kodu iletin: {requestId}',
    params: { requestId: 'metin' },
  },
});

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ERROR_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];

export function getErrorDefinition(code: ErrorCode): ErrorDefinition {
  return ERROR_CATALOG[code];
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_CATALOG;
}

/**
 * Bu aile Sentry'ye raporlanmalı mı?
 * `integration` ailesi çağrı tarafında örneklenerek raporlanır (bkz. apps/api filter).
 */
export function shouldReport(family: ErrorFamily): boolean {
  return family === 'system' || family === 'integration';
}

/** `{param}` yer tutucularını doldurur. Eksik parametre yer tutucuyu olduğu gibi bırakır. */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}
