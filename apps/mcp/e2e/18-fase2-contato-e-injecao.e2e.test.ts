import { describe, expect, it } from 'vitest';
import { USERS } from './support/env.js';
import {
  adminAuditRows,
  everything,
  expectNoWrites,
  fill,
  isManageOp,
  isSuperOp,
  type Outcome,
  openApiOperations,
  realParams,
  resetLimits,
  safeCall,
  settled,
  superConn,
  tick,
  userConn,
  withClient,
  world,
} from './support/fase2.js';
import { userByEmail } from './support/helpers.js';
import { api } from './support/oauth.js';
import { INJECTION } from './support/world.js';

// Fase 2, varredura de contato (telefone, e-mail, documento, nascimento e convite) em TODAS as tools e
// rotas da lista com dados do mundo que têm esses campos preenchidos, e injeção de prompt em textos do
// espaço lidos pela gestão (docs/14-mcp.md 3.4, 8.2, 8.3 e 8.5; RN-MCP-05, RN-MCP-08; decisão 122).

const w = world();
const { from, to } = w.windows;

/** Telefone do espaço: contato PÚBLICO dele, que só as tools de jogador (`spaces:read`) mostram. */
const SPACE_PUBLIC_PHONES = ['+5531955550001', '+5531955550002'];

/** Tudo o que é contato de pessoa ou dado cadastral no mundo e no seed. */
function forbiddenStrings(): string[] {
  const seedEmails = [
    'dono.e2e@exemplo.com',
    'jogador.e2e@exemplo.com',
    'jogador2.e2e@exemplo.com',
    'jogador3.e2e@exemplo.com',
    'professor.e2e@exemplo.com',
    'super.e2e@exemplo.com',
    'dono.norte.e2e@exemplo.com',
    'avaliador1.e2e@exemplo.com',
    'aluno.atrasado.e2e@exemplo.com',
  ];
  return [
    ...w.contacts.filter((c) => !SPACE_PUBLIC_PHONES.includes(c)),
    ...SPACE_PUBLIC_PHONES,
    ...seedEmails,
    '+5531900000199', // telefone do cadastro de pagamento da Arena E2E Norte
    '11222333000181', // CNPJ do cadastro de pagamento da Arena E2E Norte
    '11.222.333/0001-81',
    'Arena E2E Norte Ltda', // razão social
  ];
}

/** Regex tolerante a separadores para um telefone: `+55 (31) 9 7700-1001` casa com `+5531977001001`. */
function phoneRegex(value: string): RegExp | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) return null;
  const national = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  const pattern = national.split('').join('[^0-9a-zA-Z]{0,3}');
  return new RegExp(`(?<![0-9])${pattern}(?![0-9])`);
}

function findContacts(text: string, allowed: string[] = []): string[] {
  const found: string[] = [];
  for (const value of forbiddenStrings()) {
    if (allowed.includes(value)) continue;
    if (text.includes(value)) {
      found.push(value);
      continue;
    }
    if (/^\+?[\d\s().-]{8,}$/.test(value)) {
      const re = phoneRegex(value);
      if (re?.test(text)) found.push(value);
    }
  }
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g);
  if (email) found.push(...email.filter((address) => !allowed.includes(address)));
  return [...new Set(found)];
}

const KEY_DENY =
  /(phone|whatsapp|e-?mail|document|cpf|cnpj|birth|invite|token|bank|copypaste|qrsvg|cardbrand|cardlast|street|postalcode|latitude|longitude|avatar|logo|photo|password|secret)/i;

function deniedKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => deniedKeys(item, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [
      ...(KEY_DENY.test(key) ? [`${path}.${key}`] : []),
      ...deniedKeys(child, `${path}.${key}`),
    ]);
  }
  return [];
}

// -------------------------------------------------------------------------------------------

