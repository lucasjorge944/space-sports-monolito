import { addMinutes } from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookings, notifications, reviewPrompts, spaceReviews } from '../../src/db/schema/index.js';
import { ReviewRequestsService } from '../../src/notifications/review-requests.service.js';
import { anonymizeUser } from '../../src/users/anonymize.js';
import { type SignedUp, signUp } from '../auth/helpers.js';
import { bearer, createSpace, type Space } from '../bookings/fixtures.js';
import { createNotificationsApp, type NotificationsTestApp } from '../notifications/fakes.js';
import { insertBooking, insertClassUse, putReview } from './helpers.js';

// AV.5 · RN-REVIEW-02 (decisão 101) com o relógio controlado: o job recebe `now`, então cada
// borda (2 h, 24 h, 30 dias, 7 dias) é testada ao segundo, sem esperar nada.

const DELAY_MIN = 120;
const MIN = 60_000;
const DAY_MIN = 24 * 60;
const SEC = 1_000;
// Um "agora" fixo e redondo: os cálculos do job usam só o `now` recebido.
const NOW = new Date('2026-09-15T15:00:00.000Z');
const at = (offsetMin: number, extraSec = 0) =>
  new Date(NOW.getTime() + offsetMin * MIN + extraSec * SEC);
let n = 0;

