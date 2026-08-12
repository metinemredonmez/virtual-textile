import { describe, expect, it, vi } from 'vitest';
import { AppError, integrationError } from '@vt/contracts';
import { CircuitOpenError } from '../resilience/circuit-breaker.js';
import { TimeoutError } from '../resilience/resilient.js';
import {
  ConsoleEmailProvider,
  ConsoleSmsProvider,
  UnconfiguredEmailProvider,
  UnconfiguredSmsProvider,
} from './console.notification.js';
import { createEmailProvider, createSmsProvider, isSmsConfigured } from './notification.factory.js';
import {
  DEDUPE_INFLIGHT_TTL_SECONDS,
  type DedupeClaim,
  type EmailProvider,
  type EmailSendInput,
  type NotificationDedupeStore,
  type SendResult,
  type SmsProvider,
  type SmsSendInput,
} from './notification.provider.js';
import { NetgsmHttpError, normalizeTrPhone, parseNetgsmResponse } from './netgsm.sms.js';
import { RedisNotificationDedupeStore, type DedupeRedis } from './redis-dedupe.store.js';
import {
  NotificationSender,
  deliveryCertainlyFailed,
  maskRecipient,
  type NotificationLogger,
} from './notification.sender.js';
import { renderNotification, smsSegmentCount, type TemplateKey } from './template.js';
import { TR_TEMPLATES, TR_TEMPLATE_REGISTRY } from './templates/index.js';

// ── Test ikizleri ─────────────────────────────────────────────────────────

/**
 * Gerçek Redis deposunun sözleşmesini taklit eder.
 *
 * ⚠️ Bu ikiz, `RedisNotificationDedupeStore`un DAVRANIŞ ŞARTNAMESİDİR: claim
 *    atomiktir, ikinci çağrı asla `fresh` dönmez. Redis uygulaması SET NX ile
 *    aynı garantiyi verir.
 */
class InMemoryDedupeStore implements NotificationDedupeStore {
  private readonly records = new Map<
    string,
    { state: 'in-flight' | 'sent'; providerRef?: string }
  >();

  claim(messageId: string): Promise<DedupeClaim> {
    const existing = this.records.get(messageId);
    if (existing) {
      return Promise.resolve(
        existing.providerRef === undefined
          ? { state: existing.state }
          : { state: existing.state, providerRef: existing.providerRef },
      );
    }
    this.records.set(messageId, { state: 'in-flight' });
    return Promise.resolve({ state: 'fresh' });
  }

  complete(messageId: string, providerRef: string): Promise<void> {
    this.records.set(messageId, { state: 'sent', providerRef });
    return Promise.resolve();
  }

  release(messageId: string): Promise<void> {
    this.records.delete(messageId);
    return Promise.resolve();
  }

  /** Yalnızca test: önceki denemenin yarıda kaldığı durumu kurar. */
  markInFlight(messageId: string): void {
    this.records.set(messageId, { state: 'in-flight' });
  }
}

class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake-sms';
  readonly sent: SmsSendInput[] = [];
  error: unknown;

  send(input: SmsSendInput): Promise<SendResult> {
    if (this.error) return Promise.reject(this.error);
    this.sent.push(input);
    return Promise.resolve({ providerRef: `ref-${String(this.sent.length)}` });
  }
}

class FakeEmailProvider implements EmailProvider {
  readonly name = 'fake-email';
  readonly sent: EmailSendInput[] = [];

  send(input: EmailSendInput): Promise<SendResult> {
    this.sent.push(input);
    return Promise.resolve({ providerRef: 'mail-1' });
  }
}

function silentLogger(): NotificationLogger & { lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  return {
    lines,
    info: (payload) => void lines.push(payload),
    warn: (payload) => void lines.push(payload),
    error: (payload) => void lines.push(payload),
  };
}

