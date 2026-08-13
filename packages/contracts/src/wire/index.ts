/**
 * WIRE — API'nin TELDE gönderdiği şekiller.
 *
 * `apps/api` içindeki `*View` arayüzleri `bigint` ve `Date` taşır; zarf
 * `serializeBigInts` (yani `JSON.parse(JSON.stringify(...))`) üzerinden geçtiği
 * için telde string olurlar. İkisini aynı sanmak paranın `Number`'a düşmesi ve
 * tarihin `Date` sanılması demektir.
 *
 * ⚠️ BU KATMANIN VERDİĞİ GÜVENCE BUGÜN SINIRLI. Buradaki tipler çalışan API'ye
 *    atılmış gerçek isteklerden okundu (ölçüm), ama sunucu tarafında derleme
 *    zamanı sapma testi henüz yok. Sunucu bir alanı yeniden adlandırdığında
 *    burası KENDİLİĞİNDEN kırılmaz. Yeni bir uç eklenirken tipi buraya YAZILIR
 *    ve gerçek yanıtla KARŞILAŞTIRILIR; tahmin edilmez.
 */
export * from './money.js';
export * from './catalog.js';
export * from './cart.js';
export * from './checkout.js';
export * from './tryon.js';
export * from './stylist.js';
export * from './size.js';
export * from './media.js';
export * from './search.js';
export * from './account.js';
// ⚠️ `catalog.js`ten SONRA gelir: `site.js` ondan `TryOnCategoryWire` okuyor,
//    böylece vitrin kartı ile ürün detayı o union'ın TEK kopyasını paylaşıyor.
export * from './site.js';
// ⚠️ Panel tel tipleri. `seller.js` ÖNCE gelir: `admin.js` ondan
//    `ProductStatusWire`/`SellerStatusWire`/`PayoutStatusWire` okuyor ve iki
//    panel bu enum'ların TEK kopyasını paylaşıyor.
export * from './seller.js';
export * from './admin.js';
