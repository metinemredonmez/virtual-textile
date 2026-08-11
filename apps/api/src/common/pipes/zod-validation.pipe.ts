import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Zod ile gövde/sorgu doğrulama.
 *
 * Hata fırlatıldığında GlobalExceptionFilter ZodError'ı yakalayıp alan bazlı
 * VALIDATION_FAILED yanıtına çevirir — burada hata biçimlendirmesi yapılmaz.
 *
 * Giriş ve çıkış tipleri AYRI parametreleştirilmiştir: `.transform()` veya
 * `.default()` kullanan şemalarda ikisi farklıdır (ör. sorgu dizesinden gelen
 * `"12"` → `12`). Tek tiple yazılsaydı bu şemalar tip hatası verirdi.
 *
 * Kullanım:
 *   @Post()
 *   create(@Body(zodBody(createUserSchema)) dto: CreateUserInput) {}
 */
@Injectable()
export class ZodValidationPipe<Output, Input = unknown> implements PipeTransform<unknown, Output> {
  constructor(private readonly schema: ZodType<Output, ZodTypeDef, Input>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): Output {
    // parse() ZodError fırlatır; filter onu yakalar.
    return this.schema.parse(value);
  }
}

/** Kısayol: @Body(zodBody(schema)) */
export const zodBody = <Output, Input>(
  schema: ZodType<Output, ZodTypeDef, Input>,
): ZodValidationPipe<Output, Input> => new ZodValidationPipe(schema);
