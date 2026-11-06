import { expect, test } from '@playwright/test';
import { anonymous, apiAs, body, disposeClients, errorOf, login } from './support/api';
import { USERS } from './support/env';

// Decisão 52 (A.1 e A.7): busca de endereço por CEP com ViaCEP e BrasilAPI de reserva. Os dois
// provedores são simulados dentro do processo da API (support/cep-fetch-stub.mjs), então o teste
// roda sem rede e prova o fallback de verdade: ViaCEP fora do ar, lento demais, com corpo inválido.
// O comportamento vem dos três últimos dígitos do CEP; o prefixo muda a cada execução porque a API
// guarda o resultado de cada CEP no Redis por 30 dias.
test.describe.configure({ mode: 'serial' });

const prefix = String(Date.now() % 100_000).padStart(5, '0');
const cep = (suffix: string) => `${prefix}${suffix}`;

test.afterAll(disposeClients);

test('decisão 52: ViaCEP responde — o endereço vem dele', async ({ playwright }) => {
  const owner = await apiAs(playwright, USERS.owner);
  const res = await owner.get(`/v1/address/cep/${cep('111')}`);
  expect(res.status()).toBe(200);
  expect(await body(res)).toEqual({
    postalCode: cep('111'),
    street: 'Rua ViaCEP',
    neighborhood: 'Bairro ViaCEP',
    city: 'Belo Horizonte',
    state: 'MG',
  });
});

test('decisão 52: ViaCEP fora do ar, em silêncio, lento ou inválido — cai para a BrasilAPI', async ({
  playwright,
}) => {
  const owner = await apiAs(playwright, USERS.owner);
  // 222: 503. 333: 200 com corpo que não é um endereço. 444: nunca responde (timeout de 2,5 s da API).
  for (const suffix of ['222', '333', '444']) {
    const started = Date.now();
    const res = await owner.get(`/v1/address/cep/${cep(suffix)}`);
    expect(res.status(), `CEP ...${suffix}`).toBe(200);
    expect(await body(res), `CEP ...${suffix}`).toMatchObject({
      street: 'Rua BrasilAPI',
      neighborhood: 'Bairro BrasilAPI',
      city: 'Belo Horizonte',
    });
    // A espera pelo ViaCEP é curta: nenhum provedor deixa o formulário pendurado.
    expect(Date.now() - started, `CEP ...${suffix}`).toBeLessThan(6_000);
  }
});

test('decisão 52: CEP com hífen é normalizado; inválido é 422; inexistente é 404', async ({
  playwright,
}) => {
  const owner = await apiAs(playwright, USERS.owner);
  const dashed = await owner.get(`/v1/address/cep/${prefix.slice(0, 5)}-111`);
  expect(dashed.status()).toBe(200);
  expect((await body(dashed)).postalCode).toBe(cep('111'));

  const invalid = await owner.get('/v1/address/cep/1234');
  expect(invalid.status()).toBe(422);
  expect((await errorOf(invalid)).code).toBe('CEP_INVALID');

  // 555: o ViaCEP diz que não existe. 666: ViaCEP fora do ar e a BrasilAPI diz 404.
  for (const suffix of ['555', '666']) {
    const res = await owner.get(`/v1/address/cep/${cep(suffix)}`);
    expect(res.status(), `CEP ...${suffix}`).toBe(404);
    expect((await errorOf(res)).code).toBe('CEP_NOT_FOUND');
  }
});

test('decisão 52: com os dois provedores fora do ar a API responde 503 CEP_LOOKUP_UNAVAILABLE em toda tentativa', async ({
  playwright,
}) => {
  const owner = await apiAs(playwright, USERS.owner);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await owner.get(`/v1/address/cep/${cep('999')}`);
    expect(res.status()).toBe(503);
    expect((await errorOf(res)).code).toBe('CEP_LOOKUP_UNAVAILABLE');
  }
});

