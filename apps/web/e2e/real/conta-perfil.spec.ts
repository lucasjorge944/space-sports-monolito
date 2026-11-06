import { expect, type Page, test } from '@playwright/test';
import {
  apiAs,
  body,
  disposeClients,
  expectLanding,
  finishSignUp,
  LANDING_TIMEOUT_MS,
  linkIn,
  login,
  RUN,
  waitForMail,
} from './support/api';
import { PASSWORD, USERS, WEB } from './support/env';

// C.6 · Conta e perfil (decisões 64 a 71) contra a API real: cadastro com telefone e "Sobre você",
// conta sem telefone levada ao "completar cadastro", Meu perfil e convite de equipe com telefone.
// RF-AUTH-01, RF-AUTH-02, RN-AUTH-01. O upload real de foto fica fora: o ambiente de teste não tem
// storage (S3_BUCKET/S3_PUBLIC_URL), então a API responde 503 STORAGE_UNAVAILABLE (veja o último teste).
test.describe.configure({ mode: 'serial' });

/** Mesmo telefone nos dois cadastros: o digitado não é verificado e pode se repetir (decisão 64). */
const SHARED_PHONE_MASKED = '31977771111';
const SHARED_PHONE_E164 = '+5531977771111';

const FILLED = `conta.completa.${RUN}@exemplo.com`;
const SKIPPED = `conta.pulou.${RUN}@exemplo.com`;
const INVITED = `conta.convite.${RUN}@exemplo.com`;
const NO_PHONE_SUPER = 'super.semfone.e2e@exemplo.com';

type Me = {
  name: string;
  phone: string | null;
  phoneVerified: boolean;
  birthDate: string | null;
  gender: string | null;
  favoriteSports: { sport: { name: string }; level: string | null }[];
  profile: { missing: string[] };
};

test.afterAll(disposeClients);

/** `GET /v1/me` com a sessão da própria página (o web repassa `/v1` à API). */
async function meOf(page: Page) {
  const res = await page.request.get('/v1/me');
  expect(res.ok()).toBe(true);
  return (await res.json()) as Me;
}

async function fillAccountStep(page: Page, name: string, email: string, phone: string) {
  await page.goto('/cadastro');
  await page.getByLabel('Nome').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Telefone').fill(phone);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirmar senha').fill(PASSWORD);
}

test('RF-AUTH-01 (decisões 64 e 70): cadastro com telefone e "Sobre você" preenchido grava tudo, sem verificar o telefone', async ({
  page,
}) => {
  await fillAccountStep(page, 'Conta Completa', FILLED, SHARED_PHONE_MASKED);
  await page.getByRole('button', { name: 'Criar conta' }).click();

  await expect(page.getByRole('heading', { name: 'Sobre você' })).toBeVisible();
  // Recarregar não perde o passo: a conta já existe e a sessão está aberta.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sobre você' })).toBeVisible();

  // Nascimento futuro não passa; o fuso é o de Sao_Paulo (a regra é do Zod compartilhado).
  const birth = page.getByLabel('Data de nascimento');
  await birth.fill('01/01/2999');
  await expect(birth).toHaveAttribute('aria-invalid', 'true');
  await birth.fill('20/05/1990');
  await page.getByLabel('Gênero').selectOption({ label: 'Feminino' });
  await page.getByRole('button', { name: 'Futevôlei' }).click();
  await page.getByRole('button', { name: 'Beach Tennis' }).click();
  await page.getByLabel('Nível em Futevôlei').selectOption({ label: 'Avançado' });
  await page.getByRole('button', { name: 'Salvar e continuar' }).click();
  await expect(page).toHaveURL(/\/verificar-email/);

  const me = await meOf(page);
  expect(me).toMatchObject({
    name: 'Conta Completa',
    phone: SHARED_PHONE_E164,
    phoneVerified: false,
    birthDate: '1990-05-20',
    gender: 'FEMALE',
    profile: { missing: [] },
  });
  // Pelo nome do esporte; o nível é opcional.
  expect(me.favoriteSports.map((f) => [f.sport.name, f.level])).toEqual([
    ['Beach Tennis', null],
    ['Futevôlei', 'ADVANCED'],
  ]);
});

