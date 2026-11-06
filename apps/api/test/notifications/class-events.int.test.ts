import { addDays, utcToZoned } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClassSessionLifecycleService } from '../../src/classes/class-session-lifecycle.service.js';
import { subscriptionCharges, subscriptions } from '../../src/db/schema/index.js';
import { type SignedUp, signUp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space, useMiddayClock } from '../bookings/fixtures.js';
import { insertGroup, insertSession } from '../classes/attendance-fixtures.js';
import { cancelUntil, enroll, moveToManaus, teacherMemberId } from '../classes/fixtures.js';
import { createNotificationsApp, type NotificationsTestApp } from './fakes.js';
import { inbox, registerDevice } from './helpers.js';

// RF-NOTIF-01 nas aulas (tarefa 2.3): lista aberta, promovido da espera e aula cancelada.

useMiddayClock();

describe('notificações das aulas', () => {
  let t: NotificationsTestApp;
  let space: Space;
  let admin: SignedUp;
  let teacherId: string;
  let seq = 0;

  beforeAll(async () => {
    t = await createNotificationsApp();
    space = await createSpace(t.db, 'arena-notificacoes-aulas');
    admin = await member(t, 'admin-notif-aulas@exemplo.com', space.id, 'ADMIN');
    const teacher = await member(t, 'prof-notif-aulas@exemplo.com', space.id, 'TEACHER');
    teacherId = await teacherMemberId(t.db, teacher.id, space.id);
  });
  afterAll(() => t.close());

  async function student(group: { id: string }, where: Space = space) {
    const user = await signUp(t, `aluno-notif-aulas-${++seq}@exemplo.com`);
    await registerDevice(t, user, `ExponentPushToken[aluno${seq}]`);
    const sub = await enroll(t.db, {
      userId: user.id,
      spaceId: where.id,
      sportId: where.sportId,
      classGroupId: group.id,
    });
    return Object.assign(user, { subscriptionId: sub.id });
  }
  const types = async (user: SignedUp) => (await inbox(t, user)).items.map((i) => i.type);

  it('lista aberta pelo job avisa os matriculados uma vez (acesso encerrado fica de fora)', async () => {
    const group = await insertGroup(t.db, space, teacherId, { name: 'Futevôlei manhã' });
    const session = await insertSession(t.db, group, 60 * 5);
    const active = await student(group);
    const ended = await student(group);
    await cancelUntil(
      t.db,
      ended.subscriptionId,
      addDays(utcToZoned(session.startsAt, 'America/Sao_Paulo').date, -1),
    );

    const lifecycle = t.app.get(ClassSessionLifecycleService);
    await lifecycle.tick();
    await lifecycle.tick();
    await t.flush();

    const { items } = await inbox(t, active);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'CLASS_LIST_OPEN',
      title: 'Lista de presença aberta',
      data: { classSessionId: session.id, spaceId: space.id },
    });
    expect(items[0]?.body).toContain('Futevôlei manhã · Espaço arena-notificacoes-aulas');
    expect(await types(ended)).toEqual([]);
    expect(t.push.sent).toContainEqual(
      expect.objectContaining({
        to: `ExponentPushToken[aluno${seq - 1}]`,
        data: expect.objectContaining({ type: 'CLASS_LIST_OPEN', classSessionId: session.id }),
      }),
    );
  });

  it('lista aberta não avisa quem não pode confirmar (acesso encerrado, atraso)', async () => {
    const group = await insertGroup(t.db, space, teacherId);
    const session = await insertSession(t.db, group, 60 * 6);
    const [ok, ending, pastDue, overdue, recent] = [
      await student(group),
      await student(group),
      await student(group),
      await student(group),
      await student(group),
    ];
    const date = utcToZoned(session.startsAt, 'America/Sao_Paulo').date;
    await cancelUntil(t.db, ending.subscriptionId, addDays(date, -1));
    await t.db
      .update(subscriptions)
      .set({ status: 'PAST_DUE' })
      .where(eq(subscriptions.id, pastDue.subscriptionId));
    const today = utcToZoned(new Date(), 'America/Sao_Paulo').date;
    const charge = (subscriptionId: string, dueDate: string) => ({
      subscriptionId,
      periodStart: addDays(dueDate, -30),
      periodEnd: dueDate,
      dueDate,
      amountCents: 15_000,
      status: 'OVERDUE' as const,
    });
    // Padrão do espaço: bloqueia com mais de 7 dias de atraso.
    await t.db
      .insert(subscriptionCharges)
      .values([
        charge(overdue.subscriptionId, addDays(today, -8)),
        charge(recent.subscriptionId, addDays(today, -3)),
      ]);

    await t.app.get(ClassSessionLifecycleService).tick();
    await t.flush();

    for (const user of [ok, recent]) expect(await types(user)).toEqual(['CLASS_LIST_OPEN']);
    for (const user of [ending, pastDue, overdue]) expect(await types(user)).toEqual([]);
  });

  it('reabrir não avisa de novo', async () => {
    const group = await insertGroup(t.db, space, teacherId);
    const session = await insertSession(t.db, group, 60 * 30, { status: 'CLOSED' });
    const user = await student(group);
    await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/class-sessions/${session.id}/open`)
      .set(...bearer(admin))
      .expect(200);
    expect(await types(user)).toEqual([]);
  });

  it('desistência avisa quem saiu da espera', async () => {
    const group = await insertGroup(t.db, space, teacherId, { capacity: 1 });
    const session = await insertSession(t.db, group, 60 * 4, { status: 'OPEN' });
    const [a, b] = [await student(group), await student(group)];
    for (const user of [a, b]) {
      await t
        .http()
        .post(`/v1/me/class-sessions/${session.id}/attendance`)
        .set(...bearer(user))
        .expect(200);
    }
    await t
      .http()
      .delete(`/v1/me/class-sessions/${session.id}/attendance`)
      .set(...bearer(a))
      .expect(200);

    const { items } = await inbox(t, b);
    expect(items).toMatchObject([
      {
        type: 'CLASS_WAITLIST_PROMOTED',
        title: 'Vaga confirmada na aula',
        data: { classSessionId: session.id },
      },
    ]);
    expect(await types(a)).toEqual([]);
  });

  it('aula cancelada avisa os matriculados e quem foi incluído, com o motivo', async () => {
    const group = await insertGroup(t.db, space, teacherId);
    const session = await insertSession(t.db, group, 60 * 4, { status: 'OPEN' });
    const enrolled = await student(group);
    const guest = await signUp(t, 'convidado-notif-aulas@exemplo.com');
    await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/class-sessions/${session.id}/attendances`)
      .set(...bearer(admin))
      .send({ userId: guest.id })
      .expect(201);
    await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/class-sessions/${session.id}/cancel`)
      .set(...bearer(admin))
      .send({ reason: 'Chuva forte' })
      .expect(200);

    for (const user of [enrolled, guest]) {
      const { items } = await inbox(t, user);
      expect(items).toMatchObject([
        {
          type: 'CLASS_SESSION_CANCELLED',
          title: 'Aula cancelada',
          data: { classSessionId: session.id },
        },
      ]);
      expect(items[0]?.body).toMatch(/· Chuva forte$/);
    }
    expect(await types(admin)).toEqual([]);
  });

  // Os dois abaixo rodam o job em datas fixas (e encerram as aulas dos testes anteriores).
  it('RN-CLASS-08: acesso até 06/11, aula 06/11 às 07:00 com a lista abrindo 24 h antes: avisa e confirma', async () => {
    const previous = new Date();
    // 07:00 de 05/11 em BH: a lista abre para quem tem acesso no dia da aula.
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    try {
      const group = await insertGroup(t.db, space, teacherId);
      const session = await insertSession(t.db, group, 0, {
        startsAt: new Date('2026-11-06T10:00:00Z'),
        endsAt: new Date('2026-11-06T11:00:00Z'),
      });
      const [lastDay, dayBefore] = [await student(group), await student(group)];
      await cancelUntil(t.db, lastDay.subscriptionId, '2026-11-06');
      await cancelUntil(t.db, dayBefore.subscriptionId, '2026-11-05');

      await t.app.get(ClassSessionLifecycleService).tick();
      await t.flush();

      expect(await types(lastDay)).toEqual(['CLASS_LIST_OPEN']);
      expect(await types(dayBefore)).toEqual([]);
      await t
        .http()
        .post(`/v1/me/class-sessions/${session.id}/attendance`)
        .set(...bearer(lastDay))
        .expect(200);
    } finally {
      vi.setSystemTime(previous);
    }
  });

  it('o atraso do aviso conta o "hoje" no fuso do espaço (Manaus, perto da meia-noite)', async () => {
    const north = await createSpace(t.db, 'arena-notificacoes-manaus');
    await moveToManaus(t.db, north.id);
    const teacherHere = await member(t, 'prof-notif-manaus@exemplo.com', north.id, 'TEACHER');
    const group = await insertGroup(
      t.db,
      north,
      await teacherMemberId(t.db, teacherHere.id, north.id),
    );
    const previous = new Date();
    // 00:30 de 11/11 em BH = 23:30 de 10/11 em Manaus.
    vi.setSystemTime(new Date('2026-11-11T03:30:00Z'));
    try {
      await insertSession(t.db, group, 0, {
        startsAt: new Date('2026-11-11T06:00:00Z'),
        endsAt: new Date('2026-11-11T07:00:00Z'),
      });
      const [dueDay7, dueDay8] = [await student(group, north), await student(group, north)];
      const charge = (subscriptionId: string, dueDate: string) => ({
        subscriptionId,
        periodStart: addDays(dueDate, -30),
        periodEnd: dueDate,
        dueDate,
        amountCents: 15_000,
        status: 'OVERDUE' as const,
      });
      // Hoje é 10/11 em Manaus: vencida em 03/11 está no 7º dia (avisa); em 02/11, no 8º.
      await t.db
        .insert(subscriptionCharges)
        .values([
          charge(dueDay7.subscriptionId, '2026-11-03'),
          charge(dueDay8.subscriptionId, '2026-11-02'),
        ]);

      await t.app.get(ClassSessionLifecycleService).tick();
      await t.flush();

      expect(await types(dueDay7)).toEqual(['CLASS_LIST_OPEN']);
      expect(await types(dueDay8)).toEqual([]);
    } finally {
      vi.setSystemTime(previous);
    }
  });
});
