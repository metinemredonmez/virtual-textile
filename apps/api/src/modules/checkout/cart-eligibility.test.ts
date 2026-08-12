import { describe, expect, it } from 'vitest';
import { AppError } from '@vt/contracts';
import type { CartItemView, CartPackageView, CartService, CartView } from '../cart/index.js';
import type { OrderService } from '../order/index.js';
import type { Logger } from '../../common/logger.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import { checkoutRejection, type CheckoutRejectionDetails } from './cart-eligibility.js';
import { CheckoutService, type CheckoutActor } from './checkout.service.js';
import type {
  AddressReaderPort,
  CatalogReaderPort,
  PaymentProviderPort,
} from './checkout.ports.js';
import type { CheckoutInitInput } from './checkout.schema.js';

/**
 * SEPET BOŞ MU, YOKSA SEPETTEKİLER Mİ ALINAMIYOR?
 *
 * Regresyonun kendisi bir SIRALAMA hatasıydı: `init` önce `packages.length`e
 * bakıp CART_EMPTY fırlatıyordu, alınamaz kalemleri hiç göremiyordu. Bu yüzden
 * testler yalnızca saf fonksiyonu değil, `CheckoutService.init`i de sürüyor —
 * saf fonksiyon doğru karar verip servis onu çağırmasaydı kullanıcı yine
 * "Sepetiniz boş." okurdu.
 */

const VARYANT_A = '0192f3a1-1111-7000-8000-aaaaaaaaaaaa';
const VARYANT_B = '0192f3a1-2222-7000-8000-bbbbbbbbbbbb';

function kalem(overrides: Partial<CartItemView> = {}): CartItemView {
  return {
    id: 'cart-item-1',
    variantId: VARYANT_A,
    outfitId: null,
    quantity: 1,
    productTitle: 'Keten Gömlek',
    productSlug: 'keten-gomlek',
    color: 'Siyah',
    size: 'M',
    imageKey: null,
    unitPriceMinor: 75_000n,
    lineTotalMinor: 75_000n,
    currentUnitPriceMinor: 75_000n,
    priceChanged: false,
    priceDiffMinor: 0n,
    issue: null,
    maxAvailable: null,
    ...overrides,
  };
}

function paket(items: CartItemView[]): CartPackageView {
  const subtotal = items.reduce((sum, item) => sum + item.lineTotalMinor, 0n);
  return {
    sellerId: 'seller-1',
    sellerName: 'Test Mağaza',
    storeSlug: 'test-magaza',
    items,
    subtotalMinor: subtotal,
    discountMinor: 0n,
    totalMinor: subtotal,
  };
}

function gorunum(overrides: Partial<CartView> = {}): CartView {
  const packages = overrides.packages ?? [];
  const subtotal = packages.reduce((sum, pkg) => sum + pkg.subtotalMinor, 0n);
  return {
    id: 'cart-1',
    packages,
    unavailableItems: [],
    coupon: null,
    subtotalMinor: subtotal,
    discountMinor: 0n,
    totalMinor: subtotal,
    itemCount: packages.reduce((sum, pkg) => sum + pkg.items.length, 0),
    distinctItemCount: packages.reduce((sum, pkg) => sum + pkg.items.length, 0),
    hasPriceChange: false,
    freeShipping: false,
    expiresAt: new Date('2026-08-12T12:00:00.000Z'),
    ...overrides,
  };
}

const detay = (error: AppError): CheckoutRejectionDetails =>
  error.details as CheckoutRejectionDetails;

// ── Üç durumun sepet görünümleri ────────────────────────────────────────────

/** 1. Gerçekten boş sepet. */
const bosSepet = (): CartView => gorunum();

/** 2. Tek kalem vardı, son ürünü başkası kaptı: paket kalmadı. */
const hepsiAlinamaz = (): CartView =>
  gorunum({
    packages: [],
    unavailableItems: [kalem({ issue: 'OUT_OF_STOCK' })],
  });