describe('(2) varredura de contato: tools de gestão (Dono, Admin e Professor) e do Super', () => {
  const collect = async (
    client: Parameters<typeof safeCall>[0],
    calls: [string, Record<string, unknown>][],
  ) => {
    const outcomes: [string, Outcome][] = [];
    for (const [tool, args] of calls) {
      await tick();
      outcomes.push([tool, await safeCall(client, tool, args)]);
    }
    return outcomes;
  };
  const space = w.spaces.a.slug;
  const period = { from, to };

  const manageCalls: [string, Record<string, unknown>][] = [
    ['list_my_managed_spaces', {}],
    ['get_space_today', { space }],
    ['list_space_bookings', { space, ...period, limit: 100 }],
    ['list_space_bookings', { space, ...period, status: ['CANCELLED'] }],
    ['get_booking_metrics', { space, ...period, groupBy: 'status' }],
    ['get_booking_metrics', { space, ...period, groupBy: 'source' }],
    ['get_occupancy', { space, ...period, groupBy: 'court' }],
    ['list_class_groups', { space, includeInactive: true }],
    ['get_class_metrics', { space, ...period, groupBy: 'classGroup' }],
    ['get_class_metrics', { space, ...period, groupBy: 'teacher' }],
    ['get_customer_metrics', { space, ...period, groupBy: 'customer', limit: 100 }],
    ['get_reviews_summary', { space, recent: 20 }],
    ['get_revenue', { space, ...period, groupBy: 'method' }],
    ['get_revenue', { space, ...period, groupBy: 'origin' }],
    ['get_statement', { space, ...period, limit: 100 }],
    ['list_delinquents', { space }],
    ['get_online_payments_summary', { space, ...period }],
  ];

  for (const key of ['dona', 'admin', 'prof1']) {
    it(`${key}: nenhuma das ${manageCalls.length} chamadas de gestão devolve contato do mundo`, async () => {
      const conn = await userConn(key);
      await withClient(conn, async (client) => {
        const outcomes = await expectNoWrites(() => collect(client, manageCalls));
        const refused = outcomes
          .filter(([, res]) => res.isError)
          .map(([tool, res]) => `${tool}: ${res.code ?? res.thrown}`);
        // O Professor não alcança valores nem clientes; os demais, tudo.
        if (key === 'prof1') expect(refused.length).toBeLessThanOrEqual(8);
        else expect(refused).toEqual([]);
        for (const [tool, res] of outcomes) {
          expect(findContacts(everything(res)), tool).toEqual([]);
          expect(deniedKeys(res.data), `${tool} (chaves)`).toEqual([]);
        }
      });
    });
  }

  it('Super: as 9 tools com filtros variados — sem e-mail, telefone, documento nem razão social', async () => {
    const conn = await superConn();
    await withClient(conn, async (client) => {
      const sup = await userByEmail(USERS.superUser);
      const calls: [string, Record<string, unknown>][] = [
        ['list_spaces', { pageSize: 100 }],
        ['list_spaces', { status: 'ACTIVE', pageSize: 100 }],
        ['get_space_details', { space: w.spaces.a.slug }],
        ['get_space_details', { space: 'Arena E2E Norte' }],
        ['get_platform_metrics', { ...period, groupBy: 'month' }],
        ['compare_spaces', { ...period, limit: 200 }],
        ['get_platform_finance', { ...period }],
        ['get_platform_finance', { ...period, space: w.spaces.a.slug }],
        ['get_online_payments_revenue', { ...period }],
        ['get_online_payments_revenue', { ...period, space: 'Arena E2E Norte', method: 'PIX' }],
        ['get_reviews_reports', { status: 'OPEN', includeComments: true, limit: 100 }],
        ['get_reviews_reports', { includeComments: true, limit: 100 }],
        ['search_audit_logs', { limit: 100 }],
        ['search_audit_logs', { actor: sup.id, limit: 100 }],
        ['search_audit_logs', { space: w.spaces.a.slug, limit: 100 }],
        ['list_users', { pageSize: 100 }],
        ['list_users', { q: 'Dona', pageSize: 100 }],
        ['list_users', { platformRole: 'SUPER', pageSize: 100 }],
      ];
      const outcomes = await expectNoWrites(() => collect(client, calls));
      for (const [tool, res] of outcomes) {
        expect(res.isError, `${tool}: ${res.code ?? res.thrown}`).toBe(false);
        expect(findContacts(everything(res)), tool).toEqual([]);
        expect(deniedKeys(res.data), `${tool} (chaves)`).toEqual([]);
      }
    });
  });

  it('o assistente não consegue achar uma pessoa pelo contato: busca por telefone/e-mail no Super e no balcão', async () => {
    const dona = await userConn('dona');
    await withClient(dona, async (client) => {
      await resetLimits();
      // "Carlos Balcão" foi cadastrado com telefone; o nome acha, o telefone não.
      const byName = await safeCall(client, 'list_space_bookings', {
        space,
        ...period,
        customer: 'Carlos',
      });
      expect((byName.data.bookings as unknown[]).length).toBe(3);
      for (const customer of [
        '+5531977001001',
        '31977001001',
        '977001001',
        'jogador',
        'aurora.f2@exemplo.com',
        '@exemplo',
      ]) {
        await tick();
        const res = await safeCall(client, 'list_space_bookings', { space, ...period, customer });
        const found = res.isError ? [] : (res.data.bookings as unknown[]);
        expect(found, customer).toEqual([]);
      }
    });
    // Direto na API (o cliente MCP pode pular o apps/mcp): o `q` procura só no nome.
    const token = dona.token;
    const base = `/v1/manage/spaces/${w.spaces.a.id}/bookings`;
    const iso = `from=${from}T00:00:00.000Z&to=${to}T23:59:59.000Z`;
    for (const q of ['%2B5531977001001', '977001001', 'aurora.f2%40exemplo.com']) {
      await tick();
      const res = await api(`${base}?${iso}&q=${q}`, token);
      expect(res.status, q).toBe(200);
      expect(res.body.items, q).toEqual([]);
    }
    const sup = await superConn();
    for (const q of [
      encodeURIComponent(w.people.dona?.phone as string),
      encodeURIComponent(w.people.dona?.email as string),
      '31988000',
      '%40exemplo',
    ]) {
      await tick();
      const res = await api(`/v1/super/users?q=${q}`, sup.token);
      expect(res.status, q).toBe(200);
      expect(res.body.total ?? res.body.items?.length ?? 0, q).toBe(0);
    }
    const named = await api('/v1/super/users?q=Dona', sup.token);
    expect(named.body.total ?? named.body.items?.length).toBeGreaterThan(0);
  });
});

