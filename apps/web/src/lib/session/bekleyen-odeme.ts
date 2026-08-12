import 'server-only';
import { cookies } from 'next/headers';
import type { CheckoutInitResultWire } from '@vt/contracts';
import { GID_COOKIE, readSid } from '@/lib/session/cookies';
import { redis } from '@/lib/session/store';

/**
 * BEKLEYEN ÖDEME — sunucu tarafında, kimlik başına tek kayıt.
 *
 * ⚠️ NEDEN VAR: `POST /v1/checkout/init` IDEMPOTENT DEĞİL. ÖLÇÜLDÜ — aynı
 *    sepetle art arda iki kez çağırınca İKİ sipariş doğdu (VT-260812-0040,
 *    VT-260812-0041) ve stok İKİ KEZ rezerve edildi. Yani sipariş kimliğini
 *    yalnızca istemci belleğinde tutmak, F5'e basan her kullanıcı için ikinci
 *    bir sipariş ve ikinci bir rezervasyon demektir. Sunucu tarafında bir
 *    kayıt olmadan "sayfa yenilense de aynı sipariş" mümkün değil.
 *
 * ⚠️ NEDEN URL'DE DEĞİL: misafirin ödeme yapabilmesi için `checkout/pay`
 *    gövdesinde E-POSTA gerekiyor (`assertOrderAccess`: misafir siparişinde
 *    e-posta eşleşmezse AUTH_FORBIDDEN). E-postayı sorgu dizesine koymak
 *    kişisel veriyi tarayıcı geçmişine, sunucu loglarına ve `Referer`
 *    başlığına yazmak olurdu.
 *
 * ⚠️ NEDEN localStorage/sessionStorage DEĞİL: sepet/oturum sunucu durumudur
 *    (değişmez kural 6) ve bu kayıt ödeme akışının durumudur. Ayrıca Sunucu
 *    Bileşeni tarayıcı deposunu okuyamaz; okuyamayınca sayfa ilk çizimde
 *    adres formunu gösterir, sonra istemci "aslında sipariş vardı" der ve
 *    ekran zıplar.
 *
 * ⚠️ BU KAYIT BİR YETKİ BELGESİ DEĞİLDİR. İçindeki `orderId`/`email` istemciden
 *    geliyor ve doğrulanmıyor; doğrulama `checkout/pay` çağrısında SUNUCUDA
 *    yapılıyor (üye için `order.userId === actor.userId`, misafir için e-posta
 *    eşleşmesi). Kayıt yalnızca "bu kullanıcı hangi siparişin ödemesinde
 *    kalmıştı" sorusunu yanıtlar; uydurma bir kayıt yazan kullanıcı yalnızca
 *    KENDİ akışını bozar.
 */

export interface BekleyenOdeme {
  orderId: string;
  orderNumber: string;
  /** ⚠️ Misafir `pay` çağrısında ZORUNLU; sipariş sahipliğinin kanıtı. */
  email: string;
  itemsTotalMinor: CheckoutInitResultWire['itemsTotalMinor'];
  shippingTotalMinor: CheckoutInitResultWire['shippingTotalMinor'];
  discountMinor: CheckoutInitResultWire['discountMinor'];
  grandTotalMinor: CheckoutInitResultWire['grandTotalMinor'];
  /** ISO 8601. Rezervasyonun düşeceği an. */
  reservationExpiresAt: string;
  /**
   * ⚠️ TAKSİT DE KAYITTA — kozmetik değil, ödeme akışının doğruluk şartı.
   *
   *    `checkout/pay` gövdesi bu alanı taşıyor ve API interceptor'ı
   *    idempotency anahtarını GÖVDENİN HASH'İYLE eşleştiriyor
   *    (`idempotency.interceptor.ts` → `requestHash`). Kayıtta tutulmasaydı
   *    3DS çerçevesindeyken sayfayı yenileyen kullanıcı `odeme` adımına döner
   *    ama taksit `React.useState(1)` başlangıcına düşerdi: aynı anahtar,
   *    değişmiş gövde → kalıcı `IDEMPOTENCY_CONFLICT` (409, retryable:false),
   *    ve tek kurtuluşu taksiti TESADÜFEN eski değerine geri getirmek olan
   *    bir ekran.
   *
   *    ⚠️ `installment: 1` OKUNAN ESKİ KAYITLARDA da doğru varsayılan: alan
   *    eklenmeden önce yazılmış kayıtlar `undefined` döner ve akış onu 1'e
   *    düşürür — sunucudaki `pay` çağrısı da hiç yapılmamış olur.
   */
  installment: number;
}

/**
 * Kaydın ömrü rezervasyondan (15 dk) UZUN tutuluyor.
 *
 * ⚠️ Rezervasyonla aynı olsaydı, süre dolduğu anda kayıt da buharlaşır ve
 *    kullanıcı "rezervasyonunuz doldu" açıklaması yerine boş bir adres formu
 *    görürdü — ne olduğunu anlamadan ikinci bir sipariş açardı. Kayıt bilerek
 *    yaşıyor ki süresi dolmuş siparişi EKRANDA açıklayabilelim.
 */
const TTL_SANIYE = 45 * 60;

/**
 * ⚠️ Kimlik SUNUCUDA okunur, parametre olarak ALINMAZ. İstemciden gelen bir
 *    kimlikle anahtar kurmak, başkasının bekleyen ödemesini okumaya açık kapı
 *    bırakırdı.
 */
async function anahtar(): Promise<string | null> {
  const sid = await readSid();
  if (sid) return `odeme:u:${sid}`;
  const gid = (await cookies()).get(GID_COOKIE)?.value;
  return gid ? `odeme:g:${gid}` : null;
}

export async function bekleyeniOku(): Promise<BekleyenOdeme | null> {
  const k = await anahtar();
  if (!k) return null;

  const raw = await redis().get(k);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BekleyenOdeme;
  } catch {
    // Bozuk kayıtla devam etmek her yenilemede aynı çöpü okumak olurdu.
    await redis().del(k);
    return null;
  }
}

export async function bekleyeniYaz(kayit: BekleyenOdeme): Promise<void> {
  const k = await anahtar();
  // ⚠️ Kimlik yoksa sessizce geçilir: misafir kimliği vekilde doğuyor ve
  //    `/checkout` öneki o listede (`GUEST_IDENTITY_PREFIXES`), yani init
  //    isteğini yapan kullanıcının çerezi zaten var. Burada patlamak, başarılı
  //    bir siparişin ardından ekranı hataya düşürürdü.
  if (!k) return;
  await redis().set(k, JSON.stringify(kayit), 'EX', TTL_SANIYE);
}

export async function bekleyeniSil(): Promise<void> {
  const k = await anahtar();
  if (!k) return;
  await redis().del(k);
}
