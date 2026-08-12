import {
  ConsoleEmailProvider,
  ConsoleSmsProvider,
  UnconfiguredEmailProvider,
  UnconfiguredSmsProvider,
} from './console.notification.js';
import { NetgsmSmsProvider, type NetgsmConfig } from './netgsm.sms.js';
import { ResendEmailProvider, type ResendConfig } from './resend.email.js';
import type { EmailProvider, SmsProvider } from './notification.provider.js';

/**
 * BİLDİRİM SAĞLAYICI SEÇİMİ — KOŞULLU FABRİKA
 *
 * Kalıp `apps/api/src/modules/media/index.ts` ile aynıdır: karar ORTAMDAN
 * okunur, kodda sabitlenmez. Anahtar geldiğinde deploy edilen şey yeni bir kod
 * değil, yeni bir env'dir.
 *
 * ⚠️ MEDYADAN BİR FARKI VAR ve bilinçlidir: depolama anahtar yokken HER ORTAMDA
 *    fail-closed yer tutucuya düşer. Bildirimde ise davranış ortama göre
 *    AYRIŞIR:
 *
 *      geliştirme/test → KONSOL. Sebep: yerel makinede kayıt olabilmek için
 *                        Netgsm hesabı şart olmamalı; akış kırılmasın.
 *      üretim          → FAIL-CLOSED. Sebep: sessizce "gönderdim" demek en
 *                        kötü davranıştır (bkz. console.notification.ts).
 *
 * ⚠️ Yüklemler ANAHTARIN VARLIĞINA bakar, geçerliliğine değil (wiring.ts ile
 *    aynı kural): açılışta sağlayıcıya doğrulama çağrısı yapmak, süreci dış
 *    servise bağımlı hâle getirirdi.
 */

// Yüklemler tam `Env` yerine DAR dilim alır — wiring.ts'teki gerekçenin aynısı.

export interface SmsKeys {
  NETGSM_USER: string;
  NETGSM_PASS: string;
  NETGSM_HEADER: string;
}

export interface EmailKeys {
  RESEND_API_KEY: string;
  MAIL_FROM: string;
}

/**
 * ⚠️ Üçü birden gerekir. Başlık (`NETGSM_HEADER`) eksikse Netgsm 40 hatası
 *    döner; yani "yarı yapılandırılmış" bir SMS sağlayıcısı hiç
 *    yapılandırılmamıştan farksızdır — ama sessizce çalışıyor görünür.
 */
export const isSmsConfigured = (config: SmsKeys): boolean =>
  config.NETGSM_USER !== '' && config.NETGSM_PASS !== '' && config.NETGSM_HEADER !== '';

/**
 * ⚠️ `MAIL_FROM` env şemasında `noreply@example.com` VARSAYILANINA sahiptir;
 *    yani "dolu olması" yapılandırıldığı anlamına gelmez. Varsayılan adresle
 *    gönderilen her e-posta Resend tarafından reddedilir (doğrulanmamış alan
 *    adı). Bu yüzden varsayılan değer açıkça yapılandırılmamış sayılır.
 */
export const DEFAULT_MAIL_FROM = 'noreply@example.com';

export const isEmailConfigured = (config: EmailKeys): boolean =>
  config.RESEND_API_KEY !== '' && config.MAIL_FROM !== '' && config.MAIL_FROM !== DEFAULT_MAIL_FROM;

export type NotificationEnv = SmsKeys &
  EmailKeys & {
    NODE_ENV: string;
  };

/** Test ve yerel kurulum için: gerçek sağlayıcıya geçilecek ek ayarlar. */
export interface NotificationFactoryOverrides {
  sms?: Partial<Omit<NetgsmConfig, 'user' | 'pass' | 'header'>>;
  email?: Partial<Omit<ResendConfig, 'apiKey' | 'from'>>;
}

/**
 * ⚠️ Üretimde anahtar yoksa KONSOL DEĞİL, fail-closed yer tutucu bağlanır.
 *    `env.ts` şeması `RESEND_API_KEY`i üretimde zorunlu kılıyor ama Netgsm
 *    anahtarlarını KILMIYOR — yani SMS için bu kontrol ikinci bir güvence
 *    değil, TEK güvencedir. Kaldırılırsa üretimde OTP sessizce konsola yazılır
 *    ve hiç kimseye ulaşmaz.
 */
export function createSmsProvider(
  config: NotificationEnv,
  overrides: NotificationFactoryOverrides = {},
): SmsProvider {
  if (isSmsConfigured(config)) {
    return new NetgsmSmsProvider({
      user: config.NETGSM_USER,
      pass: config.NETGSM_PASS,
      header: config.NETGSM_HEADER,
      ...overrides.sms,
    });
  }

  return config.NODE_ENV === 'production'
    ? new UnconfiguredSmsProvider()
    : new ConsoleSmsProvider();
}

export function createEmailProvider(
  config: NotificationEnv,
  overrides: NotificationFactoryOverrides = {},
): EmailProvider {
  if (isEmailConfigured(config)) {
    return new ResendEmailProvider({
      apiKey: config.RESEND_API_KEY,
      from: config.MAIL_FROM,
      ...overrides.email,
    });
  }

  return config.NODE_ENV === 'production'
    ? new UnconfiguredEmailProvider()
    : new ConsoleEmailProvider();
}

/**
 * Açılış raporu satırları — `providerWiring()` ile aynı biçim.
 *
 * ⚠️ `wiring.ts` bu ajanın dosyası değil; bildirim yetenekleri oraya
 *    eklenemedi. Rapor satırları burada üretilir ve bildirim modülünün
 *    fabrikası tarafından loglanır.
 *
 * // TODO(entegrasyon): bu iki satır `providerWiring()` içine taşınmalı ki
 * //   açılışta TEK bir sağlayıcı raporu kalsın.
 */
export function notificationWiring(config: NotificationEnv): Array<{
  capability: string;
  implementation: string;
  configured: boolean;
  keys: readonly string[];
}> {
  const sms = isSmsConfigured(config);
  const email = isEmailConfigured(config);
  const placeholder = config.NODE_ENV === 'production' ? 'unconfigured' : 'console';

  return [
    {
      capability: 'sms',
      implementation: sms ? 'netgsm' : placeholder,
      configured: sms,
      // ⚠️ Yalnızca ADLAR — değer yazılmaz (wiring.ts ile aynı kural).
      keys: ['NETGSM_USER', 'NETGSM_PASS', 'NETGSM_HEADER'],
    },
    {
      capability: 'email',
      implementation: email ? 'resend' : placeholder,
      configured: email,
      keys: ['RESEND_API_KEY', 'MAIL_FROM'],
    },
  ];
}
