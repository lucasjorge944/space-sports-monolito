import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  AUTO_REFUND_REASONS,
  type AutoRefundReasonCode,
  BOOKING_PAYMENT_EXPIRED_REASON,
  BOOKING_PIX_VALIDITY_MIN,
  DEFAULT_TIME_ZONE,
  ONLINE_CHARGE_STATUS_RANK,
  type OnlineChargeStatus,
  type OnlinePaymentMethod,
  type OnlineRefundReasonCode,
  type PayOnlineInput,
  type PlayerOnlineCharge,
  proportionalFeeRefund,
  SUBSCRIPTION_PIX_VALIDITY_HOURS,
  splitCharge,
  utcToZoned,
} from '@space-sports/shared';
import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, notExists, sql } from 'drizzle-orm';
import {
  bookingDue,
  insertBookingPayment,
  isBookingPayable,
  refreshBookingPaymentStatus,
} from '../bookings/booking-payments.js';
import { bookingNotFound } from '../bookings/bookings.errors.js';
import { audit, isUniqueViolation, type Tx } from '../bookings/db-utils.js';
import {
  afterChargeChange,
  chargePaidSql,
  lockCharge,
  recordChargePayment,
  type ChargeRow as SubChargeRow,
  type SubscriptionRow,
} from '../classes/subscription-billing.js';
import { subscriptionChargeNotFound } from '../classes/subscriptions.errors.js';
import type { Database } from '../db/client.js';
import {
  bookings,
  cities,
  courtOccupations,
  courts,
  onlineCharges,
  onlineRefunds,
  paymentRecords,
  plans,
  spaceLedgerEntries,
  spaces,
  sports,
  subscriptionCharges,
  subscriptions,
  users,
} from '../db/schema/index.js';
import { type DomainEvent, DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { PAYMENT_GATEWAY, paymentEnvironmentOf } from './gateway/gateway.registry.js';
import type { GatewayCharge, GatewayRefund, PaymentGateway } from './gateway/payment-gateway.js';
import { assertSameRequest, requestHash } from './idempotency-key.js';
import { ItemLocks } from './item-locks.js';
import { addLedgerEntries } from './ledger.js';
import { type ChargeRow, type RefundRow, toPlayerCharge } from './online-views.js';
import {
  type EffectivePaymentSettings,
  PaymentSettingsService,
} from './payment-settings.service.js';
import {
  alreadyPaid,
  chargeNotRefundable,
  gatewayUnavailable,
  itemNotPayableOnline,
  onlineChargeAlreadyPaid,
  onlineChargeNotFound,
  onlinePaymentsDisabled,
  onlinePaymentUnavailable,
  paymentHoldExpired,
  refundExceedsBalance,
} from './payments.errors.js';

type BookingRow = typeof bookings.$inferSelect;
type PayableType = 'BOOKING' | 'SUBSCRIPTION_CHARGE';

/** Item pago online, travado na transação (a trava do item vem sempre antes da cobrança). */
type Item =
  | { type: 'BOOKING'; booking: BookingRow }
  | { type: 'SUBSCRIPTION_CHARGE'; sub: SubscriptionRow; charge: SubChargeRow };

/** O que fazer depois do commit: eventos, cancelamentos no gateway e estornos automáticos. */
interface Effects {
  events: DomainEvent[];
  cancelAtGateway: string[];
  autoRefunds: { chargeId: string; reasonCode: AutoRefundReasonCode }[];
}

/** Por que a cobrança aberta foi fechada sem pagamento (`online_charges.closed_reason`). */
type ClosedReason =
  | 'REPLACED'
  | 'PAID_ON_SITE'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_CHANGED'
  | 'SPACE_INACTIVE'
  | 'ACCOUNT_DELETED'
  | 'EXPIRED';

/** Pagamento que chega numa cobrança fechada: depois da troca de forma ou depois do prazo. */
const lateReasonOf = (closedReason: string | null): AutoRefundReasonCode =>
  closedReason === 'REPLACED' || closedReason === 'PAID_ON_SITE'
    ? 'PAID_AFTER_METHOD_CHANGE'
    : 'PAID_AFTER_DEADLINE';

const newEffects = (): Effects => ({ events: [], cancelAtGateway: [], autoRefunds: [] });

const rank = (status: OnlineChargeStatus) => ONLINE_CHARGE_STATUS_RANK[status];
/** Encerrada sem pagamento (`EXPIRED`, `FAILED`, `CANCELLED`). */
const isClosedUnpaid = (status: OnlineChargeStatus) => rank(status) === 1;
const MINUTE_MS = 60_000;
/** Criação sem resposta há mais que isso é conferida pela chave na reconciliação. */
const UNVERIFIED_AFTER_MS = MINUTE_MS;

/** Cobrança preparada no banco, antes da chamada ao gateway. */
interface PreparedCharge {
  charge: ChargeRow;
  providerAccountId: string;
  payer: { name: string; email: string | null };
  description: string;
}

interface PayOptions {
  /** `Idempotency-Key` do app (decisão 96). */
  requestKey?: string | undefined;
  /** Hash do pedido (item e meio), calculado na entrada: a chave com outro pedido é recusada. */
  requestHash?: string | undefined;
}

/** Hash do pedido de cobrança: o item e o meio (o token do cartão muda a cada tokenização). */
function chargeRequestHash(
  payableType: PayableType,
  payableId: string,
  input: PayOnlineInput,
  options: PayOptions,
): PayOptions {
  if (!options.requestKey) return options;
  return {
    ...options,
    requestHash: requestHash('online-charge.create', {
      payableType,
      payableId,
      method: input.method,
    }),
  };
}

/**
 * Cobranças online de reservas e mensalidades (decisões 85 a 88, 93, 94 e 96; RN-ONPAY-02 a 07):
 * criação com o snapshot da taxa, sincronização com o gateway (o status só avança), registro do
 * pagamento pelo mesmo fluxo do registro manual, estornos, chargebacks, expiração e reconciliação.
 * O gateway é a fonte da verdade: webhooks e jobs só pedem uma sincronização.
 */
@Injectable()
export class OnlineChargesService {
  private readonly logger = new Logger(OnlineChargesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    private readonly settings: PaymentSettingsService,
    private readonly events: DomainEvents,
    // Sem o pool de travas (o seed de demonstração), a trava fica numa transação do pool principal.
    @Optional() private readonly locks?: ItemLocks,
  ) {}

  private requireGateway(): PaymentGateway {
    if (!this.gateway) throw onlinePaymentsDisabled();
    return this.gateway;
  }

  private view(charge: ChargeRow): PlayerOnlineCharge {
    return toPlayerCharge(charge, paymentEnvironmentOf(this.gateway));
  }

  // -------------------------------------------------------------------------------------------
  // Criação (RF-ONPAY-03, RF-ONPAY-05, RN-ONPAY-03, decisão 96)

  /** Só o organizador paga a reserva inteira (decisão 50, RN-ONPAY-03). */
  async payBooking(
    userId: string,
    bookingId: string,
    input: PayOnlineInput,
    requestOptions: PayOptions = {},
  ): Promise<PlayerOnlineCharge> {
    const gateway = this.requireGateway();
    const options = chargeRequestHash('BOOKING', bookingId, input, requestOptions);
    const repeated = await this.byRequestKey(userId, options);
    if (repeated) return repeated;
    const [owned] = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.organizerUserId, userId)));
    if (!owned) throw bookingNotFound();
    return this.withItemLock('BOOKING', bookingId, () =>
      this.payBookingLocked(gateway, userId, bookingId, input, options),
    );
  }

  private async payBookingLocked(
    gateway: PaymentGateway,
    userId: string,
    bookingId: string,
    input: PayOnlineInput,
    options: PayOptions,
  ): Promise<PlayerOnlineCharge> {
    // Outro toque com a mesma chave pode ter terminado enquanto este esperava a trava.
    const repeated = await this.byRequestKey(userId, options);
    if (repeated) return repeated;
    // Decisão 96: a nova cobrança só nasce depois de cancelar a anterior no gateway; se ela já
    // foi paga, vale a paga.
    const paid = await this.settlePending('BOOKING', bookingId, 'REPLACED');
    if (paid) return this.view(paid);

    const prepared = await this.inTx(userId, options, async (tx) => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, bookingId), eq(bookings.organizerUserId, userId)))
        .for('update');
      if (!booking) throw bookingNotFound();
      const now = new Date();
      const settings = await this.settings.effective(booking.spaceId, tx);
      if (booking.status === 'PENDING_PAYMENT') {
        if (!booking.paymentDueAt || booking.paymentDueAt <= now) throw paymentHoldExpired();
        if (!settings.onlineReady) throw onlinePaymentUnavailable();
      } else {
        // Modo opcional: até o início, só reservas do app (balcão e mensalista pagam no local).
        if (booking.status !== 'CONFIRMED' || booking.source !== 'APP') {
          throw itemNotPayableOnline(booking.status);
        }
        if (booking.startsAt <= now) throw itemNotPayableOnline('STARTED');
        if (settings.effectiveBookingMode === 'ON_SITE') throw onlinePaymentUnavailable();
      }
      const due = await bookingDue(tx, booking);
      if (due <= 0) throw alreadyPaid();
      const expiresAt =
        booking.status === 'PENDING_PAYMENT'
          ? booking.paymentDueAt
          : input.method === 'PIX'
            ? new Date(
                Math.min(
                  booking.startsAt.getTime(),
                  now.getTime() + BOOKING_PIX_VALIDITY_MIN * MINUTE_MS,
                ),
              )
            : null;
      return this.prepare(tx, {
        spaceId: booking.spaceId,
        payableType: 'BOOKING',
        payableId: booking.id,
        payerUserId: userId,
        method: input.method,
        serviceAmountCents: due,
        expiresAt,
        description: await this.bookingDescription(tx, booking.id),
        settings,
        requestKey: options.requestKey,
        requestHash: options.requestHash,
      });
    });
    if ('repeated' in prepared) return prepared.repeated;
    return this.dispatch(gateway, prepared, input);
  }

  /** Só o aluno paga a própria mensalidade em aberto (RF-ONPAY-05); o Pix vale 24 h. */
  async paySubscriptionCharge(
    userId: string,
    subscriptionId: string,
    chargeId: string,
    input: PayOnlineInput,
    requestOptions: PayOptions = {},
  ): Promise<PlayerOnlineCharge> {
    const gateway = this.requireGateway();
    const options = chargeRequestHash('SUBSCRIPTION_CHARGE', chargeId, input, requestOptions);
    const repeated = await this.byRequestKey(userId, options);
    if (repeated) return repeated;
    const [ref] = await this.db
      .select({ spaceId: subscriptions.spaceId })
      .from(subscriptions)
      .innerJoin(subscriptionCharges, eq(subscriptionCharges.subscriptionId, subscriptions.id))
      .where(
        and(
          eq(subscriptions.id, subscriptionId),
          eq(subscriptions.userId, userId),
          eq(subscriptionCharges.id, chargeId),
        ),
      );
    if (!ref) throw subscriptionChargeNotFound();
    return this.withItemLock('SUBSCRIPTION_CHARGE', chargeId, async () => {
      const again = await this.byRequestKey(userId, options);
      if (again) return again;
      const paid = await this.settlePending('SUBSCRIPTION_CHARGE', chargeId, 'REPLACED');
      if (paid) return this.view(paid);
      return this.paySubscriptionChargeLocked(
        gateway,
        userId,
        ref.spaceId,
        chargeId,
        input,
        options,
      );
    });
  }

  private async paySubscriptionChargeLocked(
    gateway: PaymentGateway,
    userId: string,
    spaceId: string,
    chargeId: string,
    input: PayOnlineInput,
    options: PayOptions,
  ): Promise<PlayerOnlineCharge> {
    const ref = { spaceId };
    const prepared = await this.inTx(userId, options, async (tx) => {
      const locked = await lockCharge(tx, ref.spaceId, chargeId);
      if (!locked) throw subscriptionChargeNotFound();
      const { charge } = locked;
      if (charge.status === 'WAIVED') throw itemNotPayableOnline(charge.status);
      const settings = await this.settings.effective(ref.spaceId, tx);
      if (settings.effectiveClassMode === 'ON_SITE') throw onlinePaymentUnavailable();
      const due = await this.subscriptionDue(tx, charge);
      if (due <= 0) throw alreadyPaid();
      const [plan] = await tx
        .select({ name: plans.name })
        .from(plans)
        .where(eq(plans.id, locked.sub.planId));
      return this.prepare(tx, {
        spaceId: ref.spaceId,
        payableType: 'SUBSCRIPTION_CHARGE',
        payableId: charge.id,
        payerUserId: userId,
        method: input.method,
        serviceAmountCents: due,
        expiresAt:
          input.method === 'PIX'
            ? new Date(Date.now() + SUBSCRIPTION_PIX_VALIDITY_HOURS * 60 * MINUTE_MS)
            : null,
        description: `Mensalidade ${charge.periodStart.slice(5, 7)}/${charge.periodStart.slice(0, 4)} · ${plan?.name ?? 'Aulas'}`,
        settings,
        requestKey: options.requestKey,
        requestHash: options.requestHash,
      });
    });
    if ('repeated' in prepared) return prepared.repeated;
    return this.dispatch(gateway, prepared, input);
  }

  /** Última cobrança da reserva para o organizador (a pendente, se houver). */
  async getForBooking(userId: string, bookingId: string): Promise<PlayerOnlineCharge> {
    const [booking] = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.organizerUserId, userId)));
    if (!booking) throw bookingNotFound();
    return this.latestFor('BOOKING', bookingId);
  }

  async getForSubscriptionCharge(
    userId: string,
    subscriptionId: string,
    chargeId: string,
  ): Promise<PlayerOnlineCharge> {
    const [charge] = await this.db
      .select({ id: subscriptionCharges.id })
      .from(subscriptionCharges)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
      .where(
        and(
          eq(subscriptionCharges.id, chargeId),
          eq(subscriptions.id, subscriptionId),
          eq(subscriptions.userId, userId),
        ),
      );
    if (!charge) throw subscriptionChargeNotFound();
    return this.latestFor('SUBSCRIPTION_CHARGE', chargeId);
  }

  /** A cobrança mais relevante do item: a pendente ou, sem ela, a mais recente. */
  async latestRow(payableType: PayableType, payableId: string): Promise<ChargeRow | undefined> {
    const [charge] = await this.db
      .select()
      .from(onlineCharges)
      .where(
        and(eq(onlineCharges.payableType, payableType), eq(onlineCharges.payableId, payableId)),
      )
      .orderBy(sql`${onlineCharges.status} = 'PENDING' DESC`, desc(onlineCharges.createdAt))
      .limit(1);
    return charge;
  }

  private async latestFor(
    payableType: PayableType,
    payableId: string,
  ): Promise<PlayerOnlineCharge> {
    const charge = await this.latestRow(payableType, payableId);
    if (!charge) throw onlineChargeNotFound();
    return this.view(charge);
  }

  /**
   * A cobrança já criada com esta `Idempotency-Key` (do mesmo pagador); a chave usada num pedido
   * diferente (outro item ou outro meio) responde 422 `IDEMPOTENCY_KEY_REUSED`.
   */
  private async byRequestKey(
    userId: string,
    options: PayOptions,
  ): Promise<PlayerOnlineCharge | null> {
    if (!options.requestKey) return null;
    const [charge] = await this.db
      .select()
      .from(onlineCharges)
      .where(
        and(
          eq(onlineCharges.payerUserId, userId),
          eq(onlineCharges.requestKey, options.requestKey),
        ),
      );
    if (!charge) return null;
    assertSameRequest(charge.requestHash, options.requestHash);
    return this.view(charge);
  }

  /** Transação da criação; a mesma `Idempotency-Key` em paralelo devolve a cobrança da outra. */
  private async inTx(
    userId: string,
    options: PayOptions,
    fn: (tx: Tx) => Promise<PreparedCharge>,
  ): Promise<PreparedCharge | { repeated: PlayerOnlineCharge }> {
    try {
      return await this.db.transaction(fn);
    } catch (err) {
      if (options.requestKey && isUniqueViolation(err, 'online_charges_payer_request_key_unique')) {
        const repeated = await this.byRequestKey(userId, options);
        if (repeated) return { repeated };
      }
      throw err;
    }
  }

  /**
   * Uma criação (ou troca, ou registro no local) por item de cada vez: a trava dura a chamada ao
   * gateway. Assim uma cobrança ainda em criação nunca é cancelada só aqui, e dois toques não geram
   * duas cobranças no cartão (`ItemLocks`).
   */
  private async withItemLock<T>(
    payableType: PayableType,
    payableId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = `online-charge:${payableType}:${payableId}`;
    if (this.locks) return this.locks.run(key, fn);
    return this.db.transaction(async (lockTx) => {
      await lockTx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
      return fn();
    });
  }

  private async subscriptionDue(tx: Tx, charge: SubChargeRow): Promise<number> {
    const [paid] = await tx
      .select({ cents: chargePaidSql })
      .from(subscriptionCharges)
      .where(eq(subscriptionCharges.id, charge.id));
    return Math.max(charge.amountCents - charge.discountCents - (paid?.cents ?? 0), 0);
  }

  /**
   * Cancela no gateway a cobrança aberta do item e sincroniza (decisão 96). Devolve a cobrança se
   * ela já tinha sido paga (então vale a paga).
   */
  private async settlePending(
    payableType: PayableType,
    payableId: string,
    closedReason: ClosedReason,
    spaceId?: string,
  ): Promise<ChargeRow | null> {
    const gateway = this.gateway;
    if (!gateway) return null;
    const pending = await this.db
      .select()
      .from(onlineCharges)
      .where(
        and(
          spaceId ? eq(onlineCharges.spaceId, spaceId) : undefined,
          eq(onlineCharges.payableType, payableType),
          eq(onlineCharges.payableId, payableId),
          eq(onlineCharges.status, 'PENDING'),
        ),
      );
    let paid: ChargeRow | null = null;
    for (const charge of pending) {
      // Cobrança de outro provedor não é cancelada por este gateway (a reconciliação dela segue).
      if (charge.provider !== gateway.provider) continue;
      let snapshot: GatewayCharge;
      try {
        if (charge.providerChargeId) {
          snapshot = await gateway.cancelCharge(charge.providerChargeId);
        } else {
          // Criação de resultado desconhecido (nunca uma em andamento: quem chama tem a trava do
          // item). Se o gateway a conhece, vale o que ele tem; se não, ela nunca existiu lá.
          const found = await gateway.findChargeByIdempotencyKey(charge.idempotencyKey);
          if (!found) {
            await this.markUnknownAsFailed(charge.id);
            continue;
          }
          snapshot =
            found.status === 'PENDING' ? await gateway.cancelCharge(found.providerChargeId) : found;
        }
      } catch (err) {
        this.logger.error({ err, chargeId: charge.id }, 'Falha ao cancelar a cobrança anterior');
        throw gatewayUnavailable();
      }
      if (snapshot.status !== 'PAID') await this.markClosedReason(charge.id, closedReason);
      await this.sync(charge.id, snapshot);
      const [after] = await this.db
        .select()
        .from(onlineCharges)
        .where(eq(onlineCharges.id, charge.id));
      if (after && after.status === 'PAID') paid = after;
    }
    return paid;
  }

  /**
   * Registro manual no local (decisão 96): cancela antes a cobrança online aberta do item; se ela
   * já tinha sido paga, recusa com 409.
   */
  async beforeManualPayment(
    spaceId: string,
    payableType: PayableType,
    payableId: string,
  ): Promise<void> {
    await this.withItemLock(payableType, payableId, () =>
      this.beforeManualPaymentLocked(spaceId, payableType, payableId),
    );
  }

  private async beforeManualPaymentLocked(
    spaceId: string,
    payableType: PayableType,
    payableId: string,
  ): Promise<void> {
    const paid = await this.settlePending(payableType, payableId, 'PAID_ON_SITE', spaceId);
    if (paid) throw onlineChargeAlreadyPaid();
    // Cobrança que nunca chegou ao gateway: só fecha aqui.
    await this.db
      .update(onlineCharges)
      .set({ status: 'CANCELLED', closedReason: 'PAID_ON_SITE' })
      .where(
        and(
          eq(onlineCharges.spaceId, spaceId),
          eq(onlineCharges.payableType, payableType),
          eq(onlineCharges.payableId, payableId),
          eq(onlineCharges.status, 'PENDING'),
          isNull(onlineCharges.providerChargeId),
        ),
      );
  }

  /** Criação que o gateway não conhece: nada foi cobrado, a cobrança local vira `FAILED`. */
  private async markUnknownAsFailed(chargeId: string): Promise<void> {
    await this.db
      .update(onlineCharges)
      .set({ status: 'FAILED', failureReason: 'GATEWAY_ERROR' })
      .where(
        and(
          eq(onlineCharges.id, chargeId),
          eq(onlineCharges.status, 'PENDING'),
          isNull(onlineCharges.providerChargeId),
        ),
      );
  }

  /** Grava o motivo do fechamento (antes da sincronização que muda o status). */
  private async markClosedReason(chargeId: string, reason: ClosedReason): Promise<void> {
    await this.db
      .update(onlineCharges)
      .set({ closedReason: reason })
      .where(and(eq(onlineCharges.id, chargeId), isNull(onlineCharges.closedReason)));
  }

  /**
   * Na transação do item: fecha a cobrança aberta que sobrou (RN-ONPAY-03), calcula o split com
   * a taxa vigente (snapshot, RN-ONPAY-01) e grava a nova cobrança `PENDING`, ainda sem o gateway.
   */
  private async prepare(
    tx: Tx,
    input: {
      spaceId: string;
      payableType: PayableType;
      payableId: string;
      payerUserId: string;
      method: OnlinePaymentMethod;
      serviceAmountCents: number;
      expiresAt: Date | null;
      description: string;
      settings: EffectivePaymentSettings;
      requestKey: string | undefined;
      requestHash: string | undefined;
    },
  ): Promise<PreparedCharge> {
    const gateway = this.requireGateway();
    if (!input.settings.providerAccountId) throw onlinePaymentUnavailable();
    const previous = await tx
      .update(onlineCharges)
      .set({ status: 'CANCELLED', closedReason: 'REPLACED' })
      .where(
        and(
          eq(onlineCharges.payableType, input.payableType),
          eq(onlineCharges.payableId, input.payableId),
          eq(onlineCharges.status, 'PENDING'),
        ),
      )
      .returning({ id: onlineCharges.id, providerChargeId: onlineCharges.providerChargeId });
    // Uma pendente com id no gateway aqui é uma corrida com outra tentativa: a reconciliação a
    // cancela lá (status local já é `CANCELLED`).
    const split = splitCharge(input.serviceAmountCents, input.method, input.settings.fee);
    const [charge] = await tx
      .insert(onlineCharges)
      .values({
        spaceId: input.spaceId,
        payableType: input.payableType,
        payableId: input.payableId,
        payerUserId: input.payerUserId,
        provider: gateway.provider,
        method: input.method,
        status: 'PENDING',
        amountCents: split.amountCents,
        serviceAmountCents: split.serviceAmountCents,
        platformFeeCents: split.platformFeeCents,
        spaceNetCents: split.spaceNetCents,
        feePayer: split.feePayer,
        feeBps: split.feeBps,
        minFeeCents: split.minFeeCents,
        expiresAt: input.expiresAt,
        idempotencyKey: randomUUID(),
        requestKey: input.requestKey ?? null,
        requestHash: input.requestHash ?? null,
      })
      .returning();
    if (!charge) throw new Error('Insert de cobrança sem retorno.');
    await audit(tx, {
      actorId: input.payerUserId,
      spaceId: input.spaceId,
      action: 'payment.online.create',
      entity: 'online_charge',
      entityId: charge.id,
      diff: {
        payableType: input.payableType,
        payableId: input.payableId,
        method: input.method,
        amountCents: split.amountCents,
        platformFeeCents: split.platformFeeCents,
        feeBps: split.feeBps,
        minFeeCents: split.minFeeCents,
        feePayer: split.feePayer,
        cancelled: previous.map((p) => p.id),
      },
    });
    const [payer] = await tx
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, input.payerUserId));
    return {
      charge,
      providerAccountId: input.settings.providerAccountId,
      payer: { name: payer?.name ?? '', email: payer?.email ?? null },
      description: input.description,
    };
  }

  /** Chama o gateway (fora da transação) e aplica a resposta como uma sincronização. */
  private async dispatch(
    gateway: PaymentGateway,
    prepared: PreparedCharge,
    input: PayOnlineInput,
  ): Promise<PlayerOnlineCharge> {
    const { charge } = prepared;
    const base = {
      idempotencyKey: charge.idempotencyKey,
      amountCents: charge.amountCents,
      split: {
        providerAccountId: prepared.providerAccountId,
        platformFeeCents: charge.platformFeeCents,
      },
      description: prepared.description,
      payer: prepared.payer,
    };
    let snapshot: GatewayCharge;
    try {
      snapshot =
        input.method === 'PIX'
          ? await gateway.createPixCharge({ ...base, expiresAt: charge.expiresAt ?? new Date() })
          : await gateway.createCardCharge({ ...base, cardToken: input.cardToken ?? '' });
    } catch (err) {
      // Resultado desconhecido (timeout, conexão caída): o gateway pode ter criado a cobrança, e no
      // cartão pode até ter cobrado. Confere pela chave antes de qualquer conclusão.
      this.logger.error({ err, chargeId: charge.id }, 'Falha ao criar a cobrança no gateway');
      let found: GatewayCharge | null | undefined;
      try {
        found = await gateway.findChargeByIdempotencyKey(charge.idempotencyKey);
      } catch (lookupErr) {
        this.logger.error(
          { err: lookupErr, chargeId: charge.id },
          'Cobrança pendente de verificação',
        );
      }
      if (found === null) {
        await this.markUnknownAsFailed(charge.id);
        throw gatewayUnavailable();
      }
      if (found === undefined) {
        // Fica PENDING sem id do gateway (pendente de verificação): a reconciliação e a próxima
        // tentativa resolvem pela chave.
        throw gatewayUnavailable({ chargeId: charge.id, verification: 'PENDING' });
      }
      snapshot = found;
    }
    await this.sync(charge.id, snapshot);
    const [current] = await this.db
      .select()
      .from(onlineCharges)
      .where(eq(onlineCharges.id, charge.id));
    if (!current) throw onlineChargeNotFound();
    return this.view(current);
  }

  private async bookingDescription(tx: Tx, bookingId: string): Promise<string> {
    const [row] = await tx
      .select({ space: spaces.name, court: courts.name, sport: sports.name })
      .from(bookings)
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .innerJoin(courts, eq(courts.id, bookings.courtId))
      .innerJoin(sports, eq(sports.id, bookings.sportId))
      .where(eq(bookings.id, bookingId));
    return row ? `Reserva ${row.court} · ${row.sport} · ${row.space}` : 'Reserva';
  }

  // -------------------------------------------------------------------------------------------
  // Sincronização com o gateway (RN-ONPAY-07)

  /** Busca o retrato da cobrança no gateway (ou usa o recebido) e aplica o que mudou. */
  async sync(chargeId: string, snapshot?: GatewayCharge): Promise<void> {
    const gateway = this.gateway;
    const [row] = await this.db.select().from(onlineCharges).where(eq(onlineCharges.id, chargeId));
    if (!gateway || !row || row.provider !== gateway.provider) return;
    const providerChargeId = snapshot?.providerChargeId ?? row.providerChargeId;
    if (!providerChargeId) return;
    const snap = snapshot ?? (await gateway.getCharge(providerChargeId));
    const effects = newEffects();
    await this.db.transaction(async (tx) => {
      const item = await this.lockItem(tx, row);
      const charge = await this.lockCharge(tx, row.id);
      await this.applySnapshot(tx, charge, snap, item, effects);
    });
    await this.flush(effects);
  }

  /** Sincroniza pela id do gateway (webhook). Sem cobrança local, devolve falso. */
  async syncByProviderId(provider: string, providerChargeId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: onlineCharges.id })
      .from(onlineCharges)
      .where(
        and(
          eq(onlineCharges.provider, provider),
          eq(onlineCharges.providerChargeId, providerChargeId),
        ),
      );
    if (!row) return false;
    await this.sync(row.id);
    return true;
  }

  private async lockItem(
    tx: Tx,
    charge: Pick<ChargeRow, 'spaceId' | 'payableType' | 'payableId'>,
  ): Promise<Item | null> {
    if (charge.payableType === 'BOOKING') {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, charge.payableId))
        .for('update');
      return booking ? { type: 'BOOKING', booking } : null;
    }
    const locked = await lockCharge(tx, charge.spaceId, charge.payableId);
    return locked ? { type: 'SUBSCRIPTION_CHARGE', ...locked } : null;
  }

  private async lockCharge(tx: Tx, chargeId: string): Promise<ChargeRow> {
    const [charge] = await tx
      .select()
      .from(onlineCharges)
      .where(eq(onlineCharges.id, chargeId))
      .for('update');
    if (!charge) throw onlineChargeNotFound();
    return charge;
  }

  private async applySnapshot(
    tx: Tx,
    charge: ChargeRow,
    snap: GatewayCharge,
    item: Item | null,
    effects: Effects,
  ): Promise<void> {
    const patch: Partial<typeof onlineCharges.$inferInsert> = {
      gatewayCostCents: snap.gatewayCostCents,
    };
    if (!charge.providerChargeId) patch.providerChargeId = snap.providerChargeId;
    if (snap.pix) {
      patch.pixCopyPaste = snap.pix.copyPaste;
      patch.pixQrSvg = snap.pix.qrSvg;
      patch.expiresAt = snap.pix.expiresAt;
    }
    if (snap.card) {
      patch.cardBrand = snap.card.brand;
      patch.cardLast4 = snap.card.last4;
    }
    let current = { ...charge, ...patch } as ChargeRow;

    if (snap.status === 'PAID' && !current.paidAt) {
      await tx.update(onlineCharges).set(patch).where(eq(onlineCharges.id, charge.id));
      current = await this.applyPaid(tx, current, snap, item, effects);
    } else {
      if (
        (snap.status === 'FAILED' || snap.status === 'EXPIRED' || snap.status === 'CANCELLED') &&
        current.status === 'PENDING'
      ) {
        patch.status = snap.status;
        patch.failureReason = snap.failureReason;
        if (snap.status === 'EXPIRED' && !current.closedReason) patch.closedReason = 'EXPIRED';
        current = { ...current, ...patch } as ChargeRow;
        if (snap.status === 'EXPIRED') {
          effects.events.push({ type: 'online_payment.expired', chargeId: charge.id });
        }
        await audit(tx, {
          actorId: null,
          spaceId: charge.spaceId,
          action: `payment.online.${snap.status.toLowerCase()}`,
          entity: 'online_charge',
          entityId: charge.id,
          diff: { failureReason: snap.failureReason },
        });
      } else if (snap.status === 'PENDING' && isClosedUnpaid(current.status)) {
        // Fechada aqui enquanto o gateway ainda a tinha aberta: cancela lá também.
        effects.cancelAtGateway.push(snap.providerChargeId);
      }
      await tx.update(onlineCharges).set(patch).where(eq(onlineCharges.id, charge.id));
    }

    if (!current.paidAt) return;
    for (const refund of snap.refunds) {
      if (refund.status !== 'SUCCEEDED') continue;
      current = await this.applyGatewayRefund(tx, current, refund, item, effects);
    }
    // Liberação do saldo pelo gateway (D+1/D+30 no fake, "liquidar" no simulador): a venda, a taxa
    // e os estornos que esperavam a venda liberar andam juntos.
    if (snap.availableAt) {
      const [sale] = await tx
        .select({ availableAt: spaceLedgerEntries.availableAt })
        .from(spaceLedgerEntries)
        .where(
          and(
            eq(spaceLedgerEntries.chargeId, charge.id),
            eq(spaceLedgerEntries.kind, 'SALE'),
            isNull(spaceLedgerEntries.refundId),
          ),
        );
      if (sale && sale.availableAt.getTime() !== snap.availableAt.getTime()) {
        await tx
          .update(spaceLedgerEntries)
          .set({ availableAt: snap.availableAt })
          .where(
            and(
              eq(spaceLedgerEntries.chargeId, charge.id),
              eq(spaceLedgerEntries.availableAt, sale.availableAt),
            ),
          );
      }
    }
  }

  /**
   * Pagamento confirmado no gateway (RN-ONPAY-04): venda e taxa no livro-razão e o `payment_record`
   * online pelo mesmo fluxo do registro manual. Decisão 96: em cobrança já fechada
   * (`CANCELLED`/`EXPIRED`), depois do prazo da reserva ou para item cancelado ou quitado, o
   * dinheiro entrou e é estornado (o status da cobrança fechada não volta a `PAID`).
   */
  private async applyPaid(
    tx: Tx,
    charge: ChargeRow,
    snap: GatewayCharge,
    item: Item | null,
    effects: Effects,
  ): Promise<ChargeRow> {
    const paidAt = snap.paidAt ?? new Date();
    const availableAt = snap.availableAt ?? paidAt;
    const closed = isClosedUnpaid(charge.status);
    const [updated] = await tx
      .update(onlineCharges)
      .set(closed ? { paidAt } : { status: 'PAID', paidAt, failureReason: null })
      .where(eq(onlineCharges.id, charge.id))
      .returning();
    if (!updated) throw onlineChargeNotFound();
    await addLedgerEntries(tx, [
      {
        spaceId: charge.spaceId,
        chargeId: charge.id,
        kind: 'SALE',
        amountCents: charge.serviceAmountCents,
        availableAt,
      },
      {
        spaceId: charge.spaceId,
        chargeId: charge.id,
        kind: 'PLATFORM_FEE',
        amountCents: charge.feePayer === 'SPACE' ? -charge.platformFeeCents : 0,
        availableAt,
      },
    ]);

    const credit = closed
      ? lateReasonOf(charge.closedReason)
      : await this.creditItem(tx, updated, item, paidAt);
    const credited = credit === true;
    if (credit === true) {
      effects.events.push({ type: 'online_payment.paid', chargeId: charge.id });
    } else {
      effects.autoRefunds.push({ chargeId: charge.id, reasonCode: credit });
    }
    await audit(tx, {
      actorId: null,
      spaceId: charge.spaceId,
      action: credited ? 'payment.online.paid' : 'payment.online.late_payment',
      entity: 'online_charge',
      entityId: charge.id,
      diff: {
        payableType: charge.payableType,
        payableId: charge.payableId,
        status: updated.status,
        amountCents: charge.amountCents,
        platformFeeCents: charge.platformFeeCents,
        gatewayCostCents: snap.gatewayCostCents,
        paidAt: paidAt.toISOString(),
      },
    });
    return updated;
  }

  /**
   * Registra o pagamento no item, se ele ainda aceita; senão, devolve o motivo do estorno
   * automático.
   */
  private async creditItem(
    tx: Tx,
    charge: ChargeRow,
    item: Item | null,
    paidAt: Date,
  ): Promise<true | AutoRefundReasonCode> {
    if (!item) return 'PAID_AFTER_DEADLINE';
    if (item.type === 'BOOKING') {
      let { booking } = item;
      if (booking.status === 'PENDING_PAYMENT') {
        // Pix ou cartão confirmados depois do prazo seguem a regra do pagamento tardio.
        if (!booking.paymentDueAt || paidAt > booking.paymentDueAt) return 'PAID_AFTER_DEADLINE';
        const [confirmed] = await tx
          .update(bookings)
          .set({ status: 'CONFIRMED', paymentDueAt: null })
          .where(eq(bookings.id, booking.id))
          .returning();
        if (!confirmed) return 'PAID_AFTER_DEADLINE';
        await audit(tx, {
          actorId: null,
          spaceId: booking.spaceId,
          action: 'booking.payment_confirmed',
          entity: 'booking',
          entityId: booking.id,
          diff: { from: 'PENDING_PAYMENT', to: 'CONFIRMED', chargeId: charge.id },
        });
        booking = confirmed;
        item.booking = confirmed;
      }
      if (!isBookingPayable(booking.status)) return 'PAID_AFTER_DEADLINE';
      if ((await bookingDue(tx, booking)) < charge.serviceAmountCents) return 'ITEM_ALREADY_PAID';
      await insertBookingPayment(tx, charge.spaceId, booking, {
        amountCents: charge.serviceAmountCents,
        method: charge.method,
        paidAt,
        note: null,
        recordedBy: null,
        channel: 'ONLINE',
        onlineChargeId: charge.id,
      });
      return true;
    }
    if (item.charge.status === 'WAIVED') return 'ITEM_ALREADY_PAID';
    if ((await this.subscriptionDue(tx, item.charge)) < charge.serviceAmountCents) {
      return 'ITEM_ALREADY_PAID';
    }
    await recordChargePayment(
      tx,
      charge.spaceId,
      null,
      {
        payableType: 'SUBSCRIPTION_CHARGE',
        payableId: item.charge.id,
        amountCents: charge.serviceAmountCents,
        method: charge.method,
        paidAt,
      },
      { chargeId: charge.id },
    );
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Estornos e chargebacks (RN-ONPAY-05, RN-ONPAY-06, decisões 93 e 94)

  /**
   * Estorno pela gestão (manual) ou automático. Sem valor, estorna tudo o que resta. A chamada ao
   * gateway acontece com o item e a cobrança travados: dois estornos simultâneos não passam do
   * saldo. `chargeAgain` falso (padrão da decisão 93) faz do valor manual um abatimento do item.
   */
  async refund(
    chargeId: string,
    opts: {
      spaceId?: string;
      amountCents?: number;
      reason: string | null;
      reasonCode: OnlineRefundReasonCode;
      requestedBy: string | null;
      chargeAgain?: boolean;
    },
  ): Promise<RefundRow> {
    this.requireGateway();
    const [row] = await this.db
      .select()
      .from(onlineCharges)
      .where(
        and(
          eq(onlineCharges.id, chargeId),
          opts.spaceId ? eq(onlineCharges.spaceId, opts.spaceId) : undefined,
        ),
      );
    if (!row) throw onlineChargeNotFound();
    const effects = newEffects();
    const refund = await this.db.transaction(async (tx) => {
      const item = await this.lockItem(tx, row);
      const charge = await this.lockCharge(tx, row.id);
      return this.refundLocked(
        tx,
        charge,
        item,
        {
          ...opts,
          actorId: opts.requestedBy,
          chargeAgain: opts.chargeAgain ?? false,
        },
        effects,
      );
    });
    await this.flush(effects);
    return refund;
  }

  private async refundLocked(
    tx: Tx,
    charge: ChargeRow,
    item: Item | null,
    opts: {
      amountCents?: number;
      reason: string | null;
      reasonCode: OnlineRefundReasonCode;
      requestedBy: string | null;
      actorId: string | null;
      chargeAgain: boolean;
    },
    effects: Effects,
  ): Promise<RefundRow> {
    const manual = opts.reasonCode === 'MANUAL';
    const refundable = await this.refundableCents(tx, charge, !manual);
    if (refundable === null) throw chargeNotRefundable(charge.status);
    const amount = opts.amountCents ?? refundable;
    if (amount <= 0 || amount > refundable) throw refundExceedsBalance(refundable);
    // A taxa devolvida conta também os estornos ainda pendentes (regra acumulada, decisão 94).
    const pendingTotals = await this.pendingRefundTotals(tx, charge.id);
    const feeRefund = proportionalFeeRefund(
      {
        amountCents: charge.amountCents,
        platformFeeCents: charge.platformFeeCents,
        refundedCents: charge.refundedCents + pendingTotals.amount,
        feeRefundedCents: charge.feeRefundedCents + pendingTotals.fee,
      },
      amount,
    );
    // Só o estorno manual vira abatimento (decisão 93); o automático devolve sem mexer no item.
    const discount = manual && !opts.chargeAgain;
    const [pending] = await tx
      .insert(onlineRefunds)
      .values({
        chargeId: charge.id,
        spaceId: charge.spaceId,
        kind: 'REFUND',
        status: 'PENDING',
        amountCents: amount,
        feeRefundCents: feeRefund,
        reason: opts.reason,
        reasonCode: opts.reasonCode,
        chargeAgain: manual && opts.chargeAgain,
        requestedBy: opts.requestedBy,
        itemDiscountCents: discount ? this.serviceShare(charge, amount, feeRefund) : 0,
      })
      .returning();
    if (!pending) throw new Error('Insert de estorno sem retorno.');
    const auditRefund = (refund: RefundRow, extra: Record<string, unknown> = {}) =>
      audit(tx, {
        actorId: opts.actorId,
        spaceId: charge.spaceId,
        action: manual ? 'payment.online.refund' : 'payment.online.auto_refund',
        entity: 'online_refund',
        entityId: refund.id,
        diff: {
          chargeId: charge.id,
          reasonCode: opts.reasonCode,
          chargeAgain: refund.chargeAgain,
          amountCents: amount,
          feeRefundCents: feeRefund,
          itemDiscountCents: refund.itemDiscountCents,
          reason: opts.reason,
          status: refund.status,
          ...extra,
        },
      });

    // O estorno vai pelo provedor gravado na cobrança. Sem ele agora (gateway desligado ou outro
    // provedor), o manual é recusado; o automático fica PENDING para a reconciliação, sem derrubar
    // o cancelamento ou a exclusão que o pediu.
    const gateway = this.gatewayFor(charge);
    if (!gateway || !charge.providerChargeId) {
      if (manual) throw onlinePaymentsDisabled();
      await auditRefund(pending, { deferred: 'PROVIDER_UNAVAILABLE' });
      return pending;
    }
    let result: GatewayRefund;
    try {
      result = await gateway.refundCharge({
        providerChargeId: charge.providerChargeId,
        idempotencyKey: pending.id,
        amountCents: amount,
        platformFeeRefundCents: feeRefund,
        reason: opts.reason,
      });
    } catch (err) {
      this.logger.error({ err, chargeId: charge.id }, 'Falha ao estornar no gateway');
      if (manual) throw gatewayUnavailable();
      await auditRefund(pending, { deferred: 'GATEWAY_ERROR' });
      return pending;
    }
    const [refund] = await tx
      .update(onlineRefunds)
      .set({ providerRefundId: result.providerRefundId, status: result.status })
      .where(eq(onlineRefunds.id, pending.id))
      .returning();
    if (!refund) throw new Error('Estorno sumiu.');
    await auditRefund(refund);
    if (refund.status === 'SUCCEEDED') {
      await this.applyRefund(tx, charge, refund, item, effects, opts.actorId);
    }
    return refund;
  }

  /** O gateway da cobrança: o provedor gravado nela, se for o que está ligado agora. */
  private gatewayFor(charge: Pick<ChargeRow, 'provider'>): PaymentGateway | null {
    return this.gateway && this.gateway.provider === charge.provider ? this.gateway : null;
  }

  /** Estornos registrados e ainda não concluídos (descontam do saldo reembolsável). */
  private async pendingRefundTotals(
    db: Tx | Database,
    chargeId: string,
  ): Promise<{ amount: number; fee: number }> {
    const [row] = await db
      .select({
        amount: sql<number>`coalesce(sum(${onlineRefunds.amountCents}), 0)::int`,
        fee: sql<number>`coalesce(sum(${onlineRefunds.feeRefundCents}), 0)::int`,
      })
      .from(onlineRefunds)
      .where(
        and(
          eq(onlineRefunds.chargeId, chargeId),
          eq(onlineRefunds.status, 'PENDING'),
          isNull(onlineRefunds.appliedAt),
        ),
      );
    return { amount: row?.amount ?? 0, fee: row?.fee ?? 0 };
  }

  /**
   * Quanto ainda dá para estornar, ou nulo se a cobrança não aceita estorno: paga (com ou sem
   * estorno parcial), contestada com a contestação ganha (o valor voltou ao espaço) e, só nos
   * automáticos, o pagamento tardio de uma cobrança fechada. Desconta os estornos pendentes.
   */
  private async refundableCents(
    db: Tx | Database,
    charge: ChargeRow,
    automatic: boolean,
  ): Promise<number | null> {
    let allowed =
      charge.status === 'PAID' ||
      charge.status === 'PARTIALLY_REFUNDED' ||
      (automatic && isClosedUnpaid(charge.status) && charge.paidAt !== null);
    if (!allowed && charge.status === 'CHARGEBACK') {
      const [won] = await db
        .select({ id: onlineRefunds.id })
        .from(onlineRefunds)
        .where(
          and(
            eq(onlineRefunds.chargeId, charge.id),
            eq(onlineRefunds.kind, 'CHARGEBACK'),
            eq(onlineRefunds.disputeStatus, 'WON'),
          ),
        );
      allowed = Boolean(won);
    }
    if (!allowed) return null;
    const pending = await this.pendingRefundTotals(db, charge.id);
    return Math.max(charge.amountCents - charge.refundedCents - pending.amount, 0);
  }

  /**
   * Reconciliação dos estornos que ficaram PENDING sem chegar ao gateway (provedor indisponível ou
   * falha na hora): tenta de novo com a mesma chave (o id do estorno).
   */
  private async retryPendingRefunds(): Promise<number> {
    const rows = await this.db
      .select({ refund: onlineRefunds, charge: onlineCharges })
      .from(onlineRefunds)
      .innerJoin(onlineCharges, eq(onlineCharges.id, onlineRefunds.chargeId))
      .where(
        and(
          eq(onlineRefunds.status, 'PENDING'),
          eq(onlineRefunds.kind, 'REFUND'),
          isNull(onlineRefunds.providerRefundId),
        ),
      )
      .limit(100);
    let done = 0;
    for (const { refund, charge } of rows) {
      const gateway = this.gatewayFor(charge);
      if (!gateway || !charge.providerChargeId) continue;
      const effects = newEffects();
      try {
        await this.db.transaction(async (tx) => {
          const item = await this.lockItem(tx, charge);
          const current = await this.lockCharge(tx, charge.id);
          const [row] = await tx
            .select()
            .from(onlineRefunds)
            .where(eq(onlineRefunds.id, refund.id))
            .for('update');
          if (row?.status !== 'PENDING' || row.providerRefundId) return;
          const result = await gateway.refundCharge({
            providerChargeId: current.providerChargeId as string,
            idempotencyKey: row.id,
            amountCents: row.amountCents,
            platformFeeRefundCents: row.feeRefundCents,
            reason: row.reason,
          });
          const [updated] = await tx
            .update(onlineRefunds)
            .set({ providerRefundId: result.providerRefundId, status: result.status })
            .where(eq(onlineRefunds.id, row.id))
            .returning();
          if (updated?.status === 'SUCCEEDED') {
            await this.applyRefund(tx, current, updated, item, effects, null);
          }
        });
        await this.flush(effects);
        done++;
      } catch (err) {
        this.logger.error({ err, refundId: refund.id }, 'Estorno pendente não concluído');
      }
    }
    return done;
  }

  /** Parte do estorno que sai do preço do serviço (com `PLAYER`, a taxa devolvida não é do item). */
  private serviceShare(charge: ChargeRow, amount: number, feeRefund: number): number {
    return charge.feePayer === 'SPACE' ? amount : amount - feeRefund;
  }

  /** Estorno ou chargeback informado pelo gateway: grava (se novo) e aplica uma vez só. */
  private async applyGatewayRefund(
    tx: Tx,
    charge: ChargeRow,
    gw: GatewayRefund,
    item: Item | null,
    effects: Effects,
  ): Promise<ChargeRow> {
    const [existing] = await tx
      .select()
      .from(onlineRefunds)
      .where(
        and(
          eq(onlineRefunds.chargeId, charge.id),
          eq(onlineRefunds.providerRefundId, gw.providerRefundId),
        ),
      )
      .for('update');
    let refund = existing;
    let current = charge;
    if (!existing?.appliedAt) {
      if (existing) {
        [refund] = await tx
          .update(onlineRefunds)
          .set({ status: 'SUCCEEDED' })
          .where(eq(onlineRefunds.id, existing.id))
          .returning();
      } else {
        const chargeback = gw.kind === 'CHARGEBACK';
        [refund] = await tx
          .insert(onlineRefunds)
          .values({
            chargeId: charge.id,
            spaceId: charge.spaceId,
            kind: gw.kind,
            status: 'SUCCEEDED',
            amountCents: gw.amountCents,
            feeRefundCents: gw.platformFeeRefundCents,
            reason: gw.reason,
            reasonCode: chargeback ? 'CHARGEBACK' : 'EXTERNAL',
            requestedBy: null,
            providerRefundId: gw.providerRefundId,
            disputeStatus: chargeback ? 'AWAITING_RESPONSE' : null,
            disputeRespondBy: chargeback ? gw.disputeDueAt : null,
          })
          .returning();
        await audit(tx, {
          actorId: null,
          spaceId: charge.spaceId,
          action: chargeback ? 'payment.online.chargeback' : 'payment.online.external_refund',
          entity: 'online_refund',
          entityId: refund?.id ?? null,
          diff: {
            chargeId: charge.id,
            amountCents: gw.amountCents,
            feeRefundCents: gw.platformFeeRefundCents,
            reason: gw.reason,
            respondBy: gw.disputeDueAt?.toISOString() ?? null,
          },
        });
      }
      if (!refund) throw new Error('Estorno sem retorno.');
      current = await this.applyRefund(tx, current, refund, item, effects, null);
    }
    if (refund && gw.kind === 'CHARGEBACK' && gw.disputeOutcome) {
      current = await this.resolveDispute(tx, current, refund, gw, item);
    }
    return current;
  }

  /**
   * Efeito do estorno concluído: livro-razão (estorno ou chargeback e a taxa devolvida pela regra
   * acumulada), status da cobrança, abatimento do item (decisão 93) e o `payment_record` (total:
   * estornado; parcial: o valor líquido).
   */
  private async applyRefund(
    tx: Tx,
    charge: ChargeRow,
    refund: RefundRow,
    item: Item | null,
    effects: Effects,
    actorId: string | null,
  ): Promise<ChargeRow> {
    const now = new Date();
    const space = charge.feePayer === 'SPACE';
    // Venda ainda a liberar: o estorno sai do "a liberar" (mesma data da venda), sem deixar o
    // disponível negativo.
    const availableAt = await this.refundAvailableAt(tx, charge.id, now);
    await addLedgerEntries(tx, [
      {
        spaceId: charge.spaceId,
        chargeId: charge.id,
        refundId: refund.id,
        kind: refund.kind === 'CHARGEBACK' ? 'CHARGEBACK' : 'REFUND',
        amountCents: space ? -refund.amountCents : -(refund.amountCents - refund.feeRefundCents),
        availableAt,
      },
      {
        spaceId: charge.spaceId,
        chargeId: charge.id,
        refundId: refund.id,
        kind: 'FEE_REFUND',
        amountCents: space ? refund.feeRefundCents : 0,
        availableAt,
      },
    ]);
    const refundedCents = Math.min(charge.refundedCents + refund.amountCents, charge.amountCents);
    const feeRefundedCents = Math.min(
      charge.feeRefundedCents + refund.feeRefundCents,
      charge.platformFeeCents,
    );
    // A cobrança fechada que recebeu pagamento tardio continua fechada (decisão 96).
    const next: OnlineChargeStatus = isClosedUnpaid(charge.status)
      ? charge.status
      : refund.kind === 'CHARGEBACK'
        ? 'CHARGEBACK'
        : refundedCents >= charge.amountCents
          ? 'REFUNDED'
          : 'PARTIALLY_REFUNDED';
    const status = rank(next) >= rank(charge.status) ? next : charge.status;
    const [updated] = await tx
      .update(onlineCharges)
      .set({ refundedCents, feeRefundedCents, status })
      .where(eq(onlineCharges.id, charge.id))
      .returning();
    if (!updated) throw onlineChargeNotFound();
    await tx
      .update(onlineRefunds)
      .set({ appliedAt: now, status: 'SUCCEEDED' })
      .where(eq(onlineRefunds.id, refund.id));

    if (refund.itemDiscountCents > 0)
      await this.addItemDiscount(tx, item, refund.itemDiscountCents);
    await this.setOnlineRecord(tx, updated, actorId, item);
    effects.events.push(
      refund.kind === 'CHARGEBACK'
        ? { type: 'online_payment.chargeback', refundId: refund.id }
        : { type: 'online_payment.refunded', refundId: refund.id },
    );
    return updated;
  }

  /** Data de liberação de um estorno: agora, ou a da venda se ela ainda não liberou. */
  private async refundAvailableAt(tx: Tx, chargeId: string, now: Date): Promise<Date> {
    const [sale] = await tx
      .select({ availableAt: spaceLedgerEntries.availableAt })
      .from(spaceLedgerEntries)
      .where(
        and(
          eq(spaceLedgerEntries.chargeId, chargeId),
          eq(spaceLedgerEntries.kind, 'SALE'),
          isNull(spaceLedgerEntries.refundId),
        ),
      );
    return sale && sale.availableAt > now ? sale.availableAt : now;
  }

  /**
   * Resultado da contestação (decisão 94): ganha, o valor volta ao espaço e a taxa devolvida é
   * cobrada de novo; o item volta a ter o pagamento registrado, se ainda couber. Perdida, só fecha.
   */
  private async resolveDispute(
    tx: Tx,
    charge: ChargeRow,
    refund: RefundRow,
    gw: GatewayRefund,
    item: Item | null,
  ): Promise<ChargeRow> {
    if (refund.disputeStatus === 'WON' || refund.disputeStatus === 'LOST') return charge;
    const outcome = gw.disputeOutcome as 'WON' | 'LOST';
    await tx
      .update(onlineRefunds)
      .set({ disputeStatus: outcome, disputeResolvedAt: gw.disputeResolvedAt ?? new Date() })
      .where(eq(onlineRefunds.id, refund.id));
    await audit(tx, {
      actorId: null,
      spaceId: charge.spaceId,
      action: `payment.online.dispute_${outcome.toLowerCase()}`,
      entity: 'online_refund',
      entityId: refund.id,
      diff: { chargeId: charge.id, amountCents: refund.amountCents },
    });
    if (outcome === 'LOST') return charge;
    const now = await this.refundAvailableAt(tx, charge.id, new Date());
    const space = charge.feePayer === 'SPACE';
    await addLedgerEntries(tx, [
      {
        spaceId: charge.spaceId,
        chargeId: charge.id,
        refundId: refund.id,
        kind: 'ADJUSTMENT',
        amountCents: space ? refund.amountCents : refund.amountCents - refund.feeRefundCents,
        availableAt: now,
        description: 'Contestação ganha: valor do chargeback devolvido.',
      },
      {
        spaceId: charge.spaceId,
        chargeId: charge.id,
        refundId: refund.id,
        kind: 'PLATFORM_FEE',
        amountCents: space ? -refund.feeRefundCents : 0,
        availableAt: now,
        description: 'Contestação ganha: taxa devolvida cobrada de novo.',
      },
    ]);
    const [updated] = await tx
      .update(onlineCharges)
      .set({
        refundedCents: Math.max(charge.refundedCents - refund.amountCents, 0),
        feeRefundedCents: Math.max(charge.feeRefundedCents - refund.feeRefundCents, 0),
      })
      .where(eq(onlineCharges.id, charge.id))
      .returning();
    if (!updated) throw onlineChargeNotFound();
    await this.setOnlineRecord(tx, updated, null, item);
    return updated;
  }

  /** Abatimento do estorno manual no item (decisão 93), até o preço. */
  private async addItemDiscount(tx: Tx, item: Item | null, cents: number): Promise<void> {
    if (item?.type === 'BOOKING') {
      await tx
        .update(bookings)
        .set({
          discountCents: sql`least(${bookings.discountCents} + ${cents}, ${bookings.priceCents})`,
        })
        .where(eq(bookings.id, item.booking.id));
    } else if (item?.type === 'SUBSCRIPTION_CHARGE') {
      await tx
        .update(subscriptionCharges)
        .set({
          discountCents: sql`least(${subscriptionCharges.discountCents} + ${cents}, ${subscriptionCharges.amountCents})`,
        })
        .where(eq(subscriptionCharges.id, item.charge.id));
    }
  }

  /**
   * O registro do pagamento online acompanha o que ficou pago (decisão 93: o extrato e o
   * financeiro contam só o líquido): zerado, o registro é estornado; parcial, o valor é ajustado;
   * se voltou a haver valor (contestação ganha), o registro volta, se o item ainda couber.
   */
  private async setOnlineRecord(
    tx: Tx,
    charge: ChargeRow,
    actorId: string | null,
    item: Item | null,
  ): Promise<void> {
    const space = charge.feePayer === 'SPACE';
    const keep = Math.max(
      charge.serviceAmountCents -
        (space ? charge.refundedCents : charge.refundedCents - charge.feeRefundedCents),
      0,
    );
    const [active] = await tx
      .select()
      .from(paymentRecords)
      .where(and(eq(paymentRecords.onlineChargeId, charge.id), isNull(paymentRecords.reversedAt)))
      .for('update');
    if (active?.amountCents === keep) return;
    if (active && keep === 0) {
      await tx
        .update(paymentRecords)
        .set({ reversedAt: new Date(), reversedBy: actorId })
        .where(eq(paymentRecords.id, active.id));
    } else if (active) {
      await tx
        .update(paymentRecords)
        .set({ amountCents: keep })
        .where(eq(paymentRecords.id, active.id));
      await audit(tx, {
        actorId,
        spaceId: charge.spaceId,
        action: 'payment.online.record_adjust',
        entity: 'payment_record',
        entityId: active.id,
        diff: { from: active.amountCents, to: keep, chargeId: charge.id },
      });
    } else if (keep > 0 && charge.paidAt && item) {
      // Contestação ganha depois do estorno do registro: credita de novo, se couber no item.
      const due =
        item.type === 'BOOKING'
          ? isBookingPayable(item.booking.status)
            ? await bookingDue(tx, item.booking)
            : 0
          : item.charge.status === 'WAIVED'
            ? 0
            : await this.subscriptionDue(tx, item.charge);
      if (due < keep) return;
      await tx.insert(paymentRecords).values({
        spaceId: charge.spaceId,
        payableType: charge.payableType,
        payableId: charge.payableId,
        payerUserId: charge.payerUserId,
        amountCents: keep,
        method: charge.method,
        channel: 'ONLINE',
        onlineChargeId: charge.id,
        paidAt: charge.paidAt,
        recordedBy: null,
        note: 'Contestação ganha: pagamento online restabelecido.',
      });
    } else {
      return;
    }
    if (item?.type === 'BOOKING') await refreshBookingPaymentStatus(tx, item.booking);
    if (item?.type === 'SUBSCRIPTION_CHARGE') {
      await afterChargeChange(tx, charge.spaceId, item.sub, item.charge.id);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Cancelamento e edição da reserva (RN-ONPAY-05, decisão 96)

  /** Antes de cancelar uma reserva com cobrança aberta: cancela no gateway (ou aplica o pago). */
  async settleBookingCharges(
    bookingId: string,
    closedReason: 'BOOKING_CANCELLED' | 'BOOKING_CHANGED' = 'BOOKING_CANCELLED',
  ): Promise<void> {
    await this.withItemLock('BOOKING', bookingId, async () => {
      await this.settlePending('BOOKING', bookingId, closedReason);
    });
  }

  /**
   * Na transação do cancelamento, com a reserva travada: fecha a cobrança aberta e estorna o que
   * foi pago online (dentro do prazo pelo organizador, pelo espaço a qualquer momento, ou na
   * exclusão da conta). Devolve o que roda depois do commit.
   */
  async onBookingCancelled(
    tx: Tx,
    booking: BookingRow,
    actorId: string,
    by: 'PLAYER' | 'SPACE' | 'ACCOUNT_DELETED',
  ): Promise<() => Promise<void>> {
    const effects = newEffects();
    await this.closeAndRefundBooking(tx, booking, actorId, by, effects);
    return () => this.flush(effects);
  }

  private async closeAndRefundBooking(
    tx: Tx,
    booking: BookingRow,
    actorId: string,
    by: 'PLAYER' | 'SPACE' | 'ACCOUNT_DELETED',
    effects: Effects,
  ): Promise<void> {
    const charges = await tx
      .select()
      .from(onlineCharges)
      .where(and(eq(onlineCharges.payableType, 'BOOKING'), eq(onlineCharges.payableId, booking.id)))
      .orderBy(onlineCharges.createdAt)
      .for('update');
    const item: Item = { type: 'BOOKING', booking: { ...booking, status: 'CANCELLED' } };
    const reasonCode =
      by === 'PLAYER'
        ? 'BOOKING_CANCELLED_BY_PLAYER'
        : by === 'SPACE'
          ? 'BOOKING_CANCELLED_BY_SPACE'
          : 'ACCOUNT_DELETED';
    for (const charge of charges) {
      if (charge.status === 'PENDING') {
        await tx
          .update(onlineCharges)
          .set({
            status: 'CANCELLED',
            closedReason: by === 'ACCOUNT_DELETED' ? 'ACCOUNT_DELETED' : 'BOOKING_CANCELLED',
          })
          .where(eq(onlineCharges.id, charge.id));
        if (charge.providerChargeId) effects.cancelAtGateway.push(charge.providerChargeId);
      } else if ((await this.refundableCents(tx, charge, true)) ?? 0) {
        // Paga, com estorno parcial ou contestada com a contestação ganha (o valor voltou).
        await this.refundLocked(
          tx,
          charge,
          item,
          {
            reason: AUTO_REFUND_REASONS[reasonCode],
            reasonCode,
            requestedBy: null,
            actorId,
            chargeAgain: false,
          },
          effects,
        );
      }
    }
  }

  /**
   * Exclusão da conta (RF-AUTH-03, RN-ONPAY-05), na transação do atendimento, depois do
   * cancelamento dos compromissos e antes da anonimização: estorna inteiro (taxa devolvida ao espaço
   * pela regra acumulada) o que foi pago online nas reservas futuras canceladas e nas mensalidades
   * de meses que ainda não começaram, que ficam dispensadas; a mensalidade do mês em curso e as
   * vencidas não são estornadas. As cobranças abertas do titular são fechadas. O estorno volta ao
   * meio de pagamento original pelo gateway, que guarda o pagador (a conta aqui fica anonimizada).
   */
  async onAccountDeleted(
    tx: Tx,
    input: {
      userId: string;
      actorId: string;
      cancelledBookingIds: string[];
      waiveReason: string;
      now: Date;
    },
  ): Promise<() => Promise<void>> {
    const effects = newEffects();
    for (const bookingId of input.cancelledBookingIds) {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .for('update');
      if (booking) {
        await this.closeAndRefundBooking(tx, booking, input.actorId, 'ACCOUNT_DELETED', effects);
      }
    }

    // Mensalidades de meses que ainda não começaram, no fuso de cada espaço.
    const future = await tx
      .select({
        chargeId: subscriptionCharges.id,
        spaceId: subscriptions.spaceId,
        periodStart: subscriptionCharges.periodStart,
        timeZone: cities.timezone,
      })
      .from(subscriptionCharges)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
      .innerJoin(spaces, eq(spaces.id, subscriptions.spaceId))
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(eq(subscriptions.userId, input.userId))
      .orderBy(subscriptionCharges.id);
    for (const row of future) {
      const today = utcToZoned(input.now, row.timeZone || DEFAULT_TIME_ZONE).date;
      if (row.periodStart <= today) continue;
      const locked = await lockCharge(tx, row.spaceId, row.chargeId);
      if (!locked) continue;
      const item: Item = { type: 'SUBSCRIPTION_CHARGE', ...locked };
      const charges = await tx
        .select()
        .from(onlineCharges)
        .where(
          and(
            eq(onlineCharges.payableType, 'SUBSCRIPTION_CHARGE'),
            eq(onlineCharges.payableId, row.chargeId),
            inArray(onlineCharges.status, ['PAID', 'PARTIALLY_REFUNDED', 'CHARGEBACK']),
          ),
        )
        .orderBy(onlineCharges.createdAt)
        .for('update');
      for (const charge of charges) {
        if (!((await this.refundableCents(tx, charge, true)) ?? 0)) continue;
        await this.refundLocked(
          tx,
          charge,
          item,
          {
            reason: AUTO_REFUND_REASONS.ACCOUNT_DELETED,
            reasonCode: 'ACCOUNT_DELETED',
            requestedBy: null,
            actorId: input.actorId,
            chargeAgain: false,
          },
          effects,
        );
      }
      // Sem nada pago, a mensalidade do mês que não vai acontecer fica dispensada.
      await tx
        .update(subscriptionCharges)
        .set({
          status: 'WAIVED',
          waivedAt: input.now,
          waivedBy: input.actorId,
          waiveReason: input.waiveReason,
        })
        .where(
          and(
            eq(subscriptionCharges.id, row.chargeId),
            inArray(subscriptionCharges.status, ['PENDING', 'OVERDUE']),
            sql`${chargePaidSql} = 0`,
          ),
        );
    }

    // Cobranças ainda abertas do titular (mês em curso, vencidas): fecham.
    const open = await tx
      .update(onlineCharges)
      .set({ status: 'CANCELLED', closedReason: 'ACCOUNT_DELETED' })
      .where(and(eq(onlineCharges.payerUserId, input.userId), eq(onlineCharges.status, 'PENDING')))
      .returning({ providerChargeId: onlineCharges.providerChargeId });
    effects.cancelAtGateway.push(
      ...open.flatMap((c) => (c.providerChargeId ? [c.providerChargeId] : [])),
    );
    return () => this.flush(effects);
  }

  /** Edição que muda o preço com cobrança aberta: a cobrança perde o valor e é cancelada. */
  async cancelOpenCharges(
    tx: Tx,
    payableType: PayableType,
    payableId: string,
  ): Promise<() => Promise<void>> {
    const cancelled = await tx
      .update(onlineCharges)
      .set({ status: 'CANCELLED', closedReason: 'BOOKING_CHANGED' })
      .where(
        and(
          eq(onlineCharges.payableType, payableType),
          eq(onlineCharges.payableId, payableId),
          eq(onlineCharges.status, 'PENDING'),
        ),
      )
      .returning({ providerChargeId: onlineCharges.providerChargeId });
    const ids = cancelled.flatMap((c) => (c.providerChargeId ? [c.providerChargeId] : []));
    return () => this.cancelAtGateway(ids);
  }

  // -------------------------------------------------------------------------------------------
  // Expiração (RN-ONPAY-02), reconciliação e espaço suspenso

  /**
   * Reservas `PENDING_PAYMENT` vencidas viram `CANCELLED` (`PAYMENT_EXPIRED`) e liberam o horário.
   * Antes, a cobrança é conferida no gateway: um pagamento feito no prazo confirma a reserva.
   * `scope` limita a um espaço, organizador ou reserva (a leitura também expira, além do job).
   */
  async expireHolds(
    now: Date = new Date(),
    scope: { spaceId?: string; organizerUserId?: string; bookingId?: string } = {},
  ): Promise<number> {
    const due = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, 'PENDING_PAYMENT'),
          isNotNull(bookings.paymentDueAt),
          lte(bookings.paymentDueAt, now),
          scope.spaceId ? eq(bookings.spaceId, scope.spaceId) : undefined,
          scope.organizerUserId ? eq(bookings.organizerUserId, scope.organizerUserId) : undefined,
          scope.bookingId ? eq(bookings.id, scope.bookingId) : undefined,
        ),
      )
      .limit(200);
    let expired = 0;
    for (const { id } of due) {
      try {
        if (await this.expireHold(id, now)) expired++;
      } catch (err) {
        this.logger.error(
          { err, bookingId: id },
          'Falha ao expirar a reserva aguardando pagamento',
        );
      }
    }
    return expired;
  }

  private async expireHold(bookingId: string, now: Date): Promise<boolean> {
    const pending = await this.db
      .select({ id: onlineCharges.id })
      .from(onlineCharges)
      .where(
        and(
          eq(onlineCharges.payableType, 'BOOKING'),
          eq(onlineCharges.payableId, bookingId),
          eq(onlineCharges.status, 'PENDING'),
          isNotNull(onlineCharges.providerChargeId),
        ),
      );
    for (const { id } of pending) {
      try {
        await this.sync(id);
      } catch (err) {
        this.logger.warn({ err, chargeId: id }, 'Falha ao conferir a cobrança antes de expirar');
      }
    }

    const effects = newEffects();
    const expired = await this.db.transaction(async (tx) => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .for('update');
      if (booking?.status !== 'PENDING_PAYMENT' || !booking.paymentDueAt) return false;
      if (booking.paymentDueAt > now) return false;
      await tx
        .update(bookings)
        .set({
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledBy: null,
          cancelReason: BOOKING_PAYMENT_EXPIRED_REASON,
        })
        .where(eq(bookings.id, booking.id));
      await tx
        .update(courtOccupations)
        .set({ active: false })
        .where(and(eq(courtOccupations.kind, 'BOOKING'), eq(courtOccupations.refId, booking.id)));
      const charges = await tx
        .update(onlineCharges)
        .set({ status: 'EXPIRED', closedReason: 'EXPIRED' })
        .where(
          and(
            eq(onlineCharges.payableType, 'BOOKING'),
            eq(onlineCharges.payableId, booking.id),
            eq(onlineCharges.status, 'PENDING'),
          ),
        )
        .returning({ providerChargeId: onlineCharges.providerChargeId });
      effects.cancelAtGateway.push(
        ...charges.flatMap((c) => (c.providerChargeId ? [c.providerChargeId] : [])),
      );
      effects.events.push({ type: 'booking.payment_expired', bookingId: booking.id });
      await audit(tx, {
        actorId: null,
        spaceId: booking.spaceId,
        action: 'booking.payment_expired',
        entity: 'booking',
        entityId: booking.id,
        diff: {
          from: 'PENDING_PAYMENT',
          to: 'CANCELLED',
          paymentDueAt: booking.paymentDueAt.toISOString(),
        },
      });
      return true;
    });
    await this.flush(effects);
    return expired;
  }

  /** Pix vencidos (as reservas que seguram horário já foram tratadas antes). */
  async expireCharges(now: Date = new Date()): Promise<number> {
    const due = await this.db
      .select({ id: onlineCharges.id, providerChargeId: onlineCharges.providerChargeId })
      .from(onlineCharges)
      .where(
        and(
          eq(onlineCharges.status, 'PENDING'),
          isNotNull(onlineCharges.expiresAt),
          lte(onlineCharges.expiresAt, now),
        ),
      )
      .limit(200);
    let expired = 0;
    for (const charge of due) {
      try {
        if (charge.providerChargeId) await this.sync(charge.id);
        const effects = newEffects();
        const changed = await this.db.transaction(async (tx) => {
          const [current] = await tx
            .update(onlineCharges)
            .set({ status: 'EXPIRED', closedReason: 'EXPIRED' })
            .where(and(eq(onlineCharges.id, charge.id), eq(onlineCharges.status, 'PENDING')))
            .returning();
          if (!current) return false;
          if (current.providerChargeId) effects.cancelAtGateway.push(current.providerChargeId);
          effects.events.push({ type: 'online_payment.expired', chargeId: current.id });
          await audit(tx, {
            actorId: null,
            spaceId: current.spaceId,
            action: 'payment.online.expired',
            entity: 'online_charge',
            entityId: current.id,
          });
          return true;
        });
        await this.flush(effects);
        if (changed) expired++;
      } catch (err) {
        this.logger.error({ err, chargeId: charge.id }, 'Falha ao vencer a cobrança online');
      }
    }
    return expired;
  }

  /**
   * Reconciliação periódica (RN-ONPAY-07): sincroniza as pendentes, as fechadas há pouco e os
   * estornos em andamento, fecha cobranças que o gateway nunca confirmou e estorna pagamento que
   * não entrou em nenhum item.
   */
  async reconcile(now: Date = new Date()): Promise<{ synced: number; refunded: number }> {
    const gateway = this.gateway;
    if (!gateway) return { synced: 0, refunded: 0 };
    await this.resolveUnverified(gateway, now);
    await this.retryPendingRefunds();
    const recent = new Date(now.getTime() - 24 * 60 * MINUTE_MS);
    const toSync = await this.db
      .selectDistinct({ id: onlineCharges.id })
      .from(onlineCharges)
      .leftJoin(onlineRefunds, eq(onlineRefunds.chargeId, onlineCharges.id))
      .where(
        and(
          eq(onlineCharges.provider, gateway.provider),
          isNotNull(onlineCharges.providerChargeId),
          sql`(${onlineCharges.status} = 'PENDING' OR ${onlineRefunds.status} = 'PENDING' OR (${onlineCharges.status} IN ('EXPIRED', 'CANCELLED') AND ${onlineCharges.paidAt} IS NULL AND ${onlineCharges.updatedAt} > ${recent.toISOString()}::timestamptz))`,
        ),
      )
      .limit(500);
    let synced = 0;
    for (const { id } of toSync) {
      try {
        await this.sync(id);
        synced++;
      } catch (err) {
        this.logger.error({ err, chargeId: id }, 'Falha na reconciliação da cobrança');
      }
    }
    // Pago e sem registro ativo, com saldo: o dinheiro não entrou em item nenhum.
    const orphans = await this.db
      .select({
        id: onlineCharges.id,
        status: onlineCharges.status,
        closedReason: onlineCharges.closedReason,
      })
      .from(onlineCharges)
      .where(
        and(
          isNotNull(onlineCharges.paidAt),
          sql`${onlineCharges.status} NOT IN ('REFUNDED', 'CHARGEBACK')`,
          sql`${onlineCharges.refundedCents} < ${onlineCharges.amountCents}`,
          lt(onlineCharges.paidAt, new Date(now.getTime() - 2 * MINUTE_MS)),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(paymentRecords)
              .where(
                and(
                  eq(paymentRecords.onlineChargeId, onlineCharges.id),
                  isNull(paymentRecords.reversedAt),
                ),
              ),
          ),
          // Estorno manual parcial com abatimento deixa registro; sem registro e sem estorno
          // em andamento é órfão.
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(onlineRefunds)
              .where(
                and(
                  eq(onlineRefunds.chargeId, onlineCharges.id),
                  eq(onlineRefunds.status, 'PENDING'),
                ),
              ),
          ),
        ),
      )
      .limit(100);
    let refunded = 0;
    for (const orphan of orphans) {
      const reasonCode = isClosedUnpaid(orphan.status)
        ? lateReasonOf(orphan.closedReason)
        : 'PAID_AFTER_DEADLINE';
      try {
        await this.refund(orphan.id, {
          reason: AUTO_REFUND_REASONS[reasonCode],
          reasonCode,
          requestedBy: null,
        });
        refunded++;
      } catch (err) {
        this.logger.error(
          { err, chargeId: orphan.id },
          'Falha no estorno automático da reconciliação',
        );
      }
    }
    return { synced, refunded };
  }

  /**
   * Criações de resultado desconhecido (PENDING sem id do gateway): com a trava do item (nenhuma
   * criação em andamento), consulta pela chave. Existe: vale o que o gateway tem. Não existe: nada
   * foi cobrado, vira `FAILED`.
   */
  private async resolveUnverified(gateway: PaymentGateway, now: Date): Promise<void> {
    const rows = await this.db
      .select()
      .from(onlineCharges)
      .where(
        and(
          eq(onlineCharges.provider, gateway.provider),
          eq(onlineCharges.status, 'PENDING'),
          isNull(onlineCharges.providerChargeId),
          lt(onlineCharges.createdAt, new Date(now.getTime() - UNVERIFIED_AFTER_MS)),
        ),
      )
      .limit(100);
    for (const row of rows) {
      try {
        await this.withItemLock(row.payableType as PayableType, row.payableId, async () => {
          const [current] = await this.db
            .select()
            .from(onlineCharges)
            .where(eq(onlineCharges.id, row.id));
          if (current?.status !== 'PENDING' || current.providerChargeId) return;
          const found = await gateway.findChargeByIdempotencyKey(current.idempotencyKey);
          if (found) await this.sync(current.id, found);
          else await this.markUnknownAsFailed(current.id);
        });
      } catch (err) {
        this.logger.error({ err, chargeId: row.id }, 'Cobrança ainda pendente de verificação');
      }
    }
  }

  /**
   * Webhook de cobrança sem linha local com o id do gateway: casa pela chave de idempotência (a
   * criação cujo resultado não chegou). Sem dono nenhum, o que foi pago é estornado e o que está
   * aberto, cancelado. Devolve se tratou o evento.
   */
  async adoptByProviderId(provider: string, providerChargeId: string): Promise<boolean> {
    const gateway = this.gateway;
    if (!gateway || gateway.provider !== provider) return false;
    const snapshot = await gateway.getCharge(providerChargeId);
    if (snapshot.idempotencyKey) {
      const [owner] = await this.db
        .select({ id: onlineCharges.id })
        .from(onlineCharges)
        .where(
          and(
            eq(onlineCharges.provider, provider),
            eq(onlineCharges.idempotencyKey, snapshot.idempotencyKey),
          ),
        );
      if (owner) {
        await this.sync(owner.id, snapshot);
        return true;
      }
    }
    if (snapshot.status === 'PENDING') {
      await gateway.cancelCharge(providerChargeId);
    } else if (snapshot.status === 'PAID') {
      // Tudo volta, inclusive a taxa: nenhum item recebeu esse pagamento.
      const refunded = snapshot.refunds.reduce((sum, r) => sum + r.amountCents, 0);
      const feeRefunded = snapshot.refunds.reduce((sum, r) => sum + r.platformFeeRefundCents, 0);
      if (refunded < snapshot.amountCents) {
        await gateway.refundCharge({
          providerChargeId,
          idempotencyKey: `orphan:${providerChargeId}`,
          amountCents: snapshot.amountCents - refunded,
          platformFeeRefundCents: Math.max(snapshot.platformFeeCents - feeRefunded, 0),
          reason: 'Pagamento sem cobrança correspondente (estorno automático).',
        });
      }
    }
    await audit(this.db, {
      actorId: null,
      spaceId: null,
      action: 'payment.online.orphan',
      entity: 'online_charge',
      entityId: null,
      diff: { provider, providerChargeId, status: snapshot.status },
    });
    return true;
  }

  /** RN-ONPAY-09: espaço suspenso ou encerrado tem as cobranças abertas canceladas. */
  async cancelOpenChargesOfSpace(spaceId: string): Promise<number> {
    const cancelled = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(onlineCharges)
        .set({ status: 'CANCELLED', closedReason: 'SPACE_INACTIVE' })
        .where(and(eq(onlineCharges.spaceId, spaceId), eq(onlineCharges.status, 'PENDING')))
        .returning({ id: onlineCharges.id, providerChargeId: onlineCharges.providerChargeId });
      if (rows.length) {
        await audit(tx, {
          actorId: null,
          spaceId,
          action: 'payment.online.cancel_space_inactive',
          entity: 'online_charge',
          entityId: null,
          diff: { chargeIds: rows.map((r) => r.id) },
        });
      }
      return rows;
    });
    await this.cancelAtGateway(
      cancelled.flatMap((c) => (c.providerChargeId ? [c.providerChargeId] : [])),
    );
    return cancelled.length;
  }

  // -------------------------------------------------------------------------------------------
  // Depois do commit

  private async cancelAtGateway(providerChargeIds: string[]): Promise<void> {
    const gateway = this.gateway;
    if (!gateway) return;
    for (const id of providerChargeIds) {
      try {
        const snapshot = await gateway.cancelCharge(id);
        // Paga antes do cancelamento: a sincronização registra e estorna (decisão 96).
        if (snapshot.status === 'PAID') await this.syncByProviderId(gateway.provider, id);
      } catch (err) {
        // A reconciliação confere de novo.
        this.logger.warn({ err, providerChargeId: id }, 'Falha ao cancelar a cobrança no gateway');
      }
    }
  }

  private async flush(effects: Effects): Promise<void> {
    await this.cancelAtGateway(effects.cancelAtGateway);
    for (const { chargeId, reasonCode } of effects.autoRefunds) {
      try {
        await this.refund(chargeId, {
          reason: AUTO_REFUND_REASONS[reasonCode],
          reasonCode,
          requestedBy: null,
        });
      } catch (err) {
        this.logger.error(
          { err, chargeId },
          'Falha no estorno automático (a reconciliação repete)',
        );
      }
    }
    for (const event of effects.events) await this.events.publish(event);
  }
}
