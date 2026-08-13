import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session/guard';
import { HesapMenusu } from './_bilesenler/hesap-menusu';
import { CikisDugmesi } from './_bilesenler/cikis-dugmesi';

/**
 * HESAP BÖLGESİ — tamamı korumalı, açık tema.
 *
 * ⚠️ `proxy.ts` matcher'ı ARTIK BU YOLU KAPSIYOR (`/account/:path*`), ama
 *    koruma ORADA DEĞİL: o katman çerezin VARLIĞINA bakar, geçerliliğine
 *    değil. Gerçek kapı burası (`currentUser()`) ve asıl garanti API
 *    guard'ları. Matcher'ın tek kazancı ölçülebilir: çerezsiz `/account`
 *    isteği artık gövdeye hiç girmeden HTTP 307 ile `/login?next=/account`e
 *    düşüyor — önce iskelet çizilip sonra yönlendirme yapılmıyor.
 *
 * ⚠️ `requireRole` KULLANILMADI. O yardımcı rol uymayınca `notFound()` diyor;
 *    burada rol değil OTURUM aranıyor ve doğru cevap 404 değil, `/login`e
 *    yönlendirmedir. `notFound()` gösterilseydi oturumu düşen kullanıcı
 *    "hesabım diye bir sayfa yok" derdi.
 *
 * ⚠️ `currentUser()` React `cache()` ile sarılı: layout + sayfa + alt
 *    bileşenler aynı istekte çağırsa bile API'ye TEK `GET /auth/me` gider.
 *
 * ⚠️ BURADAKİ `redirect()` HTTP 307 ÜRETMEZ, AKIŞ İÇİNDE GELİR — `loading.tsx`
 *    bir Suspense sınırı açtığı için Next kabuğu HEMEN gönderiyor ve başlık
 *    yazma şansı kalmıyor. Ölçüldü, ve sızıntı YOK: çerezsiz gövdede hesap
 *    içeriği hiç bulunmuyor (`Merhaba`, `Hesap bilgileri`, e-posta: 0 eşleşme),
 *    yalnızca iskelet var. Bu yol bugün pratikte görünmüyor çünkü çerezsiz
 *    istek `proxy.ts`e takılıp 307 alıyor; buradaki dal çerezi olan ama
 *    oturumu düşmüş kullanıcı için duruyor.
 *
 * ⚠️ AYNI SUSPENSE SINIRININ İKİNCİ ETKİSİ: `siparisler/[siparisNo]` altındaki
 *    `notFound()` de 200 döner (yumuşak 404). `(magaza)/loading.tsx` bu yüzden
 *    silindi ama BU dosya bilerek duruyor: hesap ekranları girişin arkasında,
 *    indekslenmiyor. Bedeli SEO değil, yalnızca yanlış durum kodu; karşılığında
 *    hesap iskeleti korunuyor. Gerekçe `(magaza)/not-found.tsx`te de yazılı.
 */
export const dynamic = 'force-dynamic';

export default async function HesapLayout({ children }: { children: ReactNode }) {
  const kullanici = await currentUser();
  if (!kullanici) redirect('/login?next=/account');

  const adSoyad = [kullanici.firstName, kullanici.lastName].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-8 md:flex-row md:gap-12">
      <aside className="w-full shrink-0 md:w-56">
        <div className="mb-4">
          <p className="text-sm font-semibold text-metin">{adSoyad || 'Hesabım'}</p>
          {/* İletişim bilgisi ikincil: kullanıcı hangi hesapta olduğunu doğrular. */}
          <p className="text-xs text-metin-soluk">{kullanici.email ?? kullanici.phone ?? ''}</p>
        </div>

        <HesapMenusu />

        <div className="mt-4 border-t border-kenar pt-3">
          <CikisDugmesi />
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
