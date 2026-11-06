import type { PipeTransform } from '@nestjs/common';
import { z } from 'zod';

const uuid = z.uuid();

/** Parâmetro de rota uuid; malformado responde como "não encontrado" (sem erro do Postgres). */
export class UuidParamPipe implements PipeTransform<string, string> {
  constructor(private readonly notFound: () => Error) {}

  transform(value: string): string {
    if (!uuid.safeParse(value).success) throw this.notFound();
    return value;
  }
}
