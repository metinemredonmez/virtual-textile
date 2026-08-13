import { NextResponse, type NextRequest } from 'next/server';

/**
 * ⚠️ BU KATMAN UX'TİR, GÜVENLİK DEĞİL.
 *
 * ⚠️ Dosya adı `middleware.ts` DEĞİL `proxy.ts`: Next 16'da middleware
 *    yakınsaması KULLANIMDAN KALDIRILDI (`next dev` uyarı basıyor). Eski adla
 *    bırakmak bugün çalışır, bir sonraki ana sürümde sessizce çalışmaz olur.
 *
 * Yaptığı tek şey: `vt_sid` çerezi yoksa kullanıcıyı giriş sayfasına göndermek.
 * Böylece korumalı bir panel isteği önce boş bir kabuk çizip sonra 404'e
 * düşmez. Rol kontrolü YAPMAZ — rol Redis'te tutuluyor ve bu katman Edge'de
 * çalışıyor; ayrıca rolü burada kontrol etmek "koruma tamam" yanılsaması
 * üretirdi. Gerçek kontrol rota grubu layout'unda (`requireRole`) ve asıl
 * garanti API guard'larındadır.
 *
 * ⚠️ Matcher YALNIZCA panel yollarını kapsar. `/api/*` bilinçli olarak DIŞARIDA:
 *    stil danışmanı akışı (`/api/stylist/.../messages`) buradan geçseydi
 *    bu katman yanıtı sarmalayabilir ve akış tamponlanabilirdi.
 */
export function proxy(request: NextRequest): NextResponse {
  if (request.cookies.has('vt_sid')) return NextResponse.next();

  const giris = new URL('/login', request.url);
  giris.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(giris);
}

/**
 * ⚠️ `/account/:path*` LİSTEDE, ama korumanın kendisi BURADA DEĞİL: gerçek kapı
 *    `account/layout.tsx` ve `hesapFetch()`in `/login`e yönlendirmesi. Bu
 *    satırın tek işi İSKELET SIÇRAMASINI önlemek — çerezsiz ziyaretçi önce
 *    hesap kabuğunu çizdiriyor, sonra yönlendiriliyordu. Satır kaldırılırsa
 *    kaybolan şey güvenlik değil, yalnızca o sıçramanın yokluğu.
 */
export const config = {
  matcher: ['/account/:path*', '/seller/:path*', '/admin/:path*'],
};
