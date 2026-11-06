import type { SignedUp, TestApp } from '../auth/helpers.js';
import { bearer, type Space } from '../bookings/fixtures.js';
import type { NotificationsTestApp } from './fakes.js';

export type InboxItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
};

export const registerDevice = async (
  t: NotificationsTestApp,
  user: SignedUp,
  expoPushToken: string,
  platform: 'IOS' | 'ANDROID' = 'IOS',
) => {
  const res = await t
    .http()
    .put('/v1/me/devices')
    .set(...bearer(user))
    .send({ expoPushToken, platform })
    .expect(200);
  return res.body as { id: string; expoPushToken: string; platform: string };
};

export const inbox = async (
  t: TestApp,
  user: SignedUp,
  query = '',
): Promise<{ items: InboxItem[]; nextCursor: string | null; unreadCount: number }> => {
  const res = await t
    .http()
    .get(`/v1/me/notifications${query}`)
    .set(...bearer(user))
    .expect(200);
  return res.body;
};

export const bookFor = async (
  t: NotificationsTestApp,
  user: SignedUp,
  space: Space,
  startsAt: Date,
  extra: Record<string, unknown> = {},
) => {
  const res = await t
    .http()
    .post('/v1/bookings')
    .set(...bearer(user))
    .send({
      spaceId: space.id,
      courtId: space.courtA,
      sportId: space.sportId,
      startsAt: startsAt.toISOString(),
      durationMin: 60,
      peopleCount: 2,
      ...extra,
    })
    .expect(201);
  return res.body as { id: string; participants: { inviteToken: string | null }[] };
};
