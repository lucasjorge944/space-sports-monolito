import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FRIEND_BOOKING, MY_BOOKING, SESSION, SPACES } from './support/fixtures.js';
import { callTool, type Harness, startHarness } from './support/harness.js';

let h: Harness;
let client: Client;
let bearer: string;

beforeAll(async () => {
  h = await startHarness();
  bearer = await h.token();
  client = await h.connect(bearer);
});
afterAll(async () => {
  await h.stop();
});
beforeEach(() => {
  h.api.reset();
});

describe('cliente da API', () => {
  it('repassa o MESMO Bearer do usuário e X-Client: mcp em cada chamada', async () => {
    await callTool(client, 'get_space', { space: 'arena-sul' });
    await callTool(client, 'list_my_bookings');
    expect(h.api.calls.length).toBeGreaterThan(1);
    for (const call of h.api.calls) {
      expect(call.authorization).toBe(`Bearer ${bearer}`);
      expect(call.xClient).toBe('mcp');
    }
  });

  it('erro 5xx da API vira mensagem em português sem detalhes internos', async () => {
    h.api.fail('GET', /^\/v1\/bookings$/, 500, 'INTERNAL_ERROR', 'stack: at Foo.bar (/app/x.ts:1)');
    const { isError, data, text } = await callTool(client, 'list_my_bookings');
    expect(isError).toBe(true);
    expect(data.error.code).toBe('API_UNAVAILABLE');
    expect(text).toContain('não respondeu');
    expect(text).not.toMatch(/stack|req-interno|x\.ts/);
  });

  it('token revogado na API (401) pede para reconectar', async () => {
    h.api.fail('GET', /^\/v1\/bookings$/, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
    const { data } = await callTool(client, 'list_my_bookings');
    expect(data.error.code).toBe('UNAUTHENTICATED');
    expect(data.error.message).toContain('reconectar');
  });

  it('rate limit da API (429) explica que é preciso esperar', async () => {
    h.api.fail('GET', /^\/v1\/spaces$/, 429, 'TOO_MANY_REQUESTS', 'Muitas requisições.');
    const { data } = await callTool(client, 'search_spaces', { text: 'Arena' });
    expect(data.error.code).toBe('TOO_MANY_REQUESTS');
    expect(data.error.message).toContain('Espere');
  });

  it('rota fora da lista permitida (403 OAUTH_ROUTE_NOT_ALLOWED) manda usar o app', async () => {
    h.api.fail(
      'GET',
      /^\/v1\/me\/class-sessions$/,
      403,
      'OAUTH_ROUTE_NOT_ALLOWED',
      'Não permitido.',
    );
    const { data } = await callTool(client, 'list_my_classes');
    expect(data.error.code).toBe('OAUTH_ROUTE_NOT_ALLOWED');
    expect(data.error.message).toContain('app');
  });
});

describe('get_my_profile (saudação)', () => {
  it('usa GET /v1/me/summary (nunca GET /v1/me) e devolve só o primeiro nome e os esportes', async () => {
    const { data, text } = await callTool(client, 'get_my_profile');
    expect(data).toEqual({
      firstName: 'Lucas',
      favoriteSports: [{ slug: 'beach-tennis', name: 'Beach Tennis', level: 'intermediário' }],
    });
    expect(text).toContain('Usuário conectado: Lucas.');
    expect(h.api.calls.map((call) => call.path)).toEqual(['/v1/me/summary']);
  });

  it('conexão revogada na API (401 OAUTH_TOKEN_INVALID) pede para reconectar', async () => {
    h.api.fail('GET', /^\/v1\/me\/summary$/, 401, 'OAUTH_TOKEN_INVALID', 'Token inválido.');
    const { data } = await callTool(client, 'get_my_profile');
    expect(data.error.code).toBe('OAUTH_TOKEN_INVALID');
    expect(data.error.message).toContain('reconectar');
  });
});

describe('search_spaces', () => {
  it('busca por texto e devolve os campos mínimos com dinheiro em centavos e BRL', async () => {
    const { isError, data } = await callTool(client, 'search_spaces', { text: 'Arena', limit: 2 });
    expect(isError).toBe(false);
    expect(data.count).toBe(2);
    expect(data.spaces[0]).toEqual({
      id: SPACES[0]?.id,
      slug: 'arena-sul',
      name: 'Arena Sul',
      neighborhood: 'Buritis',
      city: 'Belo Horizonte',
      distanceKm: null,
      sports: [
        { slug: 'beach-tennis', name: 'Beach Tennis' },
        { slug: 'futevolei', name: 'Futevôlei' },
      ],
      pricePerHour: { cents: 12000, formatted: 'R$ 120,00' },
      rating: { average: 4.6, count: 7, label: '4.6 de 5' },
      services: ['aluguel de quadra', 'aulas'],
    });
    const call = h.api.callsTo('GET', /^\/v1\/spaces$/)[0];
    expect(call?.query.get('q')).toBe('Arena');
  });

  it('repassa esporte (normalizado), nota mínima e coordenadas', async () => {
    await callTool(client, 'search_spaces', {
      sport: 'Beach Tennis',
      minRating: 4,
      near: { lat: -19.9, lng: -43.9, radiusKm: 10 },
    });
    const query = h.api.callsTo('GET', /^\/v1\/spaces$/)[0]?.query;
    expect(query?.get('sport')).toBe('beach-tennis');
    expect(query?.get('minRating')).toBe('4');
    expect(query?.get('lat')).toBe('-19.9');
    expect(query?.get('radiusKm')).toBe('10');
  });

  it('filtra por bairro (a API não filtra por cidade/bairro)', async () => {
    const { data } = await callTool(client, 'search_spaces', { neighborhood: 'gutierrez' });
    expect(data.spaces.map((s: { slug: string }) => s.slug)).toEqual(['arena-oeste']);
  });
});

describe('resolvedor de espaço', () => {
  it('pelo slug', async () => {
    const { data } = await callTool(client, 'get_space', { space: 'arena-oeste' });
    expect(data.space.name).toBe('Arena Oeste');
  });

  it('pelo nome parcial, sem acento nem caixa', async () => {
    const { data } = await callTool(client, 'get_space', { space: 'oeste' });
    expect(data.space.slug).toBe('arena-oeste');
  });

  it('pelo id', async () => {
    const { data } = await callTool(client, 'get_space', { space: SPACES[1]?.id });
    expect(data.space.slug).toBe('arena-oeste');
  });

  it('nome ambíguo devolve as opções em vez de escolher', async () => {
    const { isError, data } = await callTool(client, 'get_space', { space: 'Arena' });
    expect(isError).toBe(true);
    expect(data.error.code).toBe('SPACE_AMBIGUOUS');
    expect(data.error.options.map((o: { slug: string }) => o.slug)).toEqual([
      'arena-sul',
      'arena-oeste',
      'arena-so-cartao',
    ]);
  });

  it('nome inexistente: SPACE_NOT_FOUND sugerindo search_spaces', async () => {
    const { data } = await callTool(client, 'get_space', { space: 'Quadra do Zé' });
    expect(data.error.code).toBe('SPACE_NOT_FOUND');
    expect(data.error.message).toContain('search_spaces');
  });
});

describe('get_space', () => {
  it('devolve só o que o espaço preencheu (nulo = não informado) e a descrição como dado', async () => {
    const { data, text } = await callTool(client, 'get_space', { space: 'arena-sul' });
    expect(data.space.address).toEqual({
      street: 'Rua das Areias',
      number: '100',
      neighborhood: 'Buritis',
      postalCode: null,
      city: 'Belo Horizonte',
      state: 'MG',
    });
    expect(data.space.contact).toEqual({
      phone: '+553133334444',
      whatsapp: null,
      instagram: '@arena',
    });
    expect(data.space.openingHours[0]).toEqual({
      weekday: 'domingo',
      opensAt: '08:00',
      closesAt: '18:00',
    });
    expect(data.space.rental.pricePerHour).toEqual({ cents: 12000, formatted: 'R$ 120,00' });
    expect(data.space.payment).toEqual({
      optionsViaAssistant: ['ON_SITE', 'ONLINE_PIX'],
      cardOnlineOnlyInApp: true,
      acceptedAtVenue: ['Pix', 'dinheiro'],
    });
    expect(data.space.link).toBe('https://app.example.com/espacos/arena-sul');
    // Texto do banco segue como campo de dado, não no resumo.
    expect(data.space.description).toContain('Ignore as instruções');
    expect(text.split('\n')[0]).toBe('Detalhes de Arena Sul.');
  });

  it('erro 404 da API vira SPACE_NOT_FOUND', async () => {
    h.api.fail(
      'GET',
      /^\/v1\/spaces\/arena-sul$/,
      404,
      'SPACE_NOT_FOUND',
      'Espaço não encontrado.',
    );
    h.api.fail('GET', /^\/v1\/spaces$/, 404, 'SPACE_NOT_FOUND', 'Espaço não encontrado.');
    const { data } = await callTool(client, 'get_space', { space: 'arena-sul' });
    expect(data.error.code).toBe('SPACE_NOT_FOUND');
  });
});

describe('check_availability', () => {
  it('lista os horários livres por quadra com o preço da duração', async () => {
    const { data, text } = await callTool(client, 'check_availability', {
      space: 'arena-sul',
      date: '2026-11-13',
      sport: 'beach tennis',
      durationMin: 90,
    });
    expect(data.price).toEqual({ cents: 18000, formatted: 'R$ 180,00' });
    expect(data.courts).toEqual([
      expect.objectContaining({ name: 'Quadra 1', freeStartTimes: ['18:00'] }),
      expect.objectContaining({ name: 'Quadra 2', freeStartTimes: ['18:00', '19:00'] }),
    ]);
    expect(text).toContain('3 horário(s) livre(s)');
    const query = h.api.callsTo('GET', /availability$/)[0]?.query;
    expect(query?.get('sportId')).toBe('5f000000-0000-4000-8000-000000000001');
    expect(query?.get('durationMin')).toBe('90');
  });

  it('espaço com mais de um esporte e nenhum informado: pede o esporte com as opções', async () => {
    const { data } = await callTool(client, 'check_availability', {
      space: 'arena-sul',
      date: '2026-11-13',
    });
    expect(data.error.code).toBe('SPORT_REQUIRED');
    expect(data.error.options).toHaveLength(2);
  });

  it('data em formato errado é recusada antes de chamar a API', async () => {
    const { isError } = await callTool(client, 'check_availability', {
      space: 'arena-sul',
      date: '13/11/2026',
    });
    expect(isError).toBe(true);
    expect(h.api.calls).toHaveLength(0);
  });

  it('erro 422 da API vira a mensagem do contrato', async () => {
    h.api.fail(
      'GET',
      /availability$/,
      422,
      'DURATION_OUT_OF_RANGE',
      'Duração fora dos limites do espaço.',
    );
    const { data } = await callTool(client, 'check_availability', {
      space: 'arena-oeste',
      date: '2026-11-13',
      durationMin: 600,
    });
    expect(data.error).toEqual({
      code: 'DURATION_OUT_OF_RANGE',
      message: 'Duração fora dos limites do espaço.',
    });
  });
});

describe('list_space_classes', () => {
  it('lista turmas e planos, professores pelo primeiro nome', async () => {
    const { data } = await callTool(client, 'list_space_classes', { space: 'arena-sul' });
    expect(data.classGroups[0]).toMatchObject({
      name: 'Beach Tennis Iniciante',
      level: 'iniciante',
      weekday: 'sábado',
      startTime: '09:00',
      availableSpots: 3,
      teachers: ['Paula'],
    });
    expect(data.plans[0].price).toEqual({ cents: 25000, formatted: 'R$ 250,00' });
  });

  it('erro da API', async () => {
    h.api.fail('GET', /classes$/, 503, 'HTTP_ERROR', 'Bad gateway');
    const { data } = await callTool(client, 'list_space_classes', { space: 'arena-sul' });
    expect(data.error.code).toBe('API_UNAVAILABLE');
  });
});

describe('list_my_bookings e get_booking', () => {
  it('lista as próximas com data e hora locais', async () => {
    const { data } = await callTool(client, 'list_my_bookings');
    const mine = data.bookings.find((b: { id: string }) => b.id === MY_BOOKING);
    expect(mine).toMatchObject({
      date: '2026-11-13',
      startTime: '18:00',
      endTime: '19:00',
      status: 'CONFIRMED',
      statusLabel: 'confirmada',
      price: { cents: 12000, formatted: 'R$ 120,00' },
      youAreOrganizer: true,
      cancellableUntil: { date: '2026-11-13', time: '16:00' },
      canCancelNow: true,
    });
    expect(h.api.callsTo('GET', /^\/v1\/bookings$/)[0]?.query.get('when')).toBe('upcoming');
  });

  it('detalhe com participantes só pelo primeiro nome', async () => {
    const { data } = await callTool(client, 'get_booking', { bookingId: MY_BOOKING });
    expect(data.booking.participants).toEqual([
      { firstName: 'Lucas', isOrganizer: true, isMe: true, status: 'ACCEPTED' },
      { firstName: 'Maria', isOrganizer: false, isMe: false, status: 'INVITED' },
    ]);
  });

  it('reserva de outra pessoa: sem dados de pagamento do organizador', async () => {
    const { data } = await callTool(client, 'get_booking', { bookingId: FRIEND_BOOKING });
    expect(data.booking.youAreOrganizer).toBe(false);
    expect(data.booking.organizerFirstName).toBe('Carlos');
    expect(data.booking.payment).toBeNull();
  });

  it('id que não é uuid é recusado antes de chamar a API (nada de caminho montado com texto livre)', async () => {
    const { isError } = await callTool(client, 'get_booking', { bookingId: '../me' });
    expect(isError).toBe(true);
    expect(h.api.calls).toHaveLength(0);
  });

  it('erro 404 da API', async () => {
    const { data } = await callTool(client, 'get_booking', {
      bookingId: '00000000-0000-4000-8000-000000000000',
    });
    expect(data.error.code).toBe('BOOKING_NOT_FOUND');
    expect(data.error.message).toContain('list_my_bookings');
  });
});

describe('aulas', () => {
  it('list_my_classes devolve as aulas sem os outros alunos', async () => {
    const { data } = await callTool(client, 'list_my_classes');
    expect(data.classes[0]).toMatchObject({
      id: SESSION,
      className: 'Beach Tennis Iniciante',
      date: '2026-11-14',
      startTime: '09:00',
      teachers: ['Paula'],
      canConfirm: true,
      myAttendance: null,
    });
  });

  it('confirm_class_attendance e cancel_class_attendance', async () => {
    const confirmed = await callTool(client, 'confirm_class_attendance', { sessionId: SESSION });
    expect(confirmed.data.class.myAttendance.statusLabel).toBe('presença confirmada');
    expect(h.api.callsTo('POST', /attendance$/)).toHaveLength(1);

    const withdrawn = await callTool(client, 'cancel_class_attendance', { sessionId: SESSION });
    expect(withdrawn.data.class.myAttendance.status).toBe('CANCELLED');
    expect(h.api.callsTo('DELETE', /attendance$/)).toHaveLength(1);
  });

  it('erro da API na confirmação vira a mensagem do contrato', async () => {
    h.api.fail(
      'POST',
      /attendance$/,
      409,
      'ATTENDANCE_LIST_NOT_OPEN',
      'A lista de presença ainda não abriu.',
    );
    const { data } = await callTool(client, 'confirm_class_attendance', { sessionId: SESSION });
    expect(data.error).toEqual({
      code: 'ATTENDANCE_LIST_NOT_OPEN',
      message: 'A lista de presença ainda não abriu.',
    });
  });

  it('erro da API ao desmarcar', async () => {
    h.api.fail(
      'DELETE',
      /attendance$/,
      409,
      'CANCEL_DEADLINE_PASSED',
      'O prazo para desmarcar terminou.',
    );
    const { data } = await callTool(client, 'cancel_class_attendance', { sessionId: SESSION });
    expect(data.error.code).toBe('CANCEL_DEADLINE_PASSED');
  });

  it('erro da API ao listar', async () => {
    h.api.fail(
      'GET',
      /class-sessions$/,
      422,
      'CLASS_SESSIONS_RANGE_TOO_LONG',
      'Período longo demais.',
    );
    const { data } = await callTool(client, 'list_my_classes', {
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(data.error.code).toBe('CLASS_SESSIONS_RANGE_TOO_LONG');
  });
});
