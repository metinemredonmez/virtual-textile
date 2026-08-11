import { describe, expect, it } from 'vitest';
import {
  analyticsQuerySchema,
  bulkVariantUpdateSchema,
  createCouponSchema,
  createPayoutSchema,
  createProductSchema,
  decideReturnSchema,
  sellerApplySchema,
  updatePackageStatusSchema,
} from './seller.schema.js';

describe('sellerApplySchema', () => {
  const valid = {
    legalName: 'Vertex Tekstil A.Ş.',
    displayName: 'Vertex',
    taxNumber: '1234567890',
    taxOffice: 'Şişli',
    iban: 'TR330006100519786457841326',
    contactEmail: 'satis@vertex.com',
    contactPhone: '0532 123 45 67',
    storeSlug: 'vertex-store',
  };

  it('geçerli başvuruyu kabul eder ve normalize eder', () => {
    const result = sellerApplySchema.parse(valid);

    expect(result.contactPhone).toBe('+905321234567');
    expect(result.contactEmail).toBe('satis@vertex.com');
    expect(result.iban).toBe('TR330006100519786457841326');
  });

  it('boşluklu IBAN normalize edilir', () => {
    const result = sellerApplySchema.parse({
      ...valid,
      iban: 'TR33 0006 1005 1978 6457 8413 26',
    });
    expect(result.iban).toBe('TR330006100519786457841326');
  });

  /** IBAN mod-97 kontrolü: tek hane hatası yakalanmalı. */
  it('kontrol hanesi bozuk IBAN reddedilir', () => {
    expect(
      sellerApplySchema.safeParse({ ...valid, iban: 'TR340006100519786457841326' }).success,
    ).toBe(false);
  });

  it('geçersiz vergi numarası reddedilir', () => {
    expect(sellerApplySchema.safeParse({ ...valid, taxNumber: '123' }).success).toBe(false);
  });

  it('geçersiz mağaza adresi reddedilir', () => {
    expect(sellerApplySchema.safeParse({ ...valid, storeSlug: 'Vertex Store!' }).success).toBe(
      false,
    );
  });
});

describe('createPayoutSchema', () => {
  it('tutarı string kuruştan bigint e çevirir', () => {
    const result = createPayoutSchema.parse({ amountMinor: '150000' });

    expect(result.amountMinor).toBe(150_000n);
    expect(typeof result.amountMinor).toBe('bigint');
  });

  it('sıfır tutar reddedilir', () => {
    expect(createPayoutSchema.safeParse({ amountMinor: '0' }).success).toBe(false);
  });

  it('negatif tutar reddedilir', () => {
    expect(createPayoutSchema.safeParse({ amountMinor: '-5000' }).success).toBe(false);
  });

  /** Ondalık tutar = float sızıntısı. Kuruş tam sayıdır. */
  it('ondalıklı tutar reddedilir', () => {
    expect(createPayoutSchema.safeParse({ amountMinor: '1500.50' }).success).toBe(false);
  });
});

describe('updatePackageStatusSchema', () => {
  it('kargo bilgisiyle SHIPPED kabul edilir', () => {
    const result = updatePackageStatusSchema.parse({
      status: 'SHIPPED',
      carrier: 'Aras Kargo',
      trackingNo: '1234567890',
    });
    expect(result.status).toBe('SHIPPED');
  });

  /** Takip numarasız kargolama müşteriyi kör bırakır. */
  it('takip numarası olmadan SHIPPED reddedilir', () => {
    expect(
      updatePackageStatusSchema.safeParse({ status: 'SHIPPED', carrier: 'Aras Kargo' }).success,
    ).toBe(false);
  });

  it('gerekçesiz iptal reddedilir', () => {
    expect(updatePackageStatusSchema.safeParse({ status: 'CANCELLED' }).success).toBe(false);
  });

  /**
   * ⚠️ Satıcı paketi DELIVERED işaretleyemez: hakediş penceresi teslim
   *    tarihinden başlar, satıcı onu erken açabilirdi.
   */
  it('satıcı DELIVERED veya RETURNED işaretleyemez', () => {
    expect(updatePackageStatusSchema.safeParse({ status: 'DELIVERED' }).success).toBe(false);
    expect(updatePackageStatusSchema.safeParse({ status: 'RETURNED' }).success).toBe(false);
  });
});

describe('decideReturnSchema', () => {
  it('onay gerekçe istemez', () => {
    expect(decideReturnSchema.parse({ action: 'APPROVE' }).action).toBe('APPROVE');
  });

  it('ret gerekçesiz reddedilir', () => {
    expect(decideReturnSchema.safeParse({ action: 'REJECT' }).success).toBe(false);
  });

  it('kısa ret gerekçesi reddedilir', () => {
    expect(decideReturnSchema.safeParse({ action: 'REJECT', rejectReason: 'yok' }).success).toBe(
      false,
    );
  });
});

