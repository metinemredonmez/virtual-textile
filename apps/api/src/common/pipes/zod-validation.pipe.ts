import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Zod ile gövde/sorgu doğrulama.
 *
 * Hata fırlatıldığında GlobalExceptionFilter ZodError'ı yakalayıp alan bazlı
 * VALIDATION_FAILED yanıtına çevirir — burada hata biçimlendirmesi yapılmaz.
 *
 * Kullanım:
 *   @Post()
 *   create(@Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto) {}
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    // parse() ZodError fırlatır; filter onu yakalar.
    return this.schema.parse(value);
  }
}

/** Dekoratör kısayolu: @Body(zodBody(schema)) */
export const zodBody = <T>(schema: ZodSchema<T>): ZodValidationPipe<T> =>
  new ZodValidationPipe(schema);
