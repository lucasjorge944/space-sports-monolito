import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, type TestApp } from '../auth/helpers.js';
import { createSpace, member, type Space, slotIn, useMiddayClock } from '../bookings/fixtures.js';
import { bearer, superUser } from './fixtures.js';

// RN-SUPER-01: a auditoria de domínio gravada pelos handlers também marca o modo suporte.

useMiddayClock();

describe('Super: auditoria de domínio no modo suporte', () => {
  let t: TestApp;
  let space: Space;
  let owner: SignedUp;
  let admin: SignedUp;
  let session: string;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-suporte-audit');
    owner = await member(t, 'dono@exemplo.com', space.id, 'OWNER');
    admin = await superUser(t, 'super@exemplo.com');
    const started = await t
      .http()
      .post(`/v1/super/spaces/${space.id}/support-sessions`)
      .set(...bearer(admin))
      .send({ reason: 'Cancelar reserva a pedido do dono' })
      .expect(201);
    session = started.body.id as string;
  });
  afterAll(() => t.close());

  const deskBooking = (user: SignedUp, startsAt: Date, headers: Record<string, string> = {}) =>
    t
      .http()
      .post(`/v1/manage/spaces/${space.id}/bookings`)
      .set(...bearer(user))
      .set(headers)
      .send({
        courtId: space.courtA,
        sportId: space.sportId,
        startsAt: startsAt.toISOString(),
        durationMin: 60,
        peopleCount: 2,
        guestName: 'Cliente Balcão',
        guestPhone: '+5531988887777',
      })
      .expect(201);
  const cancel = (user: SignedUp, bookingId: string, headers: Record<string, string> = {}) =>
    t
      .http()
      .post(`/v1/manage/spaces/${space.id}/bookings/${bookingId}/cancel`)
      .set(...bearer(user))
      .set(headers)
      .send({})
      .expect(200);
  const cancelLog = (bookingId: string) =>
    t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'booking.cancel'), eq(auditLogs.entityId, bookingId)));

  it('cancelar reserva em modo suporte sai com acting_as_super e o id da sessão', async () => {
    const booking = await deskBooking(owner, slotIn(24 * 60));
    await cancel(admin, booking.body.id, { 'x-support-session': session });

    const [log] = await cancelLog(booking.body.id);
    expect(log).toMatchObject({
      actorId: admin.id,
      actingAsSuper: true,
      spaceId: space.id,
      diff: { from: 'CONFIRMED', to: 'CANCELLED', supportSessionId: session },
    });
  });

  it('a mesma ação feita pelo Dono continua sem a marca de Super', async () => {
    const booking = await deskBooking(owner, slotIn(30 * 60));
    await cancel(owner, booking.body.id);

    const [log] = await cancelLog(booking.body.id);
    expect(log?.actingAsSuper).toBe(false);
    expect(log?.diff).not.toHaveProperty('supportSessionId');
  });
});
