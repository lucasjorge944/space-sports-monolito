import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  onlineCharges,
  onlineRefunds,
  payouts,
  spaceLedgerEntries,
  spaceSettings,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  member,
  type Space,
  slotIn,
  useMiddayClock,
} from '../bookings/fixtures.js';
import { superUser } from '../super/fixtures.js';
import {
  approveMerchant,
  bookingRow,
  CARD_APPROVE,
  CARD_CHARGEBACK,
  chargeRow,
  drain,
  ledgerOf,
  onlinePath,
  type Row,
  recordsOf,
  setModes,
} from './fixtures.js';

// RN-ONPAY-01, 05 e 06; RF-ONPAY-07 e 11: dinheiro. Um oráculo independente (BigInt, sem o código
// de produção) calcula a taxa e o livro-razão esperados; o teste confere cobrança por cobrança e a
// carteira inteira:
//   saldo = vendas − taxas − estornos + taxas devolvidas − chargebacks ± ajustes − repasses.

useMiddayClock();

/** Arredonda n/d meio para cima, com BigInt (independente de divideRoundHalfUp). */
const halfUp = (n: number, d: number) => Number((2n * BigInt(n) + BigInt(d)) / (2n * BigInt(d)));
const oracleFee = (amount: number, bps: number, min: number) =>
  Math.min(amount, Math.max(halfUp(amount * bps, 10_000), min));

/** Divide uma linha de CSV (campos vazios e aspas com vírgula dentro). */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

