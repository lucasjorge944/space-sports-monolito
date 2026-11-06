import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import express from 'express';
import { LoggerModule } from 'nestjs-pino';
import { AddressModule } from './address/address.module.js';
import { AdsModule } from './ads/ads.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { ClassesModule } from './classes/classes.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { jsonBody } from './common/json-body.middleware.js';
import type { Env } from './config/env.js';
import { EnvModule } from './config/env.module.js';
import { ContactsModule } from './contacts/contacts.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthModule } from './health/health.module.js';
import { DatabaseModule } from './infra/database.module.js';
import { RedisModule } from './infra/redis.module.js';
import { loggerOptions } from './logger/logger.options.js';
import { MailModule } from './mail/mail.module.js';
import { MeModule } from './me/me.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { RecurringModule } from './recurring/recurring.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { SpacesModule } from './spaces/spaces.module.js';
import { StorageModule } from './storage/storage.module.js';
import { SuperModule } from './super/super.module.js';
import { TeamModule } from './team/team.module.js';

@Module({})
export class AppModule implements NestModule {
  static register(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EnvModule.register(env),
        LoggerModule.forRoot(loggerOptions(env)),
        DatabaseModule,
        RedisModule,
        StorageModule,
        EventsModule,
        MailModule,
        PaymentsModule.register(env),
        AuthModule,
        HealthModule,
        AddressModule,
        MeModule,
        ContactsModule,
        BookingsModule,
        NotificationsModule,
        SpacesModule,
        SuperModule,
        RecurringModule,
        TeamModule,
        ClassesModule,
        AdsModule,
        ReviewsModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    };
  }

  /**
   * O body parser padrão do Nest roda antes de qualquer middleware, então um JSON malformado
   * escapava do pino-http (sem log e sem requestId). Com `bodyParser: false` no boot, ele é
   * registrado aqui; o Nest aplica antes os middlewares de módulos globais (o LoggerModule).
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(jsonBody, express.urlencoded({ extended: true }))
      .forRoutes({ path: '{/*splat}', method: RequestMethod.ALL });
  }
}
