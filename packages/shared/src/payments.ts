import { z } from 'zod';
import { localDateSchema, pageFields } from './booking';
import { normalizeCnpj, normalizeCpf } from './masks';
import { centsSchema } from './money';
import {
  bookingPaymentModeSchema,
  chargebackDisputeSchema,
  classPaymentModeSchema,
  feeBpsSchema,
  feePayerSchema,
  onlineChargeSchema,
  onlineChargeStatusSchema,
  onlinePayableTypeSchema,
  onlinePaymentMethodSchema,
  onlineRefundKindSchema,
  onlineRefundReasonCodeSchema,
  onlineRefundSchema,
  onlineRefundStatusSchema,
  paymentEnvironmentSchema,
  pixInstructionsSchema,
} from './online-payments';
import { phoneE164Schema } from './spaces';

// Pagamento online: cadastro no gateway, modos, carteira, cobranças e estornos no painel,
// "Meus pagamentos" do jogador e o Super (RF-ONPAY-01 a 12; docs/13-pagamentos-online.md).

const id = z.uuid();
const isoString = z.iso.datetime();
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const oneOrMany = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === undefined || Array.isArray(v) ? v : [v]), z.array(schema)).optional();

// ---------------------------------------------------------------------------------------------
// Documentos (CPF/CNPJ)

/** Documento como vai para a API: dígitos (CPF) ou caracteres do CNPJ alfanumérico, em maiúsculas. */
const documentChars = (value: string) => value.toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * Documento mascarado para o painel e o app (RN-ONPAY-10): `***.456.789-**`, `12.345.***\/****-**`.
 * O completo só aparece no relatório fiscal do Super.
 */
export function maskDocument(type: 'CPF' | 'CNPJ', value: string): string {
  const d = documentChars(value);
  return type === 'CPF'
    ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`
    : `${d.slice(0, 2)}.${d.slice(2, 5)}.***/****-**`;
}

/** Mantém só os últimos `visible` caracteres. */
export function maskTail(value: string, visible = 4): string {
  const tail = value.slice(-visible);
  return `${'*'.repeat(Math.max(value.length - visible, 0))}${tail}`;
}

// ---------------------------------------------------------------------------------------------
// Cadastro do espaço no gateway (RF-ONPAY-01, decisão 90)

export const MERCHANT_ACCOUNT_STATUSES = [
  'NOT_STARTED',
  'PENDING',
  'APPROVED',
  'REJECTED',
] as const;
export const merchantAccountStatusSchema = z.enum(MERCHANT_ACCOUNT_STATUSES);
export type MerchantAccountStatus = z.infer<typeof merchantAccountStatusSchema>;

export const DOCUMENT_TYPES = ['CPF', 'CNPJ'] as const;
export const documentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const PIX_KEY_TYPES = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM'] as const;
export const pixKeyTypeSchema = z.enum(PIX_KEY_TYPES);
export const BANK_ACCOUNT_TYPES = ['CHECKING', 'SAVINGS'] as const;
export const PAYOUT_DESTINATION_KINDS = ['BANK_ACCOUNT', 'PIX_KEY'] as const;
export const payoutDestinationKindSchema = z.enum(PAYOUT_DESTINATION_KINDS);
export type PayoutDestinationKind = z.infer<typeof payoutDestinationKindSchema>;

/** Documento de teste que o gateway simulado recusa: termina em `0000` (docs/13 §9). */
export const FAKE_REJECTED_DOCUMENT_SUFFIX = '0000';

export const payoutDestinationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('BANK_ACCOUNT'),
      /** Código do banco (COMPE, 3 dígitos). */
      bankCode: z.string().regex(/^[0-9]{3}$/),
      agency: z.string().regex(/^[0-9]{1,5}$/),
      account: z.string().regex(/^[0-9]{1,13}$/),
      accountDigit: z.string().regex(/^[0-9xX]{1,2}$/),
      accountType: z.enum(BANK_ACCOUNT_TYPES),
    })
    .strict(),
  z
    .object({
      kind: z.literal('PIX_KEY'),
      keyType: pixKeyTypeSchema,
      key: trimmed(140),
    })
    .strict(),
]);
export type PayoutDestination = z.infer<typeof payoutDestinationSchema>;

