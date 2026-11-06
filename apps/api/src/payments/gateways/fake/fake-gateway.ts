import { createHash, randomUUID } from 'node:crypto';
import {
  divideRoundHalfUp,
  FAKE_REJECTED_DOCUMENT_SUFFIX,
  maskCnpj,
  maskCpf,
  type PaymentsSandbox,
  parseFakeCardToken,
  proportionalFeeRefund,
} from '@space-sports/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../../db/client.js';
import { fakeGatewayObjects } from '../../../db/schema/index.js';
import {
  type GatewayAccount,
  type GatewayAccountInput,
  type GatewayCardInput,
  type GatewayCharge,
  type GatewayEvent,
  type GatewayJobs,
  type GatewayPayout,
  type GatewayPayoutChange,
  type GatewayPixInput,
  type GatewayRefund,
  InvalidWebhookPayload,
  InvalidWebhookSignature,
  type PaymentGateway,
  type WebhookDelivery,
  type WebhookRequest,
} from '../../gateway/payment-gateway.js';
import type { PaymentsQueue } from '../../payments-queue.js';
import { fakePixCopyPaste, qrSvg } from './fake-pix.js';
import { FAKE_SIGNATURE_HEADER, signFakeWebhook, verifyFakeWebhook } from './fake-signature.js';

// Gateway simulado (decisão 92; docs/13 §10). Guarda o próprio estado em `fake_gateway_objects` (o
// namespace dele) e conversa com a API como um gateway real: responde às chamadas e manda webhooks
// assinados pela fila. Nada fora desta pasta conhece os tipos daqui.

export interface FakeGatewayConfig {
  webhookSecret: string;
  webhookUrl: string;
  approvalDelayMs: number;
  chargebackDelayMs: number;
  pixReleaseDays: number;
  cardReleaseDays: number;
  pixCostBps: number;
  cardCostBps: number;
  cardCostFixedCents: number;
}

/** Jobs do fake na fila de pagamentos. */
export const FAKE_JOBS = {
  deliverWebhook: 'fake.deliver-webhook',
  decideAccount: 'fake.decide-account',
  chargeback: 'fake.chargeback',
  payouts: 'fake.payouts',
} as const;

const DAY_MS = 24 * 60 * 60_000;
/** Prazo da contestação de um chargeback simulado. */
const DISPUTE_WINDOW_MS = 7 * DAY_MS;

type Kind = 'account' | 'charge' | 'payout';

interface FakeAccount {
  status: GatewayAccount['status'];
  rejectionReason: string | null;
  rejectByDocument: boolean;
  payoutChanges: number;
  /** Troca da conta de recebimento mais recente (decisão 98). */
  payoutChange?: GatewayPayoutChange | null;
  createdAt: string;
}

/** Documentos válidos (com dígitos verificadores) terminados em 0000: o fake recusa. */
const REJECTED_EXAMPLES = { cpf: '10000550000', cnpj: '10000036010000' };

interface FakeRefund {
  providerRefundId: string;
  kind: GatewayRefund['kind'];
  status: GatewayRefund['status'];
  amountCents: number;
  platformFeeRefundCents: number;
  reason: string | null;
  createdAt: string;
  disputeDueAt: string | null;
  dispute: { text: string; attachmentUrls: string[]; submittedAt: string } | null;
  disputeOutcome: 'WON' | 'LOST' | null;
  disputeResolvedAt: string | null;
}

interface FakeCharge {
  idempotencyKey?: string;
  accountId: string;
  method: 'PIX' | 'CARD';
  status: GatewayCharge['status'];
  amountCents: number;
  platformFeeCents: number;
  gatewayCostCents: number;
  description: string;
  paidAt: string | null;
  availableAt: string | null;
  expiresAt: string | null;
  failureReason: string | null;
  pix: { copyPaste: string; qrSvg: string } | null;
  card: { brand: string | null; last4: string | null } | null;
  refunds: FakeRefund[];
}

