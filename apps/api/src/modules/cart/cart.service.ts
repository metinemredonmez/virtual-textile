import { Inject, Injectable } from '@nestjs/common';
import { appError, toAppError } from '@vt/contracts';
import { CART } from '@vt/config';
import { Prisma, serializeBigInts } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import {
  calculateCartTotals,
  type CartLineInput,
  type CartTotals,
  type CouponInput,
} from './cart-totals.js';
import {
  COUPON_PORT,
  VARIANT_PORT,
  type CouponPort,
  type CouponSnapshot,
  type VariantPort,
  type VariantSnapshot,
} from './cart.ports.js';
import type { AddItemInput, UpdateItemInput } from './cart.schema.js';

/**
 * SEPET
 *
 * Sepet hem üye hem misafir için çalışır. Misafir sepeti tarayıcıda üretilen
 * `X-Session-Id` ile bulunur.
 *
 * ⚠️ GÜVENLİK: Kullanıcı giriş yapmışsa sepet DAİMA userId ile bulunur ve
 * `X-Session-Id` başlığı yok sayılır (tek istisna: /cart/merge). Aksi hâlde
 * bir üye, başkasının oturum kimliğini başlığa koyarak o kişinin sepetini
 * okur ve değiştirir.
 */

export type CartOwner = { kind: 'user'; userId: string } | { kind: 'guest'; sessionId: string };

/** Kalemin neden satın alınamadığı. `null` = sorun yok. */
export type ItemIssue =
  'UNAVAILABLE' | 'SELLER_ON_VACATION' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK';

/** Bu sorunlar kalemi TOPLAMDAN çıkarır; kullanıcı görür ama ödemez. */
const BLOCKING_ISSUES: ReadonlySet<ItemIssue> = new Set<ItemIssue>([
  'UNAVAILABLE',
  'SELLER_ON_VACATION',
  'OUT_OF_STOCK',
]);

export interface CartItemView {
  id: string;
  variantId: string;
  outfitId: string | null;
  quantity: number;
  productTitle: string;
  productSlug: string;
  color: string;
  size: string;
  imageKey: string | null;
  unitPriceMinor: bigint;
  lineTotalMinor: bigint;
  currentUnitPriceMinor: bigint;
  /** true ise checkout CART_PRICE_CHANGED ile reddeder. */
  priceChanged: boolean;
  priceDiffMinor: bigint;
  issue: ItemIssue | null;
  /** Stok yetersizse alınabilecek azami adet; aksi hâlde null. */
  maxAvailable: number | null;
}

export interface CartPackageView {
  sellerId: string;
  sellerName: string;
  storeSlug: string;
  items: CartItemView[];
  subtotalMinor: bigint;
  discountMinor: bigint;
  totalMinor: bigint;
}

export interface CartView {
  id: string | null;
  /** Her satıcı ayrı paket, ayrı kargo. */
  packages: CartPackageView[];
  /** Satın alınamayan kalemler — toplamlara dahil DEĞİL. */
  unavailableItems: CartItemView[];
  coupon: {
    code: string;
    sellerId: string | null;
    discountType: string;
    /** Uygulanamıyorsa nedeni; uygulanıyorsa null. */
    rejection: 'NOT_APPLICABLE' | 'MIN_AMOUNT' | 'EXPIRED' | null;
  } | null;
  subtotalMinor: bigint;
  discountMinor: bigint;
  totalMinor: bigint;
  itemCount: number;
  distinctItemCount: number;
  hasPriceChange: boolean;
  freeShipping: boolean;
  expiresAt: Date | null;
}

/** Yazılmaya hazır, tüm kuralları geçmiş kalem. */
export interface PreparedItem {
  variantId: string;
  /** Nihai adet — mevcut adet + istenen, tavanlar uygulanmış hâli. */
  quantity: number;
  addedPriceMinor: bigint;
  isNew: boolean;
}

export interface SkippedItem {
  variantId: string;
  reason: ItemIssue | 'CART_FULL';
}

export interface PrepareResult {
  prepared: PreparedItem[];
  skipped: SkippedItem[];
}

type Tx = Prisma.TransactionClient;

interface CartRow {
  id: string;
  userId: string | null;
  sessionId: string | null;
  couponId: string | null;
  expiresAt: Date;
}

