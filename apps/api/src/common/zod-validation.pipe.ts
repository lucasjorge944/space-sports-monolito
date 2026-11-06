import type { PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/**
 * Valida a entrada com um schema Zod (de preferência vindo de @space-sports/shared).
 * O ZodError lançado é convertido em 400 VALIDATION_ERROR pelo AllExceptionsFilter.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    return this.schema.parse(value);
  }
}

/** Corpo opcional: requisição sem corpo vale como `{}` (para schemas com todos os campos opcionais). */
export const optionalBody = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => value ?? {}, schema) as unknown as T;
