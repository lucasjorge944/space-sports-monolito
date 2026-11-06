import { expect, test } from '@playwright/test';
import {
  apiAs,
  body,
  courtsAndSport,
  disposeClients,
  errorOf,
  type Json,
  linkIn,
  login,
  nextWeekday,
  pick,
  teacherIds,
  waitForMail,
} from './support/api';
import { USERS } from './support/env';

// A.5 e decisão 47: aula com mais de um professor e conflito do mesmo professor entre ESPAÇOS
// diferentes (no mesmo espaço pode). Cobre RF-CLASS-02 (turma) e RN-CLASS (professores por aula).
// Espaços: "Arena E2E" (A) e "Arena E2E Norte" (B); o professor Multi tem vínculo nos dois.
test.describe.configure({ mode: 'serial' });

const THURSDAY = 4;
const state = {} as {
  spaceA: string;
  spaceB: string;
  groupTwoTeachers: string;
  groupBNorth: string;
};

test.afterAll(disposeClients);

test.beforeAll(async ({ playwright, request }) => {
  const ownerA = await apiAs(playwright, USERS.owner);
  const ownerB = await apiAs(playwright, USERS.northOwner);
  state.spaceA = (await body(await ownerA.get('/v1/me'))).memberships[0].space.id;
  state.spaceB = (await body(await ownerB.get('/v1/me'))).memberships[0].space.id;

  // O professor Multi já é do espaço B (seed); o espaço A o convida e ele aceita pelo link do e-mail.
  const since = new Date();
  const invite = await ownerA.post(`/v1/manage/spaces/${state.spaceA}/team/invites`, {
    data: { email: USERS.multiTeacher, role: 'TEACHER' },
  });
  expect(invite.status()).toBe(201);
  const mail = await waitForMail(request, USERS.multiTeacher, /Convite para a equipe/, { since });
  const token = linkIn(mail, '/convite/').split('/convite/')[1] ?? '';
  const multi = await apiAs(playwright, USERS.multiTeacher);
  const accepted = await multi.post(`/v1/staff-invites/${token}/accept`);
  expect(accepted.status()).toBe(200);
});

