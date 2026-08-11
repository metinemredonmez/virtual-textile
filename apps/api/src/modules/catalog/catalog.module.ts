import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({
  controllers: [CatalogController],
  providers: [
    {
      provide: CatalogService,
      inject: [PrismaService, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof CatalogService>) =>
        new CatalogService(...args),
    },
  ],
  exports: [CatalogService],
})
export class CatalogModule {}