/** 3. İki kalemden biri düştü: sipariş verilebilir ama kullanıcı UYARILMALI. */
const kismenAlinamaz = (): CartView =>
  gorunum({
    packages: [paket([kalem({ id: 'cart-item-2', variantId: VARYANT_B })])],
    unavailableItems: [kalem({ productTitle: 'Yün Kazak', issue: 'OUT_OF_STOCK' })],
  });

describe('checkoutRejection — boş sepet ile alınamaz sepet ayrımı', () => {
  it('gerçekten boş sepette CART_EMPTY döner', () => {
    const hata = checkoutRejection(bosSepet());

    expect(hata?.code).toBe('CART_EMPTY');
    expect(hata?.httpStatus).toBe(422);
  });

  it('hiç sepet satırı yokken (id null) CART_EMPTY döner', () => {
    expect(checkoutRejection(gorunum({ id: null }))?.code).toBe('CART_EMPTY');
  });

  it('paketler boş ama alınamaz kalem varsa CART_EMPTY DEĞİL stok hatası döner', () => {
    const hata = checkoutRejection(hepsiAlinamaz());

    // ⚠️ Regresyonun tam noktası: burada "Sepetiniz boş." denemez.
    expect(hata?.code).not.toBe('CART_EMPTY');
    expect(hata?.code).toBe('INSUFFICIENT_STOCK');
    expect(hata?.httpStatus).toBe(409);
    expect(hata?.userMessage).not.toContain('Sepetiniz boş');
  });

  it('alınamaz kalemin kimliği ve adı details içinde döner', () => {
    const hata = checkoutRejection(hepsiAlinamaz())!;

    expect(detay(hata).items).toEqual([
      {
        variantId: VARYANT_A,
        productTitle: 'Keten Gömlek',
        color: 'Siyah',
        size: 'M',
        quantity: 1,
        reason: 'OUT_OF_STOCK',
        maxAvailable: null,
      },
    ]);
    // Sepette alınabilir hiçbir şey kalmadı: istemci "kalemi çıkar ve devam et"
    // diyemez, bunu bayraktan anlar.
    expect(detay(hata).hasPurchasableItems).toBe(false);
  });

  it('paket dolu ama bir kalem düştüyse istek yine reddedilir ve düşen kalem bellidir', () => {
    const hata = checkoutRejection(kismenAlinamaz())!;

    expect(hata.code).toBe('INSUFFICIENT_STOCK');
    expect(detay(hata).items.map((item) => item.productTitle)).toEqual(['Yün Kazak']);
    // Kalanla devam edilebilir — istemci kullanıcıya bunu önerebilsin.
    expect(detay(hata).hasPurchasableItems).toBe(true);
  });

  it('sorunsuz sepette null döner — akış devam eder', () => {
    expect(checkoutRejection(gorunum({ packages: [paket([kalem()])] }))).toBeNull();
  });

  it('stok dışı nedenle düşen kalemde VARIANT_UNAVAILABLE döner', () => {
    // "En fazla 0 adet alabilirsiniz" mesajı yayından kalkmış üründe yanıltıcı:
    // kullanıcı adedi düşürerek çözmeye çalışır, oysa ürün satışta değil.
    const hata = checkoutRejection(
      gorunum({ unavailableItems: [kalem({ issue: 'UNAVAILABLE' })] }),
    )!;

    expect(hata.code).toBe('VARIANT_UNAVAILABLE');
    expect(detay(hata).items[0]?.reason).toBe('UNAVAILABLE');
  });

  it('mağaza tatildeyken de stok kodu kullanılmaz', () => {
    const hata = checkoutRejection(
      gorunum({ unavailableItems: [kalem({ issue: 'SELLER_ON_VACATION' })] }),
    )!;

    expect(hata.code).toBe('VARIANT_UNAVAILABLE');
  });

  it('kalemler karışık nedenlerle düştüyse genel koda düşer', () => {
    const hata = checkoutRejection(
      gorunum({
        unavailableItems: [
          kalem({ issue: 'OUT_OF_STOCK' }),
          kalem({ id: 'cart-item-2', variantId: VARYANT_B, issue: 'UNAVAILABLE' }),
        ],
      }),
    )!;

    expect(hata.code).toBe('VARIANT_UNAVAILABLE');
    expect(detay(hata).items).toHaveLength(2);
  });

  it('mesajdaki {available} en kısıtlayıcı adetle doldurulur', () => {
    const hata = checkoutRejection(
      gorunum({
        unavailableItems: [
          kalem({ issue: 'INSUFFICIENT_STOCK', maxAvailable: 3 }),
          kalem({
            id: 'cart-item-2',
            variantId: VARYANT_B,
            issue: 'INSUFFICIENT_STOCK',
            maxAvailable: 1,
          }),
        ],
      }),
    )!;

    expect(hata.userMessage).toContain('en fazla 1 adet');
  });

  it('tükenen kalemde ham stok adedi sızmaz', () => {
    // Sepet görünümü OUT_OF_STOCK'ta maxAvailable'ı bilinçli olarak null
    // bırakıyor; burada yeniden hesaplanıp sayı üretilmemeli.
    const hata = checkoutRejection(hepsiAlinamaz())!;

    expect(detay(hata).items[0]?.maxAvailable).toBeNull();
  });
});

