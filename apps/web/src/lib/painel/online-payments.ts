import {
  addDays,
  BOOKING_PAYMENT_ABANDONED_REASON,
  BOOKING_PAYMENT_EXPIRED_REASON,
  calculatePlatformFee,
  type DocumentType,
  formatBpsPercent,
  type LedgerEntryKind,
  normalizeCep,
  normalizeCnpj,
  normalizeCpf,
  type OnlineChargeStatus,
  type OnlinePaymentMethod,
  type OnlineRefundReasonCode,
  type PayoutDestination,
  proportionalFeeRefund,
} from '@space-sports/shared';
import { phoneToE164 } from '@/lib/account/profile';
import {
  formatMoney,
  formatShortDate,
  formatShortDateTime,
  formatTime,
  todayLocal,
} from '@/lib/format';
import { rangeBounds } from './agenda';
import { ONLINE_CHARGE_STATUS, ONLINE_METHOD_LABEL } from './labels';

// Pagamento online no painel (RF-ONPAY-01, 02, 07 a 09; RN-ONPAY-05; docs/05, "Pagamento online").
// Regras de texto e de conta das telas, sem React, para testar sem navegador.

/** Rota da página e as abas (`?aba=`), depois do cadastro aprovado. */
export const ONLINE_PAYMENTS_PATH = '/painel/recebimentos-online';
export const ONLINE_TABS = ['carteira', 'contestacoes', 'configuracao'] as const;
export type OnlineTab = (typeof ONLINE_TABS)[number];

export function parseOnlineTab(value: string | null | undefined): OnlineTab {
  return ONLINE_TABS.includes(value as OnlineTab) ? (value as OnlineTab) : 'carteira';
}

// ---------------------------------------------------------------------------------------------
// Cobrança e estornos (bloco "Pagamento online" e diálogo de estorno)

type ChargeMoney = {
  amountCents: number;
  platformFeeCents: number;
  refundedCents: number;
  feeRefundedCents: number;
  refundableCents: number;
};

/** "Taxa de serviço (4%)" com o percentual gravado na cobrança, ou "(mínimo)" (docs/13 §3). */
export function feeLineLabel(charge: { feeBps: number; minFeeApplied: boolean }): string {
  return `Taxa de serviço (${charge.minFeeApplied ? 'mínimo' : formatBpsPercent(charge.feeBps)})`;
}

/** "Cartão final 1111" quando há o final; "Pix" e "Cartão" sem ele. */
export function methodLabel(method: OnlinePaymentMethod, cardLast4?: string | null): string {
  return method === 'CARD' && cardLast4 ? `Cartão final ${cardLast4}` : ONLINE_METHOD_LABEL[method];
}

/** Cabeçalho do bloco: "Pix · pago em 08/11 18:42", "Pix aberto até 18:47", "Cartão em processamento". */
export function chargeHeadline(charge: {
  method: OnlinePaymentMethod;
  status: OnlineChargeStatus;
  cardLast4: string | null;
  expiresAt: string | null;
  paidAt: string | null;
}): string {
  const method = methodLabel(charge.method, charge.cardLast4);
  if (charge.status === 'PENDING') return openChargeLabel(charge);
  if (charge.paidAt) return `${method} · pago em ${formatShortDateTime(charge.paidAt)}`;
  return `${method} · ${ONLINE_CHARGE_STATUS[charge.status].label.toLowerCase()}`;
}

/** Cobrança aberta: "Pix aberto até 18:47" (cartão: "Cartão em processamento"). */
export function openChargeLabel(charge: {
  method: OnlinePaymentMethod;
  expiresAt: string | null;
}): string {
  if (charge.method === 'CARD') return 'Cartão em processamento';
  return charge.expiresAt ? `Pix aberto até ${formatTime(charge.expiresAt)}` : 'Pix aberto';
}

/** O que o espaço recebe depois da taxa, dos estornos e da taxa devolvida. */
export function chargeNetCents(charge: ChargeMoney & { status: OnlineChargeStatus }): number {
  return (
    charge.amountCents - charge.platformFeeCents - charge.refundedCents + charge.feeRefundedCents
  );
}

/**
 * "Estornar" aparece pelo saldo reembolsável, não pelo status: a cobrança com contestação ganha
 * continua `CHARGEBACK` e volta a aceitar estorno (docs/13 §7).
 */
export function canRefund(charge: { refundableCents: number }): boolean {
  return charge.refundableCents > 0;
}

