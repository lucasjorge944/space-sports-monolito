import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '../../src/db/migrate.js';
import { withDatabase } from './database-url.js';

// Decisões 64, 68 e 69: telefone só único quando verificado, gênero como enum (o texto livre de
// antes não era usado) e nível do esporte favorito opcional. Aplica as migrações até a anterior,
// monta os dados e roda só a 0023.

const TAG = '0023_account_profile';

const statements = (tag: string) =>
  readFileSync(join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .filter((statement) => statement.trim());

describe(`migração ${TAG}`, () => {
  const name = `migration_${randomUUID().replaceAll('-', '')}`;
  const adminUrl = inject('pgAdminUrl');
  let db: pg.Client;
  const ids: Record<string, string> = {};

  const admin = async (sql: string) => {
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  };

  const insertUser = async (key: string, values: { gender?: string | null; phone?: string }) => {
    const { rows } = await db.query(
      'INSERT INTO users (name, email, phone, gender) VALUES ($1, $2, $3, $4) RETURNING id',
      [key, `${key.toLowerCase()}@exemplo.com`, values.phone ?? null, values.gender ?? null],
    );
    ids[key] = rows[0].id;
  };

  beforeAll(async () => {
    await admin(`CREATE DATABASE ${name}`);
    db = new pg.Client({ connectionString: withDatabase(adminUrl, name) });
    await db.connect();
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] };
    const index = journal.entries.findIndex((entry) => entry.tag === TAG);
    expect(index).toBeGreaterThan(0);
    for (const { tag } of journal.entries.slice(0, index)) {
      for (const statement of statements(tag)) await db.query(statement);
    }

    await insertUser('semGenero', { gender: null, phone: '+5531911110001' });
    await insertUser('feminino', { gender: ' female ' });
    await insertUser('outro', { gender: 'OTHER' });
    await insertUser('livre', { gender: 'M' });
    const { rows } = await db.query(
      `INSERT INTO sports (slug, name) VALUES ('migracao', 'Migração') RETURNING id`,
    );
    ids.sport = rows[0].id;
    await db.query(
      `INSERT INTO user_sport_profiles (user_id, sport_id, level) VALUES ($1, $2, 'PRO')`,
      [ids.semGenero, ids.sport],
    );

    await db.query('BEGIN');
    for (const statement of statements(TAG)) await db.query(statement);
    await db.query('COMMIT');
  });

  afterAll(async () => {
    await db.end();
    await admin(`DROP DATABASE ${name}`);
  });

  it('gênero: valores do enum (em qualquer caixa) ficam, nulos e texto livre viram nulo', async () => {
    const { rows } = await db.query('SELECT name, gender FROM users ORDER BY name');
    expect(rows).toEqual([
      { name: 'feminino', gender: 'FEMALE' },
      { name: 'livre', gender: null },
      { name: 'outro', gender: 'OTHER' },
      { name: 'semGenero', gender: null },
    ]);
    await expect(
      db.query(`UPDATE users SET gender = 'X' WHERE id = $1`, [ids.outro]),
    ).rejects.toThrow(/invalid input value for enum gender/);
  });

  it('telefone: o digitado se repete; o verificado continua único', async () => {
    await db.query(`UPDATE users SET phone = '+5531911110001' WHERE id = $1`, [ids.feminino]);
    await db.query(`UPDATE users SET phone_verified = true WHERE id = $1`, [ids.semGenero]);
    await expect(
      db.query(`UPDATE users SET phone = '+5531911110001', phone_verified = true WHERE id = $1`, [
        ids.outro,
      ]),
    ).rejects.toThrow(/users_phone_verified_unique/);
    await expect(
      db.query(`UPDATE users SET phone = '31 9999' WHERE id = $1`, [ids.outro]),
    ).rejects.toThrow(/users_phone_e164/);
  });

  it('nível opcional e favoritos saem junto com o esporte do catálogo', async () => {
    await db.query(
      `INSERT INTO user_sport_profiles (user_id, sport_id, level) VALUES ($1, $2, NULL)`,
      [ids.outro, ids.sport],
    );
    await db.query('DELETE FROM sports WHERE id = $1', [ids.sport]);
    const { rows } = await db.query('SELECT count(*)::int AS total FROM user_sport_profiles');
    expect(rows[0].total).toBe(0);
  });
});
