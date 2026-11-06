import { Body, Controller, Get, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type MyPaymentDetail,
  type MyPaymentPage,
  type MyPaymentsQuery,
  myPaymentsQuerySchema,
  type PayOnlineInput,
  type PlayerOnlineCharge,
  payOnlineSchema,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser } from '../auth/decorators.js';
import { bookingNotFound } from '../bookings/bookings.errors.js';
import { subscriptionChargeNotFound } from '../classes/subscriptions.errors.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { ApiIdempotencyKey, IdempotencyKey } from './idempotency-key.js';
import { MyPaymentsService } from './my-payments.service.js';
import { OnlineChargesService } from './online-charges.service.js';
import { onlineChargeNotFound } from './payments.errors.js';
import { paymentSchemas as schemas } from './payments.openapi.js';

const PAY_ERRORS =
  'Erros: 404 (item não é seu), 409 `PAYMENT_HOLD_EXPIRED` (prazo da reserva acabou), 409 `ALREADY_PAID`, 409 `NOT_PAYABLE_ONLINE`, 422 `ONLINE_PAYMENT_UNAVAILABLE` (o modo não permite), 422 `ONLINE_PAYMENTS_DISABLED`, 422 `IDEMPOTENCY_KEY_REUSED` (a mesma `Idempotency-Key` já foi usada em outro item ou com outro meio), 502 `PAYMENT_GATEWAY_UNAVAILABLE`. Cartão recusado não é erro: a cobrança volta `FAILED` com `failureCode`/`failureReason`, e uma nova tentativa vai para a mesma reserva.';

/**
 * Pagamento online pelo jogador (RF-ONPAY-03 a 06; RN-ONPAY-03, RN-ONPAY-10; decisão 96): cobrança
 * da reserva (só o organizador) e da mensalidade (só o aluno), e "Meus pagamentos". Nenhum dado de
 * cartão passa pela API: só o token.
 */
@ApiTags('payments')
@ApiAuth()
@Controller()
export class PlayerPaymentsController {
  constructor(
    private readonly charges: OnlineChargesService,
    private readonly myPayments: MyPaymentsService,
  ) {}

  @Post('bookings/:bookingId/payment')
  @ApiUuidParam('bookingId')
  @ApiIdempotencyKey()
  @ApiOperation({
    operationId: 'payMyBooking',
    summary: 'Pagar a reserva online (Pix ou cartão)',
    description: `RF-ONPAY-03/04, RN-ONPAY-03: cobra o saldo em aberto da reserva inteira. Uma cobrança aberta por item: a anterior é cancelada no gateway antes (se ela já tinha sido paga, a resposta é ela, com \`PAID\`). Pix na reserva obrigatória vale até \`paymentDueAt\`; no modo opcional, 15 min (até o início). \`serverTime\` acompanha a resposta para a contagem regressiva. ${PAY_ERRORS}`,
  })
  @ApiZodBody(schemas.payOnline)
  @ApiZodResponse(schemas.playerCharge, HttpStatus.CREATED)
  payBooking(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', new UuidParamPipe(bookingNotFound)) bookingId: string,
    @IdempotencyKey() requestKey: string | undefined,
    @Body(new ZodValidationPipe(payOnlineSchema)) body: PayOnlineInput,
  ): Promise<PlayerOnlineCharge> {
    return this.charges.payBooking(user.id, bookingId, body, { requestKey });
  }

  @Get('bookings/:bookingId/payment')
  @ApiUuidParam('bookingId')
  @ApiOperation({
    operationId: 'getMyBookingPayment',
    summary: 'Cobrança online da reserva',
    description:
      'Só o organizador: a cobrança aberta (com o Pix) ou, sem ela, a mais recente. Sem cobrança: 404 `ONLINE_CHARGE_NOT_FOUND`.',
  })
  @ApiZodResponse(schemas.playerCharge)
  getBookingPayment(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', new UuidParamPipe(bookingNotFound)) bookingId: string,
  ): Promise<PlayerOnlineCharge> {
    return this.charges.getForBooking(user.id, bookingId);
  }

