/**
 * BİLDİRİM ADAPTER'LARI — dışa açılan yüzey
 *
 * ⚠️ Burada NestJS `@Module` TANIMLANMAZ. `@vt/adapters` çerçeveden
 *    bağımsızdır (bkz. ai/index.ts); DI tanımları `apps/api` tarafındadır.
 *
 * Beklenen bağlama:
 *   • API    → `apps/api/src/modules/notification/` (OTP dahil senkron gönderim)
 *   • Worker → `apps/worker/src/jobs/notification.processor.ts` (QUEUE.NOTIFICATION)
 *
 * Sağlayıcı seçimi ORTAMDAN okunur:
 *   SMS      Netgsm  ← NETGSM_USER / NETGSM_PASS / NETGSM_HEADER
 *   E-posta  Resend  ← RESEND_API_KEY / MAIL_FROM
 *   Anahtar yoksa: geliştirmede konsol, ÜRETİMDE fail-closed.
 */

export * from './notification.provider.js';
export * from './redis-dedupe.store.js';
export * from './template.js';
export * from './templates/index.js';
export * from './netgsm.sms.js';
export * from './resend.email.js';
export * from './console.notification.js';
export * from './notification.factory.js';
export * from './notification.sender.js';
