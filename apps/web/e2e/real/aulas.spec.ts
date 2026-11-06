import {
  type APIRequestContext,
  expect,
  type Page,
  type PlaywrightWorkerArgs,
  test,
} from '@playwright/test';
import { login } from './support/api';

// E2E de Aulas contra a API real e o seed de teste (apps/api/test/e2e-seed): "Arena E2E" em modo de
// presença MANUAL, jogadores 1 a 3, dois professores e uma aula "em andamento" (já começou) do
// segundo professor. Os testes rodam em sequência e cada um parte do que o anterior deixou.
// A jornada do aluno é do app: aqui os jogadores falam com a API pelo login por request (sem tela).
// Sem JOBS_ENABLED nada roda por fila: as sessões nascem na criação da turma (generateFor) e a
// lista é aberta/fechada pela gestão.
// Cobre: RF-CLASS-02/03/04/05/09/10, RN-CLASS-01/02/03/04/05 e a permissão do Professor.
test.describe.configure({ mode: 'serial' });

const API = `http://localhost:${process.env.E2E_API_PORT ?? 3335}`;
const WEB = `http://localhost:${process.env.E2E_WEB_PORT ?? 3100}`;
const PASSWORD = 'senha-e2e-1234';
const OWNER = 'dono.e2e@exemplo.com';
const TEACHER = 'professor.e2e@exemplo.com';
const PLAYERS = [
  { email: 'jogador.e2e@exemplo.com', name: 'Jogador E2E' },
  { email: 'jogador2.e2e@exemplo.com', name: 'Jogador Dois E2E' },
  { email: 'jogador3.e2e@exemplo.com', name: 'Jogador Três E2E' },
] as const;
const [PLAYER1, PLAYER2, PLAYER3] = PLAYERS;

const GROUP_NAME = 'Futevôlei E2E lotação';
const PLAN_NAME = 'Futevôlei E2E 1x';
/** Quarta-feira às 18:00 na Quadra B: fora dos horários que a agenda.spec.ts usa. */
const WEEKDAY = 3;

/** Data (AAAA-MM-DD) de hoje em America/Sao_Paulo, mais `days` dias. */
function localDate(days = 0) {
  const target = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(target);
}

/** Próxima quarta-feira depois de hoje: a sessão da turma que os testes usam (1 a 7 dias à frente). */
function nextClassDate() {
  for (let days = 1; days <= 7; days++) {
    const date = localDate(days);
    if (new Date(`${date}T12:00:00Z`).getUTCDay() === WEEKDAY) return date;
  }
  throw new Error('Sem quarta-feira na próxima semana.');
}
const CLASS_DATE = nextClassDate();
/** `CLASS_SESSION_GENERATION_DAYS` de packages/shared: a API gera as sessões de hoje até hoje + 28 dias. */
const SESSION_GENERATION_DAYS = 28;

// Estado que passa de um teste para o seguinte.
const state = {} as {
  spaceId: string;
  groupId: string;
  planId: string;
  sessionId: string;
  ongoingSessionId: string;
  subscriptions: Record<string, string>;
  userIds: Record<string, string>;
};

// biome-ignore lint/suspicious/noExplicitAny: corpos JSON da API lidos só nas asserções
type Json = Record<string, any>;
const clients: APIRequestContext[] = [];

/** Login por request (cookie de sessão no contexto); o `Origin` é exigido pelo Better Auth. */
async function apiAs(playwright: PlaywrightWorkerArgs['playwright'], email: string) {
  const ctx = await playwright.request.newContext({
    baseURL: API,
    extraHTTPHeaders: { Origin: WEB },
  });
  const res = await ctx.post('/v1/auth/sign-in/email', { data: { email, password: PASSWORD } });
  expect(res.ok(), `login de ${email}`).toBe(true);
  clients.push(ctx);
  return ctx;
}

async function body(res: { json(): Promise<unknown> }) {
  return (await res.json()) as Json;
}

/** Escolhe uma opção de um Select (Radix) pelo id do gatilho. */
async function pick(page: Page, triggerId: string, option: string) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

const manage = (path: string) => `/v1/manage/spaces/${state.spaceId}/${path}`;
const sessionPage = (id: string) => `/painel/aulas/sessoes/${id}`;

test.afterAll(async () => {
  await Promise.all(clients.map((c) => c.dispose()));
});

