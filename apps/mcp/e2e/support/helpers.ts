import type { Client } from '@modelcontextprotocol/client';
import { sql } from './db.js';
import { API_URL, E2E_PASSWORD, WEB_ORIGIN } from './env.js';
import { call, ok } from './mcp.js';
import { Browser } from './oauth.js';

/** Data `YYYY-MM-DD` em America/Sao_Paulo, `days` dias à frente. */
export function spDate(days: number): string {
  const when = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(when);
}

/** Valor formatado como as tools devolvem (Intl pt-BR usa espaço não separável: `R$\u00a0100,00`). */
export const brl = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

let counter = 0;

/**
 * Cadastra um jogador novo (e-mail + senha + telefone, como o app). Cada teste de limite ou de
 * bloqueio usa o seu: os contadores do Redis e o status da conta não vazam para os outros.
 */
export async function signUpUser(label = 'qa') {
  counter += 1;
  const email = `${label}-${Date.now()}-${counter}@exemplo.com`;
  const phone = `+5531977${String(Date.now() + counter).slice(-6)}`;
  const browser = new Browser();
  const res = await browser.postJson('/v1/auth/sign-up/email', {
    name: 'Qa Jogador',
    email,
    password: E2E_PASSWORD,
    phone,
  });
  if (res.status !== 200) throw new Error(`cadastro falhou: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string } };
  return { id: body.user.id, email, phone, token: res.headers.get('set-auth-token') ?? '' };
}

/** Um horário livre (aleatório, para reexecuções sem reseed não baterem em reserva antiga). */
export async function pickSlot(
  client: Client,
  space: string,
  days: number,
  durationMin = 60,
  sport = 'futevolei',
) {
  const date = spDate(days);
  const availability = await ok(client, 'check_availability', { space, date, sport, durationMin });
  const court = availability.courts[0];
  const times: string[] = court.freeStartTimes.filter((t: string) => t >= '08:00' && t <= '20:00');
  const startTime = times[Math.floor(Math.random() * times.length)] as string;
  return { date, startTime, court: court.name as string, availability };
}

/** prepare_booking + create_booking pelo MCP (ON_SITE por padrão). */
export async function bookViaMcp(
  client: Client,
  options: {
    space?: string;
    days?: number;
    paymentOption?: 'ON_SITE' | 'ONLINE_PIX';
    peopleCount?: number;
  } = {},
) {
  const space = options.space ?? 'arena-e2e';
  const slot = await pickSlot(client, space, options.days ?? 6);
  const prepared = await ok(client, 'prepare_booking', {
    space,
    date: slot.date,
    startTime: slot.startTime,
    durationMin: 60,
    peopleCount: options.peopleCount ?? 2,
    sport: 'futevolei',
    court: slot.court,
    ...(options.paymentOption ? { paymentOption: options.paymentOption } : {}),
  });
  const input = prepared.confirmation.createBookingInput;
  const created = await ok(client, 'create_booking', input);
  return { slot, prepared, input, created, bookingId: created.booking.id as string };
}

export async function userByEmail(email: string) {
  const [row] = await sql<{ id: string; status: string }>(
    'select id, status from users where email = $1',
    [email],
  );
  if (!row) throw new Error(`usuário ${email} não existe no seed`);
  return row;
}

export async function bookingRow(id: string) {
  const [row] = await sql<{
    id: string;
    status: string;
    channel: string;
    organizer_user_id: string;
    space_id: string;
  }>('select id, status, channel, organizer_user_id, space_id from bookings where id = $1', [id]);
  return row;
}

export async function spaceId(slug: string) {
  const [row] = await sql<{ id: string }>('select id from spaces where slug = $1', [slug]);
  if (!row) throw new Error(`espaço ${slug} não existe`);
  return row.id;
}

/**
 * Cria uma aula futura ABERTA para confirmar presença. Sem os jobs ligados a API não gera sessões,
 * então o teste insere uma na turma "Futevôlei iniciante" (Arena E2E, Quadra A), da qual o jogador3
 * do seed é aluno ativo. Devolve o id e o horário.
 */
export async function createOpenClassSession(hoursAhead = 30) {
  // Minuto aleatório: (turma, início) é único e o banco pode ter sessões de execuções anteriores.
  const startsAt = new Date(
    Date.now() + hoursAhead * 3_600_000 + Math.floor(Math.random() * 20_000) * 60_000,
  );
  startsAt.setUTCSeconds(0, 0);
  const endsAt = new Date(startsAt.getTime() + 3_600_000);
  const [row] = await sql<{ id: string }>(
    `with s as (
       insert into class_sessions (class_group_id, space_id, court_id, starts_at, ends_at, capacity, status, opened_at)
       select g.id, g.space_id, g.court_id, $1, $2, 8, 'OPEN', now()
         from class_groups g where g.name = 'Futevôlei iniciante'
       returning id, class_group_id, space_id
     ), t as (
       insert into class_session_teachers (class_session_id, space_id, teacher_member_id)
       select s.id, s.space_id, gt.teacher_member_id
         from s join class_group_teachers gt on gt.class_group_id = s.class_group_id
       returning class_session_id
     )
     select id from s`,
    [startsAt.toISOString(), endsAt.toISOString()],
  );
  if (!row) throw new Error('sessão não criada');
  return { id: row.id, startsAt };
}

export { API_URL, call, ok, WEB_ORIGIN };

/** Corpo de `POST /v1/bookings` a partir do `createBookingInput` do prepare_booking (America/Sao_Paulo = -03:00). */
export function apiBookingBody(input: {
  spaceId: string;
  courtId: string;
  sportId: string;
  date: string;
  startTime: string;
  durationMin: number;
  peopleCount: number;
  paymentOption?: string;
}) {
  return {
    spaceId: input.spaceId,
    courtId: input.courtId,
    sportId: input.sportId,
    startsAt: new Date(`${input.date}T${input.startTime}:00-03:00`).toISOString(),
    durationMin: input.durationMin,
    peopleCount: input.peopleCount,
    paymentOption: input.paymentOption,
  };
}

/** Jogador novo com token do MCP (todos os escopos): isola contadores de limite e estado da conta. */
export async function freshPlayerToken(label = 'qa') {
  const user = await signUpUser(label);
  const { connect } = await import('./oauth.js');
  const connected = await connect(user.email);
  return { ...user, token: connected.tokens.access_token, connected };
}