interface FakePayout {
  accountId: string;
  amountCents: number;
  status: GatewayPayout['status'];
  scheduledFor: string;
  paidAt: string | null;
  failureReason: string | null;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const hashOf = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const iso = (date: Date) => date.toISOString();
const date = (value: string | null) => (value ? new Date(value) : null);

export class FakePaymentGateway implements PaymentGateway {
  readonly provider = 'fake';
  readonly testMode = true;
  readonly sandbox: PaymentsSandbox;

  constructor(
    private readonly db: Database,
    private readonly queue: PaymentsQueue,
    private readonly config: FakeGatewayConfig,
  ) {
    const seconds = Math.max(Math.round(config.approvalDelayMs / 1000), 1);
    const card = (
      label: string,
      number: string,
      outcome: PaymentsSandbox['testCards'][number]['outcome'],
      description: string,
    ) => ({
      label,
      number,
      outcome,
      holderName: 'TESTE SPACE SPORTS',
      expiry: '12/30',
      cvc: '123',
      description,
    });
    this.sandbox = {
      label: 'Ambiente de teste',
      testCards: [
        card('Aprova', '4111 1111 1111 1111', 'APPROVED', 'O pagamento é aprovado.'),
        card('Recusa', '4000 0000 0000 0002', 'DECLINED', 'O banco recusa o cartão.'),
        card(
          'Aprova e contesta',
          '4000 0000 0000 0259',
          'CHARGEBACK',
          'Aprovado e, em seguida, contestado no cartão (chargeback).',
        ),
      ],
      rejectedDocument: {
        hint: `Documento terminado em ${FAKE_REJECTED_DOCUMENT_SUFFIX} é recusado; os demais são aprovados em cerca de ${seconds} s.`,
        examples: [
          { type: 'CPF', document: maskCpf(REJECTED_EXAMPLES.cpf) },
          { type: 'CNPJ', document: maskCnpj(REJECTED_EXAMPLES.cnpj) },
        ],
      },
      notes: [
        'Nenhum valor é cobrado de verdade.',
        'Pix: pague, vença ou conteste pelo simulador de pagamentos do Super.',
      ],
    };
  }

  // -------------------------------------------------------------------------------------------
  // Subconta

  async createAccount(input: GatewayAccountInput): Promise<GatewayAccount> {
    const id = `acc_${hashOf(input.idempotencyKey)}`;
    const existing = await this.find<FakeAccount>(this.db, id, 'account');
    if (existing) return toAccount(id, existing);
    const account: FakeAccount = {
      status: 'PENDING',
      rejectionReason: null,
      rejectByDocument: input.document.endsWith(FAKE_REJECTED_DOCUMENT_SUFFIX),
      payoutChanges: 0,
      createdAt: iso(new Date()),
    };
    await this.save(this.db, id, 'account', id, account);
    await this.queue.enqueue({
      name: FAKE_JOBS.decideAccount,
      data: { accountId: id },
      delayMs: this.config.approvalDelayMs,
      jobId: `fake-decide-${id}`,
    });
    return toAccount(id, account);
  }

  async getAccount(providerAccountId: string): Promise<GatewayAccount> {
    const account = await this.find<FakeAccount>(this.db, providerAccountId, 'account');
    if (!account) throw new Error(`Subconta fake inexistente: ${providerAccountId}`);
    return toAccount(providerAccountId, account);
  }

