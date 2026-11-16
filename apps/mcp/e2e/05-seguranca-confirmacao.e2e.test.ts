import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import { apiBookingBody, bookingRow, freshPlayerToken, pickSlot } from './support/helpers.js';
import { call, mcpClient, ok } from './support/mcp.js';

/**
 * RN-MCP-02: o código de confirmação (HMAC dos parâmetros + usuário + 10 min) é a barreira que não
 * depende do cliente nem do modelo. Cada caso aqui tenta gravar com um código que não vale.
 */
describe('(2) segurança — código de confirmação (RN-MCP-02, decisão 114)', () => {
  let a: Awaited<ReturnType<typeof freshPlayerToken>>;
  let b: Awaited<ReturnType<typeof freshPlayerToken>>;
  let clientA: Client;
  let clientB: Client;

  beforeAll(async () => {
    a = await freshPlayerToken('cod-a');
    b = await freshPlayerToken('cod-b');
    clientA = await mcpClient(a.token);
    clientB = await mcpClient(b.token);
  });

  afterAll(async () => {
    await clientA?.close();
    await clientB?.close();
  });

  const prepare = async (client: Client, days: number, extra: Record<string, unknown> = {}) => {
    const slot = await pickSlot(client, 'arena-e2e', days);
    const prepared = await ok(client, 'prepare_booking', {
      space: 'arena-e2e',
      date: slot.date,
      startTime: slot.startTime,
      durationMin: 60,
      peopleCount: 2,
      sport: 'futevolei',
      court: slot.court,
      paymentOption: 'ON_SITE',
      ...extra,
    });
    return { slot, input: prepared.confirmation.createBookingInput as Record<string, unknown> };
  };

  const countBookings = async (userId: string) =>
    Number(
      (
        await sql<{ count: string }>('select count(*) from bookings where organizer_user_id=$1', [
          userId,
        ])
      )[0]?.count,
    );

  /** Quantas escritas do MCP a API viu deste usuário (o `mcp.request` é gravado antes do handler). */
  const countApiWrites = async (userId: string) =>
    Number(
      (
        await sql<{ count: string }>(
          `select count(*) from audit_logs where actor_id=$1 and action='mcp.request'`,
          [userId],
        )
      )[0]?.count,
    );

  it('o código vale só para exatamente os mesmos parâmetros: trocar qualquer um é recusado, sem gravar e sem chamar a API', async () => {
    const { input, slot } = await prepare(clientA, 10);
    const otherTime = slot.startTime === '09:00' ? '10:00' : '09:00';
    const variations: Record<string, unknown>[] = [
      {
        date: new Date(Date.parse(`${input.date}T12:00:00Z`) + 86_400_000)
          .toISOString()
          .slice(0, 10),
      },
      { startTime: otherTime },
      { durationMin: 90 },
      { peopleCount: 3 },
      { paymentOption: 'ONLINE_PIX' },
      { courtId: '00000000-0000-4000-8000-000000000001' },
      { sportId: '00000000-0000-4000-8000-000000000002' },
      { spaceId: '00000000-0000-4000-8000-000000000003' },
    ];
    const bookingsBefore = await countBookings(a.id);
    const writesBefore = await countApiWrites(a.id);
    for (const change of variations) {
      const res = await call(clientA, 'create_booking', { ...input, ...change });
      expect(res.isError, JSON.stringify(change)).toBe(true);
      expect(['CONFIRMATION_MISMATCH', 'CONFIRMATION_INVALID'], JSON.stringify(change)).toContain(
        res.code,
      );
    }
    expect(await countBookings(a.id)).toBe(bookingsBefore);
    // Recusada ANTES de qualquer chamada à API: nenhuma escrita chegou lá.
    expect(await countApiWrites(a.id)).toBe(writesBefore);
    // E o código intacto ainda funciona uma vez (a recusa não o queimou).
    const good = await call(clientA, 'create_booking', input);
    expect(good.isError, good.text).toBe(false);
  });

  it('o código de A não vale para B (usuário vai dentro do HMAC)', async () => {
    const { input } = await prepare(clientA, 11);
    const before = await countBookings(b.id);
    const res = await call(clientB, 'create_booking', input);
    expect(res.isError).toBe(true);
    expect(res.code).toBe('CONFIRMATION_INVALID');
    expect(await countBookings(b.id)).toBe(before);
    expect(await countBookings(a.id)).toBeGreaterThanOrEqual(0);
    // A criação de A com o próprio código continua valendo.
    expect((await call(clientA, 'create_booking', input)).isError).toBe(false);
  });

  it('código adulterado (assinatura, payload, prefixo, truncado, vazio, de outra ação) é recusado', async () => {
    const { input } = await prepare(clientA, 12);
    const code = input.confirmationCode as string;
    const [version, payload, signature] = code.split('.') as [string, string, string];
    const flip = (value: string) => `${value.slice(0, -2)}${value.endsWith('AA') ? 'BB' : 'AA'}`;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const edited = Buffer.from(JSON.stringify({ ...decoded, s: b.id })).toString('base64url');
    const tampered = [
      `${version}.${payload}.${flip(signature)}`, // assinatura alterada
      `${version}.${edited}.${signature}`, // payload editado (outro usuário), mesma assinatura
      `v2.${payload}.${signature}`, // outra versão
      `${version}.${payload}`, // sem assinatura
      `${version}.${payload}.${signature}=`, // variante base64 com padding
      `${version}.${payload}.${signature}!`,
      code.slice(0, 40),
      '',
      'v1..',
      'x'.repeat(2000),
    ];
    const before = await countBookings(a.id);
    for (const confirmationCode of tampered) {
      const res = await call(clientA, 'create_booking', { ...input, confirmationCode }).catch(
        (error: unknown) => ({ isError: true, text: String(error), data: {} as { code?: string } }),
      );
      expect(res.isError, confirmationCode.slice(0, 50)).toBe(true);
    }
    expect(await countBookings(a.id)).toBe(before);
  });

  it('o código de reserva não serve para cancelar, e o de cancelamento não serve para reservar', async () => {
    const { input } = await prepare(clientA, 13);
    const created = await ok(clientA, 'create_booking', input);
    const bookingId = created.booking.id as string;
    const cancel = await ok(clientA, 'prepare_cancel_booking', { bookingId });
    const cancelInput = cancel.confirmation.cancelBookingInput;

    const crossed = await call(clientA, 'cancel_booking', {
      bookingId,
      reason: null,
      confirmationCode: input.confirmationCode,
    });
    expect(crossed.isError).toBe(true);
    expect((await bookingRow(bookingId))?.status).toBe('CONFIRMED');

    const crossed2 = await call(clientA, 'create_booking', {
      ...input,
      confirmationCode: cancelInput.confirmationCode,
    });
    expect(crossed2.isError).toBe(true);

    // O motivo do cancelamento faz parte dos parâmetros assinados.
    const withReason = await call(clientA, 'cancel_booking', {
      ...cancelInput,
      reason: 'motivo trocado depois da confirmação',
    });
    expect(withReason.isError).toBe(true);
    expect((await bookingRow(bookingId))?.status).toBe('CONFIRMED');

    // O código legítimo ainda cancela.
    const done = await ok(clientA, 'cancel_booking', cancelInput);
    expect(done.booking.status).toBe('CANCELLED');
  });

  it('RN-MCP-02: o preço do resumo vai assinado — se mudar antes de gravar, PRICE_CHANGED e nada é gravado', async () => {
    const spaceRows = await sql<{ id: string; price: number }>(
      `select s.id, st.price_per_hour_cents as price from spaces s join space_settings st on st.space_id = s.id where s.slug='arena-e2e-norte'`,
    );
    const space = spaceRows[0];
    if (!space) throw new Error('arena-e2e-norte não existe no seed');
    const slot = await pickSlot(clientA, 'arena-e2e-norte', 14);
    const prepared = await ok(clientA, 'prepare_booking', {
      space: 'arena-e2e-norte',
      date: slot.date,
      startTime: slot.startTime,
      durationMin: 60,
      peopleCount: 2,
      sport: 'futevolei',
      court: slot.court,
      paymentOption: 'ON_SITE',
    });
    const input = prepared.confirmation.createBookingInput;
    const before = await countBookings(a.id);
    await sql('update space_settings set price_per_hour_cents = $1 where space_id = $2', [
      space.price + 5_000,
      space.id,
    ]);
    try {
      const res = await call(clientA, 'create_booking', input);
      expect(res.isError).toBe(true);
      expect(res.code).toBe('PRICE_CHANGED');
      expect(await countBookings(a.id)).toBe(before);
    } finally {
      await sql('update space_settings set price_per_hour_cents = $1 where space_id = $2', [
        space.price,
        space.id,
      ]);
    }
    // Com o preço de volta, o mesmo código volta a valer.
    expect((await call(clientA, 'create_booking', input)).isError).toBe(false);
  });

  it('API direta: a Idempotency-Key repetida com OUTRO pedido responde 422 IDEMPOTENCY_KEY_REUSED (sem 2ª reserva)', async () => {
    const { api } = await import('./support/oauth.js');
    const first = await prepare(clientB, 15);
    const body = apiBookingBody(first.input as never);
    const key = `qa-idem-${Date.now()}`;
    const created = await api('/v1/bookings', b.token, {
      method: 'POST',
      json: body,
      headers: { 'Idempotency-Key': key },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const second = await prepare(clientB, 16);
    const other = await api('/v1/bookings', b.token, {
      method: 'POST',
      json: apiBookingBody(second.input as never),
      headers: { 'Idempotency-Key': key },
    });
    expect([other.status, other.body.error?.code]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED']);
    const sameAgain = await api('/v1/bookings', b.token, {
      method: 'POST',
      json: body,
      headers: { 'Idempotency-Key': key },
    });
    expect(sameAgain.body.id ?? sameAgain.body.booking?.id).toBe(
      created.body.id ?? created.body.booking?.id,
    );
  });
});
