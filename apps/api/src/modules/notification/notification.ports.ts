/**
 * BİLDİRİM MODÜLÜ — DI ANAHTARLARI
 *
 * Arayüzlerin (SmsProvider, EmailProvider) çalışma zamanı karşılığı yoktur;
 * Nest'in sınıf token'ı kullanamayacağı yerlerde string token gerekir.
 * Kalıp `media.ports.ts` ile aynıdır.
 */

export const NOTIFICATION_SMS = 'NOTIFICATION_SMS';
export const NOTIFICATION_EMAIL = 'NOTIFICATION_EMAIL';
export const NOTIFICATION_DEDUPE = 'NOTIFICATION_DEDUPE';