test('RF-AUTH-01 (decisão 70): "Pular" não grava nada, e o mesmo telefone pode ser digitado por outra conta (decisão 64)', async ({
  page,
}) => {
  await fillAccountStep(page, 'Conta Pulou', SKIPPED, SHARED_PHONE_MASKED);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Sobre você' })).toBeVisible();
  await page.getByRole('button', { name: 'Pular' }).click();
  await expect(page).toHaveURL(/\/verificar-email/);

  expect(await meOf(page)).toMatchObject({
    phone: SHARED_PHONE_E164,
    phoneVerified: false,
    birthDate: null,
    gender: null,
    favoriteSports: [],
    profile: { missing: [] },
  });
  // Nada é cobrado depois: o "completar cadastro" não retém a conta (quem não tem acesso a painel
  // segue para /sem-acesso, não para a etapa de dados).
  await page.goto('/completar-cadastro');
  await expect(page).not.toHaveURL(/\/completar-cadastro/);
});

test('RF-AUTH-01 (decisão 64): o cadastro não aceita telefone fora do padrão brasileiro, nem pela API', async ({
  page,
}) => {
  await fillAccountStep(page, 'Telefone Curto', `conta.curto.${RUN}@exemplo.com`, '3198888');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByLabel('Telefone')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/cadastro$/);

  // Pulando a validação do navegador, a API recusa do mesmo jeito.
  const res = await page.request.post('/v1/auth/sign-up/email', {
    headers: { Origin: WEB },
    data: {
      name: 'Sem Máscara',
      email: `conta.api.${RUN}@exemplo.com`,
      password: PASSWORD,
      phone: '(31) 97777-1111',
    },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.code).toBe('INVALID_PHONE_NUMBER');
});

test('RF-AUTH-01 (decisão 65): o login por telefone não existe na API', async ({ page }) => {
  for (const path of ['/v1/auth/phone-number/send-otp', '/v1/auth/phone-number/verify']) {
    const res = await page.request.post(path, {
      headers: { Origin: WEB },
      data: { phoneNumber: SHARED_PHONE_E164, code: '123456' },
    });
    expect(res.status(), path).toBe(404);
  }
  await page.goto('/entrar');
  await expect(page.getByRole('button', { name: /telefone/i })).toHaveCount(0);
});

test('decisão 66: conta sem telefone é levada ao "completar cadastro" antes do painel e só pede o que falta', async ({
  page,
}) => {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(NO_PHONE_SUPER);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/completar-cadastro/, { timeout: LANDING_TIMEOUT_MS });
  await expect(page.getByRole('heading', { name: 'Complete seu cadastro' })).toBeVisible();
  // O nome já existe: pede só o telefone. Sair continua disponível.
  await expect(page.getByLabel('Nome')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();

  // As outras rotas da área voltam para cá, guardando o destino.
  for (const path of ['/super', '/super/usuarios', '/super/perfil']) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/completar-cadastro\?next=/, {
      timeout: LANDING_TIMEOUT_MS,
    });
  }

  const phone = page.getByLabel('Telefone');
  await phone.fill('319');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(phone).toHaveAttribute('aria-invalid', 'true');
  expect((await meOf(page)).profile.missing).toEqual(['phone']);

  await phone.fill('31966662222');
  await page.getByRole('button', { name: 'Continuar' }).click();
  // Conta antiga, sem nada de "Sobre você": segue uma vez para a etapa, com "Pular".
  await expect(page.getByRole('heading', { name: 'Sobre você' })).toBeVisible({
    timeout: LANDING_TIMEOUT_MS,
  });
  await page.getByRole('button', { name: 'Pular' }).click();
  await expectLanding(page, /\/super\/usuarios$|\/super\/perfil$|\/super$/);

  expect(await meOf(page)).toMatchObject({
    phone: '+5531966662222',
    phoneVerified: false,
    profile: { missing: [] },
  });
  // Completo, a tela devolve à área.
  await page.goto('/completar-cadastro');
  await expect(page).toHaveURL(/\/super/);
});

