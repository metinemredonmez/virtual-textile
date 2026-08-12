import type { NextRequest } from 'next/server';
import { apiBaseUrl } from '@/lib/env';
import { csrfViolation, forbiddenEnvelope } from '@/lib/api/csrf';
import { failureResponse } from '@/lib/api/envelope-response';
import { SID_COOKIE } from '@/lib/session/cookies';
import { getValidSession, SessionRevoked } from '@/lib/session/single-flight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * STİL DANIŞMANI — GERÇEK AKIŞ (`text/event-stream`).
 *
 * Genel vekilden AYRI, çünkü genel vekil gövdeyi TAMPONA alıyor (401 sonrası
 * tekrar için) ve tamponlanan bir akış artık akış değildir.
 *
 * ⚠️ `signal: request.signal` ŞART. `stylist.controller.ts` istemci bağlantısı
 *    kapandığında (`request.on('close')`) sağlayıcı çağrısını kesiyor —
 *    "kimsenin okumadığı yanıt için token ödemeye devam etmeyiz". Sinyal
 *    geçirilmezse bu tasarruf ÇALIŞMAZ ve bunu hiçbir test yakalamaz; yalnızca
 *    fatura görür.
 *
 * ⚠️ `X-Accel-Buffering: no` KOPYALANMALI. Burada yeni bir `Response` kuruluyor;
 *    başlık taşınmazsa ters vekil akışı tamponlar ve kullanıcı yanıtın tamamını
 *    tek seferde görür — yani akış olmanın tek faydası kaybolur.
 *
 * ⚠️ `next.config.ts` içinde `compress: false` bu yolun ÖNKOŞULU.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (csrfViolation(request)) return forbiddenEnvelope();

  const { id } = await ctx.params;
  const sid = request.cookies.get(SID_COOKIE)?.value ?? null;

  try {
    const session = sid ? await getValidSession(sid) : null;
    const body = await request.text();

    const upstream = await fetch(`${apiBaseUrl()}/stylist/conversations/${id}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
      },
      body,
      cache: 'no-store',
      signal: request.signal,
    });

    const contentType = upstream.headers.get('content-type') ?? '';

    // ⚠️ KAPILAR AKIŞ AÇILMADAN ÇALIŞIYOR (`assertCanSend`): kota/servis hatası
    //    NORMAL JSON zarfı olarak döner (429/503). Burada content-type
    //    denetlenmezse SSE ayrıştırıcısı o gövdeyi "boş yanıt" sanar ve
    //    kullanıcı hiçbir şey görmez — ne mesaj, ne hata.
    if (!contentType.includes('text/event-stream')) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { 'content-type': contentType || 'application/json' },
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
  } catch (error) {
    if (error instanceof SessionRevoked) {
      return failureResponse(error);
    }
    // İstemci sekmeyi kapattığında `AbortError` normaldir, hata değil.
    if (error instanceof Error && error.name === 'AbortError') {
      return new Response(null, { status: 499 });
    }
    return failureResponse(error);
  }
}
