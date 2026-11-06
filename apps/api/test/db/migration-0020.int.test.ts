import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '../../src/db/migrate.js';
import { withDatabase } from './database-url.js';

// Decisão 45: a migração tira a pausa das assinaturas sem gerar mensalidade retroativa. Aplica as
// migrações até a anterior, monta os dados e roda só a 0020 (o template dos testes já está migrado).

const TAG = '0020_remove_subscription_pause';

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

  /** Hoje e o mês corrente no fuso do espaço de teste. */
  const local = async () => {
    const { rows } = await db.query(`
      SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today,
             date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS month,
             (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month - 1 day')::date::text AS month_end,
             (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month')::date::text AS next_month,
             (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '2 month - 1 day')::date::text AS next_month_end`);
    return rows[0];
  };

  async function subscription(
    key: string,
    values: {
      status: string;
      pausedFrom?: string | null;
      pausedUntil?: string | null;
      reason?: string | null;
      cancelAtPeriodEnd?: boolean;
      endsOn?: string | null;
    },
  ) {
    const user = await db.query(`INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id`, [
      key,
      `${key}@exemplo.com`,
    ]);
    const sub = await db.query(
      `INSERT INTO subscriptions (user_id, plan_id, space_id, status, price_cents, starts_on, paused_from, paused_until, status_reason, cancel_at_period_end, ends_on)
       VALUES ($1, $2, $3, $4, 18000, '2026-01-01', $5, $6, $7, $8, $9) RETURNING id`,
      [
        user.rows[0].id,
        ids.plan,
        ids.space,
        values.status,
        values.pausedFrom ?? null,
        values.pausedUntil ?? null,
        values.reason ?? null,
        values.cancelAtPeriodEnd ?? false,
        values.endsOn ?? null,
      ],
    );
    ids[key] = sub.rows[0].id;
  }

  const row = async (key: string) =>
    (
      await db.query(
        `SELECT status, status_reason, ends_on::text FROM subscriptions WHERE id = $1`,
        [ids[key]],
      )
    ).rows[0];
  const chargesOf = async (key: string) =>
    (
      await db.query(
        `SELECT period_start::text, period_end::text, due_date::text, amount_cents, status, waive_reason FROM subscription_charges WHERE subscription_id = $1 ORDER BY period_start`,
        [ids[key]],
      )
    ).rows;

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

    const city = await db.query(
      `INSERT INTO cities (name, state, timezone) VALUES ('Cidade', 'MG', 'America/Sao_Paulo') RETURNING id`,
    );
    const space = await db.query(
      `INSERT INTO spaces (name, slug, city_id) VALUES ('Espaço', 'espaco-migracao', $1) RETURNING id`,
      [city.rows[0].id],
    );
    ids.space = space.rows[0].id;
    const sport = await db.query(
      `INSERT INTO sports (slug, name) VALUES ('migracao', 'Migração') RETURNING id`,
    );
    const plan = await db.query(
      `INSERT INTO plans (space_id, sport_id, name, price_cents, billing_day, pause_allowed, max_pause_months_per_year)
       VALUES ($1, $2, 'Plano', 18000, 10, false, 2) RETURNING id`,
      [ids.space, sport.rows[0].id],
    );
    ids.plan = plan.rows[0].id;
    await db.query(
      `INSERT INTO space_settings (space_id, max_pause_months_per_year) VALUES ($1, 3)`,
      [ids.space],
    );

    const { month, month_end, next_month, next_month_end } = await local();
    // Pausa em curso cobrindo o mês corrente.
    await subscription('paused', {
      status: 'PAUSED',
      pausedFrom: month,
      pausedUntil: month_end,
      reason: 'Viagem',
    });
    // Pausada sem data de fim.
    await subscription('openended', { status: 'PAUSED', pausedFrom: month });
    // Pausa em curso pela data, com o job ainda sem levar a PAUSED.
    await subscription('notflipped', {
      status: 'ACTIVE',
      pausedFrom: month,
      pausedUntil: next_month_end,
    });
    await subscription('pastdue', {
      status: 'PAST_DUE',
      pausedFrom: month,
      pausedUntil: month_end,
    });
    // Pausa agendada para o mês seguinte: só é descartada.
    await subscription('scheduled', {
      status: 'ACTIVE',
      pausedFrom: next_month,
      pausedUntil: next_month_end,
      reason: 'Férias',
    });
    // Pausa com o mês corrente já pago: a mensalidade existente não muda.
    await subscription('paid', { status: 'PAUSED', pausedFrom: month, pausedUntil: month_end });
    const paid = await db.query(
      `INSERT INTO subscription_charges (subscription_id, period_start, period_end, due_date, amount_cents, status)
       VALUES ($1, $2, $3, $4::date + 9, 18000, 'PAID') RETURNING id`,
      [ids.paid, month, month_end, month],
    );
    expect(paid.rowCount).toBe(1);
    // Cancelamento pedido com pausa: o motivo é o do cancelamento.
    await subscription('cancelling', {
      status: 'ACTIVE',
      pausedFrom: next_month,
      pausedUntil: next_month_end,
      reason: 'Mudança',
      cancelAtPeriodEnd: true,
      endsOn: month_end,
    });
    await subscription('plain', { status: 'ACTIVE', reason: null });
    await subscription('closed', { status: 'CANCELLED', reason: 'Recusada' });
    await subscription('old', {
      status: 'ACTIVE',
      pausedFrom: '2026-01-01',
      pausedUntil: '2026-01-31',
    });
    await db.query(
      `INSERT INTO subscription_pause_months (subscription_id, month) VALUES ($1, $2)`,
      [ids.paused, month],
    );

    for (const statement of statements(TAG)) await db.query(statement);
  }, 120_000);

  afterAll(async () => {
    await db.end();
    await admin(`DROP DATABASE ${name}`);
  });

  it('PAUSED volta a ACTIVE e limpa o motivo da pausa', async () => {
    expect(await row('paused')).toMatchObject({ status: 'ACTIVE', status_reason: null });
    expect(await row('paid')).toMatchObject({ status: 'ACTIVE' });
    expect(await row('notflipped')).toMatchObject({ status: 'ACTIVE' });
    expect(await row('openended')).toMatchObject({ status: 'ACTIVE' });
    expect(await row('pastdue')).toMatchObject({ status: 'PAST_DUE' });
  });

  it('descarta a pausa agendada e guarda só o motivo que não era dela', async () => {
    expect(await row('scheduled')).toMatchObject({ status: 'ACTIVE', status_reason: null });
    expect(await row('cancelling')).toMatchObject({
      status: 'ACTIVE',
      status_reason: 'Mudança',
    });
    expect(await row('closed')).toMatchObject({ status: 'CANCELLED', status_reason: 'Recusada' });
  });

  it('o mês trancado em curso fica dispensado: o job não gera mensalidade retroativa', async () => {
    const { month, month_end } = await local();
    const waived = {
      period_start: month,
      period_end: month_end,
      due_date: `${month.slice(0, 8)}10`,
      amount_cents: 18_000,
      status: 'WAIVED',
      waive_reason: expect.stringContaining('pausa'),
    };
    expect(await chargesOf('paused')).toEqual([waived]);
    expect(await chargesOf('openended')).toEqual([waived]);
    expect(await chargesOf('notflipped')).toEqual([waived]);
    expect(await chargesOf('pastdue')).toEqual([waived]);
  });

  it('não cria nada para pausa agendada, passada, sem pausa ou com a mensalidade já paga', async () => {
    expect(await chargesOf('scheduled')).toEqual([]);
    expect(await chargesOf('cancelling')).toEqual([]);
    expect(await chargesOf('plain')).toEqual([]);
    expect(await chargesOf('old')).toEqual([]);
    expect(await chargesOf('paid')).toMatchObject([{ status: 'PAID', waive_reason: null }]);
  });

  it('remove a estrutura da pausa e o valor do enum, sem tocar no mensalista', async () => {
    const columns = await db.query(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE column_name IN ('paused_from', 'paused_until', 'pause_allowed', 'max_pause_months_per_year')`);
    expect(columns.rows).toEqual([]);
    const table = await db.query(`SELECT to_regclass('subscription_pause_months') AS name`);
    expect(table.rows[0].name).toBeNull();
    const enums = await db.query(`
      SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname IN ('subscription_status', 'recurring_booking_status') GROUP BY t.typname`);
    expect(Object.fromEntries(enums.rows.map((e) => [e.typname, e.labels]))).toEqual({
      subscription_status: ['PENDING_APPROVAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED'],
      recurring_booking_status: ['PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'ENDED', 'REJECTED'],
    });
  });

  it('mantém o padrão do status e o índice de uma assinatura em aberto por plano', async () => {
    const { rows } = await db.query(`SELECT user_id FROM subscriptions WHERE id = $1`, [ids.plain]);
    await expect(
      db.query(
        `INSERT INTO subscriptions (user_id, plan_id, space_id, price_cents) VALUES ($1, $2, $3, 100)`,
        [rows[0].user_id, ids.plan, ids.space],
      ),
    ).rejects.toMatchObject({ constraint: 'subscriptions_open_user_plan_unique' });
  });
});
