'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Client do Better Auth. Fala com a API pelo mesmo domínio do web (rewrite de `/v1` no Next), então
 * o cookie de sessão fica no domínio do web e o `proxy.ts` consegue enxergá-lo.
 */
export const authClient = createAuthClient({ basePath: '/v1/auth' });

type SignUpEmailInput = Parameters<typeof authClient.signUp.email>[0];

/**
 * Cadastro por e-mail com o telefone obrigatório em E.164 (decisão 64). `phone` não é campo do
 * usuário no Better Auth: só existe no corpo desta rota, lido pela API no hook de criação. Por isso
 * o tipo é estendido aqui, e não no client inteiro. A foto (`image`) não entra: vai por `/v1/me/avatar`.
 */
export function signUpWithPhone(input: Omit<SignUpEmailInput, 'image'> & { phone: string }) {
  return authClient.signUp.email(input as SignUpEmailInput);
}

/** URL absoluta no domínio do web: o Better Auth redireciona para ela a partir da API. */
export function webUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}
