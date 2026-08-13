import Link from 'next/link';
import type { Metadata } from 'next';
import { bosSepet, sepetiOku } from '../cart/sepet-sunucu';
import { bekleyeniOku } from '@/lib/session/bekleyen-odeme';
import { OdemeAkisi } from './odeme-akisi';

/**
 * ÖDEME.
 *
 * ⚠️ Bekleyen sipariş SUNUCUDA okunur ve ilk boyamaya girer. İstemcide
 *    okunsaydı sayfa önce adres formunu çizer, sonra "aslında siparişiniz
 *    vardı" diye zıplardı — ve o kısa anda kullanıcı formu doldurup İKİNCİ bir
 *    sipariş açabilirdi (`checkout/init` idempotent değil).
 */
export const metadata: Metadata = {
  title: 'Ödeme',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function OdemePage() {
  const [okuma, bekleyen] = await Promise.all([sepetiOku(), bekleyeniOku()]);
  const sepet = okuma.kind === 'sepet' ? okuma.sepet : null;

  /**
   * ⚠️ Sepet boş ama BEKLEYEN SİPARİŞ VARSA akış DEVAM EDER. `checkout/init`
   *    sepeti siparişe çevirdikten sonra sepetin boşalması normaldir; burada
   *    "sepetiniz boş" deyip yolu kapatmak, ödemesi yarım kalmış ve stoğu
   *    rezerve edilmiş bir kullanıcıyı siparişinden koparırdı.
   */
  if (!bekleyen && (sepet === null || sepet.packages.length === 0)) {
    return (
      <div className="py-16 text-center">
        <p className="text-metin">Ödeme yapılabilecek ürün bulunamadı.</p>
        <Link href="/cart" className="mt-2 inline-block text-sm text-vurgu hover:underline">
          Sepete dön
        </Link>
      </div>
    );
  }

  /**
   * ⚠️ Sepet okunamadı ama bekleyen sipariş var: özet siparişin KENDİ
   *    tutarlarını gösterir, paket listesi boş kalır. Tutar hiçbir koşulda
   *    uydurulmaz.
   */
  return <OdemeAkisi sepet={sepet ?? bosSepet()} bekleyen={bekleyen} />;
}
