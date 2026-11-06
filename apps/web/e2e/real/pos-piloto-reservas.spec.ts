import { expect, type Page, test } from '@playwright/test';
import {
  apiAs,
  body,
  courtsAndSport,
  disposeClients,
  errorOf,
  type Json,
  localDate,
  login,
  saoPauloInstant,
} from './support/api';
import { USERS } from './support/env';

// A.4 + decisão 49: o jogador edita a própria reserva (pessoas, data, horário, duração).
// A.1 (5) + decisão 50: o recebimento é só da reserva inteira (nada de pagamento por participante).
// Cobre RF-BOOK-03, RN-BOOK-01/09/10/11/12/13, RF-BOOK-08/RF-PAY-01 e RN-PAY-01. "Arena E2E":
// R$ 100/h, 24 h, antecedência mínima de 60 min, prazo de cancelamento de 60 min, quadras de 4.
test.describe.configure({ mode: 'serial' });

// Dia e horários próprios (a agenda.spec usa +3 dias; as aulas, quarta e quinta à noite).
const DAY = localDate(6);
const at = (time: string) => saoPauloInstant(DAY, time).toISOString();

const state = {} as {
  spaceId: string;
  sportId: string;
  courtA: string;
  bookingId: string;
  otherBookingId: string;
  participantIds: string[];
};

test.afterAll(disposeClients);

test.beforeAll(async ({ playwright }) => {
  const owner = await apiAs(playwright, USERS.owner);
  state.spaceId = (await body(await owner.get('/v1/me'))).memberships[0].space.id;
  const catalog = await courtsAndSport(owner, state.spaceId);
  state.sportId = catalog.sportId;
  state.courtA = catalog.court('Quadra A');
});

const mine = (id: string) => `/v1/bookings/${id}`;

async function myBooking(client: Awaited<ReturnType<typeof apiAs>>, id: string) {
  return body(await client.get(mine(id)));
}

test('RF-BOOK-03: o jogador reserva e o detalhe diz o que ele ainda pode editar', async ({
  playwright,
}) => {
  const player = await apiAs(playwright, USERS.player);
  const res = await player.post('/v1/bookings', {
    data: {
      spaceId: state.spaceId,
      courtId: state.courtA,
      sportId: state.sportId,
      startsAt: at('17:00'),
      durationMin: 60,
      peopleCount: 2,
    },
  });
  expect(res.status(), JSON.stringify(await res.json())).toBe(201);
  const booking = await body(res);
  state.bookingId = booking.id;
  expect(booking).toMatchObject({
    priceCents: 10_000,
    peopleCount: 2,
    status: 'CONFIRMED',
    canEditPeople: true,
    peopleEditBlock: null,
    canEditSchedule: true,
    scheduleEditBlock: null,
  });
});

test('RN-BOOK-11: edita o número de pessoas — de 1 até o máximo da quadra, nunca abaixo dos convidados', async ({
  playwright,
}) => {
  const player = await apiAs(playwright, USERS.player);
  const patch = (data: object) => player.patch(mine(state.bookingId), { data });

  const four = await patch({ peopleCount: 4 });
  expect(four.status()).toBe(200);
  expect((await body(four)).peopleCount).toBe(4);

  // A quadra comporta 4 no futevôlei.
  const five = await patch({ peopleCount: 5 });
  expect(five.status()).toBe(422);
  expect((await errorOf(five)).code).toBe('PEOPLE_EXCEED_CAPACITY');

  // Convida duas pessoas por link (organizador + 2 = 3): não dá para baixar para 2.
  const invited = await player.post(`${mine(state.bookingId)}/invites`, {
    data: { names: ['Convidado Um', 'Convidado Dois'] },
  });
  expect(invited.status()).toBe(201);
  const detail = await body(invited);
  state.participantIds = detail.participants.map((p: Json) => p.id);
  const below = await patch({ peopleCount: 2 });
  expect(below.status()).toBe(422);
  expect((await errorOf(below)).code).toBe('PEOPLE_BELOW_PARTICIPANTS');
  expect((await myBooking(player, state.bookingId)).peopleCount).toBe(4);

  // Mandar o valor atual não muda nada.
  expect((await patch({ peopleCount: 4 })).status()).toBe(200);
  // 3 (organizador + 2 convidados) é o mínimo possível.
  expect((await patch({ peopleCount: 3 })).status()).toBe(200);
});

