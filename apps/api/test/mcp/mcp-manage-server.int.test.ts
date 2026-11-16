import type { AddressInfo } from 'node:net';
import { addDays, MCP_RESOURCE_SCOPES, utcToZoned } from '@space-sports/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spaceMembers, subscriptionCharges } from '../../src/db/schema/index.js';
import { insertGroup, insertSession, local, TZ } from '../analytics/fixtures.js';
import { type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, type Space, slotIn } from '../bookings/fixtures.js';
import { enroll, teacherMemberId } from '../classes/fixtures.js';
import { insertReviewRow } from '../reviews/qa-fixtures.js';
import { CLIENT_ID, connect, createMcpTestApp, ISSUER, MCP_RESOURCE } from './helpers.js';
import { type McpClient, type McpServerHandle, startMcpServer } from './real-mcp.js';

// Integração apps/mcp ↔ API na gestão em leitura (MCP2.3; docs/14-mcp.md 8.5; RF-MCP-06 e 08):
// o token sai do fluxo OAuth com os escopos de gestão concedidos pelo papel (MCP2.1), o apps/mcp
// real o valida pelo JWKS e chama as rotas de gestão e as métricas (MCP2.2) com ele. A Dona pede
// receita e ocupação; o Professor pede presença e não vê valores (decisão 53).

const USER_SCOPES = MCP_RESOURCE_SCOPES.USER.join(' ');
const GUEST_PHONE = '+5531977775555';
/** Contato escrito à mão num comentário sem denúncia: a API manda, o filtro do apps/mcp tira. */
const REVIEW_PHONE = '31 9 9999-8888';
const PEOPLE = {
  dona: { email: 'dona.mcp.real@exemplo.com', name: 'Dona Real', phone: '+5531911112222' },
  prof: { email: 'prof.mcp.real@exemplo.com', name: 'Professora Real', phone: '+5531911113333' },
  aluno: { email: 'aluno.mcp.real@exemplo.com', name: 'Aluno Real', phone: '+5531911114444' },
};
const CONTACTS = [
  GUEST_PHONE,
  REVIEW_PHONE,
  ...Object.values(PEOPLE).flatMap((person) => [person.email, person.phone]),
];

