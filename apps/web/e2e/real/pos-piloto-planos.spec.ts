import { expect, test } from '@playwright/test';
import { apiAs, body, disposeClients, errorOf, type Json, localDate, login } from './support/api';
import { USERS } from './support/env';

// A.3 e decisão 45: o cancelamento do plano de aula mantém o acesso até o fim do último mês pago
// (ou dispensado) e termina no ato quando não há mês pago; a pausa deixou de existir (RN-CLASS-07/08).
// Dados: "Arena E2E Norte", com alunos ativos desde o dia 1 e a mensalidade do mês corrente em
// aberto, vencendo no último dia do mês (apps/api/test/e2e-seed), para valer em qualquer dia do mês.
test.describe.configure({ mode: 'serial' });

const TODAY = localDate();
const MONTH_START = `${TODAY.slice(0, 8)}01`;
const MONTH_END = (() => {
  const [year = 0, month = 0] = TODAY.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
})();
/** `2026-10-31` → `31/10/2026`. */
const br = (date: string) => date.split('-').reverse().join('/');

const state = {} as {
  spaceId: string;
  paid: string;
  unpaid: string;
  late: string;
  paidCharge: string;
};

test.afterAll(disposeClients);

/** Id da assinatura do aluno, pela lista dele. */
async function subscriptionOf(
  playwright: Parameters<typeof apiAs>[0],
  email: string,
): Promise<string> {
  const student = await apiAs(playwright, email);
  const { items } = await body(await student.get('/v1/me/subscriptions'));
  expect(items).toHaveLength(1);
  return items[0].id;
}

const mine = (id: string) => `/v1/me/subscriptions/${id}`;
const staff = (id: string) => `/v1/manage/spaces/${state.spaceId}/subscriptions/${id}`;

test.beforeAll(async ({ playwright }) => {
  const owner = await apiAs(playwright, USERS.northOwner);
  state.spaceId = (await body(await owner.get('/v1/me'))).memberships[0].space.id;
  state.paid = await subscriptionOf(playwright, USERS.paidStudent);
  state.unpaid = await subscriptionOf(playwright, USERS.unpaidStudent);
  state.late = await subscriptionOf(playwright, USERS.lateStudent);
});

test('decisão 45: a pausa de assinatura não existe mais (API, tela e contrato)', async ({
  page,
  playwright,
}) => {
  const student = await apiAs(playwright, USERS.paidStudent);
  for (const path of ['pause', 'resume']) {
    const res = await student.post(`${mine(state.paid)}/${path}`, { data: {} });
    expect(res.status(), `POST …/${path}`).toBe(404);
  }
  const owner = await apiAs(playwright, USERS.northOwner);
  const manage = await owner.post(`${staff(state.paid)}/pause`, { data: {} });
  expect(manage.status()).toBe(404);

  const sub = await body(await student.get(mine(state.paid)));
  expect(sub.status).toBe('ACTIVE');
  expect(Object.keys(sub)).not.toContain('pausedFrom');
  expect(Object.keys(sub)).not.toContain('pausedUntil');
  const settings = await body(await owner.get(`/v1/manage/spaces/${state.spaceId}/settings`));
  expect(Object.keys(settings)).not.toContain('maxPauseMonthsPerYear');

  await login(page, USERS.northOwner);
  await page.goto('/painel/aulas/alunos');
  await page.getByRole('tab', { name: 'Ativas' }).click();
  const row = page.getByTestId('subscription-row').filter({ hasText: 'Aluno Pago E2E' });
  await expect(row).toBeVisible();
  await expect(page.getByText(/paus/i)).toHaveCount(0);
});

test('RN-CLASS-08: sem mês pago a tela avisa que o acesso termina agora; com o mês pago, mostra até quando segue', async ({
  page,
  playwright,
}) => {
  const owner = await apiAs(playwright, USERS.northOwner);
  const detail = await body(await owner.get(staff(state.paid)));
  expect(detail.accessUntilIfCancelled).toBeNull();
  const current = detail.charges.find((c: Json) => c.periodStart === MONTH_START);
  expect(current).toMatchObject({ status: 'PENDING', amountCents: 15_000, paidCents: 0 });
  state.paidCharge = current.id;

  await login(page, USERS.northOwner);
  await page.goto('/painel/aulas/alunos');
  await page.getByRole('tab', { name: 'Ativas' }).click();
  await page.getByTestId('subscription-row').filter({ hasText: 'Aluno Pago E2E' }).click();
  await page.getByRole('button', { name: 'Cancelar assinatura' }).first().click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).last();
  await expect(dialog).toContainText('O acesso de Aluno Pago E2E termina agora');
  await expect(dialog).toContainText('A mensalidade deste mês é dispensada.');
  await dialog.getByRole('button', { name: 'Voltar' }).click();

  // O Dono registra o recebimento da mensalidade do mês (total, em dinheiro).
  const pay = await owner.post(`/v1/manage/spaces/${state.spaceId}/payments`, {
    data: {
      payableType: 'SUBSCRIPTION_CHARGE',
      payableId: state.paidCharge,
      amountCents: 15_000,
      method: 'PIX',
    },
  });
  expect(pay.status()).toBe(201);
  const paid = await body(await owner.get(staff(state.paid)));
  expect(paid.charges.find((c: Json) => c.id === state.paidCharge).status).toBe('PAID');
  expect(paid.accessUntilIfCancelled).toBe(MONTH_END);

  await page.reload();
  await page.getByRole('tab', { name: 'Ativas' }).click();
  await page.getByTestId('subscription-row').filter({ hasText: 'Aluno Pago E2E' }).click();
  await page.getByRole('button', { name: 'Cancelar assinatura' }).first().click();
  await expect(page.getByRole('dialog').last()).toContainText(
    `continua com acesso até ${br(MONTH_END)}`,
  );
});

