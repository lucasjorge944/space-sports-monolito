import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type SimulatorChargeList,
  type SimulatorChargesQuery,
  type SimulatorDisputeResultInput,
  type SimulatorRejectInput,
  type SimulatorResult,
  type SimulatorSettleInput,
  simulatorChargesQuerySchema,
  simulatorDisputeResultSchema,
  simulatorRejectSchema,
  simulatorSettleSchema,
} from '@space-sports/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { AuthUser } from '../../../auth/auth-context.js';
import { ApiAuth, CurrentUser, SuperOnly } from '../../../auth/decorators.js';
import { UuidParamPipe } from '../../../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import type { Database } from '../../../db/client.js';
import { merchantAccounts, onlineCharges, spaces } from '../../../db/schema/index.js';
import { DB } from '../../../infra/database.module.js';
import {
  ApiUuidParam,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
} from '../../../openapi/zod-openapi.js';
import { spaceNotFound } from '../../../spaces/spaces.errors.js';
import { superAudit } from '../../../super/super-audit.js';
import { PAYMENT_GATEWAY, paymentEnvironmentOf } from '../../gateway/gateway.registry.js';
import { loadStaffCharges } from '../../online-queries.js';
import { merchantAccountNotFound, onlineChargeNotFound } from '../../payments.errors.js';
import { paymentSchemas as schemas } from '../../payments.openapi.js';
import { FakePaymentGateway } from './fake-gateway.js';

const chargeId = () => Param('chargeId', new UuidParamPipe(onlineChargeNotFound));
const WARNING = 'Só existe com o gateway fake (`PAYMENTS_PROVIDER=fake`), nunca em produção.';

/**
 * Simulador de pagamentos (RF-ONPAY-12, decisão 92): só registrado com `PAYMENTS_PROVIDER=fake`
 * (sem ele, as rotas não existem: 404). Faz no gateway simulado o que o banco, o emissor ou o
 * parceiro fariam; a API fica sabendo pelos webhooks, como num gateway real. Tudo auditado
 * (`super.payment_simulator.*`).
 */