export type RefundEstimate = {
  /** O cliente recebe. */
  refundCents: number;
  /** Taxa devolvida ao espaço (regra acumulada, decisão 94). */
  feeRefundCents: number;
  /** O espaço deixa de receber (estorno − taxa devolvida). */
  spaceLosesCents: number;
  /** Fica em aberto no item ("cobrar de novo", decisão 93). */
  openAfterCents: number;
};

/**
 * Efeito do estorno, só estimativa (a API é a fonte de verdade). `null` com valor inválido (zero,
 * acima do reembolsável). A taxa devolvida usa a mesma função da API (`proportionalFeeRefund`).
 */
export function refundEstimate(
  charge: ChargeMoney,
  refundCents: number,
  chargeAgain: boolean,
): RefundEstimate | null {
  if (!Number.isSafeInteger(refundCents) || refundCents <= 0) return null;
  if (refundCents > charge.refundableCents) return null;
  let feeRefundCents: number;
  try {
    feeRefundCents = proportionalFeeRefund(charge, refundCents);
  } catch {
    return null;
  }
  return {
    refundCents,
    feeRefundCents,
    spaceLosesCents: refundCents - feeRefundCents,
    openAfterCents: chargeAgain ? refundCents : 0,
  };
}

/** Erro do campo "Valor a devolver" (diálogo de estorno). */
export function refundAmountError(cents: number | null, refundableCents: number) {
  if (cents === null || cents <= 0) return 'Informe um valor acima de R$ 0,00';
  if (cents > refundableCents) return `Informe um valor até ${formatMoney(refundableCents)}`;
  return undefined;
}

/** Motivo do estorno: obrigatório, de 5 a 500 caracteres. */
export function refundReasonError(reason: string) {
  const length = reason.trim().length;
  if (length < 5) return 'Informe o motivo do estorno';
  if (length > 500) return 'Use no máximo 500 caracteres';
  return undefined;
}

const AUTO_REFUND_LABEL: Partial<Record<OnlineRefundReasonCode, string>> = {
  BOOKING_CANCELLED_BY_PLAYER: 'Estorno automático (cancelamento dentro do prazo)',
  BOOKING_CANCELLED_BY_SPACE: 'Estorno automático (cancelado pelo espaço)',
  ACCOUNT_DELETED: 'Estorno automático (conta excluída pelo cliente)',
  PAID_AFTER_DEADLINE: 'Estorno automático (pagamento depois do prazo)',
  PAID_AFTER_METHOD_CHANGE: 'Estorno automático (pagamento depois da troca da forma de pagamento)',
  ITEM_ALREADY_PAID: 'Estorno automático (o item já estava pago)',
  EXTERNAL: 'Estorno feito no parceiro de pagamentos',
};

type RefundLike = {
  kind: 'REFUND' | 'CHARGEBACK';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  amountCents: number;
  reason: string | null;
  reasonCode: OnlineRefundReasonCode;
  chargeAgain: boolean;
  requestedByName: string | null;
  createdAt: string;
};

/**
 * Linha do histórico de estornos: "Estorno em 09/11 por Ana", o automático com o motivo, ou a
 * contestação no cartão; o estorno que o parceiro ainda não confirmou sai como "em processamento".
 */
export function refundTitle(refund: RefundLike): string {
  const when = formatShortDate(refund.createdAt);
  let title: string;
  if (refund.kind === 'CHARGEBACK') title = `Contestação no cartão em ${when}`;
  else if (refund.reasonCode === 'MANUAL') {
    title = `Estorno em ${when}${refund.requestedByName ? ` por ${refund.requestedByName}` : ''}`;
  } else title = `${AUTO_REFUND_LABEL[refund.reasonCode] ?? 'Estorno automático'} em ${when}`;
  if (refund.status === 'PENDING') return `${title} · em processamento`;
  if (refund.status === 'FAILED') return `${title} · não concluído`;
  return title;
}

/** Efeito do estorno manual no item (decisão 93); nada nos automáticos e na contestação. */
export function refundEffect(refund: RefundLike, item: 'reserva' | 'mensalidade'): string | null {
  if (refund.kind !== 'REFUND' || refund.reasonCode !== 'MANUAL') return null;
  return refund.chargeAgain ? 'volta a ser cobrado' : `abatido do valor da ${item}`;
}

