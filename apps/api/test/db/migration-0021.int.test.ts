import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '../../src/db/migrate.js';
import { withDatabase } from './database-url.js';

// Decisão 47: a migração leva o professor atual para as listas e monta a agenda entre espaços.
// Aplica as migrações até a anterior, monta os dados e roda só a 0021.

const TAG = '0021_class_teachers';

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

  const one = async (text: string, values: unknown[] = []) => {
    const { rows } = await db.query(text, values);
    if (!rows[0]) throw new Error(`Consulta sem resultado: ${text}`);
    return rows[0];
  };

  const insertSpace = async (key: string) => {
    const space = await one(
      `INSERT INTO spaces (name, slug, city_id) VALUES ($1, $1, $2) RETURNING id`,
      [`espaco-${key}`, ids.city],
    );
    ids[key] = space.id;
    const court = await one(
      `INSERT INTO courts (space_id, name) VALUES ($1, 'Quadra 1') RETURNING id`,
      [space.id],
    );
    const other = await one(
      `INSERT INTO courts (space_id, name) VALUES ($1, 'Quadra 2') RETURNING id`,
      [space.id],
    );
    ids[`${key}Court`] = court.id;
    ids[`${key}Court2`] = other.id;
  };

  const teacher = async (key: string, spaceKey: string) =>
    (
      await one(
        `INSERT INTO space_members (user_id, space_id, role, status) VALUES ($1, $2, 'TEACHER', 'ACTIVE') RETURNING id`,
        [ids[key], ids[spaceKey]],
      )
    ).id as string;

  const insertGroup = async (spaceKey: string, memberId: string, courtKey = `${spaceKey}Court`) =>
    (
      await one(
        `INSERT INTO class_groups (space_id, sport_id, teacher_member_id, court_id, name, weekday, start_time, duration_min, capacity)
         VALUES ($1, $2, $3, $4, 'Turma', 2, '19:00', 60, 8) RETURNING id`,
        [ids[spaceKey], ids.sport, memberId, ids[courtKey]],
      )
    ).id as string;

  const insertSession = async (
    groupId: string,
    spaceKey: string,
    memberId: string,
    startsAt: string,
    status = 'SCHEDULED',
    courtKey = `${spaceKey}Court`,
  ) =>
    (
      await one(
        `INSERT INTO class_sessions (class_group_id, space_id, court_id, teacher_member_id, starts_at, ends_at, capacity, status)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '1 hour', 8, $6) RETURNING id`,
        [groupId, ids[spaceKey], ids[courtKey], memberId, startsAt, status],
      )
    ).id as string;

  const occupation = (sessionId: string | undefined) =>
    one('SELECT user_id, space_id, active FROM teacher_occupations WHERE class_session_id = $1', [
      sessionId,
    ]);

  beforeAll(async () => {
    await admin(`CREATE DATABASE ${name}`);
    db = new pg.Client({ connectionString: withDatabase(adminUrl, name) });
    await db.connect();
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] };
    const previous = journal.entries.slice(
      0,
      journal.entries.findIndex((entry) => entry.tag === TAG),
    );
    for (const { tag } of previous) {
      for (const statement of statements(tag)) await db.query(statement);
    }

    ids.city = (
      await one(
        `INSERT INTO cities (name, state, timezone) VALUES ('Cidade', 'MG', 'America/Sao_Paulo') RETURNING id`,
      )
    ).id;
    ids.sport = (
      await one(`INSERT INTO sports (slug, name) VALUES ('migracao', 'Migração') RETURNING id`)
    ).id;
    await insertSpace('a');
    await insertSpace('b');
    ids.teacher = (
      await one(`INSERT INTO users (name, email) VALUES ('Prof', 'prof@exemplo.com') RETURNING id`)
    ).id;
    ids.memberA = await teacher('teacher', 'a');
    ids.memberB = await teacher('teacher', 'b');

    const groupA = await insertGroup('a', ids.memberA as string);
    const groupB = await insertGroup('b', ids.memberB as string);
    const inactive = await insertGroup('a', ids.memberA as string, 'aCourt2');
    await db.query('UPDATE class_groups SET active = false WHERE id = $1', [inactive]);
    ids.groupA = groupA;
    ids.groupB = groupB;
    ids.inactive = inactive;

    const when = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
    const memberA = ids.memberA as string;
    const memberB = ids.memberB as string;
    ids.first = await insertSession(groupA, 'a', memberA, when);
    // Mesmo professor, mesma hora: no mesmo espaço pode; no outro, é a sobreposição antiga.
    ids.sameSpace = await insertSession(inactive, 'a', memberA, when, 'SCHEDULED', 'aCourt2');
    ids.overlapping = await insertSession(groupB, 'b', memberB, when);
    ids.cancelled = await insertSession(groupB, 'b', memberB, `${when.slice(0, 10)}T23:30:00Z`);
    await db.query(`UPDATE class_sessions SET status = 'CANCELLED' WHERE id = $1`, [ids.cancelled]);
    ids.done = await insertSession(groupB, 'b', memberB, '2026-01-06T22:00:00Z', 'DONE');

    await db.query(
      `INSERT INTO class_session_conflicts (class_group_id, starts_at, ends_at, conflicts_with)
       VALUES ($1, now(), now() + interval '1 hour', 'BLOCK')`,
      [groupA],
    );

    await db.query('BEGIN');
    for (const statement of statements(TAG)) await db.query(statement);
    await db.query('COMMIT');
  });

  afterAll(async () => {
    await db.end();
    await admin(`DROP DATABASE ${name}`);
  });

  it('as listas nascem com o professor atual e as colunas saem', async () => {
    const groups = await db.query(
      'SELECT class_group_id, space_id, teacher_member_id FROM class_group_teachers ORDER BY class_group_id',
    );
    expect(groups.rows).toHaveLength(3);
    expect(groups.rows).toContainEqual({
      class_group_id: ids.groupB,
      space_id: ids.b,
      teacher_member_id: ids.memberB,
    });
    const sessions = await db.query('SELECT count(*)::int AS total FROM class_session_teachers');
    expect(sessions.rows[0].total).toBe(5);

    const columns = await db.query(
      `SELECT table_name FROM information_schema.columns
       WHERE column_name = 'teacher_member_id' AND table_name IN ('class_groups', 'class_sessions')`,
    );
    expect(columns.rows).toEqual([]);
  });

  it('a ocupação vai para o usuário, com a aula cancelada inativa', async () => {
    expect(await occupation(ids.first)).toEqual({
      user_id: ids.teacher,
      space_id: ids.a,
      active: true,
    });
    expect(await occupation(ids.sameSpace)).toMatchObject({ active: true });
    expect(await occupation(ids.done)).toMatchObject({ active: true });
    expect(await occupation(ids.cancelled)).toMatchObject({ active: false });
  });

  it('sobreposição antiga entre espaços não trava a migração e fica inativa, com a aula intacta', async () => {
    expect(await occupation(ids.overlapping)).toMatchObject({ space_id: ids.b, active: false });
    const session = await one('SELECT status FROM class_sessions WHERE id = $1', [ids.overlapping]);
    expect(session.status).toBe('SCHEDULED');
    expect(
      await one(
        'SELECT teacher_member_id FROM class_session_teachers WHERE class_session_id = $1',
        [ids.overlapping],
      ),
    ).toEqual({ teacher_member_id: ids.memberB });
  });

  it('a constraint e o gatilho de ao menos um professor ficam valendo', async () => {
    await expect(
      db.query('UPDATE teacher_occupations SET active = true WHERE class_session_id = $1', [
        ids.overlapping,
      ]),
    ).rejects.toMatchObject({ code: '23P01', constraint: 'teacher_occupations_no_overlap' });
    await expect(
      db.query('DELETE FROM class_session_teachers WHERE class_session_id = $1', [ids.first]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'class_session_teachers_required' });
    await expect(
      db.query('DELETE FROM class_group_teachers WHERE class_group_id = $1', [ids.groupA]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'class_group_teachers_required' });
  });

  it('os avisos existentes continuam, no tipo novo', async () => {
    const conflict = await one('SELECT conflicts_with FROM class_session_conflicts');
    expect(conflict.conflicts_with).toBe('BLOCK');
    await db.query(
      `INSERT INTO class_session_conflicts (class_group_id, starts_at, ends_at, conflicts_with)
       VALUES ($1, now() + interval '1 day', now() + interval '25 hours', 'TEACHER')`,
      [ids.groupA],
    );
  });
});
