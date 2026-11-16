import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  MyClassSessionDetail,
  PlayerBookingDetailDto,
} from '@space-sports/api-client/dist/fetch.js';
import type { JSONWebKeySet } from 'jose';
import { manageRoute } from './fake-manage.js';
import { superRoute } from './fake-super.js';
import {
  COURT_1,
  COURT_2,
  card,
  classSession,
  friendBooking,
  ME,
  myBooking,
  NOW,
  SPACES,
} from './fixtures.js';

export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  authorization: string | undefined;
  xClient: string | undefined;
  idempotencyKey: string | undefined;
  body: unknown;
}

interface Reply {
  status: number;
  body?: unknown;
}

type Failure = { method: string; path: RegExp; reply: Reply; times: number };

const apiError = (status: number, code: string, message: string): Reply => ({
  status,
  body: { error: { code, message }, requestId: 'req-interno-123' },
});

/**
 * API simulada (servidor HTTP de verdade): só as rotas que o MCP chama, com dados em memória, o
 * JWKS de teste e o registro de cada chamada (para conferir o Bearer, o `X-Client` e a
 * `Idempotency-Key`).
 */
export class FakeApi {
  readonly calls: RecordedCall[] = [];
  private server?: Server;
  private failures: Failure[] = [];
  bookings = new Map<string, PlayerBookingDetailDto>();
  private byIdempotencyKey = new Map<string, string>();
  session: MyClassSessionDetail = classSession();
  /** Preço por hora da disponibilidade (para simular mudança de preço). */
  pricePerHourCents = 12000;
  url = '';

  constructor(private readonly jwks: JSONWebKeySet) {
    this.reset();
  }

  reset(): void {
    this.calls.length = 0;
    this.failures = [];
    this.bookings = new Map([
      [myBooking().id, myBooking()],
      [friendBooking().id, friendBooking()],
    ]);
    this.byIdempotencyKey.clear();
    this.session = classSession();
    this.pricePerHourCents = 12000;
  }

  /** As próximas `times` chamadas que casarem respondem com o erro do contrato. */
  fail(method: string, path: RegExp, status: number, code: string, message = 'Erro.', times = 1) {
    this.failures.push({ method, path, reply: apiError(status, code, message), times });
  }