test('RN-CLASS-08: com o mês pago o cancelamento mantém turmas e acesso até o fim do mês, e nada novo é cobrado', async ({
  page,
  playwright,
}) => {
  await login(page, USERS.northOwner);
  await page.goto('/painel/aulas/alunos');
  await page.getByRole('tab', { name: 'Ativas' }).click();
  await page.getByTestId('subscription-row').filter({ hasText: 'Aluno Pago E2E' }).click();
  await page.getByRole('button', { name: 'Cancelar assinatura' }).first().click();
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Cancelar assinatura' })
    .click();
  await expect(page.getByText('Cancelamento registrado.')).toBeVisible();

  const student = await apiAs(playwright, USERS.paidStudent);
  const sub = await body(await student.get(mine(state.paid)));
  expect(sub).toMatchObject({
    status: 'ACTIVE',
    cancelAtPeriodEnd: true,
    endsOn: MONTH_END,
    accessUntil: MONTH_END,
  });
  // As turmas seguem até o fim do acesso.
  expect(sub.enrollments.filter((e: Json) => e.status === 'ACTIVE')).toHaveLength(1);
  // O mês pago continua pago; nenhuma mensalidade depois do fim.
  expect(sub.charges.filter((c: Json) => c.periodStart > MONTH_END)).toHaveLength(0);
  expect(sub.charges.find((c: Json) => c.periodStart === MONTH_START).status).toBe('PAID');

  // Na tela da gestão: o selo diz até quando.
  await page.reload();
  await page.getByRole('tab', { name: 'Ativas' }).click();
  await expect(
    page.getByTestId('subscription-row').filter({ hasText: 'Aluno Pago E2E' }),
  ).toContainText(`Acesso até ${br(MONTH_END)}`);

  // Com o cancelamento pedido o aluno não troca de turma (SUBSCRIPTION_CANCEL_REQUESTED), mesmo
  // havendo outra turma elegível: a gestão cria uma quarta-feira às 20:00 na mesma quadra.
  const owner = await apiAs(playwright, USERS.northOwner);
  const groups = await body(await owner.get(`/v1/manage/spaces/${state.spaceId}/class-groups`));
  const current = groups.items.find((g: Json) => g.name === 'Futevôlei Norte terça');
  const teachers = await body(await owner.get(`/v1/manage/spaces/${state.spaceId}/teachers`));
  const created = await owner.post(`/v1/manage/spaces/${state.spaceId}/class-groups`, {
    data: {
      name: 'Futevôlei Norte quarta',
      sportId: current.sport.id,
      teacherMemberIds: [teachers.items[0].memberId],
      courtId: current.court.id,
      weekday: 3,
      startTime: '20:00',
      durationMin: 60,
      capacity: 10,
    },
  });
  expect(created.status()).toBe(201);
  const other = await body(created);
  const swap = await student.post(`${mine(state.paid)}/swap-class-group`, {
    data: { fromClassGroupId: current.id, toClassGroupId: other.id },
  });
  expect(swap.status()).toBe(409);
  expect((await errorOf(swap)).code).toBe('SUBSCRIPTION_CANCEL_REQUESTED');

  // Repetir o cancelamento não muda nada.
  const again = await student.post(`${mine(state.paid)}/cancel`, { data: {} });
  expect(again.status()).toBe(200);
  expect(await body(again)).toMatchObject({ cancelAtPeriodEnd: true, endsOn: MONTH_END });
});

