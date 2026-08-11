/**
 * SAĞLAYICI SEÇİM KURALLARI — TEK KAYNAK
 *
 * Bir sağlayıcının "gerçek mi, yer tutucu mu" olduğu kararı ORTAM
 * DEĞİŞKENİNDEN okunur; kodda sabitlenmez. Anahtar geldiğinde deploy edilen
 * şey yeni bir kod değil, yeni bir env olmalıdır.
 *
 * ⚠️ FAIL-CLOSED. Anahtar yoksa devreye giren yer tutucu, çağrıldığında
 *    GÖRÜNÜR biçimde hata verir. Sessizce "başarılı" dönen sahte bir sağlayıcı
 *    en tehlikeli davranıştır: ödemede parayı tahsil edilmiş sanmak, depolamada
 *    "sildim" denilen fotoğrafın durmaya devam etmesi demektir.
 *
 * ⚠️ Yüklem (predicate) fonksiyonları ANAHTARIN VARLIĞINA bakar, geçerliliğine
 *    değil. Yanlış bir anahtarın tespiti sağlayıcının işidir; burada yapılacak
 *    bir "doğrula" çağrısı açılışı dış servise bağımlı hâle getirirdi.
 */

// Yüklemler tam `Env` yerine DAR dilimler alır: hem test edilmesi kolaydır hem
// de bir yüklemin ilgisiz bir değişkene bakmaya başlaması mümkün olmaz.

export interface PaymentKeys {
  IYZICO_API_KEY: string;
  IYZICO_SECRET_KEY: string;
}

export interface StorageKeys {
  R2_ENDPOINT: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

export interface TryOnKeys {
  FAL_KEY: string;
  GOOGLE_AI_API_KEY: string;
}

export interface StylistKeys {
  ANTHROPIC_API_KEY: string;
}

/**
 * ⚠️ Üretimde (NODE_ENV=production) ödeme veya depolama yer tutucuda KALAMAZ.
 *    Burada ayrıca kontrol edilmiyor çünkü `@vt/config` env şeması bu
 *    anahtarları üretimde zaten ZORUNLU kılıyor: eksikse süreç hiç başlamaz.
 *    İkinci bir kontrol, ilk kontrolün ne söylediğini belirsizleştirirdi.
 */
export const isPaymentConfigured = (config: PaymentKeys): boolean =>
  config.IYZICO_API_KEY !== '' && config.IYZICO_SECRET_KEY !== '';

/** Üçü birden gerekir: eksik biriyle SigV4 imzası üretilemez. */
export const isStorageConfigured = (config: StorageKeys): boolean =>
  config.R2_ENDPOINT !== '' && config.R2_ACCESS_KEY_ID !== '' && config.R2_SECRET_ACCESS_KEY !== '';

export const isFalConfigured = (config: TryOnKeys): boolean => config.FAL_KEY !== '';

export const isGeminiConfigured = (config: TryOnKeys): boolean => config.GOOGLE_AI_API_KEY !== '';

export const isStylistLlmConfigured = (config: StylistKeys): boolean =>
  config.ANTHROPIC_API_KEY !== '';

// ── Açılış raporu ──────────────────────────────────────────────────────────

export interface ProviderStatus {
  /** Yetenek adı — sağlayıcı markası değil (sağlayıcı değişebilir). */
  capability: string;
  /** Devreye giren uygulama: 'iyzico', 'r2', 'sharp', 'unconfigured' … */
  implementation: string;
  configured: boolean;
  /**
   * Kararı belirleyen değişkenlerin ADLARI.
   * ⚠️ DEĞER YAZILMAZ. Bir kez log'a düşen anahtar, log toplama sistemine ve
   *    oradan yedeklere yayılır; geri alınamaz.
   */
  keys: readonly string[];
}

export type WiringEnv = PaymentKeys & StorageKeys & TryOnKeys & StylistKeys;

/**
 * Hangi yetenek gerçek sağlayıcıya, hangisi yer tutucuya bağlandı.
 *
 * Saf fonksiyon: hem açılış log'unu hem de testleri besler. Log ile gerçek
 * bağlama ayrışmasın diye modüllerdeki fabrikalar da AYNI yüklemleri kullanır.
 */
export function providerWiring(config: WiringEnv): ProviderStatus[] {
  const payment = isPaymentConfigured(config);
  const storage = isStorageConfigured(config);
  const fal = isFalConfigured(config);
  const gemini = isGeminiConfigured(config);
  const stylist = isStylistLlmConfigured(config);

  const tryOn = [fal ? 'fal' : '', gemini ? 'gemini' : ''].filter(Boolean).join('→');

  return [
    {
      capability: 'payment',
      implementation: payment ? 'iyzico' : 'unconfigured',
      configured: payment,
      keys: ['IYZICO_API_KEY', 'IYZICO_SECRET_KEY'],
    },
    {
      capability: 'storage',
      implementation: storage ? 'r2' : 'unconfigured',
      configured: storage,
      keys: ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
    },
    {
      // ⚠️ Anahtar GEREKTİRMEZ: `sharp` bir kütüphanedir, dış servis değil.
      //    Bu yüzden her ortamda gerçektir — EXIF temizliği yapılandırmaya
      //    bağlı olsaydı, unutulan bir env ile GPS'li fotoğraf depoya girerdi.
      capability: 'image-processing',
      implementation: 'sharp',
      configured: true,
      keys: [],
    },
    {
      capability: 'tryon',
      implementation: tryOn === '' ? 'unconfigured' : tryOn,
      configured: fal || gemini,
      keys: ['FAL_KEY', 'GOOGLE_AI_API_KEY'],
    },
    {
      capability: 'stylist-llm',
      implementation: stylist ? 'anthropic' : 'unconfigured',
      configured: stylist,
      keys: ['ANTHROPIC_API_KEY'],
    },
  ];
}

/** pino'nun `info(obj, msg)` imzasının ihtiyacımız olan kadarı. */
export interface WiringLogger {
  info(payload: Record<string, unknown>, message: string): void;
}

let alreadyLogged = false;

/**
 * Açılışta TEK BİR kayıt basar: hangi yetenek gerçek, hangisi yer tutucu.
 *
 * Neden tek kayıt: dört ayrı modül dört ayrı satır bassaydı, "acaba medya
 * modülü hiç yüklenmedi mi" sorusunun cevabı log'da yokluktan okunmak
 * zorunda kalırdı. Tek rapor, eksik olanı da açıkça gösterir.
 *
 * Neden bir kez: her modülün fabrikası bu fonksiyonu çağırır (hangisinin önce
 * çalıştığı Nest'e bağlıdır ve garanti edilmez); bayrak sayesinde ilk çağıran
 * raporu basar, kalanlar sessizce döner.
 */
export function logProviderWiring(logger: WiringLogger, config: WiringEnv): void {
  if (alreadyLogged) return;
  alreadyLogged = true;

  const wiring = providerWiring(config);
  logger.info(
    {
      providers: wiring.map((status) => ({
        capability: status.capability,
        implementation: status.implementation,
        status: status.configured ? 'yapılandırıldı' : 'yapılandırılmadı',
        keys: status.keys,
      })),
      unconfigured: wiring.filter((status) => !status.configured).map((s) => s.capability),
    },
    'Sağlayıcı bağlamaları',
  );
}

/** Yalnızca test için — açılış raporunun bir kez basılma bayrağını sıfırlar. */
export function resetProviderWiringLog(): void {
  alreadyLogged = false;
}