/**
 * PUT /v1/manage/spaces/:spaceId/online-payments/merchant-account: o Dono envia (ou reenvia, se
 * recusado) o cadastro. A API repassa ao gateway e guarda só documento e conta mascarados.
 */
export const submitMerchantAccountSchema = z
  .object({
    documentType: documentTypeSchema,
    /** CPF ou CNPJ (pontuação é ignorada; o CNPJ pode ter letras na base). */
    document: z.string().transform(documentChars),
    legalName: trimmed(160),
    responsibleName: trimmed(120),
    /**
     * CPF do responsável pela conta: obrigatório com CNPJ e não enviado com CPF (o titular é o
     * próprio responsável). Vai ao gateway e a API guarda só o mascarado (minimização, LGPD).
     */
    responsibleCpf: z.string().transform(documentChars).optional(),
    email: z.email().max(254),
    phone: phoneE164Schema,
    address: z
      .object({
        postalCode: z.string().regex(/^[0-9]{8}$/),
        street: trimmed(160),
        number: trimmed(20),
        complement: trimmed(80).optional(),
        neighborhood: trimmed(80),
        city: trimmed(80),
        state: z.string().regex(/^[A-Z]{2}$/),
      })
      .strict(),
    payout: payoutDestinationSchema,
    /** Aceite dos termos do gateway e da taxa de serviço. */
    acceptTerms: z.literal(true),
  })
  .strict()
  .refine((v) => (v.documentType === 'CPF' ? normalizeCpf : normalizeCnpj)(v.document) !== null, {
    message: 'Documento inválido.',
    path: ['document'],
  })
  .refine((v) => (v.documentType === 'CNPJ') === (v.responsibleCpf !== undefined), {
    message: 'Envie o CPF do responsável só (e sempre) com o CNPJ.',
    path: ['responsibleCpf'],
  })
  .refine((v) => v.responsibleCpf === undefined || normalizeCpf(v.responsibleCpf) !== null, {
    message: 'CPF do responsável inválido.',
    path: ['responsibleCpf'],
  });
export type SubmitMerchantAccountInput = z.infer<typeof submitMerchantAccountSchema>;

/**
 * PUT …/merchant-account/payout: troca da conta de recebimento (decisões 95 e 98). Só o Dono, fora
 * do modo suporte; reenvia o cadastro (`PENDING`), pausa os repasses até a aprovação e avisa os
 * Donos. Recusada, volta a valer a conta aprovada anterior.
 */
export const changePayoutDestinationSchema = z
  .object({ payout: payoutDestinationSchema, acceptTerms: z.literal(true) })
  .strict();
export type ChangePayoutDestinationInput = z.infer<typeof changePayoutDestinationSchema>;

export const merchantAccountSchema = z.object({
  status: merchantAccountStatusSchema,
  documentType: documentTypeSchema.nullable(),
  /** Sempre mascarado no painel (RN-ONPAY-10). */
  documentMasked: z.string().nullable(),
  legalName: z.string().nullable(),
  responsibleName: z.string().nullable(),
  /** CPF do responsável (só no cadastro com CNPJ), sempre mascarado. */
  responsibleCpfMasked: z.string().nullable(),
  email: z.string().nullable(),
  payoutKind: payoutDestinationKindSchema.nullable(),
  /**
   * Conta ou chave Pix mascarada: a aprovada ou, com uma troca em análise (`payoutsPaused`), a
   * nova conta enviada.
   */
  payoutMasked: z.string().nullable(),
  /** Motivo da recusa do cadastro (status `REJECTED`). A troca recusada fica em `lastRejectedPayoutChange`. */
  rejectionReason: z.string().nullable(),
  submittedAt: isoString.nullable(),
  /** Primeira aprovação ou a da última troca aprovada; com ela, o cadastro não é reenviado (decisão 98). */
  approvedAt: isoString.nullable(),
  rejectedAt: isoString.nullable(),
  /** Repasses parados enquanto a troca da conta é analisada (decisão 95). */
  payoutsPaused: z.boolean(),
  /**
   * Última troca de conta recusada (decisão 98): o cadastro continua `APPROVED` com a conta
   * anterior (`payoutMasked`), os repasses seguem e o Dono pode tentar outra troca. Some quando
   * ele pede a próxima troca.
   */
  lastRejectedPayoutChange: z
    .object({
      /** A conta recusada, mascarada. */
      payoutMasked: z.string(),
      reason: z.string().nullable(),
      rejectedAt: isoString,
    })
    .nullable(),
  /** Provedor e, com o fake, a dica do documento de recusa (decisão 92). */
  paymentEnvironment: paymentEnvironmentSchema,
});
export type MerchantAccount = z.infer<typeof merchantAccountSchema>;