test('RN-CLASS-08: o aluno desiste do cancelamento enquanto o acesso vale e volta ao ciclo normal', async ({
  page,
  playwright,
}) => {
  await login(page, USERS.northOwner);
  await page.goto('/painel/aulas/alunos');
  await page.getByRole('tab', { name: 'Ativas' }).click();
  await page.getByTestId('subscription-row').filter({ hasText: 'Aluno Pago E2E' }).click();
  await page.getByRole('button', { name: 'Desfazer cancelamento' }).first().click();
  await expect(page.getByRole('dialog').last()).toContainText(`acesso até ${br(MONTH_END)}`);
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Desfazer cancelamento' })
    .click();
  await expect(page.getByText('Cancelamento desfeito.')).toBeVisible();

  const student = await apiAs(playwright, USERS.paidStudent);
  expect(await body(await student.get(mine(state.paid)))).toMatchObject({
    status: 'ACTIVE',
    cancelAtPeriodEnd: false,
    endsOn: null,
    accessUntil: null,
  });

  // Pelo aluno: cancela de novo (mesmo fim) e desiste pela API do app.
  const cancelled = await student.post(`${mine(state.paid)}/cancel`, {
    data: { reason: 'Mudança de cidade' },
  });
  expect(cancelled.status()).toBe(200);
  expect(await body(cancelled)).toMatchObject({ cancelAtPeriodEnd: true, accessUntil: MONTH_END });
  const resumed = await student.post(`${mine(state.paid)}/resume-cancel`);
  expect(resumed.status()).toBe(200);
  expect((await body(resumed)).cancelAtPeriodEnd).toBe(false);
  // Sem cancelamento pedido, não há o que desfazer.
  const nothing = await student.post(`${mine(state.paid)}/resume-cancel`);
  expect(nothing.status()).toBe(409);
});

test('RN-CLASS-08: sem mês pago o acesso termina no ato — turmas encerradas e a mensalidade do mês dispensada', async ({
  playwright,
}) => {
  const student = await apiAs(playwright, USERS.unpaidStudent);
  const before = await body(await student.get(mine(state.unpaid)));
  expect(before.accessUntilIfCancelled).toBeNull();
  expect(before.status).toBe('ACTIVE');

  const res = await student.post(`${mine(state.unpaid)}/cancel`, { data: {} });
  expect(res.status()).toBe(200);
  const sub = await body(res);
  expect(sub).toMatchObject({ status: 'CANCELLED', endsOn: TODAY, accessUntil: TODAY });
  expect(sub.enrollments.every((e: Json) => e.status === 'ENDED')).toBe(true);

  // A mensalidade do mês (ainda não vencida) é dispensada, com o motivo do cancelamento.
  const owner = await apiAs(playwright, USERS.northOwner);
  const detail = await body(await owner.get(staff(state.unpaid)));
  const current = detail.charges.find((c: Json) => c.periodStart === MONTH_START);
  expect(current).toMatchObject({
    status: 'WAIVED',
    waiveReason: 'Dispensada pelo cancelamento do plano',
  });
  expect(detail.overdueCents).toBe(0);

  // Já encerrada: não há como desfazer.
  const resume = await student.post(`${mine(state.unpaid)}/resume-cancel`);
  expect(resume.status()).toBe(409);
  expect((await errorOf(resume)).code).toBe('INVALID_SUBSCRIPTION_STATUS');
});

test('RN-CLASS-08: a mensalidade vencida segue devida mesmo com o cancelamento no ato (pela gestão)', async ({
  page,
  playwright,
}) => {
  const owner = await apiAs(playwright, USERS.northOwner);
  const before = await body(await owner.get(staff(state.late)));
  expect(before.accessUntilIfCancelled).toBeNull();
  expect(before.overdueCents).toBe(15_000);

  await login(page, USERS.northOwner);
  await page.goto('/painel/aulas/alunos');
  await page.getByTestId('subscription-row').filter({ hasText: 'Aluno Atrasado E2E' }).click();
  await page.getByRole('button', { name: 'Cancelar assinatura' }).first().click();
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toContainText('termina agora');
  await expect(dialog).toContainText(/A mensalidade em atraso \(R\$\s*150,00\) continua devida/);
  await dialog.getByLabel(/Motivo/).fill('Atrasou e saiu');
  await dialog.getByRole('button', { name: 'Cancelar assinatura' }).click();
  await expect(page.getByText('Cancelamento registrado.')).toBeVisible();

  const after = await body(await owner.get(staff(state.late)));
  expect(after).toMatchObject({
    status: 'CANCELLED',
    endsOn: TODAY,
    statusReason: 'Atrasou e saiu',
  });
  // A do mês anterior continua vencida e devida; só a do mês corrente (não vencida) foi dispensada.
  expect(after.overdueCents).toBe(15_000);
  const statuses = Object.fromEntries(
    after.charges.map((c: Json) => [c.periodStart, c.status]),
  ) as Record<string, string>;
  expect(statuses[MONTH_START]).toBe('WAIVED');
  expect(Object.values(statuses)).toContain('OVERDUE');

  // E aparece na lista de inadimplentes da gestão.
  const delinquents = await body(
    await owner.get(`/v1/manage/spaces/${state.spaceId}/subscription-charges/delinquents`),
  );
  expect(JSON.stringify(delinquents)).toContain('Aluno Atrasado E2E');
});