/**
 * TEXTO LIVRE escrito por pessoas (docs/14-mcp.md 8.2): a descrição do espaço e o comentário da avaliação não
 * têm marca de dado pessoal no registro, então a API os repassa como foram escritos e quem filtra
 * contato é o `redactContacts` do apps/mcp (defesa parcial, 8.5). O mundo plantou um e-mail na
 * descrição do espaço A e um telefone no comentário da avaliação; nas rotas CRUAS eles saem, nas tools não.
 */
const FREE_TEXT_ROUTES: Record<string, string[]> = {
  '/v1/manage/spaces/{spaceId}': ['evil@exemplo.com'],
  '/v1/super/spaces/{spaceId}': ['evil@exemplo.com'],
  '/v1/manage/spaces/{spaceId}/reviews': ['31 9 8765-4321'],
};

describe('(2) varredura de contato: TODAS as rotas da lista, com ids reais', () => {
  const ops = openApiOperations().filter((op) => op.listed && op.method === 'GET');
  const params = realParams();
  const query = (path: string) => {
    if (/\{spaceId\}\/(bookings|court-blocks|statement)$/.test(path)) {
      return `?from=${from}T00:00:00.000Z&to=${to}T23:59:59.000Z${path.endsWith('/bookings') ? '&limit=100' : ''}`;
    }
    if (/wallet\/entries$/.test(path)) return `?from=${from}T00:00:00.000Z&to=${to}T23:59:59.000Z`;
    if (path.endsWith('/class-attendances'))
      return `?classGroupId=${w.spaces.a.groupId}&from=${from}&to=${to}`;
    if (path.endsWith('/reports/monthly')) return `?month=${from.slice(0, 7)}`;
    if (path.endsWith('/reviews/summary') && path.startsWith('/v1/super'))
      return `?spaceId=${w.spaces.a.id}`;
    if (/\/analytics\//.test(path) || /finance\/summary|online-payments\/revenue/.test(path))
      return `?from=${from}&to=${to}`;
    if (/(class-sessions|attendances)$/.test(path)) return `?from=${from}&to=${to}`;
    if (path.endsWith('/audit-logs')) return '?limit=100';
    return '';
  };

  it('rotas de gestão (Dono): nenhum contato nem chave de contato em nenhuma das respostas', async () => {
    const conn = await userConn('dona');
    const failures: string[] = [];
    let checked = 0;
    for (const op of ops.filter((o) => isManageOp(o))) {
      await tick();
      const res = await api(fill(op.path, params) + query(op.path), conn.token);
      if (res.status !== 200 && !op.path.includes('{chargeId}'))
        failures.push(`${op.path} → ${res.status}`);
      checked += 1;
      const text = JSON.stringify(res.body);
      const contacts = findContacts(text, FREE_TEXT_ROUTES[op.path] ?? []);
      if (contacts.length) failures.push(`${op.path} contato ${contacts.join(', ')}`);
      const keys = deniedKeys(res.body);
      if (keys.length) failures.push(`${op.path} chave ${keys.join(', ')}`);
    }
    expect(checked).toBeGreaterThanOrEqual(30);
    expect(failures).toEqual([]);
  });

  it('rotas do Super: idem, inclusive o relatório mensal do gateway (sem documento nem razão social)', async () => {
    const conn = await superConn();
    const failures: string[] = [];
    for (const op of ops.filter((o) => isSuperOp(o))) {
      await tick();
      const res = await api(fill(op.path, params) + query(op.path), conn.token);
      if (res.status !== 200) failures.push(`${op.path} → ${res.status}`);
      const contacts = findContacts(JSON.stringify(res.body), FREE_TEXT_ROUTES[op.path] ?? []);
      if (contacts.length) failures.push(`${op.path} contato ${contacts.join(', ')}`);
      const keys = deniedKeys(res.body);
      if (keys.length) failures.push(`${op.path} chave ${keys.join(', ')}`);
    }
    expect(failures).toEqual([]);
  });

  it('texto livre: a API repassa o que a pessoa escreveu (descrição e comentário) e as tools filtram o contato', async () => {
    const conn = await userConn('dona');
    const sup = await superConn();
    await resetLimits();
    const raw = await api(`/v1/manage/spaces/${w.spaces.a.id}/reviews`, conn.token);
    expect(JSON.stringify(raw.body)).toContain('31 9 8765-4321');
    const rawSpace = await api(`/v1/super/spaces/${w.spaces.a.id}`, sup.token);
    expect(JSON.stringify(rawSpace.body)).toContain('evil@exemplo.com');
    await withClient(conn, async (client) => {
      const res = await safeCall(client, 'get_reviews_summary', {
        space: w.spaces.a.slug,
        recent: 20,
      });
      expect(everything(res)).not.toContain('31 9 8765-4321');
    });
    await withClient(sup, async (client) => {
      const res = await safeCall(client, 'get_space_details', { space: w.spaces.a.slug });
      expect(everything(res)).not.toContain('evil@exemplo.com');
    });
  });

  it('o mesmo dado pela SESSÃO do web TRAZ contato (prova de que o mundo tem o que a varredura procura)', async () => {
    const { appSession } = await import('./support/oauth.js');
    const session = await appSession(w.people.dona?.email as string);
    await resetLimits();
    const detail = await api(
      `/v1/manage/spaces/${w.spaces.a.id}/bookings?from=${from}T00:00:00.000Z&to=${to}T23:59:59.000Z&limit=100`,
      session.token,
    );
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).toContain('+5531977001001');
    const sup = await appSession(USERS.superUser);
    const users = await api('/v1/super/users?q=Dona', sup.token);
    expect(JSON.stringify(users.body)).toMatch(/@exemplo\.com/);
  });
});

