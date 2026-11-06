import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPACE_ROLES } from '@space-sports/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '../../src/db/migrate.js';
import { withDatabase } from './database-url.js';

const MIGRATION = '0019_post_pilot_adjustments';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string }[];
};

const statements = (tag: string) =>
  readFileSync(join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8').split('--> statement-breakpoint');

// Decisões 46 (papel removido), 50 (status por participante) e 51 (capacidade da quadra).
describe(`migração ${MIGRATION}`, () => {
  const adminUrl = inject('pgAdminUrl');
  const name = `migration_${randomUUID().replaceAll('-', '')}`;
  let db: pg.Client;
  /** O valor removido do enum: vem do próprio banco, antes da migração. */
  let legacyRole: string;
  let spaceId: string;
  let otherSpaceId: string;

  const one = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) => {
    const { rows } = await db.query<T>(text, values);
    const [row] = rows;
    if (!row) throw new Error(`Consulta sem resultado: ${text}`);
    return row;
  };

  const user = async (email: string) =>
    (
      await one<{ id: string }>('INSERT INTO users (name, email) VALUES ($1, $1) RETURNING id', [
        email,
      ])
    ).id;

  const link = (userId: string, role: string, status: string, space = spaceId) =>
    db.query(
      'INSERT INTO space_members (user_id, space_id, role, status) VALUES ($1, $2, $3, $4)',
      [userId, space, role, status],
    );

  const invite = async (
    email: string,
    role: string,
    options: { status?: string; days?: number; invitedBy: string },
  ) =>
    (
      await one<{ id: string }>(
        `INSERT INTO staff_invites (space_id, email, role, status, token_hash, expires_at, invited_by)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6), $7) RETURNING id`,
        [
          spaceId,
          email,
          role,
          options.status ?? 'PENDING',
          randomUUID(),
          options.days ?? 7,
          options.invitedBy,
        ],
      )
    ).id;

  const links = async (userId: string) =>
    (
      await db.query<{ role: string; status: string; space_id: string }>(
        'SELECT role, status, space_id FROM space_members WHERE user_id = $1 ORDER BY space_id, role',
        [userId],
      )
    ).rows;

  const inviteOf = (id: string) =>
    one<{ role: string; status: string }>('SELECT role, status FROM staff_invites WHERE id = $1', [
      id,
    ]);

  let plain: string;
  let adminActive: string;
  let adminRemoved: string;
  let removedLegacy: string;
  let bothRemoved: string;
  let teacherToo: string;
  let otherSpaceAdmin: string;
  let inviter: string;
  const invites: Record<string, string> = {};
  let courtId: string;
  const sport: Record<string, string> = {};

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();

    db = new pg.Client({ connectionString: withDatabase(adminUrl, name) });
    await db.connect();
    const before = journal.entries.filter((entry) => entry.tag < MIGRATION);
    for (const entry of before) {
      for (const statement of statements(entry.tag)) await db.query(statement);
    }

    const roles = await db.query<{ role: string }>(
      'SELECT unnest(enum_range(NULL::space_member_role))::text AS role',
    );
    const allowed: readonly string[] = SPACE_ROLES;
    const removed = roles.rows.map((row) => row.role).filter((role) => !allowed.includes(role));
    expect(removed).toHaveLength(1);
    legacyRole = removed[0] as string;

    const city = await one<{ id: string }>(
      `INSERT INTO cities (name, state, timezone) VALUES ('BH', 'MG', 'America/Sao_Paulo') RETURNING id`,
    );
    const space = (slug: string) =>
      one<{ id: string }>(
        'INSERT INTO spaces (name, slug, city_id) VALUES ($1, $1, $2) RETURNING id',
        [slug, city.id],
      );
    spaceId = (await space('arena-a')).id;
    otherSpaceId = (await space('arena-b')).id;

    inviter = await user('dono@exemplo.com');
    await link(inviter, 'OWNER', 'ACTIVE');

    plain = await user('so-legado@exemplo.com');
    await link(plain, legacyRole, 'ACTIVE');

    adminActive = await user('ja-admin@exemplo.com');
    await link(adminActive, legacyRole, 'ACTIVE');
    await link(adminActive, 'ADMIN', 'ACTIVE');

    // A linha de ADMIN removida não pode tirar o acesso de quem segue ativo no papel antigo.
    adminRemoved = await user('admin-removido@exemplo.com');
    await link(adminRemoved, legacyRole, 'ACTIVE');
    await link(adminRemoved, 'ADMIN', 'REMOVED');

    // Quem saiu do papel antigo não ganha acesso; quem é ADMIN ativo não perde.
    removedLegacy = await user('legado-removido@exemplo.com');
    await link(removedLegacy, legacyRole, 'REMOVED');
    await link(removedLegacy, 'ADMIN', 'ACTIVE');

    bothRemoved = await user('tudo-removido@exemplo.com');
    await link(bothRemoved, legacyRole, 'REMOVED');
    await link(bothRemoved, 'ADMIN', 'REMOVED');

    teacherToo = await user('professor@exemplo.com');
    await link(teacherToo, legacyRole, 'ACTIVE');
    await link(teacherToo, 'TEACHER', 'ACTIVE');

    // O vínculo em outro espaço é outro vínculo.
    otherSpaceAdmin = await user('outro-espaco@exemplo.com');
    await link(otherSpaceAdmin, legacyRole, 'ACTIVE');
    await link(otherSpaceAdmin, 'ADMIN', 'ACTIVE', otherSpaceId);

    const by = { invitedBy: inviter };
    invites.alone = await invite('sozinho@exemplo.com', legacyRole, by);
    invites.accepted = await invite('aceito@exemplo.com', legacyRole, {
      ...by,
      status: 'ACCEPTED',
    });
    invites.revoked = await invite('revogado@exemplo.com', legacyRole, {
      ...by,
      status: 'REVOKED',
    });
    invites.legacyLoses = await invite('perde@exemplo.com', legacyRole, { ...by, days: 3 });
    invites.adminWins = await invite('perde@exemplo.com', 'ADMIN', { ...by, days: 7 });
    invites.legacyWins = await invite('ganha@exemplo.com', legacyRole, { ...by, days: 7 });
    invites.adminLoses = await invite('ganha@exemplo.com', 'ADMIN', { ...by, days: 3 });
    invites.tieLegacy = await invite('empate@exemplo.com', legacyRole, by);
    invites.tieAdmin = await invite('empate@exemplo.com', 'ADMIN', by);
    await db.query('UPDATE staff_invites SET expires_at = $1 WHERE email = $2', [
      new Date(Date.now() + 86_400_000),
      'empate@exemplo.com',
    ]);
    invites.teacher = await invite('sozinho@exemplo.com', 'TEACHER', by);

    const court = await one<{ id: string }>(
      `INSERT INTO courts (space_id, name) VALUES ($1, 'Quadra 1') RETURNING id`,
      [spaceId],
    );
    courtId = court.id;
    for (const [slug, max] of [
      ['custom', 4],
      ['sem-padrao', null],
      ['acima', 30],
    ] as const) {
      const row = await one<{ id: string }>(
        'INSERT INTO sports (slug, name, default_max_players) VALUES ($1, $1, $2) RETURNING id',
        [slug, max],
      );
      sport[slug] = row.id;
      await db.query(
        'INSERT INTO court_sports (court_id, sport_id, max_players) VALUES ($1, $2, 8)',
        [courtId, row.id],
      );
    }

    await db.query('BEGIN');
    for (const statement of statements(MIGRATION)) await db.query(statement);
    await db.query('COMMIT');
  });

  afterAll(async () => {
    await db?.end();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  });

  it('o enum fica só com os papéis novos', async () => {
    const { rows } = await db.query<{ role: string }>(
      'SELECT unnest(enum_range(NULL::space_member_role))::text AS role',
    );
    expect(rows.map((row) => row.role)).toEqual([...SPACE_ROLES]);
  });

  it('o papel removido vira ADMIN', async () => {
    expect(await links(plain)).toEqual([{ role: 'ADMIN', status: 'ACTIVE', space_id: spaceId }]);
  });

  it('sem duplicar quem já tem a linha de ADMIN, no status mais forte', async () => {
    const expectLinks = async (userId: string, status: string) =>
      expect(await links(userId)).toEqual([{ role: 'ADMIN', status, space_id: spaceId }]);
    await expectLinks(adminActive, 'ACTIVE');
    await expectLinks(adminRemoved, 'ACTIVE');
    await expectLinks(removedLegacy, 'ACTIVE');
    await expectLinks(bothRemoved, 'REMOVED');
  });

  it('mantém os outros papéis e os vínculos de outros espaços', async () => {
    expect((await links(teacherToo)).map((row) => [row.role, row.status])).toEqual([
      ['ADMIN', 'ACTIVE'],
      ['TEACHER', 'ACTIVE'],
    ]);
    expect((await links(otherSpaceAdmin)).map((row) => row.space_id).sort()).toEqual(
      [spaceId, otherSpaceId].sort(),
    );
    expect((await links(inviter)).map((row) => row.role)).toEqual(['OWNER']);
  });

  it('os convites viram ADMIN, inclusive os já encerrados', async () => {
    expect(await inviteOf(invites.alone as string)).toEqual({ role: 'ADMIN', status: 'PENDING' });
    expect(await inviteOf(invites.accepted as string)).toEqual({
      role: 'ADMIN',
      status: 'ACCEPTED',
    });
    expect(await inviteOf(invites.revoked as string)).toEqual({ role: 'ADMIN', status: 'REVOKED' });
    expect(await inviteOf(invites.teacher as string)).toEqual({
      role: 'TEACHER',
      status: 'PENDING',
    });
  });

  it('com dois convites pendentes para o mesmo e-mail, fica o de prazo maior', async () => {
    const statusOf = async (key: string) => (await inviteOf(invites[key] as string)).status;
    expect(await statusOf('adminWins')).toBe('PENDING');
    expect(await statusOf('legacyLoses')).toBe('REVOKED');
    expect(await statusOf('legacyWins')).toBe('PENDING');
    expect(await statusOf('adminLoses')).toBe('REVOKED');
    expect(await statusOf('tieAdmin')).toBe('PENDING');
    expect(await statusOf('tieLegacy')).toBe('REVOKED');

    const { rows } = await db.query(
      `SELECT space_id, email, role FROM staff_invites WHERE status = 'PENDING'
       GROUP BY space_id, email, role HAVING count(*) > 1`,
    );
    expect(rows).toEqual([]);
  });

  it('o índice de convite pendente e a constraint de vínculo continuam valendo', async () => {
    await expect(
      invite('sozinho@exemplo.com', 'ADMIN', { invitedBy: inviter }),
    ).rejects.toMatchObject({ code: '23505', constraint: 'staff_invites_pending_unique' });
    await expect(link(plain, 'ADMIN', 'ACTIVE')).rejects.toMatchObject({
      code: '23505',
      constraint: 'space_members_user_space_role_unique',
    });
    await expect(link(plain, legacyRole, 'ACTIVE')).rejects.toMatchObject({ code: '22P02' });
  });

  it('o status por participante sai do banco', async () => {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'booking_participants' AND column_name = 'payment_status'`,
    );
    expect(rows).toEqual([]);
    const type = await db.query(
      `SELECT 1 FROM pg_type WHERE typname = 'participant_payment_status'`,
    );
    expect(type.rows).toEqual([]);
  });

  it('a capacidade das quadras volta ao padrão do esporte, até 20', async () => {
    const capacity = async (slug: string) =>
      (
        await one<{ max_players: number }>(
          'SELECT max_players FROM court_sports WHERE court_id = $1 AND sport_id = $2',
          [courtId, sport[slug]],
        )
      ).max_players;
    expect(await capacity('custom')).toBe(4);
    expect(await capacity('sem-padrao')).toBe(20);
    expect(await capacity('acima')).toBe(20);
  });
});
