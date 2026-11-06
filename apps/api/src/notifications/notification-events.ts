import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DomainEvents } from '../events/domain-events.js';
import { BookingNotifier } from './booking-notifier.js';
import { ClassNotifier } from './class-notifier.js';
import { PaymentNotifier } from './payment-notifier.js';
import { ReviewNotifier } from './review-notifier.js';
import { SubscriptionNotifier } from './subscription-notifier.js';

/** Liga os eventos de domínio às notificações (RF-NOTIF-01). */
@Injectable()
export class NotificationEvents implements OnModuleInit {
  constructor(
    private readonly events: DomainEvents,
    private readonly bookings: BookingNotifier,
    private readonly subscriptions: SubscriptionNotifier,
    private readonly classes: ClassNotifier,
    private readonly payments: PaymentNotifier,
    private readonly reviews: ReviewNotifier,
  ) {}

  onModuleInit(): void {
    this.events.subscribe('booking.confirmed', (e) => this.bookings.confirmed(e.bookingId));
    this.events.subscribe('booking.cancelled', (e) =>
      this.bookings.cancelled(e.bookingId, e.cancelledBy),
    );
    this.events.subscribe('booking.updated', (e) =>
      this.bookings.updated(e.bookingId, e.updatedBy),
    );
    this.events.subscribe('booking.invite_created', (e) =>
      this.bookings.invited(e.bookingId, e.inviteeUserId),
    );
    this.events.subscribe('booking.invite_answered', (e) =>
      this.bookings.inviteAnswered(e.bookingId, e.participantId, e.accepted),
    );
    this.events.subscribe('booking.linked', (e) => this.bookings.linked(e.bookingId, e.userId));
    this.events.subscribe('recurring.approved', (e) =>
      this.bookings.recurringDecided(e.recurringBookingId, true),
    );
    this.events.subscribe('recurring.rejected', (e) =>
      this.bookings.recurringDecided(e.recurringBookingId, false),
    );
    this.events.subscribe('subscription.approved', (e) =>
      this.subscriptions.decided(e.subscriptionId, true),
    );
    this.events.subscribe('subscription.rejected', (e) =>
      this.subscriptions.decided(e.subscriptionId, false),
    );
    this.events.subscribe('subscription.cancelled', (e) =>
      this.subscriptions.cancelled(e.subscriptionId),
    );
    this.events.subscribe('subscription.cancel_resumed', (e) =>
      this.subscriptions.cancelResumed(e.subscriptionId),
    );
    this.events.subscribe('subscription_charge.due_soon', (e) =>
      this.subscriptions.chargeDueSoon(e.chargeId),
    );
    this.events.subscribe('subscription_charge.overdue', (e) =>
      this.subscriptions.chargeOverdue(e.chargeId),
    );
    this.events.subscribe('class_session.opened', (e) => this.classes.listOpened(e.sessionId));
    this.events.subscribe('class_attendance.promoted', (e) =>
      this.classes.promoted(e.sessionId, e.userId),
    );
    this.events.subscribe('class_session.cancelled', (e) =>
      this.classes.cancelled(e.sessionId, e.cancelledBy),
    );
    // Pagamento online (RF-ONPAY).
    this.events.subscribe('online_payment.paid', (e) => this.payments.paid(e.chargeId));
    this.events.subscribe('online_payment.expired', (e) => this.payments.expired(e.chargeId));
    this.events.subscribe('booking.payment_expired', (e) => this.payments.holdExpired(e.bookingId));
    this.events.subscribe('online_payment.refunded', (e) => this.payments.refunded(e.refundId));
    this.events.subscribe('online_payment.chargeback', (e) => this.payments.chargeback(e.refundId));
    this.events.subscribe('merchant_account.decided', (e) =>
      this.payments.merchantDecided(e.spaceId, e.approved),
    );
    this.events.subscribe('merchant_account.payout_changed', (e) =>
      this.payments.payoutChanged(e.spaceId, e.changedBy),
    );
    this.events.subscribe('merchant_account.payout_change_rejected', (e) =>
      this.payments.payoutChangeRejected(e.spaceId),
    );
    this.events.subscribe('payout.failed', (e) => this.payments.payoutFailed(e.payoutId));
    // Avaliações (RF-REVIEW-09).
    this.events.subscribe('review.created', (e) => this.reviews.created(e.reviewId));
    this.events.subscribe('review.replied', (e) => this.reviews.replied(e.reviewId));
  }
}
