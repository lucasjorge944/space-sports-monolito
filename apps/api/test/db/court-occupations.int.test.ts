import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client.js';
import { cities, courtOccupations, courts, spaces } from '../../src/db/schema/index.js';
import { createTestDatabase, expectPgError, first, type TestDatabase } from './helpers.js';

// RN-BOOK-03: sem sobreposição de ocupações ativas na mesma quadra, garantido pelo banco.

const EXCLUSION_VIOLATION = '23P01';
const CHECK_VIOLATION = '23514';

/** Horário em UTC no dia de teste (10h UTC = 7h em São Paulo, irrelevante para a constraint). */
const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);
const range = (start: string, end: string) => ({ start: at(start), end: at(end) });

describe('court_occupations: constraint de exclusão', () => {
  let t: TestDatabase;
  let db: Database;
  let courtA: string;
  let courtB: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    db = t.db;
    const city = first(
      await db
        .insert(cities)
        .values({ name: 'Cidade Teste', state: 'MG', timezone: 'America/Sao_Paulo' })
        .returning(),
    );
    const space = first(
      await db
        .insert(spaces)
        .values({ name: 'Espaço Teste', slug: 'espaco-teste', cityId: city.id })
        .returning(),
    );
    [courtA, courtB] = (
      await db
        .insert(courts)
        .values([
          { spaceId: space.id, name: 'Quadra A' },
          { spaceId: space.id, name: 'Quadra B' },
        ])
        .returning()
    ).map((court) => court.id) as [string, string];
  });

  afterAll(() => t.drop());

  async function occupy(courtId: string, period: { start: Date; end: Date }, active = true) {
    return first(
      await db
        .insert(courtOccupations)
        .values({ courtId, period, kind: 'BOOKING', refId: crypto.randomUUID(), active })
        .returning(),
    );
  }

  async function clear() {
    await db.delete(courtOccupations);
  }

  it('rejeita duas ocupações ativas sobrepostas na mesma quadra', async () => {
    await clear();
    await occupy(courtA, range('10:00', '11:00'));

    const err = await expectPgError(occupy(courtA, range('10:30', '11:30')));
    expect(err).toMatchObject({
      code: EXCLUSION_VIOLATION,
      constraint: 'court_occupations_no_overlap',
    });

    // Contido no período existente e envolvendo-o também conflitam.
    await expect(expectPgError(occupy(courtA, range('10:15', '10:45')))).resolves.toMatchObject({
      code: EXCLUSION_VIOLATION,
    });
    await expect(expectPgError(occupy(courtA, range('09:00', '12:00')))).resolves.toMatchObject({
      code: EXCLUSION_VIOLATION,
    });
  });

  it('o conflito vale entre tipos diferentes (reserva x bloqueio)', async () => {
    await clear();
    await occupy(courtA, range('10:00', '11:00'));
    const err = await expectPgError(
      db.insert(courtOccupations).values({
        courtId: courtA,
        period: range('10:30', '12:00'),
        kind: 'BLOCK',
        refId: crypto.randomUUID(),
      }),
    );
    expect(err.code).toBe(EXCLUSION_VIOLATION);
  });

  it('aceita períodos adjacentes [10:00,11:00) e [11:00,12:00)', async () => {
    await clear();
    await occupy(courtA, range('10:00', '11:00'));
    await occupy(courtA, range('11:00', '12:00'));

    const rows = await db
      .select()
      .from(courtOccupations)
      .where(eq(courtOccupations.courtId, courtA))
      .orderBy(courtOccupations.period);
    expect(rows.map((r) => r.period)).toEqual([range('10:00', '11:00'), range('11:00', '12:00')]);
  });

  it('aceita sobreposição quando uma das ocupações está inativa', async () => {
    await clear();
    await occupy(courtA, range('10:00', '11:00'), false);
    await occupy(courtA, range('10:00', '11:00'));

    // Uma reserva cancelada (active=false) libera o horário para outra.
    const cancelled = await occupy(courtA, range('14:00', '15:00'));
    await db
      .update(courtOccupations)
      .set({ active: false })
      .where(eq(courtOccupations.id, cancelled.id));
    await occupy(courtA, range('14:00', '15:00'));

    // Reativar a ocupação cancelada volta a conflitar.
    const err = await expectPgError(
      db
        .update(courtOccupations)
        .set({ active: true })
        .where(eq(courtOccupations.id, cancelled.id)),
    );
    expect(err.code).toBe(EXCLUSION_VIOLATION);
  });

  it('aceita o mesmo período em quadras diferentes', async () => {
    await clear();
    await occupy(courtA, range('10:00', '11:00'));
    await occupy(courtB, range('10:00', '11:00'));
  });

  it('é à prova de concorrência: de duas transações simultâneas, só uma grava', async () => {
    await clear();
    const attempt = (start: string, end: string) =>
      db.transaction(async (tx) => {
        await tx.insert(courtOccupations).values({
          courtId: courtA,
          period: range(start, end),
          kind: 'BOOKING',
          refId: crypto.randomUUID(),
        });
        // Segura a transação aberta para as duas se cruzarem.
        await tx.execute(sql`SELECT pg_sleep(0.2)`);
      });

    const results = await Promise.allSettled([
      attempt('18:00', '19:00'),
      attempt('18:30', '19:30'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(await expectPgError(Promise.reject(rejected?.reason))).toMatchObject({
      code: EXCLUSION_VIOLATION,
    });
    const rows = await db.select().from(courtOccupations);
    expect(rows).toHaveLength(1);
  });

  it('rejeita período vazio, invertido, infinito ou fora do formato [início, fim)', async () => {
    const invalid = [
      `[2026-11-02 10:00Z,2026-11-02 10:00Z)`, // vazio
      `[2026-11-02 10:00Z,)`, // sem fim
      `(2026-11-02 10:00Z,2026-11-02 11:00Z]`, // limites trocados
    ];
    for (const period of invalid) {
      const err = await expectPgError(
        db.execute(
          sql`INSERT INTO court_occupations (court_id, period, kind, ref_id)
              VALUES (${courtB}, ${period}::tstzrange, 'BLOCK', gen_random_uuid())`,
        ),
      );
      expect(err, period).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'court_occupations_period_valid',
      });
    }
    // Fim antes do início nem chega a ser um range válido.
    const inverted = await expectPgError(
      db.execute(sql`SELECT '[2026-11-02 11:00Z,2026-11-02 10:00Z)'::tstzrange`),
    );
    expect(inverted.code).toBe('22000');
  });
});