  /** Troca da conta de recebimento: volta à análise e é aprovada sozinha como o cadastro. */
  async updateAccountPayout(input: {
    providerAccountId: string;
    idempotencyKey: string;
    payout: GatewayAccountInput['payout'];
  }): Promise<GatewayAccount> {
    const account = await this.db.transaction(async (tx) => {
      const current = await this.find<FakeAccount>(tx, input.providerAccountId, 'account', true);
      if (!current) throw new Error(`Subconta fake inexistente: ${input.providerAccountId}`);
      // O mesmo pedido de novo (retentativa) não abre outra troca.
      if (current.payoutChange?.idempotencyKey === input.idempotencyKey) return current;
      current.status = 'PENDING';
      current.rejectionReason = null;
      current.rejectByDocument = false;
      current.payoutChanges = (current.payoutChanges ?? 0) + 1;
      current.payoutChange = {
        idempotencyKey: input.idempotencyKey,
        status: 'PENDING',
        rejectionReason: null,
      };
      await this.save(tx, input.providerAccountId, 'account', input.providerAccountId, current);
      return current;
    });
    await this.queue.enqueue({
      name: FAKE_JOBS.decideAccount,
      data: { accountId: input.providerAccountId },
      delayMs: this.config.approvalDelayMs,
      jobId: `fake-decide-${input.providerAccountId}-${hashOf(input.idempotencyKey)}`,
    });
    return toAccount(input.providerAccountId, account);
  }

  /**
   * Aprovação automática (job) ou decisão do simulador. Sem `decision`, só decide o que está
   * pendente: documento de teste terminado em 0000 é recusado, o resto aprovado. Com uma troca de
   * conta em análise, a decisão é da troca: aprovada ou recusada, a subconta volta a `APPROVED`
   * (recusada, com a conta anterior; decisão 98). Recusar uma subconta já aprovada, sem troca em
   * análise, não tem efeito (decisão 98: a recusa não derruba o espaço).
   */
  async decideAccount(
    providerAccountId: string,
    decision?: { approve: boolean; reason?: string },
  ): Promise<boolean> {
    const changed = await this.db.transaction(async (tx) => {
      const account = await this.find<FakeAccount>(tx, providerAccountId, 'account', true);
      if (!account) return false;
      if (!decision && account.status !== 'PENDING') return false;
      if (decision && !decision.approve && account.status === 'APPROVED') return false;
      // Subconta em análise depois de uma troca: a decisão é da troca (também a troca antiga,
      // de antes da chave na troca, que não tem `payoutChange`).
      if (account.status === 'PENDING' && (account.payoutChanges ?? 0) > 0) {
        const approve = decision ? decision.approve : true;
        account.status = 'APPROVED';
        account.payoutChange = {
          idempotencyKey: account.payoutChange?.idempotencyKey ?? null,
          status: approve ? 'APPROVED' : 'REJECTED',
          rejectionReason: approve
            ? null
            : (decision?.reason ??
              'Conta de recebimento recusada na verificação (troca de teste).'),
        };
      } else {
        const approve = decision ? decision.approve : !account.rejectByDocument;
        account.status = approve ? 'APPROVED' : 'REJECTED';
        account.rejectionReason = approve
          ? null
          : (decision?.reason ?? 'Documento recusado na verificação (cadastro de teste).');
      }
      await this.save(tx, providerAccountId, 'account', providerAccountId, account);
      return true;
    });
    if (changed) await this.emit('account.updated', providerAccountId);
    return changed;
  }

  // -------------------------------------------------------------------------------------------
  // Cobranças

  async createPixCharge(input: GatewayPixInput): Promise<GatewayCharge> {
    const id = `ch_${hashOf(input.idempotencyKey)}`;
    const existing = await this.find<FakeCharge>(this.db, id, 'charge');
    if (existing) return toCharge(id, existing);
    const copyPaste = fakePixCopyPaste(input.amountCents, id);
    const charge: FakeCharge = {
      ...this.baseCharge(input, 'PIX'),
      status: 'PENDING',
      expiresAt: iso(input.expiresAt),
      pix: { copyPaste, qrSvg: qrSvg(copyPaste) },
    };
    await this.save(this.db, id, 'charge', input.split.providerAccountId, charge);
    return toCharge(id, charge);
  }

