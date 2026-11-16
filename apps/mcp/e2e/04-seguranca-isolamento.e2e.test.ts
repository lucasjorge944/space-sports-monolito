import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import { USERS } from './support/env.js';
import {
  bookingRow,
  bookViaMcp,
  createOpenClassSession,
  freshPlayerToken,
  userByEmail,
} from './support/helpers.js';
import { call, mcpClient, ok } from './support/mcp.js';
import { api, connect } from './support/oauth.js';

/**
 * Usuário A tentando ler, cancelar ou confirmar presença em recurso do usuário B pelo MCP, com ids
 * VÁLIDOS do outro (RN-MCP-01, RN-MCP-05; filtros por usuário valem como no app).
 */
describe('(2) segurança — isolamento entre usuários', () => {
  let a: Awaited<ReturnType<typeof freshPlayerToken>>;
  let b: Awaited<ReturnType<typeof freshPlayerToken>>;
  let clientA: Client;
  let clientB: Client;
  let bBooking: Awaited<ReturnType<typeof bookViaMcp>>;
  let aBooking: Awaited<ReturnType<typeof bookViaMcp>>;

  beforeAll(async () => {
    a = await freshPlayerToken('iso-a');
    b = await freshPlayerToken('iso-b');
    clientA = await mcpClient(a.token);
    clientB = await mcpClient(b.token);
    bBooking = await bookViaMcp(clientB, { days: 7 });
    aBooking = await bookViaMcp(clientA, { days: 8 });
  });

  afterAll(async () => {
    await clientA?.close();
    await clientB?.close();
  });

  it('get_booking com o id de B responde "não encontrada" e não vaza nenhum dado dele', async () => {
    const res = await call(clientA, 'get_booking', { bookingId: bBooking.bookingId });
    expect(res.isError).toBe(true);
    expect(res.text).not.toContain(b.email);
    expect(res.text).not.toContain('Qa');
    expect(JSON.stringify(res.data)).not.toContain(bBooking.slot.startTime);
    expect(res.code ?? res.text).toMatch(/BOOKING_NOT_FOUND|não encontrad/i);
  });

  it('list_my_bookings de A não traz a reserva de B (nem passadas)', async () => {
    const upcoming = await ok(clientA, 'list_my_bookings');
    const upcomingIds = upcoming.bookings.map((x: { id: string }) => x.id);
    expect(upcomingIds).toContain(aBooking.bookingId);
    expect(upcomingIds).not.toContain(bBooking.bookingId);
    for (const args of [{ when: 'past' }, { when: 'all' }, { when: 'PAST' }]) {
      const res = await call(clientA, 'list_my_bookings', args);
      expect(JSON.stringify(res.data)).not.toContain(bBooking.bookingId);
    }
  });

  it('prepare_cancel_booking de A com o id de B é recusado e B segue confirmada', async () => {
    const res = await call(clientA, 'prepare_cancel_booking', { bookingId: bBooking.bookingId });
    expect(res.isError).toBe(true);
    expect(res.data.confirmation).toBeUndefined();
    expect((await bookingRow(bBooking.bookingId))?.status).toBe('CONFIRMED');
  });

  it('cancel_booking com o id de B e o código de uma reserva de A é recusado sem chamar a API', async () => {
    const prepared = await ok(clientA, 'prepare_cancel_booking', { bookingId: aBooking.bookingId });
    const input = prepared.confirmation.cancelBookingInput;
    const res = await call(clientA, 'cancel_booking', { ...input, bookingId: bBooking.bookingId });
    expect(res.isError).toBe(true);
    expect((await bookingRow(bBooking.bookingId))?.status).toBe('CONFIRMED');
    expect((await bookingRow(aBooking.bookingId))?.status).toBe('CONFIRMED');
  });

  it('API direta com o token de A: ler e cancelar a reserva de B responde 404 e nada muda', async () => {
    const read = await api(`/v1/bookings/${bBooking.bookingId}`, a.token);
    expect([read.status, read.body.error.code]).toEqual([404, 'BOOKING_NOT_FOUND']);
    const cancel = await api(`/v1/bookings/${bBooking.bookingId}/cancel`, a.token, {
      method: 'POST',
      json: {},
    });
    expect(cancel.status).toBe(404);
    expect((await bookingRow(bBooking.bookingId))?.status).toBe('CONFIRMED');
    // O mesmo vale para o id de uma reserva de OUTRO espaço do seed (reserva do jogador do seed).
    const [seeded] = await sql<{ id: string }>(
      `select id from bookings where organizer_user_id <> $1 limit 1`,
      [a.id],
    );
    if (seeded) expect((await api(`/v1/bookings/${seeded.id}`, a.token)).status).toBe(404);
  });

  it('excludeBookingId de B na disponibilidade (token de A) NÃO libera o horário de B', async () => {
    const { spaceId, sportId } = bBooking.input;
    const query = `date=${bBooking.slot.date}&durationMin=60&sportId=${sportId}`;
    const baseline = await api(`/v1/spaces/${spaceId}/availability?${query}`, a.token);
    const withExclude = await api(
      `/v1/spaces/${spaceId}/availability?${query}&excludeBookingId=${bBooking.bookingId}`,
      a.token,
    );
    expect(baseline.status).toBe(200);
    // Com o token de A, o exclude de uma reserva que não é dele é ignorado (ou recusado): nunca libera.
    if (withExclude.status === 200) expect(withExclude.body).toEqual(baseline.body);
    else expect(withExclude.status).toBeLessThan(500);
  });

  it('reservar o horário que B ocupou é recusado (SLOT_UNAVAILABLE) e não troca o dono', async () => {
    const prepared = await call(clientA, 'prepare_booking', {
      space: 'arena-e2e',
      date: bBooking.slot.date,
      startTime: bBooking.slot.startTime,
      durationMin: 60,
      peopleCount: 2,
      sport: 'futevolei',
      court: bBooking.slot.court,
    });
    // O prepare já enxerga o horário ocupado (sem código); se gerasse um, a criação seria recusada.
    if (!prepared.isError && prepared.data.confirmation) {
      const created = await call(
        clientA,
        'create_booking',
        prepared.data.confirmation.createBookingInput,
      );
      expect(created.isError).toBe(true);
    } else {
      expect(prepared.data.confirmation).toBeUndefined();
    }
    const row = await bookingRow(bBooking.bookingId);
    expect(row?.organizer_user_id).toBe(b.id);
  });
});