interface ItemRow {
  id: string;
  variantId: string;
  outfitId: string | null;
  quantity: number;
  addedPriceMinor: bigint;
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(VARIANT_PORT) private readonly variants: VariantPort,
    @Inject(COUPON_PORT) private readonly coupons: CouponPort,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── Okuma ────────────────────────────────────────────────────────────────

  /**
   * Sepeti getirir. Sepet YOKSA OLUŞTURMAZ — okuma isteği veritabanına satır
   * yazmamalı; aksi hâlde her bot ziyareti bir sepet satırı bırakır.
   */
  async view(owner: CartOwner): Promise<CartView> {
    const cart = await this.prisma.cart.findUnique({ where: this.ownerWhere(owner) });
    if (!cart) return this.emptyView();

    const fresh = await this.purgeIfExpired(cart, owner);
    return this.buildView(fresh);
  }

  // ── Kalem ekleme ─────────────────────────────────────────────────────────

  async addItem(owner: CartOwner, input: AddItemInput): Promise<CartView> {
    const cart = await this.ensureCart(owner);

    if (input.outfitId) await this.assertOutfitBelongsTo(cart, owner, input.outfitId);

    const { prepared } = await this.prepareItems(
      cart.id,
      [{ variantId: input.variantId, quantity: input.quantity }],
      { skipUnavailable: false },
    );

    await this.prisma.$transaction(async (tx) => {
      await this.writeItems(tx, cart, prepared, input.outfitId ?? null);
    });

    return this.buildView(cart);
  }

  /**
   * Kalemleri doğrular ve yazılmaya hazır hâle getirir. HİÇBİR ŞEY YAZMAZ.
   *
   * Doğrulama ile yazmanın ayrılma nedeni: kombin oluşturma akışı kombin
   * kaydı ile kalemleri TEK transaction'da yazmak zorunda — yarıda kalırsa
   * boş bir kombin ortada kalır.
   *
   * @param skipUnavailable true ise satın alınamayan kalem hata fırlatmaz,
   *        atlanır ve `skipped` içinde bildirilir (kombini sepete atma akışı).
   */
  async prepareItems(
    cartId: string,
    rawRequests: ReadonlyArray<{ variantId: string; quantity: number }>,
    options: { skipUnavailable: boolean },
  ): Promise<PrepareResult> {
    // Aynı varyant istek içinde iki kez geçebilir (kombin kalemleri). Önce
    // toplanır: aksi hâlde ikinci kayıt birincisinin adedini ezer ve kullanıcı
    // istediğinden azını görür.
    const merged = new Map<string, number>();
    for (const request of rawRequests) {
      merged.set(request.variantId, (merged.get(request.variantId) ?? 0) + request.quantity);
    }
    const requests = [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));

    const snapshots = await this.variants.findByIds(requests.map((r) => r.variantId));

    const existing = await this.prisma.cartItem.findMany({
      where: { cartId, variantId: { in: requests.map((r) => r.variantId) } },
      select: { variantId: true, quantity: true, addedPriceMinor: true },
    });
    const existingByVariant = new Map(existing.map((item) => [item.variantId, item]));

    const distinctCount = await this.prisma.cartItem.count({ where: { cartId } });
    let newSlots = CART.maxDistinctItems - distinctCount;

    const prepared: PreparedItem[] = [];
    const skipped: SkippedItem[] = [];

