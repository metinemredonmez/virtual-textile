import { Inject, Injectable } from '@nestjs/common';
import { appError } from '@vt/contracts';
import { isPrismaKnownError, PRISMA_ERROR, type Prisma, type SellerStatus } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { encryptField, maskIban, maskTaxNumber } from './seller-crypto.js';
import type { SellerApplyInput, UpdateStoreInput } from './seller.schema.js';

type Tx = Prisma.TransactionClient;

export interface SellerProfile {
  id: string;
  legalName: string;
  displayName: string;
  status: SellerStatus;
  statusReason: string | null;
  /** ⚠️ Maskeli. Düz IBAN yalnızca payout akışında çözülür. */
  ibanMasked: string;
  taxNumberMasked: string;
  taxOffice: string;
  contactEmail: string;
  contactPhone: string;
  qualityScore: number;
  vacationMode: boolean;
  submerchantConnected: boolean;
  approvedAt: Date | null;
  createdAt: Date;
  store: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    logoKey: string | null;
    bannerKey: string | null;
  } | null;
  documents: Array<{
    id: string;
    type: string;
    fileName: string;
    approved: boolean | null;
    reviewedAt: Date | null;
  }>;
}

/**
 * SATICI ÇEKİRDEĞİ — başvuru, profil, mağaza ayarları.
 *
 * Sahip olduğu tablolar: Seller, SellerUser, SellerDocument, Store.
 * Diğer satıcı servisleri (ürün, sipariş, finans, analitik) mağazanın
 * işlem yapmaya uygun olduğunu BU servise sorar; kural tek yerde durur.
 */
