import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './columns.js';
import {
  bookingPaymentMode,
  chargebackDisputeStatus,
  classPaymentMode,
  documentType,
  feePayer,
  ledgerEntryKind,
  merchantAccountStatus,
  onlineChargeStatus,
  onlinePaymentMethod,
  onlineRefundKind,
  onlineRefundReasonCode,
  onlineRefundStatus,
  payableType,
  payoutDestinationKind,
  payoutStatus,
} from './enums.js';
import { users } from './identity.js';
import { spaces } from './spaces.js';

// Pagamento online (decisões 80 a 92; RF-ONPAY, RN-ONPAY; docs/13-pagamentos-online.md). Valores em
// centavos, percentuais em pontos-base. O dinheiro passa pelo gateway com split: as tabelas
// espelham o que o gateway informa, e a plataforma não guarda saldo (decisão 81).

/** Taxa padrão da plataforma (linha única, `id = 1`; RF-ONPAY-10, decisão 83). */
export const platformFeeSettings = pgTable(
  'platform_fee_settings',
  {
    id: integer().primaryKey().default(1),
    pixFeeBps: integer().notNull(),
    cardFeeBps: integer().notNull(),
    minFeeCents: integer().notNull(),
    feePayer: feePayer().notNull().default('SPACE'),
    updatedBy: uuid().references(() => users.id),
    ...timestamps,
  },
  (t) => [
    check('platform_fee_settings_single_row', sql`${t.id} = 1`),
    check(
      'platform_fee_settings_values',
      sql`${t.pixFeeBps} BETWEEN 0 AND 10000 AND ${t.cardFeeBps} BETWEEN 0 AND 10000 AND ${t.minFeeCents} >= 0`,
    ),
  ],
);

/**
 * Modos de pagamento do espaço (RF-ONPAY-02) e a taxa própria definida pelo Super (RF-ONPAY-10;
 * nulo = padrão, campo a campo). Sem linha: `ON_SITE` e a taxa padrão.
 */
export const spacePaymentSettings = pgTable(
  'space_payment_settings',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .unique('space_payment_settings_space_id_unique')
      .references(() => spaces.id, { onDelete: 'cascade' }),
    bookingMode: bookingPaymentMode().notNull().default('ON_SITE'),
    classMode: classPaymentMode().notNull().default('ON_SITE'),
    pixFeeBps: integer(),
    cardFeeBps: integer(),
    minFeeCents: integer(),
    feePayer: feePayer(),
    updatedBy: uuid().references(() => users.id),
    ...timestamps,
  },
  (t) => [
    check(
      'space_payment_settings_fee_values',
      sql`(${t.pixFeeBps} IS NULL OR ${t.pixFeeBps} BETWEEN 0 AND 10000) AND (${t.cardFeeBps} IS NULL OR ${t.cardFeeBps} BETWEEN 0 AND 10000) AND (${t.minFeeCents} IS NULL OR ${t.minFeeCents} >= 0)`,
    ),
  ],
);

/**
 * Cadastro do espaço no gateway (subconta; RF-ONPAY-01, decisões 90 e 97). A conta bancária fica
 * só mascarada (RN-ONPAY-10). O documento completo fica **cifrado** (AES-256-GCM na aplicação,
 * chave em PAYMENTS_DATA_KEY) e só é decifrado no relatório fiscal do Super (NFS-e, decisão 91);
 * painel e app recebem `document_masked`.
 */
