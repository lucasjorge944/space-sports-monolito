import type { PipeTransform } from '@nestjs/common';
import { AD_FORBIDDEN_CATEGORIES } from '@space-sports/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { categoryForbidden } from './ads.errors.js';

const FORBIDDEN = new Set<string>(AD_FORBIDDEN_CATEGORIES);

/**
 * Corpo do anunciante. Categoria de apostas ou bebida alcoólica (em qualquer caixa) responde
 * `AD_CATEGORY_FORBIDDEN` (RN-ADS-01, decisão 75), para o /super mostrar o motivo; o resto segue o
 * `VALIDATION_ERROR` do schema, que também não aceita essas categorias.
 */
export class AdvertiserBodyPipe<T extends z.ZodType>
  implements PipeTransform<unknown, z.output<T>>
{
  private readonly schema: ZodValidationPipe<T>;

  constructor(schema: T) {
    this.schema = new ZodValidationPipe(schema);
  }

  transform(value: unknown): z.output<T> {
    if (value && typeof value === 'object' && 'category' in value) {
      const category = value.category;
      if (typeof category === 'string' && FORBIDDEN.has(category.trim().toUpperCase())) {
        throw categoryForbidden();
      }
    }
    return this.schema.transform(value);
  }
}
