import { reviewAverage } from '@space-sports/shared';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spaceReviews, users } from '../../src/db/schema/index.js';
import { anonymizeUser } from '../../src/users/anonymize.js';
import { createTestApp, PASSWORD, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space } from '../bookings/fixtures.js';
import { superUser } from '../super/fixtures.js';
import { insertBooking, putReview, ratingOf } from './helpers.js';

// AV.5 · RN-REVIEW-03 e 06: `rating_count`/`rating_sum` do espaço batem com a soma real das
// avaliações que contam, depois de QUALQUER sequência de criar, editar, excluir, bloquear,
// desbloquear, anonimizar, ocultar, responder e denunciar. Um oráculo em memória (o modelo) é
// comparado ao banco e à API pública a cada passo; as sequências são pseudoaleatórias com
// semente fixa (reproduzíveis).

type UserState = { user: SignedUp; status: 'ACTIVE' | 'BLOCKED' | 'DELETED' };
type Entry = { id: string; userId: string | null; rating: number; counted: boolean };

/** PRNG pequeno e determinístico (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let emailN = 0;

describe('avaliações: invariantes de contagem e soma (RN-REVIEW-03, RN-REVIEW-06; AV.5)', () => {
  let t: TestApp;
  let platform: SignedUp;

  const superCall = (method: 'post', path: string, body: object = {}) =>
    t
      .http()
      [method](path)
      .set(...bearer(platform))
      .send(body);
  const block = (u: SignedUp) => superCall('post', `/v1/super/users/${u.id}/block`);
  const unblock = (u: SignedUp) => superCall('post', `/v1/super/users/${u.id}/unblock`);
  const signIn = async (u: SignedUp) => {
    const res = await t
      .http()
      .post('/v1/auth/sign-in/email')
      .send({ email: u.email, password: PASSWORD })
      .expect(200);
    return res.headers['set-auth-token'] as string;
  };

  beforeAll(async () => {
    t = await createTestApp();
    platform = await superUser(t, 'super-inv@exemplo.com');
  });
  afterAll(() => t.close());

  /** Confere o banco e a API pública contra a soma real e (se dado) contra o modelo. */
  async function expectConsistent(
    spacesToCheck: Space[],
    people: UserState[],
    model?: Map<string, Map<string, Entry>>,
  ) {
    const status = new Map(people.map((p) => [p.user.id, p.status]));
    for (const space of spacesToCheck) {
      const rows = await t.db.select().from(spaceReviews).where(eq(spaceReviews.spaceId, space.id));
      const counted = rows.filter((row) => row.counted);
      const expected = {
        count: counted.length,
        sum: counted.reduce((acc, row) => acc + row.rating, 0),
      };

      // I1: o guardado no espaço é a soma real.
      const { stored, actual } = await ratingOf(t.db, space.id);
      expect(stored, 'rating_count/rating_sum guardados').toEqual(expected);
      expect(actual).toEqual(expected);

      // I2: quem tem autor conta se e só se a conta não está bloqueada.
      for (const row of rows) {
        if (row.userId === null) continue;
        expect(row.counted, `avaliação de ${row.userId}`).toBe(
          status.get(row.userId) !== 'BLOCKED',
        );
      }
      // Nota sempre de 1 a 5; uma avaliação por pessoa.
      const authors = rows.flatMap((row) => (row.userId ? [row.userId] : []));
      expect(new Set(authors).size).toBe(authors.length);

      // Oráculo: o modelo em memória.
      if (model) {
        const entries = [...(model.get(space.id)?.values() ?? [])];
        expect(rows.map((r) => r.id).sort()).toEqual(entries.map((e) => e.id).sort());
        for (const entry of entries) {
          const row = rows.find((r) => r.id === entry.id);
          expect(row, `avaliação ${entry.id}`).toMatchObject({
            rating: entry.rating,
            counted: entry.counted,
            userId: entry.userId,
          });
        }
      }

      // I3: a API pública mostra o mesmo.
      const summary = (await t.http().get(`/v1/spaces/${space.id}/reviews/summary`).expect(200))
        .body;
      expect(summary.count).toBe(expected.count);
      expect(summary.average).toBe(reviewAverage(expected.sum, expected.count));
      const distribution = new Map<number, number>(
        summary.distribution.map((d: { rating: number; count: number }) => [d.rating, d.count]),
      );
      for (const rating of [1, 2, 3, 4, 5]) {
        expect(distribution.get(rating)).toBe(counted.filter((r) => r.rating === rating).length);
      }
      const listed = (await t.http().get(`/v1/spaces/${space.id}/reviews?limit=100`).expect(200))
        .body.items as Array<{
        id: string;
        rating: number;
        comment: string | null;
        commentHidden: boolean;
      }>;
      expect(listed.map((r) => r.id).sort()).toEqual(counted.map((r) => r.id).sort());
      for (const item of listed) {
        const row = rows.find((r) => r.id === item.id);
        expect(item.commentHidden).toBe(row?.commentHiddenAt != null);
        if (item.commentHidden) expect(item.comment).toBeNull();
        // Anonimizada: sem comentário.
        if (row?.userId === null && row.comment === null) expect(item.comment).toBeNull();
      }
      // A lista pública traz exatamente as que contam (nem uma a mais, nem a menos).
      expect(listed.length).toBe(expected.count);

      // A média do painel (mesmo abaixo de 5) bate com a soma.
      const owner = ownerOf.get(space.id);
      if (owner) {
        const manage = (
          await t
            .http()
            .get(`/v1/manage/spaces/${space.id}/reviews/summary`)
            .set(...bearer(owner))
            .expect(200)
        ).body;
        expect(manage.count).toBe(expected.count);
        expect(manage.average).toBe(reviewAverage(expected.sum, expected.count, 1));
        expect(
          manage.distribution.reduce((acc: number, d: { count: number }) => acc + d.count, 0),
        ).toBe(expected.count);
      }
    }
  }

  const ownerOf = new Map<string, SignedUp>();

  async function world(prefix: string, userCount: number) {
    const spacesOf = [
      await createSpace(t.db, `${prefix}-a`),
      await createSpace(t.db, `${prefix}-b`),
    ];
    const owners = await Promise.all(
      spacesOf.map((space, i) =>
        member(t, `dono-${prefix}-${i}-${emailN++}@exemplo.com`, space.id, 'OWNER'),
      ),
    );
    for (const [i, space] of spacesOf.entries()) ownerOf.set(space.id, owners[i] as SignedUp);
    const people: UserState[] = [];
    for (let i = 0; i < userCount; i++) {
      const user = await signUp(t, `inv${emailN++}@exemplo.com`, `Pessoa ${i} Sobrenome`);
      for (const space of spacesOf) await insertBooking(t.db, space, user, 180);
      people.push({ user, status: 'ACTIVE' });
    }
    return { spacesOf, owners, people };
  }

  // -------------------------------------------------------------------------------------------
  describe('cenários dirigidos', () => {
    it('bloqueada e depois excluída: a nota continua fora da média, sem autor, e desbloquear não a devolve', async () => {
      const { spacesOf, people } = await world('inv-dir1', 3);
      const [space] = spacesOf as [Space];
      const [good, bad, third] = people as [UserState, UserState, UserState];
      await putReview(t, good.user, space.id, { rating: 5 }).expect(200);
      await putReview(t, bad.user, space.id, { rating: 1, comment: 'Péssimo' }).expect(200);
      await putReview(t, third.user, space.id, { rating: 3 }).expect(200);
      await expectConsistent([space], people);
      expect((await ratingOf(t.db, space.id)).stored).toEqual({ count: 3, sum: 9 });

      await block(bad.user).expect(200);
      bad.status = 'BLOCKED';
      await expectConsistent([space], people);
      expect((await ratingOf(t.db, space.id)).stored).toEqual({ count: 2, sum: 8 });

      // A conta é excluída enquanto bloqueada (RN-REVIEW-06).
      expect(await anonymizeUser(t.db, bad.user.id)).toBe(true);
      bad.status = 'BLOCKED'; // o status da conta não muda na anonimização
      await expectConsistent([space], people);
      const [row] = await t.db
        .select()
        .from(spaceReviews)
        .where(eq(spaceReviews.spaceId, space.id))
        .then((rows) => rows.filter((r) => r.rating === 1));
      expect(row).toMatchObject({ userId: null, comment: null, counted: false });

      // Desbloquear a conta já excluída não devolve a nota à média.
      const res = await unblock(bad.user);
      expect(res.status).toBeLessThan(500);
      await expectConsistent([space], people);
      expect((await ratingOf(t.db, space.id)).stored).toEqual({ count: 2, sum: 8 });
      const list = await t.http().get(`/v1/spaces/${space.id}/reviews`).expect(200);
      expect(list.body.items).toHaveLength(2);
    });

    it('excluída com a nota na média: a contagem e a soma não mudam, e o ex-autor não mexe mais', async () => {
      const { spacesOf, people, owners } = await world('inv-dir2', 2);
      const [space] = spacesOf as [Space];
      const [leaving, staying] = people as [UserState, UserState];
      const created = await putReview(t, leaving.user, space.id, {
        rating: 2,
        tags: ['DIRTY'],
        comment: 'Texto pessoal',
      }).expect(200);
      await putReview(t, staying.user, space.id, { rating: 4 }).expect(200);
      await t
        .http()
        .put(`/v1/manage/spaces/${space.id}/reviews/${created.body.id}/reply`)
        .set(...bearer(owners[0] as SignedUp))
        .send({ body: 'Resposta citando o autor' })
        .expect(200);
      const before = await ratingOf(t.db, space.id);

      expect(await anonymizeUser(t.db, leaving.user.id)).toBe(true);
      leaving.status = 'DELETED';
      await expectConsistent([space], people);
      expect((await ratingOf(t.db, space.id)).stored).toEqual(before.stored);

      const list = await t.http().get(`/v1/spaces/${space.id}/reviews`).expect(200);
      const item = list.body.items.find((r: { id: string }) => r.id === created.body.id);
      expect(item).toMatchObject({
        rating: 2,
        tags: ['DIRTY'],
        comment: null,
        reply: null,
        author: { name: 'Usuário removido', avatarUrl: null },
      });

      // A sessão do ex-autor caiu: não edita, não exclui; a nota segue como estava.
      await putReview(t, leaving.user, space.id, { rating: 5 }).expect(401);
      await t
        .http()
        .delete(`/v1/spaces/${space.id}/reviews/me`)
        .set(...bearer(leaving.user))
        .expect(401);
      // Ninguém mais consegue alterá-la pela API de jogador: a "minha" de outro não é esta.
      await t
        .http()
        .delete(`/v1/spaces/${space.id}/reviews/me`)
        .set(...bearer(staying.user))
        .expect(204);
      expect((await ratingOf(t.db, space.id)).stored).toEqual({ count: 1, sum: 2 });
      await expectConsistent([space], people);
    });

    it('a mesma pessoa bloqueada, desbloqueada e bloqueada de novo em dois espaços', async () => {
      const { spacesOf, people } = await world('inv-dir3', 2);
      const [a, b] = spacesOf as [Space, Space];
      const [flip, steady] = people as [UserState, UserState];
      for (const space of spacesOf) {
        await putReview(t, flip.user, space.id, { rating: 1 }).expect(200);
        await putReview(t, steady.user, space.id, { rating: 5 }).expect(200);
      }
      for (let round = 0; round < 3; round++) {
        await block(flip.user).expect(200);
        flip.status = 'BLOCKED';
        await expectConsistent([a, b], people);
        expect((await ratingOf(t.db, a.id)).stored).toEqual({ count: 1, sum: 5 });
        await unblock(flip.user).expect(200);
        flip.status = 'ACTIVE';
        flip.user = { ...flip.user, token: await signIn(flip.user) };
        await expectConsistent([a, b], people);
        expect((await ratingOf(t.db, b.id)).stored).toEqual({ count: 2, sum: 6 });
      }
      // Bloquear duas vezes seguidas não desconta duas vezes.
      await block(flip.user).expect(200);
      await block(flip.user);
      flip.status = 'BLOCKED';
      await expectConsistent([a, b], people);
      await unblock(flip.user);
      await unblock(flip.user);
      flip.status = 'ACTIVE';
      await expectConsistent([a, b], people);
    });

    it('conta bloqueada não cria, edita nem exclui avaliação (401/403) e nada muda', async () => {
      const { spacesOf, people } = await world('inv-dir4', 2);
      const [space] = spacesOf as [Space];
      const [victim] = people as [UserState, UserState];
      await putReview(t, victim.user, space.id, { rating: 4 }).expect(200);
      await block(victim.user).expect(200);
      victim.status = 'BLOCKED';
      for (const res of [
        await putReview(t, victim.user, space.id, { rating: 1 }),
        await t
          .http()
          .delete(`/v1/spaces/${space.id}/reviews/me`)
          .set(...bearer(victim.user)),
      ]) {
        expect([401, 403]).toContain(res.status);
      }
      await expectConsistent([space], people);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('sequências pseudoaleatórias (semente fixa)', () => {
    it.each([11, 2026, 90210])(
      'semente %i: 120 passos, invariantes conferidos a cada passo',
      async (seed) => {
        const random = rng(seed);
        const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)] as T;
        const { spacesOf, owners, people } = await world(`inv-r${seed}`, 7);
        const model = new Map<string, Map<string, Entry>>(spacesOf.map((s) => [s.id, new Map()]));
        const active = () => people.filter((p) => p.status === 'ACTIVE');
        const blocked = () => people.filter((p) => p.status === 'BLOCKED');
        let anonymized = 0;
        const log: string[] = [];

        const entryOf = (space: Space, person: UserState) =>
          model.get(space.id)?.get(person.user.id);
        /** Reconstrói o modelo a partir do banco (depois de passos concorrentes). */
        const resync = async () => {
          for (const space of spacesOf) {
            const rows = await t.db
              .select()
              .from(spaceReviews)
              .where(eq(spaceReviews.spaceId, space.id));
            const fresh = new Map<string, Entry>();
            for (const row of rows) {
              fresh.set(row.userId ?? `anon-${row.id}`, {
                id: row.id,
                userId: row.userId,
                rating: row.rating,
                counted: row.counted,
              });
            }
            model.set(space.id, fresh);
          }
        };

        const ops: Array<{ weight: number; name: string; run: () => Promise<void> }> = [
          {
            weight: 28,
            name: 'avaliar/editar',
            run: async () => {
              const person = pick(active());
              const space = pick(spacesOf);
              const rating = 1 + Math.floor(random() * 5);
              const comment =
                random() < 0.6 ? `Comentário ${Math.floor(random() * 1e6)}` : undefined;
              const res = await putReview(t, person.user, space.id, { rating, comment }).expect(
                200,
              );
              const previous = entryOf(space, person);
              model.get(space.id)?.set(person.user.id, {
                id: res.body.id,
                userId: person.user.id,
                rating,
                counted: previous?.counted ?? true,
              });
              log.push(`put ${person.user.id.slice(0, 4)} ${space.id.slice(0, 4)} ${rating}`);
            },
          },
          {
            weight: 12,
            name: 'excluir',
            run: async () => {
              const person = pick(active());
              const space = pick(spacesOf);
              const had = entryOf(space, person);
              const res = await t
                .http()
                .delete(`/v1/spaces/${space.id}/reviews/me`)
                .set(...bearer(person.user));
              expect(res.status).toBe(had ? 204 : 404);
              if (had) model.get(space.id)?.delete(person.user.id);
              log.push(`delete ${person.user.id.slice(0, 4)} ${space.id.slice(0, 4)}`);
            },
          },
          {
            weight: 10,
            name: 'bloquear',
            run: async () => {
              if (active().length <= 2) return;
              const person = pick(active());
              await block(person.user).expect(200);
              person.status = 'BLOCKED';
              for (const entries of model.values()) {
                const entry = entries.get(person.user.id);
                if (entry) entry.counted = false;
              }
              log.push(`block ${person.user.id.slice(0, 4)}`);
            },
          },
          {
            weight: 9,
            name: 'desbloquear',
            run: async () => {
              const candidates = blocked();
              if (!candidates.length) return;
              const person = pick(candidates);
              await unblock(person.user).expect(200);
              person.status = 'ACTIVE';
              person.user = { ...person.user, token: await signIn(person.user) };
              for (const entries of model.values()) {
                const entry = entries.get(person.user.id);
                if (entry) entry.counted = true;
              }
              log.push(`unblock ${person.user.id.slice(0, 4)}`);
            },
          },
          {
            weight: 4,
            name: 'anonimizar',
            run: async () => {
              if (anonymized >= 3) return;
              const candidates = people.filter((p) => p.status !== 'DELETED');
              if (candidates.length <= 3) return;
              const person = pick(candidates);
              if (person.status === 'ACTIVE' && active().length <= 3) return;
              expect(await anonymizeUser(t.db, person.user.id)).toBe(true);
              // O status BLOCKED (se havia) fica na conta; a ACTIVE segue ACTIVE no banco, mas a
              // pessoa sai do sorteio: não tem mais sessão.
              const wasBlocked = person.status === 'BLOCKED';
              person.status = 'DELETED';
              anonymized++;
              for (const entries of model.values()) {
                const entry = entries.get(person.user.id);
                if (!entry) continue;
                entries.delete(person.user.id);
                entries.set(`anon-${entry.id}`, { ...entry, userId: null });
                expect(entry.counted).toBe(!wasBlocked);
              }
              // No banco o status continua o de antes: o I2 precisa saber.
              deletedStatus.set(person.user.id, wasBlocked ? 'BLOCKED' : 'ACTIVE');
              log.push(`anonymize ${person.user.id.slice(0, 4)}`);
            },
          },
          {
            weight: 8,
            name: 'ocultar/reexibir comentário',
            run: async () => {
              const rows = await t.db
                .select()
                .from(spaceReviews)
                .where(
                  inArray(
                    spaceReviews.spaceId,
                    spacesOf.map((s) => s.id),
                  ),
                );
              const withComment = rows.filter((r) => r.comment);
              if (!withComment.length) return;
              const row = pick(withComment);
              const action = row.commentHiddenAt ? 'unhide' : 'hide';
              await superCall('post', `/v1/super/reviews/${row.id}/${action}`, {
                reason: 'Teste de invariantes',
              }).expect(200);
              log.push(`${action} ${row.id.slice(0, 4)}`);
            },
          },
          {
            weight: 6,
            name: 'responder',
            run: async () => {
              const rows = await t.db
                .select()
                .from(spaceReviews)
                .where(
                  inArray(
                    spaceReviews.spaceId,
                    spacesOf.map((s) => s.id),
                  ),
                );
              // A gestão só vê as que aparecem em público (autor bloqueado fica de fora).
              const visible = rows.filter((r) => r.counted);
              if (!visible.length) return;
              const row = pick(visible);
              const owner = owners[spacesOf.findIndex((s) => s.id === row.spaceId)] as SignedUp;
              await t
                .http()
                .put(`/v1/manage/spaces/${row.spaceId}/reviews/${row.id}/reply`)
                .set(...bearer(owner))
                .send({ body: 'Obrigado pelo retorno.' })
                .expect(200);
              log.push(`reply ${row.id.slice(0, 4)}`);
            },
          },
          {
            weight: 5,
            name: 'denunciar',
            run: async () => {
              const rows = await t.db
                .select()
                .from(spaceReviews)
                .where(
                  inArray(
                    spaceReviews.spaceId,
                    spacesOf.map((s) => s.id),
                  ),
                );
              const reportable = rows.filter((r) => r.counted && r.userId);
              if (!reportable.length) return;
              const row = pick(reportable);
              const reporter = active().find((p) => p.user.id !== row.userId);
              if (!reporter) return;
              const res = await t
                .http()
                .post(`/v1/reviews/${row.id}/reports`)
                .set(...bearer(reporter.user))
                .send({ reason: 'OFFENSIVE' });
              expect([204, 409]).toContain(res.status);
              log.push(`report ${row.id.slice(0, 4)}`);
            },
          },
          {
            weight: 8,
            name: 'bloqueada tenta alterar',
            run: async () => {
              const candidates = blocked();
              if (!candidates.length) return;
              const person = pick(candidates);
              const space = pick(spacesOf);
              const put = await putReview(t, person.user, space.id, { rating: 5 });
              expect([401, 403]).toContain(put.status);
              const del = await t
                .http()
                .delete(`/v1/spaces/${space.id}/reviews/me`)
                .set(...bearer(person.user));
              expect([401, 403]).toContain(del.status);
            },
          },
          {
            weight: 10,
            name: 'rajada concorrente',
            run: async () => {
              const names: string[] = [];
              const jobs: Array<Promise<unknown>> = [];
              for (const person of active().slice(0, 4)) {
                const space = pick(spacesOf);
                const rating = 1 + Math.floor(random() * 5);
                names.push(`put ${rating}`);
                jobs.push(
                  putReview(t, person.user, space.id, { rating }).then((res) => res.status),
                );
              }
              const victim = active().length > 3 ? pick(active()) : undefined;
              if (victim) {
                names.push('block');
                jobs.push(
                  block(victim.user).then((res) => {
                    expect(res.status).toBe(200);
                    return res.status;
                  }),
                );
              }
              const deleter = pick(active().length ? active() : people);
              names.push('delete');
              jobs.push(
                t
                  .http()
                  .delete(`/v1/spaces/${pick(spacesOf).id}/reviews/me`)
                  .set(...bearer(deleter.user))
                  .then((res) => res.status),
              );
              const statuses = (await Promise.all(jobs)) as number[];
              // A ordem é livre: cada pedido ganha ou perde a corrida, mas nenhum vira erro 5xx.
              for (const status of statuses) expect(status).toBeLessThan(500);
              if (victim) victim.status = 'BLOCKED';
              // A ordem entre os pedidos é livre: o modelo é refeito a partir do banco, e os
              // invariantes independentes do modelo (I1, I2, I3) seguem valendo.
              await resync();
              log.push(`rajada [${names.join(', ')}]`);
            },
          },
        ];
        const performed = new Map<string, number>();
        const total = ops.reduce((acc, op) => acc + op.weight, 0);
        const draw = () => {
          let r = random() * total;
          for (const op of ops) {
            r -= op.weight;
            if (r < 0) return op;
          }
          return ops[0] as (typeof ops)[number];
        };

        // Estado das contas excluídas no banco (para o I2).
        const deletedStatus = new Map<string, 'ACTIVE' | 'BLOCKED'>();
        const peopleForCheck = () =>
          people.map((p) => ({
            ...p,
            status: p.status === 'DELETED' ? (deletedStatus.get(p.user.id) ?? 'ACTIVE') : p.status,
          }));

        for (let step = 1; step <= 120; step++) {
          const op = draw();
          try {
            const logged = log.length;
            await op.run();
            // Só conta o passo que de fato fez algo (as guardas devolvem sem agir).
            if (log.length > logged || op.name === 'bloqueada tenta alterar') {
              performed.set(op.name, (performed.get(op.name) ?? 0) + 1);
            }
            await expectConsistent(spacesOf, peopleForCheck(), model);
          } catch (err) {
            throw new Error(
              `semente ${seed}, passo ${step} (${op.name}): ${(err as Error).message}\n` +
                `últimos passos: ${log.slice(-8).join(' | ')}`,
            );
          }
        }
        // A sequência exercita cada tipo de passo, não só os fáceis.
        for (const name of [
          'avaliar/editar',
          'excluir',
          'bloquear',
          'desbloquear',
          'rajada concorrente',
        ]) {
          expect(performed.get(name) ?? 0, `${name} nunca rodou`).toBeGreaterThan(0);
        }
        // No fim, os usuários ativos ainda estão com a conta ativa de fato.
        const statuses = await t.db
          .select({ id: users.id, status: users.status })
          .from(users)
          .where(
            inArray(
              users.id,
              people.map((p) => p.user.id),
            ),
          );
        for (const row of statuses) {
          const person = people.find((p) => p.user.id === row.id);
          if (person?.status !== 'DELETED') expect(row.status).toBe(person?.status);
        }
      },
      120_000,
    );
  });
});