describe('apps/mcp com a API real: gestão em leitura', () => {
  let t: TestApp;
  let mcp: McpServerHandle;
  let space: Space;
  let dona: SignedUp;
  let prof: SignedUp;
  let donaClient: McpClient;
  let profClient: McpClient;
  const today = utcToZoned(new Date(), TZ).date;
  const outputs: string[] = [];

  /** Chama a tool e guarda tudo o que sai (para a varredura de contato). */
  const call = async (client: McpClient, name: string, args: Record<string, unknown> = {}) => {
    const result = await mcp.call(client, name, args);
    outputs.push(result.text, JSON.stringify(result.data));
    return result;
  };

  beforeAll(async () => {
    t = await createMcpTestApp();
    await t.app.listen(0, '127.0.0.1');
    const { port } = t.app.getHttpServer().address() as AddressInfo;
    const apiUrl = `http://127.0.0.1:${port}`;
    space = await createSpace(t.db, 'arena-gestao-mcp-real');
    dona = await signUp(t, PEOPLE.dona.email, PEOPLE.dona.name, PEOPLE.dona.phone);
    prof = await signUp(t, PEOPLE.prof.email, PEOPLE.prof.name, PEOPLE.prof.phone);
    const aluno = await signUp(t, PEOPLE.aluno.email, PEOPLE.aluno.name, PEOPLE.aluno.phone);
    await t.db.insert(spaceMembers).values([
      { userId: dona.id, spaceId: space.id, role: 'OWNER', status: 'ACTIVE' },
      { userId: prof.id, spaceId: space.id, role: 'TEACHER', status: 'ACTIVE' },
    ]);

    // Reserva de balcão (com telefone) amanhã, com R$ 50,00 pagos hoje em dinheiro.
    const desk = await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/bookings`)
      .set(...bearer(dona))
      .send({
        courtId: space.courtA,
        sportId: space.sportId,
        startsAt: slotIn(26 * 60).toISOString(),
        durationMin: 60,
        peopleCount: 2,
        guestName: 'Cliente do Balcão',
        guestPhone: GUEST_PHONE,
      })
      .expect(201);
    await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/payments`)
      .set(...bearer(dona))
      .send({ payableType: 'BOOKING', payableId: desk.body.id, amountCents: 5_000, method: 'CASH' })
      .expect(201);

    // Turma da Professora com duas aulas dadas: uma presença e uma falta do aluno.
    const teacher = await teacherMemberId(t.db, prof.id, space.id);
    const group = await insertGroup(t.db, space, {
      name: 'Futevôlei da Manhã',
      courtId: space.courtB,
      teacherMemberIds: [teacher],
    });
    await insertSession(t.db, group, {
      startsAt: local(addDays(today, -2), '08:00'),
      status: 'DONE',
      teacherMemberIds: [teacher],
      marks: [[aluno.id, 'PRESENT']],
    });
    await insertSession(t.db, group, {
      startsAt: local(addDays(today, -1), '08:00'),
      status: 'DONE',
      teacherMemberIds: [teacher],
      marks: [[aluno.id, 'ABSENT']],
    });

    // O aluno matriculado na turma, com uma mensalidade vencida (inadimplência), e uma avaliação
    // com um telefone escrito no texto (sem denúncia: a API manda o comentário).
    const subscription = await enroll(t.db, {
      userId: aluno.id,
      spaceId: space.id,
      sportId: space.sportId,
      classGroupId: group.id,
    });
    await t.db.insert(subscriptionCharges).values({
      subscriptionId: subscription.id,
      periodStart: '2026-01-10',
      periodEnd: '2026-02-09',
      dueDate: '2026-01-10',
      amountCents: 15_000,
      status: 'OVERDUE',
    });
    await insertReviewRow(t.db, space.id, {
      userId: aluno.id,
      rating: 5,
      comment: `Quadra ótima! Reservei pelo ${REVIEW_PHONE}.`,
    });

    mcp = await startMcpServer({
      apiUrl,
      issuer: ISSUER,
      jwksUrl: `${apiUrl}/v1/auth/jwks`,
      resourceUrl: MCP_RESOURCE,
    });
    // O cliente pede todos os escopos do conector; o servidor concede pelo papel (RN-MCP-06).
    donaClient = await mcp.connect((await connect(t, dona, { scope: USER_SCOPES })).access_token);
    profClient = await mcp.connect((await connect(t, prof, { scope: USER_SCOPES })).access_token);
  });

  afterAll(async () => {
    await mcp?.stop();
    await t?.close();
  });

  it('tools/list pelo papel: a Dona vê as 13 de gestão; a Professora, só as 9 sem valores', async () => {
    const donaTools = (await donaClient.listTools()).tools.map((tool) => tool.name);
    expect(donaTools).toHaveLength(27);
    expect(donaTools).toContain('get_revenue');
    const profTools = (await profClient.listTools()).tools.map((tool) => tool.name);
    expect(profTools).toHaveLength(23);
    expect(profTools).toContain('get_class_metrics');
    expect(profTools).not.toContain('get_revenue');
    const prompts = (await donaClient.listPrompts()).prompts.map((prompt) => prompt.name);
    expect(prompts).toEqual(['relatorio_mensal_do_espaco', 'ocupacao_da_semana']);
  });

  it('a Dona pede receita e ocupação', async () => {
    const spaces = await call(donaClient, 'list_my_managed_spaces');
    expect(spaces.isError, spaces.text).toBe(false);
    expect(spaces.data.spaces).toEqual([
      expect.objectContaining({ id: space.id, roles: ['Dono'], seesValues: true }),
    ]);

    const revenue = await call(donaClient, 'get_revenue', {
      space: 'arena-gestao-mcp-real',
      from: addDays(today, -29),
      to: addDays(today, 1),
      groupBy: 'day',
    });
    expect(revenue.isError, revenue.text).toBe(false);
    expect(revenue.data.totals).toMatchObject({
      receivedCents: 5_000,
      receivedFormatted: 'R$ 50,00',
      paymentsCount: 1,
      receivableCents: 5_000,
    });
    const todayRow = revenue.data.rows.find((row: { key: string }) => row.key === today);
    expect(todayRow).toMatchObject({ receivedCents: 5_000 });
    expect(revenue.data.rows).toHaveLength(31);

    const occupancy = await call(donaClient, 'get_occupancy', {
      space: space.id,
      from: today,
      to: addDays(today, 6),
      groupBy: 'court',
    });
    expect(occupancy.isError, occupancy.text).toBe(false);
    expect(occupancy.data.rows.map((row: { label: string }) => row.label).sort()).toEqual([
      'Quadra A',
      'Quadra B',
    ]);
    expect(occupancy.data.totals.bookedHours).toBe(1);
    expect(occupancy.data.totals.occupancyRate).toBeGreaterThan(0);

    const todayView = await call(donaClient, 'get_space_today');
    expect(todayView.isError, todayView.text).toBe(false);
    expect(todayView.data.values.received).toEqual({ cents: 5_000, formatted: 'R$ 50,00' });

    const bookings = await call(donaClient, 'list_space_bookings', {
      from: today,
      to: addDays(today, 3),
    });
    expect(bookings.data.bookings).toEqual([
      expect.objectContaining({
        customerName: 'Cliente do Balcão',
        price: { cents: 10_000, formatted: 'R$ 100,00' },
        due: { cents: 5_000, formatted: 'R$ 50,00' },
      }),
    ]);
  });

  it('a Dona: turmas, avaliações, extrato, inadimplência, pagamentos online, reservas e clientes', async () => {
    const ok = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await call(donaClient, name, args);
      expect(result.isError, `${name}: ${result.text}`).toBe(false);
      return result.data;
    };

    const groups = await ok('list_class_groups');
    expect(groups.classGroups).toEqual([
      expect.objectContaining({
        name: 'Futevôlei da Manhã',
        teachers: ['Professora Real'],
        enrolledCount: 1,
        active: true,
      }),
    ]);

    const reviews = await ok('get_reviews_summary');
    expect(reviews).toMatchObject({ count: 1, unansweredCount: 1 });
    expect(reviews.recent).toEqual([
      expect.objectContaining({
        rating: 5,
        comment: 'Quadra ótima! Reservei pelo [contato removido].',
        replied: false,
      }),
    ]);

    const statement = await ok('get_statement');
    expect(statement.totals.received).toEqual({ cents: 5_000, formatted: 'R$ 50,00' });
    expect(statement.payments).toEqual([
      expect.objectContaining({
        payerName: 'Cliente do Balcão',
        method: 'CASH',
        channel: 'ON_SITE',
        service: 'RENTAL',
        date: today,
        reversed: false,
      }),
    ]);

    const delinquents = await ok('list_delinquents');
    expect(delinquents.totalOverdue).toEqual({ cents: 15_000, formatted: 'R$ 150,00' });
    expect(delinquents.delinquents).toEqual([
      expect.objectContaining({
        studentName: 'Aluno Real',
        overdueCount: 1,
        oldestDueDate: '2026-01-10',
      }),
    ]);

    const online = await ok('get_online_payments_summary');
    expect(online.account.status).toBe('NOT_STARTED');
    expect(online.received).toEqual({
      online: { cents: 0, formatted: 'R$ 0,00' },
      onSite: { cents: 5_000, formatted: 'R$ 50,00' },
      total: { cents: 5_000, formatted: 'R$ 50,00' },
    });

    const period = { from: today, to: addDays(today, 2) };
    const bookings = await ok('get_booking_metrics', { ...period, groupBy: 'source' });
    expect(bookings.rows.find((row: { key: string }) => row.key === 'DESK')).toMatchObject({
      label: 'Balcão',
      bookings: 1,
      hours: 1,
    });
    expect(bookings.totals.bookings).toBe(1);

    const customers = await ok('get_customer_metrics', period);
    expect(customers.rows).toEqual([
      expect.objectContaining({ label: 'Cliente do Balcão', bookings: 1, newCustomers: 1 }),
    ]);
    expect(customers.totals).toMatchObject({ customers: 1, newCustomers: 1 });
  });

  it('a Professora pede presença: só a turma dela, e nenhum valor', async () => {
    const classes = await call(profClient, 'get_class_metrics', { from: addDays(today, -7) });
    expect(classes.isError, classes.text).toBe(false);
    expect(classes.data.space.roles).toEqual(['Professor']);
    expect(classes.data.rows).toEqual([
      expect.objectContaining({ label: 'Futevôlei da Manhã', present: 1, absent: 1 }),
    ]);
    expect(classes.data.totals).toMatchObject({ sessionsDone: 2, attendanceRate: 0.5 });

    const todayView = await call(profClient, 'get_space_today');
    expect(todayView.isError, todayView.text).toBe(false);
    expect(todayView.data.values).toBeNull();
    expect(todayView.data.valuesNote).toContain('Professor');

    const bookings = await call(profClient, 'list_space_bookings', { to: addDays(today, 3) });
    for (const booking of bookings.data.bookings) {
      expect(booking).toMatchObject({ price: null, paid: null, due: null });
    }

    // Clientes são só de Dono e Admin (`contact.view`): a API recusa e a tool repassa.
    const customers = await call(profClient, 'get_customer_metrics');
    expect(customers.isError).toBe(true);
    expect(customers.data.error.code).toBe('SPACE_FORBIDDEN');
  });

  it('nenhuma saída tem telefone ou e-mail, e os logs têm a superfície e o cliente', async () => {
    expect(outputs.length).toBeGreaterThan(10);
    for (const output of outputs) {
      for (const contact of CONTACTS) expect(output).not.toContain(contact);
      expect(output).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
    const calls = mcp.logs.filter((line) => line.event === 'tool_call');
    expect(calls.length).toBeGreaterThan(5);
    for (const line of calls) {
      expect(line).toMatchObject({ surface: 'user', clientId: CLIENT_ID });
    }
    const customerCalls = calls.filter((line) => line.tool === 'get_customer_metrics');
    expect(customerCalls.map((line) => [line.sub, line.result])).toEqual([
      [dona.id, 'ok'],
      [prof.id, 'SPACE_FORBIDDEN'],
    ]);
    const logs = JSON.stringify(mcp.logs);
    for (const secret of [...CONTACTS, 'Cliente do Balcão', 'Professora Real']) {
      expect(logs).not.toContain(secret);
    }
  });
});