test('RN-BOOK-12 / RN-BOOK-01 / RN-BOOK-09: muda horário e duração — preço e partes recalculados, ocupação movida', async ({
  playwright,
}) => {
  const player = await apiAs(playwright, USERS.player);
  const patch = (data: object) => player.patch(mine(state.bookingId), { data });

  // A disponibilidade devolve o próprio horário como livre quando se informa a reserva em edição.
  const availability = (exclude?: boolean) =>
    player
      .get(`/v1/spaces/${state.spaceId}/availability`, {
        params: {
          date: DAY,
          durationMin: 60,
          sportId: state.sportId,
          courtId: state.courtA,
          ...(exclude ? { excludeBookingId: state.bookingId } : {}),
        },
      })
      .then(body);
  const slot = (day: Json, time: string) =>
    day.courts[0].slots.find((s: Json) => s.startsAt === at(time));
  expect(slot(await availability(), '17:30')?.available).toBe(false);
  expect(slot(await availability(true), '17:30')?.available).toBe(true);

  // Anda 30 minutos para a frente (sobrepõe o próprio horário antigo: não conflita consigo).
  const moved = await patch({ startsAt: at('17:30') });
  expect(moved.status(), JSON.stringify(await moved.json())).toBe(200);
  expect(await body(moved)).toMatchObject({ startsAt: at('17:30'), durationMin: 60 });

  // 1h30: preço proporcional (RN-BOOK-01), e as partes dividem o novo total (RN-BOOK-09).
  const longer = await patch({ durationMin: 90 });
  expect(longer.status()).toBe(200);
  const detail = await body(longer);
  expect(detail.priceCents).toBe(15_000);
  const shares = detail.participants.map((p: Json) => p.shareCents as number);
  expect(shares.reduce((sum: number, share: number) => sum + share, 0)).toBe(15_000);
  expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);

  // Encurtar para 1h libera de novo o fim (30 min) para outra reserva.
  const shorter = await patch({ durationMin: 60 });
  expect(shorter.status()).toBe(200);
  expect((await body(shorter)).priceCents).toBe(10_000);

  // O espaço enxerga a reserva no novo horário, na agenda do painel.
  const owner = await apiAs(playwright, USERS.owner);
  const list = await body(
    await owner.get(`/v1/manage/spaces/${state.spaceId}/bookings`, {
      params: { from: at('00:00'), to: at('23:30') },
    }),
  );
  const found = list.items.find((b: Json) => b.id === state.bookingId);
  expect(found, 'reserva na lista da gestão').toBeTruthy();
  expect(found.startsAt).toBe(at('17:30'));
  expect(found.endsAt).toBe(at('18:30'));
});

test('RN-BOOK-03 / RN-BOOK-12: editar para cima de outra reserva é recusado (SLOT_UNAVAILABLE) e nada muda', async ({
  playwright,
}) => {
  const other = await apiAs(playwright, USERS.player2);
  const created = await other.post('/v1/bookings', {
    data: {
      spaceId: state.spaceId,
      courtId: state.courtA,
      sportId: state.sportId,
      startsAt: at('19:00'),
      durationMin: 60,
      peopleCount: 2,
    },
  });
  expect(created.status()).toBe(201);
  state.otherBookingId = (await body(created)).id;

  const player = await apiAs(playwright, USERS.player);
  // 18:30–20:00 invade a reserva das 19:00.
  const clash = await player.patch(mine(state.bookingId), {
    data: { startsAt: at('18:30'), durationMin: 90 },
  });
  expect(clash.status()).toBe(409);
  expect((await errorOf(clash)).code).toBe('SLOT_UNAVAILABLE');
  expect(await myBooking(player, state.bookingId)).toMatchObject({
    startsAt: at('17:30'),
    durationMin: 60,
    priceCents: 10_000,
  });

  // Encostar (18:30–19:00 é o fim da minha; a outra começa às 19:00) é permitido.
  const touching = await player.patch(mine(state.bookingId), {
    data: { startsAt: at('18:00'), durationMin: 60 },
  });
  expect(touching.status()).toBe(200);
  expect((await body(touching)).endsAt).toBe(at('19:00'));
});

test('RN-BOOK-02 / RN-BOOK-06: horário fora do passo de 30 min, no passado ou fora da janela é recusado', async ({
  playwright,
}) => {
  const player = await apiAs(playwright, USERS.player);
  const patch = async (data: object) => {
    const res = await player.patch(mine(state.bookingId), { data });
    return { status: res.status(), code: (await errorOf(res)).code as string };
  };
  expect(await patch({ startsAt: saoPauloInstant(DAY, '17:15').toISOString() })).toEqual({
    status: 422,
    code: 'MISALIGNED_START',
  });
  expect(await patch({ startsAt: saoPauloInstant(localDate(-1), '10:00').toISOString() })).toEqual({
    status: 422,
    code: 'BOOKING_IN_THE_PAST',
  });
  expect(await patch({ startsAt: saoPauloInstant(localDate(60), '10:00').toISOString() })).toEqual({
    status: 422,
    code: 'BOOKING_BEYOND_WINDOW',
  });
  // Duração fora do máximo do espaço (180 min).
  expect(await patch({ durationMin: 240 })).toEqual({ status: 422, code: 'DURATION_OUT_OF_RANGE' });
  // Corpo vazio não é edição.
  expect((await player.patch(mine(state.bookingId), { data: {} })).status()).toBe(400);
});

test('RN-BOOK-10: só o organizador edita — outro jogador não enxerga nem altera a reserva', async ({
  playwright,
}) => {
  const outsider = await apiAs(playwright, USERS.player2);
  const res = await outsider.patch(mine(state.bookingId), { data: { peopleCount: 1 } });
  expect(res.status()).toBe(404);
  expect((await errorOf(res)).code).toBe('BOOKING_NOT_FOUND');
});