    for (const request of requests) {
      const snapshot = snapshots.get(request.variantId);
      const current = existingByVariant.get(request.variantId);
      const nextQuantity = (current?.quantity ?? 0) + request.quantity;

      if (!snapshot) {
        if (!options.skipUnavailable) throw appError('VARIANT_NOT_FOUND');
        skipped.push({ variantId: request.variantId, reason: 'UNAVAILABLE' });
        continue;
      }

      const issue = this.issueFor(snapshot, nextQuantity);
      if (issue !== null) {
        if (options.skipUnavailable) {
          skipped.push({ variantId: request.variantId, reason: issue });
          continue;
        }
        this.throwForIssue(issue, snapshot);
      }

      // Adet tavanı stok kontrolünden ÖNCE: politika limiti kesindir, stok
      // ise anlıktır. "10 adetten fazla alamazsınız" mesajı, stok 50 iken
      // "stok yetersiz" demekten doğru.
      if (nextQuantity > CART.maxQuantityPerVariant) {
        if (options.skipUnavailable) {
          skipped.push({ variantId: request.variantId, reason: 'INSUFFICIENT_STOCK' });
          continue;
        }
        throw appError('MAX_QUANTITY_EXCEEDED', { params: { max: CART.maxQuantityPerVariant } });
      }

      if (!current) {
        if (newSlots <= 0) {
          if (options.skipUnavailable) {
            skipped.push({ variantId: request.variantId, reason: 'CART_FULL' });
            continue;
          }
          // Adet tavanı değil, FARKLI ürün sayısı tavanı: kullanıcının adedi
          // düşürerek değil, bir ürünü çıkararak çözmesi gerekir.
          throw appError('CART_TOO_MANY_ITEMS', {
            params: { max: CART.maxDistinctItems },
            internalMessage: `Sepette en fazla ${CART.maxDistinctItems} farklı ürün olabilir`,
          });
        }
        newSlots -= 1;
      }

      prepared.push({
        variantId: request.variantId,
        quantity: nextQuantity,
        // ⚠️ Mevcut kalemin fiyatı KORUNUR. Kullanıcı 3 gün önce 100 ₺'ye
        // eklediyse ve fiyat 120 ₺ olduysa, "1 adet daha ekle" işlemi eski
        // fiyatı 120 ₺'ye yükseltmemeli — kullanıcı fiyat artışını ancak
        // açık onayla kabul eder.
        addedPriceMinor: current?.addedPriceMinor ?? snapshot.priceMinor,
        isNew: !current,
      });
    }

