import { appError } from '@vt/contracts';
import type {
  EmailProvider,
  EmailSendInput,
  SendResult,
  SmsProvider,
  SmsSendInput,
} from './notification.provider.js';

/**
 * GELİŞTİRME VE FAIL-CLOSED SAĞLAYICILARI
 *
 * İki farklı davranış, iki farklı sebep — karıştırılmamalı:
 *
 *  1. KONSOL (geliştirme): anahtar yokken geliştirme akışı KIRILMASIN.
 *     Yerel makinede kayıt olmak için Netgsm hesabı gerekmemeli; OTP konsolda
 *     görünür ve akış sonuna kadar denenebilir.
 *
 *  2. YER TUTUCU (üretim): anahtar yokken GÖRÜNÜR biçimde hata ver.
 *     ⚠️ Üretimde en kötü davranış sessizce "gönderdim" demektir: kullanıcı
 *        kodu bekler, gelmez, destek "sistemde gönderilmiş görünüyor" der.
 *        Hiç göndermemek ile gönderdim demek arasındaki fark, sorunun 5
 *        dakikada mı yoksa 3 haftada mı bulunacağıdır.
 *
 * Hangisinin bağlanacağı `notification.factory.ts` içinde NODE_ENV ile
 * belirlenir — bu dosya kararı VERMEZ, yalnızca iki davranışı sunar.
 */

/**
 * ⚠️ OTP KODU PINO'YA YAZILMAZ.
 *
 * Burada bilerek `console.warn` kullanılır, uygulama logger'ı DEĞİL. Gerekçe:
 * pino çıktısı log toplama sistemine, oradan yedeklere akar ve geri alınamaz;
 * `otpCode` redaction listesinde tam da bunun için var (bkz. common/logger.ts).
 * Konsol ise yalnızca geliştiricinin terminalindedir ve hiçbir yere gitmez.
 * `otp.service.ts` bu kanaldan "ayrı bir kanal" diye söz eder — burasıdır.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';

  send(input: SmsSendInput): Promise<SendResult> {
    console.warn(`[GELİŞTİRME][SMS] ${input.to}\n${input.body}`);
    return Promise.resolve({ providerRef: `console:${input.messageId}` });
  }
}

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  send(input: EmailSendInput): Promise<SendResult> {
    console.warn(`[GELİŞTİRME][E-POSTA] ${input.to} — ${input.subject}\n${input.text}`);
    return Promise.resolve({ providerRef: `console:${input.messageId}` });
  }
}

/**
 * ⚠️ FAIL-CLOSED. Çağrıldığında HER ZAMAN hata verir.
 *
 * `media/index.ts` içindeki `UnconfiguredStorageProvider` ile aynı kalıp ve
 * aynı gerekçe: yapılandırılmamış bir yeteneğin başarı dönmesi, arızayı
 * gizleyerek maliyeti katlar.
 */
export class UnconfiguredSmsProvider implements SmsProvider {
  readonly name = 'unconfigured';

  send(): Promise<SendResult> {
    return Promise.reject(
      appError('SERVICE_UNAVAILABLE', {
        internalMessage: 'SMS sağlayıcısı yapılandırılmadı — NETGSM_USER/PASS/HEADER eksik',
      }),
    );
  }
}

export class UnconfiguredEmailProvider implements EmailProvider {
  readonly name = 'unconfigured';

  send(): Promise<SendResult> {
    return Promise.reject(
      appError('SERVICE_UNAVAILABLE', {
        internalMessage: 'E-posta sağlayıcısı yapılandırılmadı — RESEND_API_KEY eksik',
      }),
    );
  }
}
