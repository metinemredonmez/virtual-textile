import 'server-only';
import { listeOku, tekilOku, type ListeOkumasi, type Okuma } from '@/lib/api/okuma';
import type {
  SellerBalanceWire,
  SellerCouponWire,
  SellerPackageSummaryWire,
  SellerProductDetailWire,
  ProductStatusWire,
  SellerProductSummaryWire,
  SellerProfileWire,
} from '@vt/contracts';

/**
 * SATICI PANELİ — SUNUCU TARAFI OKUMALAR.
 *
 * Bu dosya artık bir OKUMA KATMANI DEĞİL, yalnızca satıcı uçlarının ADRES ve
 * SORGU tablosu: her fonksiyon `lib/api/okuma.ts`teki `listeOku`/`tekilOku`yu
 * çağırıp sonucu bu ekranların beklediği adla (`urunler`, `paketler`,
 * `kuponlar`) döndürüyor.
 *
 * ⚠️ BURADA BİR `dene()` VARDI ve `listeOku`nun gövdesini yeniden yazıyordu —
 *    aynı `try/catch`, aynı `hataYuku`, aynı `list()`. `okuma.ts` kendini
 *    "panel ekranlarının okuma kapısı, satıcı ve yönetim, TEK kalıp" diye
 *    tanımlıyor; ikinci gövde o cümleyi yanlış yapıyordu ve bu depoda
 *    ölçülmüş ayrışma sınıfının ta kendisi (aynı işi yapan iki yardımcı,
 *    biri düzeltilince diğeri eski kalıyor). Kopya silindi; kalan tek şey
 *    ADLANDIRMA.
 *
 * ⚠️ Veri `hesapFetch` ile DOĞRUDAN API'den geliyor (`okuma.ts` içinde),
 *    `/api/*` vekilinden değil: vekil TARAYICININ kapısıdır. Bir Sunucu
 *    Bileşeninden vekile HTTP açmak fazladan bir tur ve (misafir kimliği
 *    üreten yollarda) yapışmayan çerez demek.
 *
 * ⚠️ HATA FIRLATILMAZ, DÖNDÜRÜLÜR. Panelde bir kart çöktüğünde sayfanın
 *    tamamını hata sınırına düşürmek, çalışan üç kartı da kullanıcıdan almak
 *    olurdu. `redirect()` de yutulmuyor — gerekçe `okuma.ts` başlığında.
 */

/**
 * `{items, nextCursor}` → ekranın beklediği ad.
 *
 * ⚠️ Yalnızca ADLANDIRMA yapıyor; hata dalı OLDUĞU GİBİ geçiyor. Hata dalında
 *    yeni bir nesne kurmak, `Okuma<T>`nin tek şekilli olma güvencesini bu
 *    dosyada ikinci kez yazmak olurdu.
 */
function adlandir<T, A extends string>(
  okuma: Okuma<ListeOkumasi<T>>,
  ad: A,
): Okuma<{ [K in A]: T[] } & { nextCursor: string | null }> {
  if (!okuma.tamam) return okuma;
  return {
    tamam: true,
    veri: { [ad]: okuma.veri.items, nextCursor: okuma.veri.nextCursor } as {
      [K in A]: T[];
    } & { nextCursor: string | null },
  };
}

export interface UrunListesiSonucu {
  urunler: SellerProductSummaryWire[];
  nextCursor: string | null;
}

export async function urunleriGetir(
  sorgu: {
    status?: ProductStatusWire | undefined;
    q?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
  donusYolu: string,
): Promise<Okuma<UrunListesiSonucu>> {
  const okuma = await listeOku<SellerProductSummaryWire, '/seller/products'>(
    '/seller/products',
    donusYolu,
    { query: { status: sorgu.status, q: sorgu.q, cursor: sorgu.cursor, limit: sorgu.limit } },
  );
  return adlandir(okuma, 'urunler');
}

export async function urunGetir(
  productId: string,
  donusYolu: string,
): Promise<Okuma<SellerProductDetailWire>> {
  return tekilOku<SellerProductDetailWire, `/seller/products/${string}`>(
    `/seller/products/${productId}`,
    donusYolu,
  );
}

export async function magazaGetir(donusYolu: string): Promise<Okuma<SellerProfileWire>> {
  return tekilOku<SellerProfileWire, '/seller/me'>('/seller/me', donusYolu);
}

export async function bakiyeGetir(donusYolu: string): Promise<Okuma<SellerBalanceWire>> {
  return tekilOku<SellerBalanceWire, '/seller/finance/balance'>(
    '/seller/finance/balance',
    donusYolu,
  );
}

/**
 * Paket listesi — hem panoda sayım için, hem sipariş ekranının kendisi için.
 *
 * ⚠️ İKİ ÇAĞRI YERİ VARDI VE BİRİ BU FONKSİYONU HİÇ KULLANMIYORDU: sipariş
 *    listesi ekranı aynı uca kendi `hesapFetch` çağrısıyla gidiyordu. Tek
 *    panelde tek uca iki okuma yolu, sorgu şekli değiştiğinde (yeni süzgeç,
 *    yeni parametre) yalnız birinin güncellenmesi demektir. Sorgu alanları bu
 *    yüzden buraya taşındı.
 *
 * ⚠️ `slaBreached` sunucuda `z.coerce.boolean()`: BOŞ OLMAYAN HER dizgi `true`
 *    olur, `'0'` bile. Kapalıyken parametre HİÇ gönderilmiyor — `false`
 *    göndermek süzgeci açardı.
 *
 * ⚠️ Uç `total` DÖNDÜRMÜYOR (`meta.nextCursor` var, `meta.total` yok). Yani
 *    "23 bekleyen sipariş" yazılamaz; yalnızca çekilen pencere sayılabilir.
 *    Çağıran taraf `nextCursor`a bakıp `sayimEtiketi` ile "9+" yazar — uydurma
 *    bir toplam basmak, satıcının panele güvenini bir kez kaybettirir.
 */
export async function paketleriGetir(
  sorgu: {
    status?: string | undefined;
    slaBreached?: boolean | undefined;
    orderNumber?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
  donusYolu: string,
): Promise<Okuma<{ paketler: SellerPackageSummaryWire[]; nextCursor: string | null }>> {
  const okuma = await listeOku<SellerPackageSummaryWire, '/seller/orders'>(
    '/seller/orders',
    donusYolu,
    {
      query: {
        status: sorgu.status,
        slaBreached: sorgu.slaBreached ? 'true' : undefined,
        orderNumber: sorgu.orderNumber,
        cursor: sorgu.cursor,
        limit: sorgu.limit,
      },
    },
  );
  return adlandir(okuma, 'paketler');
}

export async function kuponlariGetir(
  sorgu: { limit: number; cursor?: string | undefined },
  donusYolu: string,
): Promise<Okuma<{ kuponlar: SellerCouponWire[]; nextCursor: string | null }>> {
  const okuma = await listeOku<SellerCouponWire, '/seller/coupons'>('/seller/coupons', donusYolu, {
    query: { limit: sorgu.limit, cursor: sorgu.cursor },
  });
  return adlandir(okuma, 'kuponlar');
}
