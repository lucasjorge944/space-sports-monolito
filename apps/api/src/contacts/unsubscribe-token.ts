import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const uuid = z.uuid();

const sign = (secret: string, contactId: string) =>
  createHmac('sha256', secret).update(`contact-unsubscribe:${contactId}`).digest('base64url');

/** Token do link de descadastro: sem prazo, pois vai em comunicações que ficam na caixa de entrada. */
export function unsubscribeToken(secret: string, contactId: string): string {
  return `${contactId}.${sign(secret, contactId)}`;
}

/** Id do contato, ou nulo se o token não foi assinado por nós. */
export function verifyUnsubscribeToken(secret: string, token: string): string | null {
  const [contactId, signature, ...rest] = token.split('.');
  if (!contactId || !signature || rest.length || !uuid.safeParse(contactId).success) return null;
  const expected = Buffer.from(sign(secret, contactId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? contactId : null;
}