export const merchantAccounts = pgTable(
  'merchant_accounts',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .unique('merchant_accounts_space_id_unique')
      .references(() => spaces.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    providerAccountId: text(),
    status: merchantAccountStatus().notNull().default('NOT_STARTED'),
    documentType: documentType().notNull(),
    /** Completo e cifrado (`v1.<iv>.<tag>.<cifrado>`, contexto = space_id), decisão 97. */
    documentEncrypted: text().notNull(),
    documentMasked: text().notNull(),
    legalName: text().notNull(),
    responsibleName: text().notNull(),
    /** CPF do responsável (só com CNPJ): vai ao gateway e fica só mascarado (minimização, LGPD). */
    responsibleCpfMasked: text(),
    email: text().notNull(),
    /** A conta aprovada ou, com uma troca em análise, a nova conta enviada. */
    payoutKind: payoutDestinationKind().notNull(),
    payoutMasked: text().notNull(),
    /**
     * Id da troca de conta mais recente (a chave de idempotência mandada ao gateway): a decisão só
     * vale para a troca que a API pediu (decisão 98). Nulo no cadastro e nas trocas antigas.
     */
    payoutChangeId: uuid(),
    /** Conta aprovada guardada durante a troca: volta a valer se a troca for recusada (decisão 98). */
    previousPayoutKind: payoutDestinationKind(),
    previousPayoutMasked: text(),
    /** Última troca de conta recusada (decisão 98): a conta pedida, o motivo e quando. */
    rejectedPayoutMasked: text(),
    payoutChangeRejectionReason: text(),
    payoutChangeRejectedAt: tstz(),
    rejectionReason: text(),
    termsAcceptedAt: tstz().notNull(),
    submittedBy: uuid()
      .notNull()
      .references(() => users.id),
    submittedAt: tstz().notNull(),
    approvedAt: tstz(),
    rejectedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('merchant_accounts_provider_account_unique').on(t.provider, t.providerAccountId),
    index('merchant_accounts_status_idx').on(t.status),
    index('merchant_accounts_submitted_by_idx').on(t.submittedBy),
  ],
);

/**
 * Cobrança online de um item (reserva inteira ou mensalidade de aula; decisão 88). Guarda o
 * snapshot da taxa e o split (RN-ONPAY-01). Uma cobrança `PENDING` por item (RN-ONPAY-03).
 */
export const onlineCharges = pgTable(
  'online_charges',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    payableType: payableType().notNull(),
    payableId: uuid().notNull(),
    payerUserId: uuid()
      .notNull()
      .references(() => users.id),
    provider: text().notNull(),
    /** Nulo só enquanto o gateway não respondeu à criação. */
    providerChargeId: text(),
    method: onlinePaymentMethod().notNull(),
    status: onlineChargeStatus().notNull().default('PENDING'),
    /** Pago pelo jogador. */
    amountCents: integer().notNull(),
    /** Preço do serviço (saldo em aberto do item na criação). */
    serviceAmountCents: integer().notNull(),
    platformFeeCents: integer().notNull(),
    /** Tarifa do gateway: custo da plataforma, fora da conta do espaço (decisão 82). */
    gatewayCostCents: integer().notNull().default(0),
    spaceNetCents: integer().notNull(),
    feePayer: feePayer().notNull(),
    feeBps: integer().notNull(),
    minFeeCents: integer().notNull(),
    /** Estornado ao jogador, inclusive chargebacks. */
    refundedCents: integer().notNull().default(0),
    /** Taxa devolvida ao espaço nos estornos (decisão 86). */
    feeRefundedCents: integer().notNull().default(0),
    pixCopyPaste: text(),
    pixQrSvg: text(),
    cardBrand: text(),
    cardLast4: text(),
    expiresAt: tstz(),
    paidAt: tstz(),
    failureReason: text(),
    /**
     * Por que a cobrança aberta foi fechada sem pagamento: `REPLACED` (outra forma de pagamento),
     * `PAID_ON_SITE`, `BOOKING_CANCELLED`, `BOOKING_CHANGED`, `SPACE_INACTIVE`, `ACCOUNT_DELETED`,
     * `EXPIRED`. Distingue o estorno de um
     * pagamento que chegue depois (decisão 96).
     */
    closedReason: text(),
    /** Chave de idempotência das chamadas ao gateway. */
    idempotencyKey: text().notNull().unique('online_charges_idempotency_key_unique'),
    /** `Idempotency-Key` do app (decisão 96): a nova tentativa devolve esta cobrança. */
    requestKey: text(),
    /** Hash do pedido que usou a chave (item e meio): outro pedido com a mesma chave é recusado. */
    requestHash: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('online_charges_provider_charge_unique')
      .on(t.provider, t.providerChargeId)
      .where(sql`${t.providerChargeId} IS NOT NULL`),
    // RN-ONPAY-03: uma cobrança aberta por item.
    uniqueIndex('online_charges_one_pending_per_item')
      .on(t.payableType, t.payableId)
      .where(sql`${t.status} = 'PENDING'`),
    index('online_charges_payable_idx').on(t.payableType, t.payableId),
    uniqueIndex('online_charges_payer_request_key_unique')
      .on(t.payerUserId, t.requestKey)
      .where(sql`${t.requestKey} IS NOT NULL`),
    index('online_charges_space_id_created_at_idx').on(t.spaceId, t.createdAt),
    index('online_charges_payer_user_id_id_idx').on(t.payerUserId, t.id),
    index('online_charges_pending_expires_at_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'PENDING'`),
    check(
      'online_charges_payable_type',
      sql`${t.payableType} IN ('BOOKING', 'SUBSCRIPTION_CHARGE')`,
    ),
    check(
      'online_charges_amounts_valid',
      sql`${t.amountCents} > 0 AND ${t.serviceAmountCents} > 0 AND ${t.platformFeeCents} >= 0 AND ${t.platformFeeCents} <= ${t.amountCents} AND ${t.gatewayCostCents} >= 0 AND ${t.spaceNetCents} >= 0 AND ${t.feeBps} BETWEEN 0 AND 10000 AND ${t.minFeeCents} >= 0`,
    ),
    check(
      'online_charges_split_consistent',
      sql`CASE ${t.feePayer} WHEN 'SPACE' THEN ${t.amountCents} = ${t.serviceAmountCents} AND ${t.spaceNetCents} = ${t.amountCents} - ${t.platformFeeCents} ELSE ${t.amountCents} = ${t.serviceAmountCents} + ${t.platformFeeCents} AND ${t.spaceNetCents} = ${t.serviceAmountCents} END`,
    ),
    check(
      'online_charges_refunds_valid',
      sql`${t.refundedCents} BETWEEN 0 AND ${t.amountCents} AND ${t.feeRefundedCents} BETWEEN 0 AND ${t.platformFeeCents}`,
    ),
  ],
);

