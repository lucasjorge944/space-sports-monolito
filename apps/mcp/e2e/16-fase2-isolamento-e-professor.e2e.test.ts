import { beforeAll, describe, expect, it } from 'vitest';
import {
  isManageOp,
  loadSpaceParams,
  manageUrl,
  type Operation,
  openApiOperations,
  resetLimits,
  type SpaceParams,
  safeCall,
  tick,
  userConn,
  withClient,
  world,
} from './support/fase2.js';
import { api } from './support/oauth.js';

// Fase 2, isolamento entre espaços e o Professor forçando rotas de valor (docs/14-mcp.md 8.2, 8.4 e
// 8.5; RN-MCP-06 e RN-MCP-09; decisão 53): quem é da equipe do espaço A, com os ids do espaço B,
// em TODAS as rotas de gestão da lista e em todas as tools. Cada laço começa por um controle
// positivo (a mesma rota com os ids do próprio espaço responde 200), para um 404 por URL errada não
// passar por "isolamento".

const w = world();
const MANAGE_OPS = openApiOperations().filter(
  (op) => op.method === 'GET' && isManageOp(op) && op.params.includes('spaceId'),
);
const FINANCE_OPS = MANAGE_OPS.filter((op) => op.scopes.includes('manage:finance:read'));

/** Marcas que só existem nos dados de cada espaço: se aparecerem na resposta do outro, vazou. */
const MARKS_A = [
  'Quadra Fase Dois A',
  'Cliente Aurora',
  'Cliente Bruno',
  'Carlos Balcão',
  'Aluna Fabi',
  'Aluno Edu',
  'Turma Um Fase',
  'Professor Um Fase',
  'Dona Fase Dois',
];
const MARKS_B = [
  'Quadra Fase Dois B',
  'Quadra B1',
  'Turma B Secreta',
  'Aluna Gabi',
  'Dona Espaço B',
  'Professor Espaço B',
];

let A: SpaceParams;
let B: SpaceParams;

beforeAll(async () => {
  A = await loadSpaceParams('a', 'dani', 'prof1');
  B = await loadSpaceParams('b', 'gabi', 'profb');
  expect(MANAGE_OPS.length).toBeGreaterThanOrEqual(28);
});

const leaks = (body: unknown, marks: string[]) => {
  const text = JSON.stringify(body);
  return marks.filter((mark) => text.includes(mark));
};

/** O token de um papel e os dados do "outro lado" que ele não pode ver. */
const ACTORS: {
  key: string;
  own: () => SpaceParams;
  other: () => SpaceParams;
  ownMarks: string[];
  otherMarks: string[];
  /** Códigos aceitos para a recusa por papel/escopo. */
  forbidden: string[];
  /** Operações que o papel NÃO alcança nem no espaço dele (valores, clientes, equipe). */
  skipControl?: (op: Operation) => boolean;
}[] = [
  {
    key: 'dona',
    own: () => A,
    other: () => B,
    ownMarks: MARKS_A,
    otherMarks: MARKS_B,
    forbidden: ['SPACE_FORBIDDEN'],
  },
  {
    key: 'admin',
    own: () => A,
    other: () => B,
    ownMarks: MARKS_A,
    otherMarks: MARKS_B,
    forbidden: ['SPACE_FORBIDDEN'],
  },
  {
    key: 'donob',
    own: () => B,
    other: () => A,
    ownMarks: MARKS_B,
    otherMarks: MARKS_A,
    forbidden: ['SPACE_FORBIDDEN'],
  },
  {
    key: 'adminb',
    own: () => B,
    other: () => A,
    ownMarks: MARKS_B,
    otherMarks: MARKS_A,
    forbidden: ['SPACE_FORBIDDEN'],
  },
];

