import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Body, Controller, Get, HttpStatus, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  type ChangePayoutDestinationInput,
  type Chargeback,
  type ChargebackList,
  type CursorPageQuery,
  changePayoutDestinationSchema,
  cursorPageQuerySchema,
  type DisputeChargebackInput,
  disputeChargebackSchema,
  type LedgerEntryPage,
  type MerchantAccount,
  type OnlineCharge,
  type OnlineChargePage,
  type OnlineChargesQuery,
  type OnlineRefund,
  onlineChargesQuerySchema,
  type PayoutPage,
  type RefundOnlineChargeInput,
  refundOnlineChargeSchema,
  type SpacePaymentSettings,
  type SubmitMerchantAccountInput,
  submitMerchantAccountSchema,
  type UpdatePaymentModesInput,
  updatePaymentModesSchema,
  type WalletEntriesFilters,
  type WalletEntriesQuery,
  type WalletSummary,
  walletEntriesFiltersSchema,
  walletEntriesQuerySchema,
} from '@space-sports/shared';
import type { Response } from 'express';
import type { AuthUser, SpaceAccess } from '../auth/auth-context.js';
import { ApiAuth, CurrentSpaceAccess, CurrentUser, SpacePermission } from '../auth/decorators.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { MerchantAccountsService } from './merchant-accounts.service.js';
import { OnlineChargesService } from './online-charges.service.js';
import { toRefund } from './online-views.js';
import { PaymentSettingsService } from './payment-settings.service.js';
import {
  chargebackNotFound,
  onlineChargeNotFound,
  supportModeForbidden,
} from './payments.errors.js';
import { paymentSchemas as schemas } from './payments.openapi.js';
import { WalletService } from './wallet.service.js';

const chargeId = () => Param('chargeId', new UuidParamPipe(onlineChargeNotFound));
const chargebackId = () => Param('chargebackId', new UuidParamPipe(chargebackNotFound));

/** Decisão 95: cadastro e conta de recebimento só pelo próprio Dono, fora do modo suporte. */
function assertNotSupport(access: SpaceAccess | undefined): void {
  if (access?.support) throw supportModeForbidden();
}

const ENTRIES_FILTERS =
  '`from`/`to` (ISO 8601 com fuso) filtram pela criação do lançamento, meio-aberto; `kind` aceita vários; `method` (`PIX`/`CARD`) fica com os lançamentos que têm cobrança desse meio, inclusive o ajuste da contestação ganha (repasses e o ajuste do repasse que falhou, sem cobrança, saem). Valores em centavos, com sinal (débito negativo).';

/**
 * Recebimentos online no painel (RF-ONPAY-01, 02, 07 a 09): cadastro no gateway (só o Dono, fora
 * do modo suporte), modos de pagamento, carteira, cobranças, estornos e contestações (Dono e
 * Admin). O Professor não vê nada daqui (decisão 53). Tudo filtrado pelo `:spaceId` da rota.
 */
@ApiTags('online-payments')
@ApiAuth()
@Controller('manage/spaces/:spaceId/online-payments')
export class ManageOnlinePaymentsController {
  constructor(
    private readonly merchants: MerchantAccountsService,
    private readonly settings: PaymentSettingsService,
    private readonly wallet: WalletService,
    private readonly charges: OnlineChargesService,
  ) {}

  // Cadastro no gateway ----------------------------------------------------------------------

  @Get('merchant-account')
  @SpacePermission('payments.online.manage')
  @ApiOperation({
    operationId: 'getMerchantAccount',
    summary: 'Cadastro do espaço no parceiro de pagamentos',
    description:
      'RF-ONPAY-01: status (`NOT_STARTED`, `PENDING`, `APPROVED`, `REJECTED` com motivo), documento, CPF do responsável e conta sempre mascarados (RN-ONPAY-10), `payoutsPaused` (troca de conta em análise, decisão 95), `lastRejectedPayoutChange` (a última troca recusada, com o motivo, decisão 98) e o ambiente de pagamento (com o fake, a dica do documento de recusa). Dono e Admin leem; só o Dono envia.',
  })
  @ApiZodResponse(schemas.merchantAccount)
  getMerchant(@Param('spaceId') spaceId: string): Promise<MerchantAccount> {
    return this.merchants.get(spaceId);
  }

