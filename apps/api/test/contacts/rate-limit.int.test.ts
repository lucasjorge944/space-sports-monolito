import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PUBLIC_INVITE_LIMITS } from '../../src/bookings/public-invites.controller.js';
import { CONFIRM_LINK_LIMIT } from '../../src/contacts/contact-links.service.js';
import { UNSUBSCRIBE_LIMIT } from '../../src/contacts/contacts.controller.js';
import {
  PHONE_LOOKUP_KEY_PREFIX,
  PHONE_LOOKUP_LIMITS,
} from '../../src/contacts/phone-suggestions.service.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  member,
  type Space,
  slotIn,
  useMiddayClock,
} from '../bookings/fixtures.js';
import { book, guests, invite, myDetail, tokenOf, verifyPhone } from './helpers.js';

const REDIS_IMAGE = 'redis:7-alpine';

useMiddayClock();

describe('limites de taxa dos contatos', () => {
  let container: StartedTestContainer;
  let redis: Redis;
  let t: TestApp;
  let space: Space;
  let organizer: SignedUp;
  let hours = 24;
  const nextHours = () => {
    hours += 2;
    return hours;
  };

  beforeAll(async () => {
    container = await new GenericContainer(REDIS_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();
    const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
    redis = new Redis(url);
    t = await createTestApp({ env: { REDIS_URL: url, AUTH_RATE_LIMIT_ENABLED: 'true' } });
    space = await createSpace(t.db, 'arena-limites');
    organizer = await signUp(t, 'organizadora@exemplo.com', 'Organizadora');
  });
  beforeEach(() => redis.flushall());
  afterAll(async () => {
    await t?.close();
    redis?.disconnect();
    await container?.stop();
  });

  const newInvite = async (items: Record<string, unknown>[] = [{}]) => {
    const booking = await book(t, organizer, space, nextHours());
    return { booking, detail: await invite(t, organizer, booking.id, { items }) };
  };
  const preview = (token: string, ip: string) =>
    t.http().get(`/v1/public/invites/${token}`).set('x-forwarded-for', ip);

  describe('rotas públicas do convite', () => {
    it('a prévia para no teto por IP, com X-Retry-After, e outro IP segue', async () => {
      const { detail } = await newInvite();
      const token = tokenOf(detail);
      const { max } = PUBLIC_INVITE_LIMITS.read.ip;
      for (let i = 0; i < max; i++) {
        await preview(`nao-existe-${i}`, '203.0.113.10').expect(404);
      }
      const blocked = await preview(token, '203.0.113.10').expect(429);
      expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
      expect(Number(blocked.headers['x-retry-after'])).toBeGreaterThan(0);
      await preview(token, '203.0.113.11').expect(200);
    });

    it('o token limita o mesmo link aberto de muitos IPs', async () => {
      const { detail } = await newInvite();
      const token = tokenOf(detail);
      const { max } = PUBLIC_INVITE_LIMITS.read.token;
      for (let i = 0; i < max; i++) {
        await preview(token, `198.51.100.${i + 1}`).expect(200);
      }
      await preview(token, '198.51.100.200').expect(429);
    });

    it('confirmar tem teto próprio e o token não fica em claro no Redis', async () => {
      const { detail } = await newInvite();
      const token = tokenOf(detail);
      const post = (ip: string) =>
        t
          .http()
          .post(`/v1/public/invites/${token}/confirm`)
          .set('x-forwarded-for', ip)
          .send({ name: 'Ana', phone: '+5531955550001' });
      const { max } = PUBLIC_INVITE_LIMITS.answer.token;
      for (let i = 0; i < max; i++) {
        await post(`192.0.2.${i + 1}`).expect(200);
      }
      await post('192.0.2.200').expect(429);
      const keys = await redis.keys('*');
      expect(keys.some((key) => key.includes(token))).toBe(false);
    });

    it('recusar conta no mesmo teto de resposta', async () => {
      const { detail } = await newInvite();
      const token = tokenOf(detail);
      const { max } = PUBLIC_INVITE_LIMITS.answer.ip;
      for (let i = 0; i < max; i++) {
        await t
          .http()
          .post(`/v1/public/invites/token-${i}/decline`)
          .set('x-forwarded-for', '203.0.113.13')
          .expect(404);
      }
      await t
        .http()
        .post(`/v1/public/invites/${token}/decline`)
        .set('x-forwarded-for', '203.0.113.13')
        .expect(429);
    });
  });

  it('descadastro é limitado por IP', async () => {
    const post = () =>
      t
        .http()
        .post('/v1/public/contacts/unsubscribe')
        .set('x-forwarded-for', '203.0.113.14')
        .send({ token: 'invalido' });
    for (let i = 0; i < UNSUBSCRIBE_LIMIT.max; i++) await post().expect(422);
    await post().expect(429);
  });

  describe('enumeração de contas pelo telefone', () => {
    const phone = '+5531955550002';
    const phoneMember = (value: string) => createHash('sha256').update(value).digest('hex');
    const fillQuota = async (user: SignedUp, scope: 'organizer' | 'staff', free: number) => {
      const key = `${PHONE_LOOKUP_KEY_PREFIX}${scope}:${user.id}`;
      const count = PHONE_LOOKUP_LIMITS[scope].max - free;
      await redis.sadd(key, ...Array.from({ length: count }, (_, i) => `ocupado-${i}`));
      await redis.expire(key, 3600);
      return key;
    };
    let owner: SignedUp;

    beforeAll(async () => {
      owner = await signUp(t, 'dona@exemplo.com', 'Dona');
      await verifyPhone(t, owner, phone);
    });

    it('acima da cota de telefones, a sugestão some sem erro e não distingue quem tem conta', async () => {
      await fillQuota(organizer, 'organizer', 0);
      const { booking, detail } = await newInvite([{ phone }]);
      expect(guests(detail)[0]?.suggestedUser).toBeNull();
      const after = await myDetail(t, organizer, booking.id);
      expect(guests(after)[0]?.suggestedUser).toBeNull();
    });

    it('rever a mesma reserva não gasta cota; telefone já consultado continua respondendo', async () => {
      const key = await fillQuota(organizer, 'organizer', 1);
      const { booking, detail } = await newInvite([{ phone }]);
      expect(guests(detail)[0]?.suggestedUser?.id).toBe(owner.id);
      expect(await redis.scard(key)).toBe(PHONE_LOOKUP_LIMITS.organizer.max);
      expect(await redis.sismember(key, phoneMember(phone))).toBe(1);

      const again = await myDetail(t, organizer, booking.id);
      expect(guests(again)[0]?.suggestedUser?.id).toBe(owner.id);
      expect(await redis.scard(key)).toBe(PHONE_LOOKUP_LIMITS.organizer.max);
    });

    it('a cota conta consulta sem conta também, e o telefone fica em hash', async () => {
      const key = await fillQuota(organizer, 'organizer', 1);
      await newInvite([{ phone: '+5531955550003' }]);
      // O telefone sem conta levou a última vaga; o da conta já não é consultado.
      const { detail } = await newInvite([{ phone }]);
      expect(guests(detail)[0]?.suggestedUser).toBeNull();
      expect(await redis.scard(key)).toBe(PHONE_LOOKUP_LIMITS.organizer.max);
      expect((await redis.smembers(key)).some((value) => value.includes('55550'))).toBe(false);
    });

    it('a gestão tem a própria cota, na visualização da reserva', async () => {
      const admin = await member(t, 'admin@exemplo.com', space.id, 'ADMIN');
      await fillQuota(admin, 'staff', 0);
      const created = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings`)
        .set(...bearer(admin))
        .send({
          courtId: space.courtB,
          sportId: space.sportId,
          startsAt: slotIn(nextHours() * 60).toISOString(),
          durationMin: 60,
          peopleCount: 2,
          guestName: 'Balcão',
          guestPhone: phone,
        })
        .expect(201);
      const res = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/bookings/${created.body.id}`)
        .set(...bearer(admin))
        .expect(200);
      expect(res.body.suggestedUser).toBeNull();
    });

    it('a confirmação de vínculo também tem teto por pessoa', async () => {
      const { booking, detail } = await newInvite([{ phone }]);
      const guest = guests(detail)[0]?.id ?? '';
      const post = () =>
        t
          .http()
          .post(`/v1/bookings/${booking.id}/invites/${guest}/confirm-link`)
          .set(...bearer(organizer))
          .send({ userId: organizer.id });
      for (let i = 0; i < CONFIRM_LINK_LIMIT.max; i++) await post().expect(409);
      await post().expect(429);
    });
  });
});
