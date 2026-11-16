import { isApiError } from '@space-sports/api-client/dist/fetch.js';
import { z } from 'zod';
import { money } from '../../shared/money.js';
import { fromLocal, localDateSchema, localTimeSchema, toLocal } from '../../shared/time.js';
import { confirmWithUser } from '../confirm-with-user.js';
import { idempotencyKeyFor } from '../confirmation.js';
import { PAYMENT_OPTION } from '../labels.js';
import { courtRefSchema, resolveCourt, resolveSport, sportRefSchema } from '../space-helpers.js';
import { resolveSpace, spaceRefSchema } from '../space-resolver.js';
import { defineTool, done } from '../tool.js';
import { ToolError } from '../tool-error.js';
import { bookingView, rentalPaymentOptions, spaceLink } from '../views.js';

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const bookingIdSchema = z.uuid('Use o id da reserva (uuid) de list_my_bookings.');
const durationSchema = z
  .number()
  .int()
  .min(30)
  .max(720)
  .multipleOf(30)
  .describe('Duração em minutos, múltiplo de 30.');
const startTimeSchema = localTimeSchema
  .regex(/:(00|30)$/, 'O horário começa em hora cheia ou meia hora (HH:00 ou HH:30).')
  .describe('Hora de início (HH:mm, America/Sao_Paulo), em hora cheia ou meia hora.');
const peopleSchema = z
  .number()
  .int()
  .min(1)
  .max(50)
  .describe('Quantas pessoas vão jogar (inclui o usuário). Pergunte se não souber.');
/** Cartão nunca pelo chat (decisão 115). */
const paymentOptionSchema = z
  .enum(['ON_SITE', 'ONLINE_PIX'])
  .describe('ON_SITE = pagar no espaço; ONLINE_PIX = Pix online (o copia e cola vem na resposta).');
const codeSchema = z
  .string()
  .min(1)
  .max(4000)
  .describe('O código de confirmação devolvido pela tool prepare_* (vale 10 minutos).');