  @Put('merchant-account')
  @SpacePermission('merchant.manage')
  @ApiOperation({
    operationId: 'submitMerchantAccount',
    summary: 'Enviar (ou reenviar) o cadastro no parceiro de pagamentos',
    description:
      'RF-ONPAY-01, decisões 90, 95, 97 e 98: só o Dono, fora do modo suporte (403 `SUPPORT_MODE_FORBIDDEN`). Primeiro envio ou reenvio depois da recusa; em análise responde 409 `MERCHANT_ACCOUNT_PENDING`. Espaço que já foi aprovado (`approvedAt`), inclusive com uma troca de conta em análise, responde 409 `MERCHANT_ACCOUNT_APPROVED`: não refaz o cadastro nem cria outra subconta, só troca a conta (`/payout`). Com CNPJ, `responsibleCpf` (CPF do responsável) é obrigatório; com CPF, não é enviado. Documento, CPF do responsável e conta vão ao gateway; a API guarda o documento completo só cifrado (decisão 97), o CPF do responsável e a conta só mascarados, e devolve tudo mascarado. Com o fake, a aprovação chega sozinha em alguns segundos (documento terminado em 0000 é recusado). Gateway desligado: 422 `ONLINE_PAYMENTS_DISABLED`; falha do gateway: 502 `PAYMENT_GATEWAY_UNAVAILABLE`. Auditado: `merchant_account.submit`/`resubmit`.',
  })
  @ApiZodBody(schemas.submitMerchant)
  @ApiZodResponse(schemas.merchantAccount)
  submitMerchant(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
    @Body(new ZodValidationPipe(submitMerchantAccountSchema)) body: SubmitMerchantAccountInput,
  ): Promise<MerchantAccount> {
    assertNotSupport(access);
    return this.merchants.submit(spaceId, user.id, body);
  }

  @Put('merchant-account/payout')
  @SpacePermission('merchant.manage')
  @ApiOperation({
    operationId: 'changeMerchantPayout',
    summary: 'Trocar a conta de recebimento',
    description:
      'Decisões 95 e 98: só o Dono, fora do modo suporte (403 `SUPPORT_MODE_FORBIDDEN`), com o cadastro já aprovado (422 `MERCHANT_NOT_APPROVED`). O cadastro volta para `PENDING`, os repasses ficam pausados até a decisão (`payoutsPaused`; as cobranças continuam) e todos os Donos recebem notificação e e-mail. Aprovada, vale a nova conta. Recusada, volta a valer a conta anterior (`APPROVED`, repasses retomados, pagamento online segue), a conta recusada e o motivo ficam em `lastRejectedPayoutChange` (até a próxima troca) e os Donos recebem `MERCHANT_PAYOUT_CHANGE_REJECTED` com e-mail. Auditado: `merchant_account.change_payout` e `merchant_account.payout_change_rejected`.',
  })
  @ApiZodBody(schemas.changePayout)
  @ApiZodResponse(schemas.merchantAccount)
  changePayout(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
    @Body(new ZodValidationPipe(changePayoutDestinationSchema)) body: ChangePayoutDestinationInput,
  ): Promise<MerchantAccount> {
    assertNotSupport(access);
    return this.merchants.changePayout(spaceId, user.id, body);
  }

  // Modos --------------------------------------------------------------------------------------

  @Get('settings')
  @SpacePermission('payments.online.manage')
  @ApiOperation({
    operationId: 'getSpacePaymentSettings',
    summary: 'Modos de pagamento e taxa vigente',
    description:
      'RF-ONPAY-02: modos gravados e em vigor (`ON_SITE` sem gateway, sem cadastro aprovado ou com o espaço fora de ACTIVE), `onlineReady` (a regra que a API usa para aceitar cobranças e liberar os modos online: gateway ligado, espaço ativo e cadastro já aprovado e que não esteja `REJECTED`; a troca de conta em análise não tira), a taxa vigente (somente leitura: a do espaço, se o Super definiu, ou a padrão) e o ambiente de pagamento.',
  })
  @ApiZodResponse(schemas.settings)
  getSettings(@Param('spaceId') spaceId: string): Promise<SpacePaymentSettings> {
    return this.settings.get(spaceId);
  }