describe('(2) Dono e Admin do espaço A com os ids do espaço B (e o inverso), em todas as rotas de gestão da lista', () => {
  for (const actor of ACTORS) {
    it(`${actor.key}: controle no próprio espaço, depois B inteiro, ids de B no espaço dele e filtros de B`, async () => {
      const conn = await userConn(actor.key);
      const failures: string[] = [];
      for (const op of MANAGE_OPS) {
        const label = `${op.path}`;
        // 1. controle positivo: os ids do próprio espaço. (A cobrança online é de um terceiro espaço: 404.)
        await tick();
        const control = await api(manageUrl(op, actor.own()), conn.token);
        const wantControl = op.params.includes('chargeId') ? 404 : 200;
        if (control.status !== wantControl) {
          failures.push(`controle ${label} → ${control.status} ${control.body?.error?.code ?? ''}`);
        }
        // 2. o outro espaço inteiro (rota + ids): 403 SPACE_FORBIDDEN e nenhuma marca dele.
        await tick();
        const other = await api(manageUrl(op, actor.other()), conn.token);
        if (other.status !== 403 || !actor.forbidden.includes(other.body?.error?.code)) {
          failures.push(`B inteiro ${label} → ${other.status} ${other.body?.error?.code ?? ''}`);
        }
        if (leaks(other.body, actor.otherMarks).length)
          failures.push(`vazou em ${label} (B inteiro)`);
        // 3. o espaço dele com ids de filhos do outro (reserva, quadra, turma, aula, plano, cobrança).
        if (op.params.some((p) => p !== 'spaceId')) {
          await tick();
          const mixed = await api(
            manageUrl(op, { ...actor.own(), ...pickChildren(actor.other()) }),
            conn.token,
          );
          if (mixed.status !== 404) {
            failures.push(
              `ids do outro em ${label} → ${mixed.status} ${mixed.body?.error?.code ?? ''}`,
            );
          }
          if (leaks(mixed.body, actor.otherMarks).length) failures.push(`vazou em ${label} (ids)`);
        }
        // 4. filtros de query com ids do outro espaço: nada dele na resposta.
        if (
          op.query.some((q) =>
            [
              'courtId',
              'classGroupId',
              'subscriptionId',
              'userId',
              'teacherMemberId',
              'payableId',
            ].includes(q),
          )
        ) {
          await tick();
          const filtered = await api(
            manageUrl(op, actor.own(), { filters: actor.other() }),
            conn.token,
          );
          if (filtered.status >= 500) failures.push(`filtro ${label} → ${filtered.status}`);
          if (leaks(filtered.body, actor.otherMarks).length)
            failures.push(`vazou em ${label} (filtro)`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it('métricas com courtId/classGroupId do outro espaço voltam zeradas, sem linhas dele (docs 8.4)', async () => {
    const conn = await userConn('dona');
    await resetLimits();
    const from = w.windows.from;
    const to = w.windows.to;
    const base = `/v1/manage/spaces/${A.spaceId}/analytics`;
    const bookings = await api(
      `${base}/bookings?from=${from}&to=${to}&courtId=${B.courtId}&groupBy=court`,
      conn.token,
    );
    expect(bookings.status).toBe(200);
    expect(bookings.body.totals.bookings).toBe(0);
    expect(bookings.body.rows.every((row: { key: string }) => row.key !== B.courtId)).toBe(true);
    const revenue = await api(
      `${base}/revenue?from=${from}&to=${to}&courtId=${B.courtId}`,
      conn.token,
    );
    expect(revenue.status).toBe(200);
    expect(revenue.body.totals.receivedCents).toBe(0);
    const classes = await api(
      `${base}/classes?from=${from}&to=${to}&classGroupId=${B.classGroupId}`,
      conn.token,
    );
    expect(classes.status).toBe(200);
    expect(classes.body.totals.sessionsDone).toBe(0);
    expect(classes.body.totals.present).toBe(0);
    const occupancy = await api(
      `${base}/occupancy?from=${from}&to=${to}&courtId=${B.courtId}`,
      conn.token,
    );
    expect(occupancy.status).toBe(200);
    expect(occupancy.body.totals.bookedHours).toBe(0);
  });

  it('staff-spaces e a lista de espaços só têm o espaço da pessoa', async () => {
    const conn = await userConn('dona');
    await resetLimits();
    const res = await api('/v1/me/staff-spaces', conn.token);
    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { space: { id: string } }) => item.space.id)).toEqual([
      A.spaceId,
    ]);
    expect(leaks(res.body, MARKS_B)).toEqual([]);
  });

  it('o detector de vazamento enxerga os dados do próprio espaço (senão os "sem vazamento" acima seriam vazios)', async () => {
    const conn = await userConn('dona');
    await resetLimits();
    const bookings = MANAGE_OPS.find((op) => op.path.endsWith('{spaceId}/bookings')) as Operation;
    const own = await api(manageUrl(bookings, A), conn.token);
    expect(own.status).toBe(200);
    expect(leaks(own.body, MARKS_A)).toEqual(
      expect.arrayContaining(['Cliente Aurora', 'Carlos Balcão']),
    );
    const adminConn = await userConn('donob');
    const bOwn = await api(manageUrl(bookings, B), adminConn.token);
    expect(bOwn.status).toBe(200);
    expect(leaks(bOwn.body, MARKS_B).length + (bOwn.body.items?.length ?? 0)).toBeGreaterThan(0);
  });
});

/** Só os ids de filhos (tudo menos o do espaço). */
function pickChildren(params: SpaceParams): Partial<SpaceParams> {
  const { spaceId: _ignored, ...children } = params;
  return children;
}

describe('(2) as tools de gestão com o espaço, a quadra e a turma do outro espaço', () => {
  const TOOLS_COM_ESPACO = [
    'get_space_today',
    'list_space_bookings',
    'get_booking_metrics',
    'get_occupancy',
    'list_class_groups',
    'get_class_metrics',
    'get_customer_metrics',
    'get_reviews_summary',
    'get_revenue',
    'get_statement',
    'list_delinquents',
    'get_online_payments_summary',
  ];

  for (const [actorKey, ownKey, otherMarks] of [
    ['dona', 'a', MARKS_B],
    ['admin', 'a', MARKS_B],
    ['donob', 'b', MARKS_A],
  ] as const) {
    it(`${actorKey}: espaço do outro (id, slug e nome) → SPACE_NOT_FOUND em todas as ${TOOLS_COM_ESPACO.length} tools, sem dados`, async () => {
      const conn = await userConn(actorKey);
      const ownSpace = w.spaces[ownKey];
      const otherSpace = w.spaces[ownKey === 'a' ? 'b' : 'a'];
      const names = { id: otherSpace.id, slug: otherSpace.slug, name: otherSpace.name };
      await withClient(conn, async (client) => {
        const failures: string[] = [];
        for (const tool of TOOLS_COM_ESPACO) {
          for (const [how, value] of Object.entries(names)) {
            await tick();
            // Controle: o próprio espaço funciona (a tool existe e aceita o argumento).
            if (how === 'id') {
              const own = await safeCall(client, tool, { space: ownSpace.id });
              if (own.isError) failures.push(`controle ${tool}: ${own.code ?? own.thrown}`);
            }
            const res = await safeCall(client, tool, { space: value });
            if (!res.isError || res.code !== 'SPACE_NOT_FOUND') {
              failures.push(`${tool} (${how}) → ${res.isError ? res.code : 'SUCESSO'}`);
            }
            const text = JSON.stringify(res.data) + res.text;
            const found = otherMarks.filter(
              (mark) => text.includes(mark) && mark !== value && !value.includes(mark),
            );
            if (found.length) failures.push(`${tool} (${how}) vazou ${found.join(',')}`);
          }
        }
        expect(failures).toEqual([]);
      });
    });
  }

  it('dona: quadra e turma do outro espaço (id e nome) no espaço dela não devolvem nada do outro', async () => {
    const conn = await userConn('dona');
    await withClient(conn, async (client) => {
      const failures: string[] = [];
      const cases: [string, Record<string, unknown>][] = [
        ['list_space_bookings', { court: B.courtId }],
        ['list_space_bookings', { court: w.spaces.b.court1Name }],
        ['get_booking_metrics', { court: B.courtId }],
        ['get_occupancy', { court: B.courtId }],
        ['get_customer_metrics', { court: B.courtId }],
        ['get_revenue', { court: B.courtId }],
        ['get_class_metrics', { classGroup: B.classGroupId }],
        ['get_class_metrics', { classGroup: w.spaces.b.groupName }],
      ];
      for (const [tool, extra] of cases) {
        await tick();
        const res = await safeCall(client, tool, { space: w.spaces.a.slug, ...extra });
        const text = JSON.stringify(res.data) + res.text;
        // Ou erro de "não existe neste espaço", ou números zerados; nunca dado do B.
        if (
          leaks(text, MARKS_B).length &&
          !JSON.stringify(extra).includes(leaks(text, MARKS_B)[0] ?? '#')
        ) {
          failures.push(`${tool} ${JSON.stringify(extra)} vazou`);
        }
        if (!res.isError) {
          const totals = res.data.totals;
          const rows = (res.data.rows ?? res.data.bookings ?? []) as {
            key?: string;
            id?: string;
          }[];
          if (
            totals &&
            Object.values(totals).some(
              (value) =>
                typeof value === 'number' &&
                value > 0 &&
                !/Rate|hours|openHours|availableHours/i.test(String(value)),
            )
          ) {
            // totais com número positivo para um filtro que não é do espaço: só tolerado nas horas de funcionamento
            const positive = Object.entries(totals).filter(
              ([key, value]) =>
                typeof value === 'number' && value > 0 && !/openHours|availableHours/.test(key),
            );
            if (positive.length)
              failures.push(`${tool} ${JSON.stringify(extra)} totais ${JSON.stringify(positive)}`);
          }
          if (
            rows.some(
              (row) =>
                row.key === B.courtId || row.key === B.classGroupId || row.id === B.bookingId,
            )
          ) {
            failures.push(`${tool} ${JSON.stringify(extra)} devolveu linha do outro`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  });
});

describe('(2) Professor forçando rotas de valor (decisão 53; RN-MCP-06)', () => {
  it('o Professor que também é Dono em outro espaço TEM o escopo de valores, e mesmo assim não vê valores onde é Professor', async () => {
    const conn = await userConn('profdono');
    expect(conn.tokens.scope.split(' ')).toContain('manage:finance:read');
    const C = w.spaces.c;
    const failures: string[] = [];
    for (const op of FINANCE_OPS.concat(
      MANAGE_OPS.filter((o) => /analytics\/customers/.test(o.path)),
    )) {
      await tick();
      // No espaço A (Professor): 403 SPACE_FORBIDDEN, com o escopo certo no token.
      const denied = await api(manageUrl(op, A), conn.token);
      if (denied.status !== 403 || denied.body?.error?.code !== 'SPACE_FORBIDDEN') {
        failures.push(`A ${op.path} → ${denied.status} ${denied.body?.error?.code ?? ''}`);
      }
      // No espaço C (Dono): a mesma rota responde (controle positivo; ids de C que não existem dão 404).
      await tick();
      const allowed = await api(manageUrl(op, { ...A, spaceId: C.id }), conn.token);
      if (![200, 404].includes(allowed.status)) {
        failures.push(`C ${op.path} → ${allowed.status} ${allowed.body?.error?.code ?? ''}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('reservas do espaço A para o Professor com o escopo de valores: sem preço, pago, devido nem pagamentos', async () => {
    const conn = await userConn('profdono');
    await resetLimits();
    const list = await api(
      manageUrl(MANAGE_OPS.find((op) => op.path.endsWith('/bookings')) as Operation, A),
      conn.token,
    );
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(5);
    const text = JSON.stringify(list.body);
    expect(text).not.toMatch(
      /"priceCents":[1-9]|"paidCents":[1-9]|"dueCents":[1-9]|"amountCents":[1-9]/,
    );
    for (const item of list.body.items as Record<string, unknown>[]) {
      expect(item.payments ?? []).toEqual([]);
    }
    const detail = await api(`/v1/manage/spaces/${A.spaceId}/bookings/${A.bookingId}`, conn.token);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toMatch(
      /"amountCents":[1-9]|"priceCents":[1-9]|"paidCents":[1-9]/,
    );
  });

  it('pelas tools: valores e clientes → SPACE_FORBIDDEN no A; no C (Dono) funcionam; get_space_today do A vem sem valores', async () => {
    const conn = await userConn('profdono');
    await withClient(conn, async (client) => {
      await resetLimits();
      const spaces = await safeCall(client, 'list_my_managed_spaces');
      const byId = Object.fromEntries(
        (spaces.data.spaces as { id: string; roles: string[]; seesValues: boolean }[]).map((s) => [
          s.id,
          s,
        ]),
      );
      expect(byId[A.spaceId]).toMatchObject({ roles: ['Professor'], seesValues: false });
      expect(byId[w.spaces.c.id]).toMatchObject({ roles: ['Dono'], seesValues: true });
      for (const tool of [
        'get_revenue',
        'get_statement',
        'list_delinquents',
        'get_online_payments_summary',
        'get_customer_metrics',
      ]) {
        await tick();
        const denied = await safeCall(client, tool, { space: A.spaceId });
        expect(denied.isError, tool).toBe(true);
        expect(denied.code, tool).toBe('SPACE_FORBIDDEN');
        expect(JSON.stringify(denied.data), tool).not.toMatch(
          /receivedCents|"cents":[1-9]|studentName/,
        );
        const allowed = await safeCall(client, tool, { space: w.spaces.c.id });
        expect(allowed.isError, `${tool} no C: ${allowed.code}`).toBe(false);
      }
      const today = await safeCall(client, 'get_space_today', { space: A.spaceId });
      expect(today.data.values).toBeNull();
      expect(today.data.valuesNote).toMatch(/Professor/);
      const todayC = await safeCall(client, 'get_space_today', { space: w.spaces.c.id });
      expect(todayC.data.values).not.toBeNull();
      // Sem dizer o espaço, a pessoa tem dois: a tool pergunta em vez de escolher.
      const ambiguous = await safeCall(client, 'get_revenue', {});
      expect(ambiguous.code).toBe('SPACE_REQUIRED');
    });
  });

  it('o Professor comum (sem o escopo de valores) leva 403 de escopo em toda rota de valores', async () => {
    const conn = await userConn('prof1');
    const failures: string[] = [];
    for (const op of FINANCE_OPS) {
      await tick();
      const res = await api(manageUrl(op, A), conn.token);
      if (res.status !== 403 || res.body?.error?.code !== 'OAUTH_INSUFFICIENT_SCOPE') {
        failures.push(`${op.path} → ${res.status} ${res.body?.error?.code ?? ''}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('o Professor não alcança as aulas de outro professor (detalhe, frequência, presenças, lista e métricas)', async () => {
    const conn = await userConn('prof1');
    await resetLimits();
    const base = `/v1/manage/spaces/${A.spaceId}`;
    const { from, to } = w.windows;
    const group2 = w.spaces.a.group2Id as string;
    const session2 = w.sessionIds.s4 as string;
    for (const path of [
      `/class-groups/${group2}`,
      `/class-groups/${group2}/frequency?from=${from}&to=${to}`,
      `/class-sessions/${session2}`,
    ]) {
      const res = await api(base + path, conn.token);
      expect(res.status, path).toBe(404);
    }
    for (const path of [
      `/class-attendances?classGroupId=${group2}&from=${from}&to=${to}`,
      `/class-sessions?classGroupId=${group2}&from=${from}&to=${to}`,
    ]) {
      const res = await api(base + path, conn.token);
      expect(res.status, path).toBe(200);
      expect(res.body.items, path).toEqual([]);
    }
    const metrics = await api(
      `${base}/analytics/classes?from=${from}&to=${to}&groupBy=classGroup&classGroupId=${group2}`,
      conn.token,
    );
    expect(metrics.status).toBe(200);
    expect(metrics.body.totals.sessionsDone).toBe(0);
    expect((metrics.body.rows as { key: string }[]).map((row) => row.key)).not.toContain(group2);
    // Nem o nome da turma dele aparece na lista de turmas, nem o da outra (com o texto hostil).
    const groups = await api(`${base}/class-groups`, conn.token);
    expect(JSON.stringify(groups.body)).not.toContain('SYSTEM');
    // A equipe é do painel de Dono e Admin: o Professor nem a lista vê.
    expect((await api(`${base}/team`, conn.token)).status).toBe(403);
  });
});
