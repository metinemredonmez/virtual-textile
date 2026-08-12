import { Injectable } from '@nestjs/common';
import { AppError } from '@vt/contracts';
import { PrismaService } from '../../infra/prisma.service.js';
import type {
  AddressReaderPort,
  CatalogReaderPort,
  CheckoutAddress,
  CheckoutPaymentInput,
  CheckoutPaymentResult,
  CheckoutVariant,
  CheckoutVerifiedWebhook,
  PaymentProviderPort,
} from './checkout.ports.js';

/**
 * ═══════════════════ GEÇİCİ KÖPRÜLER — SİLİNMEK ÜZERE YAZILDI ═══════════════
 *
 * Sepet ve sipariş numarası için köprü YOK: `CartService` ve `OrderService`
 * yayımlanmış servislerdir ve checkout onları doğrudan çağırır (kural 3).
 *
 * Katalog anlık görüntüsü (`CatalogService` henüz varyant snapshot'ı
 * yayımlamıyor) ve adres (kullanıcı modülü henüz yok) için okuma köprüleri
 * burada duruyor. Sepet modülü de aynı gerekçeyle kendi `PrismaVariantAdapter`
 * köprüsünü tutuyor.
 *
 * ⚠️ ENTEGRASYON AJANI İÇİN: ilgili servisler yayımlandığında `index.ts`
 *    içindeki token bağlamalarını onlara çevirin ve bu dosyayı SİLİN.
 *    Checkout servisinde tek satır değişmesi gerekmez.
 *
 * Köprüler yalnızca OKUR; hiçbiri başka modülün verisini değiştirmez.
 */

@Injectable()
export class PrismaCatalogReaderBridge implements CatalogReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async loadVariantsForCheckout(variantIds: string[]): Promise<CheckoutVariant[]> {
    if (variantIds.length === 0) return [];

    const variants = await this.prisma.variant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        isActive: true,
        priceMinor: true,
        color: true,
        size: true,
        sku: true,
        product: {
          select: {
            id: true,
            title: true,
            brandName: true,
            status: true,
            categoryId: true,
            sellerId: true,
            seller: { select: { status: true, vacationMode: true, submerchantKey: true } },
            images: {
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
              take: 1,
              select: { storageKey: true },
            },
          },
        },
      },
    });

    return variants.map((variant) => ({
      variantId: variant.id,
      // Ürün yayından kaldırıldıysa varyant "aktif" olsa bile satılamaz.
      isActive: variant.isActive && variant.product.status === 'PUBLISHED',
      priceMinor: variant.priceMinor,
      productId: variant.product.id,
      productTitle: variant.product.title,
      brandName: variant.product.brandName,
      variantLabel: `${variant.color} / ${variant.size}`,
      sku: variant.sku,
      imageKey: variant.product.images[0]?.storageKey ?? '',
      categoryId: variant.product.categoryId,
      sellerId: variant.product.sellerId,
      sellerApproved: variant.product.seller.status === 'APPROVED',
      sellerVacationMode: variant.product.seller.vacationMode,
      sellerSubmerchantKey: variant.product.seller.submerchantKey,
    }));
  }
}

@Injectable()
export class PrismaAddressReaderBridge implements AddressReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async loadUserAddress(userId: string, addressId: string): Promise<CheckoutAddress | null> {
    // ⚠️ `userId` sorgunun İÇİNDE. "Önce oku, sonra sahibini kontrol et"
    //    yazılırsa bir gün kontrol düşer ve başkasının adresi okunur.
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId, archivedAt: null },
      select: {
        firstName: true,
        lastName: true,
        phone: true,
        city: true,
        district: true,
        neighbourhood: true,
        line1: true,
        postalCode: true,
        companyName: true,
        taxOffice: true,
      },
    });

    if (!address) return null;

    return {
      contactName: `${address.firstName} ${address.lastName}`,
      phone: address.phone,
      city: address.city,
      district: address.district,
      neighbourhood: address.neighbourhood ?? undefined,
      line1: address.line1,
      postalCode: address.postalCode ?? undefined,
      companyName: address.companyName ?? undefined,
      taxOffice: address.taxOffice ?? undefined,
      country: 'Türkiye',
      // ⚠️ `taxNumberEnc` BİLEREK okunmuyor: çözülmüş vergi numarası
      //    siparişe JSON olarak yazılırsa şifreleme anlamını yitirir.
    };
  }
}

/**
 * ÖDEME SAĞLAYICISI YAPILANDIRILMAMIŞ — FAIL-CLOSED YER TUTUCU.
 *
 * ⚠️ Bu GEÇİCİ bir bağımlılık stubu DEĞİLDİR ve silinmemelidir. Gerçek
 *    sağlayıcı (`IyzicoPaymentProvider`) `index.ts` içinde bağlıdır; buraya
 *    yalnızca iyzico ANAHTARLARI yokken düşülür (bkz. isPaymentConfigured).
 *    Yani bu sınıf, anahtarsız bir ortamın sessizce ödeme kabul etmesini
 *    engelleyen kalıcı güvenliktir.
 *
 * ⚠️ Sessizce "başarılı" DÖNMEZ. Yapılandırılmamış bir ödeme sisteminin
 *    kabul ettiği sipariş, ödenmemiş ama ödenmiş sanılan siparişten çok daha
 *    pahalıya patlar. Her çağrı görünür biçimde hata verir.
 */
@Injectable()
export class UnconfiguredPaymentProvider implements PaymentProviderPort {
  readonly name = 'iyzico';

  initiate3ds(_input: CheckoutPaymentInput): Promise<{ providerRef: string; htmlContent: string }> {
    return Promise.reject(this.error('initiate3ds'));
  }

  complete3ds(_input: {
    providerRef: string;
    conversationData?: string;
  }): Promise<CheckoutPaymentResult> {
    return Promise.reject(this.error('complete3ds'));
  }

  inquire(_conversationId: string): Promise<CheckoutPaymentResult | null> {
    return Promise.reject(this.error('inquire'));
  }

  verifyWebhook(
    _rawBody: Buffer,
    _headers: Record<string, string | undefined>,
  ): CheckoutVerifiedWebhook {
    throw this.error('verifyWebhook');
  }

  private error(operation: string): AppError {
    return new AppError('PAYMENT_PROVIDER_DOWN', {
      internalMessage: `Ödeme sağlayıcısı bağlanmamış (${operation}) — PAYMENT_PROVIDER token'ı IyzicoPaymentProvider'a bağlanmalı`,
    });
  }
}