// ---------------------------------------------------------------------------------------------
// Modos e taxa vigente (RF-ONPAY-02)

export const feeSettingsSchema = z.object({
  pixFeeBps: feeBpsSchema,
  cardFeeBps: feeBpsSchema,
  minFeeCents: centsSchema,
  feePayer: feePayerSchema,
});

export const spacePaymentSettingsSchema = z.object({
  /** Provedor (`none` = desligado) e, com o fake, as dicas de teste. */
  paymentEnvironment: paymentEnvironmentSchema,
  merchantAccountStatus: merchantAccountStatusSchema,
  /** Modos gravados pelo espaço. */
  bookingMode: bookingPaymentModeSchema,
  classMode: classPaymentModeSchema,
  /**
   * O espaço pode receber online agora: gateway ligado, espaço `ACTIVE` e cadastro já aprovado
   * alguma vez e que não esteja `REJECTED` (a troca de conta em análise, `PENDING`, só pausa os
   * repasses). É a mesma regra que a API usa para aceitar cobranças e liberar os modos online; com
   * ela falsa, os modos em vigor são `ON_SITE`.
   */
  onlineReady: z.boolean(),
  /** Modos em vigor: `ON_SITE` sem gateway, sem cadastro aprovado ou com o espaço fora de ACTIVE. */
  effectiveBookingMode: bookingPaymentModeSchema,
  effectiveClassMode: classPaymentModeSchema,
  /** Taxa vigente do espaço (somente leitura): a própria, se o Super definiu, ou a padrão. */
  fee: feeSettingsSchema.extend({ custom: z.boolean() }),
});
export type SpacePaymentSettings = z.infer<typeof spacePaymentSettingsSchema>;

export const updatePaymentModesSchema = z
  .object({ bookingMode: bookingPaymentModeSchema, classMode: classPaymentModeSchema })
  .strict();
export type UpdatePaymentModesInput = z.infer<typeof updatePaymentModesSchema>;

// ---------------------------------------------------------------------------------------------
// Cobranças e estornos no painel (RF-ONPAY-08, RF-ONPAY-09)

export const onlineChargesQuerySchema = z.object({
  status: oneOrMany(onlineChargeStatusSchema),
  payableType: onlinePayableTypeSchema.optional(),
  payableId: id.optional(),
  ...pageFields,
});
export type OnlineChargesQuery = z.infer<typeof onlineChargesQuerySchema>;

export const onlineChargePageSchema = z.object({
  items: z.array(onlineChargeSchema),
  nextCursor: z.string().nullable(),
});
export type OnlineChargePage = z.infer<typeof onlineChargePageSchema>;

/**
 * POST …/online-charges/:chargeId/refunds (RN-ONPAY-05, decisão 93). O valor é sempre explícito,
 * também no "tudo o que falta" (o `refundableCents` que a tela mostrou): se passar do reembolsável
 * atual, 422 `REFUND_EXCEEDS_BALANCE` com o reembolsável. `chargeAgain` falso (padrão): o valor
 * devolvido vira abatimento do item (saldo em aberto zero); verdadeiro: o valor volta a ficar em
 * aberto.
 */
export const refundOnlineChargeSchema = z
  .object({
    amountCents: centsSchema.positive(),
    reason: trimmed(500),
    chargeAgain: z.boolean().default(false),
  })
  .strict();
