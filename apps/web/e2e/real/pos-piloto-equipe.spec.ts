import { expect, test } from '@playwright/test';
import {
  anonymous,
  apiAs,
  body,
  disposeClients,
  errorOf,
  expectLanding,
  finishSignUp,
  linkIn,
  login,
  pick,
  RUN,
  signUpByApi,
  waitForMail,
} from './support/api';
import { API, PASSWORD, USERS, WEB } from './support/env';

// A.1 (4) e decisão 46: o papel Recepção deixou de existir; o convite de equipe é do e-mail
// convidado (travado na tela e recusado para qualquer outro). Cobre RN-AUTH-01/03 e RF-NOTIF-02,
// com o e-mail real passando pelo Mailpit.
test.describe.configure({ mode: 'serial' });

const INVITED = `equipe.${RUN}@exemplo.com`;
const MIXED_CASE = `Misto.${RUN}@Exemplo.COM`;
const OUTSIDER = `de.fora.${RUN}@exemplo.com`;

const state = {} as { spaceId: string; token: string; mixedToken: string };

const tokenOf = (url: string) => url.split('/convite/')[1]?.split(/[?#]/)[0] ?? '';

test.afterAll(disposeClients);

test.beforeAll(async ({ playwright }) => {
  const owner = await apiAs(playwright, USERS.owner);
  state.spaceId = (await body(await owner.get('/v1/me'))).memberships[0].space.id;
});

test('decisão 46: não existe papel Recepção — nem na API, nem no convite, nem na tela de papéis', async ({
  page,
  playwright,
}) => {
  // O contrato publicado (OpenAPI) não cita o papel em lugar nenhum.
  const doc = await (await anonymous(playwright)).get('/docs-json');
  expect(doc.ok()).toBe(true);
  expect(JSON.stringify(await doc.json()).toUpperCase()).not.toContain('RECEPTION');

  const owner = await apiAs(playwright, USERS.owner);
  const team = `/v1/manage/spaces/${state.spaceId}/team`;
  // Convidar como RECEPTION é recusado já na validação do corpo.
  const invite = await owner.post(`${team}/invites`, {
    data: { email: `recepcao.${RUN}@exemplo.com`, role: 'RECEPTION' },
  });
  expect(invite.status()).toBe(400);
  // E trocar os papéis de quem já está na equipe também.
  const teacherId = (await body(await owner.get(team))).members.find(
    (m: { email: string }) => m.email === USERS.teacher,
  ).userId;
  const roles = await owner.put(`${team}/members/${teacherId}/roles`, {
    data: { roles: ['RECEPTION'] },
  });
  expect(roles.status()).toBe(400);

  // Na tela: o convite oferece só Admin e Professor...
  await login(page, USERS.owner);
  await page.goto('/painel/equipe');
  await page.getByRole('button', { name: 'Convidar' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#invite-role').click();
  await expect(page.getByRole('option')).toHaveText(['Admin', 'Professor']);
  await expect(page.getByRole('option', { name: /recep/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('option').first()).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // ...e a edição de papéis também.
  await page.getByRole('button', { name: 'Alterar papéis de Professor E2E' }).click();
  const rolesDialog = page.getByRole('dialog');
  await expect(rolesDialog.getByRole('checkbox')).toHaveCount(2);
  await expect(rolesDialog.getByLabel('Admin')).toBeVisible();
  await expect(rolesDialog.getByLabel('Professor')).toBeVisible();
  await expect(rolesDialog.getByText(/recep/i)).toHaveCount(0);
});

test('RF-NOTIF-02 / RN-AUTH-03: a gestão convida pela tela e o e-mail chega com o link do convite', async ({
  page,
  request,
}) => {
  await login(page, USERS.owner);
  await page.goto('/painel/equipe');
  await page.getByRole('button', { name: 'Convidar' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('E-mail').fill(INVITED);
  await pick(page, 'invite-role', 'Professor');
  await dialog.getByRole('button', { name: /Enviar convite/ }).click();
  await expect(page.getByText('Convite enviado por e-mail.')).toBeVisible();
  await expect(page.getByText(INVITED)).toBeVisible();

  const mail = await waitForMail(request, INVITED, /Convite para a equipe/);
  const link = linkIn(mail, '/convite/');
  expect(link.startsWith(WEB)).toBe(true);
  state.token = tokenOf(link);
  expect(state.token).not.toBe('');
});

test('RN-AUTH-03: a prévia do convite mostra o e-mail convidado e que ainda não há conta', async ({
  playwright,
}) => {
  const anon = await anonymous(playwright);
  const preview = await body(await anon.get(`/v1/staff-invites/${state.token}`));
  expect(preview).toMatchObject({ email: INVITED, role: 'TEACHER', hasAccount: false });
  expect(preview.space.name).toBe('Arena E2E');
});

test('RN-AUTH-03: outro e-mail não aceita — conta de outra pessoa (verificada) e cadastro novo', async ({
  page,
  playwright,
}) => {
  const accept = `/v1/staff-invites/${state.token}/accept`;

  // Conta existente e verificada, mas de outro e-mail: 403 STAFF_INVITE_EMAIL_MISMATCH.
  const player = await apiAs(playwright, USERS.player);
  const mismatch = await player.post(accept);
  expect(mismatch.status()).toBe(403);
  expect((await errorOf(mismatch)).code).toBe('STAFF_INVITE_EMAIL_MISMATCH');

  // Cadastro novo com outro e-mail (ainda sem verificar): o e-mail errado vem antes de tudo.
  const outsider = await signUpByApi(playwright, OUTSIDER, 'Pessoa de Fora');
  const outsiderTry = await outsider.post(accept);
  expect(outsiderTry.status()).toBe(403);
  expect((await errorOf(outsiderTry)).code).toBe('STAFF_INVITE_EMAIL_MISMATCH');
  const members = await body(
    await (await apiAs(playwright, USERS.owner)).get(`/v1/manage/spaces/${state.spaceId}/team`),
  );
  expect(members.members.map((m: { email: string }) => m.email)).not.toContain(OUTSIDER);

  // Na tela: quem está logado com outra conta vê o aviso e só pode trocar de conta, sem "Aceitar".
  await login(page, USERS.player, /\/sem-acesso$/);
  await page.goto(`/convite/${state.token}`);
  await expect(page.getByText(INVITED, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(`o convite é para ${INVITED}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trocar de conta' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aceitar convite' })).toHaveCount(0);
});

test('RN-AUTH-03: o cadastro pelo convite trava o e-mail; só com o e-mail verificado o aceite entra', async ({
  page,
  playwright,
  request,
}) => {
  // Visitante sem conta abre o link: a página manda criar a conta com o e-mail do convite.
  await page.goto(`/convite/${state.token}`);
  await expect(page.getByText(INVITED).first()).toBeVisible();
  await page.getByRole('link', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/cadastro\?next=/);

  // O e-mail vem da prévia da API e não pode ser trocado.
  const email = page.getByLabel('E-mail');
  await expect(email).toHaveValue(INVITED);
  await expect(email).toHaveAttribute('readonly', '');
  await expect(page.getByText('E-mail do convite. Ele não pode ser trocado aqui.')).toBeVisible();

  await page.getByLabel('Nome').fill('Pessoa da Equipe');
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirmar senha').fill(PASSWORD);
  await finishSignUp(page);
  await expect(page).toHaveURL(/\/verificar-email/);

  // Cadastrada, mas sem verificar o e-mail: o aceite é recusado (422 EMAIL_NOT_VERIFIED).
  const early = await page.request.post(`/v1/staff-invites/${state.token}/accept`);
  expect(early.status()).toBe(422);
  expect((await errorOf(early)).code).toBe('EMAIL_NOT_VERIFIED');

  // O link de verificação do e-mail confirma e volta para o convite.
  const mail = await waitForMail(request, INVITED, /Confirme seu e-mail/);
  await page.goto(linkIn(mail, '/v1/auth/verify-email'));
  await expect(page.getByRole('heading', { name: 'E-mail confirmado' })).toBeVisible();
  await page.getByRole('link', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(new RegExp(`/convite/${state.token}`));

  await page.getByRole('button', { name: 'Aceitar convite' }).click();
  await expectLanding(page, /\/painel$/);
  await expect(page.getByTestId('space-switcher')).toContainText('Arena E2E');

  // O vínculo é o papel do convite, e só ele.
  const invited = await apiAs(playwright, INVITED);
  const me = await body(await invited.get('/v1/me'));
  const membership = me.memberships.find(
    (m: { space: { id: string } }) => m.space.id === state.spaceId,
  );
  expect(membership.roles).toEqual(['TEACHER']);
  // Repetir o aceite não muda nada (idempotente).
  expect((await invited.post(`/v1/staff-invites/${state.token}/accept`)).status()).toBe(200);
});

test('RN-AUTH-03: o e-mail do convite vale sem diferenciar maiúsculas', async ({
  playwright,
  request,
}) => {
  const owner = await apiAs(playwright, USERS.owner);
  const res = await owner.post(`/v1/manage/spaces/${state.spaceId}/team/invites`, {
    data: { email: MIXED_CASE, role: 'ADMIN' },
  });
  expect(res.status()).toBe(201);
  const mail = await waitForMail(request, MIXED_CASE.toLowerCase(), /Convite para a equipe/);
  state.mixedToken = tokenOf(linkIn(mail, '/convite/'));

  // A conta se cadastra em minúsculas; o convite foi escrito com maiúsculas.
  const mixed = await signUpByApi(playwright, MIXED_CASE.toLowerCase(), 'Pessoa Mista');
  const verification = await waitForMail(request, MIXED_CASE.toLowerCase(), /Confirme seu e-mail/);
  const verify = await mixed.get(linkIn(verification, '/v1/auth/verify-email').replace(WEB, API), {
    maxRedirects: 0,
  });
  expect([200, 302]).toContain(verify.status());

  const accepted = await mixed.post(`/v1/staff-invites/${state.mixedToken}/accept`);
  expect(accepted.status(), JSON.stringify(await accepted.json().catch(() => ({})))).toBe(200);
  expect((await body(accepted)).roles).toEqual(['ADMIN']);
});
