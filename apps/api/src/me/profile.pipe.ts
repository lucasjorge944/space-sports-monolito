import type { PipeTransform } from '@nestjs/common';
import {
  brazilianPhoneSchema,
  type UpdateProfile,
  updateProfileSchema,
} from '@space-sports/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { invalidPhoneNumber } from './me.errors.js';

/**
 * Corpo do PATCH /v1/me/profile. O telefone inválido (ou nulo: o telefone não pode ser apagado)
 * responde 400 `INVALID_PHONE_NUMBER`, como o cadastro por e-mail, para web e app tratarem o campo
 * do mesmo jeito nos dois fluxos; o resto segue o `VALIDATION_ERROR` do schema.
 */
export class UpdateProfilePipe implements PipeTransform<unknown, UpdateProfile> {
  private readonly schema = new ZodValidationPipe(updateProfileSchema);

  transform(value: unknown): UpdateProfile {
    if (value && typeof value === 'object' && 'phone' in value) {
      if (!brazilianPhoneSchema.safeParse(value.phone).success) throw invalidPhoneNumber();
    }
    return this.schema.transform(value);
  }
}
