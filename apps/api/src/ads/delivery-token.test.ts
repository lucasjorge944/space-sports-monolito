import { describe, expect, it } from 'vitest';
import { DELIVERY_TOKEN_TTL_MS, DeliveryTokens } from './delivery-token.js';

const claims = {
  creativeId: '0190d1a4-0000-7000-8000-000000000001',
  campaignId: '0190d1a4-0000-7000-8000-000000000002',
  placement: 'EXPLORE_HERO' as const,
};
const now = new Date('2026-11-03T12:00:00.000Z');

describe('DeliveryTokens', () => {
  const tokens = new DeliveryTokens('s'.repeat(32));

  it('assina e confere, com um id de entrega novo por token', () => {
    const a = tokens.sign(claims, now);
    const b = tokens.sign(claims, now);
    expect(a.claims.deliveryId).not.toBe(b.claims.deliveryId);
    expect(a.claims.expiresAt.getTime()).toBe(now.getTime() + DELIVERY_TOKEN_TTL_MS);
    expect(tokens.verify(a.token, now)).toEqual(a.claims);
  });

  it('vence em 2 horas', () => {
    const { token } = tokens.sign(claims, now);
    const almost = new Date(now.getTime() + DELIVERY_TOKEN_TTL_MS - 1000);
    expect(tokens.verify(token, almost)).not.toBeNull();
    expect(tokens.verify(token, new Date(now.getTime() + DELIVERY_TOKEN_TTL_MS))).toBeNull();
  });

  it('recusa token adulterado, de outra chave ou malformado', () => {
    const { token } = tokens.sign(claims, now);
    const [payload, signature] = token.split('.') as [string, string];
    const forged = Buffer.from(
      Buffer.from(payload, 'base64url')
        .toString('utf8')
        .replace(claims.creativeId, '0190d1a4-0000-7000-8000-000000000009'),
    ).toString('base64url');
    expect(tokens.verify(`${forged}.${signature}`, now)).toBeNull();
    expect(new DeliveryTokens('o'.repeat(32)).verify(token, now)).toBeNull();
    expect(tokens.verify(`${token}.x`, now)).toBeNull();
    expect(tokens.verify('abc', now)).toBeNull();
    expect(tokens.verify(`${payload}.`, now)).toBeNull();
  });

  it('recusa outra grafia base64url da mesma assinatura (bits finais, padding, caracteres soltos)', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let i = 0; i < 20; i++) {
      const { token } = tokens.sign(claims, now);
      const [payload, signature] = token.split('.') as [string, string];
      // HMAC-SHA256 tem 32 bytes = 43 caracteres: os 2 bits finais do último não carregam dado.
      const last = alphabet.indexOf(signature.at(-1) as string);
      const variants = [1, 2, 3].map((bits) => `${signature.slice(0, -1)}${alphabet[last ^ bits]}`);
      variants.push(`${signature}=`, `${signature.slice(0, 10)}!${signature.slice(10)}`);
      for (const variant of variants) {
        // O Node decodifica todas para os mesmos bytes; o token tem que cair mesmo assim.
        expect(Buffer.from(variant, 'base64url')).toEqual(Buffer.from(signature, 'base64url'));
        expect(tokens.verify(`${payload}.${variant}`, now), variant).toBeNull();
      }
      expect(tokens.verify(token, now)).not.toBeNull();
    }
  });
});