@Injectable()
export class SellerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── Başvuru ──────────────────────────────────────────────────────────────

  /**
   * SATICI BAŞVURUSU.
   *
   * ⚠️ Bu uç, diğer satıcı uçlarının aksine `SellerScopeGuard` ile korunamaz:
   *    başvuran kullanıcının henüz bir mağazası yoktur, `sellerIds` boştur ve
   *    guard her başvuruyu reddederdi — hiç kimse satıcı olamazdı. Bunun yerine
   *    kapsam, oturumdaki kullanıcı kimliğinden TÜRETİLİR: başvuru her zaman
   *    isteği yapanın adına açılır, gövdeden kullanıcı kimliği KABUL EDİLMEZ.
   *
   * Başvuru tek transaction'da Seller + SellerUser(owner) + Store yazar.
   * Ayrı ayrı yazılsaydı araya düşen bir hata, sahibi olmayan bir mağaza
   * bırakırdı — o mağazaya bir daha kimse erişemezdi.
   */
  async apply(userId: string, input: SellerApplyInput): Promise<SellerProfile> {
    // Aynı kullanıcının açık başvurusu/mağazası var mı?
    const existing = await this.prisma.sellerUser.findFirst({
      where: { userId, seller: { status: { in: ['PENDING', 'APPROVED', 'SUSPENDED'] } } },
      select: { seller: { select: { id: true, status: true } } },
    });

    if (existing) {
      throw appError('SELLER_APPLICATION_EXISTS', {
        internalMessage: `Kullanıcı ${userId} zaten ${existing.seller.status} mağaza ${existing.seller.id} üyesi`,
      });
    }

    const sellerId = await this.prisma
      .$transaction(async (tx) => {
        const seller = await tx.seller.create({
          data: {
            legalName: input.legalName,
            displayName: input.displayName,
            // ⚠️ Vergi no ve IBAN düz metin YAZILMAZ. Şifreleme yazma anında,
            //    tek noktada yapılır; "sonra şifreleriz" diye bırakılan alan
            //    hiçbir zaman şifrelenmez.
            taxNumberEnc: encryptField(input.taxNumber),
            taxOffice: input.taxOffice,
            ibanEnc: encryptField(input.iban),
            contactEmail: input.contactEmail,
            contactPhone: input.contactPhone,
            status: 'PENDING',
            members: { create: { userId, storeRole: 'owner' } },
            store: {
              create: {
                slug: input.storeSlug,
                name: input.displayName,
                ...(input.storeDescription ? { description: input.storeDescription } : {}),
              },
            },
          },
          select: { id: true },
        });

        // Yan etki (admin bildirimi, doğrulama e-postası) AYNI transaction'da
        // outbox'a yazılır. Kuyruğa doğrudan yazılsaydı transaction geri
        // alındığında olmamış bir başvuru için bildirim gitmiş olurdu.
        await tx.outboxEvent.create({
          data: {
            aggregate: 'seller',
            aggregateId: seller.id,
            type: 'seller.applied',
            payload: {
              sellerId: seller.id,
              userId,
              displayName: input.displayName,
              storeSlug: input.storeSlug,
              // ⚠️ IBAN ve vergi no payload'a KONMAZ: outbox tablosu ve kuyruk
              //    şifreleme sınırının dışındadır.
            },
          },
        });

        return seller.id;
      })
      .catch((error: unknown) => {
        if (isPrismaKnownError(error) && error.code === PRISMA_ERROR.UNIQUE_VIOLATION) {
          // Tek çakışabilecek alan mağaza adresi (Store.slug @unique).
          throw appError('DUPLICATE_RESOURCE', {
            cause: error,
            internalMessage: `Mağaza adresi çakıştı: ${input.storeSlug}`,
            details: {
              fields: [
                {
                  path: 'storeSlug',
                  message: 'Bu mağaza adresi kullanılıyor, başka bir adres deneyin.',
                },
              ],
            },
          });
        }
        throw error;
      });

    this.logger.info({ sellerId, userId }, 'Satıcı başvurusu alındı');
    return this.profile(sellerId);
  }

  // ── Profil ───────────────────────────────────────────────────────────────

  /**
   * Mağaza profili.
   *
   * ⚠️ Durum kontrolü YOK ve olmamalı: PENDING veya SUSPENDED bir satıcı da
   *    kendi durumunu ve ret gerekçesini görebilmelidir. Aksi hâlde satıcı
   *    "neden giremiyorum" sorusuna yanıt bulamaz ve desteğe düşer.
   */
  async profile(sellerId: string): Promise<SellerProfile> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        legalName: true,
        displayName: true,
        status: true,
        statusReason: true,
        ibanEnc: true,
        taxNumberEnc: true,
        taxOffice: true,
        contactEmail: true,
        contactPhone: true,
        qualityScore: true,
        vacationMode: true,
        submerchantKey: true,
        approvedAt: true,
        createdAt: true,
        store: {
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            logoKey: true,
            bannerKey: true,
          },
        },
        documents: {
          select: { id: true, type: true, fileName: true, approved: true, reviewedAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!seller) throw appError('SELLER_NOT_FOUND');

    return {
      id: seller.id,
      legalName: seller.legalName,
      displayName: seller.displayName,
      status: seller.status,
      statusReason: seller.statusReason,
      // ⚠️ Şifreli alanlar ÇÖZÜLMEDEN maskelenir. Maskeleme için çözmek
      //    gerekmez: son 4 hane bile gösterilmiyor, sabit bir yer tutucu
      //    yeterli olurdu — ama satıcının hangi hesabı verdiğini hatırlaması
      //    gerekiyor, bu yüzden çözme YALNIZCA payout'ta yapılır ve burada
      //    ekrana "kayıtlı" bilgisi düşer.
      ibanMasked: maskStoredSecret(seller.ibanEnc),
      taxNumberMasked: maskStoredSecret(seller.taxNumberEnc),
      taxOffice: seller.taxOffice,
      contactEmail: seller.contactEmail,
      contactPhone: seller.contactPhone,
      qualityScore: seller.qualityScore,
      vacationMode: seller.vacationMode,
      // Anahtarın kendisi DIŞARI VERİLMEZ, yalnızca bağlı olup olmadığı.
      submerchantConnected: seller.submerchantKey !== null,
      approvedAt: seller.approvedAt,
      createdAt: seller.createdAt,
      store: seller.store,
      documents: seller.documents,
    };
  }

  // ── Mağaza ayarları ──────────────────────────────────────────────────────

  async updateStore(sellerId: string, input: UpdateStoreInput): Promise<SellerProfile> {
    await this.requireActive(sellerId);

    const { vacationMode, ...storeFields } = input;

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(storeFields).length > 0) {
        await tx.store.update({
          where: { sellerId },
          data: {
            ...(storeFields.name !== undefined ? { name: storeFields.name } : {}),
            ...(storeFields.description !== undefined
              ? { description: storeFields.description }
              : {}),
            ...(storeFields.logoKey !== undefined ? { logoKey: storeFields.logoKey } : {}),
            ...(storeFields.bannerKey !== undefined ? { bannerKey: storeFields.bannerKey } : {}),
          },
        });
      }

      if (vacationMode !== undefined) {
        await tx.seller.update({ where: { id: sellerId }, data: { vacationMode } });
        // Tatil modu vitrini etkiler: ürünler siparişe kapanır. Arama indeksi
        // ve önbellek bu olayı dinler.
        await tx.outboxEvent.create({
          data: {
            aggregate: 'seller',
            aggregateId: sellerId,
            type: vacationMode ? 'seller.vacation_on' : 'seller.vacation_off',
            payload: { sellerId, vacationMode },
          },
        });
      }
    });

    return this.profile(sellerId);
  }

  // ── Ortak kapı ───────────────────────────────────────────────────────────

  /**
   * İŞLEM YAPMAYA UYGUNLUK KAPISI.
   *
   * `SellerScopeGuard` yalnızca "bu kullanıcı bu mağazanın üyesi mi" sorusunu
   * yanıtlar — mağazanın DURUMUNU bilmez. Onaylanmamış veya askıya alınmış bir
   * mağaza, üyesi olduğu için guard'dan geçer; ürün yayımlamasını, sipariş
   * işlemesini ve para çekmesini engelleyen kontrol burasıdır.
   *
   * Yazma yapan her satıcı servisi bunu çağırır.
   */
  async requireActive(sellerId: string): Promise<{ id: string; submerchantKey: string | null }> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, status: true, submerchantKey: true },
    });

    if (!seller) throw appError('SELLER_NOT_FOUND');

    switch (seller.status) {
      case 'APPROVED':
        return { id: seller.id, submerchantKey: seller.submerchantKey };
      case 'SUSPENDED':
        throw appError('SELLER_SUSPENDED');
      case 'PENDING':
      case 'REJECTED':
      default:
        throw appError('SELLER_NOT_APPROVED', {
          internalMessage: `Mağaza ${sellerId} durumu: ${seller.status}`,
        });
    }
  }

  /** Payout akışının ihtiyaç duyduğu şifreli IBAN — ÇÖZÜLMEDEN taşınır. */
  async encryptedIban(tx: Tx, sellerId: string): Promise<string> {
    const seller = await tx.seller.findUnique({
      where: { id: sellerId },
      select: { ibanEnc: true },
    });
    if (!seller) throw appError('SELLER_NOT_FOUND');
    return seller.ibanEnc;
  }
}