describe('(2) segurança — aulas: presença só nas próprias turmas', () => {
  it('A não vê, não confirma e não desmarca presença em aula de B (sessão válida de outra turma)', async () => {
    const owner = await userByEmail(USERS.c); // aluno ativo da turma "Futevôlei iniciante"
    const session = await createOpenClassSession(40);
    const ownerSession = await connect(USERS.c);
    const ownerClient = await mcpClient(ownerSession.tokens.access_token);
    const a = await freshPlayerToken('iso-aula');
    const clientA = await mcpClient(a.token);
    try {
      // B (aluno) confirma a própria presença.
      const confirmed = await ok(ownerClient, 'confirm_class_attendance', {
        sessionId: session.id,
      });
      expect(confirmed.class.myAttendance.status).toBe('CONFIRMED');

      // A (sem matrícula na turma) com o id válido da aula de B.
      const detail = await api(`/v1/me/class-sessions/${session.id}`, a.token);
      expect([detail.status, detail.body.error?.code]).toEqual([404, 'CLASS_SESSION_NOT_FOUND']);
      const mineA = await ok(clientA, 'list_my_classes', {});
      expect(JSON.stringify(mineA)).not.toContain(session.id);

      const confirmA = await call(clientA, 'confirm_class_attendance', { sessionId: session.id });
      expect(confirmA.isError).toBe(true);
      const withdrawA = await call(clientA, 'cancel_class_attendance', { sessionId: session.id });
      expect(withdrawA.isError).toBe(true);

      const rows = await sql<{ user_id: string; status: string }>(
        'select user_id, status from attendances where session_id=$1',
        [session.id],
      );
      expect(rows).toEqual([{ user_id: owner.id, status: 'CONFIRMED' }]);
    } finally {
      await ownerClient.close();
      await clientA.close();
    }
  });

  it('colegas confirmados aparecem só pelo primeiro nome, sem foto, telefone ou e-mail (RN-MCP-05)', async () => {
    // Aula em andamento do seed: jogador.e2e e jogador2.e2e confirmados.
    const a = await connect(USERS.a);
    const detail = await api('/v1/me/class-sessions', a.tokens.access_token);
    expect(detail.status).toBe(200);
    const [session] = detail.body.items as { id: string }[];
    expect(session).toBeDefined();
    const one = await api(`/v1/me/class-sessions/${session?.id}`, a.tokens.access_token);
    expect(one.status).toBe(200);
    const raw = JSON.stringify(one.body);
    expect(raw).not.toMatch(/@exemplo\.com/);
    expect(raw).not.toMatch(/\+55\d{9,}/);
    expect(raw).not.toContain('Jogador Dois E2E');
  });
});
