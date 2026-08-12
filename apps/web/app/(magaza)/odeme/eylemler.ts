'use server';

import { createHash } from 'node:crypto';
import { sessionSecret } from '@/lib/env';
import { bekleyeniSil, bekleyeniYaz, type BekleyenOdeme } from '@/lib/session/bekleyen-odeme';

/**
 * ÖDEME AKIŞININ SUNUCU EYLEMLERİ.
 *
 * ⚠️ Bu dosyanın DIŞA AÇTIĞI HER ŞEY tarayıcıdan çağrılabilir. Bu yüzden
 *    burada yalnızca üç işlem var ve üçü de yetki kararı VERMİYOR: iki tanesi
 *    çağıranın KENDİ kimliğine bağlı bir Redis anahtarına yazıp siliyor,
 *    üçüncüsü deterministik bir türetme yapıyor. Gerçek yetki kontrolü
 *    `checkout/pay` çağrısında API'de (`assertOrderAccess`).
 */

/**
 * `POST /v1/checkout/pay` için IDEMPOTENCY ANAHTARI.
 *
 * ⚠️ `crypto.randomUUID()` BURADA YANLIŞ OLURDU. `newIdempotencyKey()` rastgele
 *    üretir ve `useRef` ile bir render ağacı boyunca sabit kalır — ama SAYFA
 *    YENİLENDİĞİNDE ref ölür, yeni anahtar doğar ve sağlayıcıda İKİNCİ bir
 *    ödeme oturumu açılır. Görev metnindeki "sayfa yenilense de AYNI kalmalı"
 *    şartı ancak anahtar TÜRETİLİRSE sağlanır: aynı sipariş → aynı anahtar,
 *    her zaman, her cihazda.
 *
 * ⚠️ TUZ ZORUNLU. `schema.prisma` → `key String @id` KÜRESEL birincil anahtar
 *    ve `idempotency.interceptor.ts` `begin()` `userId` doğrulaması YAPMIYOR
 *    (`lib/env.ts` → `sessionSecret` yorumu). Tuzsuz bir türetme
 *    (`sha256(orderId)`) tahmin edilebilir olurdu: sipariş kimliğini bilen biri
 *    anahtarı da bilir ve BAŞKASININ idempotency kaydına çarpıp o siparişin
 *    ödeme yanıtını geri oynatabilirdi. Tuz sunucuda kalır.
 *
 * ⚠️ Ön ek (`checkout-pay:`) da zorunlu: aynı tuzla türetilen `cart-merge`
 *    anahtarıyla (`session/authenticate.ts`) çakışmasın.
 *
 * ⚠️ ANAHTAR GÖVDENİN İMZASINA BAĞLI — yalnız `orderId`ye DEĞİL.
 *    `idempotency.interceptor.ts` kaydı GÖVDEYLE eşleştiriyor
 *    (`requestHash = sha256({ body, path })`) ve eşleşmezse
 *    `IDEMPOTENCY_CONFLICT` (409, `retryable: false`, RETRY_POLICY → YOK)
 *    fırlatıyor. Anahtar yalnız siparişten türetilseydi taksiti değiştiren
 *    kullanıcı — aynı sipariş, farklı gövde — ÇIKIŞSIZ bir 409'a çarpardı:
 *    "Aynı işlem anahtarı farklı bir istekle kullanıldı." cümlesi ne olduğunu
 *    söylemiyor ve o kodda düğme de yok. Kayıt 24 saat saklandığı için ekran
 *    kalıcı olarak kilitlenirdi.
 *
 *    Kural `iade-formu.tsx`ten alındı ve aynısıdır: AYNI TALEP = AYNI ANAHTAR,
 *    DEĞİŞEN TALEP = YENİ NİYET.
 *
 *    ⚠️ "Sayfa yenilense de aynı anahtar" şartı BOZULMUYOR: taksit artık
 *    `BekleyenOdeme` kaydında sunucuda duruyor ve yenilemeden sonra geri
 *    yükleniyor, yani F5 gövdeyi değiştirmiyor. Anahtar ancak kullanıcı
 *    taksiti GERÇEKTEN değiştirdiğinde değişir. İki düzeltme birlikte
 *    gerekli: yalnız kayıt eklenseydi taksit değişimi hâlâ 409 üretirdi,
 *    yalnız anahtar genişletilseydi her F5 sağlayıcıda ikinci bir ödeme
 *    oturumu açardı.
 */
export async function odemeAnahtari(orderId: string, installment: number): Promise<string> {
  return createHash('sha256')
    .update(`${sessionSecret()}checkout-pay:${orderId}:${installment}`)
    .digest('hex');
}

/**
 * Başarılı `init` sonrası siparişi sunucuya not et.
 *
 * ⚠️ Bu çağrı BAŞARISIZ OLURSA akış DURMAZ — sipariş zaten oluştu ve kullanıcı
 *    ödemeye devam edebilmeli. Kaybedilen tek şey "sayfayı yenilersem aynı
 *    siparişe dönerim" güvencesi; onu korumak için ödemeyi engellemek, çözmeye
 *    çalıştığımız sorundan daha kötü bir sonuç üretirdi.
 */
export async function odemeyiKaydet(kayit: BekleyenOdeme): Promise<void> {
  await bekleyeniYaz(kayit);
}

/** Sipariş kapandı (ödendi/iptal) ya da rezervasyon düştü — kayıt gereksiz. */
export async function odemeyiTemizle(): Promise<void> {
  await bekleyeniSil();
}