test('RF-CLASS-02: o Dono cria a turma (capacidade 2, Quadra B) e a API gera as sessões na hora', async ({
  page,
  playwright,
}) => {
  await login(page, OWNER);
  await page.goto('/painel/aulas/turmas');
  await page.getByRole('button', { name: 'Nova turma' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome').fill(GROUP_NAME);
  await pick(page, 'cg-court', 'Quadra B');
  await pick(page, 'cg-sport', 'Futevôlei');
  await dialog
    .getByRole('group', { name: 'Professores' })
    .getByRole('button', { name: 'Professor E2E', exact: true })
    .click();
  await pick(page, 'cg-weekday', 'Quarta');
  await pick(page, 'cg-start', '18:00');
  await pick(page, 'cg-duration', '1h');
  await dialog.getByLabel('Capacidade (alunos)').fill('2');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Turma criada.')).toBeVisible();

  const row = page.getByTestId('class-group-row').filter({ hasText: GROUP_NAME });
  await expect(row).toContainText('Quadra B');
  await expect(row).toContainText('Qua · 18:00–19:00');
  await expect(row).toContainText('0/2 matriculados');

  const owner = await apiAs(playwright, OWNER);
  const me = await body(await owner.get('/v1/me'));
  state.spaceId = me.memberships[0].space.id;
  const groups = await body(await owner.get(manage('class-groups')));
  const group = groups.items.find((g: Json) => g.name === GROUP_NAME);
  expect(group.capacity).toBe(2);
  state.groupId = group.id;

  // Sem job: a criação já gerou as sessões (4 semanas). A janela é a mesma da geração (hoje até
  // hoje + 28 dias, inclusive): numa quarta depois das 18h, a sessão de hoje já começou e não é
  // gerada, e só a de daqui a 28 dias completa as 4.
  const sessions = await body(
    await owner.get(
      manage(
        `class-sessions?classGroupId=${state.groupId}&from=${localDate()}&to=${localDate(SESSION_GENERATION_DAYS)}`,
      ),
    ),
  );
  expect(sessions.items.length).toBeGreaterThanOrEqual(4);
  const target = sessions.items.find(
    (s: Json) => new Date(s.startsAt).toISOString().slice(0, 10) >= CLASS_DATE,
  );
  expect(target).toMatchObject({ capacity: 2, status: 'SCHEDULED' });
  state.sessionId = target.id;

  // E a sessão aparece no calendário do painel, com a lista ainda fechada (modo manual).
  await page.goto(`/painel/aulas/sessoes?data=${CLASS_DATE}&visao=dia`);
  const card = page.getByTestId('session-card').filter({ hasText: GROUP_NAME });
  await expect(card).toContainText('18:00–19:00');
  await expect(card).toContainText('Quadra B');
  await expect(card).toContainText('Professor E2E');
  await expect(card).toContainText('0/2 vagas');
  await expect(card).toContainText('Agendada');
});

test('RF-CLASS-03: o Dono cria o plano 1x por semana', async ({ page, playwright }) => {
  await login(page, OWNER);
  await page.goto('/painel/aulas/planos');
  await page.getByRole('button', { name: 'Novo plano' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome').fill(PLAN_NAME);
  await pick(page, 'plan-sport', 'Futevôlei');
  await pick(page, 'plan-frequency', '1x por semana');
  await dialog.getByLabel('Mensalidade').fill('150,00');
  await dialog.getByLabel('Dia do vencimento').fill('10');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Plano criado.')).toBeVisible();

  const row = page.getByTestId('plan-row').filter({ hasText: PLAN_NAME });
  await expect(row).toContainText('1x por semana');
  await expect(row).toContainText('R$ 150,00');
  await expect(row).toContainText('Todo dia 10');

  const owner = await apiAs(playwright, OWNER);
  const plans = await body(await owner.get(manage('plans')));
  const plan = plans.items.find((p: Json) => p.name === PLAN_NAME);
  // Dinheiro em centavos.
  expect(plan).toMatchObject({ priceCents: 15_000, weeklyFrequency: 1, billingDay: 10 });
  state.planId = plan.id;
});

test('RF-CLASS-04 / RN-CLASS-01: os jogadores pedem o plano escolhendo a turma e o pedido aguarda aprovação', async ({
  page,
  playwright,
}) => {
  state.subscriptions = {};
  state.userIds = {};
  for (const player of PLAYERS) {
    const ctx = await apiAs(playwright, player.email);
    const res = await ctx.post('/v1/me/subscriptions', {
      data: { planId: state.planId, classGroupIds: [state.groupId] },
    });
    expect(res.status(), `pedido de ${player.name}`).toBe(201);
    const sub = await body(res);
    expect(sub.status).toBe('PENDING_APPROVAL');
    state.subscriptions[player.email] = sub.id;
    state.userIds[player.email] = (await body(await ctx.get('/v1/me'))).id;
  }

  // RN-CLASS-01: plano 1x/semana pede exatamente 1 turma.
  const ctx = await apiAs(playwright, PLAYER1.email);
  // Lista vazia: barrada na validação do corpo (Zod, 400 genérico); não chega à regra do servidor.
  const none = await ctx.post('/v1/me/subscriptions', {
    data: { planId: state.planId, classGroupIds: [] },
  });
  expect(none.status()).toBe(400);
  // Duas turmas do mesmo esporte (a do teste e a "Futevôlei iniciante" do seed): a regra do
  // servidor confere que são elegíveis (ativas e do esporte do plano) e recusa pela quantidade
  // (CLASS_GROUP_COUNT_MISMATCH).
  const owner = await apiAs(playwright, OWNER);
  const groups = await body(await owner.get(manage('class-groups')));
  const beginner = groups.items.find((g: Json) => g.name === 'Futevôlei iniciante');
  expect(beginner, 'turma do seed').toBeTruthy();
  const two = await ctx.post('/v1/me/subscriptions', {
    data: { planId: state.planId, classGroupIds: [state.groupId, beginner.id] },
  });
  expect(two.status()).toBe(422);
  const mismatch = (await body(two)).error;
  expect(mismatch.code).toBe('CLASS_GROUP_COUNT_MISMATCH');
  expect(mismatch.details).toMatchObject({ expected: 1, received: 2 });

  // Pedido pendente não ocupa vaga (RN-CLASS-02): a turma continua com 0 matrículas.
  await login(page, OWNER);
  await page.goto('/painel/aulas/alunos');
  await page.getByRole('tab', { name: /Aguardando aprovação/ }).click();
  for (const player of PLAYERS) {
    await expect(
      page.getByTestId('subscription-row').filter({ hasText: player.name }),
    ).toContainText('Aguardando aprovação');
  }
  await page.goto('/painel/aulas/turmas');
  await expect(page.getByTestId('class-group-row').filter({ hasText: GROUP_NAME })).toContainText(
    '0/2 matriculados',
  );
});

test('RF-CLASS-05 / RN-CLASS-02: aprova dois alunos e a turma lota; o terceiro recebe CLASS_GROUP_FULL', async ({
  page,
}) => {
  await login(page, OWNER);
  await page.goto('/painel/aulas/alunos');
  await page.getByRole('tab', { name: /Aguardando aprovação/ }).click();

  for (const player of [PLAYER1, PLAYER2]) {
    await page
      .getByTestId('subscription-row')
      .filter({ hasText: player.name })
      .getByRole('button', { name: 'Aprovar' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(new RegExp(GROUP_NAME))).toBeChecked();
    await dialog.getByRole('button', { name: 'Aprovar', exact: true }).click();
    await expect(page.getByText('Assinatura aprovada. O aluno foi avisado.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  // Turma lotada: 2 matrículas ativas = capacidade.
  await page.goto('/painel/aulas/turmas');
  const row = page.getByTestId('class-group-row').filter({ hasText: GROUP_NAME });
  await expect(row).toContainText('2/2 matriculados');
  await expect(row).toContainText('Lotada');

  // O terceiro pedido continua pendente; aprovar volta 409 e o painel mostra a mensagem.
  await page.goto('/painel/aulas/alunos');
  await page.getByRole('tab', { name: /Aguardando aprovação/ }).click();
  await page
    .getByTestId('subscription-row')
    .filter({ hasText: PLAYER3.name })
    .getByRole('button', { name: 'Aprovar' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Lotada')).toBeVisible();
  const response = page.waitForResponse(
    (r) => r.url().includes('/approve') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Aprovar', exact: true }).click();
  const res = await response;
  expect(res.status()).toBe(409);
  expect((await res.json()).error.code).toBe('CLASS_GROUP_FULL');
  await expect(dialog.getByText('A turma não tem mais vagas.')).toBeVisible();
  await expect(page.getByText('Assinatura aprovada. O aluno foi avisado.')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Voltar' }).click();

  await page.reload();
  await page.getByRole('tab', { name: /Aguardando aprovação/ }).click();
  await expect(
    page.getByTestId('subscription-row').filter({ hasText: PLAYER3.name }),
  ).toContainText('Aguardando aprovação');
});

test('RN-CLASS-04: modo manual — a lista fica fechada até a gestão abrir, e só então o aluno confirma', async ({
  page,
  playwright,
}) => {
  const owner = await apiAs(playwright, OWNER);
  const settings = await body(await owner.get(manage('settings')));
  expect(settings.attendanceMode).toBe('MANUAL');

  // Antes de abrir, a sessão está SCHEDULED e o aluno não confirma.
  const player1 = await apiAs(playwright, PLAYER1.email);
  const early = await player1.post(`/v1/me/class-sessions/${state.sessionId}/attendance`);
  expect(early.status()).toBe(409);
  expect((await body(early)).error.code).toBe('ATTENDANCE_LIST_NOT_OPEN');

  // Para lotar a sessão com os 2 matriculados + 1 de reposição, a capacidade da aula cai para 1
  // (RF-CLASS-09: ajuste só desta aula).
  const patch = await owner.patch(manage(`class-sessions/${state.sessionId}`), {
    data: { capacity: 1 },
  });
  expect(patch.ok()).toBe(true);

  await login(page, OWNER);
  await page.goto(sessionPage(state.sessionId));
  await expect(page.getByTestId('session-summary')).toContainText('Agendada');
  await page.getByRole('button', { name: 'Abrir lista' }).click();
  await expect(page.getByText('Lista aberta.')).toBeVisible();
  await expect(page.getByTestId('session-summary')).toContainText('Lista aberta');
  await expect(page.getByTestId('session-occupancy')).toHaveText('0/1');

  // Aula futura: nada de presença real antes do início.
  await expect(page.getByRole('button', { name: /como presente/ })).toHaveCount(0);

  // Com a lista aberta, o aluno confirma (agora há vaga: capacidade 1, nenhum confirmado).
  const confirmed = await body(
    await player1.post(`/v1/me/class-sessions/${state.sessionId}/attendance`),
  );
  expect(confirmed.myAttendance).toMatchObject({ status: 'CONFIRMED', waitlistPosition: null });
  await page.reload();
  await expect(page.getByTestId('session-occupancy')).toHaveText('1/1 · lotada');
  await expect(page.getByTestId('attendee-row')).toContainText(PLAYER1.name);
});

test('RN-CLASS-03 / RF-CLASS-10: sessão lotada manda o excedente para a espera, com posição', async ({
  page,
  playwright,
}) => {
  const player1 = await apiAs(playwright, PLAYER1.email);
  const player2 = await apiAs(playwright, PLAYER2.email);
  const player3 = await apiAs(playwright, PLAYER3.email);
  const url = `/v1/me/class-sessions/${state.sessionId}/attendance`;

  // O jogador 1 já confirmou no teste anterior (ocupa a única vaga).
  // Capacidade 1: o segundo matriculado vai para a espera, na posição 1.
  const second = await body(await player2.post(url));
  expect(second.myAttendance).toMatchObject({ status: 'WAITLIST', waitlistPosition: 1 });

  // RN-CLASS-03: quem não está matriculado (pedido pendente) nem enxerga a sessão: 404, não 403.
  const outsider = await player3.post(url);
  expect(outsider.status()).toBe(404);
  expect((await body(outsider)).error.code).toBe('CLASS_SESSION_NOT_FOUND');

  // Confirmar duas vezes é recusado.
  const again = await player1.post(url);
  expect(again.status()).toBe(409);
  expect((await body(again)).error.code).toBe('ALREADY_IN_SESSION');

  // A gestão acrescenta o terceiro (reposição): vai para o fim da espera.
  await login(page, OWNER);
  await page.goto(sessionPage(state.sessionId));
  await expect(page.getByTestId('session-occupancy')).toHaveText('1/1 · lotada');
  await page.getByRole('button', { name: 'Adicionar aluno' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('A aula está lotada')).toBeVisible();
  await dialog.getByLabel('Buscar aluno pelo nome').fill('Três');
  await dialog.getByRole('button', { name: `Adicionar ${PLAYER3.name}` }).click();
  await expect(page.getByText(`${PLAYER3.name} entrou na lista de espera.`)).toBeVisible();

  await expect(page.getByTestId('attendee-row')).toHaveCount(1);
  await expect(page.getByTestId('attendee-row')).toContainText(PLAYER1.name);
  const waiting = page.getByTestId('waitlist-row');
  await expect(waiting).toHaveCount(2);
  await expect(waiting.nth(0)).toContainText('1º');
  await expect(waiting.nth(0)).toContainText(PLAYER2.name);
  await expect(waiting.nth(1)).toContainText('2º');
  await expect(waiting.nth(1)).toContainText(PLAYER3.name);
  await expect(waiting.nth(1)).toContainText('adicionado pela equipe');
});

test('RN-CLASS-05 / RF-CLASS-10: o primeiro desiste dentro do prazo e o primeiro da espera é promovido', async ({
  page,
  playwright,
}) => {
  const player1 = await apiAs(playwright, PLAYER1.email);
  const url = `/v1/me/class-sessions/${state.sessionId}/attendance`;

  const detail = await body(await player1.get(`/v1/me/class-sessions/${state.sessionId}`));
  expect(new Date(detail.cancellableUntil).getTime()).toBeGreaterThan(Date.now());

  const withdrawn = await player1.delete(url);
  expect(withdrawn.ok()).toBe(true);

  // Desistir de novo: já não está na lista.
  const twice = await player1.delete(url);
  expect(twice.status()).toBe(409);
  expect((await body(twice)).error.code).toBe('NOT_IN_SESSION');

  // O jogador 2 foi promovido sem job; o jogador 3 subiu para a posição 1.
  const player2 = await apiAs(playwright, PLAYER2.email);
  const promoted = await body(await player2.get(`/v1/me/class-sessions/${state.sessionId}`));
  expect(promoted.myAttendance).toMatchObject({ status: 'CONFIRMED', waitlistPosition: null });

  await login(page, OWNER);
  await page.goto(sessionPage(state.sessionId));
  await expect(page.getByTestId('session-occupancy')).toHaveText('1/1 · lotada');
  await expect(page.getByTestId('attendee-row')).toHaveCount(1);
  await expect(page.getByTestId('attendee-row')).toContainText(PLAYER2.name);
  const waiting = page.getByTestId('waitlist-row');
  await expect(waiting).toHaveCount(1);
  await expect(waiting).toContainText('1º');
  await expect(waiting).toContainText(PLAYER3.name);
  await expect(page.getByTestId('attendee-row').filter({ hasText: PLAYER1.name })).toHaveCount(0);
});

test('RF-CLASS-09: presença real não pode ser marcada antes do início da aula (PRESENCE_TOO_EARLY)', async ({
  playwright,
}) => {
  const owner = await apiAs(playwright, OWNER);
  const res = await owner.put(manage(`class-sessions/${state.sessionId}/presence`), {
    data: { items: [{ userId: state.userIds[PLAYER2.email], status: 'PRESENT' }] },
  });
  expect(res.status()).toBe(409);
  expect((await body(res)).error.code).toBe('PRESENCE_TOO_EARLY');
});

test('RF-CLASS-09: presente/faltou de uma aula que já começou, pelo painel', async ({
  page,
  playwright,
}) => {
  // A aula do seed começou há ~10 min (o servidor não gera sessão de hoje que já passou do horário).
  // Busca de ontem até hoje: perto da meia-noite, "10 min atrás" pode cair no dia anterior.
  const owner = await apiAs(playwright, OWNER);
  const list = await body(
    await owner.get(manage(`class-sessions?from=${localDate(-1)}&to=${localDate()}`)),
  );
  const ongoing = list.items.find((s: Json) => s.classGroup.name === 'Aula em andamento');
  expect(ongoing, 'aula em andamento do seed').toBeTruthy();
  state.ongoingSessionId = ongoing.id;

  await login(page, OWNER);
  await page.goto(sessionPage(state.ongoingSessionId));
  await expect(page.getByRole('heading', { name: 'Aula em andamento' })).toBeVisible();
  await expect(page.getByTestId('attendee-row')).toHaveCount(2);

  await page.getByRole('button', { name: `Marcar ${PLAYER1.name} como presente` }).click();
  await expect(
    page.getByRole('button', { name: `Marcar ${PLAYER1.name} como presente` }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: `Marcar ${PLAYER2.name} como faltou` }).click();
  await expect(
    page.getByRole('button', { name: `Marcar ${PLAYER2.name} como faltou` }),
  ).toHaveAttribute('aria-pressed', 'true');

  // Persistiu na API; quem já teve a presença marcada não sai da lista (PRESENCE_ALREADY_MARKED).
  const detail = await body(await owner.get(manage(`class-sessions/${state.ongoingSessionId}`)));
  const status = Object.fromEntries(detail.attendances.map((a: Json) => [a.name, a.status]));
  expect(status).toMatchObject({ [PLAYER1.name]: 'PRESENT', [PLAYER2.name]: 'ABSENT' });
  const remove = await owner.delete(
    manage(`class-sessions/${state.ongoingSessionId}/attendances/${state.userIds[PLAYER1.email]}`),
  );
  expect(remove.status()).toBe(409);
  expect((await body(remove)).error.code).toBe('PRESENCE_ALREADY_MARKED');
});

test('Permissão do Professor: vê só as turmas e aulas dele; o menu esconde Alunos e Mensalidades', async ({
  page,
  playwright,
}) => {
  const teacher = await apiAs(playwright, TEACHER);

  // API: turmas e sessões filtradas pelo vínculo do professor.
  const groups = await body(await teacher.get(manage('class-groups')));
  const names = groups.items.map((g: Json) => g.name).sort();
  expect(names).toEqual(['Futevôlei E2E lotação', 'Futevôlei iniciante']);
  const today = localDate();
  const sessions = await body(
    await teacher.get(manage(`class-sessions?from=${today}&to=${localDate(27)}`)),
  );
  expect(sessions.items.length).toBeGreaterThan(0);
  expect(
    sessions.items.every((s: Json) => s.teachers.some((t: Json) => t.name === 'Professor E2E')),
  ).toBe(true);
  // A aula do outro professor não existe para ele.
  const other = await teacher.get(manage(`class-sessions/${state.ongoingSessionId}`));
  expect(other.status()).toBe(404);
  // Alunos e mensalidades são da gestão.
  expect((await teacher.get(manage('subscriptions'))).status()).toBe(403);
  expect((await teacher.get(manage('subscription-charges'))).status()).toBe(403);
  // A lista de professores do espaço é de leitura para o Professor e vem inteira (decisão 34 de
  // docs/07): inclui o outro professor, com a contagem de turmas ativas de cada um.
  const teachers = await teacher.get(manage('teachers'));
  expect(teachers.ok()).toBe(true);
  const teacherItems: Json[] = (await body(teachers)).items;
  const countOf = (name: string) =>
    teacherItems.find((t) => t.name === name)?.activeClassGroupCount;
  expect(countOf('Professor E2E')).toBe(2);
  expect(countOf('Professor Dois E2E')).toBe(1);

  // Painel.
  await login(page, TEACHER);
  await page.goto('/painel/aulas/turmas');
  await expect(page.getByText('Suas turmas fixas')).toBeVisible();
  await expect(page.getByTestId('class-group-row')).toHaveCount(2);
  await expect(page.getByTestId('class-group-row').filter({ hasText: GROUP_NAME })).toBeVisible();
  await expect(page.getByText('Aula em andamento')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nova turma' })).toHaveCount(0);

  await page.goto(`/painel/aulas/sessoes?data=${today}&visao=dia`);
  await expect(page.getByRole('heading', { name: 'Sessões' })).toBeVisible();
  await expect(
    page.getByTestId('session-card').filter({ hasText: 'Aula em andamento' }),
  ).toHaveCount(0);
  await page.goto(`/painel/aulas/sessoes?data=${CLASS_DATE}&visao=dia`);
  await expect(page.getByTestId('session-card').filter({ hasText: GROUP_NAME })).toBeVisible();

  await page.goto(sessionPage(state.ongoingSessionId));
  await expect(page.getByText('Aula não encontrada')).toBeVisible();

  // Menu: Turmas e Sessões sim; Alunos e Mensalidades não.
  await page.goto('/painel/aulas/turmas');
  await expect(page.getByRole('link', { name: 'Turmas' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sessões' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Alunos' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Mensalidades' })).toHaveCount(0);
});