  callsTo(method: string, path: RegExp): RecordedCall[] {
    return this.calls.filter((call) => call.method === method && path.test(call.path));
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req).then((reply) => {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private async handle(req: IncomingMessage): Promise<Reply> {
    const url = new URL(req.url ?? '/', 'http://fake');
    const method = req.method ?? 'GET';
    if (url.pathname === '/api/auth/jwks') return { status: 200, body: this.jwks };

    const raw = await readBody(req);
    const call: RecordedCall = {
      method,
      path: url.pathname,
      query: url.searchParams,
      authorization: header(req, 'authorization'),
      xClient: header(req, 'x-client'),
      idempotencyKey: header(req, 'idempotency-key'),
      body: raw ? JSON.parse(raw) : undefined,
    };
    this.calls.push(call);

    const failure = this.failures.find((f) => f.method === method && f.path.test(url.pathname));
    if (failure) {
      failure.times -= 1;
      if (failure.times <= 0) this.failures = this.failures.filter((f) => f !== failure);
      return failure.reply;
    }
    return this.route(method, url, call);
  }

  private route(method: string, url: URL, call: RecordedCall): Reply {
    const managed = manageRoute(method, url, call.authorization);
    if (managed) return managed;
    const platform = superRoute(method, url, call.authorization);
    if (platform) return platform;
    const path = url.pathname;
    const availabilityMatch = /^\/v1\/spaces\/([^/]+)\/availability$/.exec(path);
    const classesMatch = /^\/v1\/spaces\/([^/]+)\/classes$/.exec(path);
    const spaceMatch = /^\/v1\/spaces\/([^/]+)$/.exec(path);
    const bookingMatch = /^\/v1\/bookings\/([^/]+)$/.exec(path);
    const cancelMatch = /^\/v1\/bookings\/([^/]+)\/cancel$/.exec(path);
    const attendanceMatch = /^\/v1\/me\/class-sessions\/([^/]+)\/attendance$/.exec(path);

    if (method === 'GET' && path === '/v1/me/summary') {
      return {
        status: 200,
        body: {
          id: ME,
          firstName: 'Lucas',
          favoriteSports: [
            {
              sport: {
                id: '5f000000-0000-4000-8000-000000000001',
                name: 'Beach Tennis',
                slug: 'beach-tennis',
              },
              level: 'INTERMEDIATE',
            },
          ],
        },
      };
    }
    // Como a API da MCP.1: o perfil completo não aceita o token do MCP.
    if (path === '/v1/me') {
      return apiError(403, 'OAUTH_ROUTE_NOT_ALLOWED', 'Rota não disponível para o assistente.');
    }
    if (method === 'GET' && path === '/v1/spaces') {
      const q = url.searchParams.get('q')?.toLowerCase();
      const items = SPACES.filter((s) => !q || s.name.toLowerCase().includes(q)).map(card);
      return { status: 200, body: { items, nextCursor: null } };
    }
    if (method === 'GET' && availabilityMatch) {
      const space = SPACES.find((s) => s.id === availabilityMatch[1]);
      if (!space) return apiError(404, 'SPACE_NOT_FOUND', 'Espaço não encontrado.');
      return { status: 200, body: this.availability(url.searchParams) };
    }
    if (method === 'GET' && classesMatch) {
      const space = SPACES.find((s) => s.slug === classesMatch[1]);
      if (!space) return apiError(404, 'SPACE_NOT_FOUND', 'Espaço não encontrado.');
      return {
        status: 200,
        body: {
          space: {
            id: space.id,
            name: space.name,
            slug: space.slug,
            timeZone: 'America/Sao_Paulo',
          },
          plans: [
            {
              id: 'd0000000-0000-4000-8000-000000000001',
              name: 'Plano 2x',
              sport: { id: 's1', name: 'Beach Tennis', slug: 'beach-tennis' },
              weeklyFrequency: 2,
              priceCents: 25000,
              billingDay: 5,
            },
          ],
          classGroups: [
            {
              id: 'f0000000-0000-4000-8000-000000000001',
              name: 'Beach Tennis Iniciante',
              sport: { id: 's1', name: 'Beach Tennis', slug: 'beach-tennis' },
              level: 'BEGINNER',
              court: { id: COURT_1, name: 'Quadra 1' },
              weekday: 6,
              startTime: '09:00',
              durationMin: 60,
              capacity: 8,
              enrolledCount: 5,
              availableSpots: 3,
              teachers: [{ name: 'Paula Lima', avatarUrl: null }],
            },
          ],
        },
      };
    }
    if (method === 'GET' && spaceMatch) {
      const space = SPACES.find((s) => s.slug === spaceMatch[1]);
      return space
        ? { status: 200, body: space }
        : apiError(404, 'SPACE_NOT_FOUND', 'Espaço não encontrado.');
    }
    if (method === 'GET' && path === '/v1/bookings') {
      const when = url.searchParams.get('when') ?? 'upcoming';
      const items = [...this.bookings.values()].filter((b) =>
        when === 'past' ? new Date(b.endsAt) < NOW : new Date(b.endsAt) >= NOW,
      );
      return { status: 200, body: { items: items.map(listItem), nextCursor: null } };
    }
    if (method === 'GET' && bookingMatch) {
      const booking = this.bookings.get(bookingMatch[1] ?? '');
      return booking
        ? { status: 200, body: booking }
        : apiError(404, 'BOOKING_NOT_FOUND', 'Reserva não encontrada.');
    }
    if (method === 'POST' && path === '/v1/bookings') return this.createBooking(call);
    if (method === 'POST' && cancelMatch) {
      const booking = this.bookings.get(cancelMatch[1] ?? '');
      if (!booking || booking.organizer.userId !== ME) {
        return apiError(404, 'BOOKING_NOT_FOUND', 'Reserva não encontrada.');
      }
      if (booking.status === 'CANCELLED') {
        return apiError(
          409,
          'INVALID_BOOKING_STATUS',
          'A reserva não está em um status que permita esta ação.',
        );
      }
      const reason = (call.body as { reason?: string } | undefined)?.reason ?? null;
      const cancelled = {
        ...booking,
        status: 'CANCELLED' as const,
        cancelledAt: NOW.toISOString(),
        cancelReason: reason,
      };
      this.bookings.set(booking.id, cancelled);
      return { status: 200, body: cancelled };
    }
    if (method === 'GET' && path === '/v1/me/class-sessions') {
      const { confirmed: _confirmed, ...item } = this.session;
      return { status: 200, body: { from: '2026-11-12', to: '2026-11-26', items: [item] } };
    }
    if (attendanceMatch) {
      if (attendanceMatch[1] !== this.session.id) {
        return apiError(404, 'CLASS_SESSION_NOT_FOUND', 'Aula não encontrada.');
      }
      if (method === 'POST') {
        this.session = {
          ...this.session,
          myAttendance: { status: 'CONFIRMED', waitlistPosition: null },
          confirmedCount: this.session.confirmedCount + 1,
          canConfirm: false,
          canWithdraw: true,
        };
        return { status: 200, body: this.session };
      }
      if (method === 'DELETE') {
        this.session = {
          ...this.session,
          myAttendance: { status: 'CANCELLED', waitlistPosition: null },
          confirmedCount: this.session.confirmedCount - 1,
          canConfirm: true,
          canWithdraw: false,
        };
        return { status: 200, body: this.session };
      }
    }
    return apiError(404, 'NOT_FOUND', 'Rota não encontrada.');
  }

  /** Grade simples: 18:00 livre nas duas quadras, 19:00 só na Quadra 2, 20:00 ocupado. */
  private availability(query: URLSearchParams) {
    const date = query.get('date') ?? '2026-11-13';
    const durationMin = Number(query.get('durationMin') ?? 60);
    const courtId = query.get('courtId');
    const at = (time: string) => new Date(`${date}T${time}:00-03:00`).toISOString();
    const slot = (time: string, available: boolean) => ({
      startsAt: at(time),
      endsAt: new Date(new Date(at(time)).getTime() + durationMin * 60_000).toISOString(),
      available,
    });
    const courts = [
      {
        id: COURT_1,
        name: 'Quadra 1',
        covered: false,
        maxPlayers: 4,
        slots: [slot('18:00', true), slot('19:00', false), slot('20:00', false)],
      },
      {
        id: COURT_2,
        name: 'Quadra 2',
        covered: true,
        maxPlayers: 4,
        slots: [slot('18:00', true), slot('19:00', true), slot('20:00', false)],
      },
    ].filter((court) => !courtId || court.id === courtId);
    return {
      date,
      timeZone: 'America/Sao_Paulo',
      durationMin,
      pricePerHourCents: this.pricePerHourCents,
      priceCents: (this.pricePerHourCents * durationMin) / 60,
      courts,
    };
  }

  private createBooking(call: RecordedCall): Reply {
    const key = call.idempotencyKey;
    const existing = key ? this.byIdempotencyKey.get(key) : undefined;
    if (existing) return { status: 201, body: this.bookings.get(existing) };
    const body = call.body as {
      spaceId: string;
      courtId: string;
      sportId: string;
      startsAt: string;
      durationMin: number;
      peopleCount: number;
      paymentOption?: string;
    };
    const id = randomUUID();
    const startsAt = new Date(body.startsAt);
    const priceCents = (this.pricePerHourCents * body.durationMin) / 60;
    const pix = body.paymentOption === 'ONLINE_PIX';
    const pixExpires = new Date(NOW.getTime() + 15 * 60_000).toISOString();
    const booking: PlayerBookingDetailDto = {
      ...myBooking(),
      id,
      court: { id: body.courtId, name: body.courtId === COURT_2 ? 'Quadra 2' : 'Quadra 1' },
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + body.durationMin * 60_000).toISOString(),
      durationMin: body.durationMin,
      peopleCount: body.peopleCount,
      priceCents,
      status: 'CONFIRMED',
      cancellableUntil: new Date(startsAt.getTime() - 120 * 60_000).toISOString(),
      participants: myBooking().participants.slice(0, 1),
      openOnlineCharge: pix
        ? { id: 'oc-1', method: 'PIX', expiresAt: pixExpires, createdAt: NOW.toISOString() }
        : null,
      onlinePayment: pix
        ? {
            id: '0c000000-0000-4000-8000-000000000001',
            payableType: 'BOOKING',
            payableId: id,
            method: 'PIX',
            status: 'PENDING',
            amountCents: priceCents,
            refundedCents: 0,
            pix: { copyPaste: '00020126PIXCOPIAECOLA', qrSvg: '<svg/>', expiresAt: pixExpires },
            cardBrand: null,
            cardLast4: null,
            expiresAt: pixExpires,
            paidAt: null,
            failureCode: null,
            failureReason: null,
            paymentEnvironment: { provider: 'fake', enabled: true, sandbox: null },
            serverTime: NOW.toISOString(),
            createdAt: NOW.toISOString(),
          }
        : null,
    };
    this.bookings.set(id, booking);
    if (key) this.byIdempotencyKey.set(key, id);
    return { status: 201, body: booking };
  }
}

function listItem(booking: PlayerBookingDetailDto) {
  const {
    participants: _p,
    myShare: _m,
    canEditPeople: _c1,
    peopleEditBlock: _b1,
    canEditSchedule: _c2,
    scheduleEditBlock: _b2,
    onlinePayment: _o,
    ...item
  } = booking;
  return item;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
