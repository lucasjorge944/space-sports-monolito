import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountDeletionRequests,
  attendances,
  auditLogs,
  bookings,
  classGroupTeachers,
  courtOccupations,
  enrollments,
  notifications,
  paymentRecords,
  recurringBookings,
  reviewCreatedNotices,
  reviewPrompts,
  spaceReviewReports,
  spaceReviews,
  spaces,
  subscriptionCharges,
  subscriptions,
  teacherOccupations,
  users,
} from '../../src/db/schema/index.js';
import { ACCOUNT_DELETED_REASON } from '../../src/users/deletion-cleanup.js';
import { createTestApp, PASSWORD, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  member,
  type Space,
  slotIn,
  useMiddayClock,
} from '../bookings/fixtures.js';
import { insertGroup, insertSession, listOf } from '../classes/attendance-fixtures.js';
import { enroll, sessionTeacherIds, teacherMemberId } from '../classes/fixtures.js';
import { first } from '../db/helpers.js';
import { slotWeekday, today } from '../recurring/fixtures.js';
import { insertBooking } from '../reviews/helpers.js';
import { type Row, superUser } from './fixtures.js';

// RF-AUTH-03 (decisão 40): o Super vê os pedidos com o prazo, a origem e as pendências da conta;
// atender cancela os compromissos futuros (promovendo a espera) antes de anonimizar; recusar
// exige o motivo e mantém a conta inativa; cancelar o pedido (desistência) reativa a conta.

useMiddayClock();

const DAY_MS = 24 * 60 * 60 * 1000;