/**
 * Estornos e chargebacks de uma cobrança (decisões 86 e 87). O chargeback carrega a contestação
 * do espaço (RF-ONPAY-09).
 */
export const onlineRefunds = pgTable(
  'online_refunds',
  {
    id: id(),
    chargeId: uuid()
      .notNull()
      .references(() => onlineCharges.id),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    kind: onlineRefundKind().notNull(),
    status: onlineRefundStatus().notNull().default('PENDING'),
    amountCents: integer().notNull(),
    feeRefundCents: integer().notNull(),
    reason: text(),
    reasonCode: onlineRefundReasonCode().notNull(),
    /** Nulo quando automático (cancelamento, chargeback, pagamento tardio). */
    requestedBy: uuid().references(() => users.id),
    /** Estorno manual: o valor volta a ser cobrado (decisão 93); falso = abatimento. */
    chargeAgain: boolean().notNull().default(false),
    /** Parte do estorno manual que virou abatimento do item (decisão 93). */
    itemDiscountCents: integer().notNull().default(0),
    providerRefundId: text(),
    /** O estorno já entrou no livro-razão e no registro de pagamento. */
    appliedAt: tstz(),
    /** Contestação (só chargeback): status, prazo, resposta do espaço e resultado. */
    disputeStatus: chargebackDisputeStatus(),
    disputeRespondBy: tstz(),
    disputeResponseText: text(),
    disputeAttachmentUrls: text().array().notNull().default(sql`'{}'`),
    disputeRespondedAt: tstz(),
    disputeRespondedBy: uuid().references(() => users.id),
    disputeResolvedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('online_refunds_charge_provider_refund_unique').on(t.chargeId, t.providerRefundId),
    index('online_refunds_charge_id_idx').on(t.chargeId),
    index('online_refunds_space_id_kind_idx').on(t.spaceId, t.kind),
    index('online_refunds_requested_by_idx').on(t.requestedBy),
    index('online_refunds_dispute_responded_by_idx').on(t.disputeRespondedBy),
    check(
      'online_refunds_amounts_valid',
      sql`${t.amountCents} > 0 AND ${t.feeRefundCents} >= 0 AND ${t.feeRefundCents} <= ${t.amountCents} AND ${t.itemDiscountCents} BETWEEN 0 AND ${t.amountCents}`,
    ),
    check(
      'online_refunds_dispute_only_chargeback',
      sql`(${t.kind} = 'CHARGEBACK') = (${t.disputeStatus} IS NOT NULL)`,
    ),
  ],
);