  @Post('me/subscriptions/:subscriptionId/charges/:chargeId/payment')
  @ApiUuidParam('subscriptionId')
  @ApiUuidParam('chargeId')
  @ApiIdempotencyKey()
  @ApiOperation({
    operationId: 'payMySubscriptionCharge',
    summary: 'Pagar a mensalidade online (Pix ou cartão)',
    description: `RF-ONPAY-05: só o aluno, com o modo de aulas \`ONLINE_OPTIONAL\`; cobra o saldo em aberto. O Pix vale 24 h. Pago, a mensalidade fica \`PAID\` e a assinatura sai de \`PAST_DUE\` pelo fluxo do registro manual (RN-ONPAY-04). ${PAY_ERRORS}`,
  })
  @ApiZodBody(schemas.payOnline)
  @ApiZodResponse(schemas.playerCharge, HttpStatus.CREATED)
  paySubscriptionCharge(
    @CurrentUser() user: AuthUser,
    @Param('subscriptionId', new UuidParamPipe(subscriptionChargeNotFound)) subscriptionId: string,
    @Param('chargeId', new UuidParamPipe(subscriptionChargeNotFound)) chargeId: string,
    @IdempotencyKey() requestKey: string | undefined,
    @Body(new ZodValidationPipe(payOnlineSchema)) body: PayOnlineInput,
  ): Promise<PlayerOnlineCharge> {
    return this.charges.paySubscriptionCharge(user.id, subscriptionId, chargeId, body, {
      requestKey,
    });
  }

  @Get('me/subscriptions/:subscriptionId/charges/:chargeId/payment')
  @ApiUuidParam('subscriptionId')
  @ApiUuidParam('chargeId')
  @ApiOperation({
    operationId: 'getMySubscriptionChargePayment',
    summary: 'Cobrança online da mensalidade',
    description:
      'Só o aluno: a aberta ou a mais recente. Sem cobrança: 404 `ONLINE_CHARGE_NOT_FOUND`.',
  })
  @ApiZodResponse(schemas.playerCharge)
  getSubscriptionChargePayment(
    @CurrentUser() user: AuthUser,
    @Param('subscriptionId', new UuidParamPipe(subscriptionChargeNotFound)) subscriptionId: string,
    @Param('chargeId', new UuidParamPipe(subscriptionChargeNotFound)) chargeId: string,
  ): Promise<PlayerOnlineCharge> {
    return this.charges.getForSubscriptionCharge(user.id, subscriptionId, chargeId);
  }

  @Get('me/payments')
  @ApiOperation({
    operationId: 'listMyPayments',
    summary: 'Meus pagamentos',
    description:
      'RF-ONPAY-06, decisão 89: cobranças online do usuário (inclusive as estornadas sozinhas), mais recentes primeiro, por cursor; `status` aceita vários. Não existe saldo.',
  })
  @ApiZodQuery(myPaymentsQuerySchema)
  @ApiZodResponse(schemas.myPaymentPage)
  listMyPayments(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(myPaymentsQuerySchema)) query: MyPaymentsQuery,
  ): Promise<MyPaymentPage> {
    return this.myPayments.list(user.id, query);
  }

  @Get('me/payments/:chargeId')
  @ApiUuidParam('chargeId')
  @ApiOperation({
    operationId: 'getMyPayment',
    summary: 'Pagamento (comprovante)',
    description:
      'RF-ONPAY-06: transação, forma, estornos (com o motivo; os automáticos com `reasonCode`) e, se pendente, o Pix.',
  })
  @ApiZodResponse(schemas.myPayment)
  getMyPayment(
    @CurrentUser() user: AuthUser,
    @Param('chargeId', new UuidParamPipe(onlineChargeNotFound)) chargeId: string,
  ): Promise<MyPaymentDetail> {
    return this.myPayments.get(user.id, chargeId);
  }
}
