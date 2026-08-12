import type { Metadata } from 'next';
import { bosSepet, sepetiOku } from './sepet-sunucu';
import { SepetIstemci } from './sepet-istemci';

/**
 * SEPET.
 *
 * Kalıp `(magaza)/urunler/page.tsx`ten: Sunucu Bileşeni veriyi getirir, ekran
 * onu çizer. FARK, veri YOLUNDA: ürün listesi genel ve önbelleklenebilir
 * olduğu için `serverFetch` ile doğrudan API'ye gidiyor; sepet KİMLİKLİ bir
 * kaynak, bu yüzden `sepet-sunucu.ts` üzerinden oturum jetonuyla okunuyor
 * (kalıbı `lib/session/guard.ts`ten).
 *
 * ⚠️ `noindex`: sepet kişiye özeldir; arama motoruna verilecek bir şey yok.
 */
export const metadata: Metadata = {
  title: 'Sepetim',
  robots: { index: false, follow: false },
};

/**
 * ⚠️ `force-dynamic`: sepet çereze bağlı. Açıkça yazılmasının sebebi referans
 *    sayfadakiyle aynı — bir gün birinin "neden statik değil" diye aramasını
 *    önlemek. Ayrıca bir önbellek katmanı araya girerse BAŞKASININ sepetini
 *    servis etme riski var; bu satır o riski okunur kılıyor.
 */
export const dynamic = 'force-dynamic';

export default async function SepetPage() {
  const okuma = await sepetiOku();

  /**
   * ⚠️ Okunamayan sepet "boş sepet" DEĞİLDİR. Bayrak istemciye sepeti vekilden
   *    (yani 401'de tek uçuşlu yenileme yapan yoldan) çektiriyor. Ayrım
   *    olmasaydı, oturumu yenilenmesi gereken kullanıcı "Sepetiniz boş"
   *    ekranını görür ve dolu sepetini kaybettiğini sanırdı.
   */
  return (
    <SepetIstemci
      baslangic={okuma.kind === 'sepet' ? okuma.sepet : bosSepet()}
      sunucudaOkunamadi={okuma.kind === 'okunamadi'}
    />
  );
}