describe('createCouponSchema', () => {
  const base = {
    code: 'YAZ2026',
    discountType: 'PERCENTAGE' as const,
    discountValue: '1500',
    validFrom: '2026-06-01T00:00:00.000Z',
    validTo: '2026-09-01T00:00:00.000Z',
  };

  it('yüzdesel kuponu basis point olarak alır', () => {
    const result = createCouponSchema.parse(base);

    // 1500 bps = %15
    expect(result.discountValue).toBe(1_500n);
    expect(result.minCartMinor).toBe(0n);
    expect(result.usageLimitPerUser).toBe(1);
  });

  it('%100 üstü yüzdesel indirim reddedilir', () => {
    expect(createCouponSchema.safeParse({ ...base, discountValue: '10001' }).success).toBe(false);
  });

  it('bitiş tarihi başlangıçtan önceyse reddedilir', () => {
    expect(
      createCouponSchema.safeParse({
        ...base,
        validFrom: '2026-09-01T00:00:00.000Z',
        validTo: '2026-06-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('ücretsiz kargo kuponunda indirim tutarı sıfır olmalı', () => {
    expect(
      createCouponSchema.safeParse({
        ...base,
        discountType: 'FREE_SHIPPING',
        discountValue: '500',
      }).success,
    ).toBe(false);

    expect(
      createCouponSchema.safeParse({
        ...base,
        discountType: 'FREE_SHIPPING',
        discountValue: '0',
      }).success,
    ).toBe(true);
  });

  it('azami indirim yalnızca yüzdesel kuponda kullanılır', () => {
    expect(
      createCouponSchema.safeParse({
        ...base,
        discountType: 'FIXED_AMOUNT',
        discountValue: '5000',
        maxDiscountMinor: '1000',
      }).success,
    ).toBe(false);
  });

  it('kupon kodu büyük harfe çevrilir', () => {
    expect(createCouponSchema.parse({ ...base, code: 'yaz2026' }).code).toBe('YAZ2026');
  });
});

describe('createProductSchema', () => {
  const variant = {
    sku: 'VTX-001-S',
    color: 'Siyah',
    colorHex: '#111111',
    size: 'S',
    priceMinor: '14990',
  };
  const base = {
    title: 'Oversize Gömlek',
    description: 'Rahat kesim pamuklu gömlek.',
    categoryId: '0195f0c8-1c2a-7000-8000-000000000001',
    brandName: 'Vertex',
    gender: 'WOMAN' as const,
    variants: [variant],
  };

  it('geçerli ürünü kabul eder', () => {
    const result = createProductSchema.parse(base);
    expect(result.variants[0]?.priceMinor).toBe(14_990n);
    expect(result.variants[0]?.stock).toBe(0);
  });

  it('aynı renk/beden ikilisi reddedilir', () => {
    expect(
      createProductSchema.safeParse({
        ...base,
        variants: [variant, { ...variant, sku: 'VTX-001-S2' }],
      }).success,
    ).toBe(false);
  });

  it('mükerrer SKU reddedilir', () => {
    expect(
      createProductSchema.safeParse({
        ...base,
        variants: [variant, { ...variant, size: 'M' }],
      }).success,
    ).toBe(false);
  });

  it('varyantsız ürün reddedilir', () => {
    expect(createProductSchema.safeParse({ ...base, variants: [] }).success).toBe(false);
  });
});

describe('bulkVariantUpdateSchema', () => {
  const id = '0195f0c8-1c2a-7000-8000-000000000001';

  it('stok mutlak değer olarak alınır', () => {
    const result = bulkVariantUpdateSchema.parse({ updates: [{ variantId: id, stock: 42 }] });
    expect(result.updates[0]?.stock).toBe(42);
  });

  it('aynı varyant iki kez gönderilemez', () => {
    expect(
      bulkVariantUpdateSchema.safeParse({
        updates: [
          { variantId: id, stock: 1 },
          { variantId: id, stock: 2 },
        ],
      }).success,
    ).toBe(false);
  });

  it('güncellenecek alanı olmayan satır reddedilir', () => {
    expect(bulkVariantUpdateSchema.safeParse({ updates: [{ variantId: id }] }).success).toBe(false);
  });

  it('negatif stok reddedilir', () => {
    expect(
      bulkVariantUpdateSchema.safeParse({ updates: [{ variantId: id, stock: -1 }] }).success,
    ).toBe(false);
  });
});

describe('analyticsQuerySchema', () => {
  it('parametresiz istekte son 30 günü verir', () => {
    const result = analyticsQuerySchema.parse({});
    const days = (result.to.getTime() - result.from.getTime()) / (24 * 60 * 60 * 1000);

    expect(Math.round(days)).toBe(30);
  });

  it('verilen aralığı kullanır', () => {
    const result = analyticsQuerySchema.parse({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    });

    expect(result.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(result.to.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('ters aralık reddedilir', () => {
    expect(
      analyticsQuerySchema.safeParse({
        from: '2026-02-01T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  /** Sınırsız aralık raporu veritabanını yorar. */
  it('bir yılı aşan aralık reddedilir', () => {
    expect(
      analyticsQuerySchema.safeParse({
        from: '2020-01-01T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
