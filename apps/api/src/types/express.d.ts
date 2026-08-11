/**
 * Express Request'e uygulamaya özgü alanlar eklenir.
 *
 * Ayrı bir .d.ts dosyasında tutuluyor: modül genişletmesinin (declaration
 * merging) çalışması için TypeScript'in dosyayı global olarak görmesi gerekir.
 */
import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    /** requestContextMiddleware tarafından atanır; log ve hata zarfında kullanılır. */
    id?: string;
    /** Auth guard doğrulanmış token'dan atar. */
    userId?: string;
    /** Satıcı paneli isteklerinde aktif mağaza. */
    sellerId?: string;
  }
}