  @Put('settings')
  @SpacePermission('payments.online.manage')
  @ApiOperation({
    operationId: 'updateSpacePaymentModes',
    summary: 'Escolher os modos de pagamento de reservas e aulas',
    description:
      'RF-ONPAY-02, decisão 84: reservas `ON_SITE`, `ONLINE_OPTIONAL` ou `ONLINE_REQUIRED`; aulas `ON_SITE` ou `ONLINE_OPTIONAL`. Modo online sem o cadastro aprovado: 422 `MERCHANT_NOT_APPROVED`. Auditado: `payment_settings.update`.',
  })
  @ApiZodBody(schemas.updateModes)
  @ApiZodResponse(schemas.settings)
  updateSettings(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updatePaymentModesSchema)) body: UpdatePaymentModesInput,
  ): Promise<SpacePaymentSettings> {
    return this.settings.updateModes(spaceId, user.id, body);
  }

  // Carteira -----------------------------------------------------------------------------------

  @Get('wallet')
  @SpacePermission('payments.online.manage')
  @ApiOperation({
    operationId: 'getWalletSummary',
    summary: 'Carteira: disponível, a liberar e repassado',
    description:
      'RF-ONPAY-07, decisão 89: espelho da subconta no livro-razão. `availableCents` (liberado e não repassado), `pendingCents` e `upcoming` (a liberar por dia local), `paidOutCents`, avisos (contestações aguardando resposta, repasses que falharam, repasses pausados pela troca de conta) e o ambiente de pagamento.',
  })
  @ApiZodResponse(schemas.wallet)
  walletSummary(@Param('spaceId') spaceId: string): Promise<WalletSummary> {
    return this.wallet.summary(spaceId);
  }

  @Get('wallet/entries')
  @SpacePermission('payments.online.manage')
  @ApiOperation({
    operationId: 'listWalletEntries',
    summary: 'Lançamentos da carteira',
    description: `RF-ONPAY-07: venda, taxa de serviço, estorno, taxa devolvida, contestação, repasse e ajuste, do mais recente para o mais antigo, por cursor. \`total\`: lançamentos com os filtros, em todas as páginas. ${ENTRIES_FILTERS}`,
  })
  @ApiZodQuery(walletEntriesQuerySchema)
  @ApiZodResponse(schemas.entries)
  entries(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(walletEntriesQuerySchema)) query: WalletEntriesQuery,
  ): Promise<LedgerEntryPage> {
    return this.wallet.entries(spaceId, query);
  }

  @Get('wallet/entries.csv')
  @SpacePermission('payments.online.manage')
  @ApiOperation({
    operationId: 'exportWalletEntriesCsv',
    summary: 'Exportar os lançamentos em CSV',
    description: `RF-ONPAY-07. Os mesmos filtros da lista: ${ENTRIES_FILTERS} Em ordem cronológica, UTF-8 com BOM. Colunas: id, criado_em_utc, criado_em_local, tipo, descricao, meio, valor_centavos (com sinal), libera_em_local, cobranca_id.`,
  })
  @ApiZodQuery(walletEntriesFiltersSchema)
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'Arquivo CSV.',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async entriesCsv(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(walletEntriesFiltersSchema)) filters: WalletEntriesFilters,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="carteira-lancamentos.csv"');
    res.setHeader('Cache-Control', 'no-store');
    await pipeline(Readable.from(this.wallet.entriesCsv(spaceId, filters)), res);
  }

  @Get('wallet/payouts')
  @SpacePermission('payments.online.manage')
  @ApiOperation({
    operationId: 'listWalletPayouts',
    summary: 'Repasses para a conta do espaço',
    description: 'RF-ONPAY-07: repasses automáticos (`SCHEDULED`, `PAID`, `FAILED`), por cursor.',
  })
  @ApiZodQuery(cursorPageQuerySchema)
  @ApiZodResponse(schemas.payouts)
  payouts(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(cursorPageQuerySchema)) query: CursorPageQuery,
  ): Promise<PayoutPage> {
    return this.wallet.payouts(spaceId, query);
  }

  // Cobranças e estornos -----------------------------------------------------------------------

  @Get('charges')
  @SpacePermission('payments.online.manage')
  @ApiOperation({
    operationId: 'listOnlineCharges',
    summary: 'Cobranças online do espaço',
    description:
      'RF-ONPAY-08: com `payableType` + `payableId`, as cobranças de uma reserva ou mensalidade (a aberta, as pagas e as encerradas), com meio, valor, taxa gravada (`feeBps`, `minFeeApplied`), líquido, liberação, transação e estornos.',
  })
  @ApiZodQuery(onlineChargesQuerySchema)
  @ApiZodResponse(schemas.chargePage)
  listCharges(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(onlineChargesQuerySchema)) query: OnlineChargesQuery,
  ): Promise<OnlineChargePage> {
    return this.wallet.charges(spaceId, query);
  }

  @Get('charges/:chargeId')
  @SpacePermission('payments.online.manage')
  @ApiUuidParam('chargeId')
  @ApiOperation({ operationId: 'getOnlineCharge', summary: 'Cobrança online' })
  @ApiZodResponse(schemas.charge)
  async getCharge(
    @Param('spaceId') spaceId: string,
    @chargeId() id: string,
  ): Promise<OnlineCharge> {
    const charge = await this.wallet.charge(spaceId, id);
    if (!charge) throw onlineChargeNotFound();
    return charge;
  }

  @Post('charges/:chargeId/refunds')
  @SpacePermission('payments.online.manage')
  @ApiUuidParam('chargeId')
  @ApiOperation({
    operationId: 'refundOnlineCharge',
    summary: 'Estornar um pagamento online (total ou parcial)',
    description:
      'RN-ONPAY-05, decisões 86, 93 e 94: Dono ou Admin, com motivo e `amountCents` sempre explícito (no "tudo o que falta", o `refundableCents` que a tela mostrou); acima do reembolsável atual (pago − estornado − estornos pendentes), 422 `REFUND_EXCEEDS_BALANCE` com `details.refundableCents`. A taxa volta ao espaço pela regra acumulada. `chargeAgain` falso (padrão): o valor vira abatimento do item (saldo em aberto zero); verdadeiro: o valor volta a ficar em aberto. O registro de pagamento fica com o líquido (total: estornado). Erros: 409 `CHARGE_NOT_REFUNDABLE` (status), 422 `REFUND_EXCEEDS_BALANCE` (com `refundableCents`), 502 `PAYMENT_GATEWAY_UNAVAILABLE`. Auditado: `payment.online.refund`.',
  })
  @ApiZodBody(schemas.refundInput)
  @ApiZodResponse(schemas.refund, HttpStatus.CREATED)
  async refund(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @chargeId() id: string,
    @Body(new ZodValidationPipe(refundOnlineChargeSchema)) body: RefundOnlineChargeInput,
  ): Promise<OnlineRefund> {
    const refund = await this.charges.refund(id, {
      spaceId,
      amountCents: body.amountCents,
      reason: body.reason,
      reasonCode: 'MANUAL',
      requestedBy: user.id,
      chargeAgain: body.chargeAgain,
    });
    return toRefund(refund, user.name);
  }

  // Contestações -------------------------------------------------------------------------------

  @Get('chargebacks')
  @SpacePermission('payments.online.manage')
  @ApiOperation({
    operationId: 'listChargebacks',
    summary: 'Contestações no cartão (chargebacks)',
    description:
      'RF-ONPAY-09, decisão 87: as que aguardam resposta primeiro. `dispute.status`: `AWAITING_RESPONSE`, `RESPONDED`, `WON` ou `LOST`, com o prazo (`respondBy`), a resposta enviada e o resultado.',
  })
  @ApiZodResponse(schemas.chargebacks)
  chargebacks(@Param('spaceId') spaceId: string): Promise<ChargebackList> {
    return this.wallet.chargebacks(spaceId);
  }

  @Post('chargebacks/:chargebackId/dispute')
  @SpacePermission('payments.online.manage')
  @ApiUuidParam('chargebackId')
  @ApiOperation({
    operationId: 'disputeChargeback',
    summary: 'Responder a contestação',
    description:
      'RF-ONPAY-09: texto e links dos anexos (opcionais), até o prazo e uma vez só. Erros: 409 `DISPUTE_CLOSED`, 409 `DISPUTE_DEADLINE_PASSED`. Auditado: `payment.online.dispute`.',
  })
  @ApiZodBody(schemas.dispute)
  @ApiZodResponse(schemas.chargeback, HttpStatus.CREATED)
  dispute(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @chargebackId() id: string,
    @Body(new ZodValidationPipe(disputeChargebackSchema)) body: DisputeChargebackInput,
  ): Promise<Chargeback> {
    return this.wallet.dispute(spaceId, user.id, id, body);
  }
}
