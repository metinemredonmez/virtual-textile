export * from './resilience/resilient.js';
export * from './resilience/circuit-breaker.js';

// ── Sağlayıcı seçimi ───────────────────────────────────────────────────────
// Hangi yeteneğin gerçek adapter'a, hangisinin fail-closed yer tutucuya
// bağlanacağı ORTAM DEĞİŞKENİNDEN okunur; kararı veren yüklemler burada.
export * from './wiring.js';

// ── Sözleşmeler ────────────────────────────────────────────────────────────
export * from './payment/payment.provider.js';
export * from './storage/storage.provider.js';

// ── Uygulamalar ────────────────────────────────────────────────────────────
// ⚠️ `./ai/index.js` zaten `tryon.provider.js` ve `cache-key.js` dosyalarını
//    yeniden dışa açıyor; ayrıca burada tekrarlanmıyor.
export * from './ai/index.js';
export * from './payment/iyzico/index.js';
export * from './storage/r2/index.js';