  async createCardCharge(input: GatewayCardInput): Promise<GatewayCharge> {
    const id = `ch_${hashOf(input.idempotencyKey)}`;
    const existing = await this.find<FakeCharge>(this.db, id, 'charge');
    if (existing) return toCharge(id, existing);
    const token = parseFakeCardToken(input.cardToken);
    const now = new Date();
    const approved = token?.scenario === 'approve' || token?.scenario === 'chargeback';
    const charge: FakeCharge = {
      ...this.baseCharge(input, 'CARD'),
      status: approved ? 'PAID' : 'FAILED',
      failureReason: approved ? null : token ? 'CARD_DECLINED' : 'INVALID_CARD_TOKEN',
      paidAt: approved ? iso(now) : null,
      availableAt: approved
        ? iso(new Date(now.getTime() + this.config.cardReleaseDays * DAY_MS))
        : null,
      card: { brand: token?.brand ?? null, last4: token?.last4 ?? null },
    };
    await this.save(this.db, id, 'charge', input.split.providerAccountId, charge);
    await this.emit('charge.updated', id);
    if (token?.scenario === 'chargeback') {
      await this.queue.enqueue({
        name: FAKE_JOBS.chargeback,
        data: { chargeId: id },
        delayMs: this.config.chargebackDelayMs,
        jobId: `fake-chargeback-${id}`,
      });
    }
    return toCharge(id, charge);
  }

  async getCharge(providerChargeId: string): Promise<GatewayCharge> {
    return this.db.transaction(async (tx) => {
      const charge = await this.find<FakeCharge>(tx, providerChargeId, 'charge', true);
      if (!charge) throw new Error(`Cobrança fake inexistente: ${providerChargeId}`);
      // O Pix vence sozinho no gateway.
      if (
        charge.status === 'PENDING' &&
        charge.expiresAt &&
        new Date(charge.expiresAt) <= new Date()
      ) {
        charge.status = 'EXPIRED';
        await this.save(tx, providerChargeId, 'charge', charge.accountId, charge);
      }
      return toCharge(providerChargeId, charge);
    });
  }

  async findChargeByIdempotencyKey(idempotencyKey: string): Promise<GatewayCharge | null> {
    const id = `ch_${hashOf(idempotencyKey)}`;
    return (await this.find<FakeCharge>(this.db, id, 'charge')) ? this.getCharge(id) : null;
  }

  async cancelCharge(providerChargeId: string): Promise<GatewayCharge> {
    const { charge, changed } = await this.mutateCharge(providerChargeId, (charge) => {
      if (charge.status !== 'PENDING') return false;
      charge.status = 'CANCELLED';
      return true;
    });
    if (changed) await this.emit('charge.updated', providerChargeId);
    return charge;
  }

  async refundCharge(input: {
    providerChargeId: string;
    idempotencyKey: string;
    amountCents: number;
    platformFeeRefundCents: number;
    reason: string | null;
  }): Promise<GatewayRefund> {
    const refundId = `re_${hashOf(input.idempotencyKey)}`;
    let refund: FakeRefund | undefined;
    const { changed } = await this.mutateCharge(input.providerChargeId, (charge) => {
      refund = charge.refunds.find((r) => r.providerRefundId === refundId);
      if (refund) return false;
      // Contestação ganha: o valor voltou ao espaço e pode ser estornado.
      const refunded = charge.refunds
        .filter((r) => r.disputeOutcome !== 'WON')
        .reduce((sum, r) => sum + r.amountCents, 0);
      if (charge.status !== 'PAID' || input.amountCents > charge.amountCents - refunded) {
        throw new Error('Estorno recusado pelo gateway fake.');
      }
      refund = {
        providerRefundId: refundId,
        kind: 'REFUND',
        status: 'SUCCEEDED',
        amountCents: input.amountCents,
        platformFeeRefundCents: input.platformFeeRefundCents,
        reason: input.reason,
        createdAt: iso(new Date()),
        disputeDueAt: null,
        dispute: null,
        disputeOutcome: null,
        disputeResolvedAt: null,
      };
      charge.refunds.push(refund);
      return true;
    });
    if (changed) await this.emit('charge.updated', input.providerChargeId);
    if (!refund) throw new Error('Estorno sem retorno.');
    return toRefund(refund);
  }