@ApiTags('super-payment-simulator')
@ApiAuth()
@SuperOnly()
@Controller('super/online-payments/simulator')
export class FakeSimulatorController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: FakePaymentGateway,
  ) {}

  @Get('charges')
  @ApiOperation({
    operationId: 'simulatorListCharges',
    summary: 'Cobranças para simular (pendentes por padrão)',
    description: WARNING,
  })
  @ApiZodQuery(simulatorChargesQuerySchema)
  @ApiZodResponse(schemas.simulatorCharges)
  async charges(
    @Query(new ZodValidationPipe(simulatorChargesQuerySchema)) query: SimulatorChargesQuery,
  ): Promise<SimulatorChargeList> {
    const where = and(
      eq(onlineCharges.status, query.status ?? 'PENDING'),
      query.spaceId ? eq(onlineCharges.spaceId, query.spaceId) : undefined,
    );
    const [charges, names] = await Promise.all([
      loadStaffCharges(this.db, where, paymentEnvironmentOf(this.gateway), {
        limit: query.limit,
        order: [desc(onlineCharges.createdAt)],
      }),
      this.db.select({ id: spaces.id, name: spaces.name }).from(spaces),
    ]);
    const nameOf = new Map(names.map((s) => [s.id, s.name]));
    return {
      items: charges.map(({ refunds: _refunds, ...charge }) => ({
        ...charge,
        spaceName: nameOf.get(charge.spaceId) ?? '',
      })),
    };
  }

  @Post('charges/:chargeId/pay')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('chargeId')
  @ApiOperation({
    operationId: 'simulatorPayCharge',
    summary: 'Pagar um Pix',
    description: `Paga o Pix pendente (também o vencido ou cancelado, simulando o pagamento tardio, que a API estorna sozinha). ${WARNING}`,
  })
  @ApiZodResponse(schemas.simulatorResult)
  pay(@CurrentUser() user: AuthUser, @chargeId() id: string): Promise<SimulatorResult> {
    return this.run(user, id, 'pay', (providerId) => this.gateway.simulatePixPaid(providerId));
  }

  @Post('charges/:chargeId/expire')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('chargeId')
  @ApiOperation({
    operationId: 'simulatorExpireCharge',
    summary: 'Vencer a cobrança',
    description: WARNING,
  })
  @ApiZodResponse(schemas.simulatorResult)
  expire(@CurrentUser() user: AuthUser, @chargeId() id: string): Promise<SimulatorResult> {
    return this.run(user, id, 'expire', (providerId) => this.gateway.simulateExpire(providerId));
  }

  @Post('charges/:chargeId/chargeback')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('chargeId')
  @ApiOperation({
    operationId: 'simulatorChargebackCharge',
    summary: 'Gerar contestação no cartão (chargeback)',
    description: `Contesta o valor ainda não estornado de uma cobrança paga. ${WARNING}`,
  })
  @ApiZodResponse(schemas.simulatorResult)
  chargeback(@CurrentUser() user: AuthUser, @chargeId() id: string): Promise<SimulatorResult> {
    return this.run(user, id, 'chargeback', (providerId) =>
      this.gateway.simulateChargeback(providerId),
    );
  }

  @Post('charges/:chargeId/dispute-result')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('chargeId')
  @ApiOperation({
    operationId: 'simulatorResolveDispute',
    summary: 'Decidir a contestação (ganha ou perdida)',
    description: `Ganha: o valor volta ao espaço e a taxa devolvida é cobrada de novo (decisão 94). ${WARNING}`,
  })
  @ApiZodBody(schemas.simulatorDispute)
  @ApiZodResponse(schemas.simulatorResult)
  disputeResult(
    @CurrentUser() user: AuthUser,
    @chargeId() id: string,
    @Body(new ZodValidationPipe(simulatorDisputeResultSchema)) body: SimulatorDisputeResultInput,
  ): Promise<SimulatorResult> {
    return this.run(user, id, `dispute_${body.outcome.toLowerCase()}`, (providerId) =>
      this.gateway.simulateDisputeOutcome(providerId, body.outcome),
    );
  }

  @Post('merchant-accounts/:spaceId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'simulatorApproveMerchant',
    summary: 'Aprovar o cadastro',
    description: WARNING,
  })
  @ApiZodResponse(schemas.simulatorResult)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new UuidParamPipe(spaceNotFound)) spaceId: string,
  ): Promise<SimulatorResult> {
    return this.decide(user, spaceId, { approve: true });
  }

  @Post('merchant-accounts/:spaceId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'simulatorRejectMerchant',
    summary: 'Recusar o cadastro',
    description: `Recusa o cadastro em análise ou, com uma troca de conta em análise, a troca (volta a conta anterior, decisão 98). Num espaço aprovado sem troca em análise não tem efeito (\`events: 0\`). ${WARNING}`,
  })
  @ApiZodBody(schemas.simulatorReject)
  @ApiZodResponse(schemas.simulatorResult)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new UuidParamPipe(spaceNotFound)) spaceId: string,
    @Body(new ZodValidationPipe(simulatorRejectSchema)) body: SimulatorRejectInput,
  ): Promise<SimulatorResult> {
    return this.decide(user, spaceId, { approve: false, reason: body.reason });
  }

  @Post('settle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'simulatorSettle',
    summary: 'Liberar os saldos e rodar o repasse',
    description: `Libera agora o que estava a liberar (de um espaço ou de todos) e repassa o disponível. ${WARNING}`,
  })
  @ApiZodBody(schemas.simulatorSettle)
  @ApiZodResponse(schemas.simulatorResult)
  async settle(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(simulatorSettleSchema)) body: SimulatorSettleInput,
  ): Promise<SimulatorResult> {
    let accountId: string | undefined;
    if (body.spaceId) {
      accountId = (await this.account(body.spaceId)) ?? undefined;
      if (!accountId) throw merchantAccountNotFound();
    }
    const events = await this.gateway.settle(accountId);
    await superAudit(this.db, user.id, {
      action: 'super.payment_simulator.settle',
      entity: 'merchant_account',
      entityId: null,
      spaceId: body.spaceId ?? null,
      diff: { events },
    });
    return { events };
  }

  private async run(
    user: AuthUser,
    chargeId: string,
    action: string,
    fn: (providerChargeId: string) => Promise<boolean>,
  ): Promise<SimulatorResult> {
    const [charge] = await this.db
      .select({
        spaceId: onlineCharges.spaceId,
        providerChargeId: onlineCharges.providerChargeId,
        provider: onlineCharges.provider,
      })
      .from(onlineCharges)
      .where(eq(onlineCharges.id, chargeId));
    if (!charge?.providerChargeId || charge.provider !== this.gateway.provider) {
      throw onlineChargeNotFound();
    }
    const changed = await fn(charge.providerChargeId);
    await superAudit(this.db, user.id, {
      action: `super.payment_simulator.${action}`,
      entity: 'online_charge',
      entityId: chargeId,
      spaceId: charge.spaceId,
      diff: { changed },
    });
    return { events: changed ? 1 : 0 };
  }

  private async account(spaceId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: merchantAccounts.providerAccountId, provider: merchantAccounts.provider })
      .from(merchantAccounts)
      .where(eq(merchantAccounts.spaceId, spaceId));
    return row?.provider === this.gateway.provider ? row.id : null;
  }

  private async decide(
    user: AuthUser,
    spaceId: string,
    decision: { approve: boolean; reason?: string },
  ): Promise<SimulatorResult> {
    const accountId = await this.account(spaceId);
    if (!accountId) throw merchantAccountNotFound();
    const changed = await this.gateway.decideAccount(accountId, decision);
    await superAudit(this.db, user.id, {
      action: `super.payment_simulator.${decision.approve ? 'approve' : 'reject'}_merchant`,
      entity: 'merchant_account',
      entityId: null,
      spaceId,
      diff: { reason: decision.reason ?? null, changed },
    });
    return { events: changed ? 1 : 0 };
  }
}