/** Motivo do cancelamento da reserva, com os códigos do pagamento online traduzidos. */
export function cancelReasonText(reason: string): string {
  if (reason === BOOKING_PAYMENT_EXPIRED_REASON) return 'Pagamento não feito no prazo';
  if (reason === BOOKING_PAYMENT_ABANDONED_REASON) return 'O cliente desistiu antes de pagar';
  return reason;
}

// ---------------------------------------------------------------------------------------------
// Taxa de serviço (card somente leitura)

/**
 * Exemplo do card "Taxa de serviço" com as taxas do espaço e, se houver mínimo, a partir de que
 * valor ele vale no Pix (`mínimo × 10000 ÷ bps`, arredondado para cima ao centavo).
 */
export function feeExample(fee: { pixFeeBps: number; minFeeCents: number }): {
  example: string;
  minimumNote: string | null;
} {
  const base = 10_000;
  const feeCents = calculatePlatformFee(base, { bps: fee.pixFeeBps, minFeeCents: fee.minFeeCents });
  const example = `Exemplo: ${formatMoney(base)} no Pix → taxa ${formatMoney(feeCents)} → o espaço recebe ${formatMoney(base - feeCents)}.`;
  if (fee.pixFeeBps === 0 || fee.minFeeCents === 0) return { example, minimumNote: null };
  const threshold = Math.ceil((fee.minFeeCents * 10_000) / fee.pixFeeBps);
  return {
    example,
    minimumNote: `Abaixo de ${formatMoney(threshold)} no Pix, vale o mínimo de ${formatMoney(fee.minFeeCents)}.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Carteira

/** Filtro "Tipo" dos lançamentos. */
export const LEDGER_FILTERS: { value: LedgerEntryKind; label: string }[] = [
  { value: 'SALE', label: 'Vendas' },
  { value: 'PLATFORM_FEE', label: 'Taxas de serviço' },
  { value: 'REFUND', label: 'Estornos' },
  { value: 'FEE_REFUND', label: 'Taxas devolvidas' },
  { value: 'CHARGEBACK', label: 'Contestações' },
  { value: 'PAYOUT', label: 'Repasses' },
  { value: 'ADJUSTMENT', label: 'Ajustes' },
];

/** Período padrão dos lançamentos: os últimos 30 dias (inclusive hoje), em datas locais. */
export function defaultWalletRange(now: Date = new Date()): { from: string; to: string } {
  const to = todayLocal(now);
  return { from: addDays(to, -29), to };
}

/** Datas locais inclusivas → `[from, to)` em UTC para a API; `null` se inválido. */
export function walletBounds(from: string, to: string): { from: string; to: string } | null {
  if (!from || !to || from > to) return null;
  return rangeBounds(from, to);
}

/** `carteira-<slug>-<de>_<até>.csv` (docs/05). */
export function walletCsvFilename(slug: string, from: string, to: string): string {
  return `carteira-${slug}-${from}_${to}.csv`;
}

/** Filtro "Meio" dos lançamentos: só os de cobranças desse meio (repasses e ajustes saem). */
export const WALLET_METHOD_FILTERS: { value: OnlinePaymentMethod; label: string }[] = [
  { value: 'PIX', label: ONLINE_METHOD_LABEL.PIX },
  { value: 'CARD', label: ONLINE_METHOD_LABEL.CARD },
];

/** Lançamentos por página na tela (a API pagina por cursor e manda o total dos filtros). */
export const WALLET_PAGE_SIZE = 25;

/** "Página 2 de 5" pelo total de lançamentos dos filtros; sem lançamentos, "Página 1 de 1". */
export function walletPageLabel(page: number, total: number, pageSize = WALLET_PAGE_SIZE): string {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `Página ${page} de ${Math.max(page, pages)}`;
}

export type ReleaseRow = { date: string; amountCents: number };

/**
 * "A liberar por data": as próximas `limit` datas e uma linha final "Depois de <data>" com o resto.
 * `max` é a escala das barras.
 */
export function releaseRows(
  upcoming: ReleaseRow[],
  limit = 7,
): { rows: ReleaseRow[]; rest: { after: string; amountCents: number } | null; max: number } {
  const rows = upcoming.slice(0, limit);
  const tail = upcoming.slice(limit);
  const last = rows.at(-1);
  const rest =
    tail.length > 0 && last
      ? { after: last.date, amountCents: tail.reduce((sum, r) => sum + r.amountCents, 0) }
      : null;
  const max = Math.max(0, ...rows.map((r) => r.amountCents), rest?.amountCents ?? 0);
  return { rows, rest, max };
}

/** Largura da barra (%): proporcional ao maior valor; zero sem valor. */
export function barPercent(amountCents: number, max: number): number {
  if (amountCents <= 0 || max <= 0) return 0;
  return Math.max(1, Math.round((amountCents / max) * 100));
}

/** Descrição do lançamento: a da API ou, sem ela, o item e o pagador. */
export function ledgerDescription(entry: {
  kind: LedgerEntryKind;
  description: string | null;
  payableType: 'BOOKING' | 'SUBSCRIPTION_CHARGE' | null;
  payerName: string | null;
}): string {
  if (entry.description) return entry.description;
  if (entry.kind === 'PAYOUT') return 'Repasse para a conta do espaço';
  const item =
    entry.payableType === 'BOOKING'
      ? 'Reserva'
      : entry.payableType === 'SUBSCRIPTION_CHARGE'
        ? 'Mensalidade'
        : null;
  return [item, entry.payerName].filter(Boolean).join(' · ') || '—';
}

// ---------------------------------------------------------------------------------------------
// Contestações

/** Prazo da contestação: "12/11 · faltam 3 dias" (urgente), "12/11" ou "Prazo encerrado". */
export function disputeDeadline(
  respondBy: string | null,
  now: Date = new Date(),
): { text: string; urgent: boolean; closed: boolean } {
  if (!respondBy) return { text: '—', urgent: false, closed: false };
  const end = new Date(respondBy).getTime();
  if (end <= now.getTime()) return { text: 'Prazo encerrado', urgent: false, closed: true };
  const days = Math.ceil((end - now.getTime()) / 86_400_000);
  const date = formatShortDate(respondBy);
  if (days > 3) return { text: date, urgent: false, closed: false };
  const left = days === 1 ? 'falta 1 dia' : `faltam ${days} dias`;
  return { text: `${date} · ${left}`, urgent: true, closed: false };
}

/** Resposta da contestação: 20 a 2000 caracteres (a API aceita até 4000). */
export function disputeTextError(text: string) {
  const length = text.trim().length;
  if (length < 20) return 'Escreva pelo menos 20 caracteres';
  if (length > 2000) return 'Use no máximo 2000 caracteres';
  return undefined;
}

/** Links de anexos: um por linha, só `https`, até 3. */
export function parseAttachmentUrls(text: string): { urls: string[]; error?: string } {
  const urls = text
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length > 3) return { urls, error: 'Envie até 3 links' };
  for (const url of urls) {
    try {
      if (new URL(url).protocol !== 'https:')
        return { urls, error: 'Use links que começam com https://' };
    } catch {
      return { urls, error: 'Confira os links: um por linha, começando com https://' };
    }
  }
  return { urls };
}

// ---------------------------------------------------------------------------------------------
// Cadastro da conta de recebimento (RF-ONPAY-01, decisões 90 e 95)

export const MERCHANT_STEPS = [
  'Quem recebe',
  'Endereço',
  'Onde receber',
  'Revisão e envio',
] as const;

export type PixKeyType = 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';

export type MerchantDraft = {
  documentType: DocumentType;
  document: string;
  legalName: string;
  responsibleName: string;
  /** CPF de quem responde pela conta: só (e sempre) com CNPJ. */
  responsibleCpf: string;
  phone: string;
  email: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  payoutKind: 'BANK_ACCOUNT' | 'PIX_KEY';
  bankCode: string;
  agency: string;
  /** Conta com dígito, como se digita: `12345-6`. */
  account: string;
  accountType: 'CHECKING' | 'SAVINGS';
  pixKeyType: PixKeyType;
  pixKey: string;
  acceptTerms: boolean;
};

export const EMPTY_MERCHANT_DRAFT: MerchantDraft = {
  documentType: 'CNPJ',
  document: '',
  legalName: '',
  responsibleName: '',
  responsibleCpf: '',
  phone: '',
  email: '',
  postalCode: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  payoutKind: 'BANK_ACCOUNT',
  bankCode: '',
  agency: '',
  account: '',
  accountType: 'CHECKING',
  pixKeyType: 'CNPJ',
  pixKey: '',
  acceptTerms: false,
};

export type DraftErrors = Partial<Record<keyof MerchantDraft, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `12345-6` → conta e dígito; `null` se não tiver o formato. */
export function splitAccount(value: string): { account: string; digit: string } | null {
  const text = value.replace(/[\s.]/g, '');
  // Com hífen, o dígito vem depois dele; sem hífen, é o último caractere.
  const match = text.includes('-')
    ? /^(\d{1,13})-([0-9xX]{1,2})$/.exec(text)
    : /^(\d{1,13})([0-9xX])$/.exec(text);
  if (!match) return null;
  return { account: match[1] as string, digit: (match[2] as string).toUpperCase() };
}

/** Chave Pix normalizada para a API, ou `null` se não confere com o tipo. */
export function normalizePixKey(type: PixKeyType, value: string): string | null {
  const text = value.trim();
  switch (type) {
    case 'CPF':
      return normalizeCpf(text);
    case 'CNPJ':
      return normalizeCnpj(text);
    case 'EMAIL':
      return EMAIL.test(text) ? text.toLowerCase() : null;
    case 'PHONE':
      return phoneToE164(text);
    case 'RANDOM':
      return UUID_KEY.test(text) ? text.toLowerCase() : null;
  }
}

/** Valida uma etapa do cadastro (0 a 3). */
export function validateMerchantStep(step: number, d: MerchantDraft): DraftErrors {
  const e: DraftErrors = {};
  if (step === 0) {
    const doc = d.documentType === 'CPF' ? normalizeCpf(d.document) : normalizeCnpj(d.document);
    if (!doc)
      e.document = d.documentType === 'CPF' ? 'Informe um CPF válido' : 'Informe um CNPJ válido';
    if (!d.legalName.trim()) {
      e.legalName = d.documentType === 'CPF' ? 'Informe o nome completo' : 'Informe a razão social';
    }
    if (d.documentType === 'CNPJ' && !d.responsibleName.trim()) {
      e.responsibleName = 'Informe quem responde pela conta';
    }
    if (d.documentType === 'CNPJ' && !normalizeCpf(d.responsibleCpf)) {
      e.responsibleCpf = 'Informe um CPF válido';
    }
    if (!phoneToE164(d.phone)) e.phone = 'Informe um telefone brasileiro com DDD';
    if (!EMAIL.test(d.email.trim())) e.email = 'Informe um e-mail válido';
  }
  if (step === 1) {
    if (!normalizeCep(d.postalCode)) e.postalCode = 'Informe um CEP válido';
    if (!d.street.trim()) e.street = 'Informe a rua';
    if (!d.number.trim()) e.number = 'Informe o número';
    if (!d.neighborhood.trim()) e.neighborhood = 'Informe o bairro';
    if (!d.city.trim()) e.city = 'Informe a cidade';
    if (!/^[A-Za-z]{2}$/.test(d.state.trim())) e.state = 'Informe a UF';
  }
  if (step === 2) {
    if (d.payoutKind === 'BANK_ACCOUNT') {
      if (!/^\d{3}$/.test(d.bankCode.trim())) e.bankCode = 'Informe o código do banco (3 dígitos)';
      if (!/^\d{1,5}$/.test(d.agency.trim())) e.agency = 'Informe a agência, sem o dígito';
      if (!splitAccount(d.account)) e.account = 'Informe a conta com o dígito, ex.: 12345-6';
    } else if (!normalizePixKey(d.pixKeyType, d.pixKey)) {
      e.pixKey = 'Confira a chave Pix';
    }
  }
  if (step === 3 && !d.acceptTerms) e.acceptTerms = 'Aceite os termos para continuar';
  return e;
}

/** Destino do repasse (conta bancária ou chave Pix), já no formato da API. */
export function payoutFromDraft(d: MerchantDraft): PayoutDestination {
  if (d.payoutKind === 'PIX_KEY') {
    return {
      kind: 'PIX_KEY',
      keyType: d.pixKeyType,
      key: normalizePixKey(d.pixKeyType, d.pixKey) ?? d.pixKey.trim(),
    };
  }
  const split = splitAccount(d.account);
  return {
    kind: 'BANK_ACCOUNT',
    bankCode: d.bankCode.trim(),
    agency: d.agency.trim(),
    account: split?.account ?? '',
    accountDigit: split?.digit ?? '',
    accountType: d.accountType,
  };
}

/** Corpo do `PUT …/merchant-account` (a API valida tudo de novo). */
export function merchantPayload(d: MerchantDraft) {
  const document =
    (d.documentType === 'CPF' ? normalizeCpf(d.document) : normalizeCnpj(d.document)) ?? d.document;
  const complement = d.complement.trim();
  return {
    documentType: d.documentType,
    document,
    legalName: d.legalName.trim(),
    // Pessoa física: quem responde é a própria pessoa (e o CPF do responsável não vai).
    responsibleName: (d.documentType === 'CPF' ? d.legalName : d.responsibleName).trim(),
    ...(d.documentType === 'CNPJ'
      ? { responsibleCpf: normalizeCpf(d.responsibleCpf) ?? d.responsibleCpf }
      : {}),
    email: d.email.trim().toLowerCase(),
    phone: phoneToE164(d.phone) ?? d.phone,
    address: {
      postalCode: normalizeCep(d.postalCode) ?? d.postalCode,
      street: d.street.trim(),
      number: d.number.trim(),
      ...(complement ? { complement } : {}),
      neighborhood: d.neighborhood.trim(),
      city: d.city.trim(),
      state: d.state.trim().toUpperCase(),
    },
    payout: payoutFromDraft(d),
    acceptTerms: true as const,
  };
}

/** Resumo da etapa "Onde receber" na revisão. */
export function payoutSummary(d: MerchantDraft): string {
  if (d.payoutKind === 'PIX_KEY') return `Chave Pix (${PIX_KEY_LABEL[d.pixKeyType]}) · ${d.pixKey}`;
  const type = d.accountType === 'CHECKING' ? 'Conta corrente' : 'Poupança';
  return `Banco ${d.bankCode} · Ag. ${d.agency} · ${type} ${d.account}`;
}

export const PIX_KEY_LABEL: Record<PixKeyType, string> = {
  CPF: 'CPF',
  CNPJ: 'CNPJ',
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  RANDOM: 'Aleatória',
};

/**
 * Bancos mais comuns (código COMPE), para a busca do campo "Banco". Qualquer outro código de 3
 * dígitos também vale.
 */
export const COMMON_BANKS: { code: string; name: string }[] = [
  { code: '001', name: 'Banco do Brasil' },
  { code: '033', name: 'Santander' },
  { code: '077', name: 'Banco Inter' },
  { code: '104', name: 'Caixa Econômica Federal' },
  { code: '197', name: 'Stone' },
  { code: '208', name: 'BTG Pactual' },
  { code: '237', name: 'Bradesco' },
  { code: '260', name: 'Nu Pagamentos' },
  { code: '290', name: 'PagSeguro' },
  { code: '323', name: 'Mercado Pago' },
  { code: '336', name: 'C6 Bank' },
  { code: '341', name: 'Itaú' },
  { code: '380', name: 'PicPay' },
  { code: '403', name: 'Cora' },
  { code: '748', name: 'Sicredi' },
  { code: '756', name: 'Sicoob' },
];

// ---------------------------------------------------------------------------------------------
// Ajustes da revisão da PG.3

/**
 * Qual formulário abre (decisão 98): espaço já aprovado (`approvedAt`) nunca refaz o cadastro
 * inteiro, só troca a conta ("Onde receber"), pedida com `?troca=1` (a troca recusada volta para
 * `APPROVED` com a conta anterior). Em análise, nada a enviar.
 */
export function merchantFormMode(
  merchant: { status: string; approvedAt: string | null },
  changeRequested: boolean,
): 'submit' | 'change' | 'pending' | 'approved' {
  if (merchant.status === 'PENDING') return 'pending';
  if (merchant.approvedAt !== null) {
    if (merchant.status === 'REJECTED' || changeRequested) return 'change';
    return 'approved';
  }
  return 'submit';
}

/**
 * Corpo do estorno manual: sempre com o valor confirmado na tela, também em "Tudo o que falta"
 * (o reembolsável pode ter mudado; a API recusa com 422 se passar do atual).
 */
export function refundPayload(input: { cents: number; reason: string; chargeAgain: boolean }) {
  return { amountCents: input.cents, reason: input.reason.trim(), chargeAgain: input.chargeAgain };
}

/** Registro feito pelo app: só sai pelo estorno da cobrança online (sem o "Estornar" manual). */
export function isOnlineRecord(payment: { channel: 'ON_SITE' | 'ONLINE' }): boolean {
  return payment.channel === 'ONLINE';
}

/**
 * Cursores da paginação presos aos filtros: mudar o período, o tipo ou o meio (inclusive pelo
 * "Ver todos" dos repasses) volta à página 1.
 */
export type Paging = { key: string; cursors: (string | undefined)[] };

export function cursorsFor(paging: Paging, key: string): (string | undefined)[] {
  return paging.key === key ? paging.cursors : [undefined];
}
