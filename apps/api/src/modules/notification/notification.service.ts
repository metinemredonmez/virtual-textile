import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  NotificationSender,
  type NotificationOutcome,
  type NotificationRequest,
} from '@vt/adapters';
import type { Logger } from '../../common/logger.js';

/**
 * API TARAFI BİLDİRİM SERVİSİ
 *
 * ⚠️ VARLIK SEBEBİ: OTP kodu bu servis bağlanana kadar yalnızca `console.warn`
 *    ile yazılıyordu. Üretimde kullanıcı kodu ALAMIYORDU — kayıt akışı fiilen
 *    çalışmıyordu.
 *
 * ⚠️ SENKRON GÖNDERİM YALNIZCA OTP İÇİN. Kullanıcı kayıt ekranında bekliyor;
 *    outbox → dağıtıcı → kuyruk yolu (≈10 sn gecikme) burada kabul edilemez.
 *    Sipariş/iade/payout bildirimleri BU SERVİSTEN ÇAĞRILMAZ: onlar
 *    `OutboxEvent`ten tetiklenir (bkz. notification.processor.ts). Sebep:
 *    transaction geri alınırsa olmamış bir sipariş için bildirim gitmemeli.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly sender: NotificationSender,
    private readonly logger: Logger,
  ) {}

  /**
   * OTP SMS'i gönderir.
   *
   * ⚠️ `code` PARAMETRE OLARAK ALINIR AMA HİÇBİR YERE LOGLANMAZ. Şablon
   *    doldurma sırasında gövdeye girer, gövde de loglanmaz (bkz.
   *    NotificationSender). `otpCode` pino redaction listesindedir; bu servis
   *    o listeye güvenmek yerine kodu hiç log nesnesine koymaz — redaction
   *    yalnızca alan ADI tuttuğunda çalışır, serbest metinde çalışmaz.
   *
   * ⚠️ Hata YUTULMAZ. Gönderilemediyse uç nokta 202 dönüp "kod yolda" demez;
   *    sessizce "gönderdim" demek, kullanıcının olmayan bir SMS'i beklemesi
   *    demektir.
   */
  async sendOtp(input: {
    phone: string;
    purpose: string;
    code: string;
    ttlSeconds: number;
  }): Promise<NotificationOutcome> {
    const minutes = Math.max(1, Math.round(input.ttlSeconds / 60));

    return this.send({
      channel: 'SMS',
      to: input.phone,
      template: 'otp-dogrulama',
      variables: { code: input.code, minutes: String(minutes) },
      messageId: otpMessageId(input.phone, input.purpose),
    });
  }

  /** Genel gönderim — şablon ve tekilleştirme kuralları gönderici içindedir. */
  async send(request: NotificationRequest): Promise<NotificationOutcome> {
    const outcome = await this.sender.send(request);

    if (outcome.status === 'uncertain') {
      // Gönderilmiş olabilir. Kullanıcıya hata döndürmüyoruz (ikinci bir SMS
      // tetiklemesin diye) ama iz bırakıyoruz.
      this.logger.warn(
        { template: request.template, channel: request.channel },
        'Bildirim durumu belirsiz — kullanıcı mesajı almamış olabilir',
      );
    }

    return outcome;
  }
}

/**
 * OTP TEKİLLEŞTİRME ANAHTARI
 *
 * İki karar bilinçlidir:
 *
 * 1. TELEFON HAM HÂLİYLE GİRMEZ, özeti girer. `messageId` log satırlarına
 *    yazılır; ham numara konsaydı `maskRecipient()` ile numarayı maskelemenin
 *    hiçbir anlamı kalmazdı — aynı satırda açık hâli dururdu.
 *
 * 2. KODDAN TÜRETİLMEZ. Kod özetlense bile 6 hane 10⁶ olasılıktır; log'a
 *    düşen bir özet, kodun kendisini vermekle eş değerdir.
 *
 * 3. HER ÜRETİMDE FARKLIDIR (zaman damgası). ⚠️ Bu bilerek böyledir:
 *    `OtpService.issue()` her çağrıda ÖNCEKİ kodu geçersiz kılar. Zaman
 *    penceresine göre tekilleştirseydik, kullanıcı "tekrar gönder"e bastığında
 *    SMS bastırılır ve elindeki kod artık doğrulanmayan ESKİ kod olurdu —
 *    yani tekilleştirme, doğrulamayı imkânsız hâle getirirdi. Ard arda
 *    gönderime karşı koruma burada değil, `RateLimit({ name: 'otpSend' })`
 *    guard'ındadır (3/saat).
 */
export function otpMessageId(phone: string, purpose: string, now: number = Date.now()): string {
  const digest = createHash('sha256').update(phone).digest('hex').slice(0, 16);
  return `otp:${purpose}:${digest}:${String(now)}`;
}
