import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountDeletionRequests,
  auditLogs,
  bookings,
  devices,
  recurringBookings,
  sessions,
  spaceMembers,
  users,
} from '../../src/db/schema/index.js';
import { SuperUsersService } from '../../src/super/users.service.js';
import { anonymizeUser } from '../../src/users/anonymize.js';
import {
  bearer,
  createSpace,
  member,
  type Space,
  slotIn,
  useMiddayClock,
} from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';
import { slotWeekday } from '../recurring/fixtures.js';
import {
  createTestApp,
  makeSuper,
  PASSWORD,
  type SignedUp,
  signUp,
  type TestApp,
  WEB_ORIGIN,
} from './helpers.js';

// RF-AUTH-03 (decisão 29): o app só inativa a conta (POST /v1/me/deactivate). Encerra as sessões,
// apaga os dispositivos de push e bloqueia o login; não anonimiza nem cancela nada. Só o Super reativa.

useMiddayClock();

describe('inativação da conta pelo titular', () => {
  let t: TestApp;
  let space: Space;
  let manager: SignedUp;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-inativacao');
    manager = await member(t, 'gestor@exemplo.com', space.id, 'ADMIN');
  });
  afterAll(() => t.close());

  const deactivate = (user: SignedUp) =>
    t
      .http()
      .post('/v1/me/deactivate')
      .set(...bearer(user))
      .send();

  const signIn = (email: string) =>
    t.http().post('/v1/auth/sign-in/email').send({ email, password: PASSWORD });

  const userRow = async (id: string) =>
    first(await t.db.select().from(users).where(eq(users.id, id)));

  const activeOwners = async (id: string) =>
    t.db
      .select({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.spaceId, id),
          eq(spaceMembers.role, 'OWNER'),
          eq(spaceMembers.status, 'ACTIVE'),
        ),
      );

  /**
   * Segura as linhas dos usuários numa transação à parte até a função devolvida ser chamada. As
   * inativações travam a linha do titular logo antes da checagem do último Dono; liberadas
   * juntas, as duas checagens correm ao mesmo tempo.
   */
  async function holdUsers(ids: string[]) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = t.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(inArray(users.id, ids)).for('update');
      locked();
      await released;
    });
    await isLocked;
    return async () => {
      release();
      await holder;
    };
  }

  /** Espera `count` conexões bloqueadas em trava de linha (as inativações na fila), com prazo. */
  async function waitForLockWaiters(count: number, timeoutMs = 2_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { rows } = await t.db.execute<{ waiting: number }>(sql`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`);
      if ((rows[0]?.waiting ?? 0) >= count) return;
      if (Date.now() > deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it('marca INACTIVE, encerra as sessões, apaga os dispositivos e audita, sem apagar dados', async () => {
    const user = await member(t, 'professor@exemplo.com', space.id, 'TEACHER');
    // Segunda sessão (outro aparelho): também cai.
    const other = await signIn(user.email).expect(200);
    // Dispositivos de push dos dois aparelhos: a conta inativa não recebe push.
    await t.db.insert(devices).values([
      { userId: user.id, expoPushToken: 'ExponentPushToken[inativacao-1]', platform: 'ANDROID' },
      { userId: user.id, expoPushToken: 'ExponentPushToken[inativacao-2]', platform: 'IOS' },
    ]);

    await deactivate(user).expect(204);

    const row = await userRow(user.id);
    expect(row).toMatchObject({
      status: 'INACTIVE',
      email: 'professor@exemplo.com',
      name: 'Jogador Teste',
      deletedAt: null,
    });
    expect(await t.db.select().from(sessions).where(eq(sessions.userId, user.id))).toEqual([]);
    expect(await t.db.select().from(devices).where(eq(devices.userId, user.id))).toEqual([]);
    await t
      .http()
      .get('/v1/me')
      .set(...bearer(user))
      .expect(401);
    await t
      .http()
      .get('/v1/me')
      .set('authorization', `Bearer ${other.headers['set-auth-token']}`)
      .expect(401);

    // O vínculo com o espaço continua (o espaço trata a equipe).
    const [membership] = await t.db
      .select({ status: spaceMembers.status })
      .from(spaceMembers)
      .where(eq(spaceMembers.userId, user.id));
    expect(membership?.status).toBe('ACTIVE');
    // Inativar não é pedido de exclusão (LGPD).
    expect(
      await t.db
        .select()
        .from(accountDeletionRequests)
        .where(eq(accountDeletionRequests.userId, user.id)),
    ).toEqual([]);

    const [log] = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, user.id), eq(auditLogs.action, 'user.deactivate')));
    expect(log).toMatchObject({
      actorId: user.id,
      spaceId: null,
      actingAsSuper: false,
      diff: { sessionsEnded: 2, devicesRemoved: 2 },
    });
  });

  it('o login por e-mail responde 403 ACCOUNT_INACTIVE', async () => {
    const user = await signUp(t, 'login-inativo@exemplo.com');
    await deactivate(user).expect(204);

    const res = await signIn(user.email).expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
    expect(res.body.error.message).toMatch(/inativa/i);
    expect(await t.db.select().from(sessions).where(eq(sessions.userId, user.id))).toEqual([]);
  });

  it('sessão que sobrou de uma conta inativa recebe 403 ACCOUNT_INACTIVE nas rotas', async () => {
    const user = await signUp(t, 'sessao-sobrando@exemplo.com');
    await t.db.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, user.id));
    const res = await t
      .http()
      .get('/v1/me')
      .set(...bearer(user))
      .expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('não cancela reservas nem mensalistas', async () => {
    const player = await signUp(t, 'agenda@exemplo.com', 'Agenda');
    const desk = await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/bookings`)
      .set(...bearer(manager))
      .send({
        courtId: space.courtA,
        sportId: space.sportId,
        startsAt: slotIn(60).toISOString(),
        durationMin: 30,
        peopleCount: 2,
        customerUserId: player.id,
      })
      .expect(201);
    const recurring = await t
      .http()
      .post('/v1/recurring-bookings')
      .set(...bearer(player))
      .send({
        spaceId: space.id,
        courtId: space.courtB,
        sportId: space.sportId,
        weekday: slotWeekday(),
        startTime: '19:00',
        durationMin: 30,
        peopleCount: 4,
      })
      .expect(201);

    await deactivate(player).expect(204);

    const [booking] = await t.db
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, desk.body.id));
    expect(booking?.status).toBe('CONFIRMED');
    const [plan] = await t.db
      .select({ status: recurringBookings.status })
      .from(recurringBookings)
      .where(eq(recurringBookings.id, recurring.body.id));
    expect(plan?.status).toBe(recurring.body.status);
    // A gestão segue agendando para o cliente inativo (o espaço trata a agenda).
    await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/bookings`)
      .set(...bearer(manager))
      .send({
        courtId: space.courtA,
        sportId: space.sportId,
        startsAt: slotIn(180).toISOString(),
        durationMin: 30,
        peopleCount: 2,
        customerUserId: player.id,
      })
      .expect(201);
  });

  it('pelo web (cookie + Origin) também inativa', async () => {
    const user = await signUp(t, 'web@exemplo.com');
    await t
      .http()
      .post('/v1/me/deactivate')
      .set('cookie', user.cookie)
      .set('origin', WEB_ORIGIN)
      .send()
      .expect(204);
    expect((await userRow(user.id)).status).toBe('INACTIVE');
  });

  it('exige login', async () => {
    const res = await t.http().post('/v1/me/deactivate').send().expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('conta bloqueada não chega a inativar (403 USER_BLOCKED)', async () => {
    const user = await signUp(t, 'bloqueado@exemplo.com');
    // O bloqueio pelo Super encerra as sessões; aqui a sessão sobra para exercitar a trava.
    await t.db.update(users).set({ status: 'BLOCKED' }).where(eq(users.id, user.id));
    const res = await deactivate(user).expect(403);
    expect(res.body.error.code).toBe('USER_BLOCKED');
    expect((await userRow(user.id)).status).toBe('BLOCKED');
  });

  it('conta Super não se inativa pelo app', async () => {
    const admin = await signUp(t, 'super@exemplo.com');
    await makeSuper(t.db, admin.id);
    const res = await deactivate(admin).expect(409);
    expect(res.body.error.code).toBe('SUPER_ACCOUNT');
    expect((await userRow(admin.id)).status).toBe('ACTIVE');
  });

  it('o único Dono ativo de um espaço não inativa; com outro Dono ativo, inativa', async () => {
    const solo = await createSpace(t.db, 'arena-dono-unico');
    const owner = await member(t, 'dono@exemplo.com', solo.id, 'OWNER');

    const res = await deactivate(owner).expect(409);
    expect(res.body.error.code).toBe('LAST_OWNER');
    expect((await userRow(owner.id)).status).toBe('ACTIVE');
    // Nada muda: a sessão continua valendo.
    await t
      .http()
      .get('/v1/me')
      .set(...bearer(owner))
      .expect(200);

    // Dono removido, com conta inativa ou bloqueada não conta como outro Dono.
    const removed = await signUp(t, 'ex-dono@exemplo.com');
    await t.db
      .insert(spaceMembers)
      .values({ userId: removed.id, spaceId: solo.id, role: 'OWNER', status: 'REMOVED' });
    const inactive = await member(t, 'dono-inativo@exemplo.com', solo.id, 'OWNER');
    await t.db.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, inactive.id));
    const blocked = await member(t, 'dono-bloqueado@exemplo.com', solo.id, 'OWNER');
    await t.db.update(users).set({ status: 'BLOCKED' }).where(eq(users.id, blocked.id));
    await deactivate(owner).expect(409);

    await member(t, 'socio@exemplo.com', solo.id, 'OWNER');
    await deactivate(owner).expect(204);
    expect((await userRow(owner.id)).status).toBe('INACTIVE');
  });

  it('dois Donos inativando ao mesmo tempo: só um sai e o espaço segue com Dono ativo', async () => {
    const shared = await createSpace(t.db, 'arena-dois-donos');
    const a = await member(t, 'dono-a@exemplo.com', shared.id, 'OWNER');
    const b = await member(t, 'dono-b@exemplo.com', shared.id, 'OWNER');

    const release = await holdUsers([a.id, b.id]);
    const results = Promise.all([deactivate(a), deactivate(b)]);
    try {
      await waitForLockWaiters(2);
    } finally {
      await release();
    }

    const responses = await results;
    expect(responses.map((res) => res.status).sort()).toEqual([204, 409]);
    expect(responses.find((res) => res.status === 409)?.body.error.code).toBe('LAST_OWNER');
    const survivor = responses[0]?.status === 409 ? a : b;
    expect((await userRow(survivor.id)).status).toBe('ACTIVE');
    expect(await activeOwners(shared.id)).toHaveLength(2);
  });

  it('POST /v1/auth/delete-user fica desligado: nada é apagado', async () => {
    const user = await signUp(t, 'excluir@exemplo.com');
    const res = await t
      .http()
      .post('/v1/auth/delete-user')
      .set(...bearer(user))
      .send({});
    expect(res.status).toBe(404);
    const row = await userRow(user.id);
    expect(row).toMatchObject({ status: 'ACTIVE', deletedAt: null, email: user.email });
    await t
      .http()
      .get('/v1/me')
      .set(...bearer(user))
      .expect(200);
  });

  it('o atendimento LGPD pelo Super cancela as reservas futuras (decisão 40) e anonimiza', async () => {
    const player = await signUp(t, 'lgpd@exemplo.com', 'LGPD');
    const desk = await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/bookings`)
      .set(...bearer(manager))
      .send({
        courtId: space.courtB,
        sportId: space.sportId,
        startsAt: slotIn(240).toISOString(),
        durationMin: 30,
        peopleCount: 2,
        customerUserId: player.id,
      })
      .expect(201);
    const admin = await signUp(t, 'super-lgpd@exemplo.com');
    await makeSuper(t.db, admin.id);
    const [request] = await t.db
      .insert(accountDeletionRequests)
      .values({ userId: player.id, source: 'SUPER' })
      .returning({ id: accountDeletionRequests.id });
    if (!request) throw new Error('Pedido sem retorno.');

    await t.app.get(SuperUsersService).fulfillDeletionRequest(admin.id, request.id);

    expect((await userRow(player.id)).deletedAt).toBeInstanceOf(Date);
    const [booking] = await t.db
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, desk.body.id));
    expect(booking?.status).toBe('CANCELLED');
  });

  it('a anonimização (atendimento LGPD pelo Super) segue encerrando os vínculos', async () => {
    const user = await member(t, 'anonimizar@exemplo.com', space.id, 'ADMIN');
    const now = new Date();
    expect(await anonymizeUser(t.db, user.id, now)).toBe(true);
    const memberships = await t.db
      .select({ status: spaceMembers.status, updatedAt: spaceMembers.updatedAt })
      .from(spaceMembers)
      .where(eq(spaceMembers.userId, user.id));
    expect(memberships).toEqual([{ status: 'REMOVED', updatedAt: now }]);
    // Já excluída: nada muda.
    expect(await anonymizeUser(t.db, user.id)).toBe(false);
  });
});
