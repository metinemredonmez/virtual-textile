import pino, { type Logger } from 'pino';

/**
 * Yapılandırılmış log (JSON).
 *
 * ⚠️ REDACTION KRİTİK: parola, token, kart bilgisi, IBAN ve API anahtarları
 * log'a ASLA yazılmaz. Bir kez yazılırsa log toplama sistemine, oradan
 * yedeklere yayılır ve geri alınamaz.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.refreshTokenHash',
  '*.otp',
  '*.otpCode',
  '*.cardNumber',
  '*.cvc',
  '*.cvv',
  '*.expiry',
  '*.iban',
  '*.ibanEnc',
  '*.taxNumber',
  '*.taxNumberEnc',
  '*.apiKey',
  '*.secret',
  '*.secretKey',
  '*.clientSecret',
  '*.authorization',
  // İç içe gövdeler
  'body.password',
  'body.otpCode',
  'body.card',
  'params.token',
  'query.token',
];

export interface LoggerOptions {
  level: string;
  pretty: boolean;
  service: string;
}

export function createLogger(options: LoggerOptions): Logger {
  return pino({
    level: options.level,
    base: { service: options.service },
    redact: { paths: REDACT_PATHS, censor: '[gizlendi]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(options.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
          },
        }
      : {}),
  });
}

export type { Logger };
