import type { PaymentsSandbox } from '@space-sports/shared';

// Contrato do gateway de pagamento (decisão 80; docs/13 §10). O domínio só conhece estes tipos: cada
// provedor (hoje só o `fake`) é um adaptador em `src/payments/gateways/<provedor>/`. Todo valor em
// centavos; toda chamada que cria algo leva uma chave de idempotência.

/** Situação da subconta no gateway. */
export type GatewayAccountStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** Situação da cobrança no gateway. */
export type GatewayChargeStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export interface GatewayAccountInput {
  /** Chave de idempotência (um cadastro por envio). */
  idempotencyKey: string;
  documentType: 'CPF' | 'CNPJ';
  /**
   * CPF (dígitos) ou CNPJ (com as letras da base). A API guarda só cifrado (decisão 97), para o
   * relatório fiscal do Super, e o mascarado para o painel e o app.
   */
  document: string;
  legalName: string;
  responsibleName: string;
  /** CPF do responsável, só no cadastro com CNPJ (a API guarda cifrado, como o documento). */
  responsibleCpf: string | null;
  email: string;
  phone: string;
  address: {
    postalCode: string;
    street: string;
    number: string;
    complement?: string | undefined;
    neighborhood: string;
    city: string;
    state: string;
  };
  payout:
    | {
        kind: 'BANK_ACCOUNT';
        bankCode: string;
        agency: string;
        account: string;
        accountDigit: string;
        accountType: 'CHECKING' | 'SAVINGS';
      }
    | { kind: 'PIX_KEY'; keyType: string; key: string };
}

export interface GatewayAccount {
  providerAccountId: string;
  /**
   * Situação da subconta. Durante a troca da conta de recebimento ela fica `PENDING` (repasses
   * parados); decidida a troca, volta a `APPROVED`, aprovada ou recusada (decisão 98).
   */
  status: GatewayAccountStatus;
  /** Motivo da recusa da subconta (o cadastro); a da troca fica em `payoutChange`. */
  rejectionReason: string | null;
  /** A troca da conta de recebimento mais recente, ou nulo se nunca houve. */
  payoutChange: GatewayPayoutChange | null;
}

/**
 * Troca da conta de recebimento (decisões 95 e 98). Recusada, a subconta continua aprovada com a
 * conta anterior.
 */
export interface GatewayPayoutChange {
  /**
   * A chave de idempotência do pedido da troca (o id da troca na API): a API só aplica a decisão
   * da troca que ela pediu. Nulo numa troca antiga, anterior a esse controle.
   */
  idempotencyKey: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
}

/** Split da cobrança: a taxa da plataforma fica com o Space Sports, o resto vai para a subconta. */
export interface GatewaySplit {
  providerAccountId: string;
  platformFeeCents: number;
}

export interface GatewayChargeInput {
  idempotencyKey: string;
  amountCents: number;
  split: GatewaySplit;
  description: string;
  payer: { name: string; email: string | null };
}

export interface GatewayPixInput extends GatewayChargeInput {
  expiresAt: Date;
}

export interface GatewayCardInput extends GatewayChargeInput {
  /** Token gerado no aparelho (RN-ONPAY-10): nenhum dado do cartão passa pela API. */
  cardToken: string;
}

/** Estorno ou chargeback já registrado no gateway para a cobrança. */
export interface GatewayRefund {
  providerRefundId: string;
  kind: 'REFUND' | 'CHARGEBACK';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  amountCents: number;
  /** Parte da taxa da plataforma devolvida à subconta. */
  platformFeeRefundCents: number;
  reason: string | null;
  createdAt: Date;
  /** Prazo da contestação (chargeback). */
  disputeDueAt: Date | null;
  /** Resultado da contestação (chargeback), quando o gateway decidir. */
  disputeOutcome: 'WON' | 'LOST' | null;
  disputeResolvedAt: Date | null;
}

/** Retrato da cobrança no gateway: a fonte da verdade da sincronização (RN-ONPAY-07). */
export interface GatewayCharge {
  providerChargeId: string;
  /** A chave de idempotência da criação (casa um webhook com a cobrança local). */
  idempotencyKey: string | null;
  status: GatewayChargeStatus;
  amountCents: number;
  /** A parte da plataforma no split (taxa), gravada na criação. */
  platformFeeCents: number;
  paidAt: Date | null;
  /** Quando a venda fica disponível na subconta (liberação Pix D+1, cartão D+30 no fake). */
  availableAt: Date | null;
  /** Tarifa do gateway (custo da plataforma). */
  gatewayCostCents: number;
  failureReason: string | null;
  pix: { copyPaste: string; qrSvg: string; expiresAt: Date } | null;
  card: { brand: string | null; last4: string | null } | null;
  refunds: GatewayRefund[];
}

