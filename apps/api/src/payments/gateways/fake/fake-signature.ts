import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header da assinatura dos webhooks do fake: `t=<unix s>,v1=<hex HMAC-SHA256 de "t.corpo">`. */
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';
/** Tolerância do carimbo de tempo (contra reenvio de um webhook antigo). */
export const FAKE_SIGNATURE_TOLERANCE_S = 300;

export function signFakeWebhook(secret: string, body: string, now: Date = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/** Confere assinatura e janela de tempo; comparação em tempo constante. */
export function verifyFakeWebhook(
  secret: string,
  header: string | undefined,
  rawBody: Buffer,
  now: Date = new Date(),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || typeof v1 !== 'string' || !/^[0-9a-f]{64}$/.test(v1)) return false;
  if (Math.abs(now.getTime() / 1000 - t) > FAKE_SIGNATURE_TOLERANCE_S) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(v1, 'hex'));
}