/**
 * Şifreli alan için ekran maskesi.
 *
 * ⚠️ Şifreli metin ÇÖZÜLMEZ. Çözüp son 4 haneyi göstermek cazip ama o zaman
 *    her profil isteği bir çözme işlemi olurdu ve "payout dışında çözme"
 *    kuralı fiilen ortadan kalkardı. Kayıtlı/kayıtsız bilgisi yeterlidir;
 *    satıcı doğrulamak isterse bilgiyi yeniden girer.
 */
function maskStoredSecret(encrypted: string): string {
  return encrypted.length > 0 ? '••••' : '';
}

// TODO(kod-gerekli): SELLER_STORE_SLUG_TAKEN — mağaza adresi çakışmasında
// DUPLICATE_RESOURCE kullanılıyor. HTTP kodu (409) ve aile doğru, ancak
// kullanıcı mesajı genel ("Bu kayıt zaten mevcut"); alan bazlı `details`
// ile telafi ediliyor. Adrese özel bir kod daha isabetli olur.

// TODO(kod-gerekli): FIELD_DECRYPT_FAILED — şifreli alan çözülemediğinde
// (anahtar rotasyonu, bozuk veri) INTERNAL_ERROR kullanılıyor (bkz.
// seller-crypto.ts). Aile ve HTTP kodu doğru; ayrı bir kod, alarm
// kuralında bu durumu diğer 500'lerden ayırmayı kolaylaştırır.

// Yardımcı, sınıfın dışında tanımlı olduğu için burada yeniden dışa açılmıyor.
export { maskIban, maskTaxNumber };
