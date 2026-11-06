import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, paymentRecords } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, type Row, seedCatalog, superUser } from './fixtures.js';

// RF-SUPER-05: financeiro consolidado, só leitura sobre payment_records.

type Catalog = Awaited<ReturnType<typeof seedCatalog>>;

describe('Super: financeiro consolidado', () => {
  let t: TestApp;
  let catalog: Catalog;
  let admin: SignedUp;
  let player: SignedUp;
  let arena: string;
  let praia: string;

  const pay = (
    spaceId: string,
    payableType: (typeof paymentRecords.$inferInsert)['payableType'],
    method: 'PIX' | 'CARD' | 'CASH' | 'OTHER',
    amountCents: number,
    paidAt: string,
    reversed = false,
  ) =>
    t.db.insert(paymentRecords).values({
      spaceId,
      payableType,
      payableId: crypto.randomUUID(),
      amountCents,
      method,
      paidAt: new Date(paidAt),
      recordedBy: admin.id,
      ...(reversed ? { reversedAt: new Date(paidAt), reversedBy: admin.id } : {}),
    });

  const summary = (query = 'from=2026-03-01&to=2026-03-31') =>
    t
      .http()
      .get(`/v1/super/finance/summary?${query}`)
      .set(...bearer(admin));

  beforeAll(async () => {
    t = await createTestApp();
    catalog = await seedCatalog(t.db);
    admin = await superUser(t, 'super@exemplo.com');
    player = await signUp(t, 'jogador@exemplo.com');
    arena = (await createSpace(t.db, catalog, { name: 'Arena Centro', slug: 'arena-centro' })).id;
    praia = (await createSpace(t.db, catalog, { name: 'Praia Clube', slug: 'praia-clube' })).id;

    await pay(arena, 'BOOKING', 'PIX', 10_000, '2026-03-10T15:00:00Z');
    await pay(arena, 'BOOKING_PARTICIPANT', 'CASH', 2_500, '2026-03-11T15:00:00Z');
    await pay(praia, 'RECURRING_BOOKING_CHARGE', 'PIX', 20_000, '2026-03-12T15:00:00Z');
    await pay(praia, 'SUBSCRIPTION_CHARGE', 'CARD', 8_000, '2026-03-13T15:00:00Z');
    await pay(praia, 'TEAM', 'OTHER', 3_000, '2026-03-14T15:00:00Z');
    // Estornado: não conta como recebido.
    await pay(arena, 'BOOKING', 'PIX', 5_000, '2026-03-15T15:00:00Z', true);
    // Fronteira do fuso: 31/03 23:00 em SP entra; 01/04 00:00 em SP não entra.
    await pay(arena, 'BOOKING', 'CARD', 700, '2026-04-01T02:00:00Z');
    await pay(arena, 'BOOKING', 'CARD', 900, '2026-04-01T03:00:00Z');
    // Fora do período.
    await pay(arena, 'BOOKING', 'PIX', 1_100, '2026-02-28T14:00:00Z');
  });
  afterAll(() => t.close());

  it('soma recebido por espaço, serviço e forma de pagamento (em centavos)', async () => {
    const res = await summary().expect(200);
    expect(res.body.period).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    // 10.000 + 2.500 + 20.000 + 8.000 + 3.000 + 700
    expect(res.body.totals).toEqual({
      receivedCents: 44_200,
      paymentsCount: 6,
      reversedCents: 5_000,
    });
    expect(res.body.bySpace).toEqual([
      { spaceId: praia, spaceName: 'Praia Clube', receivedCents: 31_000, paymentsCount: 3 },
      { spaceId: arena, spaceName: 'Arena Centro', receivedCents: 13_200, paymentsCount: 3 },
    ]);
    expect(res.body.byService).toEqual([
      { service: 'RENTAL', receivedCents: 33_200, paymentsCount: 4 },
      { service: 'CLASSES', receivedCents: 8_000, paymentsCount: 1 },
      { service: 'TOURNAMENTS', receivedCents: 3_000, paymentsCount: 1 },
    ]);
    expect(
      Object.fromEntries(res.body.byMethod.map((m: Row) => [m.method, m.receivedCents])),
    ).toEqual({
      PIX: 30_000,
      CASH: 2_500,
      CARD: 8_700,
      OTHER: 3_000,
    });
  });

  it('filtra por espaço e usa o mês atual quando não há período', async () => {
    const res = await summary(`from=2026-03-01&to=2026-03-31&spaceId=${arena}`).expect(200);
    expect(res.body.totals.receivedCents).toBe(13_200);
    expect(res.body.bySpace).toHaveLength(1);

    const month = await summary('').expect(200);
    expect(month.body.period.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(month.body.period.to >= month.body.period.from).toBe(true);
  });

  it('valida o período', async () => {
    await summary('from=2026-04-01&to=2026-03-01').expect(400);
    await summary('from=01/03/2026').expect(400);
    await summary('spaceId=xpto').expect(400);
  });

  it('não traz mais mensalidades em aberto (decisão 27)', async () => {
    const res = await summary().expect(200);
    expect(res.body).not.toHaveProperty('openMonthlyFees');
  });

  describe('exportação CSV', () => {
    const csv = (query = 'from=2026-03-01&to=2026-03-31', user = admin) =>
      t
        .http()
        .get(`/v1/super/finance/payments.csv?${query}`)
        .set(...bearer(user))
        .buffer(true)
        .parse((res, done) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () => done(null, data));
        });

    it('um registro por linha, com cabeçalho, BOM e fuso local', async () => {
      const res = await csv().expect(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="pagamentos-2026-03-01_2026-03-31.csv"',
      );
      const body = res.body as string;
      expect(body.startsWith('﻿')).toBe(true);
      const lines = body.slice(1).trimEnd().split('\r\n');
      expect(lines[0]).toBe(
        'id,pago_em_utc,pago_em_local,espaco,servico,tipo,forma,canal,valor_centavos,estornado_em_utc',
      );
      // 6 recebidos + 1 estornado.
      expect(lines).toHaveLength(8);
      const row = lines.find((line) => line.includes(',10000,'));
      expect(row?.split(',').slice(1)).toEqual([
        '10/03/2026 15:00:00',
        '10/03/2026 12:00:00',
        'Arena Centro',
        'RENTAL',
        'BOOKING',
        'PIX',
        'no_local',
        '10000',
        '',
      ]);
      const reversed = lines.find((line) => line.includes(',5000,'));
      expect(reversed?.endsWith('15/03/2026 15:00:00')).toBe(true);
      // Nenhum dado pessoal do pagador.
      expect(body).not.toContain('jogador@exemplo.com');
    });

    it('respeita os filtros de período e de espaço', async () => {
      const res = await csv(`from=2026-03-01&to=2026-03-31&spaceId=${praia}`).expect(200);
      const lines = (res.body as string).slice(1).trimEnd().split('\r\n');
      expect(lines).toHaveLength(4);
      expect(lines.slice(1).every((line) => line.includes('Praia Clube'))).toBe(true);
      const empty = await csv('from=2020-01-01&to=2020-01-31').expect(200);
      expect((empty.body as string).slice(1).trimEnd().split('\r\n')).toHaveLength(1);
    });

    it('neutraliza fórmulas e escapa vírgulas e aspas no nome do espaço', async () => {
      const evil = await createSpace(t.db, catalog, { name: '=HYPERLINK("x")', slug: 'evil' });
      const comma = await createSpace(t.db, catalog, { name: 'Arena "Sol", Mar', slug: 'sol-mar' });
      await pay(evil.id, 'BOOKING', 'PIX', 111, '2026-05-05T15:00:00Z');
      await pay(comma.id, 'BOOKING', 'PIX', 222, '2026-05-05T15:00:00Z');
      const res = await csv('from=2026-05-01&to=2026-05-31').expect(200);
      const body = res.body as string;
      expect(body).toContain(`"'=HYPERLINK(""x"")"`);
      expect(body).toContain('"Arena ""Sol"", Mar"');
    });

    it('exporta além de um lote (paginação por id sem perder nem repetir linhas)', async () => {
      const bulk = await createSpace(t.db, catalog, { name: 'Volume', slug: 'volume' });
      const rows = Array.from({ length: 2_050 }, (_, i) => ({
        spaceId: bulk.id,
        payableType: 'BOOKING' as const,
        payableId: crypto.randomUUID(),
        amountCents: 100 + i,
        method: 'PIX' as const,
        paidAt: new Date('2026-06-10T15:00:00Z'),
        recordedBy: admin.id,
      }));
      await t.db.insert(paymentRecords).values(rows);
      const res = await csv(`from=2026-06-01&to=2026-06-30&spaceId=${bulk.id}`).expect(200);
      const lines = (res.body as string).slice(1).trimEnd().split('\r\n').slice(1);
      expect(lines).toHaveLength(2_050);
      expect(new Set(lines.map((line) => line.split(',')[0])).size).toBe(2_050);
    });

    it('não-Super não exporta', async () => {
      await csv('from=2026-03-01&to=2026-03-31', player).expect(403);
      const logs = await t.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'super.finance.export_csv'), eq(auditLogs.actorId, player.id)),
        );
      expect(logs).toEqual([]);
    });

    it('cada exportação fica na auditoria, com quem exportou, o período e o espaço', async () => {
      const exports = () =>
        t.db
          .select()
          .from(auditLogs)
          .where(
            and(eq(auditLogs.action, 'super.finance.export_csv'), eq(auditLogs.actorId, admin.id)),
          );
      const before = (await exports()).length;
      await csv(`from=2026-03-01&to=2026-03-31&spaceId=${praia}`).expect(200);
      await csv('from=2026-04-01&to=2026-04-30').expect(200);

      const logs = (await exports()).slice(before);
      expect(logs).toHaveLength(2);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actingAsSuper: true,
            spaceId: praia,
            entity: 'payment_record',
            entityId: null,
            diff: { from: '2026-03-01', to: '2026-03-31', spaceId: praia },
          }),
          expect.objectContaining({
            spaceId: null,
            diff: { from: '2026-04-01', to: '2026-04-30', spaceId: null },
          }),
        ]),
      );
    });
  });
});