  async submitDispute(input: {
    providerChargeId: string;
    providerRefundId: string;
    text: string;
    attachmentUrls: string[];
  }): Promise<void> {
    await this.mutateCharge(input.providerChargeId, (charge) => {
      const refund = charge.refunds.find((r) => r.providerRefundId === input.providerRefundId);
      if (refund?.kind !== 'CHARGEBACK') throw new Error('Chargeback inexistente no gateway fake.');
      refund.dispute = {
        text: input.text,
        attachmentUrls: input.attachmentUrls,
        submittedAt: iso(new Date()),
      };
      return true;
    });
  }

  async getPayout(providerPayoutId: string): Promise<GatewayPayout> {
    const payout = await this.find<FakePayout>(this.db, providerPayoutId, 'payout');
    if (!payout) throw new Error(`Repasse fake inexistente: ${providerPayoutId}`);
    return toPayout(providerPayoutId, payout);
  }

  // -------------------------------------------------------------------------------------------
  // Webhooks

  parseWebhook({ headers, rawBody }: WebhookRequest): GatewayEvent[] {
    const header = headers[FAKE_SIGNATURE_HEADER];
    if (
      !verifyFakeWebhook(
        this.config.webhookSecret,
        typeof header === 'string' ? header : undefined,
        rawBody,
      )
    ) {
      throw new InvalidWebhookSignature();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new InvalidWebhookPayload();
    }
    // JSON válido sem o formato de evento (lista, número, nulo): nada a processar.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const body = parsed as Record<string, unknown>;
    const { id, type, objectId, createdAt } = body;
    if (
      typeof id !== 'string' ||
      typeof objectId !== 'string' ||
      (type !== 'charge.updated' && type !== 'account.updated' && type !== 'payout.updated')
    ) {
      return [];
    }
    return [
      {
        eventId: id,
        type,
        objectId,
        occurredAt: typeof createdAt === 'string' ? new Date(createdAt) : new Date(),
        payload: body,
      },
    ];
  }

  /** Corpo e headers assinados no momento da entrega (o carimbo de tempo vale 5 minutos). */
  signedDelivery(body: string): WebhookDelivery {
    return {
      provider: this.provider,
      url: this.config.webhookUrl,
      headers: {
        'content-type': 'application/json',
        [FAKE_SIGNATURE_HEADER]: signFakeWebhook(this.config.webhookSecret, body),
      },
      body,
    };
  }

  /** Jobs do fake: entrega de webhooks, aprovação automática, chargeback atrasado e repasse diário. */
  jobs(deliver: (delivery: WebhookDelivery) => Promise<void>): GatewayJobs {
    return {
      handlers: {
        [FAKE_JOBS.deliverWebhook]: async (data) => deliver(this.signedDelivery(String(data.body))),
        [FAKE_JOBS.decideAccount]: async (data) => this.decideAccount(String(data.accountId)),
        [FAKE_JOBS.chargeback]: async (data) => this.simulateChargeback(String(data.chargeId)),
        [FAKE_JOBS.payouts]: async () => this.runPayouts(),
      },
      schedules: [{ id: 'fake-daily-payouts', name: FAKE_JOBS.payouts, pattern: '0 6 * * *' }],
    };
  }

  // -------------------------------------------------------------------------------------------
  // Simulador (RF-ONPAY-12) e jobs do fake

