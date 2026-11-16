import { describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import {
  type Conn,
  resetLimits,
  safeCall,
  superConn,
  tick,
  userConn,
  withClient,
  world,
} from './support/fase2.js';
import { api } from './support/oauth.js';
import { localDate, localInstant, nextDay } from './support/world.js';

// Fase 2, períodos hostis nas métricas (docs/14-mcp.md 8.4, "Contrato comum" e "Erros"; RN-MCP-09):
// 367 dias, from > to, datas inválidas, extremos do calendário e o FUSO (23:30 de São Paulo é o dia
// seguinte em UTC). Cada caso vale para as rotas cruas e para as tools (que validam antes).

const w = world();
const SPACE = w.spaces.a.id;
const base = `/v1/manage/spaces/${SPACE}/analytics`;
const today = localDate(0);
const enc = encodeURIComponent;

/** As 5 métricas de gestão que aceitam `from`/`to` (a receita exige o escopo de valores: o Dono tem). */
const MANAGE_METRICS = ['bookings', 'occupancy', 'classes', 'customers', 'revenue'];
const SUPER_METRICS = ['platform', 'spaces'];

const manage = async (token: string, metric: string, query: string) => {
  await tick();
  return api(`${base}/${metric}?${query}`, token);
};
const sup = async (token: string, metric: string, query: string) => {
  await tick();
  return api(`/v1/super/analytics/${metric}?${query}`, token);
};
/** Linhas de auditoria das leituras do Super (toda chamada do token do Super que chega à API). */
const auditCount = async () =>
  Number(
    (
      await sql<{ n: string }>(
        `select count(*) as n from audit_logs where action = 'mcp.admin_request'`,
      )
    )[0]?.n,
  );

describe('(2) limites do período: 366 dias vale, 367 não (ANALYTICS_MAX_RANGE_DAYS)', () => {
  it('rotas de gestão e do Super: 366 dias → 200; 367 → 422 ANALYTICS_PERIOD_TOO_LONG', async () => {
    const owner = await userConn('dona');
    const root = await superConn();
    const ok = `from=${localDate(-365)}&to=${today}`;
    const tooLong = `from=${localDate(-366)}&to=${today}`;
    for (const metric of MANAGE_METRICS) {
      expect((await manage(owner.token, metric, ok)).status, `${metric} 366`).toBe(200);
      const res = await manage(owner.token, metric, tooLong);
      expect([res.status, res.body?.error?.code], `${metric} 367`).toEqual([
        422,
        'ANALYTICS_PERIOD_TOO_LONG',
      ]);
    }
    for (const metric of SUPER_METRICS) {
      expect((await sup(root.token, metric, ok)).status, `super ${metric} 366`).toBe(200);
      const res = await sup(root.token, metric, tooLong);
      expect([res.status, res.body?.error?.code], `super ${metric} 367`).toEqual([
        422,
        'ANALYTICS_PERIOD_TOO_LONG',
      ]);
    }
  });

  it('só from: muito antigo → 422 período longo; no futuro → 422 período inválido; só to vale (30 dias)', async () => {
    const owner = await userConn('dona');
    const old = await manage(owner.token, 'bookings', `from=${localDate(-400)}`);
    expect([old.status, old.body?.error?.code]).toEqual([422, 'ANALYTICS_PERIOD_TOO_LONG']);
    const future = await manage(owner.token, 'bookings', `from=${localDate(5)}`);
    expect([future.status, future.body?.error?.code]).toEqual([422, 'ANALYTICS_PERIOD_INVALID']);
    const onlyTo = await manage(owner.token, 'bookings', `to=${localDate(-20)}`);
    expect(onlyTo.status).toBe(200);
    expect(onlyTo.body.period).toEqual({ from: localDate(-49), to: localDate(-20) });
    // O mesmo dia (1 dia) e janela inteira no passado distante (sem dados) também são válidos; o
    // passado distante vai até 2000-01-01 (ANALYTICS_MIN_DATE, BUG-MCP2-2).
    const oneDay = await manage(owner.token, 'bookings', `from=${today}&to=${today}`);
    expect(oneDay.status).toBe(200);
    expect(oneDay.body.rows).toHaveLength(1);
    const ancient = await manage(owner.token, 'bookings', 'from=2000-01-01&to=2000-01-31');
    expect(ancient.status).toBe(200);
    expect(ancient.body.rows).toHaveLength(31);
    expect(ancient.body.totals.bookings).toBe(0);
  });

  it('from depois de to → 400 VALIDATION_ERROR em todas as rotas', async () => {
    const owner = await userConn('dona');
    const root = await superConn();
    const inverted = `from=${today}&to=${localDate(-3)}`;
    for (const metric of MANAGE_METRICS) {
      const res = await manage(owner.token, metric, inverted);
      expect([res.status, res.body?.error?.code], metric).toEqual([400, 'VALIDATION_ERROR']);
    }
    for (const metric of SUPER_METRICS) {
      const res = await sup(root.token, metric, inverted);
      expect([res.status, res.body?.error?.code], metric).toEqual([400, 'VALIDATION_ERROR']);
    }
  });

  it('pelas tools: os mesmos limites viram códigos estáveis com orientação, nunca API_UNAVAILABLE', async () => {
    await withClient(await userConn('dona'), async (client) => {
      await resetLimits();
      const cases: [Record<string, unknown>, string][] = [
        [{ from: localDate(-366), to: today }, 'ANALYTICS_PERIOD_TOO_LONG'],
        [{ from: localDate(-400) }, 'ANALYTICS_PERIOD_TOO_LONG'],
        [{ from: localDate(5) }, 'ANALYTICS_PERIOD_INVALID'],
      ];
      for (const [args, code] of cases) {
        for (const tool of [
          'get_booking_metrics',
          'get_occupancy',
          'get_class_metrics',
          'get_customer_metrics',
          'get_revenue',
        ]) {
          await tick();
          const res = await safeCall(client, tool, { space: w.spaces.a.slug, ...args });
          expect(res.isError, `${tool} ${JSON.stringify(args)}`).toBe(true);
          expect(res.code, `${tool} ${JSON.stringify(args)}`).toBe(code);
        }
      }
      await tick();
      const ok = await safeCall(client, 'get_booking_metrics', {
        space: w.spaces.a.slug,
        from: localDate(-365),
        to: today,
      });
      expect(ok.isError).toBe(false);
      const inverted = await safeCall(client, 'get_booking_metrics', {
        space: w.spaces.a.slug,
        from: today,
        to: localDate(-3),
      });
      expect(inverted.isError).toBe(true);
      expect(inverted.code).not.toBe('API_UNAVAILABLE');
    });
  });
});

describe('(2) datas inválidas e malformadas', () => {
  const invalid: [string, string][] = [
    ['30 de fevereiro', 'from=2026-02-30&to=2026-03-02'],
    ['29/02 em ano comum', 'from=2027-02-29&to=2027-03-01'],
    ['mês 13', 'from=2026-13-01&to=2026-13-02'],
    ['mês 00 / dia 00', 'from=2026-00-10&to=2026-01-00'],
    ['barras', 'from=2026/11/01&to=2026/11/05'],
    ['vazio', 'from=&to='],
    ['texto', 'from=abc&to=def'],
    ['sem zero à esquerda', 'from=2026-1-1&to=2026-1-5'],
    ['compacto', 'from=20261101&to=20261105'],
    ['com hora (ISO)', `from=${enc('2026-11-01T00:00:00Z')}&to=${enc('2026-11-05T00:00:00Z')}`],
    ['com deslocamento de fuso', `from=${enc('2026-11-01-03:00')}&to=2026-11-05`],
    ['espaço no fim', `from=${enc('2026-11-01 ')}&to=${enc('2026-11-05 ')}`],
    ['sinal de mais', `from=${enc('+2026-11-01')}&to=2026-11-05`],
    ['dígitos de largura total', `from=${enc('２０２６-１１-０１')}&to=2026-11-05`],
    ['ano de 5 dígitos', 'from=99999-01-01&to=99999-01-05'],
    ['parâmetro repetido', 'from=2026-11-01&from=2026-11-02&to=2026-11-05'],
    ['SQL', `from=${enc("2026-11-01'; drop table spaces;--")}&to=2026-11-05`],
    ['byte NUL', 'from=2026-11-01%00&to=2026-11-05'],
    ['groupBy fora da lista', `from=${localDate(-3)}&to=${today}&groupBy=${enc("day'; --")}`],
  ];

  it('rotas cruas: toda data malformada responde 400 VALIDATION_ERROR (nunca 200 nem 5xx)', async () => {
    const owner = await userConn('dona');
    const failures: string[] = [];
    for (const [name, query] of invalid) {
      const res = await manage(owner.token, 'revenue', query);
      if (res.status !== 400 || res.body?.error?.code !== 'VALIDATION_ERROR') {
        failures.push(`${name} → ${res.status} ${res.body?.error?.code ?? ''}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('as outras 4 métricas e as 2 do Super recusam o mesmo conjunto', async () => {
    const owner = await userConn('dona');
    const root = await superConn();
    const failures: string[] = [];
    for (const [name, query] of invalid.slice(0, 12)) {
      for (const metric of ['bookings', 'occupancy', 'classes', 'customers']) {
        const res = await manage(owner.token, metric, query);
        if (res.status !== 400) failures.push(`${metric}: ${name} → ${res.status}`);
      }
      for (const metric of SUPER_METRICS) {
        const res = await sup(root.token, metric, query);
        if (res.status !== 400) failures.push(`super ${metric}: ${name} → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('pelas tools: data malformada é recusada ANTES da API (validação do esquema), com mensagem em português', async () => {
    await withClient(await userConn('dona'), async (client) => {
      await resetLimits();
      for (const from of [
        '2026-02-30',
        '2027-02-29',
        '2026-13-01',
        'abc',
        '2026-11-01T00:00:00-03:00',
        '',
        '20261101',
        ' 2026-11-01',
      ]) {
        await tick();
        const res = await safeCall(client, 'get_booking_metrics', {
          space: w.spaces.a.slug,
          from,
          to: today,
        });
        expect(res.isError, from).toBe(true);
        expect(res.code, from).not.toBe('API_UNAVAILABLE');
        expect(JSON.stringify(res.data), from).not.toMatch(/"rows"|"totals"/);
      }
    });
    await withClient(await superConn(), async (client) => {
      for (const from of ['2026-02-30', 'abc', '']) {
        await tick();
        const res = await safeCall(client, 'get_platform_metrics', { from, to: today });
        expect(res.isError, from).toBe(true);
        expect(res.code, from).not.toBe('API_UNAVAILABLE');
      }
    });
  });

  it('filtros hostis: weekday fora de 0-6, horas invertidas, limit fora de 1-100 (200 nas comparações) e groupBy de outra métrica', async () => {
    const owner = await userConn('dona');
    const root = await superConn();
    const bad400: [string, string][] = [
      ['occupancy', 'weekday=7'],
      ['occupancy', 'weekday=-1'],
      ['occupancy', 'weekday=x'],
      ['occupancy', 'hourFrom=10&hourTo=10'],
      ['occupancy', 'hourFrom=-1'],
      ['occupancy', 'hourFrom=20&hourTo=8'],
      ['customers', 'groupBy=customer&limit=101'],
      ['customers', 'groupBy=customer&limit=0'],
      ['customers', 'groupBy=customer&limit=-1'],
      ['customers', 'groupBy=customer&limit=1.5'],
      ['customers', 'groupBy=customer&limit=abc'],
      ['classes', 'groupBy=hour'],
      ['bookings', 'groupBy=court&courtId=abc'],
      ['bookings', 'sportId=nao-e-uuid'],
      ['revenue', 'groupBy=customer'],
    ];
    for (const [metric, query] of bad400) {
      const res = await manage(owner.token, metric, query);
      expect([res.status, res.body?.error?.code], `${metric}?${query}`).toEqual([
        400,
        'VALIDATION_ERROR',
      ]);
    }
    const superBad = [
      'spaces?limit=201',
      'spaces?limit=0',
      'spaces?sort=x',
      'spaces?order=x',
      'spaces?status=x',
      'platform?groupBy=hour',
    ];
    for (const path of superBad) {
      await tick();
      const res = await api(`/v1/super/analytics/${path}`, root.token);
      expect([res.status, res.body?.error?.code], path).toEqual([400, 'VALIDATION_ERROR']);
    }
  });
});

describe('(2) fuso: 23:30 e 00:30 de São Paulo caem no dia certo (UTC-3), nas métricas, no extrato e na plataforma', () => {
  const day = (offset: number) => localDate(offset);

  it('reservas por dia: b3 (23:30, dia -3) conta no dia -3 e não no -2; b7 (00:30, dia -9) no -9 e não no -10', async () => {
    const owner = await userConn('dona');
    const count = async (offset: number) => {
      const res = await manage(owner.token, 'bookings', `from=${day(offset)}&to=${day(offset)}`);
      expect(res.status).toBe(200);
      return res.body.totals as { bookings: number; hours: number };
    };
    expect(await count(-3)).toMatchObject({ bookings: 1, hours: 1 }); // b3
    expect(await count(-2)).toMatchObject({ bookings: 1, hours: 1.5 }); // b2 (19:00), sem a b3
    expect(await count(-9)).toMatchObject({ bookings: 1, hours: 1 }); // b7
    expect(await count(-10)).toMatchObject({ bookings: 0 }); // b8 aguarda pagamento: não conta
    // O dia da semana do agrupamento é o LOCAL de b3.
    const weekday = await manage(
      owner.token,
      'bookings',
      `from=${day(-3)}&to=${day(-3)}&groupBy=weekday`,
    );
    const localWeekday = new Date(`${day(-3)}T12:00:00Z`).getUTCDay();
    const rows = weekday.body.rows as { key: string; bookings: number }[];
    expect(rows.find((row) => row.key === String(localWeekday))?.bookings).toBe(1);
    // Por hora de INÍCIO: 23h, não 2h (UTC).
    const hour = await manage(
      owner.token,
      'bookings',
      `from=${day(-3)}&to=${day(-3)}&groupBy=hour`,
    );
    const hours = hour.body.rows as { key: string; bookings: number }[];
    expect(hours.find((row) => row.key === '23')?.bookings).toBe(1);
    expect(hours.find((row) => row.key === '2')?.bookings).toBe(0);
  });

  it('receita: o pagamento das 23:50 do dia -1 é do dia -1 (e não de hoje, que é o dia em UTC)', async () => {
    const owner = await userConn('dona');
    const revenue = async (offset: number) => {
      const res = await manage(
        owner.token,
        'revenue',
        `from=${day(offset)}&to=${day(offset)}&groupBy=method`,
      );
      expect(res.status).toBe(200);
      return res.body.rows as { key: string; receivedCents: number; paymentsCount: number }[];
    };
    const yesterday = await revenue(-1);
    expect(yesterday.find((row) => row.key === 'PIX')).toMatchObject({
      receivedCents: 10_000,
      paymentsCount: 1,
    });
    const todayRows = await revenue(0);
    expect(todayRows.reduce((sum, row) => sum + row.receivedCents, 0)).toBe(0);
    // Extrato (tool): a janela [início do dia, início do dia seguinte) em UTC bate com o dia local.
  });

  it('extrato e lista de reservas pelas tools: o dia inclui 23:xx e exclui 00:xx do dia seguinte', async () => {
    await withClient(await userConn('dona'), async (client) => {
      await resetLimits();
      const spaceArg = w.spaces.a.slug;
      const statement = await safeCall(client, 'get_statement', {
        space: spaceArg,
        from: day(-1),
        to: day(-1),
      });
      expect(statement.isError).toBe(false);
      expect(statement.data.totals.received.cents).toBe(10_000);
      const next = await safeCall(client, 'get_statement', {
        space: spaceArg,
        from: day(0),
        to: day(0),
      });
      expect(next.data.totals.received.cents).toBe(0);
      const bookings = async (from: string, to: string) => {
        await tick();
        const res = await safeCall(client, 'list_space_bookings', {
          space: spaceArg,
          from,
          to,
          status: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'],
        });
        return (res.data.bookings as { date: string; startTime: string }[]).map(
          (b) => `${b.date} ${b.startTime}`,
        );
      };
      expect(await bookings(day(-3), day(-3))).toEqual([`${day(-3)} 23:30`]);
      // A agenda lista o que OCUPA o dia: a b3 (23:30-00:30) aparece também no dia -2, com a data de início
      // local. (As métricas contam pelo INÍCIO, por isso lá ela é só do dia -3.)
      expect(await bookings(day(-2), day(-2))).toEqual([`${day(-3)} 23:30`, `${day(-2)} 19:00`]);
      expect(await bookings(day(-3), day(-2))).toHaveLength(2);
      expect(await bookings(day(-9), day(-9))).toEqual([`${day(-9)} 00:30`]);
      // 00:30 do dia -9 não ocupa o dia -10 (e a b8 do dia -10 aguarda pagamento: fora do filtro).
      expect(await bookings(day(-10), day(-10))).toEqual([]);
    });
  });

  it('ocupação por dia: a hora que atravessa a meia-noite é dividida entre os dois dias locais', async () => {
    const owner = await userConn('dona');
    const res = await manage(owner.token, 'occupancy', `from=${day(-3)}&to=${day(-2)}&groupBy=day`);
    const rows = Object.fromEntries(
      (res.body.rows as { key: string; bookedHours: number }[]).map((r) => [r.key, r.bookedHours]),
    );
    // b3: 23:30-00:30 -> 0,5 h em cada dia. dia -2 também tem b2 (1,5 h, 19:00-20:30).
    expect(rows[day(-3)]).toBe(0.5);
    expect(rows[day(-2)]).toBe(0.5 + 1.5);
  });

  it('plataforma: reservas por dia local batem com o SQL por dia local (inclusive as da virada)', async () => {
    const root = await superConn();
    for (const offset of [-3, -9, -2]) {
      const res = await sup(
        root.token,
        'platform',
        `from=${day(offset)}&to=${day(offset)}&groupBy=day`,
      );
      expect(res.status).toBe(200);
      const [row] = await sql<{ n: string }>(
        `select count(*) as n from bookings where status in ('CONFIRMED','COMPLETED','NO_SHOW')
            and starts_at >= $1 and starts_at < $2`,
        [
          localInstant(day(offset), '00:00').toISOString(),
          localInstant(nextDay(day(offset)), '00:00').toISOString(),
        ],
      );
      expect(res.body.totals.bookings, day(offset)).toBe(Number(row?.n));
    }
  });

  it('o "hoje" do período padrão é o de São Paulo, não o de UTC (às 21h-23h59 locais UTC já virou)', async () => {
    const owner = await userConn('dona');
    const res = await manage(owner.token, 'bookings', '');
    expect(res.body.period.to).toBe(localDate(0));
    expect(res.body.period.from).toBe(localDate(-29));
    expect(res.body.timezone).toBe('America/Sao_Paulo');
  });
});

describe('(2) BUG-MCP2-2 (corrigido na MCP2.9): datas extremas válidas no formato dão 400, não 500 nem calendário errado', () => {
  // Antes: `addDays` (packages/shared/src/time.ts) usava `Date.UTC`, que trata os anos 0 a 99 como 1900 a
  // 1999, e `toISOString()` devolvia `+010000-01-01` para o ano 10000 (o `addDays(to, 1)` do período
  // estourava em 9999-12-31). O esquema aceitava tudo no formato, e os extremos davam 500 INTERNAL_ERROR (a
  // tool devolvia API_UNAVAILABLE) ou 200 com o calendário errado. Agora `from`/`to` das métricas vão de
  // 2000-01-01 a 2100-12-31 (400 VALIDATION_ERROR fora disso) e `addDays` usa o ano literal.
  const validationError = (res: { status: number; body: { error?: { code?: string } } }) => [
    res.status,
    res.body?.error?.code,
  ];

  it('revenue com ano 0000 responde 400 VALIDATION_ERROR', async () => {
    const owner = await userConn('dona');
    const res = await manage(owner.token, 'revenue', 'from=0000-01-01&to=0000-01-05');
    expect(validationError(res)).toEqual([400, 'VALIDATION_ERROR']);
  });

  it('as 5 métricas de gestão e as 2 do Super com `to=9999-12-31` respondem 400 VALIDATION_ERROR', async () => {
    const owner = await userConn('dona');
    const root = await superConn();
    const results: Record<string, unknown[]> = {};
    for (const metric of MANAGE_METRICS) {
      results[metric] = validationError(
        await manage(owner.token, metric, 'from=9999-12-25&to=9999-12-31'),
      );
    }
    for (const metric of SUPER_METRICS) {
      results[`super/${metric}`] = validationError(
        await sup(root.token, metric, 'from=9999-12-25&to=9999-12-31'),
      );
    }
    for (const [metric, result] of Object.entries(results)) {
      expect(result, metric).toEqual([400, 'VALIDATION_ERROR']);
    }
  });

  it('limites: 2000-01-01 e 2100-12-31 valem; 1999-12-31 e 2101-01-01 → 400 VALIDATION_ERROR', async () => {
    const owner = await userConn('dona');
    const root = await superConn();
    const first = await manage(owner.token, 'bookings', 'from=2000-01-01&to=2000-01-05');
    expect([first.status, first.body.rows?.length]).toEqual([200, 5]);
    const last = await sup(root.token, 'platform', 'from=2100-12-25&to=2100-12-31&groupBy=day');
    expect([last.status, last.body.rows?.length]).toEqual([200, 7]);
    for (const query of ['from=1999-12-31&to=2000-01-05', 'from=2100-12-25&to=2101-01-01']) {
      expect(validationError(await manage(owner.token, 'bookings', query)), query).toEqual([
        400,
        'VALIDATION_ERROR',
      ]);
      expect(validationError(await sup(root.token, 'platform', query)), query).toEqual([
        400,
        'VALIDATION_ERROR',
      ]);
    }
  });

  it('ano 0001 (antes virava 1901 e devolvia 1 linha) responde 400 VALIDATION_ERROR', async () => {
    const owner = await userConn('dona');
    const res = await manage(owner.token, 'bookings', 'from=0001-01-01&to=0001-01-05');
    expect(validationError(res)).toEqual([400, 'VALIDATION_ERROR']);
  });

  it('pela tool, o mesmo período é recusado ANTES da API, com a faixa na mensagem (nunca API_UNAVAILABLE)', async () => {
    const tools: [Conn, string, Record<string, unknown>][] = [
      [
        await userConn('dona'),
        'get_revenue',
        { space: w.spaces.a.slug, from: '0000-01-01', to: '0000-01-05' },
      ],
      [
        await userConn('dona'),
        'get_booking_metrics',
        { space: w.spaces.a.slug, from: '9999-12-25', to: '9999-12-31' },
      ],
      [await userConn('dona'), 'list_my_classes', { from: '9999-12-25', to: '9999-12-31' }],
      [await superConn(), 'get_platform_metrics', { from: '1999-12-31', to: '2000-01-05' }],
      [await superConn(), 'get_platform_finance', { from: '2100-12-25', to: '2101-01-01' }],
    ];
    for (const [conn, tool, args] of tools) {
      await withClient(conn, async (client) => {
        await resetLimits();
        const before = await auditCount();
        const res = await safeCall(client, tool, args);
        expect(res.isError, tool).toBe(true);
        expect(res.code, tool).not.toBe('API_UNAVAILABLE');
        expect(`${res.text} ${res.thrown ?? ''}`, tool).toContain(
          'Use uma data entre 2000-01-01 e 2100-12-31',
        );
        // Recusada pela tool: nenhuma leitura do Super chegou à API (nada novo na auditoria).
        expect(await auditCount(), tool).toBe(before);
      });
    }
  });

  it('revisão da MCP2.9: os outros filtros de período da lista do MCP também dão 400, nunca 500 (aulas, presenças, frequência, minhas aulas, disponibilidade e Super)', async () => {
    const owner = await userConn('dona');
    const root = await superConn();
    const a = w.spaces.a;
    const month = today.slice(0, 7);
    // [token, rota com o período fora da faixa, a mesma rota dentro dela (controle: 200)]
    const cases: [string, string, string][] = [
      [
        owner.token,
        `/v1/manage/spaces/${a.id}/class-sessions?from=9999-12-25&to=9999-12-31`,
        `/v1/manage/spaces/${a.id}/class-sessions?from=${today}`,
      ],
      [
        owner.token,
        `/v1/manage/spaces/${a.id}/class-attendances?classGroupId=${a.groupId}&from=9999-06-01&to=9999-06-05`,
        `/v1/manage/spaces/${a.id}/class-attendances?classGroupId=${a.groupId}&from=2000-01-01&to=2000-01-05`,
      ],
      [
        owner.token,
        `/v1/manage/spaces/${a.id}/class-groups/${a.groupId}/frequency?from=0000-01-01&to=0000-01-05`,
        `/v1/manage/spaces/${a.id}/class-groups/${a.groupId}/frequency?from=2000-01-01&to=2000-01-05`,
      ],
      [
        owner.token,
        '/v1/me/class-sessions?from=9999-12-25&to=9999-12-31',
        '/v1/me/class-sessions?from=2100-12-25&to=2100-12-31',
      ],
      [
        owner.token,
        `/v1/spaces/${a.id}/availability?date=9999-12-31&durationMin=60&sportId=${a.sportId}`,
        `/v1/spaces/${a.id}/availability?date=${today}&durationMin=60&sportId=${a.sportId}`,
      ],
      [
        root.token,
        '/v1/super/finance/summary?from=9999-12-25&to=9999-12-31',
        '/v1/super/finance/summary?from=2000-01-01&to=2000-01-31',
      ],
      [
        root.token,
        '/v1/super/metrics/spaces?from=0001-01-01&to=0001-01-05',
        '/v1/super/metrics/spaces?from=2000-01-01&to=2000-01-05',
      ],
      [root.token, '/v1/super/audit-logs?from=1999-12-31', '/v1/super/audit-logs?from=2000-01-01'],
      [
        root.token,
        '/v1/super/online-payments/revenue?from=2101-01-01&to=2101-01-05',
        '/v1/super/online-payments/revenue?from=2100-12-25&to=2100-12-31',
      ],
      [
        root.token,
        '/v1/super/online-payments/reports/monthly?month=9999-12',
        `/v1/super/online-payments/reports/monthly?month=${month}`,
      ],
    ];
    for (const [token, bad, good] of cases) {
      await resetLimits();
      await tick();
      expect(validationError(await api(bad, token)), bad).toEqual([400, 'VALIDATION_ERROR']);
      await tick();
      expect((await api(good, token)).status, good).toBe(200);
    }
  });
});