test('decisão 52: a busca exige login', async ({ playwright }) => {
  const ctx = await anonymous(playwright);
  const res = await ctx.get(`/v1/address/cep/${cep('111')}`);
  expect(res.status()).toBe(401);
});

test('decisão 52 / A.7: no painel, o CEP preenche rua e bairro e o foco vai para o número', async ({
  page,
}) => {
  await login(page, USERS.owner);
  await page.goto('/painel/espaco');
  await page.getByLabel('CEP').fill('');
  await page.getByLabel('Rua', { exact: true }).fill('');
  await page.getByLabel('Bairro').fill('');

  // ViaCEP responde.
  await page.getByLabel('CEP').pressSequentially(cep('111'));
  await expect(page.getByLabel('Rua', { exact: true })).toHaveValue('Rua ViaCEP');
  await expect(page.getByLabel('Bairro')).toHaveValue('Bairro ViaCEP');
  await expect(page.getByLabel('Número')).toBeFocused();
  await expect(page.getByText('Endereço preenchido pelo CEP')).toBeVisible();
});

test('decisão 52 / A.7: no painel, ViaCEP fora do ar — o endereço vem da BrasilAPI', async ({
  page,
}) => {
  await login(page, USERS.owner);
  await page.goto('/painel/espaco');
  await page.getByLabel('CEP').fill('');
  await page.getByLabel('Rua', { exact: true }).fill('');
  await page.getByLabel('CEP').pressSequentially(cep('222'));
  await expect(page.getByLabel('Rua', { exact: true })).toHaveValue('Rua BrasilAPI');
  await expect(page.getByLabel('Bairro')).toHaveValue('Bairro BrasilAPI');
});

test('decisão 52 / A.7: cidade que o app não lista — avisa e deixa escolher; os campos seguem editáveis', async ({
  page,
}) => {
  await login(page, USERS.owner);
  await page.goto('/painel/espaco');
  await page.getByLabel('CEP').fill('');
  await page.getByLabel('CEP').pressSequentially(cep('777'));
  await expect(page.getByLabel('Rua', { exact: true })).toHaveValue('Rua BrasilAPI');
  await expect(page.getByText('Sabará - MG não está na lista. Escolha a cidade')).toBeVisible();
  await expect(page.getByLabel('Rua', { exact: true })).toBeEditable();
});

test('decisão 52 / A.7: provedores fora do ar nunca travam o formulário — preenche à mão e salva', async ({
  page,
  playwright,
}) => {
  await login(page, USERS.owner);
  await page.goto('/painel/espaco');
  await page.getByLabel('CEP').fill('');
  await page.getByLabel('Rua', { exact: true }).fill('');
  await page.getByLabel('Número').fill('');
  await page.getByLabel('Bairro').fill('');

  await page.getByLabel('CEP').pressSequentially(cep('999'));
  await expect(page.getByText('Não foi possível buscar o CEP. Preencha à mão')).toBeVisible();

  await page.getByLabel('Rua', { exact: true }).fill('Rua Manual');
  await page.getByLabel('Número').fill('123');
  await page.getByLabel('Bairro').fill('Centro');
  await page.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(page.getByText('Dados do espaço salvos.')).toBeVisible();

  const owner = await apiAs(playwright, USERS.owner);
  const me = await body(await owner.get('/v1/me'));
  const spaceId = me.memberships[0].space.id;
  const space = await body(await owner.get(`/v1/manage/spaces/${spaceId}`));
  expect(space.address).toMatchObject({
    street: 'Rua Manual',
    number: '123',
    neighborhood: 'Centro',
    postalCode: cep('999'),
  });
});

test('decisão 52 / A.7: CEP inexistente avisa e deixa preencher à mão', async ({ page }) => {
  await login(page, USERS.owner);
  await page.goto('/painel/espaco');
  await page.getByLabel('CEP').fill('');
  await page.getByLabel('CEP').pressSequentially(cep('555'));
  await expect(page.getByText('CEP não encontrado. Preencha à mão')).toBeVisible();
});
