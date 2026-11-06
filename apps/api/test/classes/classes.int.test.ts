import { addMinutes } from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  classGroups,
  classSessions,
  courtOccupations,
  courtSports,
  courts,
  enrollments,
  recurringBookings,
  spaceMembers,
  spaces,
  sports,
  subscriptions,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space, useMiddayClock } from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';
import {
  classOccupations,
  confirm,
  enroll,
  occupy,
  occurrenceStart,
  sessionsOf,
  sessionTeacherIds,
  slotWeekday,
  teacherMemberId,
  today,
} from './fixtures.js';

// Aulas, tarefa 2.1: professores, turmas fixas, sessões e planos (RF-CLASS-01..03, RN-CLASS-02,
// decisões 25 e 26) e as permissões da matriz de docs/02.

useMiddayClock();

describe('aulas: turmas, sessões e planos', () => {
  let t: TestApp;
  let space: Space;
  let owner: SignedUp;
  let admin: SignedUp;
  let teacher: SignedUp;
  let otherTeacher: SignedUp;
  let player: SignedUp;
  let teacherId: string;
  let otherTeacherId: string;
  let nextHour = 0;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-aulas');
    owner = await member(t, 'dono-aulas@exemplo.com', space.id, 'OWNER');
    admin = await member(t, 'admin-aulas@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'prof-aulas@exemplo.com', space.id, 'TEACHER');
    otherTeacher = await member(t, 'prof2-aulas@exemplo.com', space.id, 'TEACHER');
    player = await signUp(t, 'aluno-aulas@exemplo.com');
    teacherId = await teacherMemberId(t.db, teacher.id, space.id);
    otherTeacherId = await teacherMemberId(t.db, otherTeacher.id, space.id);
  });
  afterAll(() => t.close());

  const url = (path: string, spaceId = space.id) => `/v1/manage/spaces/${spaceId}${path}`;
  const get = (user: SignedUp, path: string) =>
    t
      .http()
      .get(url(path))
      .set(...bearer(user));
  const post = (user: SignedUp, path: string, body: object) =>
    t
      .http()
      .post(url(path))
      .set(...bearer(user))
      .send(body);
  const patch = (user: SignedUp, path: string, body: object) =>
    t
      .http()
      .patch(url(path))
      .set(...bearer(user))
      .send(body);
  const del = (user: SignedUp, path: string) =>
    t
      .http()
      .delete(url(path))
      .set(...bearer(user));

  /** Horário de 1 h sem repetir entre os testes (00:00, 01:00, …) no dia da semana de amanhã. */
  const newTime = () => `${String(nextHour++).padStart(2, '0')}:00`;

  const groupBody = (overrides: Record<string, unknown> = {}) => ({
    name: 'Futevôlei iniciante',
    sportId: space.sportId,
    level: 'BEGINNER',
    teacherMemberIds: [teacherId],
    courtId: space.courtA,
    weekday: slotWeekday(),
    durationMin: 60,
    capacity: 6,
    ...overrides,
    // Só consome um horário novo quando o teste não escolheu um.
    startTime: (overrides.startTime as string | undefined) ?? newTime(),
  });
  /** Horário para requisições que falham antes de olhar a agenda. */
  const ANY_TIME = { startTime: '05:30' };

  async function createGroup(overrides: Record<string, unknown> = {}) {
    const res = await post(admin, '/class-groups', groupBody(overrides)).expect(201);
    return res.body as { id: string; startTime: string; capacity: number };
  }

  /** Quadra nova de futevôlei, com a agenda livre (os testes não disputam os horários de A e B). */
  async function extraCourt(name: string) {
    const court = first(
      await t.db.insert(courts).values({ spaceId: space.id, name }).returning({ id: courts.id }),
    );
    await t.db
      .insert(courtSports)
      .values({ courtId: court.id, sportId: space.sportId, maxPlayers: 4 });
    return court.id;
  }

  /** Outro esporte do catálogo (troca de esporte). */
  async function otherSportId() {
    const [existing] = await t.db.select().from(sports).where(eq(sports.slug, 'beach-tennis'));
    return (
      existing ??
      first(
        await t.db
          .insert(sports)
          .values({ slug: 'beach-tennis', name: 'Beach Tennis' })
          .returning(),
      )
    ).id;
  }

  describe('turmas fixas (RF-CLASS-02)', () => {
    it('cria a turma e gera as sessões das próximas 4 semanas com a quadra ocupada', async () => {
      const body = groupBody();
      const res = await post(admin, '/class-groups', body).expect(201);
      expect(res.body).toMatchObject({
        name: 'Futevôlei iniciante',
        level: 'BEGINNER',
        sport: { id: space.sportId, slug: 'futevolei' },
        teachers: [{ memberId: teacherId, userId: teacher.id }],
        court: { id: space.courtA, name: 'Quadra A' },
        weekday: slotWeekday(),
        startTime: body.startTime,
        capacity: 6,
        active: true,
        enrolledCount: 0,
        availableSpots: 6,
        conflicts: [],
      });

      const sessions = await sessionsOf(t.db, res.body.id);
      expect(sessions.map((s) => s.startsAt.toISOString())).toEqual(
        [0, 1, 2, 3].map((n) => occurrenceStart(n, body.startTime).toISOString()),
      );
      for (const session of sessions) {
        expect(session).toMatchObject({
          capacity: 6,
          courtId: space.courtA,
          status: 'SCHEDULED',
        });
        expect(await sessionTeacherIds(t.db, session.id)).toEqual([teacherId]);
        expect(session.endsAt.getTime() - session.startsAt.getTime()).toBe(60 * 60_000);
      }
      const occupations = await classOccupations(
        t.db,
        sessions.map((s) => s.id),
      );
      expect(occupations).toHaveLength(4);
      const [audit] = await t.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'class_group.create'), eq(auditLogs.entityId, res.body.id)),
        );
      expect(audit?.actorId).toBe(admin.id);
    });

    it('turma inativa não gera sessões', async () => {
      const group = await createGroup({ active: false });
      expect(await sessionsOf(t.db, group.id)).toHaveLength(0);
    });

    it('valida professor, esporte, quadra e duração', async () => {
      const other = await createSpace(t.db, 'arena-aulas-vizinha');
      const foreign = await member(t, 'prof-vizinho@exemplo.com', other.id, 'TEACHER');
      const foreignId = await teacherMemberId(t.db, foreign.id, other.id);
      let res = await post(
        admin,
        '/class-groups',
        groupBody({ ...ANY_TIME, teacherMemberIds: [foreignId] }),
      );
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('TEACHER_NOT_FOUND');

      res = await post(admin, '/class-groups', groupBody({ ...ANY_TIME, courtId: other.courtA }));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('COURT_NOT_FOUND');

      res = await post(
        admin,
        '/class-groups',
        groupBody({ ...ANY_TIME, sportId: crypto.randomUUID() }),
      );
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SPORT_NOT_FOUND');

      res = await post(admin, '/class-groups', groupBody({ ...ANY_TIME, durationMin: 45 }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    describe('conflito de agenda', () => {
      it('com outra turma ativa no mesmo horário semanal', async () => {
        const group = await createGroup();
        const res = await post(
          admin,
          '/class-groups',
          groupBody({ startTime: addHalfHour(group.startTime) }),
        ).expect(409);
        expect(res.body.error).toMatchObject({
          code: 'CLASS_SCHEDULE_CONFLICT',
          details: { conflictsWith: 'CLASS_GROUP', refId: group.id },
        });
        // Horário adjacente ou outra quadra: sem conflito.
        await post(
          admin,
          '/class-groups',
          groupBody({ startTime: addHour(group.startTime) }),
        ).expect(201);
        nextHour++;
        await post(
          admin,
          '/class-groups',
          groupBody({ startTime: group.startTime, courtId: space.courtB }),
        ).expect(201);
      });

      it('com mensalista ativo ou pausado', async () => {
        const startTime = newTime();
        const [recurring] = await t.db
          .insert(recurringBookings)
          .values({
            spaceId: space.id,
            courtId: space.courtA,
            sportId: space.sportId,
            guestName: 'Mensalista',
            guestPhone: '+5531988887777',
            weekday: slotWeekday(),
            startTime,
            durationMin: 60,
            peopleCount: 4,
            startsOn: today(),
            status: 'PAUSED',
          })
          .returning();
        const res = await post(admin, '/class-groups', groupBody({ startTime })).expect(409);
        expect(res.body.error.details).toEqual({
          conflictsWith: 'RECURRING_BOOKING',
          refId: recurring?.id,
        });
      });

      it('com bloqueio ou reserva numa das próximas sessões (nada é criado)', async () => {
        const startTime = newTime();
        const start = occurrenceStart(2, startTime);
        await occupy(t.db, space.courtA, start, addMinutes(start, 30), 'BLOCK');
        const res = await post(admin, '/class-groups', groupBody({ startTime })).expect(409);
        expect(res.body.error.details).toEqual({
          conflictsWith: 'BLOCK',
          startsAt: start.toISOString(),
        });
        expect(
          await t.db
            .select()
            .from(classGroups)
            .where(
              and(eq(classGroups.spaceId, space.id), eq(classGroups.startTime, `${startTime}:00`)),
            ),
        ).toHaveLength(0);

        const bookingTime = newTime();
        const bookingStart = occurrenceStart(0, bookingTime);
        await occupy(t.db, space.courtA, bookingStart, addMinutes(bookingStart, 60));
        const booking = await post(admin, '/class-groups', groupBody({ startTime: bookingTime }));
        expect(booking.status).toBe(409);
        expect(booking.body.error.details.conflictsWith).toBe('BOOKING');
      });

      it('duas turmas no mesmo horário ao mesmo tempo: só uma entra', async () => {
        const startTime = newTime();
        const results = await Promise.all([
          post(admin, '/class-groups', groupBody({ startTime })),
          post(owner, '/class-groups', groupBody({ startTime, name: 'Concorrente' })),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      });

      it('reativar a turma revalida o horário', async () => {
        const group = await createGroup({ active: false });
        // Outra turma ocupa o horário enquanto esta está inativa.
        await createGroup({ startTime: group.startTime });
        const res = await patch(admin, `/class-groups/${group.id}`, { active: true }).expect(409);
        expect(res.body.error.code).toBe('CLASS_SCHEDULE_CONFLICT');
      });
    });

    it('editar o horário regenera só as sessões futuras sem confirmações', async () => {
      const group = await createGroup();
      const before = await sessionsOf(t.db, group.id);
      const kept = before[1];
      if (!kept) throw new Error('sessão não gerada');
      await confirm(t.db, kept.id, player.id);

      const startTime = newTime();
      const res = await patch(admin, `/class-groups/${group.id}`, {
        startTime,
        capacity: 8,
      }).expect(200);
      expect(res.body).toMatchObject({ startTime, capacity: 8 });

      const after = await sessionsOf(t.db, group.id);
      expect(after).toHaveLength(4);
      const byId = new Map(after.map((s) => [s.id, s]));
      // A sessão com confirmação fica no horário e na capacidade antigos.
      expect(byId.get(kept.id)).toMatchObject({ startsAt: kept.startsAt, capacity: 6 });
      const regenerated = after.filter((s) => s.id !== kept.id);
      expect(regenerated.map((s) => s.startsAt.toISOString())).toEqual(
        [0, 2, 3].map((n) => occurrenceStart(n, startTime).toISOString()),
      );
      for (const session of regenerated) expect(session.capacity).toBe(8);
      // As ocupações antigas sumiram; as novas e a da sessão mantida estão ativas.
      expect(
        await classOccupations(
          t.db,
          after.map((s) => s.id),
        ),
      ).toHaveLength(4);
      expect(
        await classOccupations(
          t.db,
          before.filter((s) => s.id !== kept.id).map((s) => s.id),
        ),
      ).toHaveLength(0);
    });

    it('trocar professor e capacidade atualiza as sessões sem regenerar nem revalidar a agenda', async () => {
      const group = await createGroup();
      const before = await sessionsOf(t.db, group.id);
      const [, confirmed, adjusted, flagged] = before;
      if (!confirmed || !adjusted || !flagged) throw new Error('sessões não geradas');
      await confirm(t.db, confirmed.id, player.id);
      await patch(admin, `/class-sessions/${adjusted.id}`, { capacity: 10 }).expect(200);
      // Como o job deixa uma data que não coube: sem sessão e com um bloqueio no horário.
      await t.db
        .delete(courtOccupations)
        .where(and(eq(courtOccupations.kind, 'CLASS'), eq(courtOccupations.refId, flagged.id)));
      await t.db.delete(classSessions).where(eq(classSessions.id, flagged.id));
      await occupy(t.db, space.courtA, flagged.startsAt, flagged.endsAt, 'BLOCK');

      const res = await patch(admin, `/class-groups/${group.id}`, {
        teacherMemberIds: [otherTeacherId],
        capacity: 9,
      }).expect(200);
      expect(res.body).toMatchObject({ teachers: [{ memberId: otherTeacherId }], capacity: 9 });

      const after = await sessionsOf(t.db, group.id);
      // Mesmas sessões (nada regenerado, a data bloqueada segue sem sessão).
      expect(after.map((s) => s.id)).toEqual(before.slice(0, 3).map((s) => s.id));
      const byId = new Map(after.map((s) => [s.id, s]));
      expect(byId.get(before[0]?.id ?? '')).toMatchObject({ capacity: 9 });
      expect(await sessionTeacherIds(t.db, before[0]?.id ?? '')).toEqual([otherTeacherId]);
      // Com confirmação: fica como estava.
      expect(byId.get(confirmed.id)).toMatchObject({ capacity: 6 });
      expect(await sessionTeacherIds(t.db, confirmed.id)).toEqual([teacherId]);
      // Capacidade ajustada à mão: mantida; o professor muda.
      expect(byId.get(adjusted.id)).toMatchObject({ capacity: 10 });
      expect(await sessionTeacherIds(t.db, adjusted.id)).toEqual([otherTeacherId]);
      expect(
        await classOccupations(
          t.db,
          after.map((s) => s.id),
        ),
      ).toHaveLength(3);

      // Mudar o horário continua estrito.
      const slot = await patch(admin, `/class-groups/${group.id}`, {
        startTime: addHalfHour(group.startTime),
      }).expect(409);
      expect(slot.body.error.code).toBe('CLASS_SCHEDULE_CONFLICT');
    });

    it('reativar revalida professor e quadra', async () => {
      const courtId = await extraCourt('Quadra reativação');
      const group = await createGroup({ active: false, courtId, startTime: '12:00' });
      const removeTeacher = (status: 'ACTIVE' | 'REMOVED') =>
        t.db.update(spaceMembers).set({ status }).where(eq(spaceMembers.id, otherTeacherId));
      await patch(admin, `/class-groups/${group.id}`, {
        teacherMemberIds: [otherTeacherId],
      }).expect(200);

      await removeTeacher('REMOVED');
      try {
        const res = await patch(admin, `/class-groups/${group.id}`, { active: true }).expect(422);
        expect(res.body.error.code).toBe('TEACHER_NOT_FOUND');
      } finally {
        await removeTeacher('ACTIVE');
      }

      const setCourt = (status: 'ACTIVE' | 'MAINTENANCE') =>
        t.db.update(courts).set({ status }).where(eq(courts.id, courtId));
      await setCourt('MAINTENANCE');
      try {
        const res = await patch(admin, `/class-groups/${group.id}`, { active: true }).expect(422);
        expect(res.body.error.code).toBe('COURT_UNAVAILABLE');
      } finally {
        await setCourt('ACTIVE');
      }

      await t.db
        .delete(courtSports)
        .where(and(eq(courtSports.courtId, courtId), eq(courtSports.sportId, space.sportId)));
      try {
        const res = await patch(admin, `/class-groups/${group.id}`, { active: true }).expect(422);
        expect(res.body.error.code).toBe('SPORT_NOT_OFFERED');
      } finally {
        await t.db.insert(courtSports).values({ courtId, sportId: space.sportId, maxPlayers: 4 });
      }

      await patch(admin, `/class-groups/${group.id}`, { active: true }).expect(200);
      expect(await sessionsOf(t.db, group.id)).toHaveLength(4);
    });

    it('turma e tirada do papel de Professor ao mesmo tempo: nunca as duas', async () => {
      const temp = await member(t, 'prof-temp-aulas@exemplo.com', space.id, 'TEACHER');
      const tempId = await teacherMemberId(t.db, temp.id, space.id);
      const courtId = await extraCourt('Quadra concorrência');
      for (let round = 0; round < 3; round++) {
        await t.db
          .update(spaceMembers)
          .set({ status: 'ACTIVE' })
          .where(eq(spaceMembers.id, tempId));
        const [created, removed] = await Promise.all([
          post(
            admin,
            '/class-groups',
            groupBody({ teacherMemberIds: [tempId], courtId, startTime: '12:00' }),
          ),
          del(owner, `/team/members/${temp.id}`),
        ]);
        // Ou a turma entra e a remoção é recusada, ou a remoção passa e a turma é recusada.
        expect([created.status, removed.status].sort()).toEqual(
          created.status === 201 ? [201, 409] : [204, 422],
        );
        if (created.status === 201) {
          expect(removed.body.error.code).toBe('TEACHER_HAS_CLASS_GROUPS');
          await del(admin, `/class-groups/${created.body.id}`).expect(204);
        } else {
          expect(created.body.error.code).toBe('TEACHER_NOT_FOUND');
        }
      }
    });

    it('trocar o esporte com alunos matriculados é recusado', async () => {
      const group = await createGroup({
        courtId: await extraCourt('Quadra troca de esporte'),
        startTime: '12:00',
      });
      const otherSport = await otherSportId();
      await enroll(t.db, {
        userId: player.id,
        spaceId: space.id,
        sportId: space.sportId,
        classGroupId: group.id,
      });
      const res = await patch(admin, `/class-groups/${group.id}`, { sportId: otherSport }).expect(
        409,
      );
      expect(res.body.error).toMatchObject({
        code: 'SPORT_CHANGE_NOT_ALLOWED',
        details: { enrolledCount: 1 },
      });
    });

    it('nome e nível não mexem nas sessões', async () => {
      const group = await createGroup();
      const before = await sessionsOf(t.db, group.id);
      await patch(admin, `/class-groups/${group.id}`, { name: 'Avançado', level: null }).expect(
        200,
      );
      expect((await sessionsOf(t.db, group.id)).map((s) => s.id)).toEqual(before.map((s) => s.id));
    });

    describe('matrículas ativas (RN-CLASS-02)', () => {
      it('capacidade abaixo das matrículas, desativar e excluir são recusados', async () => {
        const group = await createGroup({ capacity: 2 });
        const student = await signUp(t, `aluno-${group.id}@exemplo.com`);
        await enroll(t.db, {
          userId: student.id,
          spaceId: space.id,
          sportId: space.sportId,
          classGroupId: group.id,
        });
        await enroll(t.db, {
          userId: player.id,
          spaceId: space.id,
          sportId: space.sportId,
          classGroupId: group.id,
        });

        const detail = await get(admin, `/class-groups/${group.id}`).expect(200);
        expect(detail.body).toMatchObject({ enrolledCount: 2, availableSpots: 0 });

        let res = await patch(admin, `/class-groups/${group.id}`, { capacity: 1 }).expect(409);
        expect(res.body.error).toMatchObject({
          code: 'CAPACITY_BELOW_ENROLLMENTS',
          details: { enrolledCount: 2 },
        });
        res = await patch(admin, `/class-groups/${group.id}`, { active: false }).expect(409);
        expect(res.body.error.code).toBe('CLASS_GROUP_HAS_ACTIVE_ENROLLMENTS');
        res = await del(admin, `/class-groups/${group.id}`).expect(409);
        expect(res.body.error.code).toBe('CLASS_GROUP_HAS_ACTIVE_ENROLLMENTS');

        // Com as matrículas encerradas: desativa, mas não exclui (há histórico).
        await t.db
          .update(enrollments)
          .set({ status: 'ENDED', endedOn: today() })
          .where(eq(enrollments.classGroupId, group.id));
        await patch(admin, `/class-groups/${group.id}`, { active: false }).expect(200);
        expect(await sessionsOf(t.db, group.id)).toHaveLength(0);
        res = await del(admin, `/class-groups/${group.id}`).expect(409);
        expect(res.body.error.code).toBe('CLASS_GROUP_HAS_HISTORY');
      });

      it('exclui a turma sem histórico e libera a quadra', async () => {
        const group = await createGroup();
        const ids = (await sessionsOf(t.db, group.id)).map((s) => s.id);
        await del(admin, `/class-groups/${group.id}`).expect(204);
        expect(
          await t.db.select().from(classGroups).where(eq(classGroups.id, group.id)),
        ).toHaveLength(0);
        expect(await classOccupations(t.db, ids)).toHaveLength(0);
      });

      it('exclusão com sessão confirmada é recusada', async () => {
        const group = await createGroup();
        const [session] = await sessionsOf(t.db, group.id);
        if (!session) throw new Error('sessão não gerada');
        await confirm(t.db, session.id, player.id);
        const res = await del(admin, `/class-groups/${group.id}`).expect(409);
        expect(res.body.error.code).toBe('CLASS_GROUP_HAS_HISTORY');
      });
    });
  });

  describe('quadra com turmas', () => {
    it('inativar com turma ativa e excluir com turma são recusados citando as turmas', async () => {
      const court = { id: await extraCourt('Quadra com turmas') };
      const group = await createGroup({
        courtId: court.id,
        name: 'Turma da quadra',
        startTime: '12:00',
      });

      let res = await patch(owner, `/courts/${court.id}`, { status: 'INACTIVE' }).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'COURT_HAS_CLASS_GROUPS',
        details: { classGroups: [{ id: group.id, name: 'Turma da quadra' }] },
      });
      expect(res.body.error.message).toContain('"Turma da quadra"');
      // Manutenção não é recusada (a quadra volta).
      await patch(owner, `/courts/${court.id}`, { status: 'MAINTENANCE' }).expect(200);
      await patch(owner, `/courts/${court.id}`, { status: 'ACTIVE' }).expect(200);

      res = await del(owner, `/courts/${court.id}`).expect(409);
      expect(res.body.error.code).toBe('COURT_HAS_CLASS_GROUPS');
      expect(res.body.error.message).toContain('"Turma da quadra"');

      // Desativada, a quadra pode ser inativada, mas não excluída (a turma ainda aponta para ela).
      await patch(admin, `/class-groups/${group.id}`, { active: false }).expect(200);
      await patch(owner, `/courts/${court.id}`, { status: 'INACTIVE' }).expect(200);
      res = await del(owner, `/courts/${court.id}`).expect(409);
      expect(res.body.error.details.classGroups).toEqual([
        { id: group.id, name: 'Turma da quadra' },
      ]);

      await del(admin, `/class-groups/${group.id}`).expect(204);
      await del(owner, `/courts/${court.id}`).expect(204);
    });
  });

  describe('sessões', () => {
    it('lista por período e ajusta a capacidade da sessão', async () => {
      const group = await createGroup();
      const res = await get(admin, `/class-sessions?classGroupId=${group.id}`).expect(200);
      expect(res.body).toMatchObject({ from: today(), timeZone: 'America/Sao_Paulo' });
      expect(res.body.items).toHaveLength(4);
      const [first] = res.body.items;
      expect(first).toMatchObject({
        classGroup: { id: group.id },
        court: { id: space.courtA },
        teachers: [{ memberId: teacherId }],
        capacity: 6,
        status: 'SCHEDULED',
        confirmedCount: 0,
        waitlistCount: 0,
      });

      await confirm(t.db, first.id, player.id);
      const below = await patch(admin, `/class-sessions/${first.id}`, { capacity: 0 });
      expect(below.status).toBe(400);
      const updated = await patch(admin, `/class-sessions/${first.id}`, { capacity: 10 }).expect(
        200,
      );
      expect(updated.body).toMatchObject({ capacity: 10, confirmedCount: 1 });
      // A turma não muda.
      expect((await get(admin, `/class-groups/${group.id}`).expect(200)).body.capacity).toBe(6);

      await t.db
        .update(classSessions)
        .set({ status: 'CANCELLED' })
        .where(eq(classSessions.id, first.id));
      const cancelled = await patch(admin, `/class-sessions/${first.id}`, { capacity: 4 }).expect(
        409,
      );
      expect(cancelled.body.error.code).toBe('CLASS_SESSION_NOT_EDITABLE');
    });

    it('capacidade abaixo dos confirmados é recusada (RN-CLASS-03)', async () => {
      const group = await createGroup();
      const [session] = await sessionsOf(t.db, group.id);
      if (!session) throw new Error('sessão não gerada');
      await confirm(t.db, session.id, player.id);
      const other = await signUp(t, `aluno2-${group.id}@exemplo.com`);
      await confirm(t.db, session.id, other.id);
      const res = await patch(admin, `/class-sessions/${session.id}`, { capacity: 1 }).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CAPACITY_BELOW_CONFIRMED',
        details: { confirmedCount: 2 },
      });
    });

    it('limita o período consultado', async () => {
      const res = await get(admin, '/class-sessions?from=2026-01-01&to=2026-06-01').expect(422);
      expect(res.body.error.code).toBe('CLASS_SESSIONS_RANGE_TOO_LONG');
    });
  });

  describe('planos (RF-CLASS-03)', () => {
    it('CRUD com vencimento em dia fixo e frequência nula = ilimitado', async () => {
      const created = await post(admin, '/plans', {
        name: 'Futevôlei ilimitado',
        sportId: space.sportId,
        weeklyFrequency: null,
        priceCents: 25_000,
        billingDay: 5,
      }).expect(201);
      expect(created.body).toMatchObject({
        weeklyFrequency: null,
        priceCents: 25_000,
        billingDay: 5,
        active: true,
        sport: { id: space.sportId },
      });
      const id = created.body.id;

      const invalid = await post(admin, '/plans', {
        name: 'Inválido',
        sportId: space.sportId,
        weeklyFrequency: 2,
        priceCents: 10_000,
        billingDay: 31,
      });
      expect(invalid.status).toBe(400);

      const updated = await patch(admin, `/plans/${id}`, {
        priceCents: 27_000,
      }).expect(200);
      expect(updated.body).toMatchObject({ priceCents: 27_000 });

      const list = await get(admin, '/plans?active=true').expect(200);
      expect(list.body.items.map((p: { id: string }) => p.id)).toContain(id);

      await del(admin, `/plans/${id}`).expect(204);
      await get(admin, `/plans/${id}`).expect(404);
    });

    it('plano com assinatura não é excluído', async () => {
      const group = await createGroup();
      const subscription = await enroll(t.db, {
        userId: player.id,
        spaceId: space.id,
        sportId: space.sportId,
        classGroupId: group.id,
      });
      const res = await del(admin, `/plans/${subscription.planId}`).expect(409);
      expect(res.body.error.code).toBe('PLAN_HAS_SUBSCRIPTIONS');
      await patch(admin, `/plans/${subscription.planId}`, { active: false }).expect(200);
    });
    it('trocar o esporte do plano com assinatura em andamento é recusado', async () => {
      const group = await createGroup({
        courtId: await extraCourt('Quadra plano'),
        startTime: '12:00',
      });
      const otherSport = await otherSportId();
      const subscription = await enroll(t.db, {
        userId: player.id,
        spaceId: space.id,
        sportId: space.sportId,
        classGroupId: group.id,
      });
      const res = await patch(admin, `/plans/${subscription.planId}`, {
        sportId: otherSport,
      }).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'SPORT_CHANGE_NOT_ALLOWED',
        details: { subscriptionCount: 1 },
      });

      // Assinatura encerrada não segura o esporte.
      await t.db
        .update(subscriptions)
        .set({ status: 'CANCELLED' })
        .where(eq(subscriptions.id, subscription.id));
      const updated = await patch(admin, `/plans/${subscription.planId}`, {
        sportId: otherSport,
      }).expect(200);
      expect(updated.body.sport.id).toBe(otherSport);
    });
  });

  describe('página pública (RF-CLASS-04)', () => {
    it('mostra planos e turmas ativos com vagas, só em espaço ACTIVE', async () => {
      const pub = await createSpace(t.db, 'arena-aulas-publica');
      const pubOwner = await member(t, 'dono-publica@exemplo.com', pub.id, 'OWNER');
      const pubTeacher = await member(t, 'prof-publica@exemplo.com', pub.id, 'TEACHER');
      const pubTeacherId = await teacherMemberId(t.db, pubTeacher.id, pub.id);
      const base = `/v1/manage/spaces/${pub.id}`;
      const group = await t
        .http()
        .post(`${base}/class-groups`)
        .set(...bearer(pubOwner))
        .send(
          groupBody({
            startTime: '10:00',
            teacherMemberIds: [pubTeacherId],
            courtId: pub.courtA,
            capacity: 3,
          }),
        )
        .expect(201);
      await t
        .http()
        .post(`${base}/class-groups`)
        .set(...bearer(pubOwner))
        .send(
          groupBody({
            startTime: '10:00',
            teacherMemberIds: [pubTeacherId],
            courtId: pub.courtB,
            active: false,
          }),
        )
        .expect(201);
      await enroll(t.db, {
        userId: player.id,
        spaceId: pub.id,
        sportId: pub.sportId,
        classGroupId: group.body.id,
      });
      // `enroll` cria um plano ativo; mais um inativo, que não aparece.
      await t
        .http()
        .post(`${base}/plans`)
        .set(...bearer(pubOwner))
        .send({
          name: 'Antigo',
          sportId: pub.sportId,
          weeklyFrequency: 3,
          priceCents: 1,
          billingDay: 1,
          active: false,
        })
        .expect(201);

      const res = await t.http().get('/v1/spaces/arena-aulas-publica/classes').expect(200);
      expect(res.body.space).toMatchObject({ id: pub.id, timeZone: 'America/Sao_Paulo' });
      expect(res.body.plans).toHaveLength(1);
      expect(res.body.plans[0]).toMatchObject({ weeklyFrequency: 1 });
      expect(res.body.plans[0]).not.toHaveProperty('active');
      expect(res.body.classGroups).toHaveLength(1);
      expect(res.body.classGroups[0]).toMatchObject({
        id: group.body.id,
        capacity: 3,
        enrolledCount: 1,
        availableSpots: 2,
        teachers: [{ name: expect.any(String) }],
      });
      expect(res.body.classGroups[0].teachers[0]).not.toHaveProperty('userId');

      await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, pub.id));
      const suspended = await t.http().get('/v1/spaces/arena-aulas-publica/classes').expect(404);
      expect(suspended.body.error.code).toBe('SPACE_NOT_FOUND');
    });
  });

  describe('permissões (matriz de docs/02)', () => {
    it('Professor lê; só Dono/Admin gerem turmas e planos', async () => {
      await get(teacher, '/class-groups').expect(200);
      await get(teacher, '/class-sessions').expect(200);
      await get(teacher, '/teachers').expect(200);
      const res = await post(teacher, '/class-groups', groupBody(ANY_TIME));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SPACE_FORBIDDEN');
      await post(teacher, '/plans', {
        name: 'x',
        sportId: space.sportId,
        weeklyFrequency: 1,
        priceCents: 1,
        billingDay: 1,
      }).expect(403);
      await post(owner, '/plans', {
        name: 'Do Dono',
        sportId: space.sportId,
        weeklyFrequency: 1,
        priceCents: 1,
        billingDay: 1,
      }).expect(201);
      await get(player, '/class-groups').expect(403);
    });

    it('o Professor só vê as próprias turmas e sessões', async () => {
      const mine = await createGroup();
      const theirs = await createGroup({ teacherMemberIds: [otherTeacherId] });

      const groups = await get(teacher, '/class-groups').expect(200);
      const ids = groups.body.items.map((g: { id: string }) => g.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(theirs.id);
      expect(
        groups.body.items.every(
          (g: { teachers: { memberId: string }[] }) => g.teachers[0]?.memberId === teacherId,
        ),
      ).toBe(true);
      await get(teacher, `/class-groups/${theirs.id}`).expect(404);
      await get(teacher, `/class-groups/${mine.id}`).expect(200);

      const sessions = await get(teacher, '/class-sessions').expect(200);
      expect(
        sessions.body.items.every(
          (s: { teachers: { memberId: string }[] }) => s.teachers[0]?.memberId === teacherId,
        ),
      ).toBe(true);
      const [theirSession] = await sessionsOf(t.db, theirs.id);
      if (!theirSession) throw new Error('sessão não gerada');
      await get(teacher, `/class-sessions/${theirSession.id}`).expect(404);
      await patch(teacher, `/class-sessions/${theirSession.id}`, { capacity: 3 }).expect(403);

      // Admin que também é Professor vê tudo.
      const all = await get(admin, '/class-groups').expect(200);
      expect(all.body.items.map((g: { id: string }) => g.id)).toContain(theirs.id);
    });

    it('espaço suspenso: leitura liberada, escrita recusada', async () => {
      const frozen = await createSpace(t.db, 'arena-aulas-suspensa');
      const frozenOwner = await member(t, 'dono-suspensa@exemplo.com', frozen.id, 'OWNER');
      await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, frozen.id));
      await t
        .http()
        .get(url('/class-groups', frozen.id))
        .set(...bearer(frozenOwner))
        .expect(200);
      const res = await t
        .http()
        .post(url('/plans', frozen.id))
        .set(...bearer(frozenOwner))
        .send({
          name: 'x',
          sportId: frozen.sportId,
          weeklyFrequency: 1,
          priceCents: 1,
          billingDay: 1,
        })
        .expect(403);
      expect(res.body.error.code).toBe('SPACE_READ_ONLY');
    });
  });

  describe('professores (RF-CLASS-01, decisão 26)', () => {
    it('lista os professores com as turmas ativas de cada um', async () => {
      const res = await get(admin, '/teachers').expect(200);
      const mine = res.body.items.find((i: { memberId: string }) => i.memberId === teacherId);
      expect(mine).toMatchObject({ userId: teacher.id, activeClassGroupCount: expect.any(Number) });
      expect(mine.activeClassGroupCount).toBeGreaterThan(0);
      expect(res.body.items.map((i: { userId: string }) => i.userId)).not.toContain(admin.id);
    });

    it('o mesmo usuário é professor em vários espaços', async () => {
      const second = await createSpace(t.db, 'arena-aulas-segunda');
      const secondOwner = await member(t, 'dono-segunda@exemplo.com', second.id, 'OWNER');
      await t.db.insert(spaceMembers).values({
        userId: teacher.id,
        spaceId: second.id,
        role: 'TEACHER',
        status: 'ACTIVE',
      });
      const secondTeacherId = await teacherMemberId(t.db, teacher.id, second.id);
      expect(secondTeacherId).not.toBe(teacherId);
      await t
        .http()
        .post(url('/class-groups', second.id))
        .set(...bearer(secondOwner))
        .send(
          // Outro dia da semana: o professor já tem turmas no primeiro espaço (decisão 47).
          groupBody({
            startTime: '10:00',
            weekday: (slotWeekday() + 3) % 7,
            teacherMemberIds: [secondTeacherId],
            courtId: second.courtA,
          }),
        )
        .expect(201);
      const list = await t
        .http()
        .get(url('/class-groups', second.id))
        .set(...bearer(teacher))
        .expect(200);
      expect(list.body.items).toHaveLength(1);
      // O vínculo de um espaço não vale no outro.
      const crossed = await post(
        admin,
        '/class-groups',
        groupBody({ ...ANY_TIME, teacherMemberIds: [secondTeacherId] }),
      );
      expect(crossed.body.error.code).toBe('TEACHER_NOT_FOUND');
    });

    it('não tira o papel de Professor de quem dá turma ativa', async () => {
      const res = await t
        .http()
        .put(url(`/team/members/${teacher.id}/roles`))
        .set(...bearer(owner))
        .send({ roles: ['ADMIN'] })
        .expect(409);
      expect(res.body.error.code).toBe('TEACHER_HAS_CLASS_GROUPS');
      await t
        .http()
        .delete(url(`/team/members/${teacher.id}`))
        .set(...bearer(owner))
        .expect(409);

      // Sem turma ativa, sai normalmente.
      const lonely = await member(t, 'prof-sem-turma@exemplo.com', space.id, 'TEACHER');
      await t
        .http()
        .delete(url(`/team/members/${lonely.id}`))
        .set(...bearer(owner))
        .expect(204);
    });
  });

  it('as tabelas de assinatura existem com a regra de uma assinatura aberta por plano', async () => {
    const group = await createGroup();
    const subscription = await enroll(t.db, {
      userId: player.id,
      spaceId: space.id,
      sportId: space.sportId,
      classGroupId: group.id,
    });
    await expect(
      t.db.insert(subscriptions).values({
        userId: player.id,
        planId: subscription.planId,
        spaceId: space.id,
        status: 'PENDING_APPROVAL',
        priceCents: 1,
      }),
    ).rejects.toThrow();
    // A FK composta impede a assinatura em outro espaço com o plano deste.
    const other = await createSpace(t.db, 'arena-aulas-fk');
    await expect(
      t.db.insert(subscriptions).values({
        userId: player.id,
        planId: subscription.planId,
        spaceId: other.id,
        status: 'CANCELLED',
        priceCents: 1,
      }),
    ).rejects.toThrow();
  });
});

function addHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${String((h ?? 0) + 1).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
}

function addHalfHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + 30;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
