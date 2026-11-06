import {
  type APIRequestContext,
  expect,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test';
import { API, MAILPIT, PASSWORD, WEB } from './env';

// biome-ignore lint/suspicious/noExplicitAny: corpos JSON da API lidos só nas asserções
export type Json = Record<string, any>;
type Playwright = PlaywrightWorkerArgs['playwright'];

const clients: APIRequestContext[] = [];

/** Fecha os contextos abertos por `apiAs`/`anonymous`/`signUpByApi` (chame no `afterAll`). */
export async function disposeClients() {
  await Promise.all(clients.splice(0).map((client) => client.dispose()));
}

/** Contexto de API sem sessão; o `Origin` é exigido pelo Better Auth nas rotas de auth. */
export async function anonymous(playwright: Playwright) {
  const ctx = await playwright.request.newContext({
    baseURL: API,
    extraHTTPHeaders: { Origin: WEB },
  });
  clients.push(ctx);
  return ctx;
}

/** Login por request (cookie de sessão no contexto). */
export async function apiAs(playwright: Playwright, email: string, password = PASSWORD) {
  const ctx = await anonymous(playwright);
  const res = await ctx.post('/v1/auth/sign-in/email', { data: { email, password } });
  expect(res.ok(), `login de ${email}: ${res.status()}`).toBe(true);
  return ctx;
}

/**
 * Telefone dos cadastros dos testes (decisão 64: obrigatório, sem verificação). Pode se repetir
 * entre contas: não verificado, não prova identidade nem vincula contatos.
 */
export const SIGN_UP_PHONE = '+5531988880000';

/** Cadastro por request: abre a sessão, mas o e-mail só vale depois do link enviado por e-mail. */
export async function signUpByApi(playwright: Playwright, email: string, name: string) {
  const ctx = await anonymous(playwright);
  const res = await ctx.post('/v1/auth/sign-up/email', {
    data: { email, name, password: PASSWORD, phone: SIGN_UP_PHONE },
  });
  expect(res.ok(), `cadastro de ${email}: ${res.status()}`).toBe(true);
  return ctx;
}

export async function body(res: { json(): Promise<unknown> }) {
  return (await res.json()) as Json;
}

/** Corpo de erro da API: `{ error: { code, message, details } }`. */
export async function errorOf(res: { json(): Promise<unknown> }) {
  return (await body(res)).error as Json;
}

/**
 * Termina o cadastro pela tela: telefone, "Criar conta" e "Pular" na etapa "Sobre você" (decisão
 * 70). Nome, e-mail e senhas já preenchidos por quem chama.
 */
export async function finishSignUp(page: Page) {
  await page.getByLabel('Telefone').fill('31988880000');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Sobre você' })).toBeVisible();
  await page.getByRole('button', { name: 'Pular' }).click();
}

/** Login pela tela `/entrar`. */
export async function login(page: Page, email: string, landing: RegExp = /\/(painel|super)$/) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expectLanding(page, landing);
}

/**
 * Espera a navegação que cai numa rota do painel depois de um clique (login, aceite de convite).
 * O web roda em `next dev`: a primeira visita a uma rota compila a rota na hora (/painel leva ~4 s
 * com 1 CPU, mais no runner do CI), bem acima dos 5 s padrão do `expect`. O prazo maior vale só
 * aqui, onde a navegação é a espera esperada; o resto dos `expect` segue com o prazo padrão.
 */
export const LANDING_TIMEOUT_MS = 30_000;
export async function expectLanding(page: Page, landing: RegExp) {
  await expect(page).toHaveURL(landing, { timeout: LANDING_TIMEOUT_MS });
}

/** Escolhe uma opção de um Select (Radix) pelo id do gatilho. */
export async function pick(page: Page, triggerId: string, option: string) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Data (AAAA-MM-DD) de hoje em America/Sao_Paulo, mais `days` dias. */
export function localDate(days = 0) {
  const target = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(target);
}

/** Próxima data (a partir de `fromDays` dias) que cai em `weekday` (0 = domingo). */
export function nextWeekday(weekday: number, fromDays = 1) {
  for (let days = fromDays; days < fromDays + 7; days++) {
    const date = localDate(days);
    if (new Date(`${date}T12:00:00Z`).getUTCDay() === weekday) return date;
  }
  throw new Error('Sem a data do dia da semana.');
}

/** Instante UTC de `HH:MM` locais (America/Sao_Paulo, UTC-3 o ano todo) em `date`. */
export function saoPauloInstant(date: string, time: string) {
  return new Date(`${date}T${time}:00-03:00`);
}

/** Sufixo único da execução: e-mails e nomes não colidem com o que o Mailpit guardou antes. */
export const RUN = Date.now().toString(36);

type MailSummary = { ID: string; Subject: string; Created: string };

/**
 * Espera chegar um e-mail para `to` cujo assunto bate com `subject` e devolve o texto. O Mailpit é
 * compartilhado entre execuções, por isso o destinatário é sempre único (`RUN`).
 */
export async function waitForMail(
  request: APIRequestContext,
  to: string,
  subject: RegExp,
  {
    since = new Date(Date.now() - 60_000),
    timeoutMs = 15_000,
  }: { since?: Date; timeoutMs?: number } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await request.get(`${MAILPIT}/api/v1/search`, {
      params: { query: `to:"${to}"` },
    });
    if (list.ok()) {
      const { messages } = (await list.json()) as { messages: MailSummary[] };
      const found = messages.find((m) => subject.test(m.Subject) && new Date(m.Created) >= since);
      if (found) {
        const message = await request.get(`${MAILPIT}/api/v1/message/${found.ID}`);
        const detail = (await message.json()) as { Text: string; HTML: string };
        return { subject: found.Subject, text: detail.Text, html: detail.HTML };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Nenhum e-mail "${subject}" para ${to} em ${timeoutMs} ms.`);
}

/** Primeiro link do e-mail que contém `part`. */
export function linkIn(mail: { text: string; html: string }, part: string) {
  const source = `${mail.text}\n${mail.html}`;
  const match = new RegExp(`https?://[^\\s"'<>)]*${part}[^\\s"'<>)]*`).exec(source);
  if (!match) throw new Error(`Sem link com "${part}" no e-mail.`);
  return match[0].replaceAll('&amp;', '&');
}

/** Quadras do espaço e o esporte do seed (futevôlei), para criar turmas pela API. */
export async function courtsAndSport(owner: APIRequestContext, spaceId: string) {
  const courts = await body(await owner.get(`/v1/manage/spaces/${spaceId}/courts`));
  const groups = await body(await owner.get(`/v1/manage/spaces/${spaceId}/class-groups`));
  const sportId = groups.items[0].sport.id as string;
  return {
    sportId,
    court: (name: string) =>
      courts.items.find((c: { name: string }) => c.name === name).id as string,
  };
}

/** Professores do espaço por nome → `memberId` (o que a API pede em `teacherMemberIds`). */
export async function teacherIds(owner: APIRequestContext, spaceId: string) {
  const { items } = await body(await owner.get(`/v1/manage/spaces/${spaceId}/teachers`));
  return (name: string) => {
    const found = items.find((t: { name: string }) => t.name === name);
    if (!found) throw new Error(`Professor "${name}" não encontrado.`);
    return found.memberId as string;
  };
}
