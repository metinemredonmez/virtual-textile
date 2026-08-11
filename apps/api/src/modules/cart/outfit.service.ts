import { Injectable } from '@nestjs/common';
import { appError } from '@vt/contracts';
import { PrismaService } from '../../infra/prisma.service.js';
import { CartService, type CartOwner, type CartView, type SkippedItem } from './cart.service.js';
import type { CreateOutfitInput } from './cart.schema.js';

/**
 * KOMBİN (Outfit)
 *
 * Kombin, sepet kalemlerini adlandırılmış bir grupta toplar: "İş görüşmesi",
 * "Hafta sonu". Kullanıcı kombini bir bütün olarak sepete atar, hepsini birden
 * sanal denemede görür.
 *
 * ⚠️ Veri modelinde kombinin kalemleri AYRI bir tablo değil, CartItem'ın
 * kendisidir (`CartItem.outfitId`). Bu yüzden "kombini sepete at" işlemi
 * kalemleri sepete YAZAR; kombin sepetten bağımsız bir istek listesi değildir.
 */

export interface OutfitItemView {
  cartItemId: string;
  variantId: string;
  quantity: number;
}

export interface OutfitView {
  id: string;
  name: string;
  tryOnJobId: string | null;
  createdAt: Date;
  items: OutfitItemView[];
}

@Injectable()
export class OutfitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
  ) {}

  async list(owner: CartOwner): Promise<OutfitView[]> {
    // Misafirin kombinleri sepetine, üyenin kombinleri hesabına bağlıdır:
    // üye sepetini boşaltsa bile kaydettiği kombinler kaybolmamalı.
    const where =
      owner.kind === 'user' ? { userId: owner.userId } : { cart: { sessionId: owner.sessionId } };

    const outfits = await this.prisma.outfit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        tryOnJobId: true,
        createdAt: true,
        items: { select: { id: true, variantId: true, quantity: true } },
      },
    });

    return outfits.map((outfit) => ({
      id: outfit.id,
      name: outfit.name,
      tryOnJobId: outfit.tryOnJobId,
      createdAt: outfit.createdAt,
      items: outfit.items.map((item) => ({
        cartItemId: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
      })),
    }));
  }

  /**
   * Kombini oluşturur ve kalemlerini sepete ekler.
   *
   * Kombin kaydı ile kalemler AYNI transaction'da yazılır: ikiye bölünürse
   * kalemsiz bir kombin ya da kombine bağlanmamış kalemler ortada kalır ve
   * kullanıcı bunu ancak ekranda görünce anlar.
   */
  async create(
    owner: CartOwner,
    input: CreateOutfitInput,
  ): Promise<{ outfit: OutfitView; cart: CartView }> {
    const cart = await this.cart.ensureCart(owner);

    // Doğrulama transaction DIŞINDA: katalog/stok okumaları uzun sürebilir ve
    // transaction'ı gereksiz yere açık tutmak kilit süresini uzatır.
    const { prepared } = await this.cart.prepareItems(cart.id, input.items, {
      skipUnavailable: false,
    });

    const outfitId = await this.prisma.$transaction(async (tx) => {
      const outfit = await tx.outfit.create({
        data: {
          name: input.name,
          cartId: cart.id,
          userId: owner.kind === 'user' ? owner.userId : null,
        },
        select: { id: true },
      });
      await this.cart.writeItems(tx, cart, prepared, outfit.id);
      return outfit.id;
    });

    const [outfit, view] = await Promise.all([
      this.byId(owner, outfitId),
      this.cart.buildView(cart),
    ]);
    return { outfit, cart: view };
  }

  /**
   * Kayıtlı kombinin tamamını sepete atar.
   *
   * Satın alınamayan kalemler İŞLEMİ İPTAL ETMEZ, atlanır ve `skipped` ile
   * bildirilir: dört parçalık bir kombinde tek bir beden tükendi diye
   * kullanıcının tüm kombini sepete atamaması kabul edilemez.
   */
  async addToCart(
    owner: CartOwner,
    outfitId: string,
  ): Promise<{ cart: CartView; skipped: SkippedItem[] }> {
    const cart = await this.cart.ensureCart(owner);
    await this.cart.assertOutfitBelongsTo(cart, owner, outfitId);

    const items = await this.prisma.cartItem.findMany({
      where: { outfitId },
      select: { variantId: true, quantity: true },
    });
    if (items.length === 0) throw appError('CART_EMPTY');

    // Zaten sepette olan kalem için istenen adet 0 kabul edilir: kombini iki
    // kez sepete atmak adetleri katlamamalı.
    const inCart = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id, variantId: { in: items.map((i) => i.variantId) } },
      select: { variantId: true, quantity: true },
    });
    const existing = new Map(inCart.map((i) => [i.variantId, i.quantity]));

    const requests = items
      .map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity - (existing.get(item.variantId) ?? 0),
      }))
      .filter((request) => request.quantity > 0);

    if (requests.length === 0) return { cart: await this.cart.buildView(cart), skipped: [] };

    const { prepared, skipped } = await this.cart.prepareItems(cart.id, requests, {
      skipUnavailable: true,
    });

    await this.prisma.$transaction(async (tx) => {
      await this.cart.writeItems(tx, cart, prepared, outfitId);
    });

    return { cart: await this.cart.buildView(cart), skipped };
  }

  async remove(owner: CartOwner, outfitId: string): Promise<void> {
    const cart = await this.cart.ensureCart(owner);
    await this.cart.assertOutfitBelongsTo(cart, owner, outfitId);

    // Kombin silinir ama KALEMLER SEPETTE KALIR (CartItem.outfitId onDelete:
    // SetNull). Kullanıcı "kombini kaldır" derken sepetini boşaltmayı
    // kastetmez; ürünleri silmek ayrı ve bilinçli bir işlemdir.
    await this.prisma.outfit.delete({ where: { id: outfitId } });
  }

  private async byId(owner: CartOwner, outfitId: string): Promise<OutfitView> {
    const found = (await this.list(owner)).find((outfit) => outfit.id === outfitId);
    if (!found) throw appError('NOT_FOUND');
    return found;
  }
}
