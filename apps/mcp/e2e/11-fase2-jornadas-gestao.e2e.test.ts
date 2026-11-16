import { describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import { bookingTotals, occupancy, round4 } from './support/expected.js';
import {
  byKey,
  type MetricRow,
  readCount,
  resetLimits,
  safeCall,
  userConn,
  withClient,
  world,
} from './support/fase2.js';
import { brl } from './support/helpers.js';
import { ok } from './support/mcp.js';
import { localInstant, nextDay, SESSIONS_A } from './support/world.js';

// Fase 2, jornadas de GESTÃO pelo SDK do MCP por HTTP, com API e MCP reais (docs/14-mcp.md 8.2,
// 8.4 e 8.5; RF-MCP-06 e RF-MCP-08; RN-MCP-06 a 09; decisões 53, 120, 121 e 124). Os números saem
// do mundo montado em support/world.ts (calculados à mão em support/expected.ts e conferidos por SQL).

const GESTAO = [
  'list_my_managed_spaces',
  'get_space_today',
  'list_space_bookings',
  'get_booking_metrics',
  'get_occupancy',
  'list_class_groups',
  'get_class_metrics',
  'get_customer_metrics',
  'get_reviews_summary',
];
const VALORES = ['get_revenue', 'get_statement', 'list_delinquents', 'get_online_payments_summary'];
const PRIMEIRO_FOCO = 'qa-f2-a';

/** Receita do espaço por SQL (independente das métricas), no período em datas locais. */
async function sqlRevenue(spaceId: string, from: string, to: string) {
  const start = localInstant(from, '00:00').toISOString();
  const end = localInstant(nextDay(to), '00:00').toISOString();
  return sql<{ method: string; received: string; n: string; reversed: string }>(
    `select method,
            coalesce(sum(amount_cents) filter (where reversed_at is null), 0) as received,
            count(*) filter (where reversed_at is null) as n,
            coalesce(sum(amount_cents) filter (where reversed_at is not null), 0) as reversed
       from payment_records where space_id = $1 and paid_at >= $2 and paid_at < $3 group by method`,
    [spaceId, start, end],
  );
}

/** A mesma jornada para quem vê valores (Dono e Admin): decisão 53. */
function journeyWithValues(key: 'dona' | 'admin', roleLabel: 'Dono' | 'Admin') {
  describe(`(1) ${roleLabel}: receita por forma de pagamento, ocupação por dia da semana e inadimplentes`, () => {
    const w = world();
    const { from, to } = w.windows;

    it('conecta com os 7 escopos e vê as 27 tools (14 de jogador + 13 de gestão)', async () => {
      const conn = await userConn(key, { fresh: true });
      expect(conn.tokens.scope.split(' ').sort()).toEqual(
        [
          'bookings:read',
          'bookings:write',
          'classes:read',
          'classes:write',
          'manage:finance:read',
          'manage:read',
          'offline_access',
          'spaces:read',
        ].sort(),
      );
      expect(conn.connected.consentRequest).toMatchObject({
        canAuthorize: true,
        deniedScopes: [],
        resource: { kind: 'USER', maxConnectionHours: null },
      });
      await withClient(conn, async (client) => {
        const names = (await client.listTools()).tools.map((t) => t.name);
        expect(names).toHaveLength(27);
        for (const name of [...GESTAO, ...VALORES]) expect(names, name).toContain(name);
        const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
        expect(prompts.sort()).toEqual(['ocupacao_da_semana', 'relatorio_mensal_do_espaco']);
      });
    });

    it('list_my_managed_spaces: só o espaço A, com o papel e os valores liberados', async () => {
      await withClient(await userConn(key), async (client) => {
        const data = await ok(client, 'list_my_managed_spaces');
        expect(data.spaces).toHaveLength(1);
        expect(data.spaces[0]).toMatchObject({
          id: w.spaces.a.id,
          slug: PRIMEIRO_FOCO,
          roles: [roleLabel],
          seesValues: true,
        });
        expect(JSON.stringify(data)).not.toContain(w.spaces.b.name);
      });
    });

    it('get_revenue por forma de pagamento: bate com o mundo e com o SQL (RF-MCP-08, RN-MCP-09)', async () => {
      await withClient(await userConn(key), async (client) => {
        const data = await ok(client, 'get_revenue', {
          space: PRIMEIRO_FOCO,
          from,
          to,
          groupBy: 'method',
        });
        expect(data.period).toEqual({ from, to });
        expect(data.timezone).toBe('America/Sao_Paulo');
        const rows = byKey(data.rows as MetricRow[]);
        // Pix: b1 (23:50), b3 (parcial), b9 e a mensalidade da Dani; cartão: b5; dinheiro: b2.
        expect(rows.PIX).toMatchObject({ receivedCents: 39_000, paymentsCount: 4 });
        expect(rows.CARD).toMatchObject({ receivedCents: 20_000, paymentsCount: 1 });
        // O pagamento em dinheiro de b7 foi estornado: não entra em "recebido", entra em "estornado".
        expect(rows.CASH).toMatchObject({
          receivedCents: 15_000,
          paymentsCount: 1,
          reversedCents: 10_000,
        });
        expect(rows.OTHER).toMatchObject({ receivedCents: 0, paymentsCount: 0 });
        expect(rows.PIX?.receivedFormatted).toBe(brl(39_000));
        expect(data.totals).toMatchObject({
          receivedCents: 74_000,
          paymentsCount: 6,
          reversedCents: 10_000,
          // b3 (R$ 60,00 em aberto) + b4 + b7 (estornado, volta a dever) + b10 + a mensalidade da Fabi.
          receivableCents: 51_000,
          receivedFormatted: brl(74_000),
          receivableFormatted: brl(51_000),
        });
        // Por forma, o "a receber" não existe (não tem forma): vem nulo na linha e preenchido no total.
        expect(rows.PIX?.receivableCents).toBeNull();
        // Conferência independente por SQL.
        const sqlRows = Object.fromEntries(
          (await sqlRevenue(w.spaces.a.id, from, to)).map((r) => [r.method, r]),
        );
        for (const method of ['PIX', 'CARD', 'CASH']) {
          expect(Number(sqlRows[method]?.received), method).toBe(rows[method]?.receivedCents);
          expect(Number(sqlRows[method]?.n), method).toBe(rows[method]?.paymentsCount);
        }
        expect(Number(sqlRows.CASH?.reversed)).toBe(10_000);
      });
    });

    it('get_revenue por mês: a soma dos meses é o total e cada mês cai na data local do pagamento', async () => {
      await withClient(await userConn(key), async (client) => {
        const data = await ok(client, 'get_revenue', {
          space: PRIMEIRO_FOCO,
          from,
          to,
          groupBy: 'month',
        });
        const rows = data.rows as MetricRow[];
        expect(rows.reduce((sum, r) => sum + (r.receivedCents as number), 0)).toBe(74_000);
        const sqlByMonth = await sql<{ month: string; received: string }>(
          `select to_char(paid_at at time zone 'America/Sao_Paulo', 'YYYY-MM') as month,
                  sum(amount_cents) as received
             from payment_records
            where space_id = $1 and reversed_at is null
              and paid_at >= $2 and paid_at < $3 group by 1`,
          [
            w.spaces.a.id,
            localInstant(from, '00:00').toISOString(),
            localInstant(to, '23:59').toISOString(),
          ],
        );
        for (const expected of sqlByMonth) {
          expect(rowOf(rows, expected.month)?.receivedCents, expected.month).toBe(
            Number(expected.received),
          );
        }
      });
    });

    it('get_occupancy por dia da semana: funcionamento, bloqueio e horas reservadas (com a reserva que atravessa a meia-noite)', async () => {
      await withClient(await userConn(key), async (client) => {
        const data = await ok(client, 'get_occupancy', {
          space: PRIMEIRO_FOCO,
          from,
          to,
          groupBy: 'weekday',
        });
        const expected = occupancy(from, to, 'weekday');
        expect(data.rows).toHaveLength(7);
        for (const row of data.rows as MetricRow[]) {
          const want = expected.get(Number(row.key));
          expect(want, `dia ${row.key}`).toBeDefined();
          const available = (want?.open ?? 0) - (want?.blocked ?? 0);
          expect(row.openHours, `${row.label} funcionamento`).toBe(want?.open);
          expect(row.blockedHours, `${row.label} bloqueio`).toBe(want?.blocked);
          expect(row.availableHours, `${row.label} disponível`).toBe(available);
          expect(row.bookedHours, `${row.label} reservadas`).toBe(want?.booked);
          expect(row.occupancyRate, `${row.label} taxa`).toBeCloseTo(
            round4((want?.booked ?? 0) / available),
            4,
          );
        }
        // 14 dias x 2 quadras x 24 h; 2 h de bloqueio; 9,5 h reservadas (8 reservas que contam).
        expect(data.totals).toMatchObject({
          openHours: 672,
          blockedHours: 2,
          availableHours: 670,
          bookedHours: 9.5,
          classHours: 0,
        });
        expect(data.totals.occupancyRate).toBeCloseTo(9.5 / 670, 4);
      });
    });

    it('get_occupancy por hora: 23:30-00:30 divide a hora entre o fim de um dia e o começo do outro', async () => {
      await withClient(await userConn(key), async (client) => {
        const data = await ok(client, 'get_occupancy', {
          space: PRIMEIRO_FOCO,
          from,
          to,
          groupBy: 'hour',
        });
        const expected = occupancy(from, to, 'hour');
        const rows = data.rows as MetricRow[];
        expect(rows).toHaveLength(24);
        for (const row of rows) {
          const want = expected.get(Number.parseInt(String(row.key), 10));
          expect(row.bookedHours, `hora ${row.key}`).toBe(want?.booked);
          expect(row.blockedHours, `hora ${row.key}`).toBe(want?.blocked);
        }
        // b3 (23:30-00:30): meia hora na hora 23 e meia na hora 0; b7 (00:30-01:30) pega a outra meia da 0.
        expect(rows.find((r) => Number.parseInt(String(r.key), 10) === 0)?.bookedHours).toBe(1);
        expect(rows.find((r) => Number.parseInt(String(r.key), 10) === 23)?.bookedHours).toBe(0.5);
      });
    });

    it('list_delinquents: Fabi (2 mensalidades vencidas) e Edu (1); a dispensada e a em dia não contam', async () => {
      await withClient(await userConn(key), async (client) => {
        const data = await ok(client, 'list_delinquents', { space: PRIMEIRO_FOCO });
        expect(data.totalOverdue.cents).toBe(45_000);
        expect(data.delinquents.map((d: { studentName: string }) => d.studentName)).toEqual([
          'Aluna Fabi',
          'Aluno Edu',
        ]);
        expect(data.delinquents[0]).toMatchObject({
          overdueCount: 2,
          overdue: { cents: 30_000, formatted: brl(30_000) },
          subscriptionStatus: 'PAST_DUE',
        });
        expect(data.delinquents[1]).toMatchObject({ overdueCount: 1, overdue: { cents: 15_000 } });
        // SQL: só mensalidades OVERDUE do espaço A.
        const [row] = await sql<{ total: string; students: string }>(
          `select sum(c.amount_cents) as total, count(distinct s.user_id) as students
             from subscription_charges c join subscriptions s on s.id = c.subscription_id
            where s.space_id = $1 and c.status = 'OVERDUE'`,
          [w.spaces.a.id],
        );
        expect(Number(row?.total)).toBe(45_000);
        expect(Number(row?.students)).toBe(2);
      });
    });

    it('reservas, clientes, turmas, extrato e carteira: números do mundo', async () => {
      await withClient(await userConn(key), async (client) => {
        const bookings = await ok(client, 'get_booking_metrics', {
          space: PRIMEIRO_FOCO,
          from,
          to,
          groupBy: 'status',
        });
        const want = bookingTotals(from, to);
        expect(bookings.totals).toMatchObject({
          bookings: want.bookings,
          hours: want.hours,
          noShows: want.noShows,
          cancelled: want.cancelled,
        });
        expect(bookings.totals.cancellationRate).toBeCloseTo(want.cancellationRate ?? 0, 4);
        // PENDING_PAYMENT (b8) não conta em lugar nenhum.
        expect(JSON.stringify(bookings.rows)).not.toContain('PENDING_PAYMENT');

        const customers = await ok(client, 'get_customer_metrics', {
          space: PRIMEIRO_FOCO,
          from,
          to,
          groupBy: 'customer',
        });
        expect(customers.totals).toMatchObject({
          customers: 3,
          newCustomers: 1,
          returningCustomers: 2,
          recurringCustomers: 0,
          bookings: 8,
        });
        expect((customers.rows as MetricRow[]).map((r) => r.label).sort()).toEqual([
          'Carlos Balcão',
          'Cliente Aurora',
          'Cliente Bruno',
        ]);
        // O convidado do balcão vem com chave sintética, nunca com o telefone.
        expect((customers.rows as MetricRow[]).some((r) => /^guest-\d+$/.test(r.key))).toBe(true);

        const statement = await ok(client, 'get_statement', { space: PRIMEIRO_FOCO, from, to });
        expect(statement.totals).toMatchObject({ paymentsCount: 6 });
        expect(statement.totals.received.cents).toBe(74_000);
        expect(statement.totals.reversed.cents).toBe(10_000);

        const online = await ok(client, 'get_online_payments_summary', {
          space: PRIMEIRO_FOCO,
          from,
          to,
        });
        // O espaço A não aceita pagamento online: nada recebido pelo canal ONLINE.
        expect(JSON.stringify(online)).not.toMatch(/"channel":"ONLINE","receivedCents":[1-9]/);

        const today = await ok(client, 'get_space_today', { space: PRIMEIRO_FOCO });
        expect(today.values).not.toBeNull();
        expect(today.bookings).toHaveLength(1); // b10, hoje às 07:00
        expect(today.bookings[0]).toMatchObject({
          customerName: 'Cliente Aurora',
          paymentState: 'OPEN',
          due: { cents: 10_000 },
        });
      });
    });

    it('get_space_today e list_space_bookings: valores liberados; convidado pelo nome, sem telefone', async () => {
      await withClient(await userConn(key), async (client) => {
        const list = await ok(client, 'list_space_bookings', {
          space: PRIMEIRO_FOCO,
          from,
          to,
          limit: 50,
        });
        const items = list.bookings as { id: string; price: { cents: number } | null }[];
        // 10 reservas na janela atual (inclui a cancelada e a aguardando pagamento).
        expect(items).toHaveLength(10);
        expect(items.every((item) => item.price !== null)).toBe(true);
        const text = JSON.stringify(list);
        expect(text).not.toContain('+5531977001001');
        expect(text).not.toContain('guestPhone');
      });
    });
  });
}

journeyWithValues('dona', 'Dono');
journeyWithValues('admin', 'Admin');

describe('(1) Professor: presença das turmas dele, sem valores e sem clientes (decisão 53)', () => {
  const w = world();
  const { from, to } = w.windows;

  it('conecta só com manage:read (sem finance) e vê 23 tools: nenhuma de valores', async () => {
    const conn = await userConn('prof1', { fresh: true });
    expect(conn.tokens.scope.split(' ')).toContain('manage:read');
    expect(conn.tokens.scope.split(' ')).not.toContain('manage:finance:read');
    expect(conn.connected.consentRequest?.deniedScopes).toEqual(['manage:finance:read']);
    expect(conn.connected.consentRequest?.scopes).not.toContain('manage:finance:read');
    await withClient(conn, async (client) => {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toHaveLength(23);
      for (const name of VALORES) expect(names, name).not.toContain(name);
      for (const name of GESTAO) expect(names, name).toContain(name);
    });
  });

  it('presença por turma e por professor: só a turma dele, com a taxa e os alunos ativos do mundo', async () => {
    await withClient(await userConn('prof1'), async (client) => {
      const groups = await ok(client, 'get_class_metrics', {
        space: PRIMEIRO_FOCO,
        from,
        to,
        groupBy: 'classGroup',
      });
      const rows = groups.rows as MetricRow[];
      expect(rows.map((r) => r.key)).toEqual([w.spaces.a.groupId]);
      expect(rows[0]).toMatchObject({
        label: 'Turma Um Fase',
        sessionsDone: 2,
        sessionsCancelled: 1,
        present: 3,
        absent: 2,
        unmarked: 1,
        activeStudents: 3,
      });
      expect(rows[0]?.attendanceRate).toBeCloseTo(0.6, 4);
      // A turma da Professora Dois (e o nome com texto hostil) nem aparece para ele.
      expect(JSON.stringify(groups)).not.toContain('SYSTEM');
      expect(groups.totals).toMatchObject({ sessionsDone: 2, present: 3, absent: 2 });

      const teachers = await ok(client, 'get_class_metrics', {
        space: PRIMEIRO_FOCO,
        from,
        to,
        groupBy: 'teacher',
      });
      expect((teachers.rows as MetricRow[]).map((r) => r.label)).toEqual(['Professor Um Fase']);

      const list = await ok(client, 'list_class_groups', { space: PRIMEIRO_FOCO });
      expect(list.classGroups.map((g: { name: string }) => g.name)).toEqual(['Turma Um Fase']);
    });
  });

  it('a Professora Dois enxerga só a turma dela (1 aula dada, 2 presentes, taxa 100%)', async () => {
    await withClient(await userConn('prof2'), async (client) => {
      const data = await ok(client, 'get_class_metrics', {
        space: PRIMEIRO_FOCO,
        from,
        to,
        groupBy: 'classGroup',
      });
      const rows = data.rows as MetricRow[];
      expect(rows.map((r) => r.key)).toEqual([w.spaces.a.group2Id]);
      expect(rows[0]).toMatchObject({ sessionsDone: 1, present: 2, absent: 0, activeStudents: 2 });
      expect(rows[0]?.attendanceRate).toBe(1);
    });
  });

  it('o mesmo dado por SQL: presenças das aulas dadas na janela (Turma Um)', async () => {
    const rows = await sql<{ status: string; n: string }>(
      `select a.status, count(*) as n
         from attendances a join class_sessions s on s.id = a.session_id
        where s.class_group_id = $1 and s.status = 'DONE' group by a.status`,
      [w.spaces.a.groupId],
    );
    const counts = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    expect(counts).toEqual({ PRESENT: 3, ABSENT: 2, CONFIRMED: 1 });
    expect(SESSIONS_A.filter((s) => s.group === 'G1' && s.status === 'DONE')).toHaveLength(2);
  });

  it('sem valores: get_space_today e list_space_bookings vêm sem dinheiro, com a explicação', async () => {
    await withClient(await userConn('prof1'), async (client) => {
      const today = await ok(client, 'get_space_today', { space: PRIMEIRO_FOCO });
      expect(today.values).toBeNull();
      expect(today.valuesNote).toMatch(/Professor não vê dinheiro/);
      expect(today.bookings[0]).toMatchObject({
        paymentState: 'UNAVAILABLE',
        paid: null,
        due: null,
      });
      const list = await ok(client, 'list_space_bookings', { space: PRIMEIRO_FOCO, from, to });
      for (const item of list.bookings) {
        expect(item.price).toBeNull();
        expect(item.paid).toBeNull();
        expect(item.due).toBeNull();
      }
      expect(list.valuesNote ?? list.note).toMatch(/Sem valores/);
    });
  });

  it('clientes: SPACE_FORBIDDEN com orientação para não estimar; valores: a tool nem existe', async () => {
    await withClient(await userConn('prof1'), async (client) => {
      const customers = await safeCall(client, 'get_customer_metrics', {
        space: PRIMEIRO_FOCO,
        from,
        to,
      });
      expect(customers.isError).toBe(true);
      expect(customers.code).toBe('SPACE_FORBIDDEN');
      expect(customers.data.error.message).toMatch(/não estime/i);
      for (const name of VALORES) {
        const res = await safeCall(client, name, { space: PRIMEIRO_FOCO });
        // O servidor recusa o `tools/call` (403 de escopo) ou a tool é desconhecida: nunca devolve números.
        expect(res.isError, name).toBe(true);
        expect(res.data.rows ?? res.data.totals ?? res.data.delinquents, name).toBeUndefined();
      }
    });
  });

  it('o relatório mensal (prompt) do Professor não cita receita nem inadimplência', async () => {
    await withClient(await userConn('prof1'), async (client) => {
      const prompt = await client.getPrompt({
        name: 'relatorio_mensal_do_espaco',
        arguments: { espaco: PRIMEIRO_FOCO },
      });
      const text = prompt.messages
        .map((m) => (m.content.type === 'text' ? m.content.text : ''))
        .join('\n');
      expect(text).not.toMatch(/get_revenue|list_delinquents|get_online_payments_summary/);
      expect(text).toMatch(/get_booking_metrics/);
    });
  });
});

describe('(1) Dono: reservas por canal e origem (cruza com o canal MCP do mundo)', () => {
  it('get_booking_metrics por canal: a reserva feita pelo assistente (b3) aparece separada', async () => {
    const w = world();
    await withClient(await userConn('dona'), async (client) => {
      const data = await ok(client, 'get_booking_metrics', {
        space: PRIMEIRO_FOCO,
        from: w.windows.from,
        to: w.windows.to,
        groupBy: 'channel',
      });
      const rows = byKey(data.rows as MetricRow[]);
      expect(rows.MCP).toMatchObject({ bookings: 1, hours: 1 });
      expect(rows.DIRECT).toMatchObject({ bookings: 7 });
    });
  });
});

function rowOf(rows: MetricRow[], key: string) {
  return rows.find((row) => row.key === key);
}

/** O roteiro do prompt `relatorio_mensal_do_espaco` (docs/14-mcp.md 8.5): as chamadas que o assistente faz. */
function monthlyReport(withValues: boolean): [string, Record<string, unknown>][] {
  const w = world();
  const space = w.spaces.a.slug;
  const month = { from: w.windows.from, to: w.windows.to };
  const previous = { from: w.windows.previousFrom, to: w.windows.previousTo };
  const calls: [string, Record<string, unknown>][] = [
    ['list_my_managed_spaces', {}],
    ['get_booking_metrics', { space, ...month, groupBy: 'week' }],
    ['get_booking_metrics', { space, ...month, groupBy: 'weekday' }],
    ['get_booking_metrics', { space, ...month, groupBy: 'source' }],
    ['get_occupancy', { space, ...month, groupBy: 'weekday' }],
    ['get_occupancy', { space, ...month, groupBy: 'court' }],
    ['get_class_metrics', { space, ...month, groupBy: 'classGroup' }],
    ['get_customer_metrics', { space, ...month, groupBy: 'customer' }],
    ['get_customer_metrics', { space, ...month, groupBy: 'week' }],
    ['get_reviews_summary', { space }],
    ['get_booking_metrics', { space, ...previous }],
  ];
  if (withValues) {
    calls.push(
      ['get_revenue', { space, ...month, groupBy: 'method' }],
      ['get_revenue', { space, ...month, groupBy: 'week' }],
      ['list_delinquents', { space }],
      ['get_online_payments_summary', { space, ...month }],
      ['get_revenue', { space, ...previous }],
    );
  }
  return calls;
}

describe('(1) o relatório mensal cabe no limite de 60 leituras/min por usuário (RN-MCP-03)', () => {
  it('Dono: o roteiro inteiro gasta no máximo as 18 leituras da documentação; sem valores, no máximo 12', async () => {
    const w = world();
    for (const [key, withValues, max] of [
      ['dona', true, 18],
      ['prof1', false, 12],
    ] as const) {
      const conn = await userConn(key);
      const person = w.people[key];
      await withClient(conn, async (client) => {
        await resetLimits();
        for (const [tool, args] of monthlyReport(withValues)) {
          // O Professor não alcança os clientes; a tool recusa, mas a leitura já foi gasta no cache/lista.
          if (key === 'prof1' && tool === 'get_customer_metrics') continue;
          const res = await safeCall(client, tool, args);
          expect(res.isError, `${key} ${tool}: ${res.code ?? res.thrown}`).toBe(false);
        }
        const used = await readCount(person?.id as string);
        expect(used, `${key} leituras`).toBeLessThanOrEqual(max);
        expect(used, `${key} leituras`).toBeGreaterThanOrEqual(max - 6);
      });
    }
  });

  it('repetido até passar de 60 leituras: a tool responde TOO_MANY_REQUESTS com orientação, sem dados e sem virar API_UNAVAILABLE', async () => {
    const conn = await userConn('admin');
    await withClient(conn, async (client) => {
      await resetLimits();
      let limited: Awaited<ReturnType<typeof safeCall>> | undefined;
      for (let round = 0; round < 6 && !limited; round++) {
        for (const [tool, args] of monthlyReport(true)) {
          const res = await safeCall(client, tool, args);
          if (res.isError) {
            limited = res;
            break;
          }
        }
      }
      expect(limited?.code).toBe('TOO_MANY_REQUESTS');
      expect(limited?.text).toMatch(/Espere|aguard|tentar de novo/i);
      expect(JSON.stringify(limited?.data)).not.toMatch(/"rows"|"totals"/);
      await resetLimits();
    });
  });
});
