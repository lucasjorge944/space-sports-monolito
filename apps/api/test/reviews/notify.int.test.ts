import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifications } from '../../src/db/schema/index.js';
import { ReviewRequestsService } from '../../src/notifications/review-requests.service.js';
import { type SignedUp, signUp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space } from '../bookings/fixtures.js';
import { createNotificationsApp, type NotificationsTestApp } from '../notifications/fakes.js';
import { insertBooking, putReview } from './helpers.js';

// AV.5 · RF-REVIEW-09 e RN-REVIEW-02: as três notificações das avaliações respeitam a preferência
// de cada pessoa e não levam texto escrito por usuário nem no push (título, corpo e dados).

describe('avaliações: notificações e preferências (AV.5, RF-REVIEW-09)', () => {
  let t: NotificationsTestApp;
  let space: Space;
  let owner: SignedUp;
  let admin: SignedUp;
  let teacher: SignedUp;
  let n = 0;

  const prefs = (user: SignedUp, type: string, value: object) =>
    t
      .http()
      .patch('/v1/me/notification-preferences')
      .set(...bearer(user))
      .send({ items: [{ type, ...value }] })
      .expect(200);
  const inbox = async (user: SignedUp, type: string) =>
    t.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, user.id), eq(notifications.type, type as 'REVIEW_CREATED')),
      );
  const pushesTo = (user: SignedUp, type: string) =>
    t.queue.pushes.filter(
      (push) =>
        push.userId === user.id && (push.data as { type?: string } | undefined)?.type === type,
    );
  const player = async (name: string) => {
    const user = await signUp(t, `notif${n++}@exemplo.com`, name);
    await insertBooking(t.db, space, user, 180);
    return user;
  };

  beforeAll(async () => {
    t = await createNotificationsApp();
    space = await createSpace(t.db, 'arena-notificacoes');
    owner = await member(t, 'dono-notif@exemplo.com', space.id, 'OWNER');
    admin = await member(t, 'admin-notif@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'prof-notif@exemplo.com', space.id, 'TEACHER');
  });
  afterAll(() => t.close());

  it('review.created: só Dono e Admin, cada um com a sua preferência; Professor nunca', async () => {
    await prefs(owner, 'REVIEW_CREATED', { push: false, inApp: false });
    const first = await player('Autora Texto Pessoal Silva');
    const pushesBefore = t.queue.pushes.length;
    await putReview(t, first, space.id, {
      rating: 4,
      comment: 'COMENTARIO_PESSOAL_NAO_VAZA',
      tags: ['GOOD_COURT'],
    }).expect(200);

    expect(await inbox(owner, 'REVIEW_CREATED')).toHaveLength(0);
    expect(await inbox(admin, 'REVIEW_CREATED')).toHaveLength(1);
    expect(await inbox(teacher, 'REVIEW_CREATED')).toHaveLength(0);
    const sent = t.queue.pushes.slice(pushesBefore);
    expect(sent.map((p) => p.userId)).toContain(admin.id);
    expect(sent.map((p) => p.userId)).not.toContain(owner.id);
    expect(sent.map((p) => p.userId)).not.toContain(teacher.id);

    // O push e o item da central não levam texto do usuário.
    for (const payload of [...sent, ...(await inbox(admin, 'REVIEW_CREATED'))]) {
      const text = JSON.stringify(payload);
      expect(text).not.toContain('COMENTARIO_PESSOAL_NAO_VAZA');
      expect(text).not.toContain('Autora');
      expect(text).not.toContain('Silva');
    }

    // Só a central desligada: o push sai e o item não é gravado.
    await prefs(admin, 'REVIEW_CREATED', { inApp: false });
    const second = await player('Outra Pessoa Souza');
    const before = t.queue.pushes.length;
    await putReview(t, second, space.id, { rating: 5 }).expect(200);
    expect(await inbox(admin, 'REVIEW_CREATED')).toHaveLength(1);
    expect(t.queue.pushes.slice(before).map((p) => p.userId)).toContain(admin.id);
  });

  it('review.replied: a preferência do autor vale; sem texto da resposta nem do Dono no push', async () => {
    const author = await player('Autor Respondido Lima');
    const review = await putReview(t, author, space.id, {
      rating: 2,
      comment: 'Atrasaram.',
    }).expect(200);
    await prefs(author, 'REVIEW_REPLIED', { push: false, inApp: false });
    const before = t.queue.pushes.length;
    await t
      .http()
      .put(`/v1/manage/spaces/${space.id}/reviews/${review.body.id}/reply`)
      .set(...bearer(owner))
      .send({ body: 'RESPOSTA_PESSOAL_NAO_VAZA, fale com Fulano de Tal' })
      .expect(200);
    expect(await inbox(author, 'REVIEW_REPLIED')).toHaveLength(0);
    expect(pushesTo(author, 'REVIEW_REPLIED')).toHaveLength(0);
    expect(t.queue.pushes.slice(before)).toHaveLength(0);

    // Outra avaliação, com a preferência ligada: avisa uma vez, sem o texto.
    const other = await player('Segundo Autor Costa');
    const second = await putReview(t, other, space.id, { rating: 3 }).expect(200);
    const pushesBefore = t.queue.pushes.length;
    await t
      .http()
      .put(`/v1/manage/spaces/${space.id}/reviews/${second.body.id}/reply`)
      .set(...bearer(admin))
      .send({ body: 'RESPOSTA_PESSOAL_NAO_VAZA, fale com Fulano de Tal' })
      .expect(200);
    const items = await inbox(other, 'REVIEW_REPLIED');
    expect(items).toHaveLength(1);
    const text = JSON.stringify([items, t.queue.pushes.slice(pushesBefore)]);
    expect(text).not.toContain('RESPOSTA_PESSOAL_NAO_VAZA');
    expect(text).not.toContain('Fulano');
    expect(text).not.toContain('Admin');
    expect(t.queue.pushes.slice(pushesBefore).map((p) => p.userId)).toContain(other.id);
  });

  it('review.request: o push também só leva o nome do espaço e ids', async () => {
    const job = t.app.get(ReviewRequestsService);
    const user = await signUp(t, `notif${n++}@exemplo.com`, 'Pessoa Nome Sensível');
    const now = new Date();
    const endsAt = new Date(now.getTime() - 3 * 60 * 60_000);
    await insertBooking(t.db, space, user, 0, {
      startsAt: new Date(endsAt.getTime() - 60 * 60_000),
      endsAt,
    });
    const before = t.queue.pushes.length;
    await job.run(now);
    const sent = pushesTo(user, 'REVIEW_REQUEST');
    expect(sent.length).toBeGreaterThan(0);
    for (const push of t.queue.pushes.slice(before)) {
      expect(JSON.stringify(push)).not.toContain('Sensível');
    }
    expect(sent[0]?.data).toMatchObject({ type: 'REVIEW_REQUEST', slug: 'arena-notificacoes' });
  });

  it('as preferências dos três tipos existem e começam ligadas', async () => {
    const user = await signUp(t, `notif${n++}@exemplo.com`, 'Pessoa Preferências');
    const res = await t
      .http()
      .get('/v1/me/notification-preferences')
      .set(...bearer(user))
      .expect(200);
    const byType = new Map<string, { push: boolean; inApp: boolean }>(
      res.body.items.map((i: { type: string; push: boolean; inApp: boolean }) => [i.type, i]),
    );
    for (const type of ['REVIEW_REQUEST', 'REVIEW_CREATED', 'REVIEW_REPLIED']) {
      expect(byType.get(type), type).toMatchObject({ push: true, inApp: true });
    }
  });
});
