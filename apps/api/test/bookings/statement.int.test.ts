import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STATEMENT_CSV_COLUMNS } from '../../src/bookings/statement.service.js';
import {
  bookingParticipants,
  paymentRecords,
  recurringBookingCharges,
  recurringBookings,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { first } from '../db/helpers.js';
import { bearer, createSpace, member, type Space, slotIn } from './fixtures.js';

// RF-PAY-03: extrato de recebimentos do espaço por período, forma e serviço, com totais e CSV.

type Row = Record<string, unknown>;

/** Março/2026 em UTC: [01/03 00:00Z, 01/04 00:00Z). */
const MARCH = { from: '2026-03-01T00:00:00Z', to: '2026-04-01T00:00:00Z' };

describe('extrato de recebimentos', () => {
  let t: TestApp;
  let space: Space;
  let otherSpace: Space;
  let owner: SignedUp;
  let manager: SignedUp;
  let teacher: SignedUp;
  let otherOwner: SignedUp;
  let player: SignedUp;
  let deskBookingId: string;
  let playerBookingId: string;
  let participantId: string;
  let chargeId: string;
  let reversedId: string;

  const manage = (path: string, spaceId = space.id) => `/v1/manage/spaces/${spaceId}/${path}`;

  const pay = (body: Row, spaceId = space.id) =>
    t
      .http()
      .post(manage('payments', spaceId))
      .set(...bearer(spaceId === space.id ? manager : otherOwner))
      .send(body)
      .expect(201)
      .then((res) => res.body.id as string);

  const desk = (body: Row, startsAt: Date, spaceId = space.id, courtId = space.courtA) =>
    t
      .http()
      .post(manage('bookings', spaceId))
      .set(...bearer(spaceId === space.id ? manager : otherOwner))
      .send({
        courtId,
        sportId: space.sportId,
        startsAt: startsAt.toISOString(),
        durationMin: 60,
        peopleCount: 2,
        ...body,
      })
      .expect(201)
      .then((res) => res.body.id as string);

  const statement = (query: Row = MARCH, user = owner, spaceId = space.id) =>
    t
      .http()
      .get(manage('statement', spaceId))
      .query(query)
      .set(...bearer(user));

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-extrato');
    otherSpace = await createSpace(t.db, 'arena-vizinha-extrato');
    owner = await member(t, 'dono@exemplo.com', space.id, 'OWNER');
    manager = await member(t, 'gestor@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'professor@exemplo.com', space.id, 'TEACHER');
    otherOwner = await member(t, 'dono-vizinho@exemplo.com', otherSpace.id, 'OWNER');
    player = await signUp(t, 'jogador@exemplo.com', 'Jogador Pagante');

    // Reserva de balcão (R$ 100): Pix e dinheiro (estornado) em março, cartão em abril.
    deskBookingId = await desk(
      { guestName: 'Cliente Balcão', guestPhone: '+5531988887777' },
      slotIn(24 * 60),
    );
    await pay({
      payableType: 'BOOKING',
      payableId: deskBookingId,
      amountCents: 4_000,
      method: 'PIX',
      paidAt: '2026-03-10T15:00:00Z',
      note: '=SOMA(A1)',
    });
    reversedId = await pay({
      payableType: 'BOOKING',
      payableId: deskBookingId,
      amountCents: 3_000,
      method: 'CASH',
      paidAt: '2026-03-11T15:00:00Z',
    });
    await t
      .http()
      .post(manage(`payments/${reversedId}/reverse`))
      .set(...bearer(manager))
      .send({})
      .expect(200);
    await pay({
      payableType: 'BOOKING',
      payableId: deskBookingId,
      amountCents: 6_000,
      method: 'CARD',
      paidAt: '2026-04-02T15:00:00Z',
    });

    // Reserva de jogador do app com uma parte da conta dividida.
    playerBookingId = await desk(
      { customerUserId: player.id },
      slotIn(24 * 60),
      space.id,
      space.courtB,
    );
    participantId = first(
      await t.db
        .insert(bookingParticipants)
        .values({
          bookingId: playerBookingId,
          name: 'Amigo Convidado',
          shareCents: 5_000,
          inviteToken: 'convite-extrato',
        })
        .returning(),
    ).id;
    // Registro antigo: o recebimento por participante saiu (decisão 50), mas segue no extrato.
    await t.db.insert(paymentRecords).values({
      spaceId: space.id,
      payableType: 'BOOKING_PARTICIPANT',
      payableId: participantId,
      amountCents: 2_500,
      method: 'CASH',
      paidAt: new Date('2026-03-20T15:00:00Z'),
      recordedBy: manager.id,
    });
    // Fronteira: 31/03 23:59:59Z entra; 01/04 00:00Z (fim exclusivo) não entra.
    await pay({
      payableType: 'BOOKING',
      payableId: playerBookingId,
      amountCents: 1_000,
      method: 'PIX',
      paidAt: '2026-03-31T23:59:59Z',
    });
    await pay({
      payableType: 'BOOKING',
      payableId: playerBookingId,
      amountCents: 1_500,
      method: 'PIX',
      paidAt: '2026-04-01T00:00:00Z',
    });

    // Mensalidade de mensalista cadastrado sem app.
    const recurring = first(
      await t.db
        .insert(recurringBookings)
        .values({
          spaceId: space.id,
          courtId: space.courtA,
          sportId: space.sportId,
          guestName: 'Mensalista Sem App',
          guestPhone: '+5531977776666',
          weekday: 2,
          startTime: '07:00',
          durationMin: 60,
          peopleCount: 4,
          startsOn: '2026-03-01',
          status: 'ACTIVE',
        })
        .returning(),
    );
    chargeId = first(
      await t.db
        .insert(recurringBookingCharges)
        .values({
          recurringBookingId: recurring.id,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
          dueDate: '2026-03-31',
          amountCents: 20_000,
          status: 'PENDING',
        })
        .returning(),
    ).id;
    // Pagamento antigo de mensalidade (decisão 27: não há mais registro novo; o antigo fica no extrato).
    await t.db.insert(paymentRecords).values({
      spaceId: space.id,
      payableType: 'RECURRING_BOOKING_CHARGE',
      payableId: chargeId,
      amountCents: 20_000,
      method: 'PIX',
      paidAt: new Date('2026-03-12T15:00:00Z'),
      recordedBy: manager.id,
    });

    // Fora do extrato: outro espaço e serviços que ainda não entram nele (torneios). A mensalidade
    // de aula (serviço CLASS) é coberta em test/classes/subscriptions.int.test.ts.
    const otherBooking = await desk(
      { guestName: 'Cliente Vizinho', guestPhone: '+5531966665555' },
      slotIn(24 * 60),
      otherSpace.id,
      otherSpace.courtA,
    );
    await pay(
      {
        payableType: 'BOOKING',
        payableId: otherBooking,
        amountCents: 9_000,
        method: 'PIX',
        paidAt: '2026-03-15T15:00:00Z',
      },
      otherSpace.id,
    );
    await t.db.insert(paymentRecords).values({
      spaceId: space.id,
      payableType: 'TEAM',
      payableId: crypto.randomUUID(),
      amountCents: 8_000,
      method: 'CARD',
      paidAt: new Date('2026-03-13T15:00:00Z'),
      recordedBy: owner.id,
    });
  });
  afterAll(() => t.close());

  it('lista o período com totais por forma e total geral (centavos, sem estornos)', async () => {
    const res = await statement().expect(200);
    expect(res.body.period).toEqual({
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-04-01T00:00:00.000Z',
    });
    expect(res.body.timeZone).toBe('America/Sao_Paulo');
    // 4.000 + 2.500 + 1.000 + 20.000
    expect(res.body.totals).toEqual({
      receivedCents: 27_500,
      paymentsCount: 4,
      reversedCents: 3_000,
    });
    expect(res.body.byMethod).toEqual([
      { method: 'PIX', receivedCents: 25_000, paymentsCount: 3 },
      { method: 'CASH', receivedCents: 2_500, paymentsCount: 1 },
    ]);
    // Mais recentes primeiro, inclusive o estornado.
    expect(
      res.body.items.map((i: Row) => [i.paidAt, i.amountCents, i.reversedAt !== null]),
    ).toEqual([
      ['2026-03-31T23:59:59.000Z', 1_000, false],
      ['2026-03-20T15:00:00.000Z', 2_500, false],
      ['2026-03-12T15:00:00.000Z', 20_000, false],
      ['2026-03-11T15:00:00.000Z', 3_000, true],
      ['2026-03-10T15:00:00.000Z', 4_000, false],
    ]);
    expect(res.body.nextCursor).toBeNull();
  });

  it('descreve cada registro: serviço, pagador, quadra e item pago', async () => {
    const { items } = (await statement().expect(200)).body as { items: Row[] };
    const byAmount = (cents: number) => items.find((i) => i.amountCents === cents);
    expect(byAmount(4_000)).toMatchObject({
      service: 'RENTAL',
      payableType: 'BOOKING',
      payerName: 'Cliente Balcão',
      recordedByName: 'Jogador Teste',
      recordedBy: manager.id,
      bookingId: deskBookingId,
      courtName: 'Quadra A',
      recurringBookingId: null,
      chargePeriodStart: null,
      note: '=SOMA(A1)',
    });
    expect(byAmount(2_500)).toMatchObject({
      service: 'RENTAL',
      payableType: 'BOOKING_PARTICIPANT',
      payableId: participantId,
      payerName: 'Amigo Convidado',
      bookingId: playerBookingId,
      courtName: 'Quadra B',
    });
    expect(byAmount(1_000)).toMatchObject({ payerName: 'Jogador Pagante', payerUserId: player.id });
    expect(byAmount(20_000)).toMatchObject({
      service: 'RECURRING',
      payableType: 'RECURRING_BOOKING_CHARGE',
      payableId: chargeId,
      payerName: 'Mensalista Sem App',
      bookingId: null,
      bookingStartsAt: null,
      chargePeriodStart: '2026-03-01',
      courtName: 'Quadra A',
    });
    expect(byAmount(4_000)?.bookingStartsAt).toEqual(expect.any(String));
  });

  it('filtra por forma de pagamento e por serviço', async () => {
    const cash = (await statement({ ...MARCH, method: 'CASH' }).expect(200)).body;
    expect(cash.totals).toEqual({ receivedCents: 2_500, paymentsCount: 1, reversedCents: 3_000 });
    expect(cash.items.map((i: Row) => i.amountCents)).toEqual([2_500, 3_000]);

    const rental = (await statement({ ...MARCH, service: 'RENTAL' }).expect(200)).body;
    expect(rental.totals.receivedCents).toBe(7_500);
    expect(rental.items.every((i: Row) => i.service === 'RENTAL')).toBe(true);

    const recurring = (
      await statement({ ...MARCH, service: 'RECURRING', method: 'PIX' }).expect(200)
    ).body;
    expect(recurring.totals).toEqual({ receivedCents: 20_000, paymentsCount: 1, reversedCents: 0 });
    expect(recurring.byMethod).toEqual([
      { method: 'PIX', receivedCents: 20_000, paymentsCount: 1 },
    ]);

    // Abril: o registro das 00:00Z do dia 1 e o de cartão.
    const april = (
      await statement({ from: '2026-04-01T00:00:00Z', to: '2026-05-01T00:00:00Z' }).expect(200)
    ).body;
    expect(april.totals.receivedCents).toBe(7_500);
  });

  it('pagina por cursor sem repetir nem pular registros; os totais valem para todas as páginas', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const body = (
        await statement({ ...MARCH, limit: 2, ...(cursor ? { cursor } : {}) }).expect(200)
      ).body;
      expect(body.totals.receivedCents).toBe(27_500);
      seen.push(...body.items.map((i: Row) => i.id as string));
      cursor = body.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    const all = (await statement().expect(200)).body.items.map((i: Row) => i.id);
    expect(seen).toEqual(all);

    const bad = await statement({ ...MARCH, cursor: 'xpto' }).expect(400);
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
  });

  it('valida o período e os filtros', async () => {
    await statement({}).expect(400);
    await statement({ from: MARCH.to, to: MARCH.from }).expect(400);
    await statement({ from: MARCH.from, to: MARCH.from }).expect(400);
    await statement({ from: '2026-03-01', to: '2026-04-01' }).expect(400);
    await statement({ ...MARCH, method: 'BOLETO' }).expect(400);
    await statement({ ...MARCH, service: 'CLASSES' }).expect(400);
    await statement({ ...MARCH, limit: 101 }).expect(400);
  });

  it('mesmas permissões de "a receber hoje": Dono e Admin; nada de outro espaço', async () => {
    await statement(MARCH, manager).expect(200);
    const forbidden = await statement(MARCH, teacher).expect(403);
    expect(forbidden.body.error.code).toBe('SPACE_FORBIDDEN');
    await statement(MARCH, otherOwner).expect(403);
    await statement(MARCH, player).expect(403);
    await t.http().get(manage('statement')).query(MARCH).expect(401);
    await t
      .http()
      .get(manage('statement.csv'))
      .query(MARCH)
      .set(...bearer(teacher))
      .expect(403);

    // O vizinho vê só o próprio espaço.
    const other = (await statement(MARCH, otherOwner, otherSpace.id).expect(200)).body;
    expect(other.totals).toEqual({ receivedCents: 9_000, paymentsCount: 1, reversedCents: 0 });
  });

  it('exporta CSV com os mesmos filtros, em ordem cronológica e com datas locais', async () => {
    const res = await t
      .http()
      .get(manage('statement.csv'))
      .query({ ...MARCH, service: 'RENTAL' })
      .set(...bearer(manager))
      .buffer(true)
      .parse((r, done) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (chunk: string) => {
          data += chunk;
        });
        r.on('end', () => done(null, data));
      })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="extrato-2026-03-01_2026-04-01.csv"',
    );
    const text = res.body as string;
    expect(text.startsWith('﻿')).toBe(true);
    const lines = text.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(STATEMENT_CSV_COLUMNS.join(','));
    const rows = lines.slice(1).map((line) => line.split(','));
    expect(rows.map((r) => r[7])).toEqual(['4000', '3000', '2500', '1000']);

    const [first4000, reversed] = rows;
    // 10/03 15:00Z = 12:00 em São Paulo; observação com cara de fórmula é neutralizada.
    expect(first4000?.slice(1, 10)).toEqual([
      '10/03/2026 15:00:00',
      '10/03/2026 12:00:00',
      'RENTAL',
      'BOOKING',
      'PIX',
      'no_local',
      '4000',
      'Cliente Balcão',
      'Quadra A',
    ]);
    expect(first4000?.[10]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    expect(first4000?.[13]).toBe("'=SOMA(A1)");
    expect(reversed?.[0]).toBe(reversedId);
    expect(reversed?.[14]).not.toBe('');

    const recurring = await t
      .http()
      .get(manage('statement.csv'))
      .query({ ...MARCH, service: 'RECURRING' })
      .set(...bearer(owner))
      .expect(200);
    const recurringRows = recurring.text.slice(1).trimEnd().split('\r\n').slice(1);
    expect(recurringRows).toHaveLength(1);
    expect(recurringRows[0]?.split(',')[11]).toBe('03/2026');

    await t
      .http()
      .get(manage('statement.csv'))
      .query({ from: MARCH.to, to: MARCH.from })
      .set(...bearer(owner))
      .expect(400);
  });
});
