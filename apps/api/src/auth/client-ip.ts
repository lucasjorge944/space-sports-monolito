import { getIP } from '@better-auth/core/utils/ip';
import type { Request } from 'express';
import type { Auth } from './auth.js';

/** O IP do cliente como o rate limit do Better Auth o vê (proxies confiáveis do .env). */
export function clientIp(auth: Auth, req: Request): string {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  // Só a configuração de IP: o tipo das opções completas vem de outra cópia do @better-auth/core.
  const options = { advanced: { ipAddress: auth.options.advanced?.ipAddress } };
  return getIP(headers, options as Parameters<typeof getIP>[1]) ?? 'unknown';
}
