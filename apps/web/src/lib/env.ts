import 'server-only';

/**
 * SUNUCU ORTAM DEĞİŞKENLERİ.
 *
 * ⚠️ `@vt/config`'in `env()` fonksiyonu BURADA KULLANILMAZ. O şema backend'in
 *    tamamını (JWT sırları, iyzico anahtarları, R2 kimlikleri) zorunlu kılıyor;
 *    frontend süreci onların hiçbirini bilmemeli ve bilmediği için de
 *    açılmamazlık etmemeli. Frontend'in ihtiyacı dört değişken.
 *
 * ⚠️ `import 'server-only'` bilinçli: bu dosya bir İstemci Bileşenine import
 *    edilirse DERLEME KIRILIR. Kırılmasaydı `SESSION_REDIS_URL` tarayıcı
 *    paketine girerdi.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} tanımlı değil. apps/web/.env.local dosyasına ekleyin (örnek: .env.example).`,
    );
  }
  return value;
}

/** API kökü — sondaki eğik çizgi ve `/v1` öneki burada normalize edilir. */
export function apiBaseUrl(): string {
  return `${required('API_URL').replace(/\/+$/, '')}/v1`;
}

/** Kendi kökenimiz. CSRF Origin denetiminin karşılaştırma değeri. */
export function appUrl(): string {
  return required('APP_URL').replace(/\/+$/, '');
}

/**
 * Oturum deposu. Backend'in REDIS_URL'i ile aynı örneği gösterebilir ama AYRI
 * değişkendir: web oturumları farklı bir Redis'e taşınabilmeli.
 */
export function sessionRedisUrl(): string {
  return process.env.SESSION_REDIS_URL ?? required('REDIS_URL');
}

/**
 * Idempotency anahtarı türetirken kullanılan tuz.
 *
 * ⚠️ `schema.prisma`da `key String @id` KÜRESEL birincil anahtardır: tahmin
 *    edilebilir bir anahtar başkasının kaydına çarpar ve `begin()` `userId`
 *    doğrulaması YAPMIYOR. Bu yüzden türetilmiş anahtarlar tuzlanır.
 */
export function sessionSecret(): string {
  return required('SESSION_SECRET');
}