function makeSender(
  overrides: {
    sms?: FakeSmsProvider;
    email?: FakeEmailProvider;
    dedupe?: InMemoryDedupeStore;
    logger?: NotificationLogger;
  } = {},
) {
  const sms = overrides.sms ?? new FakeSmsProvider();
  const email = overrides.email ?? new FakeEmailProvider();
  const dedupe = overrides.dedupe ?? new InMemoryDedupeStore();
  const logger = overrides.logger ?? silentLogger();
  return { sender: new NotificationSender({ sms, email, dedupe, logger }), sms, email, dedupe };
}

// ── Şablon doldurma ───────────────────────────────────────────────────────

describe('şablon doldurma', () => {
  it('değişkenleri doldurur ve versiyonu taşır', () => {
    const rendered = renderNotification(TR_TEMPLATE_REGISTRY, 'otp-dogrulama', 'SMS', {
      code: '123456',
      minutes: '3',
    });

    expect(rendered.channel).toBe('SMS');
    expect(rendered.templateVersion).toBe(TR_TEMPLATES['otp-dogrulama'].version);
    if (rendered.channel === 'SMS') {
      expect(rendered.body).toContain('123456');
      expect(rendered.body).not.toContain('{');
    }
  });

  /**
   * ⚠️ EN ÖNEMLİ ŞABLON TESTİ: eksik değişken SESSİZCE geçilmemeli.
   * `@vt/contracts` içindeki `interpolate()` yer tutucuyu olduğu gibi bırakır;
   * bildirimde bu, kullanıcıya "{code} dogrulama kodunuz" SMS'i göndermektir.
   */
  it('eksik değişkende fırlatır — yarım metin göndermez', () => {
    expect(() =>
      renderNotification(TR_TEMPLATE_REGISTRY, 'otp-dogrulama', 'SMS', { code: '123456' }),
    ).toThrow(AppError);
  });

  it('boş string de eksik sayılır', () => {
    expect(() =>
      renderNotification(TR_TEMPLATE_REGISTRY, 'hosgeldin', 'EMAIL', { name: '' }),
    ).toThrow(AppError);
  });

  it('desteklenmeyen kanalda fırlatır — OTP e-postaya düşmez', () => {
    expect(() =>
      renderNotification(TR_TEMPLATE_REGISTRY, 'otp-dogrulama', 'EMAIL', {
        code: '1',
        minutes: '3',
      }),
    ).toThrow(AppError);
  });

  it('bilinmeyen şablonda fırlatır', () => {
    expect(() =>
      renderNotification(TR_TEMPLATE_REGISTRY, 'yok-boyle-sablon' as TemplateKey, 'SMS', {}),
    ).toThrow(AppError);
  });

  /** Mağaza adı / iade gerekçesi kullanıcı verisidir: HTML'e kaçışsız girmemeli. */
  it('e-posta HTML gövdesinde değişkenleri kaçırır, düz metinde kaçırmaz', () => {
    const rendered = renderNotification(TR_TEMPLATE_REGISTRY, 'satici-onaylandi', 'EMAIL', {
      storeName: '<script>alert(1)</script> & Co',
    });

    expect(rendered.channel).toBe('EMAIL');
    if (rendered.channel === 'EMAIL') {
      expect(rendered.html).not.toContain('<script>');
      expect(rendered.html).toContain('&lt;script&gt;');
      expect(rendered.html).toContain('&amp; Co');
      // Düz metinde kaçış YAPILMAZ — orada işaretleme yok, kaçış metni bozar.
      expect(rendered.text).toContain('<script>alert(1)</script> & Co');
    }
  });

  /**
   * Şablon metni ile `variables` listesi ayrışırsa hata ÜRETİM ANINDA çıkar:
   * gövdede olup listede olmayan bir yer tutucu, çağıran taraf onu bilmediği
   * için her gönderimi düşürür.
   */
  it('her şablonda bildirilen değişkenler ile gövdedeki yer tutucular birebir örtüşür', () => {
    for (const template of Object.values(TR_TEMPLATES)) {
      const bodies = [
        template.sms?.body,
        template.email?.subject,
        template.email?.html,
        template.email?.text,
      ].filter((value): value is string => value !== undefined);

      const used = new Set<string>();
      for (const body of bodies) {
        for (const match of body.matchAll(/\{(\w+)\}/g)) {
          if (match[1]) used.add(match[1]);
        }
      }

      expect([...used].sort()).toEqual([...template.variables].sort());
      expect(bodies.length).toBeGreaterThan(0);
    }
  });

  it('dokuz şablonun tamamı tanımlı', () => {
    expect(Object.keys(TR_TEMPLATES)).toHaveLength(9);
  });

  /** Türkçe karakter mesajı UCS-2'ye düşürür: segment 160 değil 70 karakter. */
  it('SMS segment sayısını Türkçe karaktere göre hesaplar', () => {
    expect(smsSegmentCount('a'.repeat(160))).toBe(1);
    expect(smsSegmentCount('a'.repeat(161))).toBe(2);
    expect(smsSegmentCount('ş'.repeat(70))).toBe(1);
    expect(smsSegmentCount('ş'.repeat(71))).toBe(2);
    expect(smsSegmentCount('')).toBe(0);
  });

  it('OTP şablonu tek segmente sığar — çift ücret ödenmez', () => {
    const rendered = renderNotification(TR_TEMPLATE_REGISTRY, 'otp-dogrulama', 'SMS', {
      code: '123456',
      minutes: '3',
    });
    if (rendered.channel === 'SMS') {
      expect(smsSegmentCount(rendered.body)).toBe(1);
    }
  });
});