test('decisão 50: o recebimento é só da reserva inteira — por participante é recusado', async ({
  playwright,
}) => {
  const owner = await apiAs(playwright, USERS.owner);
  const payments = `/v1/manage/spaces/${state.spaceId}/payments`;
  const pay = (data: object) => owner.post(payments, { data });

  // Pagamento por participante: recusado, sem registrar nada.
  const byPart = await pay({
    payableType: 'BOOKING_PARTICIPANT',
    payableId: state.participantIds[1],
    amountCents: 1_000,
    method: 'PIX',
  });
  expect(byPart.status()).toBe(422);
  expect((await errorOf(byPart)).code).toBe('PARTICIPANT_PAYMENT_NOT_ALLOWED');

  const detail = () =>
    owner.get(`/v1/manage/spaces/${state.spaceId}/bookings/${state.bookingId}`).then(body);
  expect((await detail()).payments).toHaveLength(0);
  expect((await detail()).paymentStatus).toBe('PENDING');

  // A parte de cada um é só informação: nem o jogador nem a gestão têm campo de pagamento por pessoa.
  const player = await apiAs(playwright, USERS.player);
  const seen = await myBooking(player, state.bookingId);
  for (const participant of [...seen.participants, ...(await detail()).participants]) {
    expect(Object.keys(participant)).not.toContain('paidCents');
    expect(Object.keys(participant)).not.toContain('paymentStatus');
  }
  expect(seen.myShare.shareCents).toBeGreaterThan(0);

  // Acima do que falta pagar: recusado.
  const over = await pay({
    payableType: 'BOOKING',
    payableId: state.bookingId,
    amountCents: 10_001,
    method: 'PIX',
  });
  expect(over.status()).toBe(422);
  expect((await errorOf(over)).code).toBe('PAYMENT_EXCEEDS_DUE');
});

test('RF-PAY-01 / decisão 50: na tela, a gestão registra o valor da reserva (parcial e o resto) e há um único "Registrar pagamento"', async ({
  page,
  playwright,
}) => {
  await login(page, USERS.owner);
  await page.goto(`/painel/agenda?data=${DAY}`);
  await expect(page.getByTestId('agenda-grid')).toBeVisible();
  await page.getByTestId('agenda-booking').filter({ hasText: 'Jogador E2E' }).first().click();
  const detail = page.getByTestId('booking-detail');
  await expect(detail).toBeVisible();
  // As partes são informação; o recebimento é um só.
  await expect(detail.getByText('A divisão é só informação para os jogadores')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Registrar pagamento' })).toHaveCount(1);

  await recordPayment(page, '30,00');
  await expect(page.getByText(/Pagamento registrado/)).toBeVisible();
  await expect(detail.getByRole('list', { name: 'Pagamentos registrados' })).toContainText(
    /R\$\s*30,00/,
  );

  await recordPayment(page, '70,00');
  const owner = await apiAs(playwright, USERS.owner);
  const after = await body(
    await owner.get(`/v1/manage/spaces/${state.spaceId}/bookings/${state.bookingId}`),
  );
  expect(after.paidCents).toBe(10_000);
  expect(after.paymentStatus).toBe('PAID');
  expect(after.payments.map((p: Json) => p.payableType)).toEqual(['BOOKING', 'BOOKING']);
});

async function recordPayment(page: Page, amount: string) {
  await page.getByRole('button', { name: 'Registrar pagamento' }).click();
  const dialog = page.getByRole('dialog', { name: 'Registrar pagamento' });
  await expect(dialog).toContainText('Reserva de Jogador E2E');
  await dialog.getByLabel('Valor recebido').fill(amount);
  await dialog
    .getByRole('button', { name: /Registrar|Salvar|Confirmar/ })
    .last()
    .click();
  await expect(dialog).toBeHidden();
}

test('RN-BOOK-13: com pagamento registrado, data/horário/duração ficam com o espaço; o número de pessoas ainda edita', async ({
  playwright,
}) => {
  const player = await apiAs(playwright, USERS.player);
  const detail = await myBooking(player, state.bookingId);
  expect(detail.canEditSchedule).toBe(false);
  expect(detail.scheduleEditBlock.code).toBe('BOOKING_HAS_PAYMENT');
  expect(detail.scheduleEditBlock.message.toLowerCase()).toContain('espaço');
  expect(detail.canEditPeople).toBe(true);

  const move = await player.patch(mine(state.bookingId), { data: { startsAt: at('16:00') } });
  expect(move.status()).toBe(422);
  expect((await errorOf(move)).code).toBe('BOOKING_HAS_PAYMENT');
  expect((await myBooking(player, state.bookingId)).startsAt).toBe(at('18:00'));

  const people = await player.patch(mine(state.bookingId), { data: { peopleCount: 4 } });
  expect(people.status()).toBe(200);
});
