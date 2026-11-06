import { Inject, Injectable } from '@nestjs/common';
import { formatCents } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { chargePaidSql } from '../classes/subscription-billing.js';
import type { Database } from '../db/client.js';
import { plans, spaces, subscriptionCharges, subscriptions } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { NotificationsService } from './notifications.service.js';

/** `2026-11-10` → `10/11/2026`. */
const fullDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/**
 * Textos e destinatário das notificações das assinaturas de aula (RF-NOTIF-01): o aluno da
 * assinatura. Lê o que precisa do banco; os módulos de aulas só publicam os eventos.
 */
@Injectable()
export class SubscriptionNotifier {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  /** Pedido de assinatura aprovado ou recusado. */
  async decided(subscriptionId: string, approved: boolean): Promise<void> {
    const row = await this.load(subscriptionId);
    if (!row) return;
    await this.notifications.notify({
      userId: row.userId,
      type: approved ? 'SUBSCRIPTION_APPROVED' : 'SUBSCRIPTION_REJECTED',
      title: approved ? 'Matrícula aprovada' : 'Matrícula recusada',
      body: !approved && row.reason ? `${row.where} · ${row.reason}` : row.where,
      data: { subscriptionId, spaceId: row.spaceId },
    });
  }

  /** Cancelamento pelo aluno ou pela gestão: a data em que o acesso acaba (RN-CLASS-08). */
  async cancelled(subscriptionId: string): Promise<void> {
    const row = await this.load(subscriptionId);
    if (!row?.endsOn) return;
    const date = fullDate(row.endsOn);
    await this.notifications.notify({
      userId: row.userId,
      type: 'SUBSCRIPTION_CANCELLED',
      title: 'Plano cancelado',
      body: `${row.where} · ${
        row.status === 'CANCELLED'
          ? `Seu acesso terminou em ${date}.`
          : `Seu plano fica ativo até ${date}.`
      }`,
      data: { subscriptionId, spaceId: row.spaceId, accessUntil: row.endsOn },
    });
  }

  /** A gestão desfez o cancelamento (RN-CLASS-08); quem desiste pelo app já sabe. */
  async cancelResumed(subscriptionId: string): Promise<void> {
    const row = await this.load(subscriptionId);
    if (!row) return;
    await this.notifications.notify({
      userId: row.userId,
      type: 'SUBSCRIPTION_CANCEL_RESUMED',
      title: 'Cancelamento desfeito',
      body: `${row.where} · Seu plano segue ativo.`,
      data: { subscriptionId, spaceId: row.spaceId },
    });
  }

  async chargeDueSoon(chargeId: string): Promise<void> {
    const charge = await this.loadCharge(chargeId);
    if (!charge) return;
    await this.notifications.notify({
      userId: charge.userId,
      type: 'SUBSCRIPTION_CHARGE_DUE_SOON',
      title: 'Mensalidade vence em breve',
      body: `${charge.spaceName} · ${charge.planName} · ${formatCents(charge.dueCents)} até ${fullDate(charge.dueDate)}`,
      data: { subscriptionId: charge.subscriptionId, chargeId, spaceId: charge.spaceId },
    });
  }

  async chargeOverdue(chargeId: string): Promise<void> {
    const charge = await this.loadCharge(chargeId);
    if (!charge) return;
    await this.notifications.notify({
      userId: charge.userId,
      type: 'SUBSCRIPTION_CHARGE_OVERDUE',
      title: 'Mensalidade vencida',
      body: `${charge.spaceName} · ${charge.planName} · ${formatCents(charge.dueCents)} em aberto, venceu em ${fullDate(charge.dueDate)}. Fale com o espaço.`,
      data: { subscriptionId: charge.subscriptionId, chargeId, spaceId: charge.spaceId },
    });
  }

  private async load(subscriptionId: string) {
    const [row] = await this.db
      .select({
        userId: subscriptions.userId,
        spaceId: subscriptions.spaceId,
        status: subscriptions.status,
        endsOn: subscriptions.endsOn,
        reason: subscriptions.statusReason,
        planName: plans.name,
        spaceName: spaces.name,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .innerJoin(spaces, eq(spaces.id, subscriptions.spaceId))
      .where(eq(subscriptions.id, subscriptionId));
    return row && { ...row, where: `${row.spaceName} · ${row.planName}` };
  }

  /** Mensalidade com o valor em aberto (cheio menos os pagamentos não estornados). */
  private async loadCharge(chargeId: string) {
    const [row] = await this.db
      .select({
        subscriptionId: subscriptions.id,
        userId: subscriptions.userId,
        spaceId: subscriptions.spaceId,
        dueDate: subscriptionCharges.dueDate,
        amountCents: subscriptionCharges.amountCents,
        discountCents: subscriptionCharges.discountCents,
        paidCents: chargePaidSql,
        planName: plans.name,
        spaceName: spaces.name,
      })
      .from(subscriptionCharges)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .innerJoin(spaces, eq(spaces.id, subscriptions.spaceId))
      .where(eq(subscriptionCharges.id, chargeId));
    return (
      row && { ...row, dueCents: Math.max(row.amountCents - row.discountCents - row.paidCents, 0) }
    );
  }
}
