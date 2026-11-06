import { Injectable, Logger } from '@nestjs/common';

/**
 * Fatos que já aconteceram no domínio. Os módulos de negócio (reservas, mensalistas…) só
 * publicam; quem reage (notificações, no futuro auditoria ou métricas) assina. Os payloads
 * levam ids: o assinante lê o que precisa do banco, já com a transação do publicador confirmada.
 */
export type DomainEvent =
  /** Reserva criada e confirmada (app ou balcão). */
  | { type: 'booking.confirmed'; bookingId: string }
  /** Reserva cancelada pelo organizador ou pela gestão; `cancelledBy` é quem cancelou. */
  | { type: 'booking.cancelled'; bookingId: string; cancelledBy: string }
  /** Reserva editada pelo organizador (RF-BOOK-03); `updatedBy` é quem editou. */
  | { type: 'booking.updated'; bookingId: string; updatedBy: string }
  /**
   * Usuário convidado a dividir a conta (RF-BOOK-04): pela busca de usuários ou porque o convite
   * pendente passou para a conta dele (RF-CONTACT-04, RF-CONTACT-05).
   */
  | { type: 'booking.invite_created'; bookingId: string; inviteeUserId: string }
  /** Convidado sem conta respondeu pela página pública (RF-CONTACT-02). */
  | {
      type: 'booking.invite_answered';
      bookingId: string;
      participantId: string;
      accepted: boolean;
    }
  /** A reserva passou para a conta do usuário e entrou em Minhas reservas (RF-CONTACT-04). */
  | { type: 'booking.linked'; bookingId: string; userId: string }
  /** A conta acabou de ficar com o e-mail verificado (link, login social ou conta social ligada). */
  | { type: 'user.email_verified'; userId: string }
  /** Solicitação de mensalista aprovada ou recusada pela gestão (tarefa 1.3). */
  | { type: 'recurring.approved'; recurringBookingId: string }
  | { type: 'recurring.rejected'; recurringBookingId: string }
  /** Pedido de assinatura de aula aprovado ou recusado pela gestão (RF-CLASS-05, tarefa 2.2). */
  | { type: 'subscription.approved'; subscriptionId: string }
  | { type: 'subscription.rejected'; subscriptionId: string }
  /** Assinatura em curso cancelada pelo aluno ou pela gestão: com acesso até `ends_on` (RN-CLASS-08). */
  | { type: 'subscription.cancelled'; subscriptionId: string }
  /** A gestão desfez o cancelamento: a assinatura volta ao ciclo normal (RN-CLASS-08). */
  | { type: 'subscription.cancel_resumed'; subscriptionId: string }
  /** Mensalidade de aula vence nos próximos dias / venceu sem pagamento (job de lembretes). */
  | { type: 'subscription_charge.due_soon'; chargeId: string }
  | { type: 'subscription_charge.overdue'; chargeId: string }
  /** Lista de presença da aula aberta (pelo job ou pela gestão; reabrir não conta). */
  | { type: 'class_session.opened'; sessionId: string }
  /** Aula cancelada pela gestão (RF-CLASS-09); `cancelledBy` é quem cancelou. */
  | { type: 'class_session.cancelled'; sessionId: string; cancelledBy: string }
  /** Aluno saiu da espera e ficou confirmado (RF-CLASS-10). */
  | { type: 'class_attendance.promoted'; sessionId: string; userId: string }
  /** Pagamento online confirmado e registrado no item (RN-ONPAY-04). */
  | { type: 'online_payment.paid'; chargeId: string }
  /** Pix vencido sem pagamento. */
  | { type: 'online_payment.expired'; chargeId: string }
  /** Reserva `PENDING_PAYMENT` cancelada pelo prazo do pagamento (RN-ONPAY-02). */
  | { type: 'booking.payment_expired'; bookingId: string }
  /** Estorno concluído no gateway (manual ou automático, RN-ONPAY-05). */
  | { type: 'online_payment.refunded'; refundId: string }
  /** Chargeback recebido (RN-ONPAY-06): a gestão é avisada. */
  | { type: 'online_payment.chargeback'; refundId: string }
  /** Cadastro do espaço no gateway aprovado ou recusado (RF-ONPAY-01). */
  | { type: 'merchant_account.decided'; spaceId: string; approved: boolean }
  /** O Dono trocou a conta de recebimento: repasses pausados até a aprovação (decisão 95). */
  | { type: 'merchant_account.payout_changed'; spaceId: string; changedBy: string }
  /** A troca da conta foi recusada: volta a valer a conta anterior e os Donos são avisados (decisão 98). */
  | { type: 'merchant_account.payout_change_rejected'; spaceId: string }
  /** Repasse para a conta do espaço falhou. */
  | { type: 'payout.failed'; payoutId: string }
  /** Espaço suspenso ou encerrado pelo Super: as cobranças abertas são canceladas (RN-ONPAY-09). */
  | { type: 'space.deactivated'; spaceId: string }
  /**
   * Primeira avaliação da pessoa no espaço (nem a edição, nem a recriação depois de excluir): Dono e
   * Admin são avisados (RF-REVIEW-09).
   */
  | { type: 'review.created'; reviewId: string }
  /** Primeira resposta do espaço a esta avaliação (nem a edição, nem a refeita): avisa o autor. */
  | { type: 'review.replied'; reviewId: string };

export type DomainEventType = DomainEvent['type'];
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;
export type DomainEventHandler<T extends DomainEventType> = (
  event: DomainEventOf<T>,
) => Promise<void>;

/**
 * Publicação de eventos de domínio. Classe abstrata para servir de token de injeção. Publicar
 * nunca falha: um assinante com erro é logado e não derruba a operação que já foi confirmada.
 */
export abstract class DomainEvents {
  abstract publish(event: DomainEvent): Promise<void>;
  abstract subscribe<T extends DomainEventType>(type: T, handler: DomainEventHandler<T>): void;
}

/** Barramento em memória, no mesmo processo; os assinantes rodam em série. */
@Injectable()
export class InProcessDomainEvents extends DomainEvents {
  private readonly logger = new Logger('DomainEvents');
  private readonly handlers = new Map<DomainEventType, ((event: DomainEvent) => Promise<void>)[]>();

  subscribe<T extends DomainEventType>(type: T, handler: DomainEventHandler<T>): void {
    const list = this.handlers.get(type) ?? [];
    // O tipo do evento já foi casado com o do handler em `subscribe`/`publish`.
    list.push(handler as unknown as (event: DomainEvent) => Promise<void>);
    this.handlers.set(type, list);
  }

  async publish(event: DomainEvent): Promise<void> {
    for (const handler of this.handlers.get(event.type) ?? []) {
      try {
        await handler(event);
      } catch (err) {
        this.logger.error({ err, event }, 'Falha ao tratar evento de domínio');
      }
    }
  }
}
