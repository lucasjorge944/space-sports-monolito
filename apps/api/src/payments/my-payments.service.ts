import { Inject, Injectable } from '@nestjs/common';
import {
  type MyPayment,
  type MyPaymentDetail,
  type MyPaymentPage,
  type MyPaymentRefund,
  type MyPaymentsQuery,
  onlineChargeFailureMessage,
} from '@space-sports/shared';
import { and, asc, desc, eq, inArray, lt, type SQL } from 'drizzle-orm';
import { invalidCursor } from '../bookings/bookings.errors.js';
import type { Database } from '../db/client.js';
import {
  bookings,
  courts,
  onlineCharges,
  onlineRefunds,
  plans,
  spaces,
  sports,
  subscriptionCharges,
  subscriptions,
  users,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { PAYMENT_GATEWAY, paymentEnvironmentOf } from './gateway/gateway.registry.js';
import type { PaymentGateway } from './gateway/payment-gateway.js';
import { onlineChargeNotFound } from './payments.errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Meus pagamentos (RF-ONPAY-06): as cobranças online do usuário da sessão, com o item, o espaço e
 * os estornos (com o motivo, inclusive os automáticos). Sem saldo (decisão 89); só as cobranças do
 * próprio pagador.
 */
@Injectable()
export class MyPaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
  ) {}

  private rows(where: SQL | undefined, limit: number) {
    return this.db
      .select({
        charge: onlineCharges,
        spaceName: spaces.name,
        spaceSlug: spaces.slug,
        bookingStartsAt: bookings.startsAt,
        courtName: courts.name,
        sportName: sports.name,
        periodStart: subscriptionCharges.periodStart,
        subscriptionId: subscriptions.id,
        planName: plans.name,
        payerName: users.name,
      })
      .from(onlineCharges)
      .innerJoin(spaces, eq(spaces.id, onlineCharges.spaceId))
      .innerJoin(users, eq(users.id, onlineCharges.payerUserId))
      .leftJoin(
        bookings,
        and(eq(onlineCharges.payableType, 'BOOKING'), eq(bookings.id, onlineCharges.payableId)),
      )
      .leftJoin(courts, eq(courts.id, bookings.courtId))
      .leftJoin(sports, eq(sports.id, bookings.sportId))
      .leftJoin(
        subscriptionCharges,
        and(
          eq(onlineCharges.payableType, 'SUBSCRIPTION_CHARGE'),
          eq(subscriptionCharges.id, onlineCharges.payableId),
        ),
      )
      .leftJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(where)
      .orderBy(desc(onlineCharges.id))
      .limit(limit);
  }

  async list(userId: string, query: MyPaymentsQuery): Promise<MyPaymentPage> {
    let before: string | undefined;
    if (query.cursor) {
      before = Buffer.from(query.cursor, 'base64url').toString('utf8');
      if (!UUID.test(before)) throw invalidCursor();
    }
    const rows = await this.rows(
      and(
        eq(onlineCharges.payerUserId, userId),
        query.status?.length ? inArray(onlineCharges.status, query.status) : undefined,
        before ? lt(onlineCharges.id, before) : undefined,
      ),
      query.limit + 1,
    );
    const page = rows.slice(0, query.limit);
    const refunds = await this.refundsOf(page.map((row) => row.charge.id));
    const items = page.map((row) => toMyPayment(row, refunds.get(row.charge.id) ?? []));
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last ? Buffer.from(last.id).toString('base64url') : null,
    };
  }

  /** Detalhe e comprovante: id da transação, estornos e, se pendente, o Pix. */
  async get(userId: string, chargeId: string): Promise<MyPaymentDetail> {
    const [row] = await this.rows(
      and(eq(onlineCharges.payerUserId, userId), eq(onlineCharges.id, chargeId)),
      1,
    );
    if (!row) throw onlineChargeNotFound();
    const refunds = await this.refundsOf([chargeId]);
    const { charge } = row;
    const pending = charge.status === 'PENDING';
    return {
      ...toMyPayment(row, refunds.get(chargeId) ?? []),
      transactionId: charge.providerChargeId,
      payerName: row.payerName,
      pix:
        pending && charge.pixCopyPaste && charge.pixQrSvg && charge.expiresAt
          ? {
              copyPaste: charge.pixCopyPaste,
              qrSvg: charge.pixQrSvg,
              expiresAt: charge.expiresAt.toISOString(),
            }
          : null,
      expiresAt: charge.expiresAt?.toISOString() ?? null,
      failureCode: charge.failureReason,
      failureReason: onlineChargeFailureMessage(charge.failureReason),
      paymentEnvironment: paymentEnvironmentOf(this.gateway),
      serverTime: new Date().toISOString(),
    };
  }

  /** Estornos das cobranças (manuais e automáticos), do mais antigo ao mais recente. */
  private async refundsOf(chargeIds: string[]): Promise<Map<string, MyPaymentRefund[]>> {
    const byCharge = new Map<string, MyPaymentRefund[]>();
    if (!chargeIds.length) return byCharge;
    const rows = await this.db
      .select()
      .from(onlineRefunds)
      .where(inArray(onlineRefunds.chargeId, chargeIds))
      .orderBy(asc(onlineRefunds.createdAt), asc(onlineRefunds.id));
    for (const refund of rows) {
      const list = byCharge.get(refund.chargeId) ?? [];
      list.push({
        id: refund.id,
        kind: refund.kind,
        status: refund.status,
        amountCents: refund.amountCents,
        reason: refund.reason,
        reasonCode: refund.reasonCode,
        createdAt: refund.createdAt.toISOString(),
      });
      byCharge.set(refund.chargeId, list);
    }
    return byCharge;
  }
}

type Row = Awaited<ReturnType<MyPaymentsService['rows']>>[number];

function toMyPayment(row: Row, refunds: MyPaymentRefund[]): MyPayment {
  const { charge } = row;
  const booking = charge.payableType === 'BOOKING';
  return {
    id: charge.id,
    status: charge.status,
    method: charge.method,
    amountCents: charge.amountCents,
    refundedCents: charge.refundedCents,
    space: { id: charge.spaceId, name: row.spaceName, slug: row.spaceSlug },
    item: {
      type: booking ? 'BOOKING' : 'SUBSCRIPTION_CHARGE',
      id: charge.payableId,
      title: booking
        ? [row.courtName, row.sportName].filter(Boolean).join(' · ') || 'Reserva'
        : (row.planName ?? 'Mensalidade'),
      startsAt: row.bookingStartsAt?.toISOString() ?? null,
      periodStart: row.periodStart ?? null,
      subscriptionId: row.subscriptionId ?? null,
    },
    cardBrand: charge.cardBrand,
    cardLast4: charge.cardLast4,
    paidAt: charge.paidAt?.toISOString() ?? null,
    createdAt: charge.createdAt.toISOString(),
    refunds,
  };
}
