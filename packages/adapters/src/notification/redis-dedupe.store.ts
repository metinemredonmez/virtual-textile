import type { DedupeClaim, NotificationDedupeStore } from './notification.provider.js';

/**
 * REDIS TABANLI TEKİLLEŞTİRME DEPOSU
 *
 * ⚠️ `apps/api` ve `apps/worker` AYNI uygulamayı kullanır. İki ayrı kopya
 *    yazılsaydı OTP'yi API gönderirken kuyruk aynı mesajı ikinci kez
 *    gönderebilirdi — anahtar biçimi tek satır bile ayrışsa tekilleştirme
 *    tamamen kaybolur.
 *
 * ⚠️ `ioredis` BURADA import EDİLMEZ. Bu paketin çalışma zamanı bağımlılığı
 *    yalnızca @vt/config ve @vt/contracts'tır; ihtiyaç duyulan yüzey yapısal
 *    bir arayüzle alınır. `RedisService` (api) ve `RedisConnection` (worker)
 *    ikisi de `Redis` sınıfından türediği için doğrudan geçilebilir.
 */
export interface DedupeRedis {
  /** `SET key value EX ttl NX` — anahtar YOKSA yazar. Varsa `null` döner. */
  set(
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
    setMode: 'NX',
  ): Promise<'OK' | null>;
  /** `SET key value EX ttl` — koşulsuz yazar (durum geçişi için gerekli). */
  set(key: string, value: string, expiryMode: 'EX', ttlSeconds: number): Promise<'OK'>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

/** `sent:` öneki ile durum ve sağlayıcı referansı tek değerde taşınır. */
const SENT_PREFIX = 'sent:';
const IN_FLIGHT = 'in-flight';

export class RedisNotificationDedupeStore implements NotificationDedupeStore {
  constructor(
    private readonly redis: DedupeRedis,
    /** Anahtar ön eki — diğer Redis kullanıcılarıyla çakışmasın. */
    private readonly prefix = 'notif:msg:',
  ) {}

  private key(messageId: string): string {
    return `${this.prefix}${messageId}`;
  }

  /**
   * ⚠️ ATOMİKLİK BURADA: `SET NX`. "Önce GET, yoksa SET" yazılsaydı iki
   *    tüketici aynı anda boş görüp ikisi de gönderirdi — tam olarak
   *    engellemeye çalıştığımız durum.
   */
  async claim(messageId: string, ttlSeconds: number): Promise<DedupeClaim> {
    const key = this.key(messageId);
    const acquired = await this.redis.set(key, IN_FLIGHT, 'EX', ttlSeconds, 'NX');

    if (acquired === 'OK') return { state: 'fresh' };

    const existing = await this.redis.get(key);

    if (existing?.startsWith(SENT_PREFIX)) {
      return { state: 'sent', providerRef: existing.slice(SENT_PREFIX.length) };
    }

    // ⚠️ `null` da 'in-flight' sayılır: kayıt SET NX ile GET arasında düşmüş
    //    olabilir. "Bilmiyorum" durumunda göndermemek, iki kez göndermekten
    //    ucuzdur (bkz. NotificationSender'daki asimetri).
    return { state: 'in-flight' };
  }

  /**
   * ⚠️ NX KULLANILMAZ. Kayıt şu anda 'in-flight' durumundadır; `NX` ile yazmaya
   *    çalışmak SESSİZCE başarısız olur ve kayıt kısa in-flight TTL'iyle
   *    kalırdı. O TTL dolduğunda aynı mesaj "hiç görülmemiş" sayılıp İKİNCİ kez
   *    gönderilirdi — tekilleştirmenin tamamen kaybolduğu yer tam burasıdır.
   */
  async complete(messageId: string, providerRef: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.key(messageId), `${SENT_PREFIX}${providerRef}`, 'EX', ttlSeconds);
  }

  async release(messageId: string): Promise<void> {
    await this.redis.del(this.key(messageId));
  }
}