    return { prepared, skipped };
  }

  /** Hazırlanmış kalemleri yazar ve outbox olayını AYNI transaction'a koyar. */
  async writeItems(
    tx: Tx,
    cart: CartRow,
    prepared: readonly PreparedItem[],
    outfitId: string | null,
  ): Promise<void> {
    for (const item of prepared) {
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId: item.variantId } },
        create: {
          cartId: cart.id,
          variantId: item.variantId,
          quantity: item.quantity,
          addedPriceMinor: item.addedPriceMinor,
          outfitId,
        },
        update: {
          quantity: item.quantity,
          // Kombine bağlama yalnızca EKLENİR; mevcut bağ koparılmaz.
          ...(outfitId ? { outfitId } : {}),
        },
      });
    }

    if (prepared.length > 0) {
      await this.writeOutbox(tx, cart.id, 'cart.item_added', {
        cartId: cart.id,
        userId: cart.userId,
        outfitId,
        variantIds: prepared.map((p) => p.variantId),
      });
    }

    await this.touch(tx, cart);
  }

  // ── Kalem güncelleme / silme ─────────────────────────────────────────────

  async updateItem(owner: CartOwner, itemId: string, input: UpdateItemInput): Promise<CartView> {
    const cart = await this.requireCart(owner);

    // ⚠️ Kalem kimliği DAİMA sepet kimliğiyle birlikte aranır. Yalnızca id ile
    // aranırsa, kimliği tahmin eden biri başkasının sepetini değiştirir.
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      select: { id: true, variantId: true },
    });
    if (!item) throw appError('NOT_FOUND');

    const snapshot = (await this.variants.findByIds([item.variantId])).get(item.variantId);
    if (!snapshot) throw appError('VARIANT_NOT_FOUND');

    const issue = this.issueFor(snapshot, input.quantity);
    if (issue !== null) this.throwForIssue(issue, snapshot);
    if (input.quantity > CART.maxQuantityPerVariant) {
      throw appError('MAX_QUANTITY_EXCEEDED', { params: { max: CART.maxQuantityPerVariant } });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.cartItem.update({
        where: { id: item.id },
        data: {
          quantity: input.quantity,
          // Fiyat ancak kullanıcı açıkça kabul ederse güncellenir.
          ...(input.acceptPriceChange ? { addedPriceMinor: snapshot.priceMinor } : {}),
        },
      });
      await this.touch(tx, cart);
    });

    return this.buildView(cart);
  }

  async removeItem(owner: CartOwner, itemId: string): Promise<CartView> {
    const cart = await this.requireCart(owner);

    const removed = await this.prisma.cartItem.deleteMany({
      where: { id: itemId, cartId: cart.id },
    });
    if (removed.count === 0) throw appError('NOT_FOUND');

    return this.buildView(cart);
  }

  // ── Kupon ────────────────────────────────────────────────────────────────

  async applyCoupon(owner: CartOwner, code: string): Promise<CartView> {
    const cart = await this.ensureCart(owner);
    const coupon = await this.coupons.findByCode(code);

    if (!coupon || !coupon.isActive) throw appError('COUPON_INVALID');

    const now = new Date();
    if (now < coupon.validFrom || now > coupon.validTo) throw appError('COUPON_EXPIRED');

    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      // Kupon tarih olarak HÂLÂ geçerli, kontenjanı bitti. "Süresi doldu"
      // demek kullanıcıyı tarihe bakmaya yönlendirir ve yanlış bilgi olur.
      throw appError('COUPON_USAGE_LIMIT_REACHED', {
        internalMessage: `Kupon ${coupon.code} toplam kullanım limitine ulaştı`,
      });
    }

    if (owner.kind === 'user') {
      const used = await this.coupons.countUserRedemptions(coupon.id, owner.userId);
      if (used >= coupon.usageLimitPerUser) throw appError('COUPON_ALREADY_USED');
    }
    // Misafirde kişi başı limit BURADA doğrulanamaz — kimlik yok. Gerçek
    // kontrol, kuponun tüketildiği yerde (checkout/redemption) yapılır.

    // Kuponu sepete yazmadan önce sepet içeriğiyle uyumunu dene.
    const items = await this.loadItems(cart.id);
    const totals = await this.computeTotals(items, this.toCouponInput(coupon));

    if (totals.couponRejection === 'NOT_APPLICABLE') throw appError('COUPON_NOT_APPLICABLE');
    if (totals.couponRejection === 'MIN_AMOUNT') {
      // ⚠️ `Money.formatMoney(...)` BURADA ÇAĞRILMAZ. Tutar KURUŞ dizgisi olarak
      //    gider ve biçimi gösterildiği dilde kurulur (katalogda
      //    `minAmount: 'para'`). Hazır Türkçe dizgi gönderilseydi İngilizce
      //    cümlenin ortasında Türkçe ayraçlı bir tutar kalırdı; tip kontrolü de
      //    testler de bunu göremez.
      throw appError('COUPON_MIN_AMOUNT', {
        params: { minAmount: coupon.minCartMinor.toString() },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.cart.update({ where: { id: cart.id }, data: { couponId: coupon.id } });
      await this.writeOutbox(tx, cart.id, 'cart.coupon_applied', {
        cartId: cart.id,
        userId: cart.userId,
        couponId: coupon.id,
        code: coupon.code,
        discountMinor: totals.discount.amountMinor,
      });
    });

    return this.buildView({ ...cart, couponId: coupon.id });
  }

  async removeCoupon(owner: CartOwner): Promise<CartView> {
    const cart = await this.requireCart(owner);
    await this.prisma.cart.update({ where: { id: cart.id }, data: { couponId: null } });
    return this.buildView({ ...cart, couponId: null });
  }

  // ── Misafir → üye birleştirme ────────────────────────────────────────────

  /**
   * Misafir sepetini üye sepetine taşır.
   *
   * ⚠️ Bu işlem TEKRARLANABİLİR DEĞİL: adetler toplandığı için iki kez
   * çalışırsa kullanıcı iki katını görür. Denetleyicide `@Idempotent()` ile
   * korunur, ayrıca misafir sepeti sonunda silindiğinden ikinci çağrı boşa düşer.
   */
  async merge(userId: string, sessionId: string): Promise<CartView & { skipped: SkippedItem[] }> {
    const guest = await this.prisma.cart.findUnique({
      where: { sessionId },
      select: {
        id: true,
        couponId: true,
        items: {
          select: {
            variantId: true,
            quantity: true,
            addedPriceMinor: true,
            outfitId: true,
          },
        },
      },
    });

    const target = await this.ensureCart({ kind: 'user', userId });

    if (!guest || guest.items.length === 0) {
      if (guest) await this.prisma.cart.delete({ where: { id: guest.id } }).catch(() => undefined);
      return { ...(await this.buildView(target)), skipped: [] };
    }

    const snapshots = await this.variants.findByIds(guest.items.map((i) => i.variantId));
    const targetItems = await this.loadItems(target.id);
    const targetByVariant = new Map(targetItems.map((i) => [i.variantId, i]));
    const distinctCount = targetItems.length;
    let newSlots = CART.maxDistinctItems - distinctCount;

    const skipped: SkippedItem[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const guestItem of guest.items) {
        const snapshot = snapshots.get(guestItem.variantId);
        if (!snapshot || !snapshot.isPurchasable || !snapshot.sellerApproved) {
          // Misafir sepetinde günlerce bekleyen ürün yayından kalkmış olabilir;
          // birleştirmeyi tümden reddetmek yerine o kalemi atlayıp bildiriyoruz.
          skipped.push({ variantId: guestItem.variantId, reason: 'UNAVAILABLE' });
          continue;
        }

        const current = targetByVariant.get(guestItem.variantId);

        if (current) {
          // Adetler toplanır ama tavanı aşamaz.
          const merged = Math.min(
            current.quantity + guestItem.quantity,
            CART.maxQuantityPerVariant,
          );
          await tx.cartItem.update({
            where: { id: current.id },
            data: {
              quantity: merged,
              // İki sepette farklı fiyat varsa DÜŞÜK olan geçerli olur:
              // kullanıcı sepetinde gördüğü fiyattan daha yükseğini ödememeli.
              addedPriceMinor:
                guestItem.addedPriceMinor < current.addedPriceMinor
                  ? guestItem.addedPriceMinor
                  : current.addedPriceMinor,
              ...(current.outfitId === null && guestItem.outfitId
                ? { outfitId: guestItem.outfitId }
                : {}),
            },
          });
          continue;
        }

        if (newSlots <= 0) {
          skipped.push({ variantId: guestItem.variantId, reason: 'CART_FULL' });
          continue;
        }
        newSlots -= 1;

        await tx.cartItem.create({
          data: {
            cartId: target.id,
            variantId: guestItem.variantId,
            quantity: Math.min(guestItem.quantity, CART.maxQuantityPerVariant),
            addedPriceMinor: guestItem.addedPriceMinor,
            outfitId: guestItem.outfitId,
          },
        });
      }

      // ⚠️ Kombinler misafir sepeti SİLİNMEDEN ÖNCE taşınmalı: Outfit.cartId
      // cascade'lidir, sepet önce silinirse kombinler de silinir ve yukarıda
      // kurduğumuz outfitId bağları kopar.
      await tx.outfit.updateMany({
        where: { cartId: guest.id },
        data: { cartId: target.id, userId },
      });

      // Üyenin kendi kuponu varsa ona dokunulmaz; yoksa misafirinki devralınır.
      if (!target.couponId && guest.couponId) {
        await tx.cart.update({ where: { id: target.id }, data: { couponId: guest.couponId } });
      }

      await tx.cart.delete({ where: { id: guest.id } });

      await this.writeOutbox(tx, target.id, 'cart.merged', {
        cartId: target.id,
        userId,
        movedVariantIds: guest.items
          .map((i) => i.variantId)
          .filter((id) => !skipped.some((s) => s.variantId === id)),
        skipped,
      });

      await this.touch(tx, target);
    });

    this.logger.info(
      { cartId: target.id, moved: guest.items.length - skipped.length, skipped: skipped.length },
      'Misafir sepeti üye sepetine taşındı',
    );

    const view = await this.buildView({
      ...target,
      couponId: target.couponId ?? guest.couponId,
    });
    return { ...view, skipped };
  }

  // ── Sepet yaşam döngüsü ──────────────────────────────────────────────────

  /** Sepet yoksa oluşturur. Yazma uçlarının giriş kapısı. */
  async ensureCart(owner: CartOwner): Promise<CartRow> {
    const where = this.ownerWhere(owner);
    const existing = await this.prisma.cart.findUnique({ where });
    if (existing) return this.purgeIfExpired(existing, owner);

    try {
      // ⚠️ Transaction DIŞINDA oluşturuluyor. Yarış durumunda unique kısıt
      // ihlali kaçınılmaz; Postgres'te transaction içinde patlayan sorgu
      // transaction'ı iptal eder ve "yakalayıp devam et" mümkün olmaz.
      return await this.prisma.cart.create({
        data: {
          userId: owner.kind === 'user' ? owner.userId : null,
          sessionId: owner.kind === 'guest' ? owner.sessionId : null,
          expiresAt: this.expiryFor(owner),
        },
      });
    } catch (error) {
      // Aynı anda iki istek sepet oluşturmayı denedi; kaybeden kazananınkini
      // kullanır. Kullanıcı için tek bir sepet vardır, çift kayıt oluşmaz.
      const raced = await this.prisma.cart.findUnique({ where });
      if (raced) return raced;
      throw toAppError(error);
    }
  }

  /** Sepet yoksa hata verir — mevcut bir kaleme/kupona işlem yapan uçlar için. */
  private async requireCart(owner: CartOwner): Promise<CartRow> {
    const cart = await this.prisma.cart.findUnique({ where: this.ownerWhere(owner) });
    if (!cart) throw appError('CART_NOT_FOUND');
    return this.purgeIfExpired(cart, owner);
  }

  /**
   * Süresi dolmuş sepet SİLİNMEZ, boşaltılır.
   *
   * Neden hata değil: kullanıcıya "sepetiniz süresi doldu" diye 410 dönüp
   * ekranı kilitlemek yerine boş sepet göstermek doğru davranış. Neden
   * boşaltılıyor: aylar önceki fiyatlarla kalemler canlanmamalı; fiyat farkı
   * uyarısı zaten bu kadar eski veride anlamını yitirir.
   */
  private async purgeIfExpired(cart: CartRow, owner: CartOwner): Promise<CartRow> {
    if (cart.expiresAt > new Date()) return cart;

    return this.prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return tx.cart.update({
        where: { id: cart.id },
        data: { couponId: null, expiresAt: this.expiryFor(owner) },
      });
    });
  }

  private expiryFor(owner: CartOwner): Date {
    const days = owner.kind === 'user' ? CART.userTtlDays : CART.guestTtlDays;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  /** Her yazma sepetin ömrünü uzatır — aktif sepet süresi dolmamalı. */
  private async touch(tx: Tx, cart: CartRow): Promise<void> {
    const owner: CartOwner = cart.userId
      ? { kind: 'user', userId: cart.userId }
      : { kind: 'guest', sessionId: cart.sessionId ?? '' };
    await tx.cart.update({ where: { id: cart.id }, data: { expiresAt: this.expiryFor(owner) } });
  }

  private ownerWhere(owner: CartOwner): { userId: string } | { sessionId: string } {
    return owner.kind === 'user' ? { userId: owner.userId } : { sessionId: owner.sessionId };
  }

  // ── Kombin yardımcıları (OutfitService kullanır) ─────────────────────────

  async assertOutfitBelongsTo(cart: CartRow, owner: CartOwner, outfitId: string): Promise<void> {
    const outfit = await this.prisma.outfit.findFirst({
      where: {
        id: outfitId,
        // Kombin ya bu sepete ya da bu kullanıcıya ait olmalı; başkasının
        // kombinine kalem bağlanamaz.
        OR: [{ cartId: cart.id }, ...(owner.kind === 'user' ? [{ userId: owner.userId }] : [])],
      },
      select: { id: true },
    });
    if (!outfit) throw appError('NOT_FOUND');
  }

  async loadItems(cartId: string): Promise<Array<ItemRow & { id: string }>> {
    return this.prisma.cartItem.findMany({
      where: { cartId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        variantId: true,
        outfitId: true,
        quantity: true,
        addedPriceMinor: true,
      },
    });
  }

  // ── Görünüm kurulumu ─────────────────────────────────────────────────────

  async buildView(row: CartRow): Promise<CartView> {
    // Sepet satırı yeniden okunur: çağıran taraf yazma öncesi okunmuş bir satır
    // tutuyor olabilir (kupon, expiresAt). Görünüm daima yazılmış hâli
    // göstermeli, yoksa kullanıcı işleminin sonucunu ekranda göremez.
    const cart = (await this.prisma.cart.findUnique({ where: { id: row.id } })) ?? row;

    const items = await this.loadItems(cart.id);
    const snapshots = await this.variants.findByIds(items.map((i) => i.variantId));

    let coupon: CouponSnapshot | null = null;
    let couponExpired = false;
    if (cart.couponId) {
      coupon = await this.coupons.findById(cart.couponId);
      const now = new Date();
      if (coupon && (!coupon.isActive || now < coupon.validFrom || now > coupon.validTo)) {
        // Sepette dururken geçersizleşen kupon sepeti bozmaz, sadece düşer.
        couponExpired = true;
        coupon = null;
      }
    }

    const issues = new Map<string, ItemIssue | null>();
    const lines: CartLineInput[] = [];

    for (const item of items) {
      const snapshot = snapshots.get(item.variantId);
      const issue = snapshot ? this.issueFor(snapshot, item.quantity) : 'UNAVAILABLE';
      issues.set(item.id, issue);

      if (snapshot && (issue === null || !BLOCKING_ISSUES.has(issue))) {
        lines.push({
          id: item.id,
          variantId: item.variantId,
          sellerId: snapshot.sellerId,
          quantity: item.quantity,
          addedPriceMinor: item.addedPriceMinor,
          currentPriceMinor: snapshot.priceMinor,
        });
      }
    }

    const totals = calculateCartTotals(lines, coupon ? this.toCouponInput(coupon) : null);

    const itemsById = new Map(items.map((i) => [i.id, i]));
    const toItemView = (
      itemId: string,
      computed?: {
        unitPrice: { amountMinor: bigint };
        lineTotal: { amountMinor: bigint };
        currentUnitPrice: { amountMinor: bigint };
        priceChanged: boolean;
        priceDiffMinor: bigint;
      },
    ): CartItemView => {
      const item = itemsById.get(itemId)!;
      const snapshot = snapshots.get(item.variantId);
      const issue = issues.get(itemId) ?? null;
      return {
        id: item.id,
        variantId: item.variantId,
        outfitId: item.outfitId,
        quantity: item.quantity,
        productTitle: snapshot?.productTitle ?? '',
        productSlug: snapshot?.productSlug ?? '',
        color: snapshot?.color ?? '',
        size: snapshot?.size ?? '',
        imageKey: snapshot?.imageKey ?? null,
        unitPriceMinor: computed?.unitPrice.amountMinor ?? item.addedPriceMinor,
        lineTotalMinor:
          computed?.lineTotal.amountMinor ?? item.addedPriceMinor * BigInt(item.quantity),
        currentUnitPriceMinor: computed?.currentUnitPrice.amountMinor ?? snapshot?.priceMinor ?? 0n,
        priceChanged: computed?.priceChanged ?? false,
        priceDiffMinor: computed?.priceDiffMinor ?? 0n,
        issue,
        // Stok yetersizken yalnızca azami alınabilir adet gösterilir; ham stok
        // sayısı hiçbir koşulda istemciye SIZDIRILMAZ (rakip envanter takibi).
        maxAvailable: issue === 'INSUFFICIENT_STOCK' ? (snapshot?.availableQuantity ?? 0) : null,
      };
    };

    const packages: CartPackageView[] = totals.packages.map((pkg) => {
      const first = pkg.lines[0];
      const snapshot = first ? snapshots.get(first.variantId) : undefined;
      return {
        sellerId: pkg.sellerId,
        sellerName: snapshot?.sellerName ?? '',
        storeSlug: snapshot?.storeSlug ?? '',
        items: pkg.lines.map((line) => toItemView(line.id, line)),
        subtotalMinor: pkg.subtotal.amountMinor,
        discountMinor: pkg.discount.amountMinor,
        totalMinor: pkg.total.amountMinor,
      };
    });

    const unavailableItems = items
      .filter((item) => {
        const issue = issues.get(item.id);
        return issue !== null && issue !== undefined && BLOCKING_ISSUES.has(issue);
      })
      .map((item) => toItemView(item.id));

    return {
      id: cart.id,
      packages,
      unavailableItems,
      coupon: coupon
        ? {
            code: coupon.code,
            sellerId: coupon.sellerId,
            discountType: coupon.discountType,
            rejection: totals.couponRejection,
          }
        : couponExpired
          ? { code: '', sellerId: null, discountType: '', rejection: 'EXPIRED' }
          : null,
      subtotalMinor: totals.subtotal.amountMinor,
      discountMinor: totals.discount.amountMinor,
      totalMinor: totals.total.amountMinor,
      itemCount: totals.itemCount,
      distinctItemCount: items.length,
      hasPriceChange: totals.hasPriceChange,
      freeShipping: totals.freeShipping,
      expiresAt: cart.expiresAt,
    };
  }

  private emptyView(): CartView {
    const totals = calculateCartTotals([]);
    return {
      id: null,
      packages: [],
      unavailableItems: [],
      coupon: null,
      subtotalMinor: totals.subtotal.amountMinor,
      discountMinor: totals.discount.amountMinor,
      totalMinor: totals.total.amountMinor,
      itemCount: 0,
      distinctItemCount: 0,
      hasPriceChange: false,
      freeShipping: false,
      expiresAt: null,
    };
  }

  private async computeTotals(
    items: ReadonlyArray<ItemRow>,
    coupon: CouponInput | null,
  ): Promise<CartTotals> {
    const snapshots = await this.variants.findByIds(items.map((i) => i.variantId));
    const lines: CartLineInput[] = [];

    for (const item of items) {
      const snapshot = snapshots.get(item.variantId);
      if (!snapshot) continue;
      const issue = this.issueFor(snapshot, item.quantity);
      if (issue !== null && BLOCKING_ISSUES.has(issue)) continue;
      lines.push({
        id: item.id,
        variantId: item.variantId,
        sellerId: snapshot.sellerId,
        quantity: item.quantity,
        addedPriceMinor: item.addedPriceMinor,
        currentPriceMinor: snapshot.priceMinor,
      });
    }

    return calculateCartTotals(lines, coupon);
  }

  // ── Kurallar ─────────────────────────────────────────────────────────────

  private issueFor(snapshot: VariantSnapshot, quantity: number): ItemIssue | null {
    // Onaysız/askıdaki mağazanın ürünü zaten katalogda görünmez; sepette
    // kalmışsa da satın alınamaz. SELLER_NOT_APPROVED kullanılmıyor: o mesaj
    // satıcıya yazılmış ("Mağazanız henüz onaylanmadı"), alıcıya anlamsız.
    if (!snapshot.isPurchasable || !snapshot.sellerApproved) return 'UNAVAILABLE';
    if (snapshot.sellerOnVacation) return 'SELLER_ON_VACATION';
    if (snapshot.availableQuantity <= 0) return 'OUT_OF_STOCK';
    if (quantity > snapshot.availableQuantity) return 'INSUFFICIENT_STOCK';
    return null;
  }

  private throwForIssue(issue: ItemIssue, snapshot: VariantSnapshot): never {
    switch (issue) {
      case 'SELLER_ON_VACATION':
        throw appError('SELLER_ON_VACATION');
      case 'OUT_OF_STOCK':
      case 'INSUFFICIENT_STOCK':
        // ⚠️ Buradaki stok kontrolü BİLGİLENDİRİCİDİR, rezervasyon değildir.
        // Gerçek rezervasyon checkout'ta optimistic lock ile yapılır; sepette
        // kilit almak, alışverişi bitirmeyen kullanıcılar yüzünden stoğu
        // gereksiz yere dondurur.
        throw appError('INSUFFICIENT_STOCK', {
          params: { available: snapshot.availableQuantity },
        });
      case 'UNAVAILABLE':
      default:
        throw appError('VARIANT_UNAVAILABLE');
    }
  }

  private toCouponInput(coupon: CouponSnapshot): CouponInput {
    return {
      id: coupon.id,
      code: coupon.code,
      sellerId: coupon.sellerId,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      maxDiscountMinor: coupon.maxDiscountMinor,
      minCartMinor: coupon.minCartMinor,
    };
  }

  /**
   * Yan etkiler kuyruğa DOĞRUDAN yazılmaz.
   * Olay, sepet yazımıyla aynı transaction'da outbox'a düşer; worker sonra
   * taşır. Aksi hâlde "sepet güncellendi ama terk edilmiş sepet e-postası
   * yanlış içerikle gitti" durumu oluşur.
   */
  private async writeOutbox(
    tx: Tx,
    cartId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        aggregate: 'cart',
        aggregateId: cartId,
        type,
        // bigint JSON'a serileşmez; kuruş tutarları string olarak taşınır.
        payload: serializeBigInts(payload) as Prisma.InputJsonValue,
      },
    });
  }
}