  /**
   * Paga um Pix. Aceita também o vencido ou cancelado, para simular o pagamento que o banco
   * liquida depois do prazo (a API registra e estorna, RN-ONPAY-02).
   */
  async simulatePixPaid(providerChargeId: string): Promise<boolean> {
    const { changed } = await this.mutateCharge(providerChargeId, (charge) => {
      if (charge.method !== 'PIX' || !['PENDING', 'EXPIRED', 'CANCELLED'].includes(charge.status)) {
        return false;
      }
      const now = new Date();
      charge.status = 'PAID';
      charge.paidAt = iso(now);
      charge.availableAt = iso(new Date(now.getTime() + this.config.pixReleaseDays * DAY_MS));
      return true;
    });
    if (changed) await this.emit('charge.updated', providerChargeId);
    return changed;
  }

  async simulateExpire(providerChargeId: string): Promise<boolean> {
    const { changed } = await this.mutateCharge(providerChargeId, (charge) => {
      if (charge.status !== 'PENDING') return false;
      charge.status = 'EXPIRED';
      return true;
    });
    if (changed) await this.emit('charge.updated', providerChargeId);
    return changed;
  }

  /** Contestação no cartão do valor ainda não estornado. */
  async simulateChargeback(providerChargeId: string, reason?: string): Promise<boolean> {
    const { changed } = await this.mutateCharge(providerChargeId, (charge) => {
      if (charge.status !== 'PAID' || charge.refunds.some((r) => r.kind === 'CHARGEBACK')) {
        return false;
      }
      const refunded = charge.refunds.reduce((sum, r) => sum + r.amountCents, 0);
      const feeRefunded = charge.refunds.reduce((sum, r) => sum + r.platformFeeRefundCents, 0);
      const amount = charge.amountCents - refunded;
      if (amount <= 0) return false;
      const now = new Date();
      charge.refunds.push({
        providerRefundId: `cb_${randomUUID()}`,
        kind: 'CHARGEBACK',
        status: 'SUCCEEDED',
        amountCents: amount,
        platformFeeRefundCents: proportionalFeeRefund(
          {
            amountCents: charge.amountCents,
            platformFeeCents: charge.platformFeeCents,
            refundedCents: refunded,
            feeRefundedCents: feeRefunded,
          },
          amount,
        ),
        reason: reason ?? 'Compra não reconhecida pelo titular (simulado).',
        createdAt: iso(now),
        disputeDueAt: iso(new Date(now.getTime() + DISPUTE_WINDOW_MS)),
        dispute: null,
        disputeOutcome: null,
        disputeResolvedAt: null,
      });
      return true;
    });
    if (changed) await this.emit('charge.updated', providerChargeId);
    return changed;
  }

  /** Resultado da contestação do chargeback (o emissor decide; no fake, o simulador). */
  async simulateDisputeOutcome(
    providerChargeId: string,
    outcome: 'WON' | 'LOST',
  ): Promise<boolean> {
    const { changed } = await this.mutateCharge(providerChargeId, (charge) => {
      const chargeback = charge.refunds.find((r) => r.kind === 'CHARGEBACK');
      if (!chargeback || chargeback.disputeOutcome) return false;
      chargeback.disputeOutcome = outcome;
      chargeback.disputeResolvedAt = iso(new Date());
      return true;
    });
    if (changed) await this.emit('charge.updated', providerChargeId);
    return changed;
  }

  /**
   * "Liquidar saldos": libera agora o que estava a liberar (da subconta ou de todas) e roda o
   * repasse. Devolve quantos webhooks saíram.
   */
  async settle(providerAccountId?: string): Promise<number> {
    const now = new Date();
    const charges = await this.db
      .select({ id: fakeGatewayObjects.id })
      .from(fakeGatewayObjects)
      .where(
        and(
          eq(fakeGatewayObjects.kind, 'charge'),
          providerAccountId ? eq(fakeGatewayObjects.accountId, providerAccountId) : undefined,
          sql`${fakeGatewayObjects.data}->>'availableAt' > ${iso(now)}`,
        ),
      );
    let events = 0;
    for (const { id } of charges) {
      const { changed } = await this.mutateCharge(id, (charge) => {
        if (!charge.availableAt || new Date(charge.availableAt) <= now) return false;
        charge.availableAt = iso(now);
        return true;
      });
      if (changed) {
        await this.emit('charge.updated', id);
        events++;
      }
    }
    return events + (await this.runPayouts(providerAccountId));
  }

