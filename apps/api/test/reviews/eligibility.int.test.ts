import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bookings,
  notifications,
  reviewCreatedNotices,
  spaceMembers,
  spaceReviews,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space } from '../bookings/fixtures.js';
import { setSpaceStatus } from '../spaces/fixtures.js';
import {
  addParticipant,
  DAY_MIN,
  eligibility,
  insertBooking,
  insertClassUse,
  putReview,
  ratingOf,
} from './helpers.js';

// RN-REVIEW-01 (decisão 99): só quem usou o espaço avalia, conferido no servidor; uma avaliação
// por pessoa e espaço, editável; chips coerentes com a nota (decisão 100).

let users = 0;

describe('avaliações: elegibilidade e escrita (RF-REVIEW-01, RN-REVIEW-01)', () => {
  let t: TestApp;
  let space: Space;
  let owner: SignedUp;

  const newUser = (name = 'Ana Paula Souza') => signUp(t, `jogador${users++}@exemplo.com`, name);

  /** Pode avaliar (eligibility) e o PUT concorda. */
  async function expectEligible(user: SignedUp, spaceId = space.id) {
    expect(await eligibility(t, user, spaceId)).toEqual({
      canReview: true,
      canEdit: false,
      reason: null,
      myReview: null,
    });
  }

  async function expectNotEligible(user: SignedUp, spaceId = space.id) {
    expect(await eligibility(t, user, spaceId)).toEqual({
      canReview: false,
      canEdit: false,
      reason: 'REVIEW_NOT_ELIGIBLE',
      myReview: null,
    });
    const res = await putReview(t, user, spaceId, { rating: 5 }).expect(403);
    expect(res.body.error.code).toBe('REVIEW_NOT_ELIGIBLE');
  }

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-avaliacoes');
    owner = await member(t, 'dono-aval@exemplo.com', space.id, 'OWNER');
  });
  afterAll(() => t.close());

  describe('reserva', () => {
    it('terminada (organizador) dá direito; futura ou em andamento não', async () => {
      const done = await newUser();
      await insertBooking(t.db, space, done, 10);
      await expectEligible(done);

      const upcoming = await newUser();
      await insertBooking(t.db, space, upcoming, -120);
      await insertBooking(t.db, space, upcoming, -30); // em andamento: termina daqui a 30 min
      await expectNotEligible(upcoming);
    });

    it('cancelada, no-show ou aguardando pagamento não dão direito; concluída dá', async () => {
      for (const status of ['CANCELLED', 'NO_SHOW', 'PENDING_PAYMENT'] as const) {
        const user = await newUser();
        await insertBooking(t.db, space, user, 180, { status });
        await expectNotEligible(user);
      }
      const completed = await newUser();
      await insertBooking(t.db, space, completed, 180, { status: 'COMPLETED' });
      await expectEligible(completed);
    });

    it('participante que aceitou o convite pode; convidado sem aceitar ou que recusou não', async () => {
      const organizer = await newUser();
      const booking = await insertBooking(t.db, space, organizer, 180);
      const [accepted, invited, declined] = [await newUser(), await newUser(), await newUser()];
      await addParticipant(t.db, booking.id, accepted, 'ACCEPTED');
      await addParticipant(t.db, booking.id, invited, 'INVITED');
      await addParticipant(t.db, booking.id, declined, 'DECLINED');
      await expectEligible(accepted);
      await expectNotEligible(invited);
      await expectNotEligible(declined);
    });

    it('só nos últimos 6 meses', async () => {
      const old = await newUser();
      await insertBooking(t.db, space, old, 200 * DAY_MIN);
      await expectNotEligible(old);

      const recent = await newUser();
      await insertBooking(t.db, space, recent, 170 * DAY_MIN);
      await expectEligible(recent);
    });

    it('reserva em outro espaço não vale', async () => {
      const other = await createSpace(t.db, 'arena-outra-aval');
      const user = await newUser();
      await insertBooking(t.db, other, user, 180);
      await expectNotEligible(user);
      await expectEligible(user, other.id);
    });
  });

  describe('aula', () => {
    it('presença CONFIRMED ou PRESENT numa aula terminada dá direito, com o selo "Aluno"', async () => {
      for (const status of ['CONFIRMED', 'PRESENT'] as const) {
        const student = await newUser();
        await insertClassUse(t, space, student, 120, status);
        await expectEligible(student);
        const res = await putReview(t, student, space.id, { rating: 4 }).expect(200);
        expect(res.body.authorKind).toBe('STUDENT');
      }
    });

    it('falta, desistência, espera, aula cancelada ou futura não', async () => {
      for (const status of ['ABSENT', 'CANCELLED', 'WAITLIST'] as const) {
        const student = await newUser();
        await insertClassUse(t, space, student, 120, status);
        await expectNotEligible(student);
      }
      const cancelled = await newUser();
      await insertClassUse(t, space, cancelled, 120, 'CONFIRMED', { status: 'CANCELLED' });
      await expectNotEligible(cancelled);

      const future = await newUser();
      await insertClassUse(t, space, future, -DAY_MIN, 'CONFIRMED');
      await expectNotEligible(future);
    });

    it('o selo vem do uso mais recente', async () => {
      const user = await newUser();
      await insertClassUse(t, space, user, 3 * DAY_MIN, 'PRESENT');
      await insertBooking(t.db, space, user, DAY_MIN);
      const res = await putReview(t, user, space.id, { rating: 5 }).expect(200);
      expect(res.body.authorKind).toBe('PLAYER');
      await insertClassUse(t, space, user, 60, 'PRESENT');
      const edited = await putReview(t, user, space.id, { rating: 5 }).expect(200);
      expect(edited.body.authorKind).toBe('STUDENT');
    });
  });

  describe('equipe e vitrine', () => {
    it('equipe ativa não avalia o próprio espaço (403 REVIEW_NOT_ALLOWED), mesmo tendo jogado', async () => {
      for (const role of ['OWNER', 'ADMIN', 'TEACHER'] as const) {
        const staff = await member(t, `equipe-${role}@exemplo.com`, space.id, role);
        await insertBooking(t.db, space, staff, 180);
        expect(await eligibility(t, staff, space.id)).toEqual({
          canReview: false,
          canEdit: false,
          reason: 'REVIEW_NOT_ALLOWED',
          myReview: null,
        });
        const res = await putReview(t, staff, space.id, { rating: 5 }).expect(403);
        expect(res.body.error.code).toBe('REVIEW_NOT_ALLOWED');
      }
    });

    it('quem saiu da equipe volta a poder avaliar', async () => {
      const former = await member(t, 'ex-admin@exemplo.com', space.id, 'ADMIN');
      await insertBooking(t.db, space, former, 180);
      await t.db
        .update(spaceMembers)
        .set({ status: 'REMOVED' })
        .where(eq(spaceMembers.userId, former.id));
      await expectEligible(former);
    });

    it('espaço fora da vitrine: 404 na elegibilidade e no PUT; o autor ainda exclui', async () => {
      const suspended = await createSpace(t.db, 'arena-suspensa-aval');
      const user = await newUser();
      await insertBooking(t.db, suspended, user, 180);
      await putReview(t, user, suspended.id, { rating: 2 }).expect(200);
      await setSpaceStatus(t.db, suspended.id, 'SUSPENDED');

      for (const res of [
        await t
          .http()
          .get(`/v1/spaces/${suspended.id}/reviews/eligibility`)
          .set(...bearer(user)),
        await putReview(t, user, suspended.id, { rating: 3 }),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('SPACE_NOT_FOUND');
      }
      await t
        .http()
        .delete(`/v1/spaces/${suspended.id}/reviews/me`)
        .set(...bearer(user))
        .expect(204);
      expect(await ratingOf(t.db, suspended.id)).toMatchObject({ stored: { count: 0, sum: 0 } });
    });

    it('exige login; id malformado é 404', async () => {
      await t.http().get(`/v1/spaces/${space.id}/reviews/eligibility`).expect(401);
      await t.http().put(`/v1/spaces/${space.id}/reviews/me`).send({ rating: 5 }).expect(401);
      const user = await newUser();
      await t
        .http()
        .get('/v1/spaces/nao-e-uuid/reviews/eligibility')
        .set(...bearer(user))
        .expect(404);
    });
  });

  describe('uma por espaço, edição e exclusão', () => {
    it('o segundo PUT edita; a elegibilidade traz myReview', async () => {
      const user = await newUser();
      await insertBooking(t.db, space, user, 180);
      const created = await putReview(t, user, space.id, {
        rating: 2,
        tags: ['DIRTY', 'DELAYS'],
        comment: '  Atrasou 20 minutos.  ',
      }).expect(200);
      expect(created.body).toMatchObject({
        spaceId: space.id,
        rating: 2,
        tags: ['DIRTY', 'DELAYS'],
        comment: 'Atrasou 20 minutos.',
        commentHidden: false,
        authorKind: 'PLAYER',
        reply: null,
      });

      const edited = await putReview(t, user, space.id, { rating: 4, tags: ['ON_TIME'] }).expect(
        200,
      );
      expect(edited.body).toMatchObject({ id: created.body.id, rating: 4, comment: null });
      const rows = await t.db.select().from(spaceReviews).where(eq(spaceReviews.userId, user.id));
      expect(rows).toHaveLength(1);

      // Com avaliação: não cria outra, edita.
      expect(await eligibility(t, user, space.id)).toMatchObject({
        canReview: false,
        canEdit: true,
        reason: null,
        myReview: { id: created.body.id, rating: 4, tags: ['ON_TIME'] },
      });
    });

    it('quem já avaliou edita depois de um no-show e depois dos 6 meses (RN-REVIEW-01)', async () => {
      const user = await newUser();
      const booking = await insertBooking(t.db, space, user, 180);
      await putReview(t, user, space.id, { rating: 3 }).expect(200);
      // O no-show marcado depois não derruba a avaliação nem a edição.
      await t.db.update(bookings).set({ status: 'NO_SHOW' }).where(eq(bookings.id, booking.id));
      expect(await eligibility(t, user, space.id)).toMatchObject({ canEdit: true, reason: null });
      await putReview(t, user, space.id, { rating: 1 }).expect(200);

      // O único uso fica com mais de 6 meses: ainda edita; excluída, não cria de novo.
      const old = new Date(Date.now() - 200 * DAY_MIN * 60_000);
      await t.db
        .update(bookings)
        .set({ status: 'CONFIRMED', startsAt: new Date(old.getTime() - 3_600_000), endsAt: old })
        .where(eq(bookings.id, booking.id));
      expect(await eligibility(t, user, space.id)).toMatchObject({ canEdit: true, reason: null });
      await putReview(t, user, space.id, { rating: 2, tags: ['DELAYS'] }).expect(200);
      await t
        .http()
        .delete(`/v1/spaces/${space.id}/reviews/me`)
        .set(...bearer(user))
        .expect(204);
      await expectNotEligible(user);
    });

    it('createOnly=true só cria: com avaliação existente, 409 REVIEW_ALREADY_EXISTS sem mudar nada', async () => {
      const user = await newUser();
      await insertBooking(t.db, space, user, 180);
      const created = await t
        .http()
        .put(`/v1/spaces/${space.id}/reviews/me?createOnly=true`)
        .set(...bearer(user))
        .send({ rating: 4 })
        .expect(200);
      await putReview(t, user, space.id, {
        rating: 5,
        tags: ['CLEAN'],
        comment: 'Feito no outro aparelho',
      }).expect(200);
      const conflict = await t
        .http()
        .put(`/v1/spaces/${space.id}/reviews/me?createOnly=true`)
        .set(...bearer(user))
        .send({ rating: 1 })
        .expect(409);
      expect(conflict.body.error.code).toBe('REVIEW_ALREADY_EXISTS');
      const [row] = await t.db
        .select()
        .from(spaceReviews)
        .where(eq(spaceReviews.id, created.body.id));
      expect(row).toMatchObject({ rating: 5, tags: ['CLEAN'], comment: 'Feito no outro aparelho' });
      // Sem uso, o createOnly continua respondendo o motivo da elegibilidade.
      const stranger = await newUser();
      await t
        .http()
        .put(`/v1/spaces/${space.id}/reviews/me?createOnly=true`)
        .set(...bearer(stranger))
        .send({ rating: 1 })
        .expect(403);
    });

    it('quem entrou na equipe depois de avaliar não edita, mas exclui', async () => {
      const user = await newUser();
      await insertBooking(t.db, space, user, 180);
      await putReview(t, user, space.id, { rating: 5 }).expect(200);
      await t.db
        .insert(spaceMembers)
        .values({ userId: user.id, spaceId: space.id, role: 'TEACHER', status: 'ACTIVE' });
      expect(await eligibility(t, user, space.id)).toMatchObject({
        canReview: false,
        canEdit: false,
        reason: 'REVIEW_NOT_ALLOWED',
        myReview: { rating: 5 },
      });
      const res = await putReview(t, user, space.id, { rating: 1 }).expect(403);
      expect(res.body.error.code).toBe('REVIEW_NOT_ALLOWED');
      await t
        .http()
        .delete(`/v1/spaces/${space.id}/reviews/me`)
        .set(...bearer(user))
        .expect(204);
    });

    it('excluir sem avaliação: 404 REVIEW_NOT_FOUND', async () => {
      const user = await newUser();
      const res = await t
        .http()
        .delete(`/v1/spaces/${space.id}/reviews/me`)
        .set(...bearer(user))
        .expect(404);
      expect(res.body.error.code).toBe('REVIEW_NOT_FOUND');
    });
  });

  describe('chips x nota (decisão 100)', () => {
    it('positivos só com 4–5, negativos só com 1–3: 400 REVIEW_TAGS_MISMATCH', async () => {
      const user = await newUser();
      await insertBooking(t.db, space, user, 180);
      for (const body of [
        { rating: 5, tags: ['DIRTY'] },
        { rating: 3, tags: ['GOOD_COURT'] },
        { rating: 4, tags: ['CLEAN', 'EXPENSIVE'] },
      ]) {
        const res = await putReview(t, user, space.id, body).expect(400);
        expect(res.body.error.code).toBe('REVIEW_TAGS_MISMATCH');
      }
      await putReview(t, user, space.id, { rating: 3, tags: ['EXPENSIVE', 'HARD_BOOKING'] }).expect(
        200,
      );
      await putReview(t, user, space.id, {
        rating: 5,
        tags: ['GOOD_COURT', 'GOOD_SERVICE', 'CLEAN', 'ON_TIME', 'GOOD_FACILITIES'],
      }).expect(200);
    });

    it('validação: nota fora de 1–5, mais de 5 chips, chip desconhecido, comentário longo', async () => {
      const user = await newUser();
      await insertBooking(t.db, space, user, 180);
      for (const body of [
        { rating: 0 },
        { rating: 6 },
        { rating: 4.5 },
        {
          rating: 5,
          tags: ['GOOD_COURT', 'GOOD_SERVICE', 'CLEAN', 'GOOD_VALUE', 'ON_TIME', 'GOOD_FACILITIES'],
        },
        { rating: 5, tags: ['NICE'] },
        { rating: 5, comment: 'a'.repeat(501) },
      ]) {
        const res = await putReview(t, user, space.id, body).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  it('avaliação nova avisa Dono e Admin ativos (REVIEW_CREATED); a edição não', async () => {
    const admin = await member(t, 'admin-aval@exemplo.com', space.id, 'ADMIN');
    const teacher = await member(t, 'prof-aval@exemplo.com', space.id, 'TEACHER');
    const user = await newUser('Carlos Eduardo Lima');
    await insertBooking(t.db, space, user, 180);
    const createdNotices = async (id: string) =>
      (await t.db.select().from(notifications).where(eq(notifications.userId, id))).filter(
        (n) => n.type === 'REVIEW_CREATED',
      );
    const ownerBefore = (await createdNotices(owner.id)).length;
    const res = await putReview(t, user, space.id, {
      rating: 4,
      comment: 'Quadra ótima e atendimento rápido.',
    }).expect(200);
    const created = await createdNotices(owner.id);
    expect(created).toHaveLength(ownerBefore + 1);
    // RF-REVIEW-09: sem texto do usuário (nem comentário, nem nome do autor).
    expect(created.at(-1)).toMatchObject({
      title: 'Nova avaliação: ★ 4',
      body: 'O Espaço arena-avaliacoes recebeu uma avaliação. Toque para ver e responder.',
      data: { spaceId: space.id, reviewId: res.body.id },
    });
    const text = JSON.stringify(created.at(-1));
    expect(text).not.toContain('Carlos');
    expect(text).not.toContain('Quadra ótima');
    expect(await createdNotices(admin.id)).toHaveLength(1);
    expect(await createdNotices(teacher.id)).toHaveLength(0);

    // Editar, ou excluir e avaliar de novo, não avisa outra vez (marca em review_created_notices).
    await putReview(t, user, space.id, { rating: 5 }).expect(200);
    await t
      .http()
      .delete(`/v1/spaces/${space.id}/reviews/me`)
      .set(...bearer(user))
      .expect(204);
    await putReview(t, user, space.id, { rating: 3, tags: ['DIRTY'] }).expect(200);
    expect(await createdNotices(owner.id)).toHaveLength(ownerBefore + 1);
    expect(await createdNotices(admin.id)).toHaveLength(1);
    const marks = await t.db
      .select()
      .from(reviewCreatedNotices)
      .where(eq(reviewCreatedNotices.userId, user.id));
    expect(marks).toEqual([expect.objectContaining({ spaceId: space.id })]);

    // Outra pessoa avisa de novo.
    const another = await newUser('Daniela Souza');
    await insertBooking(t.db, space, another, 180);
    await putReview(t, another, space.id, { rating: 4 }).expect(200);
    expect(await createdNotices(owner.id)).toHaveLength(ownerBefore + 2);
  });
});