// ── Tekilleştirme (idempotency) ───────────────────────────────────────────

describe('idempotency', () => {
  const otp = {
    channel: 'SMS' as const,
    to: '05321234567',
    template: 'otp-dogrulama' as const,
    variables: { code: '123456', minutes: '3' },
    messageId: 'otp:user-1:1',
  };

  it('ilk gönderimde sağlayıcıyı çağırır', async () => {
    const { sender, sms } = makeSender();

    const outcome = await sender.send(otp);

    expect(outcome.status).toBe('sent');
    expect(sms.sent).toHaveLength(1);
  });

  /** ⚠️ Görevin çekirdeği: aynı messageId ile ikinci SMS GİTMEZ. */
  it('aynı messageId ikinci kez gönderilmez', async () => {
    const { sender, sms } = makeSender();

    await sender.send(otp);
    const second = await sender.send(otp);

    expect(second.status).toBe('duplicate');
    expect(sms.sent).toHaveLength(1);
  });

  it('tekrar çağrıda ilk gönderimin sağlayıcı referansını döner', async () => {
    const { sender } = makeSender();

    const first = await sender.send(otp);
    const second = await sender.send(otp);

    expect(second.status).toBe('duplicate');
    if (first.status === 'sent' && second.status === 'duplicate') {
      expect(second.providerRef).toBe(first.providerRef);
    }
  });

  it('farklı messageId ayrı gönderimdir', async () => {
    const { sender, sms } = makeSender();

    await sender.send(otp);
    await sender.send({
      ...otp,
      messageId: 'otp:user-1:2',
      variables: { code: '654321', minutes: '3' },
    });

    expect(sms.sent).toHaveLength(2);
  });

  /**
   * Önceki deneme yarıda kalmış: sağlayıcının mesajı alıp almadığı bilinmiyor.
   * ⚠️ Tekrar GÖNDERİLMEZ — çifte OTP, gönderilmemiş OTP'den pahalıdır.
   */
  it('yarıda kalmış denemeden sonra tekrar göndermez', async () => {
    const dedupe = new InMemoryDedupeStore();
    dedupe.markInFlight(otp.messageId);
    const { sender, sms } = makeSender({ dedupe });

    const outcome = await sender.send(otp);

    expect(outcome.status).toBe('uncertain');
    expect(sms.sent).toHaveLength(0);
  });

  it('bozuk şablonda tekilleştirme kaydı AÇILMAZ — düzeltildikten sonra gönderilebilir', async () => {
    const dedupe = new InMemoryDedupeStore();
    const claim = vi.spyOn(dedupe, 'claim');
    const { sender } = makeSender({ dedupe });

    await expect(sender.send({ ...otp, variables: { code: '1' } })).rejects.toThrow(AppError);
    expect(claim).not.toHaveBeenCalled();

    // Eksik değişken tamamlandığında aynı messageId ile gönderim mümkün.
    const outcome = await sender.send(otp);
    expect(outcome.status).toBe('sent');
  });

  it('ulaşmadığı kesin hatada kaydı bırakır — kuyruk yeniden deneyebilir', async () => {
    const dedupe = new InMemoryDedupeStore();
    const sms = new FakeSmsProvider();
    sms.error = integrationError(
      'UPSTREAM_UNAVAILABLE',
      { provider: 'netgsm', operation: 'send' },
      { cause: new NetgsmHttpError(400, 'gecersiz istek') },
    );
    const { sender } = makeSender({ dedupe, sms });

    await expect(sender.send(otp)).rejects.toThrow();

    // Kayıt bırakıldığı için sonraki deneme gerçekten gönderir.
    sms.error = undefined;
    const retry = await sender.send(otp);
    expect(retry.status).toBe('sent');
    expect(sms.sent).toHaveLength(1);
  });

  it('zaman aşımında kaydı BIRAKMAZ — mesaj gitmiş olabilir', async () => {
    const dedupe = new InMemoryDedupeStore();
    const sms = new FakeSmsProvider();
    sms.error = integrationError(
      'UPSTREAM_UNAVAILABLE',
      { provider: 'netgsm', operation: 'send' },
      { cause: new TimeoutError('netgsm.send', 10_000) },
    );
    const { sender } = makeSender({ dedupe, sms });

    await expect(sender.send(otp)).rejects.toThrow();

    sms.error = undefined;
    const retry = await sender.send(otp);
    expect(retry.status).toBe('uncertain');
    expect(sms.sent).toHaveLength(0);
  });

  /** ⚠️ OTP kodu ve mesaj gövdesi log satırlarına GİRMEZ. */
  it('log satırlarında OTP kodu ve alıcının tam numarası bulunmaz', async () => {
    const logger = silentLogger();
    const { sender } = makeSender({ logger });

    await sender.send(otp);

    const dump = JSON.stringify(logger.lines);
    expect(dump).not.toContain('123456');
    expect(dump).not.toContain('05321234567');
    expect(dump).toContain('otp-dogrulama');
  });

  it('gönderim hakkı in-flight TTL ile talep edilir', async () => {
    const dedupe = new InMemoryDedupeStore();
    const claim = vi.spyOn(dedupe, 'claim');
    const { sender } = makeSender({ dedupe });

    await sender.send(otp);

    expect(claim).toHaveBeenCalledWith(otp.messageId, DEDUPE_INFLIGHT_TTL_SECONDS);
  });
});