describe('convenções do schema', () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(() => t.drop());

  it('gera ids uuid v7 no banco', async () => {
    const city = first(
      await t.db
        .insert(cities)
        .values({ name: 'Cidade', state: 'SP', timezone: 'America/Sao_Paulo' })
        .returning(),
    );
    expect(city.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('spaces.location é opcional e entra na busca geográfica quando preenchida', async () => {
    const city = first(
      await t.db
        .insert(cities)
        .values({ name: 'Belo Horizonte', state: 'MG', timezone: 'America/Sao_Paulo' })
        .returning(),
    );
    await t.db.insert(spaces).values([
      { name: 'Sem endereço', slug: 'sem-endereco', cityId: city.id },
      {
        name: 'Na Savassi',
        slug: 'na-savassi',
        cityId: city.id,
        location: { lng: -43.9345, lat: -19.9386 },
      },
    ]);

    // Raio de 5 km a partir da Praça Sete.
    const near = await t.db
      .select({ slug: spaces.slug })
      .from(spaces)
      .where(
        sql`ST_DWithin(${spaces.location}, ST_MakePoint(-43.9378, -19.9191)::geography, 5000)`,
      );
    expect(near).toEqual([{ slug: 'na-savassi' }]);
  });

  it('spaces.location volta como { lng, lat } na leitura (nulo continua nulo)', async () => {
    const rows = await t.db
      .select({ slug: spaces.slug, location: spaces.location })
      .from(spaces)
      .orderBy(spaces.slug);
    expect(rows).toEqual([
      { slug: 'na-savassi', location: { lng: -43.9345, lat: -19.9386 } },
      { slug: 'sem-endereco', location: null },
    ]);
  });
});
