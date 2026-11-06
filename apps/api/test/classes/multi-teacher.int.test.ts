import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from '../../src/bookings/db-utils.js';
import { lockTeacherSchedule } from '../../src/classes/class-teachers.js';
import {
  auditLogs,
  classGroups,
  classGroupTeachers,
  classSessions,
  classSessionTeachers,
  spaceMembers,
  teacherOccupations,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space, useMiddayClock } from '../bookings/fixtures.js';
import { first, pgError } from '../db/helpers.js';
import { insertSession } from './attendance-fixtures.js';
import {
  enroll,
  moveToManaus,
  occurrenceDate,
  sessionsOf,
  sessionTeacherIds,
  slotWeekday,
  teacherMemberId,
} from './fixtures.js';
import { insertGroup as insertGroupRow } from './subscription-fixtures.js';

// Decisão 47: mais de um professor por aula, com a agenda dele protegida entre espaços. O mesmo
// usuário é professor em A e em B: no mesmo espaço pode sobrepor; em espaços diferentes, não.

useMiddayClock();

type Id = { id: string };
type Group = Id & { teachers: { memberId: string; name: string }[] };

describe('professores das turmas e aulas', () => {
  let t: TestApp;
  let a: Space;
  let b: Space;
  let ownerA: SignedUp;
  let ownerB: SignedUp;
  /** Professor em A e em B. */
  let shared: SignedUp;
  let partner: SignedUp;
  let colleague: SignedUp;
  let sharedInA: string;
  let sharedInB: string;
  let partnerInA: string;
  let colleagueInB: string;
  let nextHour = 0;
  let dayOffset = 0;

  beforeAll(async () => {
    t = await createTestApp();
    a = await createSpace(t.db, 'arena-multi-a');
    b = await createSpace(t.db, 'arena-multi-b');
    ownerA = await member(t, 'dono-a@exemplo.com', a.id, 'OWNER');
    ownerB = await member(t, 'dono-b@exemplo.com', b.id, 'OWNER');
    shared = await member(t, 'prof-dois-espacos@exemplo.com', a.id, 'TEACHER');
    await t.db
      .insert(spaceMembers)
      .values({ userId: shared.id, spaceId: b.id, role: 'TEACHER', status: 'ACTIVE' });
    partner = await member(t, 'prof-parceiro@exemplo.com', a.id, 'TEACHER');
    colleague = await member(t, 'prof-colega@exemplo.com', b.id, 'TEACHER');
    sharedInA = await teacherMemberId(t.db, shared.id, a.id);
    sharedInB = await teacherMemberId(t.db, shared.id, b.id);
    partnerInA = await teacherMemberId(t.db, partner.id, a.id);
    colleagueInB = await teacherMemberId(t.db, colleague.id, b.id);
  });
  afterAll(() => t.close());

  const url = (space: Space, path: string) => `/v1/manage/spaces/${space.id}${path}`;
  const ownerOf = (space: Space) => (space.id === a.id ? ownerA : ownerB);
  const get = (user: SignedUp, space: Space, path: string) =>
    t
      .http()
      .get(url(space, path))
      .set(...bearer(user));
  const post = (space: Space, path: string, body: object = {}, user = ownerOf(space)) =>
    t
      .http()
      .post(url(space, path))
      .set(...bearer(user))
      .send(body);
  const patch = (space: Space, path: string, body: object) =>
    t
      .http()
      .patch(url(space, path))
      .set(...bearer(ownerOf(space)))
      .send(body);

  /** Cada bloco usa um dia da semana, a partir de amanhã: são 24 horários de 1 h por dia. */
  const useDay = (offset: number) => {
    dayOffset = offset;
    nextHour = 0;
  };

  /** Horário de 1 h sem repetir entre os testes do bloco. */
  const newTime = () => `${String(nextHour++).padStart(2, '0')}:00`;
  const laterHour = (time: string, hours = 1) =>
    `${String(Number(time.slice(0, 2)) + hours).padStart(2, '0')}:00`;

  const groupBody = (
    space: Space,
    teacherMemberIds: string[],
    startTime: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    name: `Turma ${startTime}`,
    sportId: space.sportId,
    teacherMemberIds,
    courtId: space.courtA,
    weekday: (slotWeekday() + dayOffset) % 7,
    startTime,
    durationMin: 60,
    capacity: 6,
    ...overrides,
  });

  async function createGroup(
    space: Space,
    teachers: string[],
    startTime: string,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await post(
      space,
      '/class-groups',
      groupBody(space, teachers, startTime, overrides),
    ).expect(201);
    return res.body as Group;
  }

  async function firstSession(group: Id) {
    return first(await sessionsOf(t.db, group.id));
  }

  /** Ocupações ativas do usuário em uma aula. */
  const occupationsOf = (userId: string, classSessionId: string) =>
    t.db
      .select()
      .from(teacherOccupations)
      .where(
        and(
          eq(teacherOccupations.userId, userId),
          eq(teacherOccupations.classSessionId, classSessionId),
          eq(teacherOccupations.active, true),
        ),
      );

  /** DD/MM/AAAA da primeira aula (amanhã). */
  const firstDate = () => occurrenceDate(0).split('-').reverse().join('/');

  describe('listas', () => {
    beforeAll(() => useDay(1));

    it('a turma tem dois professores e cada aula copia a lista e ocupa a agenda dos dois', async () => {
      const time = newTime();
      const group = await createGroup(a, [sharedInA, partnerInA], time);
      expect(group.teachers.map((teacher) => teacher.memberId).sort()).toEqual(
        [sharedInA, partnerInA].sort(),
      );

      const sessions = await sessionsOf(t.db, group.id);
      expect(sessions).toHaveLength(4);
      for (const session of sessions) {
        expect(await sessionTeacherIds(t.db, session.id)).toEqual([sharedInA, partnerInA].sort());
        expect(await occupationsOf(shared.id, session.id)).toHaveLength(1);
        expect(await occupationsOf(partner.id, session.id)).toHaveLength(1);
      }

      const detail = await get(ownerA, a, `/class-sessions/${first(sessions).id}`).expect(200);
      expect(detail.body.teachers).toHaveLength(2);
    });

    it('recusa lista vazia, repetida ou o campo antigo', async () => {
      const time = newTime();
      await post(a, '/class-groups', groupBody(a, [], time)).expect(400);
      await post(a, '/class-groups', groupBody(a, [partnerInA, partnerInA], time)).expect(400);
      const { teacherMemberIds: _, ...body } = groupBody(a, [partnerInA], time);
      await post(a, '/class-groups', { ...body, teacherMemberId: partnerInA }).expect(400);
    });

    it('um dos professores sem vínculo no espaço recusa tudo', async () => {
      const res = await post(
        a,
        '/class-groups',
        groupBody(a, [partnerInA, colleagueInB], newTime()),
      ).expect(422);
      expect(res.body.error.code).toBe('TEACHER_NOT_FOUND');
    });

    it('a aula troca de professores só nela; a turma e as outras aulas não mudam', async () => {
      const group = await createGroup(a, [partnerInA], newTime());
      const [session, other] = await sessionsOf(t.db, group.id);
      if (!session || !other) throw new Error('sessões não geradas');

      const res = await patch(a, `/class-sessions/${session.id}`, {
        teacherMemberIds: [sharedInA],
      }).expect(200);
      expect(res.body.teachers.map((teacher: Group['teachers'][0]) => teacher.memberId)).toEqual([
        sharedInA,
      ]);
      expect(await sessionTeacherIds(t.db, session.id)).toEqual([sharedInA]);
      expect(await sessionTeacherIds(t.db, other.id)).toEqual([partnerInA]);
      expect(await occupationsOf(partner.id, session.id)).toHaveLength(0);
      expect(await occupationsOf(shared.id, session.id)).toHaveLength(1);

      const detail = await get(ownerA, a, `/class-groups/${group.id}`).expect(200);
      expect(detail.body.teachers.map((teacher: Group['teachers'][0]) => teacher.memberId)).toEqual(
        [partnerInA],
      );
      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, session.id),
            eq(auditLogs.action, 'class_session.teacher_change'),
          ),
        );
      expect(log?.diff).toMatchObject({ before: [partnerInA], after: [sharedInA] });
    });

    it('trocar os professores da turma não mexe na aula com lista própria', async () => {
      const group = await createGroup(a, [partnerInA], newTime());
      const [own, follower] = await sessionsOf(t.db, group.id);
      if (!own || !follower) throw new Error('sessões não geradas');
      await patch(a, `/class-sessions/${own.id}`, {
        teacherMemberIds: [sharedInA, partnerInA],
      }).expect(200);

      await patch(a, `/class-groups/${group.id}`, { teacherMemberIds: [sharedInA] }).expect(200);
      expect(await sessionTeacherIds(t.db, follower.id)).toEqual([sharedInA]);
      expect(await occupationsOf(partner.id, follower.id)).toHaveLength(0);
      expect(await sessionTeacherIds(t.db, own.id)).toEqual([sharedInA, partnerInA].sort());
    });
  });

  describe('conflito de horário', () => {
    beforeAll(() => useDay(0));

    it('mesma hora no mesmo espaço: permite, na turma e na aula', async () => {
      const time = newTime();
      const first_ = await createGroup(a, [sharedInA], time);
      const second = await createGroup(a, [partnerInA], time, { courtId: a.courtB });
      await patch(a, `/class-sessions/${(await firstSession(second)).id}`, {
        teacherMemberIds: [partnerInA, sharedInA],
      }).expect(200);
      await patch(a, `/class-groups/${second.id}`, { name: 'Turma ao lado' }).expect(200);
      expect(first_.teachers).toHaveLength(1);
    });

    it('espaços diferentes: recusa com a data e o horário, sem revelar o outro espaço', async () => {
      const time = newTime();
      await createGroup(a, [sharedInA], time);
      const res = await post(b, '/class-groups', groupBody(b, [sharedInB], time)).expect(409);
      expect(res.body.error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
      expect(res.body.error.message).toContain(firstDate());
      expect(res.body.error.message).toContain(`entre ${time} e ${laterHour(time)}`);
      expect(res.body.error.details).toMatchObject({
        teacher: { memberId: sharedInB },
        startsAt: expect.any(String),
        endsAt: expect.any(String),
        timeZone: 'America/Sao_Paulo',
      });
      const raw = JSON.stringify(res.body).toLowerCase();
      expect(raw).not.toContain('arena-multi-a');
      expect(raw).not.toContain(a.id);
      expect(
        await t.db.select().from(classGroups).where(eq(classGroups.spaceId, b.id)),
      ).not.toContainEqual(expect.objectContaining({ startTime: `${time}:00` }));
    });

    it('horários adjacentes em espaços diferentes não conflitam', async () => {
      const time = newTime();
      newTime();
      await createGroup(a, [sharedInA], time);
      await createGroup(b, [sharedInB], laterHour(time));
    });

    it('a turma ativa sem aulas geradas também conta (recorrência semanal)', async () => {
      const time = newTime();
      await insertGroupRow(t.db, {
        spaceId: a.id,
        sportId: a.sportId,
        courtId: a.courtB,
        teacherMemberId: sharedInA,
        name: 'Sem sessões',
        weekday: slotWeekday(),
        startTime: time,
        durationMin: 60,
        capacity: 4,
      });
      const res = await post(b, '/class-groups', groupBody(b, [sharedInB], time)).expect(409);
      expect(res.body.error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
    });

    it('compara o horário semanal no fuso de cada espaço', async () => {
      const manaus = await createSpace(t.db, 'arena-multi-manaus');
      await moveToManaus(t.db, manaus.id);
      const north = await member(t, 'dono-manaus-multi@exemplo.com', manaus.id, 'OWNER');
      await t.db
        .insert(spaceMembers)
        .values({ userId: shared.id, spaceId: manaus.id, role: 'TEACHER', status: 'ACTIVE' });
      const sharedInManaus = await teacherMemberId(t.db, shared.id, manaus.id);

      const time = newTime();
      newTime();
      await createGroup(a, [sharedInA], laterHour(time));
      // Manaus é uma hora atrás: `time` lá é `time + 1` no horário de Belo Horizonte.
      const res = await t
        .http()
        .post(url(manaus, '/class-groups'))
        .set(...bearer(north))
        .send(groupBody(manaus, [sharedInManaus], time))
        .expect(409);
      expect(res.body.error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
    });

    it('editar a lista da turma: quem entra passa pela agenda, e nada muda se recusar', async () => {
      const time = newTime();
      await createGroup(a, [sharedInA], time);
      const group = await createGroup(b, [colleagueInB], time);
      const res = await patch(b, `/class-groups/${group.id}`, {
        teacherMemberIds: [colleagueInB, sharedInB],
      }).expect(409);
      expect(res.body.error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
      const rows = await t.db
        .select()
        .from(classGroupTeachers)
        .where(eq(classGroupTeachers.classGroupId, group.id));
      expect(rows.map((row) => row.teacherMemberId)).toEqual([colleagueInB]);
    });

    it('mudar o horário da turma para cima de outra aula do professor é recusado', async () => {
      const taken = newTime();
      await createGroup(a, [sharedInA], taken);
      const free = newTime();
      const group = await createGroup(b, [sharedInB], free);
      const res = await patch(b, `/class-groups/${group.id}`, { startTime: taken }).expect(409);
      expect(res.body.error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
      expect(await sessionsOf(t.db, group.id)).toHaveLength(4);
    });

    it('reativar a turma revalida a agenda dos professores', async () => {
      const time = newTime();
      const inactive = await createGroup(b, [sharedInB], time, { active: false });
      await createGroup(a, [sharedInA], time);
      const res = await patch(b, `/class-groups/${inactive.id}`, { active: true }).expect(409);
      expect(res.body.error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
    });

    it('editar a aula: conflito só com a data da aula, no fuso do espaço', async () => {
      const time = newTime();
      await createGroup(a, [sharedInA], time);
      const group = await createGroup(b, [colleagueInB], time);
      const session = await firstSession(group);
      const res = await patch(b, `/class-sessions/${session.id}`, {
        teacherMemberIds: [sharedInB],
      }).expect(409);
      expect(res.body.error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
      expect(res.body.error.message).toContain(firstDate());
      expect(res.body.error.details.startsAt).toBe(session.startsAt.toISOString());
      expect(await sessionTeacherIds(t.db, session.id)).toEqual([colleagueInB]);
    });

    it('aula cancelada libera o horário do professor', async () => {
      const time = newTime();
      const taken = await firstSession(await createGroup(a, [sharedInA], time));
      const session = await firstSession(await createGroup(b, [colleagueInB], time));
      const add = () =>
        patch(b, `/class-sessions/${session.id}`, {
          teacherMemberIds: [colleagueInB, sharedInB],
        });
      await add().expect(409);

      await post(a, `/class-sessions/${taken.id}/cancel`, { reason: 'Chuva' }).expect(200);
      expect(await occupationsOf(shared.id, taken.id)).toHaveLength(0);
      await add().expect(200);
      expect(await occupationsOf(shared.id, session.id)).toHaveLength(1);
    });

    it('corrida: dois espaços pondo o mesmo professor no mesmo horário, só um passa', async () => {
      const inA = await sessionsOf(t.db, (await createGroup(a, [partnerInA], newTime())).id);
      nextHour--;
      const inB = await sessionsOf(t.db, (await createGroup(b, [colleagueInB], newTime())).id);
      for (const [index, sessionA] of inA.entries()) {
        const sessionB = first(inB.slice(index, index + 1));
        const [one, other] = await Promise.all([
          patch(a, `/class-sessions/${sessionA.id}`, {
            teacherMemberIds: [partnerInA, sharedInA],
          }),
          patch(b, `/class-sessions/${sessionB.id}`, {
            teacherMemberIds: [colleagueInB, sharedInB],
          }),
        ]);
        expect([one.status, other.status].sort()).toEqual([200, 409]);
        const loser = one.status === 409 ? one : other;
        expect(loser.body.error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
        const held = await occupationsOf(shared.id, sessionA.id);
        const heldElsewhere = await occupationsOf(shared.id, sessionB.id);
        expect(held.length + heldElsewhere.length).toBe(1);
      }
    });

    it('corrida: duas turmas novas com o mesmo professor, só uma passa', async () => {
      const time = newTime();
      const [one, other] = await Promise.all([
        post(a, '/class-groups', groupBody(a, [sharedInA], time)),
        post(b, '/class-groups', groupBody(b, [sharedInB], time)),
      ]);
      expect([one.status, other.status].sort()).toEqual([201, 409]);
      const loser = one.status === 409 ? one : other;
      expect(loser.body.error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
    });
  });

  describe('garantias no banco', () => {
    beforeAll(() => useDay(2));

    it('a constraint recusa a sobreposição entre espaços; mesmo espaço e inativa passam', async () => {
      const time = newTime();
      const inA = await firstSession(await createGroup(a, [sharedInA], time));
      const inB = await firstSession(await createGroup(b, [colleagueInB], time));
      const other = await sessionsOf(t.db, (await createGroup(a, [partnerInA], newTime())).id);
      const period = { start: inA.startsAt, end: inA.endsAt };

      const error = await t.db
        .insert(teacherOccupations)
        .values({ userId: shared.id, spaceId: b.id, classSessionId: inB.id, period })
        .catch((err: unknown) => err);
      expect(pgError(error)).toMatchObject({
        code: '23P01',
        constraint: 'teacher_occupations_no_overlap',
      });

      await t.db.insert(teacherOccupations).values({
        userId: shared.id,
        spaceId: b.id,
        classSessionId: inB.id,
        period,
        active: false,
      });
      await t.db.insert(teacherOccupations).values({
        userId: shared.id,
        spaceId: a.id,
        classSessionId: first(other).id,
        period,
      });
    });

    it('a FK composta recusa professor de outro espaço na turma e na aula', async () => {
      const group = await createGroup(a, [partnerInA], newTime());
      const session = await firstSession(group);
      const onGroup = await t.db
        .insert(classGroupTeachers)
        .values({ classGroupId: group.id, spaceId: a.id, teacherMemberId: colleagueInB })
        .catch((err: unknown) => err);
      expect(pgError(onGroup)).toMatchObject({
        code: '23503',
        constraint: 'class_group_teachers_member_space_fk',
      });
      const onSession = await t.db
        .insert(classSessionTeachers)
        .values({ classSessionId: session.id, spaceId: b.id, teacherMemberId: colleagueInB })
        .catch((err: unknown) => err);
      expect(pgError(onSession)).toMatchObject({
        code: '23503',
        constraint: 'class_session_teachers_class_session_space_fk',
      });
    });

    it('turma ou aula não fica sem professor, nem nasce sem', async () => {
      const group = await createGroup(a, [partnerInA], newTime());
      const session = await firstSession(group);

      const noGroupTeacher = await t.db
        .delete(classGroupTeachers)
        .where(eq(classGroupTeachers.classGroupId, group.id))
        .catch((err: unknown) => err);
      expect(pgError(noGroupTeacher)).toMatchObject({
        code: '23514',
        constraint: 'class_group_teachers_required',
      });
      const noSessionTeacher = await t.db
        .delete(classSessionTeachers)
        .where(eq(classSessionTeachers.classSessionId, session.id))
        .catch((err: unknown) => err);
      expect(pgError(noSessionTeacher)).toMatchObject({
        code: '23514',
        constraint: 'class_session_teachers_required',
      });

      const noTeacherAtAll = await t.db
        .insert(classSessions)
        .values({
          classGroupId: group.id,
          spaceId: a.id,
          courtId: a.courtA,
          startsAt: new Date(session.startsAt.getTime() + 60_000),
          endsAt: new Date(session.endsAt.getTime() + 60_000),
          capacity: 4,
        })
        .catch((err: unknown) => err);
      expect(pgError(noTeacherAtAll)).toMatchObject({
        code: '23514',
        constraint: 'class_session_teachers_required',
      });

      // Trocar dentro da mesma transação e apagar a turma inteira continuam valendo.
      await t.db.transaction(async (tx) => {
        await tx
          .delete(classSessionTeachers)
          .where(eq(classSessionTeachers.classSessionId, session.id));
        await tx
          .insert(classSessionTeachers)
          .values({ classSessionId: session.id, spaceId: a.id, teacherMemberId: sharedInA });
      });
      await t
        .http()
        .delete(url(a, `/class-groups/${group.id}`))
        .set(...bearer(ownerA))
        .expect(204);
    });
  });

  describe('escopo do Professor', () => {
    beforeAll(() => useDay(3));

    it('vê e opera turmas e aulas em que está entre os professores, em cada listagem', async () => {
      const group = await createGroup(a, [sharedInA, partnerInA], newTime());
      const foreign = await createGroup(a, [sharedInA], newTime());
      const session = await firstSession(group);
      const foreignSession = await firstSession(foreign);

      const ids = (res: { body: { items: Id[] } }) => res.body.items.map((item) => item.id);
      const groups = await get(partner, a, '/class-groups').expect(200);
      expect(ids(groups)).toContain(group.id);
      expect(ids(groups)).not.toContain(foreign.id);
      await get(partner, a, `/class-groups/${group.id}`).expect(200);
      await get(partner, a, `/class-groups/${foreign.id}`).expect(404);

      const filtered = await get(ownerA, a, `/class-groups?teacherMemberId=${partnerInA}`).expect(
        200,
      );
      expect(ids(filtered)).toContain(group.id);
      expect(ids(filtered)).not.toContain(foreign.id);

      const sessions = await get(partner, a, '/class-sessions').expect(200);
      expect(ids(sessions)).toContain(session.id);
      expect(ids(sessions)).not.toContain(foreignSession.id);
      const filteredSessions = await get(
        ownerA,
        a,
        `/class-sessions?teacherMemberId=${partnerInA}`,
      ).expect(200);
      expect(ids(filteredSessions)).toContain(session.id);
      expect(ids(filteredSessions)).not.toContain(foreignSession.id);

      await get(partner, a, `/class-sessions/${session.id}`).expect(200);
      await get(partner, a, `/class-sessions/${foreignSession.id}`).expect(404);
      await post(a, `/class-sessions/${session.id}/open`, {}, partner).expect(200);
      await post(a, `/class-sessions/${session.id}/close`, {}, partner).expect(200);
      await post(a, `/class-sessions/${foreignSession.id}/open`, {}, partner).expect(404);

      // Presenças e relatórios.
      await get(partner, a, `/class-attendances?classGroupId=${group.id}`).expect(200);
      const empty = await get(partner, a, `/class-attendances?classGroupId=${foreign.id}`).expect(
        200,
      );
      expect(empty.body.items).toEqual([]);
      await get(partner, a, `/class-groups/${group.id}/frequency`).expect(200);
      await get(partner, a, `/class-groups/${foreign.id}/frequency`).expect(404);

      const teachers = await get(ownerA, a, '/teachers').expect(200);
      const row = teachers.body.items.find(
        (item: { memberId: string }) => item.memberId === partnerInA,
      );
      expect(row.activeClassGroupCount).toBeGreaterThan(0);
    });

    it('quem assume uma aula avulsa vê a aula, não a turma, e a agenda da equipe no app', async () => {
      const group = await createGroup(b, [colleagueInB], newTime());
      const session = await firstSession(group);
      await t.db
        .update(classSessions)
        .set({ startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000) })
        .where(eq(classSessions.id, session.id));
      await patch(b, `/class-sessions/${session.id}`, {
        teacherMemberIds: [colleagueInB, sharedInB],
      }).expect(200);

      await get(shared, b, `/class-sessions/${session.id}`).expect(200);
      await get(shared, b, `/class-groups/${group.id}`).expect(404);

      const staff = await t
        .http()
        .get('/v1/me/staff-spaces')
        .set(...bearer(shared))
        .expect(200);
      const { today } = staff.body.items.find((item: { space: Id }) => item.space.id === b.id);
      const staffSession = today.classSessions.find((item: Id) => item.id === session.id);
      expect(staffSession.teachers).toHaveLength(2);
      expect(staffSession.teachers[0]).toEqual({
        name: expect.any(String),
        avatarUrl: null,
      });
      expect(staffSession).not.toHaveProperty('teacherName');
    });

    it('o jogador vê a lista de professores no app e na página pública', async () => {
      const group = await createGroup(a, [sharedInA, partnerInA], newTime());
      const session = await firstSession(group);
      const student = await signUp(t, 'aluno-multi@exemplo.com');
      await enroll(t.db, {
        userId: student.id,
        spaceId: a.id,
        sportId: a.sportId,
        classGroupId: group.id,
      });

      const detail = await t
        .http()
        .get(`/v1/me/class-sessions/${session.id}`)
        .set(...bearer(student))
        .expect(200);
      expect(detail.body.teachers).toHaveLength(2);
      expect(Object.keys(detail.body.teachers[0]).sort()).toEqual(['avatarUrl', 'name']);
      const week = await t
        .http()
        .get('/v1/me/class-sessions')
        .set(...bearer(student))
        .expect(200);
      const listedSession = week.body.items.find((item: Id) => item.id === session.id);
      expect(Object.keys(listedSession.teachers[0]).sort()).toEqual(['avatarUrl', 'name']);

      const subscriptions = await t
        .http()
        .get('/v1/me/subscriptions')
        .set(...bearer(student))
        .expect(200);
      const teachers = subscriptions.body.items[0].enrollments[0].classGroup.teachers;
      expect(teachers).toHaveLength(2);
      expect(teachers[0]).not.toHaveProperty('userId');

      const page = await t.http().get('/v1/spaces/arena-multi-a/classes').expect(200);
      const listed = page.body.classGroups.find((item: Id) => item.id === group.id);
      expect(listed.teachers).toHaveLength(2);
      expect(listed.teachers[0]).not.toHaveProperty('memberId');
    });
  });

  describe('deadlock na disputa pelo horário', () => {
    beforeAll(() => useDay(5));

    /** Quantas transações deste banco esperam uma trava consultiva. */
    async function advisoryWaiters() {
      const { rows } = await t.db.execute<{ total: number }>(sql`
        SELECT count(*)::int AS total FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
      return rows[0]?.total ?? 0;
    }

    /**
     * Provoca o deadlock de verdade: segura a agenda do professor e, com a edição esperando por
     * ela, pede a linha que a edição já travou. A edição chegou antes à espera, então é ela que o
     * Postgres derruba com 40P01.
     */
    async function collide(
      lockRow: (tx: Tx) => PromiseLike<unknown>,
      edit: () => ReturnType<typeof patch>,
    ) {
      let pending: Promise<Awaited<ReturnType<typeof patch>>> | undefined;
      await t.db.transaction(async (tx) => {
        await lockTeacherSchedule(tx, [shared.id]);
        pending = Promise.resolve(edit());
        while ((await advisoryWaiters()) === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await lockRow(tx);
      });
      if (!pending) throw new Error('edição não iniciada');
      return pending;
    }

    it('na edição da aula vira 409, sem mudar a lista, e a nova tentativa passa', async () => {
      const session = await firstSession(await createGroup(a, [partnerInA], newTime()));
      const body = { teacherMemberIds: [partnerInA, sharedInA] };
      const res = await collide(
        (tx) =>
          tx
            .select({ id: classSessions.id })
            .from(classSessions)
            .where(eq(classSessions.id, session.id))
            .for('update'),
        () => patch(a, `/class-sessions/${session.id}`, body),
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect(await sessionTeacherIds(t.db, session.id)).toEqual([partnerInA]);

      await patch(a, `/class-sessions/${session.id}`, body).expect(200);
      expect(await occupationsOf(shared.id, session.id)).toHaveLength(1);
    });

    it('na edição da turma vira 409, sem mudar a lista, e a nova tentativa passa', async () => {
      const group = await createGroup(a, [partnerInA], newTime());
      const body = { teacherMemberIds: [partnerInA, sharedInA] };
      const res = await collide(
        (tx) =>
          tx
            .select({ id: classGroups.id })
            .from(classGroups)
            .where(eq(classGroups.id, group.id))
            .for('update'),
        () => patch(a, `/class-groups/${group.id}`, body),
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
      const lists = await t.db
        .select({ memberId: classGroupTeachers.teacherMemberId })
        .from(classGroupTeachers)
        .where(eq(classGroupTeachers.classGroupId, group.id));
      expect(lists).toEqual([{ memberId: partnerInA }]);

      await patch(a, `/class-groups/${group.id}`, body).expect(200);
    });
  });

  describe('saída do espaço', () => {
    beforeAll(() => useDay(4));

    const remove = (space: Space, userId: string) =>
      t
        .http()
        .delete(url(space, `/team/members/${userId}`))
        .set(...bearer(ownerOf(space)));

    async function newTeacher(space: Space, email: string) {
      const user = await member(t, email, space.id, 'TEACHER');
      return { user, memberId: await teacherMemberId(t.db, user.id, space.id) };
    }

    it('com outro professor na lista, sai da turma e das aulas futuras; a aula dada fica', async () => {
      const { user, memberId } = await newTeacher(a, 'prof-sai@exemplo.com');
      const group = await createGroup(a, [memberId, partnerInA], newTime());
      const sessions = await sessionsOf(t.db, group.id);
      const held = await insertSession(
        t.db,
        await t.db
          .select()
          .from(classGroups)
          .where(eq(classGroups.id, group.id))
          .then((rows) => first(rows)),
        -300,
        { status: 'DONE' },
      );

      await remove(a, user.id).expect(204);

      const detail = await get(ownerA, a, `/class-groups/${group.id}`).expect(200);
      expect(detail.body.teachers.map((teacher: Group['teachers'][0]) => teacher.memberId)).toEqual(
        [partnerInA],
      );
      for (const session of sessions) {
        expect(await sessionTeacherIds(t.db, session.id)).toEqual([partnerInA]);
        expect(await occupationsOf(user.id, session.id)).toHaveLength(0);
      }
      expect(await sessionTeacherIds(t.db, held.id)).toContain(memberId);
    });

    it('único professor de turma ativa: recusa, dizendo qual', async () => {
      const { user, memberId } = await newTeacher(a, 'prof-unico@exemplo.com');
      const group = await createGroup(a, [memberId], newTime(), { name: 'Turma do único' });
      const res = await remove(a, user.id).expect(409);
      expect(res.body.error.code).toBe('TEACHER_HAS_CLASS_GROUPS');
      expect(res.body.error.message).toContain('"Turma do único"');
      expect(res.body.error.message).toContain('Adicione outro professor');
      expect(res.body.error.details.classGroups).toEqual([
        { id: group.id, name: 'Turma do único' },
      ]);
      expect(res.body.error.details.classSessions).toHaveLength(4);
    });

    it('único de uma aula futura de turma com outro professor: recusa pela aula', async () => {
      const { user, memberId } = await newTeacher(a, 'prof-aula@exemplo.com');
      const group = await createGroup(a, [partnerInA], newTime());
      const session = await firstSession(group);
      await patch(a, `/class-sessions/${session.id}`, { teacherMemberIds: [memberId] }).expect(200);

      const res = await t
        .http()
        .put(url(a, `/team/members/${user.id}/roles`))
        .set(...bearer(ownerA))
        .send({ roles: ['ADMIN'] })
        .expect(409);
      expect(res.body.error.code).toBe('TEACHER_HAS_CLASS_GROUPS');
      expect(res.body.error.details.classGroups).toEqual([]);
      expect(res.body.error.details.classSessions).toEqual([
        expect.objectContaining({ id: session.id, classGroup: expect.any(Object) }),
      ]);

      await patch(a, `/class-sessions/${session.id}`, { teacherMemberIds: [partnerInA] }).expect(
        200,
      );
      await remove(a, user.id).expect(204);
    });

    it('na turma inativa em que é o único ele fica, e reativar pede outro professor', async () => {
      const { user, memberId } = await newTeacher(a, 'prof-inativa@exemplo.com');
      const group = await createGroup(a, [memberId], newTime(), { active: false });
      await remove(a, user.id).expect(204);

      const res = await patch(a, `/class-groups/${group.id}`, { active: true }).expect(422);
      expect(res.body.error.code).toBe('TEACHER_NOT_FOUND');
      await patch(a, `/class-groups/${group.id}`, {
        active: true,
        teacherMemberIds: [partnerInA],
      }).expect(200);
      expect(await sessionsOf(t.db, group.id)).toHaveLength(4);
    });
  });
});