test('decisão 47: a turma com dois professores aparece com os dois na lista, no calendário e para cada um deles', async ({
  page,
  playwright,
}) => {
  await login(page, USERS.owner);
  await page.goto('/painel/aulas/turmas');
  await page.getByRole('button', { name: 'Nova turma' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome').fill('Futevôlei Dois Professores E2E');
  await pick(page, 'cg-court', 'Quadra B');
  await pick(page, 'cg-sport', 'Futevôlei');
  const teachers = dialog.getByRole('group', { name: 'Professores' });
  await teachers.getByRole('button', { name: 'Professor E2E', exact: true }).click();
  await teachers.getByRole('button', { name: 'Professor Dois E2E', exact: true }).click();
  await pick(page, 'cg-weekday', 'Quinta');
  await pick(page, 'cg-start', '21:00');
  await pick(page, 'cg-duration', '1h');
  await dialog.getByLabel('Capacidade (alunos)').fill('6');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Turma criada.')).toBeVisible();

  const row = page.getByTestId('class-group-row').filter({ hasText: 'Futevôlei Dois Professores' });
  await expect(row).toContainText('Professor E2E');
  await expect(row).toContainText('Professor Dois E2E');
  await expect(row).toContainText('Qui · 21:00–22:00');

  const owner = await apiAs(playwright, USERS.owner);
  const groups = await body(await owner.get(`/v1/manage/spaces/${state.spaceA}/class-groups`));
  const group = groups.items.find((g: Json) => g.name === 'Futevôlei Dois Professores E2E');
  expect(group.teachers.map((t: Json) => t.name).sort()).toEqual([
    'Professor Dois E2E',
    'Professor E2E',
  ]);
  state.groupTwoTeachers = group.id;

  // Cada aula gerada herda os dois professores.
  const date = nextWeekday(THURSDAY);
  const sessions = await body(
    await owner.get(
      `/v1/manage/spaces/${state.spaceA}/class-sessions?classGroupId=${group.id}&from=${date}&to=${date}`,
    ),
  );
  expect(sessions.items).toHaveLength(1);
  expect(sessions.items[0].teachers.map((t: Json) => t.name).sort()).toEqual([
    'Professor Dois E2E',
    'Professor E2E',
  ]);

  // No calendário do painel o cartão da aula traz os dois nomes.
  await page.goto(`/painel/aulas/sessoes?data=${date}&visao=dia`);
  const card = page
    .getByTestId('session-card')
    .filter({ hasText: 'Futevôlei Dois Professores E2E' });
  await expect(card).toContainText('21:00–22:00');
  await expect(card).toContainText('Professor E2E');
  await expect(card).toContainText('Professor Dois E2E');

  // O escopo do Professor: os dois veem a aula; quem não está entre os professores, não.
  for (const email of [USERS.teacher, USERS.teacher2]) {
    const teacher = await apiAs(playwright, email);
    const seen = await body(
      await teacher.get(`/v1/manage/spaces/${state.spaceA}/class-sessions?from=${date}&to=${date}`),
    );
    expect(
      seen.items.map((s: Json) => s.classGroup.name),
      email,
    ).toContain('Futevôlei Dois Professores E2E');
  }
});

test('decisão 47: o mesmo professor em duas aulas no mesmo horário do MESMO espaço é permitido', async ({
  playwright,
}) => {
  const owner = await apiAs(playwright, USERS.owner);
  const { sportId, court } = await courtsAndSport(owner, state.spaceA);
  const teacher = await teacherIds(owner, state.spaceA);
  const res = await owner.post(`/v1/manage/spaces/${state.spaceA}/class-groups`, {
    data: {
      name: 'Mesmo professor, outra quadra E2E',
      sportId,
      teacherMemberIds: [teacher('Professor E2E')],
      courtId: court('Quadra A'),
      weekday: THURSDAY,
      startTime: '21:00',
      durationMin: 60,
      capacity: 6,
    },
  });
  expect(res.status(), JSON.stringify(await res.json())).toBe(201);
  // As duas aulas do Professor E2E existem ao mesmo tempo (uma em cada quadra).
  const date = nextWeekday(THURSDAY);
  const sessions = await body(
    await owner.get(`/v1/manage/spaces/${state.spaceA}/class-sessions?from=${date}&to=${date}`),
  );
  const mine = sessions.items.filter(
    (s: Json) =>
      s.teachers.some((t: Json) => t.name === 'Professor E2E') && s.status !== 'CANCELLED',
  );
  expect(mine.length).toBeGreaterThanOrEqual(2);
  // Libera a Quadra A às 21:00 para os testes de conflito entre espaços.
  const removed = await owner.delete(
    `/v1/manage/spaces/${state.spaceA}/class-groups/${(await body(res)).id}`,
  );
  expect(removed.ok(), `DELETE turma: ${removed.status()}`).toBe(true);
});

test('decisão 47: o professor com aula em outro espaço no mesmo horário é recusado, sem revelar o outro espaço', async ({
  playwright,
}) => {
  // O Dono do espaço B marca uma aula do Multi na quinta, 21:00 (livre: ele ainda não tem aula no A).
  const ownerB = await apiAs(playwright, USERS.northOwner);
  const b = await courtsAndSport(ownerB, state.spaceB);
  const teacherB = await teacherIds(ownerB, state.spaceB);
  const created = await ownerB.post(`/v1/manage/spaces/${state.spaceB}/class-groups`, {
    data: {
      name: 'Norte quinta E2E',
      sportId: b.sportId,
      teacherMemberIds: [teacherB('Professor Multi E2E')],
      courtId: b.court('Quadra Norte'),
      weekday: THURSDAY,
      startTime: '21:00',
      durationMin: 60,
      capacity: 6,
    },
  });
  expect(created.status(), JSON.stringify(await created.json())).toBe(201);
  state.groupBNorth = (await body(created)).id;

  // O espaço A tenta pôr o mesmo professor às 21:30 (sobrepõe 21:00–22:00 do B).
  const ownerA = await apiAs(playwright, USERS.owner);
  const a = await courtsAndSport(ownerA, state.spaceA);
  const teacherA = await teacherIds(ownerA, state.spaceA);
  const attempt = await ownerA.post(`/v1/manage/spaces/${state.spaceA}/class-groups`, {
    data: {
      name: 'Conflito entre espaços E2E',
      sportId: a.sportId,
      teacherMemberIds: [teacherA('Professor Multi E2E')],
      courtId: a.court('Quadra A'),
      weekday: THURSDAY,
      startTime: '21:30',
      durationMin: 60,
      capacity: 6,
    },
  });
  expect(attempt.status()).toBe(409);
  const error = await errorOf(attempt);
  expect(error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
  // Mostra quem e a data e o horário da aula que ficou de fora (a que se tentou criar); nunca o
  // nome (nem o id) do outro espaço.
  expect(error.message).toMatch(
    /Professor Multi E2E já tem aula em outro espaço no dia \d\d\/\d\d\/\d{4}/,
  );
  expect(error.message).toContain('entre 21:30 e 22:30');
  const everything = JSON.stringify(error);
  expect(everything).not.toContain('Norte');
  expect(everything).not.toContain(state.spaceB);
  // Nada foi criado pela tentativa.
  const groups = await body(await ownerA.get(`/v1/manage/spaces/${state.spaceA}/class-groups`));
  expect(groups.items.map((g: Json) => g.name)).not.toContain('Conflito entre espaços E2E');
});

test('decisão 47: o conflito aparece na tela de nova turma e a turma não é criada', async ({
  page,
}) => {
  await login(page, USERS.owner);
  await page.goto('/painel/aulas/turmas');
  await page.getByRole('button', { name: 'Nova turma' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome').fill('Conflito na tela E2E');
  await pick(page, 'cg-court', 'Quadra A');
  await pick(page, 'cg-sport', 'Futevôlei');
  await dialog
    .getByRole('group', { name: 'Professores' })
    .getByRole('button', { name: 'Professor Multi E2E', exact: true })
    .click();
  await pick(page, 'cg-weekday', 'Quinta');
  await pick(page, 'cg-start', '21:30');
  await pick(page, 'cg-duration', '1h');
  await dialog.getByLabel('Capacidade (alunos)').fill('6');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog.getByText(/Professor Multi E2E já tem aula em outro espaço/)).toBeVisible();
  await expect(page.getByText('Turma criada.')).toHaveCount(0);
  await expect(dialog).not.toContainText('Norte');
});

test('decisão 47: aula que só encosta (22:00, quando a outra termina) é permitida; mudar o horário para sobrepor, não', async ({
  playwright,
}) => {
  const ownerA = await apiAs(playwright, USERS.owner);
  const a = await courtsAndSport(ownerA, state.spaceA);
  const teacherA = await teacherIds(ownerA, state.spaceA);
  const touching = await ownerA.post(`/v1/manage/spaces/${state.spaceA}/class-groups`, {
    data: {
      name: 'Encosta no Norte E2E',
      sportId: a.sportId,
      teacherMemberIds: [teacherA('Professor Multi E2E')],
      courtId: a.court('Quadra A'),
      weekday: THURSDAY,
      startTime: '22:00',
      durationMin: 60,
      capacity: 6,
    },
  });
  expect(touching.status(), JSON.stringify(await touching.json())).toBe(201);
  const group = await body(touching);

  // Mover essa turma para 21:00 sobrepõe a do Norte.
  const moved = await ownerA.patch(`/v1/manage/spaces/${state.spaceA}/class-groups/${group.id}`, {
    data: { startTime: '21:00' },
  });
  expect(moved.status()).toBe(409);
  expect((await errorOf(moved)).code).toBe('TEACHER_SCHEDULE_CONFLICT');
  const still = await body(
    await ownerA.get(`/v1/manage/spaces/${state.spaceA}/class-groups/${group.id}`),
  );
  expect(still.startTime).toBe('22:00');
});

test('decisão 47: trocar os professores de UMA aula — conflito é recusado, a troca livre vale só para ela', async ({
  playwright,
}) => {
  const ownerA = await apiAs(playwright, USERS.owner);
  const teacherA = await teacherIds(ownerA, state.spaceA);
  const date = nextWeekday(THURSDAY);
  const list = await body(
    await ownerA.get(
      `/v1/manage/spaces/${state.spaceA}/class-sessions?classGroupId=${state.groupTwoTeachers}&from=${date}&to=${date}`,
    ),
  );
  const session = list.items[0];
  const url = `/v1/manage/spaces/${state.spaceA}/class-sessions/${session.id}`;

  // Acrescentar o Multi às 21:00 bate com a aula dele no Norte.
  const conflict = await ownerA.patch(url, {
    data: {
      teacherMemberIds: [teacherA('Professor E2E'), teacherA('Professor Multi E2E')],
    },
  });
  expect(conflict.status()).toBe(409);
  expect((await errorOf(conflict)).code).toBe('TEACHER_SCHEDULE_CONFLICT');

  // Deixar só o segundo professor é livre: a lista da aula é substituída.
  const swapped = await ownerA.patch(url, {
    data: { teacherMemberIds: [teacherA('Professor Dois E2E')] },
  });
  expect(swapped.status()).toBe(200);
  expect((await body(swapped)).teachers.map((t: Json) => t.name)).toEqual(['Professor Dois E2E']);

  // A turma e as outras aulas dela seguem com os dois; o Professor E2E deixou de ver esta aula.
  const group = await body(
    await ownerA.get(`/v1/manage/spaces/${state.spaceA}/class-groups/${state.groupTwoTeachers}`),
  );
  expect(group.teachers).toHaveLength(2);
  const first = await apiAs(playwright, USERS.teacher);
  const seen = await body(
    await first.get(
      `/v1/manage/spaces/${state.spaceA}/class-sessions?classGroupId=${state.groupTwoTeachers}&from=${date}&to=${date}`,
    ),
  );
  expect(seen.items).toHaveLength(0);
  // Sem nenhum professor a aula não existe: a lista não pode ficar vazia.
  const empty = await ownerA.patch(url, { data: { teacherMemberIds: [] } });
  expect(empty.status()).toBe(400);
});
