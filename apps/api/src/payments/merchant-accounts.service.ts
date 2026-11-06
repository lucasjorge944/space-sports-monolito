import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ChangePayoutDestinationInput,
  type MerchantAccount,
  maskDocument,
  maskTail,
  type PayoutDestination,
  type SubmitMerchantAccountInput,
  type SuperMerchantAccountList,
  type SuperMerchantAccountsQuery,
} from '@space-sports/shared';
import { and, asc, count, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { audit } from '../bookings/db-utils.js';
import { maskEmail } from '../common/mask-email.js';
import type { Database } from '../db/client.js';
import { merchantAccounts, spaces } from '../db/schema/index.js';
import { DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { type DataCipher, PAYMENTS_DATA_CIPHER } from './data-cipher.js';
import { PAYMENT_GATEWAY, paymentEnvironmentOf } from './gateway/gateway.registry.js';
import type { GatewayAccount, PaymentGateway } from './gateway/payment-gateway.js';
import {
  gatewayUnavailable,
  merchantAccountApproved,
  merchantAccountNotFound,
  merchantAccountPending,
  merchantNotApproved,
  onlinePaymentsDisabled,
} from './payments.errors.js';

type AccountRow = typeof merchantAccounts.$inferSelect;

const BANK_ACCOUNT_LABELS = { CHECKING: 'Conta corrente', SAVINGS: 'Poupança' } as const;
const PIX_KEY_LABELS = {
  CPF: 'CPF',
  CNPJ: 'CNPJ',
  EMAIL: 'e-mail',
  PHONE: 'telefone',
  RANDOM: 'aleatória',
} as const;

/** Conta ou chave Pix mascarada (RN-ONPAY-10): só o fim aparece. */
export function maskPayout(payout: PayoutDestination): string {
  if (payout.kind === 'BANK_ACCOUNT') {
    return `Banco ${payout.bankCode} · Ag. ${payout.agency} · ${BANK_ACCOUNT_LABELS[payout.accountType]} ${maskTail(`${payout.account}${payout.accountDigit}`, 3)}`;
  }
  const key =
    payout.keyType === 'EMAIL'
      ? maskEmail(payout.key)
      : payout.keyType === 'CPF' || payout.keyType === 'CNPJ'
        ? maskDocument(payout.keyType, payout.key)
        : maskTail(payout.key, 4);
  return `Chave Pix (${PIX_KEY_LABELS[payout.keyType]}) ${key}`;
}

/**
 * Cadastros `PENDING` há mais que isso são ressincronizados com o gateway pela reconciliação (a
 * cada 10 min): cobre o webhook perdido e a troca de conta que não chegou ao gateway.
 */
export const MERCHANT_RESYNC_AFTER_MIN = 15;

/** Motivo da troca gravada que o gateway nunca recebeu (desfeita pela reconciliação). */
export const PAYOUT_CHANGE_NOT_CONFIRMED_REASON =
  'Não foi possível confirmar a troca com o parceiro de pagamentos. Tente de novo.';

/**
 * Cadastro do espaço no gateway (RF-ONPAY-01, decisões 90, 95, 97 e 98): envio e reenvio pelo
 * Dono (até a primeira aprovação), troca da conta de recebimento (volta à análise e pausa os
 * repasses; recusada, volta a valer a conta anterior), sincronização pelos webhooks e pela
 * reconciliação. Documento completo só cifrado; CPF do responsável e conta só mascarados.
 */
@Injectable()
export class MerchantAccountsService {
  private readonly logger = new Logger(MerchantAccountsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    private readonly events: DomainEvents,
    @Inject(PAYMENTS_DATA_CIPHER) private readonly cipher: DataCipher,
  ) {}

  async get(spaceId: string): Promise<MerchantAccount> {
    const [row] = await this.db
      .select()
      .from(merchantAccounts)
      .where(eq(merchantAccounts.spaceId, spaceId));
    return this.toView(row);
  }

  /**
   * Envio (ou reenvio depois da recusa). Pendente não reenvia; espaço que já foi aprovado nunca
   * refaz o cadastro nem cria outra subconta, só troca a conta de recebimento (decisão 98).
   */
  async submit(
    spaceId: string,
    actorId: string,
    input: SubmitMerchantAccountInput,
  ): Promise<MerchantAccount> {
    const gateway = this.gateway;
    if (!gateway) throw onlinePaymentsDisabled();
    const [current] = await this.db
      .select()
      .from(merchantAccounts)
      .where(eq(merchantAccounts.spaceId, spaceId));
    const sameProvider = current?.provider === gateway.provider;
    if (sameProvider && (current?.approvedAt || current?.status === 'APPROVED')) {
      throw merchantAccountApproved();
    }
    if (sameProvider && current?.status === 'PENDING') throw merchantAccountPending();
    const responsibleCpf = input.documentType === 'CNPJ' ? (input.responsibleCpf ?? null) : null;

    let account: GatewayAccount;
    try {
      account = await gateway.createAccount({
        idempotencyKey: randomUUID(),
        documentType: input.documentType,
        document: input.document,
        legalName: input.legalName,
        responsibleName: input.responsibleName,
        responsibleCpf,
        email: input.email,
        phone: input.phone,
        address: input.address,
        payout: input.payout,
      });
    } catch (err) {
      this.logger.error({ err, spaceId }, 'Falha ao enviar o cadastro ao gateway');
      throw gatewayUnavailable();
    }
    const now = new Date();
    const values = {
      spaceId,
      provider: gateway.provider,
      providerAccountId: account.providerAccountId,
      status: account.status,
      documentType: input.documentType,
      // Decisão 97: cifrado, com o espaço como contexto; decifrado só no relatório fiscal.
      documentEncrypted: this.cipher.encrypt(input.document, spaceId),
      documentMasked: maskDocument(input.documentType, input.document),
      legalName: input.legalName,
      responsibleName: input.responsibleName,
      // Minimização (LGPD): o CPF do responsável vai ao gateway e aqui fica só mascarado.
      responsibleCpfMasked: responsibleCpf ? maskDocument('CPF', responsibleCpf) : null,
      email: input.email,
      payoutKind: input.payout.kind,
      payoutMasked: maskPayout(input.payout),
      payoutChangeId: null,
      previousPayoutKind: null,
      previousPayoutMasked: null,
      rejectedPayoutMasked: null,
      payoutChangeRejectionReason: null,
      payoutChangeRejectedAt: null,
      rejectionReason: account.rejectionReason,
      termsAcceptedAt: now,
      submittedBy: actorId,
      submittedAt: now,
      approvedAt: account.status === 'APPROVED' ? now : null,
      rejectedAt: account.status === 'REJECTED' ? now : null,
    } as const;
    await this.db.transaction(async (tx) => {
      await tx
        .insert(merchantAccounts)
        .values(values)
        .onConflictDoUpdate({ target: merchantAccounts.spaceId, set: values });
      await audit(tx, {
        actorId,
        spaceId,
        action: current ? 'merchant_account.resubmit' : 'merchant_account.submit',
        entity: 'merchant_account',
        entityId: null,
        diff: {
          provider: gateway.provider,
          status: account.status,
          documentType: input.documentType,
          documentMasked: values.documentMasked,
          responsibleCpfMasked: values.responsibleCpfMasked,
          payoutMasked: values.payoutMasked,
        },
      });
    });
    if (account.status !== 'PENDING') {
      await this.events.publish({
        type: 'merchant_account.decided',
        spaceId,
        approved: account.status === 'APPROVED',
      });
    }
    return this.get(spaceId);
  }

  /**
   * Troca da conta de recebimento (decisões 95 e 98): só com o cadastro já aprovado. A intenção é
   * gravada antes de chamar o gateway (`PENDING`, a conta aprovada guardada e o id da troca, que
   * vai como chave de idempotência): o webhook da decisão que chegar antes do fim desta chamada já
   * encontra a troca. Se o gateway falha e não registrou a troca, a intenção é desfeita (502).
   * Apaga o aviso da troca recusada anterior e avisa todos os Donos.
   */
  async changePayout(
    spaceId: string,
    actorId: string,
    input: ChangePayoutDestinationInput,
  ): Promise<MerchantAccount> {
    const gateway = this.gateway;
    if (!gateway) throw onlinePaymentsDisabled();
    const changeId = randomUUID();
    const payoutMasked = maskPayout(input.payout);
    const now = new Date();
    const current = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(merchantAccounts)
        .where(eq(merchantAccounts.spaceId, spaceId))
        .for('update');
      if (!row?.providerAccountId || row.provider !== gateway.provider) {
        throw merchantAccountNotFound();
      }
      if (!row.approvedAt) throw merchantNotApproved();
      // Outra troca ainda em análise: a conta que volta numa recusa continua a aprovada (nula
      // numa troca antiga, de antes da conta guardada).
      const changeInReview = row.status === 'PENDING';
      await tx
        .update(merchantAccounts)
        .set({
          status: 'PENDING',
          payoutChangeId: changeId,
          payoutKind: input.payout.kind,
          payoutMasked,
          previousPayoutKind: changeInReview ? row.previousPayoutKind : row.payoutKind,
          previousPayoutMasked: changeInReview ? row.previousPayoutMasked : row.payoutMasked,
          rejectedPayoutMasked: null,
          payoutChangeRejectionReason: null,
          payoutChangeRejectedAt: null,
          termsAcceptedAt: now,
          submittedBy: actorId,
          submittedAt: now,
        })
        .where(eq(merchantAccounts.id, row.id));
      return row;
    });
    const providerAccountId = current.providerAccountId as string;
    try {
      await gateway.updateAccountPayout({
        providerAccountId,
        idempotencyKey: changeId,
        payout: input.payout,
      });
    } catch (err) {
      this.logger.error({ err, spaceId }, 'Falha ao trocar a conta no gateway');
      // Resultado desconhecido (timeout): se o gateway registrou a troca pela chave, ela vale.
      if (!(await this.changeReachedGateway(gateway, providerAccountId, changeId))) {
        await this.undoPayoutChange(current, changeId);
        throw gatewayUnavailable();
      }
    }
    await audit(this.db, {
      actorId,
      spaceId,
      action: 'merchant_account.change_payout',
      entity: 'merchant_account',
      entityId: current.id,
      diff: { from: current.payoutMasked, to: payoutMasked, payoutChangeId: changeId },
    });
    await this.events.publish({
      type: 'merchant_account.payout_changed',
      spaceId,
      changedBy: actorId,
    });
    return this.get(spaceId);
  }

  private async changeReachedGateway(
    gateway: PaymentGateway,
    providerAccountId: string,
    changeId: string,
  ): Promise<boolean> {
    try {
      const account = await gateway.getAccount(providerAccountId);
      return account.payoutChange?.idempotencyKey === changeId;
    } catch (err) {
      this.logger.error({ err, providerAccountId }, 'Falha ao consultar a troca no gateway');
      return false;
    }
  }

  /** Desfaz a intenção da troca que o gateway não recebeu (só se ela ainda for a vigente). */
  private async undoPayoutChange(before: AccountRow, changeId: string): Promise<void> {
    await this.db
      .update(merchantAccounts)
      .set({
        status: before.status,
        payoutChangeId: before.payoutChangeId,
        payoutKind: before.payoutKind,
        payoutMasked: before.payoutMasked,
        previousPayoutKind: before.previousPayoutKind,
        previousPayoutMasked: before.previousPayoutMasked,
        rejectedPayoutMasked: before.rejectedPayoutMasked,
        payoutChangeRejectionReason: before.payoutChangeRejectionReason,
        payoutChangeRejectedAt: before.payoutChangeRejectedAt,
        termsAcceptedAt: before.termsAcceptedAt,
        submittedBy: before.submittedBy,
        submittedAt: before.submittedAt,
      })
      .where(
        and(
          eq(merchantAccounts.id, before.id),
          eq(merchantAccounts.status, 'PENDING'),
          eq(merchantAccounts.payoutChangeId, changeId),
        ),
      );
  }

  /**
   * Webhook `account.updated` e reconciliação: o status do gateway vale (aprovado, recusado, em
   * análise). Com uma troca de conta em análise, vale a decisão da troca que a API pediu (pelo
   * id); recusada, volta a conta aprovada anterior (decisão 98). `staleBefore` (reconciliação):
   * a troca gravada antes disso que o gateway não conhece é desfeita como não confirmada.
   */
  async sync(providerAccountId: string, opts: { staleBefore?: Date } = {}): Promise<boolean> {
    const gateway = this.gateway;
    if (!gateway) return false;
    const [current] = await this.db
      .select()
      .from(merchantAccounts)
      .where(eq(merchantAccounts.providerAccountId, providerAccountId));
    if (!current || current.provider !== gateway.provider) return false;
    const account = await gateway.getAccount(providerAccountId);
    const changeInReview = current.status === 'PENDING' && current.approvedAt !== null;
    if (changeInReview && account.status !== 'REJECTED') {
      await this.syncPayoutChange(current, account, opts.staleBefore);
      return true;
    }
    if (account.status === current.status) return true;
    const now = new Date();
    const updated = await this.db.transaction(async (tx) => {
      // Só a partir do status lido: o mesmo evento processado duas vezes decide uma vez só.
      const [row] = await tx
        .update(merchantAccounts)
        .set({
          status: account.status,
          rejectionReason: account.rejectionReason,
          ...(account.status === 'APPROVED' && { approvedAt: now, rejectedAt: null }),
          ...(account.status === 'REJECTED' && { rejectedAt: now }),
        })
        .where(
          and(eq(merchantAccounts.id, current.id), eq(merchantAccounts.status, current.status)),
        )
        .returning({ id: merchantAccounts.id });
      if (!row) return false;
      await audit(tx, {
        actorId: null,
        spaceId: current.spaceId,
        action: `merchant_account.${account.status.toLowerCase()}`,
        entity: 'merchant_account',
        entityId: current.id,
        diff: { from: current.status, to: account.status, reason: account.rejectionReason },
      });
      return true;
    });
    if (updated && account.status !== 'PENDING') {
      await this.events.publish({
        type: 'merchant_account.decided',
        spaceId: current.spaceId,
        approved: account.status === 'APPROVED',
      });
    }
    return true;
  }

  /**
   * Troca de conta em análise: aplica a decisão do gateway se ela for da troca que a API pediu
   * (mesmo id). A troca antiga, sem id, aceita a decisão que o gateway informar.
   */
  private async syncPayoutChange(
    current: AccountRow,
    account: GatewayAccount,
    staleBefore: Date | undefined,
  ): Promise<void> {
    const change = account.payoutChange;
    const ours =
      current.payoutChangeId === null || change?.idempotencyKey === current.payoutChangeId;
    if (ours) {
      const outcome = change?.status ?? (account.status === 'APPROVED' ? 'APPROVED' : 'PENDING');
      if (outcome === 'PENDING') return;
      await this.closePayoutChange(current, outcome, change?.rejectionReason ?? null);
      return;
    }
    // O gateway não conhece a troca gravada (queda entre a intenção e a chamada): passado o
    // prazo da reconciliação, ela é desfeita como não confirmada, com aviso aos Donos.
    if (staleBefore && current.submittedAt < staleBefore && change?.status !== 'PENDING') {
      await this.closePayoutChange(current, 'REJECTED', PAYOUT_CHANGE_NOT_CONFIRMED_REASON);
    }
  }

  /**
   * Fecha a troca em análise. Aprovada, vale a nova conta. Recusada (decisão 98), não derruba o
   * espaço: volta a valer a conta aprovada anterior (status `APPROVED`, repasses retomados,
   * pagamento online segue) e a conta recusada e o motivo ficam para a tela; sem a conta anterior
   * (troca antiga), mantém a conta atual. Só a partir da troca lida (status e id): o mesmo evento
   * processado duas vezes em paralelo fecha, audita e avisa uma vez só.
   */
  private async closePayoutChange(
    current: AccountRow,
    outcome: 'APPROVED' | 'REJECTED',
    reason: string | null,
  ): Promise<void> {
    const now = new Date();
    const approved = outcome === 'APPROVED';
    const restored = current.previousPayoutMasked ?? current.payoutMasked;
    const closed = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(merchantAccounts)
        .set(
          approved
            ? {
                status: 'APPROVED',
                approvedAt: now,
                rejectedAt: null,
                previousPayoutKind: null,
                previousPayoutMasked: null,
              }
            : {
                status: 'APPROVED',
                payoutKind: current.previousPayoutKind ?? current.payoutKind,
                payoutMasked: restored,
                previousPayoutKind: null,
                previousPayoutMasked: null,
                rejectedPayoutMasked: current.payoutMasked,
                payoutChangeRejectionReason: reason,
                payoutChangeRejectedAt: now,
              },
        )
        .where(
          and(
            eq(merchantAccounts.id, current.id),
            eq(merchantAccounts.status, 'PENDING'),
            current.payoutChangeId
              ? eq(merchantAccounts.payoutChangeId, current.payoutChangeId)
              : isNull(merchantAccounts.payoutChangeId),
          ),
        )
        .returning({ id: merchantAccounts.id });
      if (!row) return false;
      await audit(tx, {
        actorId: null,
        spaceId: current.spaceId,
        action: approved ? 'merchant_account.approved' : 'merchant_account.payout_change_rejected',
        entity: 'merchant_account',
        entityId: current.id,
        diff: approved
          ? { payoutChangeId: current.payoutChangeId, payoutMasked: current.payoutMasked }
          : {
              payoutChangeId: current.payoutChangeId,
              rejected: current.payoutMasked,
              restored,
              previousUnknown: current.previousPayoutMasked === null,
              reason,
            },
      });
      return true;
    });
    if (!closed) return;
    await this.events.publish(
      approved
        ? { type: 'merchant_account.decided', spaceId: current.spaceId, approved: true }
        : { type: 'merchant_account.payout_change_rejected', spaceId: current.spaceId },
    );
  }

  /**
   * Reconciliação (a cada 10 min): ressincroniza os cadastros `PENDING` há mais de
   * `MERCHANT_RESYNC_AFTER_MIN` minutos (webhook perdido, decisão que chegou antes do fim da
   * troca, troca que não chegou ao gateway).
   */
  async resyncPending(now: Date = new Date()): Promise<number> {
    const gateway = this.gateway;
    if (!gateway) return 0;
    const staleBefore = new Date(now.getTime() - MERCHANT_RESYNC_AFTER_MIN * 60_000);
    const rows = await this.db
      .select({ providerAccountId: merchantAccounts.providerAccountId })
      .from(merchantAccounts)
      .where(
        and(
          eq(merchantAccounts.status, 'PENDING'),
          eq(merchantAccounts.provider, gateway.provider),
          isNotNull(merchantAccounts.providerAccountId),
          lt(merchantAccounts.submittedAt, staleBefore),
        ),
      );
    let synced = 0;
    for (const row of rows) {
      if (!row.providerAccountId) continue;
      try {
        if (await this.sync(row.providerAccountId, { staleBefore })) synced++;
      } catch (err) {
        this.logger.error(
          { err, providerAccountId: row.providerAccountId },
          'Falha ao ressincronizar o cadastro',
        );
      }
    }
    return synced;
  }

  /** RF-ONPAY-10: cadastros no gateway por status (Super), sempre mascarados. */
  async listForSuper(query: SuperMerchantAccountsQuery): Promise<SuperMerchantAccountList> {
    const where = query.status ? eq(merchantAccounts.status, query.status) : undefined;
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ account: merchantAccounts, spaceName: spaces.name, spaceSlug: spaces.slug })
        .from(merchantAccounts)
        .innerJoin(spaces, eq(spaces.id, merchantAccounts.spaceId))
        .where(where)
        .orderBy(asc(merchantAccounts.submittedAt), asc(merchantAccounts.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ total: count() }).from(merchantAccounts).where(where),
    ]);
    return {
      items: rows.map((row) => ({
        ...this.toView(row.account),
        spaceId: row.account.spaceId,
        spaceName: row.spaceName,
        spaceSlug: row.spaceSlug,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: total?.total ?? 0,
    };
  }

  /** Visão do painel: nunca o documento completo (RN-ONPAY-10). */
  toView(row: AccountRow | undefined): MerchantAccount {
    const environment = paymentEnvironmentOf(this.gateway);
    if (!row) {
      return {
        status: 'NOT_STARTED',
        documentType: null,
        documentMasked: null,
        legalName: null,
        responsibleName: null,
        responsibleCpfMasked: null,
        email: null,
        payoutKind: null,
        payoutMasked: null,
        rejectionReason: null,
        submittedAt: null,
        approvedAt: null,
        rejectedAt: null,
        payoutsPaused: false,
        lastRejectedPayoutChange: null,
        paymentEnvironment: environment,
      };
    }
    return {
      status: row.status,
      documentType: row.documentType,
      documentMasked: row.documentMasked,
      legalName: row.legalName,
      responsibleName: row.responsibleName,
      responsibleCpfMasked: row.responsibleCpfMasked,
      email: row.email,
      payoutKind: row.payoutKind,
      payoutMasked: row.payoutMasked,
      rejectionReason: row.rejectionReason,
      submittedAt: row.submittedAt.toISOString(),
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectedAt: row.rejectedAt?.toISOString() ?? null,
      payoutsPaused: row.status === 'PENDING' && row.approvedAt !== null,
      lastRejectedPayoutChange:
        row.rejectedPayoutMasked && row.payoutChangeRejectedAt
          ? {
              payoutMasked: row.rejectedPayoutMasked,
              reason: row.payoutChangeRejectionReason,
              rejectedAt: row.payoutChangeRejectedAt.toISOString(),
            }
          : null,
      paymentEnvironment: environment,
    };
  }
}