/**
 * Webhooks recebidos do gateway (RN-ONPAY-07): gravados uma vez por provedor + id do evento e
 * processados na fila.
 */
export const gatewayEvents = pgTable(
  'gateway_events',
  {
    id: id(),
    provider: text().notNull(),
    eventId: text().notNull(),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: tstz(),
    attempts: integer().notNull().default(0),
    error: text(),
    ...timestamps,
  },
  (t) => [
    unique('gateway_events_provider_event_unique').on(t.provider, t.eventId),
    index('gateway_events_unprocessed_idx').on(t.receivedAt).where(sql`${t.processedAt} IS NULL`),
  ],
);

/** Repasses da subconta para a conta do espaço (diários no fake; decisão 89). */
export const payouts = pgTable(
  'payouts',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    provider: text().notNull(),
    providerPayoutId: text().notNull(),
    amountCents: integer().notNull(),
    status: payoutStatus().notNull(),
    scheduledFor: tstz().notNull(),
    paidAt: tstz(),
    failureReason: text(),
    ...timestamps,
  },
  (t) => [
    unique('payouts_provider_payout_unique').on(t.provider, t.providerPayoutId),
    index('payouts_space_id_created_at_idx').on(t.spaceId, t.createdAt),
    check('payouts_amount_positive', sql`${t.amountCents} > 0`),
  ],
);

/**
 * Livro-razão da carteira do espaço (RF-ONPAY-07): espelho do saldo da subconta. Saldo = soma;
 * disponível = soma com `available_at <= agora`. Cada fato entra uma vez (índices únicos por
 * origem e tipo), então reprocessar um evento não duplica nada.
 */
export const spaceLedgerEntries = pgTable(
  'space_ledger_entries',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    chargeId: uuid().references(() => onlineCharges.id),
    refundId: uuid().references(() => onlineRefunds.id),
    payoutId: uuid().references(() => payouts.id),
    kind: ledgerEntryKind().notNull(),
    /** Com sinal: crédito positivo, débito negativo. */
    amountCents: integer().notNull(),
    availableAt: tstz().notNull(),
    description: text(),
    ...timestamps,
  },
  (t) => [
    index('space_ledger_entries_space_id_id_idx').on(t.spaceId, t.id),
    index('space_ledger_entries_space_id_available_at_idx').on(t.spaceId, t.availableAt),
    index('space_ledger_entries_charge_id_idx').on(t.chargeId),
    index('space_ledger_entries_refund_id_idx').on(t.refundId),
    index('space_ledger_entries_payout_id_idx').on(t.payoutId),
    uniqueIndex('space_ledger_entries_charge_kind_unique')
      .on(t.chargeId, t.kind)
      .where(sql`${t.refundId} IS NULL AND ${t.payoutId} IS NULL AND ${t.chargeId} IS NOT NULL`),
    uniqueIndex('space_ledger_entries_refund_kind_unique')
      .on(t.refundId, t.kind)
      .where(sql`${t.refundId} IS NOT NULL`),
    uniqueIndex('space_ledger_entries_payout_kind_unique')
      .on(t.payoutId, t.kind)
      .where(sql`${t.payoutId} IS NOT NULL`),
    check(
      'space_ledger_entries_sign',
      sql`CASE ${t.kind} WHEN 'SALE' THEN ${t.amountCents} > 0 WHEN 'FEE_REFUND' THEN ${t.amountCents} > 0 WHEN 'ADJUSTMENT' THEN ${t.amountCents} <> 0 ELSE ${t.amountCents} < 0 END`,
    ),
  ],
);

/**
 * Estado do gateway simulado (`PAYMENTS_PROVIDER=fake`; decisão 92). Namespace do adaptador fake:
 * nenhum código fora de `src/payments/gateways/fake/` lê ou escreve aqui. Cada objeto (subconta,
 * cobrança, repasse) é uma linha com os dados em jsonb.
 */
export const fakeGatewayObjects = pgTable(
  'fake_gateway_objects',
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    accountId: text(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (t) => [index('fake_gateway_objects_kind_account_idx').on(t.kind, t.accountId)],
);