// ── Teslimat kesinliği ────────────────────────────────────────────────────

describe('deliveryCertainlyFailed', () => {
  it('devre açıkken istek hiç kurulmadı → kesin başarısız', () => {
    expect(deliveryCertainlyFailed(new CircuitOpenError('netgsm', 30_000))).toBe(true);
  });

  it('bağlantı reddi → kesin başarısız', () => {
    expect(deliveryCertainlyFailed(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(
      true,
    );
  });

  it('4xx → sağlayıcı reddetti, kesin başarısız', () => {
    expect(deliveryCertainlyFailed(new NetgsmHttpError(422, ''))).toBe(true);
  });

  it('429 → işlenmedi, kesin başarısız', () => {
    expect(deliveryCertainlyFailed(new NetgsmHttpError(429, ''))).toBe(true);
  });

  it('5xx → belirsiz, kesin değil', () => {
    expect(deliveryCertainlyFailed(new NetgsmHttpError(503, ''))).toBe(false);
  });

  it('zaman aşımı → belirsiz, kesin değil', () => {
    expect(deliveryCertainlyFailed(new TimeoutError('netgsm.send', 10_000))).toBe(false);
  });

  it('yapılandırılmamış sağlayıcı hatası → ağa çıkılmadı, kesin başarısız', async () => {
    // Girdiye BAKMADAN reddeder — yer tutucunun tamamı budur.
    const error = await new UnconfiguredSmsProvider().send().catch((caught: unknown) => caught);
    expect(deliveryCertainlyFailed(error)).toBe(true);
  });
});

// ── Sağlayıcı seçimi ──────────────────────────────────────────────────────

describe('sağlayıcı seçimi', () => {
  const base = {
    NETGSM_USER: '',
    NETGSM_PASS: '',
    NETGSM_HEADER: '',
    RESEND_API_KEY: '',
    MAIL_FROM: 'noreply@example.com',
    NODE_ENV: 'development',
  };

  it('anahtar yoksa geliştirmede konsola yazar — akış kırılmaz', () => {
    expect(createSmsProvider(base)).toBeInstanceOf(ConsoleSmsProvider);
    expect(createEmailProvider(base)).toBeInstanceOf(ConsoleEmailProvider);
  });

  /** ⚠️ Üretimde sessizce "gönderdim" demek yasak. */
  it('anahtar yoksa üretimde fail-closed', () => {
    const production = { ...base, NODE_ENV: 'production' };
    expect(createSmsProvider(production)).toBeInstanceOf(UnconfiguredSmsProvider);
    expect(createEmailProvider(production)).toBeInstanceOf(UnconfiguredEmailProvider);
  });

  it('anahtar varsa gerçek sağlayıcı bağlanır', () => {
    const configured = {
      ...base,
      NETGSM_USER: 'u',
      NETGSM_PASS: 'p',
      NETGSM_HEADER: 'MARKA',
      RESEND_API_KEY: 're_x',
      MAIL_FROM: 'no-reply@gercek.com',
    };
    expect(createSmsProvider(configured).name).toBe('netgsm');
    expect(createEmailProvider(configured).name).toBe('resend');
  });

  /** Başlık eksikse Netgsm 40 döner: yarı yapılandırma = yapılandırılmamış. */
  it('başlık eksikse SMS yapılandırılmamış sayılır', () => {
    expect(isSmsConfigured({ NETGSM_USER: 'u', NETGSM_PASS: 'p', NETGSM_HEADER: '' })).toBe(false);
  });

  /** Varsayılan MAIL_FROM ile gönderilen e-posta Resend tarafından reddedilir. */
  it('varsayılan MAIL_FROM yapılandırma sayılmaz', () => {
    const withKeyOnly = { ...base, RESEND_API_KEY: 're_x', NODE_ENV: 'production' };
    expect(createEmailProvider(withKeyOnly)).toBeInstanceOf(UnconfiguredEmailProvider);
  });
});

// ── Netgsm yardımcıları ───────────────────────────────────────────────────

describe('netgsm', () => {
  /** ⚠️ Normalizasyon tekilleştirme için de gerekir: aynı kişi = aynı anahtar. */
  it('telefon numarasını tek biçime indirger', () => {
    expect(normalizeTrPhone('05321234567')).toBe('5321234567');
    expect(normalizeTrPhone('+90 532 123 45 67')).toBe('5321234567');
    expect(normalizeTrPhone('905321234567')).toBe('5321234567');
    expect(normalizeTrPhone('5321234567')).toBe('5321234567');
  });

  /** ⚠️ Sabit hat 11 hanedir ve sıfırı atılınca geçerli görünür — SMS gitmez. */
  it('geçersiz ve sabit hat numaralarında null döner', () => {
    expect(normalizeTrPhone('123')).toBeNull();
    expect(normalizeTrPhone('02121234567')).toBeNull();
    expect(normalizeTrPhone('+902121234567')).toBeNull();
  });

  it('JSON ve düz metin yanıtların ikisini de okur', () => {
    expect(parseNetgsmResponse('{"code":"00","jobid":"123"}')).toEqual({
      code: '00',
      jobid: '123',
    });
    expect(parseNetgsmResponse('00 987654')).toEqual({ code: '00', jobid: '987654' });
    expect(parseNetgsmResponse('30').code).toBe('30');
  });
});

// ── Redis deposu ──────────────────────────────────────────────────────────

/**
 * Gerçek Redis'in SET NX semantiğini taklit eder: anahtar varsa NX yazmaz.
 * ⚠️ Bu ikizin doğruluğu testin tamamını taşır — `complete()` yanlışlıkla NX
 *    ile yazsaydı bu ikiz onu yakalar (gerçek Redis de yakalardı).
 */
class FakeRedis implements DedupeRedis {
  readonly store = new Map<string, { value: string; ttl: number }>();

  set(
    key: string,
    value: string,
    _expiryMode: 'EX',
    ttlSeconds: number,
    setMode?: 'NX',
  ): Promise<'OK'> & Promise<'OK' | null> {
    if (setMode === 'NX' && this.store.has(key)) {
      return Promise.resolve(null) as Promise<'OK'> & Promise<'OK' | null>;
    }
    this.store.set(key, { value, ttl: ttlSeconds });
    return Promise.resolve('OK') as Promise<'OK'> & Promise<'OK' | null>;
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key)?.value ?? null);
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.store.delete(key) ? 1 : 0);
  }
}

