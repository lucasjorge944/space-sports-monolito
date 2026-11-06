import { REVIEW_SUMMARY_MIN_COUNT, reviewAverage } from '@space-sports/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, type Space } from '../bookings/fixtures.js';
import { insertBooking, putReview } from '../reviews/helpers.js';
import { insertReviewRow } from '../reviews/qa-fixtures.js';
import { setSpaceStatus } from '../spaces/fixtures.js';
import { superUser } from '../super/fixtures.js';

// QA da decisão 109 (AV2.4), a nota mudando de verdade: avaliações criadas, editadas e excluídas
// pela API, autor bloqueado e espaço que sai da vitrine, no meio da paginação por cursor. O cursor
// carrega valores (média exibida, total, nome, id), não posições: a próxima página é sempre
// "o que vem depois desses valores" na ordem do momento. Cobre RN-REVIEW-03 (média e bloqueio),
// RF-REVIEW-03 e RN-SPACE-01.

type Card = {
  id: string;
  slug: string;
  name: string;
  rating: { count: number; average: number | null };
};
type Page = { items: Card[]; nextCursor: string | null };
type Query = Record<string, string | number>;

describe('busca por nota com a nota mudando (decisão 109)', () => {
  let t: TestApp;
  let admin: SignedUp;
  const spaces = new Map<string, Space>();
  const players: SignedUp[] = [];
  let n = 0;

  /** Espaço da vitrine, sem localização, de nome `Espaço <slug>` (a ordem por nome é a do slug). */
  async function make(slug: string, rating?: { anonymous: number[] }) {
    const space = await createSpace(t.db, slug);
    spaces.set(slug, space);
    for (const value of rating?.anonymous ?? [])
      await insertReviewRow(t.db, space.id, { rating: value });
    return space;
  }
  /** Jogador novo com reserva terminada em cada espaço dado (pode avaliar todos). */
  async function player(name: string, at: string[]) {
    const user = await signUp(t, `live${n++}@exemplo.com`, name);
    for (const slug of at) await insertBooking(t.db, spaces.get(slug) as Space, user, 180);
    players.push(user);
    return user;
  }
  const review = (user: SignedUp, slug: string, rating: number) =>
    putReview(t, user, (spaces.get(slug) as Space).id, { rating }).expect(200);
  const unreview = (user: SignedUp, slug: string) =>
    t
      .http()
      .delete(`/v1/spaces/${(spaces.get(slug) as Space).id}/reviews/me`)
      .set(...bearer(user))
      .expect(204);
  const block = (user: SignedUp) =>
    t
      .http()
      .post(`/v1/super/users/${user.id}/block`)
      .set(...bearer(admin))
      .send({})
      .expect(200);
  const unblock = (user: SignedUp) =>
    t
      .http()
      .post(`/v1/super/users/${user.id}/unblock`)
      .set(...bearer(admin))
      .expect(200);

  const search = async (query: Query = {}): Promise<Page> =>
    (await t.http().get('/v1/spaces').query(query).expect(200)).body;
  const slugOf = (id: string) => [...spaces.entries()].find(([, space]) => space.id === id)?.[0];
  const slugs = (items: Card[]) => items.map((card) => card.slug);

  beforeAll(async () => {
    t = await createTestApp();
    admin = await superUser(t, 'super-live@exemplo.com');
  });
  afterAll(() => t.close());

  // -------------------------------------------------------------------------------------------
  describe('autor bloqueado fora da média (RN-REVIEW-03)', () => {
    it('bloquear tira a avaliação da média: o espaço entra no 4+ e sobe na ordem; desbloquear devolve', async () => {
      // Referências: 4,5 (10 avaliações) e 3,8 (5).
      await make('b-ref-alta', { anonymous: [5, 5, 5, 5, 5, 4, 4, 4, 4, 4] });
      await make('b-ref-baixa', { anonymous: [4, 4, 4, 4, 3] });
      await make('b-alvo');
      const good = await Promise.all(
        ['Ana', 'Bia', 'Caio', 'Davi', 'Eva'].map((name) => player(name, ['b-alvo'])),
      );
      const troll = await player('Troll Silva', ['b-alvo']);
      for (const user of good) await review(user, 'b-alvo', 4);
      await review(troll, 'b-alvo', 1); // 21/6 = 3,5

      const filter = async () => slugs((await search({ q: 'b-', minRating: 4, limit: 50 })).items);
      const order = async () => slugs((await search({ q: 'b-', sort: 'rating', limit: 50 })).items);
      const card = async () =>
        (await search({ q: 'b-alvo' })).items.find((item) => item.slug === 'b-alvo');

      expect((await card())?.rating).toEqual({ count: 6, average: 3.5 });
      expect(await filter()).toEqual(['b-ref-alta']);
      expect(await order()).toEqual(['b-ref-alta', 'b-ref-baixa', 'b-alvo']);

      await block(troll); // 20/5 = 4,0
      expect((await card())?.rating).toEqual({ count: 5, average: 4 });
      expect(await filter()).toEqual(['b-alvo', 'b-ref-alta']); // ordem padrão: por nome
      expect(await order()).toEqual(['b-ref-alta', 'b-alvo', 'b-ref-baixa']);

      await unblock(troll);
      expect((await card())?.rating).toEqual({ count: 6, average: 3.5 });
      expect(await filter()).toEqual(['b-ref-alta']);
      expect(await order()).toEqual(['b-ref-alta', 'b-ref-baixa', 'b-alvo']);
    });

    it('bloquear pode derrubar o espaço para "Novo": some do 4+, vai para o fim e não mostra a média', async () => {
      await make('c-alvo', { anonymous: [5, 5, 5, 5] });
      await make('c-ref', { anonymous: [4, 4, 4, 4, 4, 4] }); // 4,0
      const troll = await player('Troll Costa', ['c-alvo']);
      await review(troll, 'c-alvo', 5); // 5 avaliações, 5,0

      const rows = async () => (await search({ q: 'c-', limit: 50, sort: 'rating' })).items;
      expect((await rows()).map((card) => [card.slug, card.rating.average])).toEqual([
        ['c-alvo', 5],
        ['c-ref', 4],
      ]);
      await block(troll); // 4 avaliações de nota 5: "Novo"
      expect((await rows()).map((card) => [card.slug, card.rating])).toEqual([
        ['c-ref', { count: 6, average: 4 }],
        ['c-alvo', { count: 4, average: null }],
      ]);
      expect(slugs((await search({ q: 'c-', minRating: 1 })).items)).toEqual(['c-ref']);
      await unblock(troll);
      expect(slugs((await search({ q: 'c-', minRating: 5 })).items)).toEqual(['c-alvo']);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('a nota muda entre as páginas do cursor', () => {
    /** Estado atual no banco: o que a busca deve ordenar agora. */
    async function currentOrder(): Promise<{ slug: string; key: (number | string)[] }[]> {
      const { rows } = await t.db.execute<{
        id: string;
        name: string;
        count: number;
        sum: number;
        status: string;
      }>(sql`SELECT id, name, rating_count AS count, rating_sum AS sum, status FROM spaces`);
      return rows
        .filter((row) => row.status === 'ACTIVE' && slugOf(row.id)?.startsWith('m-'))
        .map((row) => {
          const isPublic = row.count >= REVIEW_SUMMARY_MIN_COUNT;
          const tenths = Math.round((reviewAverage(row.sum, row.count) ?? 0) * 10);
          return {
            slug: slugOf(row.id) as string,
            key: [
              isPublic ? 0 : 1,
              isPublic ? -tenths : 0,
              isPublic ? -row.count : 0,
              row.name,
              row.id,
            ],
          };
        })
        .sort((a, b) => cmp(a.key, b.key));
    }
    const cmp = (a: (number | string)[], b: (number | string)[]) => {
      for (let i = 0; i < a.length; i++) {
        if ((a[i] as number | string) < (b[i] as number | string)) return -1;
        if ((a[i] as number | string) > (b[i] as number | string)) return 1;
      }
      return 0;
    };

    it('criar, editar, excluir, bloquear e tirar da vitrine no meio da paginação: sempre 200, sem repetir na mesma página, e cada página é "o que vem depois do cursor" na ordem do momento', async () => {
      // 12 públicos (5 avaliações, notas de 3,0 a 4,8 com repetição) e 3 "Novo".
      const patterns: number[][] = [
        [5, 5, 5, 5, 5],
        [5, 5, 5, 5, 4],
        [5, 5, 5, 5, 4],
        [5, 5, 5, 4, 4],
        [5, 5, 4, 4, 4],
        [5, 5, 4, 4, 4],
        [4, 4, 4, 4, 4],
        [5, 4, 4, 4, 3],
        [4, 4, 4, 4, 3],
        [4, 4, 4, 3, 3],
        [4, 4, 3, 3, 3],
        [3, 3, 3, 3, 3],
      ];
      // Cada espaço público tem 4 avaliações anônimas e 1 de jogador (o 5º valor do padrão), que a
      // API pode editar e excluir; os "Novo" têm 3 anônimas e esperam o 4º e o 5º jogador.
      const publicSlugs = patterns.map((_, i) => `m-${String(i + 1).padStart(2, '0')}`);
      const novoSlugs = ['m-n1', 'm-n2', 'm-n3'];
      const everyone = [...publicSlugs, ...novoSlugs];
      for (const [i, pattern] of patterns.entries())
        await make(publicSlugs[i] as string, { anonymous: pattern.slice(0, 4) });
      for (const slug of novoSlugs) await make(slug, { anonymous: [5, 5, 5] });

      const owners = await Promise.all(
        publicSlugs.map((slug, i) => player(`Dono ${i + 1}`, [slug, ...novoSlugs])),
      );
      for (const [i, slug] of publicSlugs.entries())
        await review(owners[i] as SignedUp, slug, patterns[i]?.[4] as number);
      const extra1 = await player('Extra Um', everyone);
      const extra2 = await player('Extra Dois', everyone);
      const troll = await player('Troll Mover', ['m-12']);

      type Step = () => Promise<void>;
      /** O que acontece depois de cada página, na ordem. */
      const steps: Step[] = [
        // Um "Novo" ganha a 5ª avaliação com nota 5 e vira o primeiro da lista (antes do cursor).
        async () => {
          await review(extra1, 'm-n1', 5);
          await review(extra2, 'm-n1', 5);
        },
        // Um espaço de nota pública perde a avaliação do jogador e cai para "Novo"; outro, ainda
        // não servido, sai da vitrine.
        async () => {
          await unreview(owners[8] as SignedUp, 'm-09');
          await setSpaceStatus(t.db, (spaces.get('m-11') as Space).id, 'SUSPENDED');
          suspended = true;
        },
        // Quem está no cursor muda de nota: o jogador do último item da 3ª página dá 1 estrela.
        async () => {
          const lastServed = lastSlugs.at(-1) as string;
          const idx = publicSlugs.indexOf(lastServed);
          if (idx >= 0 && lastServed !== 'm-09') {
            await review(owners[idx] as SignedUp, lastServed, 1);
            movedCursorOwner = lastServed;
          }
        },
        // Autor bloqueado: a avaliação de 1 estrela de m-12 entra e sai da média.
        async () => {
          await review(troll, 'm-12', 1);
          await block(troll);
        },
      ];
      let suspended = false;
      /** Quem estava no cursor e mudou de nota (o passo 3 tem de ter rodado de verdade). */
      let movedCursorOwner: string | null = null;
      let lastSlugs: string[] = [];

      const limit = 3;
      let cursor: string | null = null;
      const seen: string[] = [];
      /**
       * Chave do último item da página anterior, tirada do estado do banco no momento em que ela foi
       * servida (sem decodificar o cursor: se o cursor gravasse uma nota errada, o teste enxergaria).
       */
      let before: (number | string)[] | null = null;
      for (let page = 0; page < 20; page++) {
        const res: Page = await search({
          sort: 'rating',
          limit,
          q: 'm-',
          ...(cursor ? { cursor } : {}),
        });
        // Os itens da página são, na ordem do momento, os primeiros depois do valor do cursor.
        const now = await currentOrder();
        const want = now
          .filter((entry) => !before || cmp(entry.key, before) > 0)
          .slice(0, limit)
          .map((entry) => entry.slug);
        expect(slugs(res.items), `página ${page + 1}`).toEqual(want);
        seen.push(...slugs(res.items));
        if (suspended) expect(slugs(res.items), `página ${page + 1}`).not.toContain('m-11');
        lastSlugs = slugs(res.items);
        const lastServed = lastSlugs.at(-1);
        before = now.find((entry) => entry.slug === lastServed)?.key ?? null;
        cursor = res.nextCursor;
        if (cursor) expect(before, `chave do último item da página ${page + 1}`).not.toBeNull();
        if (!cursor) break;
        await steps[page]?.();
      }
      expect(cursor, 'a paginação terminou').toBeNull();
      // Nunca um espaço fora da vitrine nem repetido dentro da mesma página; o que mudou de lugar
      // pode reaparecer mais adiante (a nota é um valor, não uma posição).
      // Conjunto exato: sem m-11 (suspenso depois da 2ª página) e sem m-n1 (subiu para antes do cursor).
      expect(movedCursorOwner, 'o passo "quem está no cursor muda de nota" rodou').not.toBeNull();
      expect([...new Set(seen)].sort()).toEqual(
        [
          'm-01',
          'm-02',
          'm-03',
          'm-04',
          'm-05',
          'm-06',
          'm-07',
          'm-08',
          'm-09',
          'm-10',
          'm-12',
          'm-n2',
          'm-n3',
        ].sort(),
      );
      // Contagem e soma guardadas batem com as avaliações que contam (a busca lê as colunas).
      const { rows } = await t.db.execute<{ slug: string; ok: boolean }>(sql`
        SELECT s.slug,
          (s.rating_count, s.rating_sum) = (
            SELECT count(*)::int, coalesce(sum(r.rating), 0)::int
            FROM space_reviews r WHERE r.space_id = s.id AND r.counted
          ) AS ok
        FROM spaces s WHERE s.slug LIKE 'm-%'
      `);
      expect(rows.length).toBe(everyone.length);
      expect(rows.filter((row) => !row.ok)).toEqual([]);
    });

    it('cursor de uma página antiga continua valendo depois que a nota do último item mudou', async () => {
      await make('k-1', { anonymous: [5, 5, 5, 5] });
      await make('k-2', { anonymous: [4, 4, 4, 4] });
      await make('k-3', { anonymous: [3, 3, 3, 3] });
      const users = await Promise.all(
        [1, 2, 3].map((i) => player(`Autor K${i}`, ['k-1', 'k-2', 'k-3'])),
      );
      for (const [i, slug] of ['k-1', 'k-2', 'k-3'].entries())
        await review(users[i] as SignedUp, slug, [5, 4, 3][i] as number);
      const first = await search({ sort: 'rating', q: 'k-', limit: 1 });
      expect(slugs(first.items)).toEqual(['k-1']);
      // O último item da página (k-1) sai da média e depois some da vitrine; o cursor segue valendo.
      await unreview(users[0] as SignedUp, 'k-1');
      await setSpaceStatus(t.db, (spaces.get('k-1') as Space).id, 'SUSPENDED');
      const next = await search({
        sort: 'rating',
        q: 'k-',
        limit: 5,
        cursor: first.nextCursor as string,
      });
      expect(slugs(next.items)).toEqual(['k-2', 'k-3']);
      expect(next.nextCursor).toBeNull();
    });
  });
});