/** Primeiro dia do mês de `date` deslocado em `months` (AAAA-MM-01). */
function monthStart(date: string, months = 0): string {
  const [year, month] = date.split('-').map(Number) as [number, number];
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/** Último dia do mês que começa em `start`. */
const monthEnd = (start: string) => {
  const next = new Date(`${monthStart(start, 1)}T00:00:00Z`);
  return new Date(next.getTime() - DAY_MS).toISOString().slice(0, 10);
};

describe('Super: pedidos de exclusão (decisão 40)', () => {
  let t: TestApp;
  let admin: SignedUp;
  let space: Space;
  let owner: SignedUp;
  let spaceAdmin: SignedUp;
  let teacher: SignedUp;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await superUser(t, 'super@exemplo.com');
    space = await createSpace(t.db, 'arena-exclusao');
    owner = await member(t, 'dono@exemplo.com', space.id, 'OWNER');
    spaceAdmin = await member(t, 'admin@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'professor@exemplo.com', space.id, 'TEACHER');
  });
  afterAll(() => t.close());

  const superCall = (path: string, body?: object) =>
    t
      .http()
      .post(path)
      .set(...bearer(admin))
      .send(body);

  const list = async (query = '') =>
    (
      await t
        .http()
        .get(`/v1/super/deletion-requests?pageSize=100${query}`)
        .set(...bearer(admin))
        .expect(200)
    ).body.items as Row[];

  /** O titular pede pelo app; devolve o id do pedido. */
  const requestDeletion = async (user: SignedUp, reason?: string) =>
    (
      await t
        .http()
        .post('/v1/me/deletion-request')
        .set(...bearer(user))
        .send({ password: PASSWORD, ...(reason ? { reason } : {}) })
        .expect(201)
    ).body.requestId as string;

  const userRow = async (id: string) =>
    first(await t.db.select().from(users).where(eq(users.id, id)));

  const notificationsOf = (userId: string, type: string) =>
    t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

  /** Quantas notificações (de qualquer tipo) o usuário tem. */
  const noticesOf = async (userId: string) =>
    (await t.db.select().from(notifications).where(eq(notifications.userId, userId))).length;

  const auditOf = (userId: string, action: string) =>
    t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, userId), eq(auditLogs.action, action)));

  const deskBooking = (customerUserId: string, startsAt: Date) =>
    t
      .http()
      .post(`/v1/manage/spaces/${space.id}/bookings`)
      .set(...bearer(spaceAdmin))
      .send({
        courtId: space.courtA,
        sportId: space.sportId,
        startsAt: startsAt.toISOString(),
        durationMin: 60,
        peopleCount: 2,
        customerUserId,
      });

  describe('atender', () => {
    it('cancela reservas, mensalista, assinatura e aulas futuras, promove a espera e anonimiza', async () => {
      const player = await signUp(t, 'jogador@exemplo.com', 'Jogador Saindo');
      const waiting = await signUp(t, 'espera@exemplo.com', 'Na Espera');
      const holder = await signUp(t, 'titular-aula@exemplo.com', 'Titular');
      const second = await signUp(t, 'segundo-espera@exemplo.com', 'Segundo');

      // Reserva futura (balcão, ele é o organizador) e uma passada ainda não quitada.
      const startsAt = slotIn(120);
      const future = await deskBooking(player.id, startsAt).expect(201);
      const yesterday = new Date(Date.now() - DAY_MS);
      await t.db.insert(bookings).values({
        spaceId: space.id,
        courtId: space.courtB,
        organizerUserId: player.id,
        sportId: space.sportId,
        startsAt: yesterday,
        endsAt: new Date(yesterday.getTime() + 60 * 60_000),
        durationMin: 60,
        peopleCount: 2,
        pricePerHourCents: 10_000,
        priceCents: 10_000,
        status: 'COMPLETED',
        source: 'DESK',
      });
      const [past] = await t.db
        .select()
        .from(bookings)
        .where(and(eq(bookings.organizerUserId, player.id), eq(bookings.status, 'COMPLETED')));
      await t.db.insert(paymentRecords).values({
        spaceId: space.id,
        payableType: 'BOOKING',
        payableId: past?.id ?? '',
        payerUserId: player.id,
        amountCents: 4_000,
        method: 'PIX',
        paidAt: yesterday,
        recordedBy: spaceAdmin.id,
      });

      // Mensalista aprovado (com as ocorrências das próximas semanas).
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
          durationMin: 60,
          peopleCount: 4,
        })
        .expect(201);
      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/recurring-bookings/${recurring.body.id}/approve`)
        .set(...bearer(owner))
        .expect(200);
      const occurrences = await t.db
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(eq(bookings.recurringBookingId, recurring.body.id), eq(bookings.status, 'CONFIRMED')),
        );
      expect(occurrences.length).toBeGreaterThan(0);

      // Assinatura com a mensalidade do mês (parcialmente paga) e a do mês seguinte já gerada.
      const group = await insertGroup(
        t.db,
        space,
        await teacherMemberId(t.db, teacher.id, space.id),
        { capacity: 1 },
      );
      const sub = await enroll(t.db, {
        userId: player.id,
        spaceId: space.id,
        sportId: space.sportId,
        classGroupId: group.id,
      });
      const current = monthStart(today());
      const next = monthStart(today(), 1);
      const [currentCharge] = await t.db
        .insert(subscriptionCharges)
        .values([
          {
            subscriptionId: sub.id,
            periodStart: current,
            periodEnd: monthEnd(current),
            dueDate: `${current.slice(0, 8)}10`,
            amountCents: 15_000,
          },
          {
            subscriptionId: sub.id,
            periodStart: next,
            periodEnd: monthEnd(next),
            dueDate: `${next.slice(0, 8)}10`,
            amountCents: 15_000,
          },
        ])
        .returning();
      await t.db.insert(paymentRecords).values({
        spaceId: space.id,
        payableType: 'SUBSCRIPTION_CHARGE',
        payableId: currentCharge?.id ?? '',
        payerUserId: player.id,
        amountCents: 5_000,
        method: 'CASH',
        paidAt: new Date(),
        recordedBy: spaceAdmin.id,
      });

      // Aula lotada em que ele está confirmado (com alguém na espera) e outra em que ele espera.
      const full = await insertSession(t.db, group, 180);
      await t.db.insert(attendances).values([
        { sessionId: full.id, userId: player.id, status: 'CONFIRMED' },
        { sessionId: full.id, userId: waiting.id, status: 'WAITLIST', waitlistPosition: 1 },
      ]);
      const other = await insertSession(t.db, group, 300);
      await t.db.insert(attendances).values([
        { sessionId: other.id, userId: holder.id, status: 'CONFIRMED' },
        { sessionId: other.id, userId: player.id, status: 'WAITLIST', waitlistPosition: 1 },
        { sessionId: other.id, userId: second.id, status: 'WAITLIST', waitlistPosition: 2 },
      ]);

      const requestId = await requestDeletion(player, 'Vou me mudar');

      // A lista mostra a origem, o prazo e as pendências por espaço.
      const item = (await list('&status=PENDING')).find((row) => row.id === requestId);
      expect(item).toMatchObject({
        status: 'PENDING',
        source: 'USER',
        reason: 'Vou me mudar',
        overdue: false,
        pending: [
          {
            spaceId: space.id,
            spaceName: 'Espaço arena-exclusao',
            upcomingBookings: 1,
            upcomingRecurringOccurrences: occurrences.length,
            openRecurringBookings: 1,
            openSubscriptions: 1,
            upcomingClassAttendances: 2,
            openCharges: 2,
            openChargesCents: 25_000,
            bookingsDueCents: 6_000,
          },
        ],
      });
      expect(
        new Date(item?.dueAt as string).getTime() - new Date(item?.requestedAt as string).getTime(),
      ).toBe(15 * DAY_MS);

      const managers = [owner, spaceAdmin];
      const noticesBefore = await Promise.all(managers.map((m) => noticesOf(m.id)));
      const done = await superCall(`/v1/super/deletion-requests/${requestId}/fulfill`, {}).expect(
        200,
      );
      expect(done.body).toMatchObject({
        status: 'COMPLETED',
        resolvedBy: admin.id,
        userName: 'Conta excluída',
        pending: null,
      });

      // Reservas futuras canceladas, com a quadra liberada; a passada fica como estava.
      const [cancelled] = await t.db.select().from(bookings).where(eq(bookings.id, future.body.id));
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        cancelledBy: admin.id,
        cancelReason: ACCOUNT_DELETED_REASON,
      });
      const occupations = await t.db
        .select({ active: courtOccupations.active })
        .from(courtOccupations)
        .where(
          inArray(courtOccupations.refId, [future.body.id, ...occurrences.map((row) => row.id)]),
        );
      expect(occupations.length).toBe(occurrences.length + 1);
      expect(occupations.every((row) => !row.active)).toBe(true);
      expect(
        (
          await t.db
            .select()
            .from(bookings)
            .where(eq(bookings.id, past?.id ?? ''))
        )[0]?.status,
      ).toBe('COMPLETED');
      // O horário volta a ficar livre para outro cliente.
      const other2 = await signUp(t, 'outro-cliente@exemplo.com');
      await deskBooking(other2.id, startsAt).expect(201);

      // Mensalista encerrado, sem ocorrências futuras.
      const [plan] = await t.db
        .select()
        .from(recurringBookings)
        .where(eq(recurringBookings.id, recurring.body.id));
      expect(plan).toMatchObject({ status: 'ENDED', statusReason: ACCOUNT_DELETED_REASON });
      const stillConfirmed = await t.db
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(eq(bookings.recurringBookingId, recurring.body.id), eq(bookings.status, 'CONFIRMED')),
        );
      expect(stillConfirmed).toEqual([]);

      // Assinatura encerrada; a mensalidade do mês fica em aberto, a do mês seguinte some.
      const [subscription] = await t.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));
      expect(subscription).toMatchObject({ status: 'CANCELLED', cancelledBy: admin.id });
      const enrolled = await t.db
        .select()
        .from(enrollments)
        .where(eq(enrollments.subscriptionId, sub.id));
      expect(enrolled.map((row) => row.status)).toEqual(['ENDED']);
      const charges = await t.db
        .select()
        .from(subscriptionCharges)
        .where(eq(subscriptionCharges.subscriptionId, sub.id));
      expect(charges.map((row) => row.periodStart)).toEqual([current]);
      // Os pagamentos ficam.
      expect(
        await t.db.select().from(paymentRecords).where(eq(paymentRecords.payerUserId, player.id)),
      ).toHaveLength(2);

      // Aulas: a vaga liberada vai para a espera; na outra, a fila anda.
      const fullList = await listOf(t.db, full.id);
      expect(fullList.get(player.id)?.status).toBe('CANCELLED');
      expect(fullList.get(waiting.id)).toMatchObject({
        status: 'CONFIRMED',
        waitlistPosition: null,
      });
      const otherList = await listOf(t.db, other.id);
      expect(otherList.get(player.id)?.status).toBe('CANCELLED');
      expect(otherList.get(holder.id)?.status).toBe('CONFIRMED');
      expect(otherList.get(second.id)).toMatchObject({ status: 'WAITLIST', waitlistPosition: 1 });
      expect(await notificationsOf(waiting.id, 'CLASS_WAITLIST_PROMOTED')).toHaveLength(1);

      // Anonimizada depois dos cancelamentos.
      expect(await userRow(player.id)).toMatchObject({
        name: 'Conta excluída',
        email: null,
        deletedAt: expect.any(Date),
      });

      // A exclusão é só do Super: a gestão do espaço não recebe nenhum aviso.
      expect(await Promise.all(managers.map((m) => noticesOf(m.id)))).toEqual(noticesBefore);

      const [log] = await auditOf(player.id, 'super.deletion_request.fulfill');
      expect(log).toMatchObject({ actorId: admin.id, actingAsSuper: true });
      expect(log?.diff).toMatchObject({
        requestId,
        cancelled: {
          bookings: 1,
          occurrences: occurrences.length,
          recurringBookings: 1,
          subscriptions: 1,
          attendances: 2,
        },
        promoted: 1,
        spaces: [space.id],
      });

      const mail = await t.mailer.lastTo('jogador@exemplo.com');
      expect(mail.subject).toBe('Sua conta foi excluída');
    });

    it('professor sai das listas com outro professor; sem outro, a aula fica com a conta anonimizada', async () => {
      const leaving = await member(t, 'prof-excluido@exemplo.com', space.id, 'TEACHER');
      const leavingId = await teacherMemberId(t.db, leaving.id, space.id);
      const staysId = await teacherMemberId(t.db, teacher.id, space.id);

      const shared = await insertGroup(t.db, space, leavingId);
      await t.db
        .insert(classGroupTeachers)
        .values({ classGroupId: shared.id, spaceId: space.id, teacherMemberId: staysId });
      const sole = await insertGroup(t.db, space, leavingId);
      const coTaught = await insertSession(t.db, shared, 600);
      const alone = await insertSession(t.db, sole, 600);
      await t.db.insert(teacherOccupations).values(
        [coTaught, alone].map((session) => ({
          userId: leaving.id,
          spaceId: space.id,
          classSessionId: session.id,
          period: { start: session.startsAt, end: session.endsAt },
        })),
      );

      const requestId = await requestDeletion(leaving);
      await superCall(`/v1/super/deletion-requests/${requestId}/fulfill`, {}).expect(200);

      expect(await sessionTeacherIds(t.db, coTaught.id)).toEqual([staysId]);
      const lists = await t.db
        .select({ memberId: classGroupTeachers.teacherMemberId })
        .from(classGroupTeachers)
        .where(eq(classGroupTeachers.classGroupId, shared.id));
      expect(lists).toEqual([{ memberId: staysId }]);
      const held = await t.db
        .select({ sessionId: teacherOccupations.classSessionId })
        .from(teacherOccupations)
        .where(eq(teacherOccupations.userId, leaving.id));
      expect(held).toEqual([{ sessionId: alone.id }]);

      const res = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/class-sessions/${alone.id}`)
        .set(...bearer(owner))
        .expect(200);
      expect(res.body.teachers).toMatchObject([{ memberId: leavingId, name: 'Conta excluída' }]);
    });
    it('avaliações (RN-REVIEW-06): nota e chips ficam sem autor; comentário, resposta, denúncias e pedidos saem', async () => {
      const arena = await createSpace(t.db, 'arena-exclusao-aval');
      const arenaOwner = await member(t, 'dono-aval-exc@exemplo.com', arena.id, 'OWNER');
      const leaving = await signUp(t, 'avaliador-excluido@exemplo.com', 'Lia Moraes');
      const other = await signUp(t, 'outro-avaliador@exemplo.com', 'Otávio Reis');
      for (const user of [leaving, other]) await insertBooking(t.db, arena, user, 180);
      const put = (user: SignedUp, body: object) =>
        t
          .http()
          .put(`/v1/spaces/${arena.id}/reviews/me`)
          .set(...bearer(user))
          .send(body)
          .expect(200);
      const mine = (await put(leaving, { rating: 2, tags: ['DIRTY'], comment: 'Meu nome é Lia' }))
        .body.id as string;
      const theirs = (await put(other, { rating: 5, comment: 'Ótimo' })).body.id as string;
      await t
        .http()
        .put(`/v1/manage/spaces/${arena.id}/reviews/${mine}/reply`)
        .set(...bearer(arenaOwner))
        .send({ body: 'Obrigado, Lia.' })
        .expect(200);
      await t
        .http()
        .post(`/v1/reviews/${theirs}/reports`)
        .set(...bearer(leaving))
        .send({ reason: 'FALSE_INFO' })
        .expect(204);
      await t.db.insert(reviewPrompts).values({
        userId: leaving.id,
        spaceId: arena.id,
        sourceType: 'BOOKING',
        sourceId: crypto.randomUUID(),
        sentAt: new Date(),
      });
      const before = first(await t.db.select().from(spaces).where(eq(spaces.id, arena.id)));

      const requestId = await requestDeletion(leaving);
      await superCall(`/v1/super/deletion-requests/${requestId}/fulfill`, {}).expect(200);

      const [review] = await t.db.select().from(spaceReviews).where(eq(spaceReviews.id, mine));
      expect(review).toMatchObject({
        userId: null,
        rating: 2,
        tags: ['DIRTY'],
        comment: null,
        reply: null,
        replyBy: null,
        repliedAt: null,
        counted: true,
      });
      const after = first(await t.db.select().from(spaces).where(eq(spaces.id, arena.id)));
      expect({ count: after.ratingCount, sum: after.ratingSum }).toEqual({
        count: before.ratingCount,
        sum: before.ratingSum,
      });
      expect(
        await t.db
          .select()
          .from(spaceReviewReports)
          .where(eq(spaceReviewReports.reporterUserId, leaving.id)),
      ).toEqual([]);
      expect(
        await t.db.select().from(reviewPrompts).where(eq(reviewPrompts.userId, leaving.id)),
      ).toEqual([]);
      expect(
        await t.db
          .select()
          .from(reviewCreatedNotices)
          .where(eq(reviewCreatedNotices.userId, leaving.id)),
      ).toEqual([]);

      const list = await t.http().get(`/v1/spaces/${arena.id}/reviews`).expect(200);
      const item = list.body.items.find((r: { id: string }) => r.id === mine);
      expect(item).toMatchObject({
        author: { name: 'Usuário removido', avatarUrl: null },
        rating: 2,
        comment: null,
        reply: null,
      });
      expect(JSON.stringify(list.body)).not.toContain('Lia');
    });
  });

  describe('lista', () => {
    it('pendentes primeiro, do mais antigo (vencido em destaque); depois os resolvidos', async () => {
      const old = await signUp(t, 'antigo@exemplo.com');
      const recent = await signUp(t, 'recente@exemplo.com');
      const resolved = await signUp(t, 'resolvido@exemplo.com');
      const oldId = await requestDeletion(old);
      const recentId = await requestDeletion(recent);
      const resolvedId = await requestDeletion(resolved);
      await t.db
        .update(accountDeletionRequests)
        .set({ createdAt: new Date(Date.now() - 16 * DAY_MS) })
        .where(eq(accountDeletionRequests.id, oldId));
      await superCall(`/v1/super/deletion-requests/${resolvedId}/reject`, {
        note: 'Exigência legal',
      }).expect(200);

      const items = await list();
      const ours = items.filter((row) => [oldId, recentId, resolvedId].includes(row.id as string));
      expect(ours.map((row) => row.id)).toEqual([oldId, recentId, resolvedId]);
      expect(ours.map((row) => row.overdue)).toEqual([true, false, false]);
      const firstResolved = items.findIndex((row) => row.status !== 'PENDING');
      expect(items.slice(firstResolved).every((row) => row.status !== 'PENDING')).toBe(true);
      expect(ours[2]).toMatchObject({ status: 'REJECTED', pending: null });
    });
  });

  describe('recusar', () => {
    it('exige o motivo, mantém a conta inativa, audita e avisa por e-mail', async () => {
      const user = await signUp(t, 'recusado@exemplo.com');
      const requestId = await requestDeletion(user);
      await superCall(`/v1/super/deletion-requests/${requestId}/reject`, {}).expect(400);
      const res = await superCall(`/v1/super/deletion-requests/${requestId}/reject`, {
        note: 'Suspeita de fraude',
      }).expect(200);
      expect(res.body).toMatchObject({ status: 'REJECTED', note: 'Suspeita de fraude' });
      expect((await userRow(user.id)).status).toBe('INACTIVE');
      expect(await auditOf(user.id, 'super.deletion_request.reject')).toHaveLength(1);
      const mail = await t.mailer.lastTo(user.email);
      expect(mail.subject).toBe('Seu pedido de exclusão de conta foi recusado');
      expect(mail.text).toContain('Suspeita de fraude');
      expect(mail.text).toContain('continua inativa');
    });
  });

  describe('cancelar o pedido (desistência pelo atendimento)', () => {
    it('marca CANCELLED, reativa a conta e audita; não resolve de novo', async () => {
      const user = await signUp(t, 'desistiu@exemplo.com');
      const requestId = await requestDeletion(user);
      const res = await superCall(`/v1/super/deletion-requests/${requestId}/cancel`, {
        note: 'Titular desistiu por telefone',
      }).expect(200);
      expect(res.body).toMatchObject({
        status: 'CANCELLED',
        resolvedBy: admin.id,
        note: 'Titular desistiu por telefone',
        pending: null,
      });
      expect((await userRow(user.id)).status).toBe('ACTIVE');
      await t
        .http()
        .post('/v1/auth/sign-in/email')
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      const [log] = await auditOf(user.id, 'super.deletion_request.cancel');
      expect(log?.diff).toMatchObject({ requestId, reactivated: true });

      const again = await superCall(`/v1/super/deletion-requests/${requestId}/cancel`).expect(409);
      expect(again.body.error.code).toBe('DELETION_REQUEST_RESOLVED');
      await superCall(`/v1/super/deletion-requests/${requestId}/fulfill`, {}).expect(409);
      // Um pedido novo pode ser aberto depois (as sessões antigas caíram no primeiro).
      await t
        .http()
        .post('/v1/public/deletion-request')
        .send({ email: user.email, password: PASSWORD })
        .expect(202);
      const statuses = await t.db
        .select({ status: accountDeletionRequests.status })
        .from(accountDeletionRequests)
        .where(eq(accountDeletionRequests.userId, user.id));
      expect(statuses.map((row) => row.status).sort()).toEqual(['CANCELLED', 'PENDING']);
    });

    it('conta bloqueada continua bloqueada', async () => {
      const user = await signUp(t, 'bloqueada@exemplo.com');
      const created = await superCall(`/v1/super/users/${user.id}/deletion-requests`, {}).expect(
        201,
      );
      await superCall(`/v1/super/users/${user.id}/block`, {}).expect(200);
      await superCall(`/v1/super/deletion-requests/${created.body.id}/cancel`).expect(200);
      expect((await userRow(user.id)).status).toBe('BLOCKED');
      const [log] = await auditOf(user.id, 'super.deletion_request.cancel');
      expect(log?.diff).toMatchObject({ reactivated: false });
    });

    it('só o Super', async () => {
      const user = await signUp(t, 'so-super@exemplo.com');
      const created = await superCall(`/v1/super/users/${user.id}/deletion-requests`, {}).expect(
        201,
      );
      await t
        .http()
        .post(`/v1/super/deletion-requests/${created.body.id}/cancel`)
        .set(...bearer(owner))
        .expect(403);
    });
  });
});
