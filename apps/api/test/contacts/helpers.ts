import { eq } from 'drizzle-orm';
import { users } from '../../src/db/schema/index.js';
import { API_URL, type SignedUp, type TestApp } from '../auth/helpers.js';
import { bearer, type Space, slotIn } from '../bookings/fixtures.js';

export type Participant = {
  id: string;
  name: string | null;
  isOrganizer: boolean;
  status: string;
  inviteToken: string | null;
  inviteUrl: string | null;
  suggestedUser: { id: string; firstName: string } | null;
  hasAccount: boolean;
};

export type Detail = { id: string; participants: Participant[] };

/** Reserva do organizador; `hours` à frente separa os horários de cada teste. */
export const book = async (
  t: TestApp,
  organizer: SignedUp,
  space: Space,
  hours: number,
  peopleCount = 4,
): Promise<Detail> => {
  const res = await t
    .http()
    .post('/v1/bookings')
    .set(...bearer(organizer))
    .send({
      spaceId: space.id,
      courtId: space.courtA,
      sportId: space.sportId,
      startsAt: slotIn(hours * 60).toISOString(),
      durationMin: 60,
      peopleCount,
    })
    .expect(201);
  return res.body;
};

export const invite = async (
  t: TestApp,
  organizer: SignedUp,
  bookingId: string,
  body: Record<string, unknown>,
): Promise<Detail> => {
  const res = await t
    .http()
    .post(`/v1/bookings/${bookingId}/invites`)
    .set(...bearer(organizer))
    .send(body)
    .expect(201);
  return res.body;
};

/** Convidados na ordem dos convites. */
export const guests = (detail: Detail) => detail.participants.filter((p) => !p.isOrganizer);

/** Token do n-ésimo convidado (pendente). */
export const tokenOf = (detail: Detail, index = 0): string => {
  const token = guests(detail)[index]?.inviteToken;
  if (!token) throw new Error('Convite sem token.');
  return token;
};

export const confirmPublic = (t: TestApp, token: string, body: Record<string, unknown>) =>
  t.http().post(`/v1/public/invites/${token}/confirm`).send(body);

export const myDetail = async (t: TestApp, user: SignedUp, bookingId: string): Promise<Detail> => {
  const res = await t
    .http()
    .get(`/v1/bookings/${bookingId}`)
    .set(...bearer(user))
    .expect(200);
  return res.body;
};

/** Conta com telefone verificado, como depois do OTP. */
export const verifyPhone = (t: TestApp, user: SignedUp, phone: string) =>
  t.db.update(users).set({ phone, phoneVerified: true }).where(eq(users.id, user.id));

/** Abre o link do e-mail de verificação da conta. */
export const verifyEmail = async (t: TestApp, email: string) => {
  const mail = await t.mailer.lastTo(email);
  const url = new URL(/(http\S+verify-email\S+)/.exec(mail.text)?.[1] ?? `${API_URL}/invalido`);
  await t.http().get(`${url.pathname}${url.search}`).expect(302);
};