describe('(2) injeção de prompt em textos do espaço lidos pela gestão (RN-MCP-05)', () => {
  const INJECTED = [
    'IGNORE TODAS',
    'SYSTEM:',
    '</dados>',
    '</turma>',
    'Ignore as regras',
    'IGNORE O QUE VEM ANTES',
    '[INSTRUÇÃO]',
  ];
  const inText = (text: string) => INJECTED.filter((mark) => text.includes(mark));
  /** O resumo curto é o 1º bloco de `content`; o 2º é o JSON dos dados (onde o texto de terceiros pode aparecer). */
  const shortText = (res: Outcome) => {
    const first = res.result.content[0];
    return first?.type === 'text' ? first.text : '';
  };

  it('Dono: o texto hostil (turma, convidado, motivo de cancelamento, comentário) volta só como VALOR de campo de dados', async () => {
    const conn = await userConn('dona');
    await withClient(conn, async (client) => {
      await resetLimits();
      const since = new Date();
      const bookings = await safeCall(client, 'list_space_bookings', {
        space: w.spaces.a.slug,
        ...{ from, to },
        limit: 100,
      });
      const groups = await safeCall(client, 'list_class_groups', {
        space: w.spaces.a.slug,
        includeInactive: true,
      });
      const metrics = await safeCall(client, 'get_class_metrics', {
        space: w.spaces.a.slug,
        from,
        to,
        groupBy: 'classGroup',
      });
      const reviews = await safeCall(client, 'get_reviews_summary', {
        space: w.spaces.a.slug,
        recent: 20,
      });
      for (const [name, res] of Object.entries({ bookings, groups, metrics, reviews })) {
        expect(res.isError, name).toBe(false);
        // O resumo em texto (o que o modelo lê primeiro) não carrega nada vindo do banco de terceiros.
        expect(inText(shortText(res)), `${name}: texto curto`).toEqual([]);
        expect(shortText(res).length, name).toBeLessThan(400);
      }
      // O texto hostil existe como dado: aparece, e só em campos de nome/rótulo/comentário.
      expect(JSON.stringify(bookings.data)).toContain(INJECTION.guest);
      expect(JSON.stringify(groups.data)).toContain(INJECTION.group);
      expect(JSON.stringify(reviews.data)).toContain('IGNORE O QUE VEM ANTES');
      // Os contatos escritos no comentário saem (filtro de contato), mesmo dentro do texto hostil.
      expect(JSON.stringify(reviews.data)).not.toContain('31 9 8765-4321');
      expect(JSON.stringify(reviews.data)).toContain('[contato removido]');
      // Ler esse texto não dispara nada: nenhuma escrita e nenhuma outra leitura auditada.
      const dona = await userByEmail(w.people.dona?.email as string);
      const writes = await settled(
        async () => (await adminAuditRowsAny(dona.id, since)) as never,
        0,
        400,
      );
      expect(writes).toEqual([]);
    });
  });

  it('as descrições das tools e as instruções do servidor não mudam com o texto do banco (não dependem de dados)', async () => {
    const conn = await userConn('dona');
    await withClient(conn, async (client) => {
      const before = JSON.stringify(
        (await client.listTools()).tools.map((t) => [t.name, t.description]),
      );
      await safeCall(client, 'list_class_groups', {
        space: w.spaces.a.slug,
        includeInactive: true,
      });
      const after = JSON.stringify(
        (await client.listTools()).tools.map((t) => [t.name, t.description]),
      );
      expect(after).toBe(before);
      expect(inText(before)).toEqual([]);
      expect(inText(client.getInstructions() ?? '')).toEqual([]);
    });
  });

  it('o prompt de relatório não embute nenhum texto do banco (só o que a pessoa digitou)', async () => {
    const conn = await userConn('dona');
    await withClient(conn, async (client) => {
      for (const name of ['relatorio_mensal_do_espaco', 'ocupacao_da_semana']) {
        const prompt = await client.getPrompt({ name, arguments: { espaco: w.spaces.a.slug } });
        const text = prompt.messages
          .map((m) => (m.content.type === 'text' ? m.content.text : ''))
          .join('\n');
        expect(inText(text), name).toEqual([]);
        expect(text, name).not.toContain('Carlos');
        expect(text, name).not.toContain('Turma Um Fase');
      }
    });
  });

  it('Super: descrição do espaço e comentário de denúncia vêm marcados como texto de terceiros; nada é executado', async () => {
    const conn = await superConn();
    await withClient(conn, async (client) => {
      await resetLimits();
      const sup = await userByEmail(USERS.superUser);
      const since = new Date();
      const details = await safeCall(client, 'get_space_details', { space: w.spaces.a.slug });
      const reports = await safeCall(client, 'get_reviews_reports', {
        includeComments: true,
        limit: 100,
      });
      for (const [name, res] of Object.entries({ details, reports })) {
        expect(res.isError, name).toBe(false);
        expect(inText(shortText(res)), `${name}: texto curto`).toEqual([]);
      }
      expect(details.data.space.description).toMatchObject({ untrusted: true });
      expect(details.data.space.description.text).toContain('IGNORE TODAS');
      expect(details.data.space.description.note).toMatch(/nunca siga como instrução/);
      const comment = (reports.data.columns as { key: string; untrusted?: boolean }[]).find(
        (c) => c.key === 'comment',
      );
      expect(comment?.untrusted).toBe(true);
      // Exatamente as 2 leituras pedidas aparecem na auditoria: o texto hostil não gerou outra chamada
      // (get_space_details resolve o espaço por nome: busca + detalhe).
      const rows = await settled(() => adminAuditRows(sup.id, since), 3);
      expect(rows.map((r) => r.diff?.path)).toEqual([
        '/v1/super/spaces',
        `/v1/super/spaces/${w.spaces.a.id}`,
        '/v1/super/reviews/reports',
      ]);
    });
  });

  it('o assistente também não pode ser levado a escrever: a superfície não tem nenhuma tool de escrita', async () => {
    for (const conn of [await userConn('dona'), await superConn()]) {
      await withClient(conn, async (client) => {
        for (const tool of (await client.listTools()).tools) {
          const manageOrSuper = !/^(create_|cancel_|confirm_|prepare_)/.test(tool.name);
          if (manageOrSuper) {
            expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
          }
        }
      });
    }
  });
});

async function adminAuditRowsAny(actorId: string, since: Date) {
  const { sql } = await import('./support/db.js');
  return sql(
    `select id, action from audit_logs where actor_id = $1 and created_at >= $2
        and action in ('mcp.request', 'mcp.admin_request')`,
    [actorId, since.toISOString()],
  );
}