// ── Servis üzerinden: karar gerçekten init'te uygulanıyor mu? ───────────────

const AKTOR: CheckoutActor = { userId: 'user-1', ipAddress: '203.0.113.10' };

const GIRDI: CheckoutInitInput = {
  shipping: {
    address: {
      title: 'Ev',
      firstName: 'Test',
      lastName: 'Kullanici',
      phone: '+905321112233',
      city: 'İstanbul',
      district: 'Kadıköy',
      line1: 'Test Mahallesi Deneme Sokak No 1',
    },
  },
  email: 'musteri@ornek.test',
  acceptPriceChange: false,
};

/**
 * ⚠️ Diğer bağımlılıklar bilerek boş: üç durumda da `init` sepet görünümünü
 *    okuduktan hemen sonra reddeder, prisma/ödeme/katalog'a HİÇ dokunmaz.
 *    Biri kullanılsaydı test "undefined is not a function" ile düşerdi —
 *    yani bu boşluklar aynı zamanda "erken ret" iddiasının kanıtı.
 */
function servis(view: CartView): CheckoutService {
  const cart = { view: async () => view } as unknown as CartService;
  return new CheckoutService(
    {} as unknown as PrismaService,
    {} as unknown as Logger,
    {} as unknown as PaymentProviderPort,
    cart,
    {} as unknown as OrderService,
    {} as unknown as CatalogReaderPort,
    {} as unknown as AddressReaderPort,
  );
}

async function initHatasi(view: CartView): Promise<AppError> {
  const sonuc: unknown = await servis(view)
    .init(GIRDI, AKTOR)
    .then(() => null)
    .catch((error: unknown) => error);

  expect(sonuc, 'init isteği reddetmeliydi').toBeInstanceOf(AppError);
  return sonuc as AppError;
}

describe('CheckoutService.init — hata kodu sözleşmesi', () => {
  it('boş sepet: CART_EMPTY', async () => {
    expect((await initHatasi(bosSepet())).code).toBe('CART_EMPTY');
  });

  it('tüm kalemler alınamaz: INSUFFICIENT_STOCK ve düşen kalem yanıtta', async () => {
    const hata = await initHatasi(hepsiAlinamaz());

    expect(hata.code).toBe('INSUFFICIENT_STOCK');
    expect(hata.userMessage).toBe(
      'Yeterli stok kalmadı. Bu üründen en fazla 0 adet alabilirsiniz.',
    );
    expect(detay(hata).items[0]?.variantId).toBe(VARYANT_A);
  });

  it('kalemlerin bir kısmı alınamaz: sessizce atlanmaz, uyarı döner', async () => {
    const hata = await initHatasi(kismenAlinamaz());

    expect(hata.code).toBe('INSUFFICIENT_STOCK');
    expect(detay(hata).hasPurchasableItems).toBe(true);
    expect(detay(hata).items[0]?.variantId).toBe(VARYANT_A);
  });
});