export interface GatewayPayout {
  providerPayoutId: string;
  providerAccountId: string;
  amountCents: number;
  status: 'SCHEDULED' | 'PAID' | 'FAILED';
  scheduledFor: Date;
  paidAt: Date | null;
  failureReason: string | null;
}

/**
 * Evento interno traduzido do webhook. É só um gatilho: o processamento consulta o objeto no
 * gateway e sincroniza o estado (status só avança), o que torna duplicados e eventos fora de ordem
 * inofensivos.
 */
export interface GatewayEvent {
  /** Id do evento no provedor (único por provedor). */
  eventId: string;
  type: 'charge.updated' | 'account.updated' | 'payout.updated';
  /** Id do objeto no provedor (cobrança, subconta ou repasse). */
  objectId: string;
  occurredAt: Date;
  /** Corpo original (gravado em `gateway_events`). */
  payload: Record<string, unknown>;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
}

export interface PaymentGateway {
  /** Nome do provedor, igual a `PAYMENTS_PROVIDER` e ao `:provider` do webhook. */
  readonly provider: string;
  /** Gateway de teste: o app mostra o selo "Ambiente de teste" (decisão 92). */
  readonly testMode: boolean;
  /** Dicas do ambiente de teste (cartões, documento de recusa); nulo num gateway real. */
  readonly sandbox: PaymentsSandbox | null;

  createAccount(input: GatewayAccountInput): Promise<GatewayAccount>;
  getAccount(providerAccountId: string): Promise<GatewayAccount>;
  /**
   * Troca a conta de recebimento (decisão 95): a subconta volta à análise e os repasses param
   * até a decisão. Recusada a troca, vale de novo a conta anterior (decisão 98). Idempotente pela
   * chave: repetir o pedido não abre outra troca.
   */
  updateAccountPayout(input: {
    providerAccountId: string;
    idempotencyKey: string;
    payout: GatewayAccountInput['payout'];
  }): Promise<GatewayAccount>;

  createPixCharge(input: GatewayPixInput): Promise<GatewayCharge>;
  /** Cobra o cartão na hora: a resposta já vem `PAID` ou `FAILED`. */
  createCardCharge(input: GatewayCardInput): Promise<GatewayCharge>;
  getCharge(providerChargeId: string): Promise<GatewayCharge>;
  /**
   * A cobrança criada com esta chave de idempotência, ou nulo se o gateway não a conhece. Resolve a
   * criação de resultado desconhecido (timeout): se ela existe, vale o que o gateway tem.
   */
  findChargeByIdempotencyKey(idempotencyKey: string): Promise<GatewayCharge | null>;
  /** Cancela a cobrança pendente; sem efeito se ela já saiu de `PENDING`. */
  cancelCharge(providerChargeId: string): Promise<GatewayCharge>;
  /** Estorno total ou parcial, com a devolução da taxa no split. */
  refundCharge(input: {
    providerChargeId: string;
    idempotencyKey: string;
    amountCents: number;
    platformFeeRefundCents: number;
    reason: string | null;
  }): Promise<GatewayRefund>;
  /** Envia a contestação do chargeback. */
  submitDispute(input: {
    providerChargeId: string;
    providerRefundId: string;
    text: string;
    attachmentUrls: string[];
  }): Promise<void>;

  getPayout(providerPayoutId: string): Promise<GatewayPayout>;

  /**
   * Confere a assinatura e traduz o webhook; lança `InvalidWebhookSignature` se não conferir e
   * `InvalidWebhookPayload` se o corpo assinado não puder ser lido (não é JSON, vazio).
   */
  parseWebhook(request: WebhookRequest): GatewayEvent[];

  /** Jobs do adaptador na fila de pagamentos; `deliver` entrega os webhooks que ele emitir. */
  jobs?(deliver: (delivery: WebhookDelivery) => Promise<void>): GatewayJobs;
}

export class InvalidWebhookSignature extends Error {
  constructor() {
    super('Assinatura do webhook inválida.');
    this.name = 'InvalidWebhookSignature';
  }
}

/** Assinatura válida, mas o corpo não pode ser lido (não é JSON, vazio). */
export class InvalidWebhookPayload extends Error {
  constructor() {
    super('Corpo do webhook ilegível.');
    this.name = 'InvalidWebhookPayload';
  }
}

/** Falha de comunicação ou recusa técnica do gateway (não é recusa do cartão). */
export class GatewayUnavailable extends Error {
  constructor(message = 'Gateway de pagamento indisponível.') {
    super(message);
    this.name = 'GatewayUnavailable';
  }
}

/** Entrega de um webhook (o fake manda para a própria API). */
export interface WebhookDelivery {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Jobs próprios de um adaptador (o fake: aprovação automática, chargeback, repasse diário). */
export interface GatewayJobs {
  handlers: Record<string, (data: Record<string, unknown>) => Promise<unknown>>;
  /** Agendamentos em cron (fuso America/Sao_Paulo). */
  schedules: { id: string; name: string; pattern: string }[];
}