const listMyBookings = defineTool({
  name: 'list_my_bookings',
  title: 'Minhas reservas',
  scopes: ['bookings:read'],
  description: [
    'Lista as reservas de quadra do usuário: as próximas (padrão) ou as passadas.',
    'Devolve id, espaço, quadra, esporte, data e horário (America/Sao_Paulo), status, preço (centavos e BRL), se o usuário é o organizador, o pagamento e até quando dá para cancelar.',
    'Para os detalhes de uma reserva, use get_booking.',
  ].join(' '),
  inputSchema: z.object({
    when: z
      .enum(['upcoming', 'past'])
      .default('upcoming')
      .describe('upcoming = próximas (padrão); past = passadas.'),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().max(500).optional().describe('nextCursor da página anterior.'),
  }),
  annotations: READ_ONLY,
  async run(input, { api, user, now }) {
    const page = await api.listBookings({
      when: input.when,
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    const bookings = page.items.map((item) => bookingView(item, user.sub, now()));
    const which = input.when === 'past' ? 'passada(s)' : 'próxima(s)';
    return done(
      bookings.length
        ? `${bookings.length} reserva(s) ${which}.`
        : `O usuário não tem reservas ${input.when === 'past' ? 'passadas' : 'próximas'}.`,
      { bookings, nextCursor: page.nextCursor },
    );
  },
});

const getBooking = defineTool({
  name: 'get_booking',
  title: 'Detalhes da reserva',
  scopes: ['bookings:read'],
  description: [
    'Mostra uma reserva do usuário: espaço, quadra, esporte, data e horário, pessoas, preço, status, pagamento (com o Pix copia e cola se houver um em aberto, e quando o pagamento for confirmado), prazo de cancelamento e os participantes pelo primeiro nome.',
  ].join(' '),
  inputSchema: z.object({ bookingId: bookingIdSchema }),
  annotations: READ_ONLY,
  async run(input, { api, user, now }) {
    const booking = bookingView(await api.getBooking(input.bookingId), user.sub, now());
    return done(`Reserva ${booking.statusLabel} em ${booking.space.name}.`, { booking });
  },
});

const prepareBooking = defineTool({
  name: 'prepare_booking',
  title: 'Preparar reserva (resumo e código)',
  scopes: ['bookings:write', 'spaces:read'],
  description: [
    'Primeira etapa de uma reserva: confere o horário livre e as regras do espaço e devolve o resumo (espaço, quadra, esporte, data e horário, duração, pessoas, preço calculado pela API, forma de pagamento e prazo de cancelamento) e um código de confirmação válido por 10 minutos. NÃO grava nada.',
    'Depois, mostre o resumo ao usuário e pergunte se ele confirma. Só se ele confirmar explicitamente, chame create_booking com os parâmetros de confirmation.createBookingInput, sem alterar nada.',
    'Pagamento: ON_SITE (no espaço) ou ONLINE_PIX. Cartão nunca pelo chat: se o espaço só aceitar cartão, a tool explica e devolve o link para concluir no app.',
    'Sem quadra informada, escolhe a primeira quadra livre no horário (e lista as outras livres).',
  ].join(' '),
  inputSchema: z.object({
    space: spaceRefSchema,
    date: localDateSchema.describe('Data (YYYY-MM-DD, America/Sao_Paulo).'),
    startTime: startTimeSchema,
    durationMin: durationSchema,
    peopleCount: peopleSchema,
    sport: sportRefSchema
      .optional()
      .describe('Esporte (slug ou nome). Obrigatório se o espaço tiver mais de um.'),
    court: courtRefSchema.optional(),
    paymentOption: paymentOptionSchema
      .optional()
      .describe('Forma de pagamento. Padrão: no espaço, se o espaço aceitar; senão, Pix online.'),
  }),
  annotations: READ_ONLY,
  async run(input, { api, user, codes, webUrl }) {
    const space = await resolveSpace(api, input.space);
    const link = spaceLink(webUrl, space.slug);
    const payments = rentalPaymentOptions(space);
    if (payments.viaAssistant.length === 0) {
      throw new ToolError(
        'CARD_ONLY',
        `${space.name} só aceita reserva com pagamento por cartão, e dado de cartão nunca passa pela conversa. O usuário pode concluir a reserva no app ou no site: ${link}`,
        { link },
      );
    }
    const paymentOption =
      input.paymentOption ?? (payments.viaAssistant.includes('ON_SITE') ? 'ON_SITE' : 'ONLINE_PIX');
    if (!payments.viaAssistant.includes(paymentOption)) {
      throw new ToolError(
        'PAYMENT_OPTION_UNAVAILABLE',
        `${space.name} não aceita "${PAYMENT_OPTION[paymentOption]}" para reservas.`,
        { options: payments.viaAssistant },
      );
    }
    const sport = resolveSport(space, input.sport);
    const court = input.court ? resolveCourt(space, input.court, sport) : undefined;
    const availability = await api.getAvailability(space.id, {
      date: input.date,
      durationMin: input.durationMin,
      sportId: sport.sportId,
      ...(court ? { courtId: court.id } : {}),
    });
    const tz = availability.timeZone;
    const startsAt = fromLocal(input.date, input.startTime, tz);
    const isStart = (iso: string) => new Date(iso).getTime() === startsAt.getTime();
    const free = availability.courts.filter((item) =>
      item.slots.some((slot) => slot.available && isStart(slot.startsAt)),
    );
    const chosen = free[0];
    if (!chosen) {
      throw new ToolError(
        'SLOT_UNAVAILABLE',
        `O horário ${input.startTime} de ${input.date} não está livre${court ? ` na ${court.name}` : ''} para ${input.durationMin} min.`,
        { nearbyFreeStartTimes: nearbyTimes(availability.courts, startsAt, tz) },
      );
    }
    if (input.peopleCount > chosen.maxPlayers) {
      throw new ToolError(
        'PEOPLE_EXCEED_CAPACITY',
        `A ${chosen.name} comporta no máximo ${chosen.maxPlayers} pessoas para ${sport.name}.`,
        { maxPlayers: chosen.maxPlayers },
      );
    }

    const end = toLocal(new Date(startsAt.getTime() + input.durationMin * 60_000), tz);
    const deadline = toLocal(
      new Date(startsAt.getTime() - space.rental.cancellationDeadlineMin * 60_000),
      tz,
    );
    const price = money(availability.priceCents);
    const paymentNote =
      paymentOption === 'ON_SITE'
        ? 'Pagamento no espaço.'
        : space.onlinePayments.rental.mode === 'ONLINE_REQUIRED'
          ? 'Pix online: a resposta da reserva traz o Pix copia e cola e o prazo. A reserva só fica confirmada depois do pagamento; se o prazo vencer, ela é cancelada e o horário liberado.'
          : 'Pix online: a resposta da reserva traz o Pix copia e cola e o prazo para pagar.';
    const params = {
      spaceId: space.id,
      courtId: chosen.id,
      sportId: sport.sportId,
      date: input.date,
      startTime: input.startTime,
      durationMin: input.durationMin,
      peopleCount: input.peopleCount,
      paymentOption,
    };
    const text = `${space.name}, ${chosen.name}, ${sport.name}, ${input.date} das ${input.startTime} às ${end.time} (${input.durationMin} min), ${input.peopleCount} pessoa(s), ${price.formatted}, ${PAYMENT_OPTION[paymentOption]}.`;
    const issued = codes.issue('create_booking', user.sub, params, {
      priceCents: availability.priceCents,
      summary: text,
    });
    return done(
      `Resumo: ${text} Cancelamento grátis até ${deadline.date} ${deadline.time}. Mostre o resumo e peça a confirmação do usuário antes de chamar create_booking.`,
      {
        summary: {
          space: { id: space.id, slug: space.slug, name: space.name },
          court: { id: chosen.id, name: chosen.name, covered: chosen.covered },
          sport: { slug: sport.slug, name: sport.name },
          date: input.date,
          startTime: input.startTime,
          endTime: end.time,
          durationMin: input.durationMin,
          peopleCount: input.peopleCount,
          maxPlayers: chosen.maxPlayers,
          price,
          payment: {
            option: paymentOption,
            label: PAYMENT_OPTION[paymentOption],
            note: paymentNote,
          },
          cancellationDeadline: deadline,
          otherFreeCourts: free.slice(1).map((item) => ({ id: item.id, name: item.name })),
        },
        confirmation: {
          expiresAt: toLocal(issued.expiresAt, tz),
          createBookingInput: { ...params, confirmationCode: issued.code },
        },
        nextStep:
          'Mostre o resumo ao usuário. Só depois de ele confirmar, chame create_booking com confirmation.createBookingInput.',
      },
    );
  },
});

const createBookingTool = defineTool({
  name: 'create_booking',
  title: 'Criar reserva (confirmada)',
  scopes: ['bookings:write', 'spaces:read'],
  description: [
    'Segunda etapa: grava a reserva preparada por prepare_booking. Só chame depois de mostrar o resumo e de o usuário confirmar explicitamente.',
    'Use exatamente os parâmetros de confirmation.createBookingInput (com o confirmationCode). Código ausente, vencido (10 minutos), de outro usuário ou com qualquer parâmetro diferente é recusado sem gravar nada: chame prepare_booking de novo.',
    'Se o preço mudou ou o horário foi ocupado, nada é gravado e a resposta pede um novo prepare_booking. Repetir a chamada com o mesmo código devolve a mesma reserva (não duplica).',
    'Com ONLINE_PIX, a resposta traz o Pix copia e cola e o prazo para pagar: mostre-os ao usuário.',
  ].join(' '),
  inputSchema: z.object({
    spaceId: z.uuid(),
    courtId: z.uuid(),
    sportId: z.uuid(),
    date: localDateSchema,
    startTime: startTimeSchema,
    durationMin: durationSchema,
    peopleCount: peopleSchema,
    paymentOption: paymentOptionSchema,
    confirmationCode: codeSchema,
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async run(input, ctx) {
    const { api, user, codes, now } = ctx;
    const { confirmationCode, ...params } = input;
    // Antes de qualquer chamada à API (RN-MCP-02).
    const expected = codes.verify(confirmationCode, 'create_booking', user.sub, params);

    const availability = await api.getAvailability(params.spaceId, {
      date: params.date,
      durationMin: params.durationMin,
      sportId: params.sportId,
      courtId: params.courtId,
    });
    if (
      typeof expected.priceCents === 'number' &&
      availability.priceCents !== expected.priceCents
    ) {
      throw new ToolError(
        'PRICE_CHANGED',
        `O preço mudou de ${money(expected.priceCents).formatted} para ${money(availability.priceCents).formatted}. Nada foi gravado: chame prepare_booking de novo e mostre o novo resumo ao usuário.`,
      );
    }

    const asked = await confirmWithUser(ctx, {
      action: 'create_booking',
      code: confirmationCode,
      message:
        `Confirmar a reserva? ${typeof expected.summary === 'string' ? expected.summary : ''}`.trim(),
    });
    if (asked) return asked;

    const booking = await api.createBooking(
      {
        spaceId: params.spaceId,
        courtId: params.courtId,
        sportId: params.sportId,
        startsAt: fromLocal(params.date, params.startTime, availability.timeZone).toISOString(),
        durationMin: params.durationMin,
        peopleCount: params.peopleCount,
        paymentOption: params.paymentOption,
      },
      idempotencyKeyFor(confirmationCode),
    );
    const view = bookingView(booking, user.sub, now());
    const pix = view.payment?.pix;
    return done(
      pix
        ? `Reserva criada (${view.statusLabel}). Pague com o Pix copia e cola até ${pix.expiresAt.date} ${pix.expiresAt.time}.`
        : `Reserva criada (${view.statusLabel}).`,
      { booking: view },
    );
  },
});

const prepareCancelBooking = defineTool({
  name: 'prepare_cancel_booking',
  title: 'Preparar cancelamento (resumo e código)',
  scopes: ['bookings:write', 'bookings:read'],
  description: [
    'Primeira etapa de um cancelamento: confere se a reserva ainda pode ser cancelada pelo usuário (só o organizador, dentro do prazo do espaço) e o que acontece com o pagamento, e devolve o resumo e um código de confirmação válido por 10 minutos. NÃO cancela nada.',
    'Depois, mostre o resumo ao usuário e pergunte se ele confirma. Só se ele confirmar explicitamente, chame cancel_booking com os parâmetros de confirmation.cancelBookingInput.',
  ].join(' '),
  inputSchema: z.object({
    bookingId: bookingIdSchema,
    reason: z.string().trim().min(1).max(500).optional().describe('Motivo (opcional).'),
  }),
  annotations: READ_ONLY,
  async run(input, { api, user, codes, now, webUrl }) {
    const booking = await api.getBooking(input.bookingId);
    const view = bookingView(booking, user.sub, now());
    if (!view.youAreOrganizer) {
      throw new ToolError(
        'NOT_BOOKING_ORGANIZER',
        'Só quem organizou a reserva pode cancelá-la. O usuário pode avisar o organizador.',
      );
    }
    if (booking.status !== 'CONFIRMED' && booking.status !== 'PENDING_PAYMENT') {
      throw new ToolError(
        'INVALID_BOOKING_STATUS',
        `A reserva está ${view.statusLabel} e não pode ser cancelada.`,
      );
    }
    if (!view.canCancelNow) {
      const link = spaceLink(webUrl, booking.space.slug);
      throw new ToolError(
        'CANCELLATION_DEADLINE_PASSED',
        `O prazo para cancelar pelo app terminou em ${view.cancellableUntil.date} ${view.cancellableUntil.time}. O usuário precisa falar com o espaço (contato em ${link}).`,
        { link },
      );
    }
    const paidOnline =
      booking.onlinePayment &&
      (booking.onlinePayment.status === 'PAID' ||
        booking.onlinePayment.status === 'PARTIALLY_REFUNDED')
        ? booking.onlinePayment.amountCents - booking.onlinePayment.refundedCents
        : 0;
    const paymentEffect =
      booking.status === 'PENDING_PAYMENT'
        ? 'A reserva ainda não foi paga: o Pix em aberto é cancelado e o horário, liberado.'
        : paidOnline > 0
          ? `O valor pago online (${money(paidOnline).formatted}) é estornado integralmente, para o mesmo meio de pagamento.`
          : (booking.paidCents ?? 0) > 0
            ? 'O que foi pago no espaço é resolvido diretamente com o espaço.'
            : 'Nada foi pago; não há estorno.';
    const params = { bookingId: booking.id, reason: input.reason ?? null };
    const text = `Cancelar a reserva em ${view.space.name}, ${view.court.name}, ${view.date} às ${view.startTime}. ${paymentEffect}`;
    const issued = codes.issue('cancel_booking', user.sub, params, { summary: text });
    return done(`${text} Peça a confirmação do usuário antes de chamar cancel_booking.`, {
      summary: {
        booking: {
          id: view.id,
          space: view.space,
          court: view.court,
          sport: view.sport,
          date: view.date,
          startTime: view.startTime,
          endTime: view.endTime,
          price: view.price,
          status: view.status,
          statusLabel: view.statusLabel,
        },
        cancellableUntil: view.cancellableUntil,
        paymentEffect,
      },
      confirmation: {
        expiresAt: toLocal(issued.expiresAt, booking.space.timeZone),
        cancelBookingInput: { ...params, confirmationCode: issued.code },
      },
      nextStep:
        'Mostre o resumo ao usuário. Só depois de ele confirmar, chame cancel_booking com confirmation.cancelBookingInput.',
    });
  },
});

const cancelBookingTool = defineTool({
  name: 'cancel_booking',
  title: 'Cancelar reserva (confirmado)',
  scopes: ['bookings:write', 'bookings:read'],
  description: [
    'Segunda etapa: cancela a reserva preparada por prepare_cancel_booking. Só chame depois de mostrar o resumo e de o usuário confirmar explicitamente.',
    'Use exatamente os parâmetros de confirmation.cancelBookingInput (com o confirmationCode). Código ausente, vencido (10 minutos), de outro usuário ou com outro parâmetro é recusado sem cancelar nada.',
  ].join(' '),
  inputSchema: z.object({
    bookingId: bookingIdSchema,
    reason: z.string().trim().min(1).max(500).nullable().optional(),
    confirmationCode: codeSchema,
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async run(input, ctx) {
    const { api, user, codes, now } = ctx;
    const params = { bookingId: input.bookingId, reason: input.reason ?? null };
    const expected = codes.verify(input.confirmationCode, 'cancel_booking', user.sub, params);

    const asked = await confirmWithUser(ctx, {
      action: 'cancel_booking',
      code: input.confirmationCode,
      message:
        typeof expected.summary === 'string' ? expected.summary : 'Confirmar o cancelamento?',
    });
    if (asked) return asked;

    try {
      const booking = await api.cancelBooking(
        params.bookingId,
        params.reason ? { reason: params.reason } : {},
      );
      const view = bookingView(booking, user.sub, now());
      return done(`Reserva cancelada em ${view.space.name}.`, { booking: view });
    } catch (error) {
      // Repetição de um cancelamento que já aconteceu: devolve a reserva cancelada.
      if (isApiError(error) && error.code === 'INVALID_BOOKING_STATUS') {
        const current = await api.getBooking(params.bookingId);
        if (current.status === 'CANCELLED') {
          return done('A reserva já estava cancelada.', {
            booking: bookingView(current, user.sub, now()),
          });
        }
      }
      throw error;
    }
  },
});

/** Horários livres mais perto do pedido (até 6), para sugerir alternativas. */
function nearbyTimes(
  courts: { name: string; slots: { startsAt: string; available: boolean }[] }[],
  target: Date,
  tz: string,
): string[] {
  const starts = new Map<number, string>();
  for (const court of courts) {
    for (const slot of court.slots) {
      if (!slot.available) continue;
      const time = new Date(slot.startsAt).getTime();
      starts.set(time, toLocal(slot.startsAt, tz).time);
    }
  }
  return [...starts.entries()]
    .sort((a, b) => Math.abs(a[0] - target.getTime()) - Math.abs(b[0] - target.getTime()))
    .slice(0, 6)
    .sort((a, b) => a[0] - b[0])
    .map(([, time]) => time);
}

export const bookingTools = [
  listMyBookings,
  getBooking,
  prepareBooking,
  createBookingTool,
  prepareCancelBooking,
  cancelBookingTool,
];