  /** Repasse diário: o saldo disponível de cada subconta aprovada vai para a conta do espaço. */
  async runPayouts(providerAccountId?: string): Promise<number> {
    const accounts = await this.db
      .select({ id: fakeGatewayObjects.id })
      .from(fakeGatewayObjects)
      .where(
        and(
          eq(fakeGatewayObjects.kind, 'account'),
          providerAccountId ? eq(fakeGatewayObjects.id, providerAccountId) : undefined,
          sql`${fakeGatewayObjects.data}->>'status' = 'APPROVED'`,
        ),
      );
    let events = 0;
    for (const { id: accountId } of accounts) {
      const payoutId = await this.db.transaction(async (tx) => {
        // Serializa os repasses da subconta.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`fake-payout:${accountId}`}))`,
        );
        const available = await this.available(tx, accountId, new Date());
        if (available <= 0) return null;
        const id = `po_${randomUUID()}`;
        const now = iso(new Date());
        const payout: FakePayout = {
          accountId,
          amountCents: available,
          status: 'PAID',
          scheduledFor: now,
          paidAt: now,
          failureReason: null,
        };
        await this.save(tx, id, 'payout', accountId, payout);
        return id;
      });
      if (payoutId) {
        await this.emit('payout.updated', payoutId);
        events++;
      }
    }
    return events;
  }

  /** Saldo disponível na subconta: vendas liberadas − taxa − estornos (líquidos) − repasses. */
  private async available(tx: Tx, accountId: string, now: Date): Promise<number> {
    const rows = await tx
      .select({ kind: fakeGatewayObjects.kind, data: fakeGatewayObjects.data })
      .from(fakeGatewayObjects)
      .where(
        and(
          eq(fakeGatewayObjects.accountId, accountId),
          sql`${fakeGatewayObjects.kind} IN ('charge', 'payout')`,
        ),
      );
    let total = 0;
    for (const row of rows) {
      if (row.kind === 'payout') {
        const payout = row.data as unknown as FakePayout;
        if (payout.status !== 'FAILED') total -= payout.amountCents;
        continue;
      }
      const charge = row.data as unknown as FakeCharge;
      if (charge.status !== 'PAID') continue;
      // Venda ainda a liberar: o estorno dela sai do "a liberar", não do disponível.
      if (!charge.availableAt || new Date(charge.availableAt) > now) continue;
      total += charge.amountCents - charge.platformFeeCents;
      for (const refund of charge.refunds) {
        if (refund.status !== 'SUCCEEDED') continue;
        // Contestação ganha: o valor volta e a taxa devolvida é cobrada de novo (decisão 94).
        if (refund.disputeOutcome === 'WON') continue;
        total -= refund.amountCents - refund.platformFeeRefundCents;
      }
    }
    return total;
  }

  // -------------------------------------------------------------------------------------------
  // Persistência e webhooks

  private baseCharge(
    input: GatewayPixInput | GatewayCardInput,
    method: 'PIX' | 'CARD',
  ): FakeCharge {
    const gatewayCostCents =
      method === 'PIX'
        ? divideRoundHalfUp(input.amountCents * this.config.pixCostBps, 10_000)
        : divideRoundHalfUp(input.amountCents * this.config.cardCostBps, 10_000) +
          this.config.cardCostFixedCents;
    return {
      idempotencyKey: input.idempotencyKey,
      accountId: input.split.providerAccountId,
      method,
      status: 'PENDING',
      amountCents: input.amountCents,
      platformFeeCents: input.split.platformFeeCents,
      gatewayCostCents,
      description: input.description,
      paidAt: null,
      availableAt: null,
      expiresAt: null,
      failureReason: null,
      pix: null,
      card: null,
      refunds: [],
    };
  }

