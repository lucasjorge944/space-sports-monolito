import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import { bookingRow, freshPlayerToken, pickSlot, spDate } from './support/helpers.js';
import { call, mcpClient, ok } from './support/mcp.js';
import { api } from './support/oauth.js';

/**
 * As regras de reserva (RN-BOOK-*) continuam na API: pelo MCP elas não podem ser contornadas
 * (docs/14-mcp.md, "não reimplementa regra de negócio").
 */
describe('regras de reserva pelo MCP — prazos, limites, concorrência e fuso (RN-BOOK-01..07)', () => {
  let user: Awaited<ReturnType<typeof freshPlayerToken>>;
  let client: Client;

  beforeAll(async () => {
    user = await freshPlayerToken('regras');
    client = await mcpClient(user.token);
  });

  afterAll(async () => {
    await client?.close();
  });

  const prepareArgs = (date: string, startTime: string, extra: Record<string, unknown> = {}) => ({
    space: 'arena-e2e',
    date,
    startTime,
    durationMin: 60,
    peopleCount: 2,
    sport: 'futevolei',
    court: 'Quadra A',
    paymentOption: 'ON_SITE',
    ...extra,
  });

  it('data no passado e além da janela de 30 dias: nenhum código de confirmação sai', async () => {
    for (const date of [spDate(-1), spDate(-30), spDate(31), spDate(120)]) {
      const res = await call(client, 'prepare_booking', prepareArgs(date, '10:00'));
      expect(res.isError, date).toBe(true);
      expect(res.data.confirmation, date).toBeUndefined();
    }
  });

  it('antecedência mínima (60 min): reservar daqui a poucos minutos é recusado', async () => {
    const now = new Date(Date.now() + 15 * 60_000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
    const [h = '00', m = '00'] = parts.split(':');
    const startTime = `${h === '24' ? '00' : h}:${Number(m) < 30 ? '00' : '30'}`;
    const res = await call(client, 'prepare_booking', prepareArgs(spDate(0), startTime));
    // Horário ocupado/passado/dentro da antecedência: em qualquer caso, sem código.
    if (!res.isError) {
      expect(res.data.confirmation).toBeUndefined();
    }
  });

  it('pessoas acima da capacidade, duração fora da grade e esporte inexistente são recusados', async () => {
    const date = spDate(12);
    for (const extra of [
      { peopleCount: 99 },
      { peopleCount: 0 },
      { peopleCount: 2.5 },
      { durationMin: 45 },
      { durationMin: 30 },
      { durationMin: 600 },
      { sport: 'esporte-que-nao-existe' },
    ]) {
      const res = await call(client, 'prepare_booking', prepareArgs(date, '10:00', extra)).catch(
        () => ({ isError: true, data: {} as Record<string, unknown> }),
      );
      expect(res.isError, JSON.stringify(extra)).toBe(true);
      expect(res.data.confirmation, JSON.stringify(extra)).toBeUndefined();
    }
  });

  it('API direta com o token: startsAt no passado e fora da grade de 30 min é recusado', async () => {
    const slot = await pickSlot(client, 'arena-e2e', 13);
    const prepared = await ok(
      client,
      'prepare_booking',
      prepareArgs(slot.date, slot.startTime, { court: slot.court }),
    );
    const input = prepared.confirmation.createBookingInput;
    const base = {
      spaceId: input.spaceId,
      courtId: input.courtId,
      sportId: input.sportId,
      durationMin: 60,
      peopleCount: 2,
      paymentOption: 'ON_SITE',
    };
    const offGrid = new Date(
      new Date(`${slot.date}T${slot.startTime}:00-03:00`).getTime() + 7 * 60_000,
    ).toISOString();
    for (const startsAt of [new Date(Date.now() - 86_400_000).toISOString(), offGrid]) {
      const res = await api('/v1/bookings', user.token, {
        method: 'POST',
        json: { ...base, startsAt },
        headers: { 'Idempotency-Key': `qa-regra-${startsAt}` },
      });
      expect(res.status, startsAt).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  it('concorrência: dois jogadores confirmam o mesmo horário ao mesmo tempo — exatamente um fica com ele', async () => {
    const other = await freshPlayerToken('regras2');
    const otherClient = await mcpClient(other.token);
    try {
      const slot = await pickSlot(client, 'arena-e2e', 14);
      const args = prepareArgs(slot.date, slot.startTime, { court: slot.court });
      const [a, b] = await Promise.all([
        ok(client, 'prepare_booking', args),
        ok(otherClient, 'prepare_booking', args),
      ]);
      const [ra, rb] = await Promise.all([
        call(client, 'create_booking', a.confirmation.createBookingInput),
        call(otherClient, 'create_booking', b.confirmation.createBookingInput),
      ]);
      expect([ra.isError, rb.isError].filter((failed) => !failed)).toHaveLength(1);
      const loser = ra.isError ? ra : rb;
      expect(loser.code).toMatch(/SLOT|UNAVAILABLE|CONFLICT/i);
      const rows = await sql<{ id: string }>(
        `select id from bookings where court_id=$1 and starts_at=$2 and status <> 'CANCELLED'`,
        [
          a.confirmation.createBookingInput.courtId,
          new Date(`${slot.date}T${slot.startTime}:00-03:00`).toISOString(),
        ],
      );
      expect(rows).toHaveLength(1);
    } finally {
      await otherClient.close();
    }
  });

  it('fuso: 23:00–00:00 em America/Sao_Paulo vira 02:00Z–03:00Z do dia seguinte no banco e volta igual na tool', async () => {
    const date = spDate(15);
    const availability = await ok(client, 'check_availability', {
      space: 'arena-e2e',
      date,
      sport: 'futevolei',
      durationMin: 60,
    });
    const court = availability.courts.find((c: { freeStartTimes: string[] }) =>
      c.freeStartTimes.includes('23:00'),
    );
    expect(court, 'sem horário livre às 23:00').toBeDefined();
    const prepared = await ok(
      client,
      'prepare_booking',
      prepareArgs(date, '23:00', { court: court.name }),
    );
    expect(prepared.summary.endTime).toBe('00:00');
    const created = await ok(client, 'create_booking', prepared.confirmation.createBookingInput);
    expect(created.booking).toMatchObject({ date, startTime: '23:00', endTime: '00:00' });
    const [row] = await sql<{ starts_at: Date; ends_at: Date }>(
      'select starts_at, ends_at from bookings where id=$1',
      [created.booking.id],
    );
    const nextDay = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(row?.starts_at.toISOString()).toBe(`${nextDay}T02:00:00.000Z`);
    expect(row?.ends_at.toISOString()).toBe(`${nextDay}T03:00:00.000Z`);
  });

  it('prazo de cancelamento: dentro dos 60 min, prepare_cancel_booking recusa antes de gerar código', async () => {
    const slot = await pickSlot(client, 'arena-e2e', 16);
    const prepared = await ok(
      client,
      'prepare_booking',
      prepareArgs(slot.date, slot.startTime, { court: slot.court }),
    );
    const created = await ok(client, 'create_booking', prepared.confirmation.createBookingInput);
    const id = created.booking.id as string;
    // Empurra a reserva para daqui a 30 min (dentro do prazo de 60 min), como se o tempo tivesse passado.
    const soon = new Date(Date.now() + 30 * 60_000);
    await sql(`update bookings set starts_at=$1, ends_at=$2 where id=$3`, [
      soon.toISOString(),
      new Date(soon.getTime() + 3_600_000).toISOString(),
      id,
    ]);
    const res = await call(client, 'prepare_cancel_booking', { bookingId: id });
    expect(res.isError, res.text).toBe(true);
    expect(res.data.confirmation).toBeUndefined();
    expect((await bookingRow(id))?.status).toBe('CONFIRMED');
    // Pela API direta o prazo também vale.
    const direct = await api(`/v1/bookings/${id}/cancel`, user.token, { method: 'POST', json: {} });
    expect(direct.status).toBeGreaterThanOrEqual(400);
    expect((await bookingRow(id))?.status).toBe('CONFIRMED');
  });
});
