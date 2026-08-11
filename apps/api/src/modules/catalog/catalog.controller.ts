import { Controller, Get, Param, Query } from '@nestjs/common';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { Public } from '../auth/auth.guard.js';
import { CatalogService } from './catalog.service.js';
import {
  productListQuerySchema,
  suggestQuerySchema,
  type ProductListQuery,
} from './catalog.schema.js';

/**
 * Katalog uçları herkese açıktır — misafir de gezebilmeli.
 * Guard yine de token'ı çözer (varsa), böylece ileride kişiselleştirme
 * eklendiğinde ayrı bir yola gerek kalmaz.
 */
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('categories')
  async categories(): Promise<unknown> {
    return this.catalog.categoryTree();
  }

  @Public()
  @Get('products')
  @RateLimit({ name: 'search', scope: 'ip' })
  async products(
    @Query(zodBody(productListQuerySchema)) query: ProductListQuery,
  ): Promise<unknown> {
    const result = await this.catalog.listProducts(query);
    // EnvelopeInterceptor `items` + `nextCursor`'ı zarf meta'sına taşır.
    return {
      items: result.items,
      nextCursor: result.nextCursor,
      total: result.total,
      facets: result.facets,
      didYouMean: result.didYouMean,
    };
  }

  @Public()
  @Get('products/:slug')
  async product(@Param('slug') slug: string): Promise<unknown> {
    return this.catalog.productBySlug(slug);
  }

  @Public()
  @Get('products/:id/similar')
  async similar(@Param('id') id: string): Promise<unknown> {
    return this.catalog.similarProducts(id);
  }

  @Public()
  @Get('search/suggest')
  @RateLimit({ name: 'search', scope: 'ip' })
  async suggest(@Query(zodBody(suggestQuerySchema)) query: { q: string }): Promise<unknown> {
    return this.catalog.suggest(query.q);
  }
}