export type RefundOnlineChargeInput = z.infer<typeof refundOnlineChargeSchema>;

/** Chargeback na lista da carteira (RF-ONPAY-09). */
export const chargebackSchema = onlineRefundSchema.extend({
  /** Item contestado, para o resumo ("reserva de 08/11, 18:00"). */
  itemStartsAt: isoString.nullable(),
  itemPeriodStart: localDateSchema.nullable(),
  charge: onlineChargeSchema.omit({ refunds: true }),
  dispute: chargebackDisputeSchema,
});
export type Chargeback = z.infer<typeof chargebackSchema>;
export const chargebackListSchema = z.object({ items: z.array(chargebackSchema) });
export type ChargebackList = z.infer<typeof chargebackListSchema>;

/** POST …/chargebacks/:chargebackId/dispute: resposta ao chargeback (texto e links de anexos). */
export const disputeChargebackSchema = z
  .object({
    text: trimmed(4000),
    attachmentUrls: z
      .array(z.url({ protocol: /^https$/ }))
      .max(5)
      .default([]),
  })
  .strict();
export type DisputeChargebackInput = z.infer<typeof disputeChargebackSchema>;

// ---------------------------------------------------------------------------------------------
// Carteira do espaço (RF-ONPAY-07, decisão 89)

export const LEDGER_ENTRY_KINDS = [
  'SALE',
  'PLATFORM_FEE',
  'REFUND',
  'FEE_REFUND',
  'CHARGEBACK',
  'PAYOUT',
  'ADJUSTMENT',
] as const;
export const ledgerEntryKindSchema = z.enum(LEDGER_ENTRY_KINDS);
export type LedgerEntryKind = z.infer<typeof ledgerEntryKindSchema>;

export const PAYOUT_STATUSES = ['SCHEDULED', 'PAID', 'FAILED'] as const;
export const payoutStatusSchema = z.enum(PAYOUT_STATUSES);
export type PayoutStatus = z.infer<typeof payoutStatusSchema>;

export const walletSummarySchema = z.object({
  merchantAccountStatus: merchantAccountStatusSchema,
  /** Troca de conta em análise: o disponível fica no saldo (decisão 95). */
  payoutsPaused: z.boolean(),
  paymentEnvironment: paymentEnvironmentSchema,
  /** Contestações aguardando resposta e o prazo mais próximo. */
  openDisputes: z.object({ count: z.number().int(), nextRespondBy: isoString.nullable() }),
  /** Repasses que falharam e o mais recente. */
  failedPayouts: z.object({
    count: z.number().int(),
    lastAmountCents: centsSchema.nullable(),
    lastAt: isoString.nullable(),
  }),
  timeZone: z.string(),
  /** Liberado e ainda não repassado. */
  availableCents: z.number().int(),
  /** A liberar (vendas líquidas com data futura). */
  pendingCents: z.number().int(),
  /** Saldo total (disponível + a liberar). */
  balanceCents: z.number().int(),
  /** Total já repassado para a conta do espaço. */
  paidOutCents: centsSchema,
  /** O que libera em cada dia local, do mais próximo ao mais distante. */
  upcoming: z.array(z.object({ date: localDateSchema, amountCents: z.number().int() })),
});
export type WalletSummary = z.infer<typeof walletSummarySchema>;

const walletFilterFields = {
  /** Lançamentos criados a partir de (inclusive). */
  from: instant.optional(),
  /** Lançamentos criados antes de. */
  to: instant.optional(),
  kind: oneOrMany(ledgerEntryKindSchema),
  /**
   * Meio da cobrança do lançamento: entra tudo o que tem cobrança daquele meio, inclusive o ajuste
   * da contestação ganha; repasses e o ajuste do repasse que falhou (sem cobrança) ficam de fora.
   */
  method: onlinePaymentMethodSchema.optional(),
};
export const walletEntriesFiltersSchema = z.object(walletFilterFields);
export type WalletEntriesFilters = z.infer<typeof walletEntriesFiltersSchema>;
export const walletEntriesQuerySchema = z.object({ ...walletFilterFields, ...pageFields });
export type WalletEntriesQuery = z.infer<typeof walletEntriesQuerySchema>;

