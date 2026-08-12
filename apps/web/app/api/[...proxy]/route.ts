import type { NextRequest } from 'next/server';
import { proxyRequest } from '@/lib/api/proxy';

/**
 * TEK GENEL VEKİL — kimlik/sır gerektiren tüm uçlar buradan geçer.
 *
 * ⚠️ Ürün listesi gibi GENEL uçlar buradan GEÇMEZ; Sunucu Bileşeni içinden
 *    doğrudan API'ye gider (`lib/api/server.ts`). Her isteği vekile sokmak
 *    tarayıcı → Next → API şeklinde gereksiz bir atlama ekler ve önbelleği
 *    öldürür.
 *
 * ⚠️ Çerez YAZAN yollar (login, register, logout) buraya DÜŞMEZ; kendi
 *    handler'ları var (`app/api/auth/*`). Sebep: oturum kurmak/çökertmek
 *    Redis'e yazmak ve `vt_sid` üretmek demek — bu, "isteği aynen ilet"
 *    işinden farklı bir sorumluluk.
 */

// ⚠️ ioredis Edge'de çalışmaz; Node çalışma zamanı ZORUNLU.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ proxy: string[] }> };

async function handle(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { proxy } = await ctx.params;
  return proxyRequest(request, proxy);
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
