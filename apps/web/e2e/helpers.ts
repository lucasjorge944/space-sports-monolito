import type { BrowserContext, Page } from '@playwright/test';

export const PASSWORD = 'senha-1234';
export const MOCK_API = 'http://localhost:3334';

export const users = {
  manager: 'gestora@exemplo.com',
  multi: 'multi@exemplo.com',
  super: 'super@exemplo.com',
  player: 'jogador@exemplo.com',
  teacher: 'professor@exemplo.com',
  /** Admin do espaço A (pagamento online: Dono x Admin). */
  admin: 'rafa.admin@exemplo.com',
  /** Conta antiga sem telefone: cai no completar cadastro (decisão 66). */
  legacy: 'antigo@exemplo.com',
  /** Primeiro login pelo Google: sem telefone nem senha. */
  google: 'google@exemplo.com',
  /** Dona do Espaço Exemplo C, fora da vitrine (sem preço/hora), com 2 avaliações. */
  outside: 'cris@exemplo.com',
} as const;

/** Abre a sessão direto pelo cookie (o valor é a chave do perfil na API simulada). */
export async function loginAs(context: BrowserContext, profile: keyof typeof users) {
  await context.addCookies([
    { name: 'space-sports.session_token', value: profile, url: 'http://localhost:3100' },
  ]);
}

export async function fillLogin(page: Page, email: string, password: string) {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

export async function mockCalls(request: import('@playwright/test').APIRequestContext) {
  const response = await request.get(`${MOCK_API}/__calls`);
  return (await response.json()) as { path: string; body: Record<string, unknown> }[];
}
