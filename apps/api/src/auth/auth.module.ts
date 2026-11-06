import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import type { Database } from '../db/client.js';
import { DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { REDIS } from '../infra/redis.module.js';
import { Mailer } from '../mail/mailer.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import { AuthController } from './auth.controller.js';
import { type Auth, createAuth } from './auth.js';
import { AuthService } from './auth.service.js';
import { AUTH, AUTH_OPENAPI, SMS_SENDER } from './auth.tokens.js';
import { AuthGuard } from './guards/auth.guard.js';
import { SpaceRolesGuard } from './guards/space-roles.guard.js';
import { SuperGuard } from './guards/super.guard.js';
import { createSmsSender, type SmsSender } from './sms-sender.js';
import { SupportModeInterceptor } from './support-mode.interceptor.js';

/**
 * Autenticação (Better Auth em /v1/auth) e autorização: o AuthGuard global exige sessão em toda
 * rota não `@Public()`; `@SuperOnly()` e `@SpaceRoles()`/`@SpacePermission()` checam os papéis.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    { provide: SMS_SENDER, inject: [ENV], useFactory: (env: Env) => createSmsSender(env) },
    {
      provide: AUTH,
      inject: [ENV, DB, Mailer, SMS_SENDER, REDIS, DomainEvents, PhotoStorage],
      useFactory: (
        env: Env,
        db: Database,
        mailer: Mailer,
        sms: SmsSender | null,
        redis: Redis,
        events: DomainEvents,
        storage: PhotoStorage,
      ) => createAuth({ env, db, mailer, sms, redis, events, storage }),
    },
    {
      provide: AUTH_OPENAPI,
      inject: [AUTH],
      useFactory: (auth: Auth) => auth.api.generateOpenAPISchema(),
    },
    AuthService,
    SuperGuard,
    SpaceRolesGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: SupportModeInterceptor },
  ],
  exports: [AUTH, AUTH_OPENAPI, AuthService, SuperGuard, SpaceRolesGuard],
})
export class AuthModule {}
