import type { Client, ElicitRequestFormParams } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COURT_2, FRIEND_BOOKING, MY_BOOKING, NOW, OTHER_USER } from './support/fixtures.js';
import { callTool, type Harness, startHarness } from './support/harness.js';

let h: Harness;
let client: Client;

beforeAll(async () => {
  h = await startHarness();
  client = await h.connect(await h.token());
});
afterAll(async () => {
  await h.stop();
});
beforeEach(() => {
  h.api.reset();
  h.clock.now = NOW;
});

const request = {
  space: 'Arena Sul',
  date: '2026-11-13',
  startTime: '18:00',
  durationMin: 60,
  peopleCount: 4,
  sport: 'beach-tennis',
};

async function prepare(c: Client = client, input: Record<string, unknown> = {}) {
  const prepared = await callTool(c, 'prepare_booking', { ...request, ...input });
  expect(prepared.isError, prepared.text).toBe(false);
  return prepared.data.confirmation.createBookingInput as Record<string, unknown> & {
    confirmationCode: string;
  };
}

describe('prepare_booking', () => {
  it('monta o resumo com o preço da API e o código, sem gravar nada', async () => {
    const { data, text } = await callTool(client, 'prepare_booking', request);
    expect(data.summary).toMatchObject({
      space: { slug: 'arena-sul', name: 'Arena Sul' },
      court: { name: 'Quadra 1' },
      sport: { slug: 'beach-tennis' },
      date: '2026-11-13',
      startTime: '18:00',
      endTime: '19:00',
      peopleCount: 4,
      price: { cents: 12000, formatted: 'R$ 120,00' },
      payment: { option: 'ON_SITE', label: 'pagar no espaço' },
      cancellationDeadline: { date: '2026-11-13', time: '16:00' },
      otherFreeCourts: [{ id: COURT_2, name: 'Quadra 2' }],
    });
    expect(data.confirmation.expiresAt).toEqual({ date: '2026-11-12', time: '10:10' });
    expect(data.confirmation.createBookingInput).toMatchObject({
      spaceId: '5a000000-0000-4000-8000-000000000001',
      paymentOption: 'ON_SITE',
      confirmationCode: expect.stringMatching(/^v1\./),
    });
    expect(text).toContain('peça a confirmação do usuário');
    expect(h.api.callsTo('POST', /.*/)).toHaveLength(0);
  });

  it('horário ocupado: SLOT_UNAVAILABLE com os horários livres mais próximos', async () => {
    const { data } = await callTool(client, 'prepare_booking', { ...request, startTime: '20:00' });
    expect(data.error.code).toBe('SLOT_UNAVAILABLE');
    expect(data.error.nearbyFreeStartTimes).toEqual(['18:00', '19:00']);
  });

  it('quadra escolhida pelo nome', async () => {
    const { data } = await callTool(client, 'prepare_booking', {
      ...request,
      startTime: '19:00',
      court: 'quadra 2',
    });
    expect(data.summary.court.id).toBe(COURT_2);
  });

  it('mais pessoas que a capacidade da quadra', async () => {
    const { data } = await callTool(client, 'prepare_booking', { ...request, peopleCount: 6 });
    expect(data.error).toMatchObject({ code: 'PEOPLE_EXCEED_CAPACITY', maxPlayers: 4 });
  });

  it('espaço que só aceita cartão: explica e manda o link do app, sem código', async () => {
    const { isError, data } = await callTool(client, 'prepare_booking', {
      ...request,
      space: 'arena-so-cartao',
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe('CARD_ONLY');
    expect(data.error.link).toBe('https://app.example.com/espacos/arena-so-cartao');
    expect(data.error.message).toContain('cartão nunca passa pela conversa');
    expect(JSON.stringify(data)).not.toContain('confirmationCode');
  });

  it('forma de pagamento que o espaço não aceita', async () => {
    const { data } = await callTool(client, 'prepare_booking', {
      ...request,
      space: 'arena-oeste',
      paymentOption: 'ONLINE_PIX',
    });
    expect(data.error).toMatchObject({ code: 'PAYMENT_OPTION_UNAVAILABLE', options: ['ON_SITE'] });
  });

  it('cartão nunca é aceito como forma de pagamento', async () => {
    const { isError } = await callTool(client, 'prepare_booking', {
      ...request,
      paymentOption: 'ONLINE_CARD',
    });
    expect(isError).toBe(true);
    expect(h.api.calls).toHaveLength(0);
  });
});

describe('create_booking', () => {
  it('grava com o código, com Idempotency-Key derivada dele, e devolve a reserva', async () => {
    const input = await prepare();
    const { isError, data } = await callTool(client, 'create_booking', input);
    expect(isError).toBe(false);
    expect(data.booking).toMatchObject({
      status: 'CONFIRMED',
      date: '2026-11-13',
      startTime: '18:00',
      peopleCount: 4,
    });
    const [post] = h.api.callsTo('POST', /^\/v1\/bookings$/);
    expect(post?.idempotencyKey).toMatch(/^mcp-[0-9a-f]{64}$/);
    expect(post?.body).toEqual({
      spaceId: '5a000000-0000-4000-8000-000000000001',
      courtId: input.courtId,
      sportId: input.sportId,
      startsAt: '2026-11-13T21:00:00.000Z',
      durationMin: 60,
      peopleCount: 4,
      paymentOption: 'ON_SITE',
    });
  });

  it('é idempotente: repetir com o mesmo código devolve a mesma reserva', async () => {
    const input = await prepare();
    const first = await callTool(client, 'create_booking', input);
    const second = await callTool(client, 'create_booking', input);
    expect(second.data.booking.id).toBe(first.data.booking.id);
    const posts = h.api.callsTo('POST', /^\/v1\/bookings$/);
    expect(posts).toHaveLength(2);
    expect(posts[0]?.idempotencyKey).toBe(posts[1]?.idempotencyKey);
    expect(h.api.bookings.size).toBe(3);
  });

  it('Pix online: devolve o copia e cola e o prazo', async () => {
    const input = await prepare(client, { paymentOption: 'ONLINE_PIX' });
    const { data, text } = await callTool(client, 'create_booking', input);
    expect(data.booking.payment.pix).toEqual({
      copyPaste: '00020126PIXCOPIAECOLA',
      amount: { cents: 12000, formatted: 'R$ 120,00' },
      expiresAt: { date: '2026-11-12', time: '10:15' },
    });
    expect(text).toContain('Pix copia e cola até 2026-11-12 10:15');
    expect(h.api.callsTo('POST', /^\/v1\/bookings$/)[0]?.body).toMatchObject({
      paymentOption: 'ONLINE_PIX',
    });
  });

  describe('recusa o código sem chamar a API', () => {
    const expectRejected = async (args: Record<string, unknown>, code: string, c = client) => {
      h.api.calls.length = 0;
      const { isError, data } = await callTool(c, 'create_booking', args);
      expect(isError).toBe(true);
      expect(data.error.code).toBe(code);
      expect(data.error.message).toContain('Nada foi gravado');
      expect(h.api.calls).toHaveLength(0);
    };

    it('ausente', async () => {
      const input = await prepare();
      h.api.calls.length = 0;
      const { isError } = await callTool(client, 'create_booking', {
        ...input,
        confirmationCode: undefined,
      });
      expect(isError).toBe(true);
      expect(h.api.calls).toHaveLength(0);
    });

    it('vencido (mais de 10 minutos)', async () => {
      const input = await prepare();
      h.clock.now = new Date(NOW.getTime() + 10 * 60_000 + 1);
      await expectRejected(input, 'CONFIRMATION_EXPIRED');
    });

    it('adulterado', async () => {
      const input = await prepare();
      const [version, payload, signature] = input.confirmationCode.split('.');
      const tampered = `${version}.${payload}.${signature?.startsWith('A') ? 'B' : 'A'}${signature?.slice(1)}`;
      await expectRejected({ ...input, confirmationCode: tampered }, 'CONFIRMATION_INVALID');
      await expectRejected(
        { ...input, confirmationCode: 'qualquer-coisa' },
        'CONFIRMATION_INVALID',
      );
    });

    it('com a carga trocada (mesma assinatura)', async () => {
      const input = await prepare();
      const [version, payload, signature] = input.confirmationCode.split('.');
      const decoded = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString());
      decoded.e += 60 * 60_000;
      const forged = `${version}.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;
      await expectRejected({ ...input, confirmationCode: forged }, 'CONFIRMATION_INVALID');
    });

    it('de outro usuário', async () => {
      const input = await prepare();
      const other = await h.connect(await h.token({ sub: OTHER_USER }));
      await expectRejected(input, 'CONFIRMATION_INVALID', other);
    });

    it.each([
      ['peopleCount', 3],
      ['startTime', '19:00'],
      ['courtId', COURT_2],
      ['paymentOption', 'ONLINE_PIX'],
      ['date', '2026-11-14'],
    ])('com outro parâmetro (%s)', async (field, value) => {
      const input = await prepare();
      await expectRejected({ ...input, [field]: value }, 'CONFIRMATION_MISMATCH');
    });

    it('de um cancelamento usado para criar', async () => {
      const prepared = await callTool(client, 'prepare_cancel_booking', { bookingId: MY_BOOKING });
      const input = await prepare();
      await expectRejected(
        {
          ...input,
          confirmationCode: prepared.data.confirmation.cancelBookingInput.confirmationCode,
        },
        'CONFIRMATION_INVALID',
      );
    });
  });

  it('preço mudou desde o resumo: nada é gravado e pede novo prepare_booking', async () => {
    const input = await prepare();
    h.api.pricePerHourCents = 15000;
    const { data } = await callTool(client, 'create_booking', input);
    expect(data.error.code).toBe('PRICE_CHANGED');
    expect(data.error.message).toContain('prepare_booking');
    expect(h.api.callsTo('POST', /^\/v1\/bookings$/)).toHaveLength(0);
  });

  it('horário ocupado na gravação (409 da API): explica e pede outro horário', async () => {
    const input = await prepare();
    h.api.fail(
      'POST',
      /^\/v1\/bookings$/,
      409,
      'SLOT_UNAVAILABLE',
      'Este horário acabou de ser ocupado.',
    );
    const { data } = await callTool(client, 'create_booking', input);
    expect(data.error.code).toBe('SLOT_UNAVAILABLE');
    expect(data.error.message).toContain('Nada foi reservado');
  });

  it('erro inesperado da API na gravação', async () => {
    const input = await prepare();
    h.api.fail('POST', /^\/v1\/bookings$/, 502, 'HTTP_ERROR', 'Bad Gateway');
    const { data } = await callTool(client, 'create_booking', input);
    expect(data.error.code).toBe('API_UNAVAILABLE');
  });
});

describe('elicitation (protocolo 2026-07-28)', () => {
  const asked: ElicitRequestFormParams[] = [];

  it('cliente aceita: o servidor pergunta ao usuário e grava', async () => {
    asked.length = 0;
    const modern = await h.connect(await h.token(), {
      era: 'modern',
      elicit: (params) => {
        asked.push(params);
        return { action: 'accept', content: { confirm: true } };
      },
    });
    const input = await prepare(modern);
    const { isError, data } = await callTool(modern, 'create_booking', input);
    expect(isError).toBe(false);
    expect(data.booking.status).toBe('CONFIRMED');
    expect(asked).toHaveLength(1);
    expect(asked[0]?.message).toContain('Confirmar a reserva? Arena Sul, Quadra 1, Beach Tennis');
    expect(h.api.callsTo('POST', /^\/v1\/bookings$/)).toHaveLength(1);
  });

  it('cliente recusa: nada é gravado', async () => {
    const modern = await h.connect(await h.token(), {
      era: 'modern',
      elicit: () => ({ action: 'decline' }),
    });
    const input = await prepare(modern);
    const { isError, data } = await callTool(modern, 'create_booking', input);
    expect(isError).toBe(false);
    expect(data.status).toBe('NOT_CONFIRMED');
    expect(h.api.callsTo('POST', /^\/v1\/bookings$/)).toHaveLength(0);
  });

  it('aceite sem marcar a confirmação conta como recusa', async () => {
    const modern = await h.connect(await h.token(), {
      era: 'modern',
      elicit: () => ({ action: 'accept', content: { confirm: false } }),
    });
    const input = await prepare(modern);
    const { data } = await callTool(modern, 'create_booking', input);
    expect(data.status).toBe('NOT_CONFIRMED');
    expect(h.api.callsTo('POST', /^\/v1\/bookings$/)).toHaveLength(0);
  });

  it('cancelamento também pede a confirmação; recusa não cancela', async () => {
    const modern = await h.connect(await h.token(), {
      era: 'modern',
      elicit: () => ({ action: 'cancel' }),
    });
    const prepared = await callTool(modern, 'prepare_cancel_booking', { bookingId: MY_BOOKING });
    const { data } = await callTool(
      modern,
      'cancel_booking',
      prepared.data.confirmation.cancelBookingInput,
    );
    expect(data.status).toBe('NOT_CONFIRMED');
    expect(h.api.callsTo('POST', /cancel$/)).toHaveLength(0);
  });

  describe('a resposta só vale presa à pergunta (requestState assinado)', () => {
    type Body = { params?: Record<string, unknown> };
    const onRetry = (change: (params: Record<string, unknown>) => void) => (body: Body) => {
      if (body.params && 'inputResponses' in body.params) change(body.params);
      return body;
    };

    /** Reserva com um cliente que sempre aceita, mas cujos retornos passam por `rewrite`. */
    async function attempt(
      rewrite: (body: Body) => unknown,
      overrides: Record<string, unknown> = {},
    ) {
      let asked = 0;
      const tampered = await h.connect(await h.token(), {
        era: 'modern',
        maxRounds: 3,
        elicit: () => {
          asked += 1;
          return { action: 'accept', content: { confirm: true } };
        },
        rewrite,
      });
      const input = await prepare(tampered, overrides);
      const failed = await tampered.callTool({ name: 'create_booking', arguments: input }).then(
        (result) => result.isError === true,
        () => true,
      );
      return { asked, failed };
    }

    it('aceite sem requestState é ignorado: pergunta de novo e não grava', async () => {
      const { asked, failed } = await attempt(onRetry((params) => delete params.requestState));
      expect(failed).toBe(true);
      expect(asked).toBeGreaterThan(1);
      expect(h.api.callsTo('POST', /^\/v1\/bookings$/)).toHaveLength(0);
    });

    it('requestState adulterado é ignorado', async () => {
      const { asked } = await attempt(
        onRetry((params) => {
          const state = String(params.requestState);
          params.requestState = `${state.slice(0, -2)}${state.endsWith('AA') ? 'BB' : 'AA'}`;
        }),
      );
      expect(asked).toBeGreaterThan(1);
      expect(h.api.callsTo('POST', /^\/v1\/bookings$/)).toHaveLength(0);
    });

    it('aceite de outra reserva (requestState de outro código) não vale para esta', async () => {
      let captured: unknown;
      const first = await attempt(
        onRetry((params) => {
          captured ??= params.requestState;
        }),
      );
      expect(first.failed).toBe(false);
      expect(h.api.callsTo('POST', /^\/v1\/bookings$/)).toHaveLength(1);

      // Outra reserva (outro horário e outra quadra), logo outro código.
      const { asked } = await attempt(
        onRetry((params) => {
          params.requestState = captured;
        }),
        { startTime: '19:00', court: 'Quadra 2' },
      );
      expect(asked).toBeGreaterThan(1);
      expect(h.api.callsTo('POST', /^\/v1\/bookings$/)).toHaveLength(1);
    });

    it('aceite de outro usuário não vale', async () => {
      let captured: unknown;
      const other = await h.connect(await h.token({ sub: OTHER_USER }), {
        era: 'modern',
        elicit: () => ({ action: 'decline' }),
        rewrite: onRetry((params) => {
          captured ??= params.requestState;
        }),
      });
      await callTool(other, 'create_booking', await prepare(other));
      expect(captured).toBeTypeOf('string');

      const { asked } = await attempt(
        onRetry((params) => {
          params.requestState = captured;
        }),
      );
      expect(asked).toBeGreaterThan(1);
      expect(h.api.callsTo('POST', /^\/v1\/bookings$/)).toHaveLength(0);
    });
  });

  it('cliente 2025 (sem canal de volta no modo sem estado): segue só com o código', async () => {
    let calls = 0;
    const legacy = await h.connect(await h.token(), {
      era: 'legacy',
      elicit: () => {
        calls += 1;
        return { action: 'decline' };
      },
    });
    const input = await prepare(legacy);
    const { isError } = await callTool(legacy, 'create_booking', input);
    expect(isError).toBe(false);
    expect(calls).toBe(0);
    expect(h.api.callsTo('POST', /^\/v1\/bookings$/)).toHaveLength(1);
  });
});

describe('cancelamento em duas etapas', () => {
  it('prepare_cancel_booking explica o efeito e devolve o código, sem cancelar', async () => {
    const { data } = await callTool(client, 'prepare_cancel_booking', {
      bookingId: MY_BOOKING,
      reason: 'Chuva',
    });
    expect(data.summary.paymentEffect).toBe('Nada foi pago; não há estorno.');
    expect(data.summary.cancellableUntil).toEqual({ date: '2026-11-13', time: '16:00' });
    expect(data.confirmation.cancelBookingInput).toMatchObject({
      bookingId: MY_BOOKING,
      reason: 'Chuva',
    });
    expect(h.api.callsTo('POST', /cancel$/)).toHaveLength(0);
  });

  it('cancel_booking cancela com o código', async () => {
    const prepared = await callTool(client, 'prepare_cancel_booking', {
      bookingId: MY_BOOKING,
      reason: 'Chuva',
    });
    const { data } = await callTool(
      client,
      'cancel_booking',
      prepared.data.confirmation.cancelBookingInput,
    );
    expect(data.booking.status).toBe('CANCELLED');
    expect(h.api.callsTo('POST', /cancel$/)[0]?.body).toEqual({ reason: 'Chuva' });
  });

  it('repetir o cancelamento devolve a reserva já cancelada', async () => {
    const prepared = await callTool(client, 'prepare_cancel_booking', { bookingId: MY_BOOKING });
    const input = prepared.data.confirmation.cancelBookingInput;
    await callTool(client, 'cancel_booking', input);
    const again = await callTool(client, 'cancel_booking', input);
    expect(again.isError).toBe(false);
    expect(again.text).toContain('já estava cancelada');
  });

  it('código de outra reserva ou outro motivo é recusado sem chamar a API', async () => {
    const prepared = await callTool(client, 'prepare_cancel_booking', { bookingId: MY_BOOKING });
    const input = prepared.data.confirmation.cancelBookingInput;
    h.api.calls.length = 0;
    const other = await callTool(client, 'cancel_booking', { ...input, bookingId: FRIEND_BOOKING });
    expect(other.data.error.code).toBe('CONFIRMATION_MISMATCH');
    const reason = await callTool(client, 'cancel_booking', { ...input, reason: 'Outro' });
    expect(reason.data.error.code).toBe('CONFIRMATION_MISMATCH');
    expect(h.api.calls).toHaveLength(0);
  });

  it('código vencido é recusado', async () => {
    const prepared = await callTool(client, 'prepare_cancel_booking', { bookingId: MY_BOOKING });
    h.clock.now = new Date(NOW.getTime() + 11 * 60_000);
    h.api.calls.length = 0;
    const { data } = await callTool(
      client,
      'cancel_booking',
      prepared.data.confirmation.cancelBookingInput,
    );
    expect(data.error.code).toBe('CONFIRMATION_EXPIRED');
    expect(h.api.calls).toHaveLength(0);
  });

  it('fora do prazo: explica que é preciso falar com o espaço, sem código', async () => {
    h.clock.now = new Date('2026-11-13T19:30:00Z');
    const { data } = await callTool(client, 'prepare_cancel_booking', { bookingId: MY_BOOKING });
    expect(data.error.code).toBe('CANCELLATION_DEADLINE_PASSED');
    expect(data.error.message).toContain('falar com o espaço');
  });

  it('só o organizador cancela', async () => {
    const { data } = await callTool(client, 'prepare_cancel_booking', {
      bookingId: FRIEND_BOOKING,
    });
    expect(data.error.code).toBe('NOT_BOOKING_ORGANIZER');
  });

  it('prazo da API mudou na gravação (422): repassa a mensagem', async () => {
    const prepared = await callTool(client, 'prepare_cancel_booking', { bookingId: MY_BOOKING });
    h.api.fail(
      'POST',
      /cancel$/,
      422,
      'CANCELLATION_DEADLINE_PASSED',
      'O prazo para cancelar pelo app terminou. Fale com o espaço.',
    );
    const { data } = await callTool(
      client,
      'cancel_booking',
      prepared.data.confirmation.cancelBookingInput,
    );
    expect(data.error.code).toBe('CANCELLATION_DEADLINE_PASSED');
    expect(data.error.message).toContain('Fale com o espaço');
  });
});