describe('pedidos de avaliação: relógio controlado (AV.5, RN-REVIEW-02)', () => {
  let t: NotificationsTestApp;
  let job: ReviewRequestsService;
  let space: Space;

  const newUser = (name = 'Jogador Relógio') => signUp(t, `relogio${n++}@exemplo.com`, name);
  /** Reserva de 60 min que terminou exatamente em `endsAt`. */
  const bookingEnding = (user: SignedUp, endsAt: Date, target = space, status = 'CONFIRMED') =>
    insertBooking(t.db, target, user, 0, {
      startsAt: addMinutes(endsAt, -60),
      endsAt,
      status: status as 'CONFIRMED',
    });
  const promptsOf = (user: SignedUp) =>
    t.db.select().from(reviewPrompts).where(eq(reviewPrompts.userId, user.id));
  const requestsOf = (user: SignedUp) =>
    t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.type, 'REVIEW_REQUEST')));
  /** Um pedido antigo, como se o job o tivesse enviado em `sentAt`. */
  const oldPrompt = async (user: SignedUp, sentAt: Date, target = space) => {
    const [row] = await t.db
      .insert(reviewPrompts)
      .values({
        userId: user.id,
        spaceId: target.id,
        sourceType: 'BOOKING',
        sourceId: crypto.randomUUID(),
        sentAt,
      })
      .returning();
    return row;
  };

  beforeAll(async () => {
    t = await createNotificationsApp({ REVIEW_REQUEST_DELAY_MIN: String(DELAY_MIN) });
    job = t.app.get(ReviewRequestsService);
    space = await createSpace(t.db, 'arena-relogio');
  });
  afterAll(() => t.close());

  describe('janela de 2 h a 24 h (ao segundo)', () => {
    it('terminou exatamente há 2 h: pede; faltando 1 segundo: ainda não', async () => {
      const [exact, almost] = [await newUser(), await newUser()];
      await bookingEnding(exact, addMinutes(NOW, -DELAY_MIN));
      await bookingEnding(almost, addMinutes(NOW, -DELAY_MIN + 1 / 60));
      await job.run(NOW);
      expect(await promptsOf(exact)).toHaveLength(1);
      expect(await promptsOf(almost)).toHaveLength(0);
      // Um segundo depois, o segundo também entra.
      await job.run(at(0, 1));
      expect(await promptsOf(almost)).toHaveLength(1);
    });

    it('terminou exatamente há 24 h: não volta (já ficou para trás); 1 segundo a menos: ainda pede', async () => {
      const [exact, inside] = [await newUser(), await newUser()];
      await bookingEnding(exact, addMinutes(NOW, -DAY_MIN));
      await bookingEnding(inside, addMinutes(NOW, -DAY_MIN + 1 / 60));
      await job.run(NOW);
      expect(await promptsOf(exact)).toHaveLength(0);
      expect(await promptsOf(inside)).toHaveLength(1);
    });

    it('aula: as mesmas bordas', async () => {
      const [exact, almost, tooOld] = [await newUser(), await newUser(), await newUser()];
      const exactly = (endsAt: Date) => ({ startsAt: addMinutes(endsAt, -60), endsAt });
      await insertClassUse(t, space, exact, 0, 'PRESENT', exactly(addMinutes(NOW, -DELAY_MIN)));
      await insertClassUse(
        t,
        space,
        almost,
        0,
        'CONFIRMED',
        exactly(addMinutes(NOW, -DELAY_MIN + 1 / 60)),
      );
      await insertClassUse(t, space, tooOld, 0, 'PRESENT', exactly(addMinutes(NOW, -DAY_MIN)));
      await job.run(NOW);
      expect((await promptsOf(exact)).map((p) => p.sourceType)).toEqual(['CLASS_SESSION']);
      expect(await promptsOf(almost)).toHaveLength(0);
      expect(await promptsOf(tooOld)).toHaveLength(0);
    });

    it('relógio andando de 30 em 30 min por 26 h: um único pedido, na primeira rodada depois de 2 h', async () => {
      const user = await newUser();
      const early = await newUser(); // terminou 3 h antes: pede já na primeira rodada
      await bookingEnding(user, NOW);
      await bookingEnding(early, addMinutes(NOW, -180));
      const sentAt: string[] = [];
      for (let step = 0; step <= 52; step++) {
        const now = at(step * 30);
        const sent = await job.run(now);
        if (sent) sentAt.push(now.toISOString());
        // Rodar duas vezes seguidas no mesmo instante nunca repete.
        expect(await job.run(now)).toBe(0);
      }
      const [prompt] = await promptsOf(user);
      expect(await promptsOf(user)).toHaveLength(1);
      // O pedido sai na primeira rodada em que 2 h já passaram: NOW + 120 min.
      expect(prompt?.sentAt).toEqual(at(DELAY_MIN));
      expect(sentAt).toContain(at(DELAY_MIN).toISOString());
      expect(await requestsOf(user)).toHaveLength(1);
      expect(await promptsOf(early)).toHaveLength(1);
      expect((await promptsOf(early))[0]?.sentAt).toEqual(NOW);
    });
  });

  describe('um pedido por (pessoa, espaço): o uso elegível mais recente da janela', () => {
    it('se o mais recente foi cancelado ou no-show, pede pelo anterior elegível', async () => {
      const user = await newUser();
      const older = await bookingEnding(user, addMinutes(NOW, -400));
      await bookingEnding(user, addMinutes(NOW, -150), space, 'CANCELLED');
      await bookingEnding(user, addMinutes(NOW, -130), space, 'NO_SHOW');
      await job.run(NOW);
      expect((await promptsOf(user)).map((p) => p.sourceId)).toEqual([older.id]);
    });

    it('reserva e aula do mesmo espaço: um pedido só, pelo mais recente', async () => {
      const user = await newUser();
      await bookingEnding(user, addMinutes(NOW, -600));
      const session = await insertClassUse(t, space, user, 0, 'PRESENT', {
        startsAt: addMinutes(NOW, -240),
        endsAt: addMinutes(NOW, -180),
      });
      await job.run(NOW);
      expect(await promptsOf(user)).toEqual([
        expect.objectContaining({ sourceType: 'CLASS_SESSION', sourceId: session.id }),
      ]);
    });

    it('dois espaços: um pedido para cada um, no mesmo dia', async () => {
      const other = await createSpace(t.db, 'arena-relogio-2');
      const user = await newUser();
      await bookingEnding(user, addMinutes(NOW, -200));
      await bookingEnding(user, addMinutes(NOW, -210), other);
      await job.run(NOW);
      expect((await promptsOf(user)).map((p) => p.spaceId).sort()).toEqual(
        [space.id, other.id].sort(),
      );
    });

    it('o uso pulado pelos 30 dias não pede depois (o mesmo uso não vira pedido fora de hora)', async () => {
      const user = await newUser();
      await oldPrompt(user, addMinutes(NOW, -10 * DAY_MIN));
      await bookingEnding(user, addMinutes(NOW, -200));
      await job.run(NOW);
      expect(await promptsOf(user)).toHaveLength(1); // só o antigo
      // Mesmo quando os 30 dias passam, o uso já saiu da janela de 24 h.
      await job.run(at(21 * DAY_MIN));
      expect(await promptsOf(user)).toHaveLength(1);
    });
  });

  describe('intervalo de 30 dias', () => {
    it('pedido enviado há exatamente 30 dias libera; 1 segundo a menos, não', async () => {
      const [free, blocked] = [await newUser(), await newUser()];
      await oldPrompt(free, addMinutes(NOW, -30 * DAY_MIN));
      await oldPrompt(blocked, addMinutes(NOW, -30 * DAY_MIN + 1 / 60));
      for (const user of [free, blocked]) await bookingEnding(user, addMinutes(NOW, -200));
      await job.run(NOW);
      expect(await promptsOf(free)).toHaveLength(2);
      expect(await promptsOf(blocked)).toHaveLength(1);
    });

    it('o intervalo é por espaço: pedido recente de outro espaço não bloqueia', async () => {
      const other = await createSpace(t.db, 'arena-relogio-3');
      const user = await newUser();
      await oldPrompt(user, addMinutes(NOW, -DAY_MIN), other);
      await bookingEnding(user, addMinutes(NOW, -200));
      await job.run(NOW);
      expect((await promptsOf(user)).filter((p) => p.spaceId === space.id)).toHaveLength(1);
    });
  });

  describe('pedidos ignorados (sem avaliação em 7 dias)', () => {
    it('1 ignorado ainda pede; 2 ignorados param; só conta o pedido com mais de 7 dias', async () => {
      const one = await newUser();
      await oldPrompt(one, addMinutes(NOW, -40 * DAY_MIN));
      const two = await newUser();
      await oldPrompt(two, addMinutes(NOW, -40 * DAY_MIN));
      await oldPrompt(two, addMinutes(NOW, -70 * DAY_MIN));
      for (const user of [one, two]) await bookingEnding(user, addMinutes(NOW, -200));
      await job.run(NOW);
      expect(await promptsOf(one)).toHaveLength(2);
      expect(await promptsOf(two)).toHaveLength(2); // os dois antigos, nenhum novo
    });

    it('os 2 ignorados valem para sempre naquele espaço, mas não em outro', async () => {
      const other = await createSpace(t.db, 'arena-relogio-4');
      const user = await newUser();
      await oldPrompt(user, addMinutes(NOW, -400 * DAY_MIN));
      await oldPrompt(user, addMinutes(NOW, -300 * DAY_MIN));
      await bookingEnding(user, addMinutes(NOW, -200));
      await bookingEnding(user, addMinutes(NOW, -200), other);
      await job.run(NOW);
      expect((await promptsOf(user)).filter((p) => p.spaceId === space.id)).toHaveLength(2);
      expect((await promptsOf(user)).filter((p) => p.spaceId === other.id)).toHaveLength(1);
    });

    // BUG-AV5-2: "ignorado" = pedido sem `answered_at` e com mais de 7 dias. A marca é gravada
    // quando a avaliação é criada até 7 dias depois do pedido e fica se a avaliação for excluída.
    // Aqui, 1 pedido respondido (avaliou no dia seguinte pela API e excluiu) + 1 ignorado = 1
    // ignorado: pede de novo. A avaliação passa pela rota de verdade (é ela que grava a marca),
    // com o relógio real; o job roda 70 dias depois, com `now` controlado.
    it('BUG-AV5-2 · pedido respondido e depois excluído não conta como ignorado', async () => {
      const user = await newUser();
      const today = new Date();
      const answered = await oldPrompt(user, addMinutes(today, -DAY_MIN));
      await insertBooking(t.db, space, user, 180);
      await putReview(t, user, space.id, { rating: 4 }).expect(200);
      await t
        .http()
        .delete(`/v1/spaces/${space.id}/reviews/me`)
        .set(...bearer(user))
        .expect(204);
      const [marked] = await t.db
        .select()
        .from(reviewPrompts)
        .where(eq(reviewPrompts.id, answered?.id ?? ''));
      expect(marked?.answeredAt).toBeInstanceOf(Date);

      const later = addMinutes(today, 70 * DAY_MIN);
      await oldPrompt(user, addMinutes(later, -40 * DAY_MIN));
      await bookingEnding(user, addMinutes(later, -200));
      await job.run(later);
      expect(await promptsOf(user)).toHaveLength(3);
    });

    it('só os pedidos sem `answered_at` contam como ignorados', async () => {
      const user = await newUser();
      const first = await oldPrompt(user, addMinutes(NOW, -70 * DAY_MIN));
      await oldPrompt(user, addMinutes(NOW, -40 * DAY_MIN));
      // A marca (de uma avaliação já excluída) tira o primeiro da conta: volta a pedir.
      await t.db
        .update(reviewPrompts)
        .set({ answeredAt: addMinutes(first?.sentAt ?? NOW, DAY_MIN) })
        .where(eq(reviewPrompts.id, first?.id ?? ''));
      const other = await newUser();
      await oldPrompt(other, addMinutes(NOW, -70 * DAY_MIN));
      await oldPrompt(other, addMinutes(NOW, -40 * DAY_MIN));
      for (const who of [user, other]) await bookingEnding(who, addMinutes(NOW, -200));
      await job.run(NOW);
      expect(await promptsOf(user)).toHaveLength(3);
      expect(await promptsOf(other)).toHaveLength(2);
    });
  });

  describe('quem já avaliou, preferências e contas', () => {
    it('quem avaliou não recebe; excluiu a avaliação e usou de novo, volta a receber', async () => {
      const user = await newUser();
      const [review] = await t.db
        .insert(spaceReviews)
        .values({ spaceId: space.id, userId: user.id, rating: 5, authorKind: 'PLAYER' })
        .returning();
      await bookingEnding(user, addMinutes(NOW, -200));
      await job.run(NOW);
      expect(await promptsOf(user)).toHaveLength(0);
      await t.db.delete(spaceReviews).where(eq(spaceReviews.id, review?.id ?? ''));
      await job.run(addMinutes(NOW, 5));
      expect(await promptsOf(user)).toHaveLength(1);
    });

    it('preferência desligada nas duas vias: sem pedido; ligada de novo dentro de 24 h: pede', async () => {
      const user = await newUser();
      const setPrefs = (prefs: object) =>
        t
          .http()
          .patch('/v1/me/notification-preferences')
          .set(...bearer(user))
          .send({ items: [{ type: 'REVIEW_REQUEST', ...prefs }] })
          .expect(200);
      await setPrefs({ push: false, inApp: false });
      await bookingEnding(user, NOW);
      await job.run(at(DELAY_MIN + 5));
      expect(await promptsOf(user)).toHaveLength(0);
      await setPrefs({ push: true, inApp: true });
      await job.run(at(DELAY_MIN + 60));
      expect(await promptsOf(user)).toHaveLength(1);
      expect(await requestsOf(user)).toHaveLength(1);
    });

    it('só a central desligada: o push sai e o pedido fica sem item na central', async () => {
      const user = await newUser();
      await t
        .http()
        .patch('/v1/me/notification-preferences')
        .set(...bearer(user))
        .send({ items: [{ type: 'REVIEW_REQUEST', inApp: false }] })
        .expect(200);
      await bookingEnding(user, addMinutes(NOW, -200));
      const pushesBefore = t.queue.pushes.length;
      await job.run(NOW);
      const [prompt] = await promptsOf(user);
      expect(prompt).toBeDefined();
      expect(prompt?.notificationId).toBeNull();
      expect(await requestsOf(user)).toHaveLength(0);
      expect(t.queue.pushes.slice(pushesBefore).map((push) => push.userId)).toContain(user.id);
    });

    it('conta excluída (anonimizada) antes da rodada: sem pedido e sem notificação', async () => {
      const user = await newUser();
      await bookingEnding(user, addMinutes(NOW, -200));
      await anonymizeUser(t.db, user.id);
      await job.run(NOW);
      expect(await promptsOf(user)).toHaveLength(0);
      expect(await requestsOf(user)).toHaveLength(0);
    });

    it('a reserva que foi cancelada entre o fim e a rodada não pede', async () => {
      const user = await newUser();
      const booking = await bookingEnding(user, addMinutes(NOW, -200));
      await t.db.update(bookings).set({ status: 'CANCELLED' }).where(eq(bookings.id, booking.id));
      await job.run(NOW);
      expect(await promptsOf(user)).toHaveLength(0);
    });

    it('o pedido leva só o nome do espaço e ids: nenhum texto de usuário', async () => {
      const user = await newUser('Nome Pessoal Sensível');
      await bookingEnding(user, addMinutes(NOW, -200));
      await job.run(NOW);
      const [item] = await requestsOf(user);
      const text = JSON.stringify(item);
      expect(text).not.toContain('Sensível');
      expect(Object.keys(item?.data as object).sort()).toEqual(
        ['promptId', 'slug', 'source', 'sourceId', 'spaceId'].sort(),
      );
    });
  });
});