describe('dinheiro do pagamento online', () => {
  let t: TestApp;
  let sup: SignedUp;
  let player: SignedUp;
  let other: SignedUp;
  const spaces: Record<
    'odd' | 'half' | 'tiny' | 'free',
    { space: Space; owner: SignedUp; admin: SignedUp }
  > = {} as never;

  /** Preço da hora (centavos) e taxa própria (Super) de cada espaço de teste. */
  const SETUP = {
    // 3737: 4% = 149,48 e 6% = 224,22 (arredondam para baixo).
    odd: { price: 3_737, fees: null },
    // 1225 a 2% = 24,5 → 25 (meio para cima); cartão cai no padrão de 6% = 73,5 → 74, mínimo 0.
    half: { price: 1_225, fees: { pixFeeBps: 200, cardFeeBps: null, minFeeCents: 0 } },
    // 60 min de R$ 0,50/h = R$ 0,50, abaixo do mínimo de R$ 1,00: a taxa não passa do valor.
    tiny: { price: 50, fees: null },
    // Taxa zero (0 bps e mínimo 0).
    free: { price: 2_500, fees: { pixFeeBps: 0, cardFeeBps: 0, minFeeCents: 0 } },
  } as const;

  const online = (key: keyof typeof spaces, p: string) => onlinePath(spaces[key].space.id, p);

  beforeAll(async () => {
    t = await createTestApp();
    sup = await superUser(t, 'super@dinheiro.test');
    player = await signUp(t, 'maria@dinheiro.test', 'Maria Oliveira');
    other = await signUp(t, 'outro@dinheiro.test', 'Outro Jogador');
    for (const key of Object.keys(SETUP) as (keyof typeof SETUP)[]) {
      const space = await createSpace(t.db, `dinheiro-${key}`);
      await t.db
        .update(spaceSettings)
        .set({ pricePerHourCents: SETUP[key].price })
        .where(eq(spaceSettings.spaceId, space.id));
      const owner = await member(t, `dono-${key}@dinheiro.test`, space.id, 'OWNER');
      const admin = await member(t, `admin-${key}@dinheiro.test`, space.id, 'ADMIN');
      await approveMerchant(t, owner, space.id);
      await setModes(t, owner, space.id, 'ONLINE_OPTIONAL', 'ONLINE_OPTIONAL');
      spaces[key] = { space, owner, admin };
      if (SETUP[key].fees) {
        await t
          .http()
          .put(`/v1/super/online-payments/fees/spaces/${space.id}`)
          .set(...bearer(sup))
          .send({ ...SETUP[key].fees, feePayer: null })
          .expect(200);
      }
    }
  });

  afterAll(async () => {
    await t.close();
  });

  let nextSlot = 60;
  const book = async (
    key: keyof typeof spaces,
    option: Row,
    { user = player, durationMin = 60 }: { user?: SignedUp; durationMin?: number } = {},
  ) => {
    const { space } = spaces[key];
    nextSlot += 120;
    const res = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(user))
      .send({
        spaceId: space.id,
        courtId: space.courtA,
        sportId: space.sportId,
        startsAt: slotIn(nextSlot).toISOString(),
        durationMin,
        peopleCount: 2,
        ...option,
      })
      .expect(201);
    return { bookingId: res.body.id as string, chargeId: res.body.onlinePayment.id as string };
  };

  const simulate = (chargeId: string, action: string, body: Row = {}) =>
    t
      .http()
      .post(`/v1/super/online-payments/simulator/charges/${chargeId}/${action}`)
      .set(...bearer(sup))
      .send(body)
      .expect(200);

  const payPix = async (key: keyof typeof spaces, durationMin = 60) => {
    const ids = await book(key, { paymentOption: 'ONLINE_PIX' }, { durationMin });
    await simulate(ids.chargeId, 'pay');
    await drain(t);
    return ids;
  };

  const payCard = async (key: keyof typeof spaces, token = CARD_APPROVE) => {
    const ids = await book(key, { paymentOption: 'ONLINE_CARD', cardToken: token });
    await drain(t);
    return ids;
  };

  const refund = (key: keyof typeof spaces, chargeId: string, body: Row) =>
    t
      .http()
      .post(online(key, `charges/${chargeId}/refunds`))
      .set(...bearer(spaces[key].admin))
      .send({ reason: 'Teste de estorno', ...body });

  const ledgerSum = async (spaceId: string, chargeId?: string) =>
    (await ledgerOf(t, spaceId, chargeId)).reduce((sum, e) => sum + e.amountCents, 0);

  const fee = async (key: keyof typeof spaces, chargeId: string) => {
    const res = await t
      .http()
      .get(online(key, `charges/${chargeId}`))
      .set(...bearer(spaces[key].owner))
      .expect(200);
    return res.body as Row;
  };

  describe('taxa nos limites (RN-ONPAY-01)', () => {
    it('arredonda para baixo abaixo de meio centavo: 4% de 3737 = 149 e 6% de 3737 = 224', async () => {
      const pix = await book('odd', { paymentOption: 'ONLINE_PIX' });
      expect(await fee('odd', pix.chargeId)).toMatchObject({
        amountCents: 3_737,
        platformFeeCents: oracleFee(3_737, 400, 100),
        spaceNetCents: 3_737 - 149,
        feeBps: 400,
        minFeeApplied: false,
      });
      expect(oracleFee(3_737, 400, 100)).toBe(149);
      const card = await book('odd', { paymentOption: 'ONLINE_CARD', cardToken: CARD_APPROVE });
      expect(await fee('odd', card.chargeId)).toMatchObject({
        platformFeeCents: 224,
        spaceNetCents: 3_737 - 224,
        feeBps: 600,
      });
    });

    it('meio centavo arredonda para cima, por espaço (2% de 1225 = 24,5 → 25) e o cartão cai no padrão', async () => {
      const pix = await book('half', { paymentOption: 'ONLINE_PIX' });
      expect(await fee('half', pix.chargeId)).toMatchObject({
        amountCents: 1_225,
        platformFeeCents: 25,
        spaceNetCents: 1_200,
        feeBps: 200,
        minFeeApplied: false,
      });
      const card = await book('half', { paymentOption: 'ONLINE_CARD', cardToken: CARD_APPROVE });
      // 6% de 1225 = 73,5 → 74; mínimo próprio do espaço (0) vale no lugar do padrão (R$ 1,00).
      expect(await fee('half', card.chargeId)).toMatchObject({
        platformFeeCents: 74,
        feeBps: 600,
      });
    });

    it('valor menor que o mínimo: a taxa nunca passa do valor (R$ 0,50 → taxa R$ 0,50, líquido 0)', async () => {
      const ids = await book('tiny', { paymentOption: 'ONLINE_PIX' });
      expect(await fee('tiny', ids.chargeId)).toMatchObject({
        amountCents: 50,
        platformFeeCents: 50,
        spaceNetCents: 0,
        minFeeApplied: true,
      });
      await simulate(ids.chargeId, 'pay');
      await drain(t);
      const charge = await chargeRow(t, ids.chargeId);
      expect(charge.status).toBe('PAID');
      expect(
        (await ledgerOf(t, spaces.tiny.space.id, ids.chargeId))
          .map((e) => [e.kind, e.amountCents])
          .sort(),
      ).toEqual([
        ['PLATFORM_FEE', -50],
        ['SALE', 50],
      ]);
      // Estorno total devolve a taxa inteira (R$ 0,50): nada sobra no espaço.
      const refunded = await refund('tiny', ids.chargeId, { amountCents: 50 }).expect(201);
      expect(refunded.body.feeRefundCents).toBe(50);
      expect(await ledgerSum(spaces.tiny.space.id, ids.chargeId)).toBe(0);
    });

    it('taxa zero (0 bps, mínimo 0): sem lançamento de taxa e o espaço recebe tudo', async () => {
      const ids = await payPix('free');
      const charge = await chargeRow(t, ids.chargeId);
      expect(charge).toMatchObject({ platformFeeCents: 0, spaceNetCents: 2_500 });
      expect((await ledgerOf(t, spaces.free.space.id, ids.chargeId)).map((e) => e.kind)).toEqual([
        'SALE',
      ]);
      const refunded = await refund('free', ids.chargeId, { amountCents: 1_000 }).expect(201);
      expect(refunded.body.feeRefundCents).toBe(0);
    });

    it('a taxa fica gravada na cobrança: mudar a regra depois não altera a aberta nem a paga', async () => {
      const open = await book('odd', { paymentOption: 'ONLINE_PIX' });
      const paid = await payPix('odd');
      await t
        .http()
        .put('/v1/super/online-payments/fees')
        .set(...bearer(sup))
        .send({ pixFeeBps: 1_000, cardFeeBps: 1_000, minFeeCents: 500, feePayer: 'SPACE' })
        .expect(200);
      try {
        await simulate(open.chargeId, 'pay');
        await drain(t);
        expect(await chargeRow(t, open.chargeId)).toMatchObject({
          status: 'PAID',
          platformFeeCents: 149,
          feeBps: 400,
          minFeeCents: 100,
        });
        expect(await chargeRow(t, paid.chargeId)).toMatchObject({ platformFeeCents: 149 });
        // A cobrança nova já usa a regra nova.
        const fresh = await book('odd', { paymentOption: 'ONLINE_PIX' });
        expect(await fee('odd', fresh.chargeId)).toMatchObject({
          platformFeeCents: oracleFee(3_737, 1_000, 500),
          feeBps: 1_000,
        });
        // O espaço com regra própria não é afetado pela mudança do padrão (campo a campo).
        const half = await book('half', { paymentOption: 'ONLINE_PIX' });
        expect(await fee('half', half.chargeId)).toMatchObject({
          platformFeeCents: 25,
          feeBps: 200,
        });
      } finally {
        await t
          .http()
          .put('/v1/super/online-payments/fees')
          .set(...bearer(sup))
          .send({ pixFeeBps: 400, cardFeeBps: 600, minFeeCents: 100, feePayer: 'SPACE' })
          .expect(200);
      }
    });
  });

  describe('estorno parcial, total e chargeback (RN-ONPAY-05 e 06)', () => {
    it('parcial, parcial e total de R$ 37,37: a taxa de R$ 1,49 é devolvida exatamente (40 + 40 + 69)', async () => {
      const { bookingId, chargeId } = await payPix('odd');
      const fees: number[] = [];
      for (const amount of [1_000, 1_000, 1_737]) {
        const res = await refund('odd', chargeId, { amountCents: amount }).expect(201);
        fees.push(res.body.feeRefundCents);
      }
      expect(fees).toEqual([40, 40, 69]);
      expect(await chargeRow(t, chargeId)).toMatchObject({
        status: 'REFUNDED',
        refundedCents: 3_737,
        feeRefundedCents: 149,
      });
      expect(await ledgerSum(spaces.odd.space.id, chargeId)).toBe(0);
      // Abatimento padrão: a reserva fica sem saldo em aberto e o registro online é revertido.
      expect((await bookingRow(t, bookingId)).discountCents).toBe(3_737);
      const [record] = await recordsOf(t, chargeId);
      expect(record?.reversedAt).not.toBeNull();
    });

    it('estorno parcial com o repasse já feito: o saldo do espaço fica negativo, sem repasse novo', async () => {
      const { chargeId } = await payPix('odd');
      await t
        .http()
        .post('/v1/super/online-payments/simulator/settle')
        .set(...bearer(sup))
        .send({ spaceId: spaces.odd.space.id })
        .expect(200);
      await drain(t);
      await refund('odd', chargeId, { amountCents: 1_000 }).expect(201);
      const wallet = await t
        .http()
        .get(online('odd', 'wallet'))
        .set(...bearer(spaces.odd.owner))
        .expect(200);
      expect(wallet.body.balanceCents).toBe(await ledgerSum(spaces.odd.space.id));
      expect(wallet.body.balanceCents).toBeLessThan(0);
      const before = await t.db
        .select()
        .from(payouts)
        .where(eq(payouts.spaceId, spaces.odd.space.id));
      await t
        .http()
        .post('/v1/super/online-payments/simulator/settle')
        .set(...bearer(sup))
        .send({ spaceId: spaces.odd.space.id })
        .expect(200);
      await drain(t);
      const after = await t.db
        .select()
        .from(payouts)
        .where(eq(payouts.spaceId, spaces.odd.space.id));
      // Nunca se repassa saldo negativo (payouts.amount > 0).
      expect(after.every((p) => p.amountCents > 0)).toBe(true);
      expect(after.length).toBeLessThanOrEqual(before.length + 1);
    });

    it('chargeback depois de estorno parcial: debita só o que restava e zera a taxa (R$ 2,24)', async () => {
      const { chargeId } = await payCard('odd', CARD_CHARGEBACK);
      const partial = await refund('odd', chargeId, { amountCents: 1_000 }).expect(201);
      // 224 × 1000 ÷ 3737 = 59,94 → 60.
      expect(partial.body.feeRefundCents).toBe(60);
      await drain(t, { withChargebacks: true });
      const charge = await chargeRow(t, chargeId);
      expect(charge.status).toBe('CHARGEBACK');
      const rows = await t.db
        .select()
        .from(onlineRefunds)
        .where(eq(onlineRefunds.chargeId, chargeId));
      const chargeback = rows.find((r) => r.kind === 'CHARGEBACK');
      expect(chargeback).toBeDefined();
      // O banco não pode contestar mais do que o jogador ainda tinha pago.
      expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBeLessThanOrEqual(3_737);
      expect(charge.refundedCents).toBeLessThanOrEqual(charge.amountCents);
      expect(charge.feeRefundedCents).toBeLessThanOrEqual(charge.platformFeeCents);
      // Tudo devolvido: o espaço não fica com nada desta cobrança.
      expect(charge).toMatchObject({ refundedCents: 3_737, feeRefundedCents: 224 });
      expect(await ledgerSum(spaces.odd.space.id, chargeId)).toBe(0);
      // Cobrança contestada não aceita estorno manual enquanto não for ganha.
      const again = await refund('odd', chargeId, { amountCents: 100 }).expect(409);
      expect(again.body.error.code).toBe('CHARGE_NOT_REFUNDABLE');
    });

    it('contestação ganha depois de estorno parcial: volta só o chargeback e o estorno de R$ 10,00 permanece', async () => {
      const { chargeId } = await payCard('odd', CARD_CHARGEBACK);
      await refund('odd', chargeId, { amountCents: 1_000 }).expect(201);
      await drain(t, { withChargebacks: true });
      await simulate(chargeId, 'dispute-result', { outcome: 'WON' });
      await drain(t);
      const charge = await chargeRow(t, chargeId);
      expect(charge).toMatchObject({ refundedCents: 1_000, feeRefundedCents: 60 });
      // (3737 − 224) − (1000 − 60) = 2573.
      expect(await ledgerSum(spaces.odd.space.id, chargeId)).toBe(2_573);
      // Ganha, volta a aceitar estorno, e a regra acumulada continua de onde parou.
      const rest = await refund('odd', chargeId, { amountCents: 2_737 }).expect(201);
      expect(rest.body.feeRefundCents).toBe(164);
      expect(await ledgerSum(spaces.odd.space.id, chargeId)).toBe(0);
    });

    it('contestação perdida: o espaço fica sem valor e sem taxa, e o saldo continua fechando', async () => {
      const { chargeId } = await payCard('half', CARD_CHARGEBACK);
      await drain(t, { withChargebacks: true });
      await simulate(chargeId, 'dispute-result', { outcome: 'LOST' });
      await drain(t);
      expect(await ledgerSum(spaces.half.space.id, chargeId)).toBe(0);
      expect((await chargeRow(t, chargeId)).refundedCents).toBe(1_225);
    });

    it('dois estornos simultâneos que passam do saldo: um só vale, o outro recebe 422', async () => {
      const { chargeId } = await payPix('odd');
      const results = await Promise.all([
        refund('odd', chargeId, { amountCents: 2_500 }),
        refund('odd', chargeId, { amountCents: 2_500 }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
      const charge = await chargeRow(t, chargeId);
      expect(charge.refundedCents).toBe(2_500);
      const rows = await t.db
        .select()
        .from(onlineRefunds)
        .where(eq(onlineRefunds.chargeId, chargeId));
      expect(rows).toHaveLength(1);
      expect(await ledgerSum(spaces.odd.space.id, chargeId)).toBe(
        3_737 - 149 - 2_500 + charge.feeRefundedCents,
      );
    });

    it('estorno manual simultâneo ao cancelamento do organizador: no máximo o valor pago volta', async () => {
      const { bookingId, chargeId } = await payPix('odd');
      const [manual, cancel] = await Promise.all([
        refund('odd', chargeId, { amountCents: 3_000 }),
        t
          .http()
          .post(`/v1/bookings/${bookingId}/cancel`)
          .set(...bearer(player))
          .send({}),
      ]);
      expect([201, 422, 409]).toContain(manual.status);
      expect([200, 409, 422]).toContain(cancel.status);
      await drain(t);
      const charge = await chargeRow(t, chargeId);
      expect(charge.refundedCents).toBeLessThanOrEqual(charge.amountCents);
      expect(charge.feeRefundedCents).toBeLessThanOrEqual(charge.platformFeeCents);
      const rows = await t.db
        .select()
        .from(onlineRefunds)
        .where(eq(onlineRefunds.chargeId, chargeId));
      expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(charge.refundedCents);
      expect(await ledgerSum(spaces.odd.space.id, chargeId)).toBe(
        charge.amountCents -
          charge.platformFeeCents -
          charge.refundedCents +
          charge.feeRefundedCents,
      );
    });

    it('estorno de outro espaço: a cobrança não aparece (404) e nada é estornado', async () => {
      const { chargeId } = await payPix('odd');
      const res = await t
        .http()
        .post(online('half', `charges/${chargeId}/refunds`))
        .set(...bearer(spaces.half.admin))
        .send({ amountCents: 100, reason: 'Invasão' });
      expect(res.status).toBe(404);
      expect((await chargeRow(t, chargeId)).refundedCents).toBe(0);
    });
  });

  describe('livro-razão fecha com todas as cobranças (RF-ONPAY-07, RF-ONPAY-11)', () => {
    it('cobrança a cobrança: lançamentos = (valor − taxa) − (estornado − taxa devolvida)', async () => {
      const charges = await t.db.select().from(onlineCharges);
      expect(charges.length).toBeGreaterThan(8);
      for (const charge of charges) {
        const expected = charge.paidAt
          ? charge.amountCents -
            charge.platformFeeCents -
            charge.refundedCents +
            charge.feeRefundedCents
          : 0;
        const entries = await t.db
          .select()
          .from(spaceLedgerEntries)
          .where(eq(spaceLedgerEntries.chargeId, charge.id));
        expect(
          entries.reduce((sum, e) => sum + e.amountCents, 0),
          `cobrança ${charge.id} (${charge.status}, ${charge.method})`,
        ).toBe(expected);
        // Taxa e líquido sempre fecham com o valor pago.
        expect(charge.platformFeeCents + charge.spaceNetCents).toBe(charge.amountCents);
        expect(charge.platformFeeCents).toBe(
          oracleFee(charge.serviceAmountCents, charge.feeBps, charge.minFeeCents),
        );
      }
    });

    it('espaço a espaço: carteira = vendas − taxas − estornos + taxas devolvidas − chargebacks − repasses', async () => {
      for (const key of Object.keys(spaces) as (keyof typeof spaces)[]) {
        const spaceId = spaces[key].space.id;
        const charges = (await t.db.select().from(onlineCharges)).filter(
          (c) => c.spaceId === spaceId && c.paidAt,
        );
        const paidOut = (await t.db.select().from(payouts))
          .filter((p) => p.spaceId === spaceId && p.status === 'PAID')
          .reduce((sum, p) => sum + p.amountCents, 0);
        const expected =
          charges.reduce((sum, c) => sum + c.amountCents, 0) -
          charges.reduce((sum, c) => sum + c.platformFeeCents, 0) -
          charges.reduce((sum, c) => sum + c.refundedCents, 0) +
          charges.reduce((sum, c) => sum + c.feeRefundedCents, 0) -
          paidOut;
        const wallet = await t
          .http()
          .get(online(key, 'wallet'))
          .set(...bearer(spaces[key].owner))
          .expect(200);
        expect(wallet.body.balanceCents, `espaço ${key}`).toBe(expected);
        expect(await ledgerSum(spaceId)).toBe(expected);
        expect(wallet.body.availableCents + wallet.body.pendingCents).toBe(expected);
        expect(wallet.body.paidOutCents).toBe(paidOut);
        // Cada lançamento do espaço pertence a uma cobrança do mesmo espaço.
        const entries = await ledgerOf(t, spaceId);
        const ids = new Set(
          (await t.db.select().from(onlineCharges))
            .filter((c) => c.spaceId === spaceId)
            .map((c) => c.id),
        );
        for (const entry of entries) {
          if (entry.chargeId) expect(ids.has(entry.chargeId)).toBe(true);
        }
      }
    });

    it('o CSV da carteira soma o mesmo saldo da tela', async () => {
      const csv = await t
        .http()
        .get(online('odd', 'wallet/entries.csv'))
        .set(...bearer(spaces.odd.owner))
        .expect(200);
      const lines = csv.text
        .replace(/^\uFEFF/, '')
        .split('\r\n')
        .filter(Boolean);
      const header = lines[0]?.split(',') ?? [];
      const col = header.indexOf('valor_centavos');
      expect(col).toBeGreaterThan(-1);
      const sum = lines.slice(1).reduce((total, line) => total + Number(splitCsv(line)[col]), 0);
      expect(sum).toBe(await ledgerSum(spaces.odd.space.id));
    });

    it('receita do Super fecha com as cobranças: taxa − tarifa − devolvida + recobrada', async () => {
      const res = await t
        .http()
        .get('/v1/super/online-payments/revenue')
        .set(...bearer(sup))
        .expect(200);
      const paid = (await t.db.select().from(onlineCharges)).filter((c) => c.paidAt);
      const { totals } = res.body;
      expect(totals.chargesCount).toBe(paid.length);
      expect(totals.volumeCents).toBe(paid.reduce((sum, c) => sum + c.amountCents, 0));
      expect(totals.grossFeeCents).toBe(paid.reduce((sum, c) => sum + c.platformFeeCents, 0));
      expect(totals.gatewayCostCents).toBe(paid.reduce((sum, c) => sum + c.gatewayCostCents, 0));
      expect(totals.netRevenueCents).toBe(
        totals.grossFeeCents -
          totals.gatewayCostCents -
          totals.feeRefundedCents +
          totals.feeRechargedCents,
      );
      // Por espaço e por meio somam o total.
      const sumOf = (rows: Row[], field: string) =>
        rows.reduce((sum, r) => sum + (r[field] as number), 0);
      for (const field of ['volumeCents', 'grossFeeCents', 'feeRefundedCents', 'netRevenueCents']) {
        expect(sumOf(res.body.bySpace, field), `bySpace.${field}`).toBe(totals[field]);
        expect(sumOf(res.body.byMethod, field), `byMethod.${field}`).toBe(totals[field]);
        expect(sumOf(res.body.byMonth, field), `byMonth.${field}`).toBe(totals[field]);
      }
      // Taxa devolvida e recobrada batem com os estornos gravados.
      const refunds = await t.db.select().from(onlineRefunds);
      const returned = refunds.reduce((sum, r) => sum + r.feeRefundCents, 0);
      expect(totals.feeRefundedCents - totals.feeRechargedCents).toBe(
        paid.reduce((sum, c) => sum + c.feeRefundedCents, 0),
      );
      expect(totals.feeRefundedCents).toBeLessThanOrEqual(returned);
    });

    it('outro jogador não paga a cobrança alheia: nada entra no livro-razão', async () => {
      const { bookingId } = await book('odd', { paymentOption: 'ONLINE_PIX' });
      const before = await ledgerSum(spaces.odd.space.id);
      await t
        .http()
        .post(`/v1/bookings/${bookingId}/payment`)
        .set(...bearer(other))
        .send({ method: 'PIX' })
        .expect((res) => expect([403, 404]).toContain(res.status));
      expect(await ledgerSum(spaces.odd.space.id)).toBe(before);
    });
  });
});
