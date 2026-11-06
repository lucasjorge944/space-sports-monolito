import { addMinutes, REVIEW_NEGATIVE_TAGS, REVIEW_POSITIVE_TAGS } from '@space-sports/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookings, classSessions, spaceMembers, spaceReviews } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space } from '../bookings/fixtures.js';
import { superUser } from '../super/fixtures.js';
import {
  addParticipant,
  DAY_MIN,
  eligibility,
  insertBooking,
  insertClassUse,
  putReview,
  ratingOf,
} from './helpers.js';

// AV.5 · casos de borda de RN-REVIEW-01 (elegibilidade) e da validação de RF-REVIEW-01 que a
// AV.2 não cobriu: o limite exato de 6 meses, a reserva que termina agora, todos os status de
// reserva/presença/aula/participante/equipe, e os limites de texto e chips.

let n = 0;
const MIN = 60_000;

describe('avaliações: bordas da elegibilidade e da validação (AV.5)', () => {
  let t: TestApp;
  let space: Space;

  const newUser = (name = 'Marina Alves Duarte') => signUp(t, `borda${n++}@exemplo.com`, name);
  const canReview = async (user: SignedUp, spaceId = space.id) =>
    (await eligibility(t, user, spaceId)).canReview;

  /** O instante "agora - 6 meses" como o Postgres calcula (a API usa o mesmo cálculo). */
  const sixMonthsAgo = async () => {
    const { rows } = await t.db.execute<{ since: Date | string }>(
      sql`SELECT (now() - make_interval(months => 6)) AS since`,
    );
    return new Date(rows[0]?.since ?? 0);
  };
  /** Minutos entre `at` e agora, para as fixtures que recebem "terminou há X min". */
  const minutesAgo = (at: Date) => (Date.now() - at.getTime()) / MIN;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-bordas');
  });
  afterAll(() => t.close());

  describe('limite de 6 meses', () => {
    it('reserva que terminou 5 min antes do limite vale; 5 min depois, não', async () => {
      const limit = await sixMonthsAgo();
      const inside = await newUser();
      await insertBooking(t.db, space, inside, minutesAgo(addMinutes(limit, 5)));
      const outside = await newUser();
      await insertBooking(t.db, space, outside, minutesAgo(addMinutes(limit, -5)));
      expect(await canReview(inside)).toBe(true);
      expect(await canReview(outside)).toBe(false);
      const res = await putReview(t, outside, space.id, { rating: 5 }).expect(403);
      expect(res.body.error.code).toBe('REVIEW_NOT_ELIGIBLE');
      await putReview(t, inside, space.id, { rating: 5 }).expect(200);
    });

    it('aula: mesmo limite, com o selo "Aluno"', async () => {
      const limit = await sixMonthsAgo();
      const inside = await newUser();
      await insertClassUse(t, space, inside, minutesAgo(addMinutes(limit, 5)), 'PRESENT');
      const outside = await newUser();
      await insertClassUse(t, space, outside, minutesAgo(addMinutes(limit, -5)), 'PRESENT');
      expect(await canReview(inside)).toBe(true);
      expect(await canReview(outside)).toBe(false);
    });

    it('participante aceito: o mesmo limite vale', async () => {
      const limit = await sixMonthsAgo();
      const organizer = await newUser();
      const [near, far] = [await newUser(), await newUser()];
      const inside = await insertBooking(t.db, space, organizer, minutesAgo(addMinutes(limit, 5)));
      const outside = await insertBooking(
        t.db,
        space,
        organizer,
        minutesAgo(addMinutes(limit, -5)),
      );
      await addParticipant(t.db, inside.id, near, 'ACCEPTED');
      await addParticipant(t.db, outside.id, far, 'ACCEPTED');
      expect(await canReview(near)).toBe(true);
      expect(await canReview(far)).toBe(false);
    });

    it('o uso recente vale mesmo com um uso antigo no histórico', async () => {
      const user = await newUser();
      await insertBooking(t.db, space, user, 300 * DAY_MIN);
      expect(await canReview(user)).toBe(false);
      await insertBooking(t.db, space, user, 2 * DAY_MIN);
      expect(await canReview(user)).toBe(true);
    });
  });

  describe('reserva que termina agora', () => {
    it('termina daqui a poucos segundos: ainda não; depois que termina, sim (relógio real)', async () => {
      const user = await newUser();
      const endsAt = new Date(Date.now() + 5_000);
      await insertBooking(t.db, space, user, 0, { startsAt: addMinutes(endsAt, -60), endsAt });
      expect(await canReview(user)).toBe(false);
      const res = await putReview(t, user, space.id, { rating: 4 }).expect(403);
      expect(res.body.error.code).toBe('REVIEW_NOT_ELIGIBLE');

      await new Promise((resolve) => setTimeout(resolve, 5_300));
      expect(await canReview(user)).toBe(true);
      await putReview(t, user, space.id, { rating: 4 }).expect(200);
    });

    it('terminou há 1 segundo: já vale', async () => {
      const user = await newUser();
      const endsAt = new Date(Date.now() - 1_000);
      await insertBooking(t.db, space, user, 0, { startsAt: addMinutes(endsAt, -60), endsAt });
      expect(await canReview(user)).toBe(true);
    });

    it('começou e ainda não terminou: não vale (em andamento)', async () => {
      const user = await newUser();
      const startsAt = addMinutes(new Date(), -30);
      await insertBooking(t.db, space, user, 0, { startsAt, endsAt: addMinutes(startsAt, 60) });
      expect(await canReview(user)).toBe(false);
    });

    it('aula em andamento não vale; aula que acabou de terminar vale', async () => {
      const ongoing = await newUser();
      const exact = (endsAt: Date) => ({ startsAt: addMinutes(endsAt, -60), endsAt });
      // Termina daqui a 10 min: em andamento.
      await insertClassUse(t, space, ongoing, 0, 'CONFIRMED', exact(addMinutes(new Date(), 10)));
      expect(await canReview(ongoing)).toBe(false);
      const done = await newUser();
      // Terminou há 3 s.
      await insertClassUse(t, space, done, 0, 'CONFIRMED', exact(new Date(Date.now() - 3_000)));
      expect(await canReview(done)).toBe(true);
    });
  });

  describe('todos os status (só os listados em RN-REVIEW-01 valem)', () => {
    const BOOKING_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
    it.each(BOOKING_STATUSES)('reserva %s terminada', async (status) => {
      const user = await newUser();
      await insertBooking(t.db, space, user, 180, { status: status as 'CONFIRMED' });
      expect(await canReview(user)).toBe(status === 'CONFIRMED' || status === 'COMPLETED');
    });

    const ATTENDANCE_STATUSES = [
      'CONFIRMED',
      'WAITLIST',
      'CANCELLED',
      'PRESENT',
      'ABSENT',
    ] as const;
    it.each(ATTENDANCE_STATUSES)('presença %s em aula terminada', async (status) => {
      const user = await newUser();
      await insertClassUse(t, space, user, 180, status);
      expect(await canReview(user)).toBe(status === 'CONFIRMED' || status === 'PRESENT');
    });

    const SESSION_STATUSES = ['SCHEDULED', 'OPEN', 'CLOSED', 'DONE', 'CANCELLED'] as const;
    it.each(SESSION_STATUSES)('aula %s já terminada, com presença', async (status) => {
      const user = await newUser();
      await insertClassUse(t, space, user, 180, 'PRESENT', { status });
      expect(await canReview(user)).toBe(status !== 'CANCELLED');
    });

    const PARTICIPANT_STATUSES = ['INVITED', 'ACCEPTED', 'DECLINED'] as const;
    it.each(PARTICIPANT_STATUSES)('participante %s de reserva terminada', async (status) => {
      const organizer = await newUser();
      const guest = await newUser();
      const booking = await insertBooking(t.db, space, organizer, 180);
      await addParticipant(t.db, booking.id, guest, status);
      expect(await canReview(guest)).toBe(status === 'ACCEPTED');
    });

    it('participante aceito de reserva cancelada, no-show, aguardando pagamento ou futura: não', async () => {
      const organizer = await newUser();
      for (const [status, ended] of [
        ['CANCELLED', 180],
        ['NO_SHOW', 180],
        ['PENDING_PAYMENT', 180],
        ['CONFIRMED', -180],
      ] as const) {
        const guest = await newUser();
        const booking = await insertBooking(t.db, space, organizer, ended, { status });
        await addParticipant(t.db, booking.id, guest, 'ACCEPTED');
        expect(await canReview(guest), `${status} (${ended})`).toBe(false);
      }
    });

    it('participante aceito de reserva de outro espaço não vale neste', async () => {
      const otherSpace = await createSpace(t.db, 'arena-bordas-outra');
      const organizer = await newUser();
      const guest = await newUser();
      const booking = await insertBooking(t.db, otherSpace, organizer, 180);
      await addParticipant(t.db, booking.id, guest, 'ACCEPTED');
      expect(await canReview(guest)).toBe(false);
      expect(await canReview(guest, otherSpace.id)).toBe(true);
    });

    it('reserva de balcão (sem organizador) não dá direito a ninguém', async () => {
      const user = await newUser();
      await insertBooking(t.db, space, null, 180);
      expect(await canReview(user)).toBe(false);
    });
  });

  describe('equipe', () => {
    const memberRow = (
      user: SignedUp,
      status: 'INVITED' | 'ACTIVE' | 'REMOVED',
      spaceId = space.id,
    ) =>
      t.db
        .insert(spaceMembers)
        .values({ userId: user.id, spaceId, role: 'ADMIN', status })
        .returning();

    it('convite de equipe ainda não aceito e vínculo removido não impedem; só o ACTIVE', async () => {
      for (const status of ['INVITED', 'REMOVED', 'ACTIVE'] as const) {
        const user = await newUser();
        await insertBooking(t.db, space, user, 180);
        await memberRow(user, status);
        const res = await eligibility(t, user, space.id);
        expect(res.canReview, status).toBe(status !== 'ACTIVE');
        expect(res.reason, status).toBe(status === 'ACTIVE' ? 'REVIEW_NOT_ALLOWED' : null);
      }
    });

    it('equipe de outro espaço avalia este normalmente (o impedimento é por espaço)', async () => {
      const otherSpace = await createSpace(t.db, 'arena-bordas-equipe');
      const staff = await member(t, `equipe-outra${n++}@exemplo.com`, otherSpace.id, 'OWNER');
      await insertBooking(t.db, space, staff, 180);
      expect(await canReview(staff)).toBe(true);
      await putReview(t, staff, space.id, { rating: 5 }).expect(200);
      // E no espaço onde é da equipe, não.
      await insertBooking(t.db, otherSpace, staff, 180);
      expect(await canReview(staff, otherSpace.id)).toBe(false);
    });

    it('removido da equipe avalia e depois edita; reintegrado, perde a edição mas exclui', async () => {
      const user = await newUser();
      await insertBooking(t.db, space, user, 180);
      const [row] = await memberRow(user, 'REMOVED');
      await putReview(t, user, space.id, { rating: 4 }).expect(200);
      await putReview(t, user, space.id, { rating: 3 }).expect(200);

      await t.db
        .update(spaceMembers)
        .set({ status: 'ACTIVE' })
        .where(eq(spaceMembers.id, row?.id ?? ''));
      const view = await eligibility(t, user, space.id);
      expect(view).toMatchObject({
        canReview: false,
        canEdit: false,
        reason: 'REVIEW_NOT_ALLOWED',
        myReview: { rating: 3 },
      });
      const res = await putReview(t, user, space.id, { rating: 5 }).expect(403);
      expect(res.body.error.code).toBe('REVIEW_NOT_ALLOWED');
      await t
        .http()
        .delete(`/v1/spaces/${space.id}/reviews/me`)
        .set(...bearer(user))
        .expect(204);
    });
  });

  describe('excluir, editar e voltar', () => {
    it('depois de excluir, avaliar de novo exige o uso nos últimos 6 meses', async () => {
      const user = await newUser();
      const booking = await insertBooking(t.db, space, user, 5 * DAY_MIN);
      await putReview(t, user, space.id, { rating: 5 }).expect(200);
      // O uso envelhece para além do limite.
      await t.db
        .update(bookings)
        .set({
          startsAt: addMinutes(new Date(), -400 * DAY_MIN - 60),
          endsAt: addMinutes(new Date(), -400 * DAY_MIN),
        })
        .where(eq(bookings.id, booking.id));
      // Editar continua valendo; excluir também.
      await putReview(t, user, space.id, { rating: 4 }).expect(200);
      await t
        .http()
        .delete(`/v1/spaces/${space.id}/reviews/me`)
        .set(...bearer(user))
        .expect(204);
      const res = await putReview(t, user, space.id, { rating: 5 }).expect(403);
      expect(res.body.error.code).toBe('REVIEW_NOT_ELIGIBLE');
      expect(await eligibility(t, user, space.id)).toMatchObject({
        canReview: false,
        reason: 'REVIEW_NOT_ELIGIBLE',
        myReview: null,
      });
      expect((await ratingOf(t.db, space.id)).stored).toEqual(
        (await ratingOf(t.db, space.id)).actual,
      );
    });

    it('cancelar ou marcar no-show depois de avaliar não derruba a nota nem a edição', async () => {
      const user = await newUser();
      const booking = await insertBooking(t.db, space, user, 180);
      const before = await ratingOf(t.db, space.id);
      await putReview(t, user, space.id, { rating: 2, comment: 'Faltou luz.' }).expect(200);
      await t.db.update(bookings).set({ status: 'CANCELLED' }).where(eq(bookings.id, booking.id));
      const stillThere = await eligibility(t, user, space.id);
      expect(stillThere).toMatchObject({
        canReview: false,
        canEdit: true,
        myReview: { rating: 2 },
      });
      const list = await t.http().get(`/v1/spaces/${space.id}/reviews?rating=2`).expect(200);
      expect(list.body.items.map((r: { comment: string }) => r.comment)).toContain('Faltou luz.');
      const after = await ratingOf(t.db, space.id);
      expect(after.stored.count).toBe(before.stored.count + 1);
      await putReview(t, user, space.id, { rating: 3 }).expect(200);
    });

    it('o selo do autor fica como estava quando não há mais um uso recente na edição', async () => {
      const user = await newUser();
      const session = await insertClassUse(t, space, user, 3 * DAY_MIN, 'PRESENT');
      const created = await putReview(t, user, space.id, { rating: 5 }).expect(200);
      expect(created.body.authorKind).toBe('STUDENT');
      await t.db
        .update(classSessions)
        .set({
          startsAt: addMinutes(new Date(), -400 * DAY_MIN - 60),
          endsAt: addMinutes(new Date(), -400 * DAY_MIN),
        })
        .where(eq(classSessions.id, session.id));
      const edited = await putReview(t, user, space.id, { rating: 4 }).expect(200);
      expect(edited.body.authorKind).toBe('STUDENT');
      // Uma reserva recente muda o selo para "Jogou aqui".
      await insertBooking(t.db, space, user, 60);
      const again = await putReview(t, user, space.id, { rating: 4 }).expect(200);
      expect(again.body.authorKind).toBe('PLAYER');
    });

    it('createOnly em paralelo: uma cria, a outra recebe 409; nunca duas linhas nem 5xx', async () => {
      const user = await newUser();
      await insertBooking(t.db, space, user, 180);
      const results = await Promise.all(
        [5, 4, 3, 2].map((rating) =>
          t
            .http()
            .put(`/v1/spaces/${space.id}/reviews/me?createOnly=true`)
            .set(...bearer(user))
            .send({ rating }),
        ),
      );
      const statuses = results.map((res) => res.status).sort();
      expect(statuses).toEqual([200, 409, 409, 409]);
      const rows = await t.db.select().from(spaceReviews).where(eq(spaceReviews.userId, user.id));
      expect(rows).toHaveLength(1);
      const { stored, actual } = await ratingOf(t.db, space.id);
      expect(stored).toEqual(actual);
    });

    it('PUT substitui: sem chips e sem comentário no corpo, os anteriores saem', async () => {
      const user = await newUser();
      await insertBooking(t.db, space, user, 180);
      await putReview(t, user, space.id, {
        rating: 5,
        tags: ['CLEAN', 'GOOD_COURT'],
        comment: 'Tudo certo',
      }).expect(200);
      const res = await putReview(t, user, space.id, { rating: 4 }).expect(200);
      expect(res.body).toMatchObject({ rating: 4, tags: [], comment: null });
    });
  });

  describe('validação do corpo (RF-REVIEW-01, decisão 100)', () => {
    let user: SignedUp;
    beforeAll(async () => {
      user = await newUser();
      await insertBooking(t.db, space, user, 180);
    });

    it('comentário de 500 caracteres vale; 501, não', async () => {
      const ok = await putReview(t, user, space.id, { rating: 5, comment: 'a'.repeat(500) });
      expect(ok.status).toBe(200);
      expect(ok.body.comment).toHaveLength(500);
      const tooLong = await putReview(t, user, space.id, { rating: 5, comment: 'a'.repeat(501) });
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('o limite conta caracteres, não unidades UTF-16: 500 emojis valem, 501 não', async () => {
      const ok = await putReview(t, user, space.id, { rating: 5, comment: '😀'.repeat(500) });
      expect(ok.status).toBe(200);
      expect(Array.from(ok.body.comment as string)).toHaveLength(500);
      const tooLong = await putReview(t, user, space.id, { rating: 5, comment: '😀'.repeat(501) });
      expect(tooLong.status).toBe(400);
    });

    it('comentário só de espaços vira "sem comentário"; espaços nas pontas saem', async () => {
      const blank = await putReview(t, user, space.id, { rating: 5, comment: '   \n  ' }).expect(
        200,
      );
      expect(blank.body.comment).toBeNull();
      const trimmed = await putReview(t, user, space.id, {
        rating: 5,
        comment: '  Ótimo  ',
      }).expect(200);
      expect(trimmed.body.comment).toBe('Ótimo');
    });

    it('nota inválida: 0, 6, 4.5, texto, nula e ausente → 400', async () => {
      for (const rating of [0, 6, 4.5, '5', null, -1]) {
        const res = await putReview(t, user, space.id, { rating });
        expect(res.status, JSON.stringify(rating)).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
      await putReview(t, user, space.id, {}).expect(400);
    });

    it('chips: 5 valem; 6, repetidos, desconhecidos, minúsculos ou fora de lista → 400', async () => {
      const five = REVIEW_POSITIVE_TAGS.slice(0, 5);
      await putReview(t, user, space.id, { rating: 5, tags: five }).expect(200);
      await putReview(t, user, space.id, {
        rating: 5,
        tags: REVIEW_POSITIVE_TAGS.slice(0, 6),
      }).expect(400);
      await putReview(t, user, space.id, { rating: 5, tags: ['CLEAN', 'CLEAN'] }).expect(400);
      await putReview(t, user, space.id, { rating: 5, tags: ['clean'] }).expect(400);
      await putReview(t, user, space.id, { rating: 5, tags: ['AWESOME'] }).expect(400);
      await putReview(t, user, space.id, { rating: 5, tags: 'CLEAN' }).expect(400);
      await putReview(t, user, space.id, { rating: 5, tags: [null] }).expect(400);
    });

    it('cada chip só combina com as notas do seu lado (16 chips x 5 notas)', async () => {
      for (const rating of [1, 2, 3, 4, 5]) {
        for (const tag of [...REVIEW_POSITIVE_TAGS, ...REVIEW_NEGATIVE_TAGS]) {
          const positive = (REVIEW_POSITIVE_TAGS as readonly string[]).includes(tag);
          const res = await putReview(t, user, space.id, { rating, tags: [tag] });
          const allowed = positive ? rating >= 4 : rating <= 3;
          expect(res.status, `${tag} com nota ${rating}`).toBe(allowed ? 200 : 400);
          if (!allowed) expect(res.body.error.code).toBe('REVIEW_TAGS_MISMATCH');
        }
      }
    });

    it('campos desconhecidos e corpos que não são objeto → 400', async () => {
      await putReview(t, user, space.id, { rating: 5, authorKind: 'STUDENT' }).expect(400);
      await putReview(t, user, space.id, { rating: 5, counted: false }).expect(400);
      await putReview(t, user, space.id, { rating: 5, reply: 'eu mesmo respondo' }).expect(400);
      await t
        .http()
        .put(`/v1/spaces/${space.id}/reviews/me`)
        .set(...bearer(user))
        .send('5')
        .expect(400);
      await t
        .http()
        .put(`/v1/spaces/${space.id}/reviews/me`)
        .set(...bearer(user))
        .set('content-type', 'application/json')
        .send('{"rating": 5,')
        .expect(400);
    });

    it('nada disso grava lixo: a avaliação segue a última válida', async () => {
      const rows = await t.db.select().from(spaceReviews).where(eq(spaceReviews.userId, user.id));
      expect(rows).toHaveLength(1);
      const { stored, actual } = await ratingOf(t.db, space.id);
      expect(stored).toEqual(actual);
    });

    it('HTML no comentário é guardado como texto, sem alteração', async () => {
      const text = '<script>alert(1)</script> & "aspas"';
      const res = await putReview(t, user, space.id, { rating: 5, comment: text }).expect(200);
      expect(res.body.comment).toBe(text);
      const list = await t.http().get(`/v1/spaces/${space.id}/reviews`).expect(200);
      expect(list.body.items.some((r: { comment: string }) => r.comment === text)).toBe(true);
    });
  });

  describe('validação das outras entradas', () => {
    let author: SignedUp;
    let owner: SignedUp;
    let platform: SignedUp;
    let reviewId: string;
    let arenaId: string;
    beforeAll(async () => {
      const arena = await createSpace(t.db, 'arena-bordas-entrada');
      owner = await member(t, `dono-borda${n++}@exemplo.com`, arena.id, 'OWNER');
      platform = await superUser(t, `super-borda${n++}@exemplo.com`);
      author = await newUser();
      await insertBooking(t.db, arena, author, 180);
      const res = await putReview(t, author, arena.id, { rating: 2, comment: 'Ruim' }).expect(200);
      reviewId = res.body.id;
      arenaId = arena.id;
    });
    const reply = (body: unknown) =>
      t
        .http()
        .put(`/v1/manage/spaces/${arenaId}/reviews/${reviewId}/reply`)
        .set(...bearer(owner))
        .send(body as object);

    it('resposta: 500 vale; vazia, só espaços, 501 e campo extra → 400', async () => {
      await reply({ body: 'r'.repeat(500) }).expect(200);
      for (const body of [
        { body: '' },
        { body: '   ' },
        { body: 'r'.repeat(501) },
        {},
        { body: 1 },
      ]) {
        const res = await reply(body);
        expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      }
      await reply({ body: 'ok', by: 'alguém' }).expect(400);
      const [row] = await t.db.select().from(spaceReviews).where(eq(spaceReviews.id, reviewId));
      expect(row?.reply).toBe('r'.repeat(500));
    });

    it('denúncia: motivo obrigatório e da lista; detalhes até 500', async () => {
      const report = (body: unknown, who: SignedUp) =>
        t
          .http()
          .post(`/v1/reviews/${reviewId}/reports`)
          .set(...bearer(who))
          .send(body as object);
      const reporters = [await newUser(), await newUser(), await newUser()];
      for (const body of [
        {},
        { reason: 'RUDE' },
        { reason: 'spam' },
        { reason: 'SPAM', details: 'x'.repeat(501) },
      ]) {
        const res = await report(body, reporters[0] as SignedUp);
        expect(res.status, JSON.stringify(body).slice(0, 50)).toBe(400);
      }
      await report({ reason: 'OTHER', details: 'x'.repeat(500) }, reporters[0] as SignedUp).expect(
        204,
      );
      await report({ reason: 'SPAM', details: '   ' }, reporters[1] as SignedUp).expect(204);
      await report({ reason: 'PERSONAL_DATA' }, reporters[2] as SignedUp).expect(204);
    });

    it('moderação: motivo obrigatório (vazio e 501 → 400)', async () => {
      const hide = (body: unknown) =>
        t
          .http()
          .post(`/v1/super/reviews/${reviewId}/hide`)
          .set(...bearer(platform))
          .send(body as object);
      for (const body of [{}, { reason: '' }, { reason: '  ' }, { reason: 'm'.repeat(501) }]) {
        expect((await hide(body)).status, JSON.stringify(body).slice(0, 30)).toBe(400);
      }
      await hide({ reason: 'm'.repeat(500) }).expect(200);
    });

    it('consultas: nota, limite, cursor e filtros inválidos → 400; limite máximo respeitado', async () => {
      const get = (url: string) => t.http().get(url);
      const base = `/v1/spaces/${arenaId}/reviews`;
      for (const query of [
        'rating=0',
        'rating=6',
        'rating=1.5',
        'rating=abc',
        'limit=0',
        'limit=-1',
        'limit=abc',
        'cursor=%25%25',
        'cursor=',
      ]) {
        const res = await get(`${base}?${query}`);
        expect(res.status, query).toBe(400);
      }
      // O limite máximo é 100 por página: 100 vale; 101 e muito acima, não.
      expect((await get(`${base}?limit=100`)).status).toBe(200);
      for (const limit of [101, 100000]) {
        const res = await get(`${base}?limit=${limit}`);
        expect(res.status, `limit=${limit}`).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
      const manageBase = `/v1/manage/spaces/${arenaId}/reviews`;
      for (const query of ['unanswered=talvez', 'rating=9', 'trend=MONTH']) {
        const path = query.startsWith('trend') ? `${manageBase}/summary` : manageBase;
        const res = await get(`${path}?${query}`).set(...bearer(owner));
        expect(res.status, query).toBe(400);
      }
      // Cursor de outro formato (válido em base64, inválido no conteúdo) → INVALID_CURSOR.
      const forged = Buffer.from(JSON.stringify(['ontem', 'não-é-uuid'])).toString('base64url');
      const res = await get(`${base}?cursor=${forged}`).expect(400);
      expect(res.body.error.code).toBe('INVALID_CURSOR');
    });
  });
});
