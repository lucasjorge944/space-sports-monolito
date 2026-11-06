import { Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { BookingNotifier } from './booking-notifier.js';
import { BookingRemindersService } from './booking-reminders.service.js';
import { BullNotificationQueue } from './bull-notification-queue.js';
import { ClassNotifier } from './class-notifier.js';
import { NotificationEvents } from './notification-events.js';
import { MemoryNotificationQueue, NotificationQueue } from './notification-queue.js';
import {
  DevicesController,
  NotificationPreferencesController,
  NotificationsController,
} from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { PaymentNotifier } from './payment-notifier.js';
import { PushDeliveryService } from './push-delivery.service.js';
import { ExpoPushSender, PushSender } from './push-sender.js';
import { ReviewNotifier } from './review-notifier.js';
import { ReviewRequestsService } from './review-requests.service.js';
import { SubscriptionNotifier } from './subscription-notifier.js';

/**
 * Notificações (RF-NOTIF-01, RF-NOTIF-04): central do usuário, preferências, tokens de push,
 * envio via Expo pela fila BullMQ e os jobs de lembretes e de pedidos de avaliação. Assina os eventos de domínio; os
 * módulos de negócio só publicam em `DomainEvents`.
 */
@Module({
  controllers: [DevicesController, NotificationsController, NotificationPreferencesController],
  providers: [
    { provide: PushSender, inject: [ENV], useFactory: (env: Env) => new ExpoPushSender(env) },
    {
      provide: NotificationQueue,
      inject: [ENV, ModuleRef],
      useFactory: (env: Env, moduleRef: ModuleRef) =>
        env.JOBS_ENABLED
          ? new BullNotificationQueue(env, moduleRef)
          : new MemoryNotificationQueue(),
    },
    NotificationsService,
    PushDeliveryService,
    BookingNotifier,
    ClassNotifier,
    BookingRemindersService,
    SubscriptionNotifier,
    PaymentNotifier,
    ReviewNotifier,
    ReviewRequestsService,
    NotificationEvents,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