  private async mutateCharge(
    providerChargeId: string,
    mutate: (charge: FakeCharge) => boolean,
  ): Promise<{ charge: GatewayCharge; changed: boolean }> {
    return this.db.transaction(async (tx) => {
      const charge = await this.find<FakeCharge>(tx, providerChargeId, 'charge', true);
      if (!charge) throw new Error(`Cobrança fake inexistente: ${providerChargeId}`);
      const changed = mutate(charge);
      if (changed) await this.save(tx, providerChargeId, 'charge', charge.accountId, charge);
      return { charge: toCharge(providerChargeId, charge), changed };
    });
  }

  private async find<T>(
    db: Database | Tx,
    id: string,
    kind: Kind,
    lock = false,
  ): Promise<T | undefined> {
    const query = db
      .select({ data: fakeGatewayObjects.data })
      .from(fakeGatewayObjects)
      .where(and(eq(fakeGatewayObjects.id, id), eq(fakeGatewayObjects.kind, kind)));
    const [row] = lock ? await query.for('update') : await query;
    return row?.data as T | undefined;
  }

  private async save(db: Database | Tx, id: string, kind: Kind, accountId: string, data: object) {
    await db
      .insert(fakeGatewayObjects)
      .values({ id, kind, accountId, data: data as Record<string, unknown> })
      .onConflictDoUpdate({
        target: fakeGatewayObjects.id,
        set: { data: data as Record<string, unknown> },
      });
  }

  /** Enfileira o webhook (a assinatura sai na entrega). */
  private async emit(type: GatewayEvent['type'], objectId: string): Promise<void> {
    const body = JSON.stringify({
      id: `evt_${randomUUID()}`,
      type,
      objectId,
      createdAt: iso(new Date()),
    });
    await this.queue.enqueue({ name: FAKE_JOBS.deliverWebhook, data: { body } });
  }
}

function toAccount(id: string, account: FakeAccount): GatewayAccount {
  return {
    providerAccountId: id,
    status: account.status,
    rejectionReason: account.rejectionReason,
    payoutChange: account.payoutChange ?? null,
  };
}

function toRefund(refund: FakeRefund): GatewayRefund {
  return {
    providerRefundId: refund.providerRefundId,
    kind: refund.kind,
    status: refund.status,
    amountCents: refund.amountCents,
    platformFeeRefundCents: refund.platformFeeRefundCents,
    reason: refund.reason,
    createdAt: new Date(refund.createdAt),
    disputeDueAt: date(refund.disputeDueAt),
    disputeOutcome: refund.disputeOutcome ?? null,
    disputeResolvedAt: date(refund.disputeResolvedAt ?? null),
  };
}

function toCharge(id: string, charge: FakeCharge): GatewayCharge {
  return {
    providerChargeId: id,
    idempotencyKey: charge.idempotencyKey ?? null,
    status: charge.status,
    amountCents: charge.amountCents,
    platformFeeCents: charge.platformFeeCents,
    paidAt: date(charge.paidAt),
    availableAt: date(charge.availableAt),
    gatewayCostCents: charge.gatewayCostCents,
    failureReason: charge.failureReason,
    pix:
      charge.pix && charge.expiresAt
        ? { ...charge.pix, expiresAt: new Date(charge.expiresAt) }
        : null,
    card: charge.card,
    refunds: charge.refunds.map(toRefund),
  };
}

function toPayout(id: string, payout: FakePayout): GatewayPayout {
  return {
    providerPayoutId: id,
    providerAccountId: payout.accountId,
    amountCents: payout.amountCents,
    status: payout.status,
    scheduledFor: new Date(payout.scheduledFor),
    paidAt: date(payout.paidAt),
    failureReason: payout.failureReason,
  };
}
