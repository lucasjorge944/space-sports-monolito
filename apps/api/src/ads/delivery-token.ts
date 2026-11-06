import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { type AdPlacement, adPlacementSchema } from '@space-sports/shared';
import { z } from 'zod';

/** Validade do token de entrega (RF-ADS-07). */
export const DELIVERY_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/** O que o token prova: esta entrega (id aleatório) desta peça, campanha e vaga, até `expiresAt`. */
export type DeliveryClaims = {
  deliveryId: string;
  creativeId: string;
  campaignId: string;
  placement: AdPlacement;
  expiresAt: Date;
};

/** Campos curtos: o token vai em cada evento do app. `e` em segundos (Unix). */
const payloadSchema = z
  .object({
    v: z.literal(1),
    d: z.uuid(),
    c: z.uuid(),
    k: z.uuid(),
    p: adPlacementSchema,
    e: z.number().int().positive(),
  })
  .strict();

const mac = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest();

/**
 * Tokens de entrega dos anúncios (RN-ADS-04): `<payload base64url>.<HMAC-SHA256 base64url>`, com a
 * chave de ADS_DELIVERY_SECRET. Não guarda nada de quem recebeu o anúncio: o id da entrega é
 * aleatório e só serve para contar cada token no máximo uma vez por tipo de evento.
 */
export class DeliveryTokens {
  constructor(private readonly secret: string) {}

  sign(
    claims: Omit<DeliveryClaims, 'deliveryId' | 'expiresAt'>,
    now: Date = new Date(),
  ): { token: string; claims: DeliveryClaims } {
    const expiresAt = new Date(Math.floor((now.getTime() + DELIVERY_TOKEN_TTL_MS) / 1000) * 1000);
    const full: DeliveryClaims = { ...claims, deliveryId: randomUUID(), expiresAt };
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        d: full.deliveryId,
        c: full.creativeId,
        k: full.campaignId,
        p: full.placement,
        e: expiresAt.getTime() / 1000,
      }),
    ).toString('base64url');
    return { token: `${payload}.${mac(this.secret, payload).toString('base64url')}`, claims: full };
  }

  /** As claims do token, ou `null` se a assinatura não confere, o formato é inválido ou venceu. */
  verify(token: string, now: Date = new Date()): DeliveryClaims | null {
    const [payload, signature, ...rest] = token.split('.');
    if (!payload || !signature || rest.length) return null;
    // Compara o texto base64url, não os bytes decodificados: o decodificador do Node ignora os bits
    // que sobram no último caractere, `=` e caracteres fora do alfabeto, então variações da mesma
    // assinatura (ex.: trocar `A` por `B` no fim) passariam. Só a forma exata que `sign` gera vale.
    const expected = Buffer.from(mac(this.secret, payload).toString('base64url'));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    let parsed: z.infer<typeof payloadSchema>;
    try {
      parsed = payloadSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    } catch {
      return null;
    }
    const expiresAt = new Date(parsed.e * 1000);
    if (expiresAt.getTime() <= now.getTime()) return null;
    return {
      deliveryId: parsed.d,
      creativeId: parsed.c,
      campaignId: parsed.k,
      placement: parsed.p,
      expiresAt,
    };
  }
}
