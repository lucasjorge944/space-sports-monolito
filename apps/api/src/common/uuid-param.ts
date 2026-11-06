import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

/** Parâmetro de rota uuid; malformado responde 400 `VALIDATION_ERROR`. */
export const uuidParam = new ZodValidationPipe(z.uuid());
