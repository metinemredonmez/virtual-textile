import { Module } from '@nestjs/common';
import { env, type Env } from '@vt/config';
import {
  NotificationSender,
  RedisNotificationDedupeStore,
  createEmailProvider,
  createSmsProvider,
  notificationWiring,
  type EmailProvider,
  type NotificationDedupeStore,
  type SmsProvider,
} from '@vt/adapters';
import { RedisService } from '../../infra/redis.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { NotificationService } from './notification.service.js';
import { NOTIFICATION_DEDUPE, NOTIFICATION_EMAIL, NOTIFICATION_SMS } from './notification.ports.js';

/**
 * SMS FABRİKASI
 *
 * ⚠️ FAIL-CLOSED — AMA YALNIZCA ÜRETİMDE. Depolamadan (bkz. media/index.ts)
 *    bilinçli olarak ayrılır:
 *
 *      geliştirme/test → KONSOL sağlayıcı. Yerel makinede kayıt olabilmek için
 *                        Netgsm hesabı gerekmemeli; akış kırılmasın.
 *      üretim          → görünür hata veren yer tutucu. Sessizce "gönderdim"
 *                        demek en kötü davranıştır: kullanıcı gelmeyecek bir
 *                        SMS'i bekler, destek kayıtta "gönderildi" görür.
 *
 * ⚠️ `env.ts` şeması `RESEND_API_KEY`i üretimde ZORUNLU kılar ama Netgsm
 *    anahtarlarını kılmaz. Yani SMS için buradaki kontrol ikinci bir güvence
 *    değil, TEK güvencedir.
 */
export function createNotificationSms(config: Env = env()): SmsProvider {
  return createSmsProvider(config);
}

export function createNotificationEmail(config: Env = env()): EmailProvider {
  return createEmailProvider(config);
}

/**
 * BİLDİRİM MODÜLÜ — SMS ve e-posta gönderimi.
 *
 * Sahip olduğu tablo: YOK. Bildirim gönderimi durumsuzdur; tek kalıcı durum
 * Redis'teki tekilleştirme kaydıdır (24 saat).
 *
 * ⚠️ Bu modül SENKRON gönderim içindir ve pratikte tek kullanıcısı OTP'dir.
 *    Sipariş/iade/payout bildirimleri BURADAN çağrılmaz — `OutboxEvent`ten
 *    tetiklenir (apps/worker → notification.processor.ts). Bir servisten
 *    doğrudan çağrılsaydı, transaction geri alındığında olmamış bir olay için
 *    bildirim gitmiş olurdu.
 */
@Module({
  providers: [
    {
      provide: NOTIFICATION_SMS,
      // Logger yalnızca açılış raporu için: hangi yetenek gerçek, hangisi yer
      // tutucu — anahtar DEĞERLERİ yazılmadan (bkz. media/index.ts).
      inject: [APP_LOGGER],
      useFactory: (logger: Logger): SmsProvider => {
        const config = env();
        const wiring = notificationWiring(config);
        logger.info(
          {
            providers: wiring.map((status) => ({
              capability: status.capability,
              implementation: status.implementation,
              status: status.configured ? 'yapılandırıldı' : 'yapılandırılmadı',
              keys: status.keys,
            })),
          },
          'Bildirim sağlayıcı bağlamaları',
        );
        return createNotificationSms(config);
      },
    },
    { provide: NOTIFICATION_EMAIL, useFactory: (): EmailProvider => createNotificationEmail() },
    {
      provide: NOTIFICATION_DEDUPE,
      inject: [RedisService],
      // ⚠️ Worker ile AYNI sınıf ve AYNI anahtar ön eki kullanılır. İki taraf
      //    farklı ön ek kullansaydı, API'nin gönderdiği mesajı kuyruk
      //    "görülmemiş" sayıp ikinci kez gönderebilirdi.
      useFactory: (redis: RedisService): NotificationDedupeStore =>
        new RedisNotificationDedupeStore(redis),
    },
    {
      provide: NotificationSender,
      inject: [NOTIFICATION_SMS, NOTIFICATION_EMAIL, NOTIFICATION_DEDUPE, APP_LOGGER],
      useFactory: (
        sms: SmsProvider,
        email: EmailProvider,
        dedupe: NotificationDedupeStore,
        logger: Logger,
      ): NotificationSender => new NotificationSender({ sms, email, dedupe, logger }),
    },
    {
      provide: NotificationService,
      inject: [NotificationSender, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof NotificationService>) =>
        new NotificationService(...args),
    },
  ],
  exports: [NotificationService, NotificationSender],
})
export class NotificationModule {}

// ── Genel yüzey ───────────────────────────────────────────────────────────

export { NotificationService, otpMessageId } from './notification.service.js';
export * from './notification.ports.js';
