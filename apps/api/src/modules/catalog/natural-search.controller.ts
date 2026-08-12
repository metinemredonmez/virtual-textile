import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { Public } from '../auth/auth.guard.js';
import { NaturalSearchService } from './natural-search.service.js';
import { naturalSearchBodySchema, type NaturalSearchBody } from './natural-search.schema.js';

/**
 * DOĞAL DİLDE ARAMA UCU
 *
 * ⚠️ `@Public()` — katalog misafire de açıktır ve arama katalogdur. Stil
 *    danışmanı giriş ister çünkü orada kota kullanıcı başına tanımlıdır ve
 *    kimliksiz kullanım kotasız kullanım olurdu; burada misafirin de kotası
 *    vardır (IP başına, daha düşük) ve kota dolduğunda kullanıcı hata değil
 *    SADE ARAMA görür. Doğal dilde aramayı girişin arkasına koymak, ürün
 *    keşfini kaydolmaya bağlamak olurdu.
 *
 * ⚠️ POST + 200. Gövde kullanılıyor çünkü serbest metin sorgu dizesine
 *    yazılırsa yol boyunca (proxy, erişim log'u, tarayıcı geçmişi) kalıcı iz
 *    bırakır; arama cümleleri kişisel olabilir ("hamile kıyafeti", "büyük
 *    beden"). 201 DEĞİL 200: bu uç bir kaynak yaratmaz, okur.
 */
@Controller()
export class NaturalSearchController {
  constructor(private readonly naturalSearch: NaturalSearchService) {}

  @Public()
  @Post('search/natural')
  @HttpCode(200)
  // ⚠️ Hız limiti kotanın YERİNE geçmez, ondan öncedir: kota günlük LLM
  //    harcamasını, hız limiti anlık yükü sınırlar. Kimliksiz istekte
  //    `scope: 'user'` kendiliğinden IP'ye düşer.
  @RateLimit({ name: 'search', scope: 'user' })
  async natural(
    @Body(zodBody(naturalSearchBodySchema)) body: NaturalSearchBody,
    @Req() request: Request & { userId?: string },
  ): Promise<unknown> {
    // İstemci bağlantıyı kapatırsa sağlayıcı çağrısı da kesilir; kesilmezse
    // kimsenin okumadığı bir yanıt için token ödemeye devam ederiz.
    const abort = new AbortController();
    request.on('close', () => {
      abort.abort();
    });

    const result = await this.naturalSearch.search({
      query: body.query,
      userId: request.userId ?? null,
      clientIp: request.ip ?? 'unknown',
      signal: abort.signal,
    });

    // Alan sırası `GET /v1/products` ile aynı tutuldu: istemci aynı liste
    // bileşenini kullanabilsin, yalnızca `interpretation` fazladan gelsin.
    return {
      items: result.items,
      nextCursor: result.nextCursor,
      total: result.total,
      facets: result.facets,
      didYouMean: result.didYouMean,
      /**
       * ⚠️ SAYFALAMA BU UÇTAN YAPILMAZ. `filter` istemciye geri veriliyor ki
       *    ikinci sayfa `GET /v1/products` üzerinden çekilsin. Aksi hâlde her
       *    "daha fazla göster" bir LLM çağrısı daha demek olurdu — aynı cümle
       *    için, aynı sonucu üretmek üzere.
       */
      interpretation: result.interpretation,
    };
  }
}
