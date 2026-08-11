import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@vt/contracts';
import {
  IyzicoPaymentProvider,
  decimalStringToMinor,
  minorToDecimalString,
} from './iyzico.provider.js';
import { mapProviderErrorCode, mapThreeDsStatus } from './iyzico.error-map.js';
import { verifyWebhookSignature } from './iyzico.signature.js';

const SECRET = 'webhook-secret';
const NOW = 1_700_000_000_000;

function signedHeaders(
  rawBody: Buffer,
  options: { timestampMs?: number; secret?: string } = {},
): Record<string, string> {
  const timestamp = String(options.timestampMs ?? NOW);
  const signature = createHmac('sha256', options.secret ?? SECRET)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  return { 'x-iyz-signature-v3': signature, 'x-iyz-timestamp': timestamp };
}

function provider(fetchImpl: typeof fetch): IyzicoPaymentProvider {
  return new IyzicoPaymentProvider({
    baseUrl: 'https://sandbox-api.iyzipay.com',
    apiKey: 'key',
    secretKey: 'secret',
    webhookSecret: SECRET,
    fetchImpl,
    now: () => NOW,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('para dönüşümü', () => {
  it('kuruşu ondalık metne float kullanmadan çevirir', () => {
    expect(minorToDecimalString(0n)).toBe('0.00');
    expect(minorToDecimalString(5n)).toBe('0.05');
    expect(minorToDecimalString(14_990n)).toBe('149.90');
    // 2^53'ü aşan tutar bile bozulmadan taşınır.
    expect(minorToDecimalString(90_071_992_547_409_93n)).toBe('90071992547409.93');
  });

  it('sağlayıcı tutarını kuruşa geri çevirir', () => {
    expect(decimalStringToMinor('149.9')).toBe(14_990n);
    expect(decimalStringToMinor('149,90')).toBe(14_990n);
    expect(decimalStringToMinor('0.05')).toBe(5n);
    expect(decimalStringToMinor(12)).toBe(1200n);
  });

  it('çözümlenemeyen tutarı sessizce sıfır saymaz', () => {
    expect(() => decimalStringToMinor('bir şey')).toThrow(AppError);
  });
});

describe('hata eşlemesi', () => {
  it('bilinen banka kodlarını uygulama koduna çevirir', () => {
    expect(mapProviderErrorCode('10051')).toBe('PAYMENT_INSUFFICIENT_FUNDS');
    expect(mapProviderErrorCode('10054')).toBe('PAYMENT_CARD_INVALID');
    expect(mapProviderErrorCode('10005')).toBe('PAYMENT_BANK_REJECTED');
  });

  it('bilinmeyen kodu uydurmaz, genel redde düşer', () => {
    expect(mapProviderErrorCode('99999')).toBe('PAYMENT_DECLINED');
    expect(mapProviderErrorCode(undefined)).toBe('PAYMENT_DECLINED');
  });

  it('mdStatus 1 dışındaki her değeri başarısız sayar', () => {
    expect(mapThreeDsStatus('1').authenticated).toBe(true);
    for (const status of ['0', '2', '3', '4', '5', '6', '7', '8']) {
      expect(mapThreeDsStatus(status)).toEqual({
        authenticated: false,
        failure: 'PAYMENT_3DS_FAILED',
      });
    }
  });

  it('mdStatus hiç yoksa vazgeçme olarak işaretler', () => {
    expect(mapThreeDsStatus(undefined).failure).toBe('PAYMENT_3DS_CANCELLED');
  });
});

describe('webhook imza doğrulama', () => {
  const rawBody = Buffer.from('{"iyziEventId":"evt-1","status":"SUCCESS"}', 'utf8');

  it('geçerli imzayı kabul eder', () => {
    expect(
      verifyWebhookSignature({
        rawBody,
        headers: signedHeaders(rawBody),
        webhookSecret: SECRET,
        now: () => NOW,
      }).ok,
    ).toBe(true);
  });

  it('gövdenin tek baytı değişse imza tutmaz', () => {
    const headers = signedHeaders(rawBody);
    const tampered = Buffer.from('{"iyziEventId":"evt-1","status":"SUCCESS!"}', 'utf8');
    expect(
      verifyWebhookSignature({ rawBody: tampered, headers, webhookSecret: SECRET, now: () => NOW }),
    ).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('5 dakikadan eski isteği reddeder (tekrar oynatma)', () => {
    const old = NOW - 6 * 60 * 1000;
    expect(
      verifyWebhookSignature({
        rawBody,
        headers: signedHeaders(rawBody, { timestampMs: old }),
        webhookSecret: SECRET,
        now: () => NOW,
      }),
    ).toEqual({ ok: false, reason: 'timestamp_expired' });
  });

  it('imzasız isteği reddeder', () => {
    expect(
      verifyWebhookSignature({
        rawBody,
        headers: { 'x-iyz-timestamp': String(NOW) },
        webhookSecret: SECRET,
        now: () => NOW,
      }),
    ).toEqual({ ok: false, reason: 'signature_missing' });
  });

  it('başka bir anahtarla imzalanmış isteği reddeder', () => {
    expect(
      verifyWebhookSignature({
        rawBody,
        headers: signedHeaders(rawBody, { secret: 'saldirgan' }),
        webhookSecret: SECRET,
        now: () => NOW,
      }).ok,
    ).toBe(false);
  });

  it('verifyWebhook doğrulanmamış gövdeyi hiç parse etmez', () => {
    const iyzico = provider(vi.fn());
    expect(() => iyzico.verifyWebhook(rawBody, {})).toThrow(AppError);
  });

  it('doğrulanan olayda olay kimliğini çıkarır', () => {
    const iyzico = provider(vi.fn());
    const verified = iyzico.verifyWebhook(rawBody, signedHeaders(rawBody));
    expect(verified.eventId).toBe('evt-1');
  });
});

describe('retry sözleşmesi', () => {
  it('complete3ds ASLA tekrar denenmez — çifte çekim riski', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('503'), { status: 503 }));
    const iyzico = provider(fetchImpl as unknown as typeof fetch);

    await expect(iyzico.complete3ds({ providerRef: 'pay-1' })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('inquire idempotenttir ve tekrar denenir', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('503'), { status: 503 }))
      .mockResolvedValue(
        jsonResponse({ status: 'success', paymentId: 'pay-1', mdStatus: '1', paidPrice: '10.00' }),
      );
    const iyzico = provider(fetchImpl as unknown as typeof fetch);

    const result = await iyzico.inquire('conv-1');
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    expect(result?.status).toBe('CAPTURED');
    expect(result?.paidAmountMinor).toBe(1000n);
  });
});

describe('ödeme sonucu', () => {
  it('3DS doğrulanmamışsa banka koduna bakmadan 3DS hatası döner', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 'failure', mdStatus: '0', errorCode: '10051' }));
    const iyzico = provider(fetchImpl as unknown as typeof fetch);

    const result = await iyzico.complete3ds({ providerRef: 'pay-1' });
    expect(result.status).toBe('FAILED');
    expect(result.mappedFailure).toBe('PAYMENT_3DS_FAILED');
    // Ham kod korunur — loglanır, kullanıcıya gösterilmez.
    expect(result.failureCode).toBe('10051');
  });

  it('kalem toplamı sipariş tutarını tutmuyorsa sağlayıcıya hiç gitmez', async () => {
    const fetchImpl = vi.fn();
    const iyzico = provider(fetchImpl as unknown as typeof fetch);

    await expect(
      iyzico.initiate3ds({
        conversationId: 'conv-1',
        orderId: 'order-1',
        amountMinor: 10_000n,
        currency: 'TRY',
        installment: 1,
        buyer: {
          id: 'u1',
          name: 'Ada',
          surname: 'Yılmaz',
          email: 'ada@example.com',
          phone: '+905321234567',
          ipAddress: '1.2.3.4',
        },
        shippingAddress: { contactName: 'Ada', city: 'İstanbul', country: 'Türkiye', address: 'x' },
        billingAddress: { contactName: 'Ada', city: 'İstanbul', country: 'Türkiye', address: 'x' },
        items: [
          {
            orderItemId: 'i1',
            submerchantKey: 'sm-1',
            amountMinor: 9_000n,
            commissionMinor: 1_000n,
            commissionRateBps: 1200,
          },
        ],
        callbackUrl: 'https://api.example.com/v1/payments/3ds/callback',
      }),
    ).rejects.toThrow(AppError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