test('RF-AUTH-02 (decisão 67): Meu perfil edita os campos, mostra o telefone como não verificado e persiste', async ({
  page,
}) => {
  // A conta que acabou de completar o cadastro (cada teste abre um contexto novo: entra de novo).
  await login(page, NO_PHONE_SUPER, /\/super$/);
  await page.goto('/super/perfil');
  await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible();
  await expect(page.getByLabel('Telefone')).toHaveValue('(31) 96666-2222');
  await expect(page.getByTestId('profile-email')).toHaveText(NO_PHONE_SUPER);
  await expect(page.getByText('Não verificado: não enviamos SMS', { exact: false })).toBeVisible();
  // Nada mudou: nada a salvar.
  await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();

  await page.getByLabel('Nome').fill('Super Editada');
  await page.getByLabel('Telefone').fill('31955554444');
  await page.getByLabel('Data de nascimento').fill('03/04/1985');
  await page.getByLabel('Gênero').selectOption({ label: 'Masculino' });
  await page.getByRole('button', { name: 'Futevôlei' }).click();
  await page.getByLabel('Nível em Futevôlei').selectOption({ label: 'Profissional' });
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Perfil atualizado.')).toBeVisible();

  expect(await meOf(page)).toMatchObject({
    name: 'Super Editada',
    phone: '+5531955554444',
    phoneVerified: false,
    birthDate: '1985-04-03',
    gender: 'MALE',
    favoriteSports: [{ sport: { name: 'Futevôlei' }, level: 'PRO' }],
  });

  // Persistiu: recarregar traz os valores salvos, e o nome novo aparece no menu da conta.
  await page.reload();
  await expect(page.getByLabel('Nome')).toHaveValue('Super Editada');
  await expect(page.getByLabel('Telefone')).toHaveValue('(31) 95555-4444');
  await expect(page.getByLabel('Data de nascimento')).toHaveValue('03/04/1985');
  await expect(page.getByLabel('Gênero')).toHaveValue('MALE');
  await expect(page.getByRole('button', { name: 'Futevôlei' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Nível em Futevôlei')).toHaveValue('PRO');
  await expect(page.getByTestId('user-menu')).toContainText('Super Editada');

  // Os opcionais podem ser apagados; o telefone e o nome continuam obrigatórios.
  await page.getByLabel('Data de nascimento').fill('');
  await page.getByRole('button', { name: 'Futevôlei' }).click();
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Perfil atualizado.')).toBeVisible();
  expect(await meOf(page)).toMatchObject({ birthDate: null, favoriteSports: [] });

  await page.getByLabel('Telefone').fill('');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByLabel('Telefone')).toHaveAttribute('aria-invalid', 'true');
  expect((await meOf(page)).phone).toBe('+5531955554444');
});

test('RF-AUTH-02: o perfil de quem gerencia um espaço abre em /painel/perfil com o e-mail só leitura e verificado', async ({
  page,
}) => {
  await login(page, USERS.owner, /\/painel$/);

  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: 'Meu perfil' }).click();
  await expect(page).toHaveURL(/\/painel\/perfil$/);
  await expect(page.getByLabel('Nome')).toHaveValue('Dono E2E');
  await expect(page.getByTestId('profile-email')).toHaveText(USERS.owner);
  await expect(page.getByText('Verificado', { exact: true })).toBeVisible();
  // A conta tem senha: o formulário de alterar senha aparece (diferente da conta só Google).
  await expect(page.getByLabel('Senha atual')).toBeVisible();
});

test('decisão 72: sem storage no ambiente de teste, enviar a foto responde STORAGE_UNAVAILABLE (lacuna: upload real)', async ({
  playwright,
}) => {
  const owner = await apiAs(playwright, USERS.owner);
  const res = await owner.post('/v1/me/avatar/uploads', { data: { contentType: 'image/png' } });
  expect(res.status()).toBe(503);
  expect((await body(res)).error.code).toBe('STORAGE_UNAVAILABLE');
  // Remover continua funcionando sem storage (idempotente).
  expect((await owner.delete('/v1/me/avatar')).status()).toBe(204);
});

test('RN-AUTH-03 (decisão 64): o cadastro que vem do convite de equipe também exige e grava o telefone', async ({
  page,
  playwright,
  request,
}) => {
  const owner = await apiAs(playwright, USERS.owner);
  const spaceId = (await body(await owner.get('/v1/me'))).memberships[0].space.id as string;
  const invite = await owner.post(`/v1/manage/spaces/${spaceId}/team/invites`, {
    data: { email: INVITED, role: 'TEACHER' },
  });
  expect(invite.ok(), `convite: ${invite.status()}`).toBe(true);
  const mail = await waitForMail(request, INVITED, /Convite para a equipe/);
  const token = linkIn(mail, '/convite/').split('/convite/')[1]?.split(/[?#]/)[0] ?? '';
  expect(token).not.toBe('');
  await page.goto(`/cadastro?next=${encodeURIComponent(`/convite/${token}`)}`);
  await expect(page.getByLabel('E-mail')).toHaveValue(INVITED);
  await expect(page.getByLabel('E-mail')).toHaveAttribute('readonly', '');
  await page.getByLabel('Nome').fill('Professora Convidada');
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirmar senha').fill(PASSWORD);

  // Sem telefone, o cadastro não segue.
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByLabel('Telefone')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/cadastro/);

  await finishSignUp(page);
  await expect(page).toHaveURL(/\/verificar-email/);
  expect(await meOf(page)).toMatchObject({
    phone: '+5531988880000',
    phoneVerified: false,
    profile: { missing: [] },
  });
});
