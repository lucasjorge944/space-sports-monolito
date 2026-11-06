import { addDays, utcToZoned } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  classSessions,
  courtOccupations,
  spaceSettings,
  spaces,
  subscriptionCharges,
  subscriptions,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space, useMiddayClock } from '../bookings/fixtures.js';
import { auditOf, insertGroup, insertSession, listOf, sessionById } from './attendance-fixtures.js';
import { cancelUntil, enroll, moveToManaus, teacherMemberId } from './fixtures.js';

// Lista de presença, tarefa 2.3 (RF-CLASS-07..10; RN-CLASS-03/04/05/06; decisão 24: sem
// reposição): aluno confirma/desiste, espera com promoção, gestão e permissões da matriz.

useMiddayClock();

type Group = Awaited<ReturnType<typeof insertGroup>>;

describe('lista de presença', () => {
  let t: TestApp;
  let space: Space;
  let admin: SignedUp;
  let teacher: SignedUp;
  let otherTeacher: SignedUp;
  let teacherId: string;
  let otherTeacherId: string;
  let studentSeq = 0;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-presenca');
    admin = await member(t, 'admin-presenca@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'prof-presenca@exemplo.com', space.id, 'TEACHER');
    otherTeacher = await member(t, 'prof2-presenca@exemplo.com', space.id, 'TEACHER');
    teacherId = await teacherMemberId(t.db, teacher.id, space.id);
    otherTeacherId = await teacherMemberId(t.db, otherTeacher.id, space.id);
  });
  afterAll(() => t.close());

  const manage = (path: string) => `/v1/manage/spaces/${space.id}${path}`;
  const as = (user: SignedUp) => ({
    get: (path: string) =>
      t
        .http()
        .get(path)
        .set(...bearer(user)),
    post: (path: string, body: object = {}) =>
      t
        .http()
        .post(path)
        .set(...bearer(user))
        .send(body),
    put: (path: string, body: object) =>
      t
        .http()
        .put(path)
        .set(...bearer(user))
        .send(body),
    patch: (path: string, body: object) =>
      t
        .http()
        .patch(path)
        .set(...bearer(user))
        .send(body),
    delete: (path: string) =>
      t
        .http()
        .delete(path)
        .set(...bearer(user)),
  });

  /** Aluno com assinatura ACTIVE e matrícula na turma (direto no banco). */
  async function student(group: Group, name = `Aluno ${++studentSeq}`) {
    const user = await signUp(t, `aluno-presenca-${++studentSeq}@exemplo.com`, name);
    const subscription = await enroll(t.db, {
      userId: user.id,
      spaceId: space.id,
      sportId: space.sportId,
      classGroupId: group.id,
    });
    return Object.assign(user, { subscriptionId: subscription.id });
  }

  const group = (overrides: Parameters<typeof insertGroup>[3] = {}) =>
    insertGroup(t.db, space, teacherId, overrides);
  /** Sessão com a lista aberta, começando daqui a 3 h. */
  const openSession = (g: Group, overrides: Parameters<typeof insertSession>[3] = {}) =>
    insertSession(t.db, g, 180, { status: 'OPEN', openedAt: new Date(), ...overrides });

  const confirm = (user: SignedUp, sessionId: string) =>
    as(user).post(`/v1/me/class-sessions/${sessionId}/attendance`);
  const withdraw = (user: SignedUp, sessionId: string) =>
    as(user).delete(`/v1/me/class-sessions/${sessionId}/attendance`);

  describe('aluno (RF-CLASS-07/08)', () => {
    it('confirma, vê a lista confirmada e a aula na semana', async () => {
      const g = await group();
      const session = await openSession(g);
      const ana = await student(g, 'Ana');

      const before = await as(ana).get(`/v1/me/class-sessions/${session.id}`).expect(200);
      expect(before.body).toMatchObject({
        myAttendance: null,
        canConfirm: true,
        canWithdraw: false,
        blockedReason: null,
        confirmed: [],
      });

      const res = await confirm(ana, session.id).expect(200);
      expect(res.body).toMatchObject({
        id: session.id,
        status: 'OPEN',
        classGroup: { id: g.id },
        space: { id: space.id, slug: 'arena-presenca', timeZone: 'America/Sao_Paulo' },
        myAttendance: { status: 'CONFIRMED', waitlistPosition: null },
        canConfirm: false,
        canWithdraw: true,
        blockedReason: null,
        confirmedCount: 1,
        confirmed: [{ userId: ana.id, name: 'Ana' }],
      });
      expect(res.body.cancellableUntil).toBe(
        new Date(session.startsAt.getTime() - 120 * 60_000).toISOString(),
      );

      const week = await as(ana).get('/v1/me/class-sessions').expect(200);
      const today = utcToZoned(new Date(), 'America/Sao_Paulo').date;
      expect(week.body.from).toBe(today);
      expect(week.body.to).toBe(addDays(today, 6));
      expect(week.body.items.map((i: { id: string }) => i.id)).toEqual([session.id]);

      await confirm(ana, session.id).expect(409, /ALREADY_IN_SESSION/);
    });

    it('decisão 24: só vê e confirma nas sessões das suas turmas', async () => {
      const g = await group();
      const other = await group();
      const session = await openSession(g);
      const outsider = await student(other);
      const stranger = await signUp(t, 'sem-plano-presenca@exemplo.com');

      await as(outsider).get(`/v1/me/class-sessions/${session.id}`).expect(404);
      await confirm(outsider, session.id).expect(404, /CLASS_SESSION_NOT_FOUND/);
      await confirm(stranger, session.id).expect(404);
      const list = await as(stranger).get('/v1/me/class-sessions').expect(200);
      expect(list.body.items).toEqual([]);
    });

    it('incluído pela gestão vê a aula; depois de sair não confirma (sem matrícula)', async () => {
      const g = await group();
      const session = await openSession(g);
      const guest = await signUp(t, 'reposicao-presenca@exemplo.com');
      await as(admin)
        .post(manage(`/class-sessions/${session.id}/attendances`), { userId: guest.id })
        .expect(201);

      const mine = await as(guest).get(`/v1/me/class-sessions/${session.id}`).expect(200);
      expect(mine.body.myAttendance).toEqual({ status: 'CONFIRMED', waitlistPosition: null });
      await withdraw(guest, session.id).expect(200);
      const after = await as(guest).get(`/v1/me/class-sessions/${session.id}`).expect(200);
      expect(after.body).toMatchObject({ blockedReason: 'NOT_ENROLLED', canConfirm: false });
      await confirm(guest, session.id).expect(403, /NOT_ENROLLED_IN_CLASS/);
    });

    it('RN-CLASS-04: lista agendada, fechada ou aula já começada não aceita confirmação', async () => {
      const g = await group();
      const ana = await student(g);
      const scheduled = await insertSession(t.db, g, 180);
      const closed = await insertSession(t.db, g, 240, { status: 'CLOSED' });
      const started = await insertSession(t.db, g, -10, { status: 'OPEN' });

      for (const session of [scheduled, closed, started]) {
        await confirm(ana, session.id).expect(409, /ATTENDANCE_LIST_NOT_OPEN/);
      }
      const res = await as(ana).get(`/v1/me/class-sessions/${scheduled.id}`).expect(200);
      expect(res.body).toMatchObject({ canConfirm: false, blockedReason: 'LIST_NOT_OPEN' });
    });

    it('RN-CLASS-03: excedentes vão para a espera, com posição', async () => {
      const g = await group({ capacity: 1 });
      const session = await openSession(g);
      const [a, b, c] = [await student(g), await student(g), await student(g)];

      await confirm(a, session.id).expect(200);
      const second = await confirm(b, session.id).expect(200);
      expect(second.body.myAttendance).toEqual({ status: 'WAITLIST', waitlistPosition: 1 });
      expect(second.body.confirmed.map((p: { userId: string }) => p.userId)).toEqual([a.id]);
      const third = await confirm(c, session.id).expect(200);
      expect(third.body).toMatchObject({
        myAttendance: { status: 'WAITLIST', waitlistPosition: 2 },
        confirmedCount: 1,
        waitlistCount: 2,
        canWithdraw: true,
      });
    });

    it('RN-CLASS-05: desistência promove o primeiro da espera e refaz as posições', async () => {
      const g = await group({ capacity: 1 });
      const session = await openSession(g);
      const [a, b, c] = [await student(g), await student(g), await student(g)];
      for (const user of [a, b, c]) await confirm(user, session.id).expect(200);

      const res = await withdraw(a, session.id).expect(200);
      expect(res.body).toMatchObject({ myAttendance: null, canConfirm: true });
      const list = await listOf(t.db, session.id);
      expect(list.get(a.id)).toMatchObject({ status: 'CANCELLED', waitlistPosition: null });
      expect(list.get(b.id)).toMatchObject({ status: 'CONFIRMED', waitlistPosition: null });
      expect(list.get(c.id)).toMatchObject({ status: 'WAITLIST', waitlistPosition: 1 });

      // Quem desistiu e volta entra no fim da fila.
      const back = await confirm(a, session.id).expect(200);
      expect(back.body.myAttendance).toEqual({ status: 'WAITLIST', waitlistPosition: 2 });
      // Sair da espera também refaz as posições.
      await withdraw(c, session.id).expect(200);
      expect((await listOf(t.db, session.id)).get(a.id)?.waitlistPosition).toBe(1);
    });

    it('RN-CLASS-05: confirmado só desiste até attendance_cancel_deadline_min antes', async () => {
      const g = await group({ capacity: 1 });
      // Começa em 90 min; o prazo padrão é 120 min antes.
      const session = await insertSession(t.db, g, 90, { status: 'OPEN' });
      const [a, b] = [await student(g), await student(g)];
      await confirm(a, session.id).expect(200);
      await confirm(b, session.id).expect(200);

      const mine = await as(a).get(`/v1/me/class-sessions/${session.id}`).expect(200);
      expect(mine.body.canWithdraw).toBe(false);
      await withdraw(a, session.id).expect(409, /CANCEL_DEADLINE_PASSED/);
      // Na espera pode sair a qualquer momento antes do início.
      await withdraw(b, session.id).expect(200);
      await withdraw(b, session.id).expect(409, /NOT_IN_SESSION/);
    });

    it('RN-CLASS-08: com o cancelamento pedido, não confirma aula depois de ends_on', async () => {
      const g = await group();
      const session = await openSession(g);
      const ending = await student(g);
      const date = utcToZoned(session.startsAt, 'America/Sao_Paulo').date;
      await cancelUntil(t.db, ending.subscriptionId, addDays(date, -1));

      const res = await as(ending).get(`/v1/me/class-sessions/${session.id}`).expect(200);
      expect(res.body).toMatchObject({
        canConfirm: false,
        blockedReason: 'SUBSCRIPTION_ACCESS_ENDED',
      });
      await confirm(ending, session.id).expect(403, /SUBSCRIPTION_ACCESS_ENDED/);
    });

    it('RN-CLASS-08: ends_on no dia da aula ainda confirma', async () => {
      const g = await group();
      const session = await openSession(g);
      const lastDay = await student(g);
      const date = utcToZoned(session.startsAt, 'America/Sao_Paulo').date;
      await cancelUntil(t.db, lastDay.subscriptionId, date);

      const res = await as(lastDay).get(`/v1/me/class-sessions/${session.id}`).expect(200);
      expect(res.body).toMatchObject({ canConfirm: true, blockedReason: null });
      await confirm(lastDay, session.id).expect(200);
    });

    it('fim do acesso e atraso usam o "hoje" e a data da aula no fuso do espaço (Manaus, perto da meia-noite)', async () => {
      const north = await createSpace(t.db, 'arena-presenca-manaus');
      await moveToManaus(t.db, north.id);
      const teacherHere = await member(t, 'prof-presenca-manaus@exemplo.com', north.id, 'TEACHER');
      const g = await insertGroup(
        t.db,
        north,
        await teacherMemberId(t.db, teacherHere.id, north.id),
      );
      const previous = new Date();
      // 00:30 de 11/11 em BH = 23:30 de 10/11 em Manaus.
      vi.setSystemTime(new Date('2026-11-11T03:30:00Z'));
      try {
        // 23:50 de 10/11 em Manaus (00:50 de 11/11 em BH).
        const session = await openSession(g, {
          startsAt: new Date('2026-11-11T03:50:00Z'),
          endsAt: new Date('2026-11-11T04:50:00Z'),
        });
        const studentHere = async () => {
          const user = await signUp(t, `aluno-presenca-${++studentSeq}@exemplo.com`);
          const sub = await enroll(t.db, {
            userId: user.id,
            spaceId: north.id,
            sportId: north.sportId,
            classGroupId: g.id,
          });
          return Object.assign(user, { subscriptionId: sub.id });
        };
        const [ending, lastDay, dueDay8, dueDay7] = [
          await studentHere(),
          await studentHere(),
          await studentHere(),
          await studentHere(),
        ];
        // A aula cai em 10/11 no fuso do espaço: o acesso até 10/11 ainda a cobre; até 09/11, não.
        await cancelUntil(t.db, ending.subscriptionId, '2026-11-09');
        await cancelUntil(t.db, lastDay.subscriptionId, '2026-11-10');
        const charge = (subscriptionId: string, dueDate: string) => ({
          subscriptionId,
          periodStart: addDays(dueDate, -30),
          periodEnd: dueDate,
          dueDate,
          amountCents: 15_000,
          status: 'OVERDUE' as const,
        });
        // Hoje é 10/11 em Manaus: vencida em 03/11 está no 7º dia (libera); em 02/11, no 8º.
        await t.db
          .insert(subscriptionCharges)
          .values([
            charge(dueDay7.subscriptionId, '2026-11-03'),
            charge(dueDay8.subscriptionId, '2026-11-02'),
          ]);

        const res = await as(ending).get(`/v1/me/class-sessions/${session.id}`).expect(200);
        expect(res.body.blockedReason).toBe('SUBSCRIPTION_ACCESS_ENDED');
        await confirm(ending, session.id).expect(403, /SUBSCRIPTION_ACCESS_ENDED/);
        await confirm(lastDay, session.id).expect(200);
        await confirm(dueDay8, session.id).expect(403, /SUBSCRIPTION_PAST_DUE/);
        await confirm(dueDay7, session.id).expect(200);
      } finally {
        vi.setSystemTime(previous);
      }
    });

    describe('RN-CLASS-06: mensalidade em atraso', () => {
      it('PAST_DUE ou vencida há mais de past_due_block_days bloqueia; em dia não', async () => {
        const g = await group();
        const session = await openSession(g);
        const pastDue = await student(g);
        const overdue = await student(g);
        const recent = await student(g);
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
        await t.db
          .insert(subscriptionCharges)
          .values([
            charge(overdue.subscriptionId, addDays(today, -8)),
            charge(recent.subscriptionId, addDays(today, -3)),
          ]);

        await confirm(pastDue, session.id).expect(403, /SUBSCRIPTION_PAST_DUE/);
        await confirm(overdue, session.id).expect(403, /SUBSCRIPTION_PAST_DUE/);
        const res = await as(overdue).get(`/v1/me/class-sessions/${session.id}`).expect(200);
        expect(res.body.blockedReason).toBe('SUBSCRIPTION_PAST_DUE');
        await confirm(recent, session.id).expect(200);
      });

      it('com a regra desligada pelo espaço, confirma', async () => {
        const isolated = await createSpace(t.db, 'arena-presenca-sem-bloqueio');
        const teacherHere = await member(
          t,
          'prof-sem-bloqueio@exemplo.com',
          isolated.id,
          'TEACHER',
        );
        await t.db
          .update(spaceSettings)
          .set({ pastDueBlockEnabled: false })
          .where(eq(spaceSettings.spaceId, isolated.id));
        const g = await insertGroup(
          t.db,
          isolated,
          await teacherMemberId(t.db, teacherHere.id, isolated.id),
        );
        const session = await openSession(g);
        const user = await signUp(t, 'atrasado-liberado@exemplo.com');
        const sub = await enroll(t.db, {
          userId: user.id,
          spaceId: isolated.id,
          sportId: isolated.sportId,
          classGroupId: g.id,
        });
        await t.db
          .update(subscriptions)
          .set({ status: 'PAST_DUE' })
          .where(eq(subscriptions.id, sub.id));
        await confirm(user, session.id).expect(200);
      });
    });

    it('espaço suspenso: só leitura', async () => {
      const isolated = await createSpace(t.db, 'arena-presenca-suspensa');
      const teacherHere = await member(t, 'prof-suspensa@exemplo.com', isolated.id, 'TEACHER');
      const g = await insertGroup(
        t.db,
        isolated,
        await teacherMemberId(t.db, teacherHere.id, isolated.id),
      );
      const session = await openSession(g);
      const user = await signUp(t, 'aluno-suspensa@exemplo.com');
      await enroll(t.db, {
        userId: user.id,
        spaceId: isolated.id,
        sportId: isolated.sportId,
        classGroupId: g.id,
      });
      await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, isolated.id));
      await as(user).get(`/v1/me/class-sessions/${session.id}`).expect(200);
      await confirm(user, session.id).expect(403, /SPACE_READ_ONLY/);
    });
  });

  describe('concorrência (RN-CLASS-03)', () => {
    it('na última vaga, só um confirma; os demais entram na espera com posições distintas', async () => {
      const g = await group({ capacity: 1 });
      const session = await openSession(g);
      const users = await Promise.all([1, 2, 3, 4, 5].map(() => student(g)));

      const results = await Promise.all(users.map((user) => confirm(user, session.id)));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      const list = [...(await listOf(t.db, session.id)).values()];
      expect(list.filter((row) => row.status === 'CONFIRMED')).toHaveLength(1);
      expect(
        list
          .filter((row) => row.status === 'WAITLIST')
          .map((row) => row.waitlistPosition)
          .sort(),
      ).toEqual([1, 2, 3, 4]);
    });

    it('desistências simultâneas promovem a espera na ordem, sem passar da capacidade', async () => {
      const g = await group({ capacity: 2 });
      const session = await openSession(g);
      const [a, b, c, d, e] = [
        await student(g),
        await student(g),
        await student(g),
        await student(g),
        await student(g),
      ];
      for (const user of [a, b, c, d, e]) await confirm(user, session.id).expect(200);

      await Promise.all([withdraw(a, session.id), withdraw(b, session.id)]);
      const list = await listOf(t.db, session.id);
      expect(list.get(c.id)?.status).toBe('CONFIRMED');
      expect(list.get(d.id)?.status).toBe('CONFIRMED');
      expect(list.get(e.id)).toMatchObject({ status: 'WAITLIST', waitlistPosition: 1 });
    });

    it('desistência e inclusão pela gestão ao mesmo tempo não estouram a capacidade', async () => {
      const g = await group({ capacity: 1 });
      const session = await openSession(g);
      const [a, b] = [await student(g), await student(g)];
      const guest = await signUp(t, 'balcao-concorrente@exemplo.com');
      await confirm(a, session.id).expect(200);
      await confirm(b, session.id).expect(200);

      await Promise.all([
        withdraw(a, session.id),
        as(admin).post(manage(`/class-sessions/${session.id}/attendances`), { userId: guest.id }),
      ]);
      const rows = [...(await listOf(t.db, session.id)).values()];
      expect(rows.filter((row) => row.status === 'CONFIRMED')).toHaveLength(1);
      expect(
        rows.filter((row) => row.status === 'WAITLIST').map((r) => r.waitlistPosition),
      ).toEqual([1]);
    });
  });

  describe('choque de horário (RN-CLASS-01, decisão 37)', () => {
    let other: Space;
    let otherTeacherMemberId: string;

    beforeAll(async () => {
      other = await createSpace(t.db, 'arena-presenca-vizinha');
      const prof = await member(t, 'prof-presenca-vizinha@exemplo.com', other.id, 'TEACHER');
      otherTeacherMemberId = await teacherMemberId(t.db, prof.id, other.id);
    });

    /** Turma do outro espaço, com o aluno matriculado também lá. */
    async function otherGroup(capacity = 10) {
      return insertGroup(t.db, other, otherTeacherMemberId, { name: 'Vizinha', capacity });
    }
    async function enrollThere(user: SignedUp, g: Group) {
      await enroll(t.db, {
        userId: user.id,
        spaceId: other.id,
        sportId: other.sportId,
        classGroupId: g.id,
      });
    }

    it('confirmado numa aula não confirma outra no mesmo horário, nem de outro espaço', async () => {
      const g = await group();
      const here = await openSession(g);
      const ana = await student(g);
      const og = await otherGroup();
      await enrollThere(ana, og);
      const there = await openSession(og);
      const later = await insertSession(t.db, og, 180 + 61, {
        status: 'OPEN',
        openedAt: new Date(),
      });

      await confirm(ana, here.id).expect(200);
      const detail = await as(ana).get(`/v1/me/class-sessions/${there.id}`).expect(200);
      expect(detail.body).toMatchObject({ canConfirm: false, blockedReason: 'SCHEDULE_OVERLAP' });
      const res = await confirm(ana, there.id).expect(409);
      expect(res.body.error.details.conflict).not.toHaveProperty('status');
      expect(res.body.error).toMatchObject({
        code: 'CLASS_SESSION_OVERLAP',
        details: {
          conflict: {
            classGroupName: g.name,
            spaceName: 'Espaço arena-presenca',
            startsAt: here.startsAt.toISOString(),
            endsAt: here.endsAt.toISOString(),
          },
        },
      });
      // Aula seguinte (sem sobreposição) confirma.
      await confirm(ana, later.id).expect(200);

      // Desistiu: o horário fica livre.
      await withdraw(ana, here.id).expect(200);
      const freed = await as(ana).get(`/v1/me/class-sessions/${there.id}`).expect(200);
      expect(freed.body).toMatchObject({ canConfirm: true, blockedReason: null });
      await confirm(ana, there.id).expect(200);
    });

    it('a espera também ocupa o horário, então a promoção não cria choque', async () => {
      const g = await group({ capacity: 1 });
      const here = await openSession(g);
      const [first, bia] = [await student(g), await student(g)];
      await confirm(first, here.id).expect(200);
      const waiting = await confirm(bia, here.id).expect(200);
      expect(waiting.body.myAttendance).toMatchObject({ status: 'WAITLIST' });

      const og = await otherGroup();
      await enrollThere(bia, og);
      const there = await openSession(og);
      const res = await confirm(bia, there.id).expect(409);
      // Sem a situação do aluno na lista da outra aula (o espaço dela não a vê).
      expect(res.body.error.details.conflict).toEqual({
        classGroupName: expect.any(String),
        spaceName: expect.any(String),
        startsAt: expect.any(String),
        endsAt: expect.any(String),
      });

      // A vaga abre: Bia é promovida e continua só nesta aula.
      await withdraw(first, here.id).expect(200);
      const list = await listOf(t.db, here.id);
      expect(list.get(bia.id)?.status).toBe('CONFIRMED');
      expect((await listOf(t.db, there.id)).get(bia.id)).toBeUndefined();
    });

    it('a gestão não inclui o aluno numa aula que choca com outra dele', async () => {
      const g = await group();
      const here = await openSession(g);
      const caio = await student(g);
      await confirm(caio, here.id).expect(200);
      const og = await otherGroup();
      const there = await openSession(og);
      const owner = await member(t, 'dono-presenca-vizinha@exemplo.com', other.id, 'OWNER');
      const res = await as(owner)
        .post(`/v1/manage/spaces/${other.id}/class-sessions/${there.id}/attendances`, {
          userId: caio.id,
        })
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CLASS_SESSION_OVERLAP',
        details: { conflict: { spaceName: 'Espaço arena-presenca' } },
      });
    });

    it('duas confirmações simultâneas em espaços diferentes no mesmo horário: só uma passa', async () => {
      for (let round = 0; round < 3; round++) {
        const g = await group();
        const here = await openSession(g);
        const dani = await student(g);
        const og = await otherGroup();
        await enrollThere(dani, og);
        const there = await openSession(og);

        const results = await Promise.all([confirm(dani, here.id), confirm(dani, there.id)]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        const held = [
          (await listOf(t.db, here.id)).get(dani.id),
          (await listOf(t.db, there.id)).get(dani.id),
        ].filter(Boolean);
        expect(held).toHaveLength(1);
      }
    });
  });

  describe('gestão (RF-CLASS-09)', () => {
    it('abre, fecha e reabre a lista em qualquer modo, com auditoria', async () => {
      await t.db
        .update(spaceSettings)
        .set({ attendanceMode: 'MANUAL' })
        .where(eq(spaceSettings.spaceId, space.id));
      try {
        const g = await group();
        const session = await insertSession(t.db, g, 180);
        const opened = await as(admin)
          .post(manage(`/class-sessions/${session.id}/open`))
          .expect(200);
        expect(opened.body).toMatchObject({ status: 'OPEN', closedAt: null });
        expect(opened.body.openedAt).toBeTruthy();
        await as(admin)
          .post(manage(`/class-sessions/${session.id}/open`))
          .expect(409, /CLASS_SESSION_STATUS_CONFLICT/);
        const closed = await as(teacher)
          .post(manage(`/class-sessions/${session.id}/close`))
          .expect(200);
        expect(closed.body.status).toBe('CLOSED');
        await as(teacher)
          .post(manage(`/class-sessions/${session.id}/close`))
          .expect(409);
        await as(teacher)
          .post(manage(`/class-sessions/${session.id}/open`))
          .expect(200);

        const actions = (await auditOf(t.db, session.id)).map((row) => [row.action, row.actorId]);
        expect(actions).toEqual(
          expect.arrayContaining([
            ['class_session.open', admin.id],
            ['class_session.close', teacher.id],
            ['class_session.reopen', teacher.id],
          ]),
        );
        expect((await sessionById(t.db, session.id)).openedBy).toBe(teacher.id);
      } finally {
        await t.db
          .update(spaceSettings)
          .set({ attendanceMode: null })
          .where(eq(spaceSettings.spaceId, space.id));
      }
    });

    it('aula encerrada não reabre', async () => {
      const g = await group();
      const session = await insertSession(t.db, g, -120, { status: 'DONE' });
      await as(admin)
        .post(manage(`/class-sessions/${session.id}/open`))
        .expect(409);
    });

    it('detalhe com a lista e os matriculados', async () => {
      const g = await group({ capacity: 1 });
      const session = await openSession(g);
      const [a, b] = [await student(g, 'Bia'), await student(g, 'Caio')];
      await confirm(a, session.id).expect(200);
      await confirm(b, session.id).expect(200);

      const res = await as(admin)
        .get(manage(`/class-sessions/${session.id}`))
        .expect(200);
      expect(res.body).toMatchObject({
        id: session.id,
        status: 'OPEN',
        confirmedCount: 1,
        waitlistCount: 1,
        attendances: [
          {
            userId: a.id,
            name: 'Bia',
            status: 'CONFIRMED',
            waitlistPosition: null,
            addedByStaff: false,
          },
          { userId: b.id, name: 'Caio', status: 'WAITLIST', waitlistPosition: 1 },
        ],
      });
      expect(res.body.enrolledStudents).toEqual([
        { userId: a.id, name: 'Bia', avatarUrl: null, subscriptionStatus: 'ACTIVE' },
        { userId: b.id, name: 'Caio', avatarUrl: null, subscriptionStatus: 'ACTIVE' },
      ]);
    });

    it('adiciona acima da capacidade na espera e remove promovendo a espera', async () => {
      const g = await group({ capacity: 1 });
      const session = await insertSession(t.db, g, 180);
      const a = await student(g);
      const guest = await signUp(t, 'reposicao2-presenca@exemplo.com');

      // A gestão inclui mesmo com a lista ainda agendada.
      await as(teacher)
        .post(manage(`/class-sessions/${session.id}/attendances`), { userId: a.id })
        .expect(201);
      const added = await as(admin)
        .post(manage(`/class-sessions/${session.id}/attendances`), { userId: guest.id })
        .expect(201);
      expect(added.body.attendances).toMatchObject([
        { userId: a.id, status: 'CONFIRMED', addedByStaff: true },
        { userId: guest.id, status: 'WAITLIST', waitlistPosition: 1, addedByStaff: true },
      ]);
      await as(admin)
        .post(manage(`/class-sessions/${session.id}/attendances`), { userId: guest.id })
        .expect(409, /ALREADY_IN_SESSION/);
      await as(admin)
        .post(manage(`/class-sessions/${session.id}/attendances`), {
          userId: crypto.randomUUID(),
        })
        .expect(422, /USER_NOT_FOUND/);

      const removed = await as(admin)
        .delete(manage(`/class-sessions/${session.id}/attendances/${a.id}`))
        .expect(200);
      expect(removed.body.attendances).toMatchObject([
        { userId: guest.id, status: 'CONFIRMED', waitlistPosition: null },
      ]);
      await as(admin)
        .delete(manage(`/class-sessions/${session.id}/attendances/${a.id}`))
        .expect(409, /NOT_IN_SESSION/);
      const actions = (await auditOf(t.db, session.id)).map((row) => row.action);
      expect(actions.filter((a) => a === 'class_attendance.add')).toHaveLength(2);
      expect(actions).toContain('class_attendance.remove');
    });

    it('presença real só depois do início; vale para lista e matriculados', async () => {
      const g = await group({ capacity: 1 });
      const future = await openSession(g);
      const a = await student(g);
      await as(teacher)
        .put(manage(`/class-sessions/${future.id}/presence`), {
          items: [{ userId: a.id, status: 'PRESENT' }],
        })
        .expect(409, /PRESENCE_TOO_EARLY/);

      const started = await insertSession(t.db, g, -30, { status: 'CLOSED' });
      const b = await student(g);
      const c = await student(g);
      const outsider = await signUp(t, 'nao-matriculado-presenca@exemplo.com');
      await as(admin)
        .post(manage(`/class-sessions/${started.id}/attendances`), { userId: a.id })
        .expect(201);
      await as(admin)
        .post(manage(`/class-sessions/${started.id}/attendances`), { userId: b.id })
        .expect(201);

      await as(teacher)
        .put(manage(`/class-sessions/${started.id}/presence`), {
          items: [{ userId: outsider.id, status: 'PRESENT' }],
        })
        .expect(422, /STUDENT_NOT_IN_SESSION/);
      const res = await as(teacher)
        .put(manage(`/class-sessions/${started.id}/presence`), {
          items: [
            { userId: a.id, status: 'ABSENT' },
            { userId: b.id, status: 'PRESENT' },
            { userId: c.id, status: 'PRESENT' },
          ],
        })
        .expect(200);
      const byUser = new Map(
        res.body.attendances.map((row: { userId: string; status: string }) => [row.userId, row]),
      );
      expect(byUser.get(a.id)).toMatchObject({ status: 'ABSENT' });
      expect(byUser.get(b.id)).toMatchObject({ status: 'PRESENT', waitlistPosition: null });
      expect(byUser.get(c.id)).toMatchObject({ status: 'PRESENT' });
      expect(await auditOf(t.db, started.id, 'class_attendance.presence')).toHaveLength(1);

      // Depois de encerrada também dá para corrigir.
      await t.db
        .update(classSessions)
        .set({ status: 'DONE' })
        .where(eq(classSessions.id, started.id));
      await as(admin)
        .put(manage(`/class-sessions/${started.id}/presence`), {
          items: [{ userId: a.id, status: 'PRESENT' }],
        })
        .expect(200);
    });

    it('presença marcada ocupa vaga: não sai, não libera vaga e segura a capacidade', async () => {
      const g = await group({ capacity: 2 });
      const started = await insertSession(t.db, g, -30, { status: 'CLOSED' });
      const [a, b, c] = [await student(g), await student(g), await student(g)];
      const d = await signUp(t, 'avulso-ocupacao-presenca@exemplo.com');
      for (const user of [a, b, c]) {
        await as(admin)
          .post(manage(`/class-sessions/${started.id}/attendances`), { userId: user.id })
          .expect(201);
      }
      await as(teacher)
        .put(manage(`/class-sessions/${started.id}/presence`), {
          items: [{ userId: b.id, status: 'PRESENT' }],
        })
        .expect(200);

      // Quem já tem presença marcada não sai da aula.
      await as(admin)
        .delete(manage(`/class-sessions/${started.id}/attendances/${b.id}`))
        .expect(409, /PRESENCE_ALREADY_MARKED/);
      // A (confirmado) + B (presente) ocupam as 2 vagas: D vai para a espera.
      const added = await as(admin)
        .post(manage(`/class-sessions/${started.id}/attendances`), { userId: d.id })
        .expect(201);
      expect(added.body).toMatchObject({ confirmedCount: 2, waitlistCount: 2 });
      expect(added.body.attendances).toContainEqual(
        expect.objectContaining({ userId: d.id, status: 'WAITLIST', waitlistPosition: 2 }),
      );
      await as(admin)
        .patch(manage(`/class-sessions/${started.id}`), { capacity: 1 })
        .expect(409, /CAPACITY_BELOW_CONFIRMED/);

      // Com a aula em andamento, a vaga liberada (remoção ou aumento) não promove a espera.
      const removed = await as(admin)
        .delete(manage(`/class-sessions/${started.id}/attendances/${a.id}`))
        .expect(200);
      expect(removed.body).toMatchObject({ confirmedCount: 1, waitlistCount: 2 });
      await as(admin)
        .patch(manage(`/class-sessions/${started.id}`), { capacity: 4 })
        .expect(200);
      const list = await listOf(t.db, started.id);
      expect(list.get(b.id)).toMatchObject({ status: 'PRESENT' });
      expect(list.get(c.id)).toMatchObject({ status: 'WAITLIST', waitlistPosition: 1 });
      expect(list.get(d.id)).toMatchObject({ status: 'WAITLIST', waitlistPosition: 2 });
      expect(await auditOf(t.db, started.id, 'class_attendance.remove')).toMatchObject([
        { diff: { userId: a.id, before: 'CONFIRMED', promoted: [] } },
      ]);

      // A visão de equipe conta o presente como vaga ocupada.
      const staff = await as(admin).get('/v1/me/staff-spaces').expect(200);
      const today = staff.body.items
        .find((item: { space: { id: string } }) => item.space.id === space.id)
        .today.classSessions.find((s: { id: string }) => s.id === started.id);
      expect(today).toMatchObject({ capacity: 4, confirmedCount: 1, waitlistCount: 2 });
    });

    it('cancela a aula com motivo: libera a quadra e trava a lista', async () => {
      const g = await group();
      const session = await insertSession(
        t.db,
        g,
        60 * 24 * 3,
        { status: 'OPEN' },
        { occupy: true },
      );
      const a = await student(g);
      await confirm(a, session.id).expect(200);

      await as(teacher)
        .post(manage(`/class-sessions/${session.id}/cancel`), { reason: 'Chuva' })
        .expect(403);
      const res = await as(admin)
        .post(manage(`/class-sessions/${session.id}/cancel`), { reason: 'Feriado' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Feriado' });
      expect(res.body.cancelledAt).toBeTruthy();
      const [occupation] = await t.db
        .select()
        .from(courtOccupations)
        .where(eq(courtOccupations.refId, session.id));
      expect(occupation?.active).toBe(false);
      expect(await auditOf(t.db, session.id, 'class_session.cancel')).toHaveLength(1);

      await as(admin)
        .post(manage(`/class-sessions/${session.id}/cancel`), { reason: 'De novo' })
        .expect(409, /CLASS_SESSION_STATUS_CONFLICT/);
      await withdraw(a, session.id).expect(409, /ATTENDANCE_LIST_NOT_OPEN/);
      const mine = await as(a).get('/v1/me/class-sessions').expect(200);
      expect(mine.body.items.find((i: { id: string }) => i.id === session.id)).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Feriado',
      });
    });

    it('troca o professor só desta aula e aumentar a capacidade promove a espera', async () => {
      const g = await group({ capacity: 1 });
      const session = await openSession(g);
      const [a, b] = [await student(g), await student(g)];
      await confirm(a, session.id).expect(200);
      await confirm(b, session.id).expect(200);

      const res = await as(admin)
        .patch(manage(`/class-sessions/${session.id}`), {
          teacherMemberIds: [otherTeacherId],
          capacity: 2,
        })
        .expect(200);
      expect(res.body).toMatchObject({
        teachers: [{ memberId: otherTeacherId }],
        capacity: 2,
        confirmedCount: 2,
        waitlistCount: 0,
      });
      expect(await auditOf(t.db, session.id, 'class_session.teacher_change')).toHaveLength(1);
      // O professor antigo deixa de ver; o novo opera.
      await as(teacher)
        .get(manage(`/class-sessions/${session.id}`))
        .expect(404);
      await as(otherTeacher)
        .post(manage(`/class-sessions/${session.id}/close`))
        .expect(200);

      await as(admin)
        .patch(manage(`/class-sessions/${session.id}`), { teacherMemberIds: [crypto.randomUUID()] })
        .expect(422, /TEACHER_NOT_FOUND/);
      await as(admin)
        .patch(manage(`/class-sessions/${session.id}`), { capacity: 1 })
        .expect(409, /CAPACITY_BELOW_CONFIRMED/);
      await as(teacher)
        .patch(manage(`/class-sessions/${session.id}`), { capacity: 3 })
        .expect(403);
    });
  });

  describe('permissões (matriz de docs/02)', () => {
    it('Professor só opera as próprias sessões; aluno não entra', async () => {
      const mine = await group();
      const others = await insertGroup(t.db, space, otherTeacherId);
      const own = await insertSession(t.db, mine, 180);
      const foreign = await insertSession(t.db, others, 180);
      const player = await signUp(t, 'aluno-sem-vinculo-presenca@exemplo.com');

      await as(teacher)
        .post(manage(`/class-sessions/${own.id}/open`))
        .expect(200);
      await as(teacher)
        .post(manage(`/class-sessions/${foreign.id}/open`))
        .expect(404);
      await as(teacher)
        .get(manage(`/class-sessions/${foreign.id}`))
        .expect(404);
      await as(teacher)
        .post(manage(`/class-sessions/${foreign.id}/attendances`), { userId: player.id })
        .expect(404);

      await as(admin)
        .get(manage(`/class-sessions/${foreign.id}`))
        .expect(200);

      await as(player)
        .get(manage(`/class-sessions/${foreign.id}`))
        .expect(403);
      await as(admin)
        .post(manage(`/class-sessions/${foreign.id}/open`))
        .expect(200);
    });
  });

  describe('histórico e frequência', () => {
    it('histórico por aluno e frequência da turma contam só as aulas dadas', async () => {
      const g = await group();
      const [a, b] = [await student(g, 'Duda'), await student(g, 'Edu')];
      const done1 = await insertSession(t.db, g, -60 * 24 * 2, { status: 'DONE' });
      const done2 = await insertSession(t.db, g, -60 * 24, { status: 'DONE' });
      await insertSession(t.db, g, -60 * 24 * 3, { status: 'CANCELLED' });
      const upcoming = await openSession(g);
      for (const s of [done1, done2]) {
        await as(admin)
          .put(manage(`/class-sessions/${s.id}/presence`), {
            items: [
              { userId: a.id, status: 'PRESENT' },
              { userId: b.id, status: s.id === done1.id ? 'ABSENT' : 'PRESENT' },
            ],
          })
          .expect(200);
      }
      await confirm(a, upcoming.id).expect(200);

      const today = utcToZoned(new Date(), 'America/Sao_Paulo').date;
      const history = await as(admin)
        .get(manage(`/class-attendances?userId=${b.id}&to=${addDays(today, 1)}`))
        .expect(200);
      expect(history.body.items.map((i: { session: { id: string } }) => i.session.id)).toEqual([
        done2.id,
        done1.id,
      ]);
      expect(history.body.summary).toEqual({
        present: 1,
        absent: 1,
        unmarked: 0,
        attendanceRate: 0.5,
      });

      const all = await as(teacher)
        .get(manage(`/class-attendances?classGroupId=${g.id}&to=${addDays(today, 1)}`))
        .expect(200);
      expect(all.body.items).toHaveLength(5);

      const freq = await as(teacher)
        .get(manage(`/class-groups/${g.id}/frequency?to=${addDays(today, 1)}`))
        .expect(200);
      expect(freq.body).toMatchObject({
        classGroup: { id: g.id },
        sessionsDone: 2,
        sessionsCancelled: 1,
        totals: { present: 3, absent: 1, unmarked: 0, attendanceRate: 0.75 },
        students: [
          { userId: a.id, name: 'Duda', enrolled: true, present: 2, absent: 0, attendanceRate: 1 },
          { userId: b.id, name: 'Edu', enrolled: true, present: 1, absent: 1, attendanceRate: 0.5 },
        ],
      });

      await as(otherTeacher)
        .get(manage(`/class-groups/${g.id}/frequency`))
        .expect(404);
      await as(admin)
        .get(manage('/class-attendances'))
        .expect(422, /ATTENDANCE_FILTER_REQUIRED/);
      await as(admin)
        .get(manage(`/class-attendances?userId=${a.id}&from=2025-01-01&to=2026-12-31`))
        .expect(422, /ATTENDANCE_RANGE_TOO_LONG/);
    });
  });

  describe('visão de equipe no app (somente leitura)', () => {
    it('aulas de hoje com as listas; o Professor só vê as dele', async () => {
      const isolated = await createSpace(t.db, 'arena-presenca-equipe');
      const owner = await member(t, 'dono-equipe-presenca@exemplo.com', isolated.id, 'OWNER');
      const prof = await member(t, 'prof-equipe-presenca@exemplo.com', isolated.id, 'TEACHER');
      const prof2 = await member(t, 'prof2-equipe-presenca@exemplo.com', isolated.id, 'TEACHER');
      const g1 = await insertGroup(
        t.db,
        isolated,
        await teacherMemberId(t.db, prof.id, isolated.id),
      );
      const g2 = await insertGroup(
        t.db,
        isolated,
        await teacherMemberId(t.db, prof2.id, isolated.id),
      );
      // 12:10 local + 3 h = ainda hoje.
      const s1 = await openSession(g1);
      const s2 = await insertSession(t.db, g2, 120);
      await insertSession(t.db, g1, 60 * 24 * 2);
      const user = await signUp(t, 'aluno-equipe-presenca@exemplo.com', 'Fábio');
      await enroll(t.db, {
        userId: user.id,
        spaceId: isolated.id,
        sportId: isolated.sportId,
        classGroupId: g1.id,
      });
      await confirm(user, s1.id).expect(200);

      const ownerView = await as(owner).get('/v1/me/staff-spaces').expect(200);
      const sessions = ownerView.body.items[0].today.classSessions;
      expect(sessions.map((s: { id: string }) => s.id)).toEqual([s2.id, s1.id]);
      expect(sessions[1]).toMatchObject({
        status: 'OPEN',
        confirmedCount: 1,
        attendees: [
          { userId: user.id, name: 'Fábio', status: 'CONFIRMED', waitlistPosition: null },
        ],
      });
      expect(sessions[1]).not.toHaveProperty('priceCents');

      const profView = await as(prof).get('/v1/me/staff-spaces').expect(200);
      expect(profView.body.items[0].today.classSessions.map((s: { id: string }) => s.id)).toEqual([
        s1.id,
      ]);
    });
  });
});