export const ledgerEntrySchema = z.object({
  id,
  kind: ledgerEntryKindSchema,
  /** Com sinal: crédito positivo, débito negativo. */
  amountCents: z.number().int(),
  /** Quando o valor fica (ou ficou) disponível. */
  availableAt: isoString,
  available: z.boolean(),
  chargeId: id.nullable(),
  refundId: id.nullable(),
  payoutId: id.nullable(),
  method: onlinePaymentMethodSchema.nullable(),
  payableType: onlinePayableTypeSchema.nullable(),
  payableId: id.nullable(),
  payerName: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: isoString,
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const ledgerEntryPageSchema = z.object({
  items: z.array(ledgerEntrySchema),
  nextCursor: z.string().nullable(),
  /** Lançamentos com os filtros aplicados, em todas as páginas ("Página 1 de N"). */
  total: z.number().int(),
});
export type LedgerEntryPage = z.infer<typeof ledgerEntryPageSchema>;

export const payoutSchema = z.object({
  id,
  amountCents: centsSchema,
  status: payoutStatusSchema,
  scheduledFor: isoString,
  paidAt: isoString.nullable(),
  failureReason: z.string().nullable(),
  createdAt: isoString,
});
export type Payout = z.infer<typeof payoutSchema>;

export const payoutPageSchema = z.object({
  items: z.array(payoutSchema),
  nextCursor: z.string().nullable(),
});
export type PayoutPage = z.infer<typeof payoutPageSchema>;

export const cursorPageQuerySchema = z.object(pageFields);
export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Meus pagamentos (RF-ONPAY-06): histórico das cobranças online, sem saldo (decisão 89)

export const myPaymentItemSchema = z.object({
  type: onlinePayableTypeSchema,
  id,
  /** Ex.: "Quadra A · Futevôlei" ou "Plano 2x por semana". */
  title: z.string(),
  /** Reserva: início. */
  startsAt: isoString.nullable(),
  /** Mensalidade: primeiro dia do mês cobrado. */
  periodStart: localDateSchema.nullable(),
  /** Assinatura da mensalidade (para abrir no app). */
  subscriptionId: id.nullable(),
});

/**
 * Estorno na visão do jogador: o manual e os automáticos, com o motivo (`reasonCode`: depois do
 * prazo, depois da troca da forma de pagamento, conta excluída, cancelamento etc.).
 */
export const myPaymentRefundSchema = z.object({
  id,
  kind: onlineRefundKindSchema,
  status: onlineRefundStatusSchema,
  amountCents: centsSchema,
  /** Motivo escrito pelo espaço (manual) ou o texto do estorno automático. */
  reason: z.string().nullable(),
  reasonCode: onlineRefundReasonCodeSchema,
  createdAt: isoString,
});
export type MyPaymentRefund = z.infer<typeof myPaymentRefundSchema>;

export const myPaymentSchema = z.object({
  id,
  status: onlineChargeStatusSchema,
  method: onlinePaymentMethodSchema,
  amountCents: centsSchema,
  refundedCents: centsSchema,
  space: z.object({ id, name: z.string(), slug: z.string() }),
  item: myPaymentItemSchema,
  cardBrand: z.string().nullable(),
  cardLast4: z.string().nullable(),
  paidAt: isoString.nullable(),
  createdAt: isoString,
  /** Estornos da cobrança (inclusive os automáticos), do mais antigo ao mais recente. */
  refunds: z.array(myPaymentRefundSchema),
});
export type MyPayment = z.infer<typeof myPaymentSchema>;

/** GET /v1/me/payments: filtro por status (chips Pagos, Estornos, Aguardando). */
export const myPaymentsQuerySchema = z.object({
  status: oneOrMany(onlineChargeStatusSchema),
  ...pageFields,
});
export type MyPaymentsQuery = z.infer<typeof myPaymentsQuerySchema>;

export const myPaymentPageSchema = z.object({
  items: z.array(myPaymentSchema),
  nextCursor: z.string().nullable(),
});
export type MyPaymentPage = z.infer<typeof myPaymentPageSchema>;

/** Detalhe e comprovante: id da transação, pagador, estornos e, se pendente, o Pix. */
export const myPaymentDetailSchema = myPaymentSchema.extend({
  /** Identificador da transação no gateway (comprovante). */
  transactionId: z.string().nullable(),
  /** Nome do pagador, para o comprovante ("Pago por"). */
  payerName: z.string(),
  pix: pixInstructionsSchema.nullable(),
  expiresAt: isoString.nullable(),
  failureCode: z.string().nullable(),
  failureReason: z.string().nullable(),
  paymentEnvironment: paymentEnvironmentSchema,
  serverTime: isoString,
});
export type MyPaymentDetail = z.infer<typeof myPaymentDetailSchema>;

// ---------------------------------------------------------------------------------------------
// Super: taxas, cadastros, receita e simulador (RF-ONPAY-10 a 12)

/** PUT /v1/super/online-payments/fees: taxa padrão (decisão 83). `PLAYER` é recusado (decisão 82). */
export const updateDefaultFeesSchema = feeSettingsSchema.strict();
export type UpdateDefaultFeesInput = z.infer<typeof updateDefaultFeesSchema>;

/** PUT …/fees/spaces/:spaceId: taxa própria do espaço; `null` volta ao padrão no campo. */
export const updateSpaceFeesSchema = z
  .object({
    pixFeeBps: feeBpsSchema.nullable(),
    cardFeeBps: feeBpsSchema.nullable(),
    minFeeCents: centsSchema.nullable(),
    feePayer: feePayerSchema.nullable(),
  })
  .strict();
export type UpdateSpaceFeesInput = z.infer<typeof updateSpaceFeesSchema>;

export const spaceFeeOverrideSchema = z.object({
  spaceId: id,
  spaceName: z.string(),
  pixFeeBps: feeBpsSchema.nullable(),
  cardFeeBps: feeBpsSchema.nullable(),
  minFeeCents: centsSchema.nullable(),
  feePayer: feePayerSchema.nullable(),
  /** A taxa em vigor no espaço, campo a campo. */
  effective: feeSettingsSchema,
  updatedAt: isoString,
});
export type SpaceFeeOverride = z.infer<typeof spaceFeeOverrideSchema>;

export const platformFeesSchema = z.object({
  defaults: feeSettingsSchema.extend({
    updatedAt: isoString,
    /** Quem mudou por último (nulo = o padrão da migração). */
    updatedByName: z.string().nullable(),
  }),
  paymentEnvironment: paymentEnvironmentSchema,
  /** Espaços com taxa própria. */
  spaces: z.array(spaceFeeOverrideSchema),
});
export type PlatformFees = z.infer<typeof platformFeesSchema>;

export const superMerchantAccountsQuerySchema = z.object({
  status: merchantAccountStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type SuperMerchantAccountsQuery = z.infer<typeof superMerchantAccountsQuerySchema>;

export const superMerchantAccountSchema = merchantAccountSchema.extend({
  spaceId: id,
  spaceName: z.string(),
  spaceSlug: z.string(),
});
export type SuperMerchantAccount = z.infer<typeof superMerchantAccountSchema>;

export const superMerchantAccountListSchema = z.object({
  items: z.array(superMerchantAccountSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type SuperMerchantAccountList = z.infer<typeof superMerchantAccountListSchema>;

const isoDate = z.iso.date();
const month = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, 'Use AAAA-MM.');

/** Receita da plataforma (RF-ONPAY-11). Período por data local (America/Sao_Paulo), inclusive. */
export const platformRevenueQuerySchema = z
  .object({
    /** Padrão: dia 1 do mês atual. */
    from: isoDate.optional(),
    /** Padrão: hoje. */
    to: isoDate.optional(),
    spaceId: id.optional(),
    method: onlinePaymentMethodSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '`from` deve ser anterior ou igual a `to`.',
    path: ['to'],
  });
export type PlatformRevenueQuery = z.infer<typeof platformRevenueQuerySchema>;

/**
 * Valores da receita, pela data de cada lançamento do livro-razão (o mês fechado não muda):
 * `volumeCents` = vendas pagas; `grossFeeCents` = taxa cobrada; `gatewayCostCents` = tarifa do
 * gateway (pela data do pagamento); `feeRefundedCents` = taxa devolvida em estornos e chargebacks;
 * `feeRechargedCents` = taxa cobrada de novo na contestação ganha (decisão 94);
 * `netRevenueCents` = taxa − tarifa − taxa devolvida + taxa recobrada.
 */
export const revenueFiguresSchema = z.object({
  chargesCount: z.number().int(),
  volumeCents: centsSchema,
  grossFeeCents: centsSchema,
  gatewayCostCents: centsSchema,
  feeRefundedCents: centsSchema,
  feeRechargedCents: centsSchema,
  netRevenueCents: z.number().int(),
});
export type RevenueFigures = z.infer<typeof revenueFiguresSchema>;

export const platformRevenueSchema = z.object({
  period: z.object({ from: isoDate, to: isoDate }),
  totals: revenueFiguresSchema,
  bySpace: z.array(revenueFiguresSchema.extend({ spaceId: id, spaceName: z.string() })),
  byMethod: z.array(revenueFiguresSchema.extend({ method: onlinePaymentMethodSchema })),
  byMonth: z.array(revenueFiguresSchema.extend({ month })),
});
export type PlatformRevenue = z.infer<typeof platformRevenueSchema>;

/**
 * Relatório mensal de taxas por espaço, base da NFS-e (decisão 91). Único lugar com o documento
 * completo do cadastro no gateway; cada leitura e exportação fica na auditoria
 * (`super.payment_report.*`).
 */
export const monthlyFeeReportQuerySchema = z.object({ month });
export type MonthlyFeeReportQuery = z.infer<typeof monthlyFeeReportQuerySchema>;

export const monthlyFeeReportSchema = z.object({
  month,
  items: z.array(
    revenueFiguresSchema.extend({
      spaceId: id,
      spaceName: z.string(),
      documentType: documentTypeSchema.nullable(),
      /** Documento completo do cadastro no gateway (só aqui; painel e app recebem mascarado). */
      document: z.string().nullable(),
      legalName: z.string().nullable(),
      /** Base da nota: taxa bruta − taxa devolvida + taxa recobrada, dos lançamentos do mês. */
      invoiceBaseCents: z.number().int(),
    }),
  ),
  totals: revenueFiguresSchema,
});
export type MonthlyFeeReport = z.infer<typeof monthlyFeeReportSchema>;

// Simulador (RF-ONPAY-12): só com o gateway fake.

export const simulatorChargesQuerySchema = z.object({
  status: onlineChargeStatusSchema.optional(),
  spaceId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SimulatorChargesQuery = z.infer<typeof simulatorChargesQuerySchema>;

export const simulatorChargeSchema = onlineChargeSchema.omit({ refunds: true }).extend({
  spaceName: z.string(),
});
export const simulatorChargeListSchema = z.object({ items: z.array(simulatorChargeSchema) });
export type SimulatorChargeList = z.infer<typeof simulatorChargeListSchema>;

export const simulatorRejectSchema = z.object({ reason: trimmed(300) }).strict();
export type SimulatorRejectInput = z.infer<typeof simulatorRejectSchema>;

export const simulatorSettleSchema = z.object({ spaceId: id.optional() }).strict();
export type SimulatorSettleInput = z.infer<typeof simulatorSettleSchema>;

/** Resultado da contestação no simulador (o gateway real informa sozinho). */
export const simulatorDisputeResultSchema = z.object({ outcome: z.enum(['WON', 'LOST']) }).strict();
export type SimulatorDisputeResultInput = z.infer<typeof simulatorDisputeResultSchema>;

export const simulatorResultSchema = z.object({
  /** Webhooks enfileirados pelo gateway simulado. */
  events: z.number().int(),
});
export type SimulatorResult = z.infer<typeof simulatorResultSchema>;
