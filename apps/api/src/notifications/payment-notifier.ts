import { Inject, Injectable, Logger } from '@nestjs/common';
import { formatCents, SPACE_PERMISSIONS, type SpaceRole } from '@space-sports/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { renderEmail } from '../auth/auth-emails.js';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import type { Database } from '../db/client.js';
import {
  bookings,
  cities,
  merchantAccounts,
  onlineCharges,
  onlineRefunds,
  payouts,
  plans,
  spaceMembers,
  spaces,
  subscriptionCharges,
  subscriptions,
  users,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { Mailer } from '../mail/mailer.js';
import { formatWhen } from './booking-notifier.js';
import { NotificationsService, type NotifyInput } from './notifications.service.js';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** `08/11` no fuso do espaço. */
function dayMonth(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}`;
}

/** `08/11 às 18:00` (sem o dia da semana e o ano de `formatWhen`). */
function dayTime(instant: Date, timeZone: string): string {
  const when = formatWhen(instant, timeZone);
  const match = /(\d{2}\/\d{2})\/\d{4} às (\d{2}:\d{2})/.exec(when);
  return match ? `${match[1]} às ${match[2]}` : when;
}

type Section = 'SETTINGS' | 'WALLET' | 'CHARGEBACKS';

/**
 * Notificações do pagamento online (RF-NOTIF-01; docs/05, "Pagamento online"): para o jogador,
 * pagamento confirmado, Pix vencido, reserva cancelada pelo prazo e estornos; para a gestão
 * (Dono e Admin), cadastro aprovado ou recusado, contestação com prazo e repasse que falhou; para
 * todos os Donos (com e-mail), a troca da conta de recebimento (decisão 95). O nome do espaço entra
 * sem artigo.
 */
@Injectable()
export class PaymentNotifier {
  private readonly logger = new Logger(PaymentNotifier.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationsService,
    private readonly mailer: Mailer,
  ) {}

  async paid(chargeId: string): Promise<void> {
    const charge = await this.loadCharge(chargeId);
    if (!charge) return;
    const body = charge.booking
      ? `Sua reserva em ${charge.spaceName} em ${dayTime(charge.booking.startsAt, charge.timeZone)} está paga.`
      : `A mensalidade de ${charge.monthLabel} (${charge.planName}) em ${charge.spaceName} está paga.`;
    await this.send({
      userId: charge.payerUserId,
      type: 'PAYMENT_CONFIRMED',
      title: 'Pagamento confirmado',
      body,
      data: this.chargeData(charge),
    });
  }

  /** Pix vencido (reserva opcional ou mensalidade): o jogador gera outro quando quiser. */
  async expired(chargeId: string): Promise<void> {
    const charge = await this.loadCharge(chargeId);
    // A reserva com pagamento obrigatório tem o próprio aviso ("Reserva cancelada"): o Pix dela
    // vence junto com o prazo, antes ou depois do cancelamento.
    const status = charge?.booking?.status;
    if (!charge || status === 'CANCELLED' || status === 'PENDING_PAYMENT') return;
    await this.send({
      userId: charge.payerUserId,
      type: 'PAYMENT_EXPIRED',
      title: 'O Pix venceu',
      body: 'Gere outro quando quiser pagar.',
      data: this.chargeData(charge),
    });
  }

  /** RN-ONPAY-02: reserva `PENDING_PAYMENT` cancelada pelo prazo (o espaço não é avisado). */
  async holdExpired(bookingId: string): Promise<void> {
    const [booking] = await this.db
      .select({ organizerUserId: bookings.organizerUserId, spaceId: bookings.spaceId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (!booking?.organizerUserId) return;
    await this.send({
      userId: booking.organizerUserId,
      type: 'PAYMENT_EXPIRED',
      title: 'Reserva cancelada',
      body: 'O pagamento não foi feito a tempo e o horário foi liberado.',
      data: { bookingId, spaceId: booking.spaceId },
    });
  }

  async refunded(refundId: string): Promise<void> {
    const row = await this.loadRefund(refundId);
    if (!row) return;
    const { refund, charge } = row;
    const amount = formatCents(refund.amountCents);
    const destination = charge.method === 'PIX' ? 'volta para o mesmo Pix' : 'volta para o cartão';
    const late =
      refund.reasonCode === 'PAID_AFTER_DEADLINE' ||
      refund.reasonCode === 'PAID_AFTER_METHOD_CHANGE' ||
      refund.reasonCode === 'ITEM_ALREADY_PAID';
    const reason =
      refund.reasonCode === 'PAID_AFTER_METHOD_CHANGE'
        ? 'chegou depois da troca da forma de pagamento'
        : refund.reasonCode === 'ITEM_ALREADY_PAID'
          ? 'chegou com o item já pago'
          : 'chegou depois do prazo';
    await this.send({
      userId: charge.payerUserId,
      type: 'PAYMENT_REFUNDED',
      title: late ? 'Pagamento devolvido' : `Estorno de ${amount}`,
      body: late
        ? `O pagamento de ${amount} ${reason} e ${destination}.`
        : `${charge.spaceName} devolveu ${amount} do pagamento de ${dayMonth(charge.paidAt ?? charge.createdAt, charge.timeZone)}.`,
      data: { ...this.chargeData(charge), refundId },
    });
  }

  /** RN-ONPAY-06: a gestão é avisada, com o prazo para responder. */
  async chargeback(refundId: string): Promise<void> {
    const row = await this.loadRefund(refundId);
    if (!row) return;
    const { refund, charge } = row;
    const due = refund.disputeRespondBy
      ? ` Responda até ${dayMonth(refund.disputeRespondBy, charge.timeZone)}.`
      : '';
    await this.notifyStaff(charge.spaceId, ['OWNER', 'ADMIN'], {
      type: 'PAYMENT_CHARGEBACK',
      title: 'Contestação no cartão',
      body: `${charge.payerName} contestou ${formatCents(refund.amountCents)} em ${charge.spaceName}.${due}`,
      data: { spaceId: charge.spaceId, section: 'CHARGEBACKS', chargebackId: refundId },
    });
  }

  async merchantDecided(spaceId: string, approved: boolean): Promise<void> {
    const [row] = await this.db
      .select({ spaceName: spaces.name, reason: merchantAccounts.rejectionReason })
      .from(spaces)
      .leftJoin(merchantAccounts, eq(merchantAccounts.spaceId, spaces.id))
      .where(eq(spaces.id, spaceId));
    if (!row) return;
    await this.notifyStaff(spaceId, ['OWNER', 'ADMIN'], {
      type: approved ? 'MERCHANT_ACCOUNT_APPROVED' : 'MERCHANT_ACCOUNT_REJECTED',
      title: approved ? 'Conta de recebimento aprovada' : 'Cadastro recusado',
      body: approved
        ? `${row.spaceName} já pode receber Pix e cartão pelo app. Escolha as formas de pagamento.`
        : `O cadastro de ${row.spaceName} foi recusado${row.reason ? `: ${row.reason}` : ''}. Corrija e envie de novo.`,
      data: { spaceId, section: 'SETTINGS' satisfies Section },
    });
  }

  /** Decisão 95: todos os Donos recebem a notificação e o e-mail. */
  async payoutChanged(spaceId: string, changedBy: string): Promise<void> {
    const [row] = await this.db
      .select({ spaceName: spaces.name, actorName: users.name })
      .from(spaces)
      .leftJoin(users, eq(users.id, changedBy))
      .where(eq(spaces.id, spaceId));
    if (!row) return;
    const actor = row.actorName?.trim() || 'Um dono';
    await this.notifyOwners(spaceId, {
      type: 'MERCHANT_PAYOUT_ACCOUNT_CHANGED',
      title: 'Conta de recebimento alterada',
      body: `${actor} trocou a conta de ${row.spaceName}. Os repasses ficam pausados até a aprovação.`,
      subject: `Conta de recebimento alterada em ${row.spaceName}`,
      outro: 'Se você não reconhece esta troca, fale com o suporte do Space Sports imediatamente.',
    });
  }

  /**
   * Decisão 98: a troca recusada volta para a conta anterior; todos os Donos recebem a
   * notificação e o e-mail com o motivo.
   */
  async payoutChangeRejected(spaceId: string): Promise<void> {
    const [row] = await this.db
      .select({
        spaceName: spaces.name,
        reason: merchantAccounts.payoutChangeRejectionReason,
      })
      .from(spaces)
      .leftJoin(merchantAccounts, eq(merchantAccounts.spaceId, spaces.id))
      .where(eq(spaces.id, spaceId));
    if (!row) return;
    await this.notifyOwners(spaceId, {
      type: 'MERCHANT_PAYOUT_CHANGE_REJECTED',
      title: 'Troca de conta recusada',
      body: `A nova conta de ${row.spaceName} foi recusada${row.reason ? `: ${row.reason}` : ''}. Os repasses seguem para a conta anterior. Você pode tentar outra troca.`,
      subject: `Troca de conta recusada em ${row.spaceName}`,
      outro: 'O pagamento online continua funcionando normalmente.',
    });
  }

  /** Notificação e e-mail para todos os Donos (conta de recebimento, decisões 95 e 98). */
  private async notifyOwners(
    spaceId: string,
    message: {
      type: 'MERCHANT_PAYOUT_ACCOUNT_CHANGED' | 'MERCHANT_PAYOUT_CHANGE_REJECTED';
      title: string;
      body: string;
      subject: string;
      outro: string;
    },
  ): Promise<void> {
    const owners = await this.staff(spaceId, ['OWNER']);
    await this.notifyEach(
      owners.map((o) => o.userId),
      {
        type: message.type,
        title: message.title,
        body: message.body,
        data: { spaceId, section: 'SETTINGS' satisfies Section },
      },
    );
    for (const owner of owners) {
      if (!owner.email) continue;
      try {
        await this.mailer.send(
          renderEmail(owner.email, message.subject, owner.name, {
            intro: message.body,
            action: 'Ver recebimentos online',
            url: `${this.env.WEB_URL}/painel/recebimentos-online`,
            outro: message.outro,
          }),
        );
      } catch (err) {
        this.logger.error(
          { err, spaceId, type: message.type },
          'Falha ao enviar o e-mail aos Donos',
        );
      }
    }
  }

  async payoutFailed(payoutId: string): Promise<void> {
    const [row] = await this.db
      .select({
        spaceId: payouts.spaceId,
        amountCents: payouts.amountCents,
        spaceName: spaces.name,
      })
      .from(payouts)
      .innerJoin(spaces, eq(spaces.id, payouts.spaceId))
      .where(eq(payouts.id, payoutId));
    if (!row) return;
    await this.notifyStaff(row.spaceId, ['OWNER', 'ADMIN'], {
      type: 'PAYOUT_FAILED',
      title: 'Repasse não enviado',
      body: `O repasse de ${formatCents(row.amountCents)} de ${row.spaceName} não foi enviado. Confira a conta bancária com o suporte.`,
      data: { spaceId: row.spaceId, section: 'WALLET' satisfies Section, payoutId },
    });
  }

  // -------------------------------------------------------------------------------------------

  private chargeData(charge: NonNullable<Awaited<ReturnType<PaymentNotifier['loadCharge']>>>) {
    return {
      onlineChargeId: charge.id,
      spaceId: charge.spaceId,
      ...(charge.booking ? { bookingId: charge.payableId } : {}),
      ...(charge.subscriptionId
        ? { subscriptionId: charge.subscriptionId, chargeId: charge.payableId }
        : {}),
    };
  }

  private async loadCharge(chargeId: string) {
    const [row] = await this.db
      .select({
        charge: onlineCharges,
        spaceName: spaces.name,
        timeZone: cities.timezone,
        payerName: users.name,
        bookingStartsAt: bookings.startsAt,
        bookingStatus: bookings.status,
        periodStart: subscriptionCharges.periodStart,
        subscriptionId: subscriptions.id,
        planName: plans.name,
      })
      .from(onlineCharges)
      .innerJoin(spaces, eq(spaces.id, onlineCharges.spaceId))
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .innerJoin(users, eq(users.id, onlineCharges.payerUserId))
      .leftJoin(
        bookings,
        and(eq(onlineCharges.payableType, 'BOOKING'), eq(bookings.id, onlineCharges.payableId)),
      )
      .leftJoin(
        subscriptionCharges,
        and(
          eq(onlineCharges.payableType, 'SUBSCRIPTION_CHARGE'),
          eq(subscriptionCharges.id, onlineCharges.payableId),
        ),
      )
      .leftJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(onlineCharges.id, chargeId));
    if (!row) return undefined;
    const month = row.periodStart
      ? `${MONTHS[Number(row.periodStart.slice(5, 7)) - 1]} ${row.periodStart.slice(0, 4)}`
      : '';
    return {
      ...row.charge,
      spaceName: row.spaceName,
      timeZone: row.timeZone || 'America/Sao_Paulo',
      payerName: row.payerName,
      booking:
        row.bookingStartsAt && row.bookingStatus
          ? { startsAt: row.bookingStartsAt, status: row.bookingStatus }
          : null,
      subscriptionId: row.subscriptionId,
      planName: row.planName ?? 'Aulas',
      monthLabel: month,
    };
  }

  private async loadRefund(refundId: string) {
    const [refund] = await this.db
      .select()
      .from(onlineRefunds)
      .where(eq(onlineRefunds.id, refundId));
    if (!refund) return undefined;
    const charge = await this.loadCharge(refund.chargeId);
    return charge ? { refund, charge } : undefined;
  }

  private async staff(spaceId: string, roles: SpaceRole[]) {
    const rows = await this.db
      .select({ userId: spaceMembers.userId, email: users.email, name: users.name })
      .from(spaceMembers)
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.status, 'ACTIVE'),
          inArray(spaceMembers.role, roles),
          isNotNull(spaceMembers.userId),
        ),
      );
    const seen = new Set<string>();
    return rows.filter((row) => !seen.has(row.userId) && seen.add(row.userId));
  }

  private async notifyStaff(
    spaceId: string,
    roles: SpaceRole[],
    input: Omit<NotifyInput, 'userId'>,
  ): Promise<void> {
    const allowed = roles.filter((role) =>
      (SPACE_PERMISSIONS['payments.online.manage'] as readonly SpaceRole[]).includes(role),
    );
    const staff = await this.staff(spaceId, allowed);
    await this.notifyEach(
      staff.map((s) => s.userId),
      input,
    );
  }

  private async notifyEach(userIds: string[], input: Omit<NotifyInput, 'userId'>): Promise<void> {
    for (const userId of userIds) await this.send({ ...input, userId });
  }

  private async send(input: NotifyInput): Promise<void> {
    try {
      await this.notifications.notify(input);
    } catch (err) {
      this.logger.error({ err, userId: input.userId }, 'Falha ao notificar destinatário');
    }
  }
}