describe('RedisNotificationDedupeStore', () => {
  it('ilk talep fresh, ikinci talep in-flight döner', async () => {
    const store = new RedisNotificationDedupeStore(new FakeRedis());

    expect((await store.claim('m1', 120)).state).toBe('fresh');
    expect((await store.claim('m1', 120)).state).toBe('in-flight');
  });

  /**
   * ⚠️ `complete()` NX ile yazsaydı bu test kırılırdı: kayıt 'in-flight'ta
   *    kalır, kısa TTL dolunca mesaj ikinci kez gönderilirdi.
   */
  it('complete sonrası durum sent olur ve referansı taşır', async () => {
    const redis = new FakeRedis();
    const store = new RedisNotificationDedupeStore(redis);

    await store.claim('m1', 120);
    await store.complete('m1', 'job-42', 86_400);

    const claim = await store.claim('m1', 120);
    expect(claim.state).toBe('sent');
    expect(claim.providerRef).toBe('job-42');
  });

  it('complete uzun TTL yazar — in-flight TTL ile kalmaz', async () => {
    const redis = new FakeRedis();
    const store = new RedisNotificationDedupeStore(redis);

    await store.claim('m1', 120);
    await store.complete('m1', 'job-42', 86_400);

    expect(redis.store.get('notif:msg:m1')?.ttl).toBe(86_400);
  });

  it('release sonrası yeniden fresh olur', async () => {
    const store = new RedisNotificationDedupeStore(new FakeRedis());

    await store.claim('m1', 120);
    await store.release('m1');

    expect((await store.claim('m1', 120)).state).toBe('fresh');
  });

  it('gerçek gönderici ile uçtan uca: ikinci çağrı SMS göndermez', async () => {
    const sms = new FakeSmsProvider();
    const sender = new NotificationSender({
      sms,
      email: new FakeEmailProvider(),
      dedupe: new RedisNotificationDedupeStore(new FakeRedis()),
      logger: silentLogger(),
    });
    const request = {
      channel: 'SMS' as const,
      to: '05321234567',
      template: 'otp-dogrulama' as const,
      variables: { code: '123456', minutes: '3' },
      messageId: 'otp:e2e:1',
    };

    await sender.send(request);
    const second = await sender.send(request);

    expect(second.status).toBe('duplicate');
    expect(sms.sent).toHaveLength(1);
  });
});

describe('maskRecipient', () => {
  it('telefonu ve e-postayı maskeler', () => {
    expect(maskRecipient('5321234567')).toBe('532***67');
    expect(maskRecipient('ahmet@ornek.com')).toBe('ah***@ornek.com');
  });
});
