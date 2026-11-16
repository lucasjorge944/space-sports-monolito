import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider';
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
import { AuthController, OAuthServerMetadataController } from './auth.controller.js';
import { type Auth, createAuth } from './auth.js';
import { AuthService } from './auth.service.js';
import { AUTH, AUTH_OPENAPI, CIMD_FETCH, SMS_SENDER } from './auth.tokens.js';
import { AuthGuard } from './guards/auth.guard.js';
import { SpaceRolesGuard } from './guards/space-roles.guard.js';
import { SuperGuard } from './guards/super.guard.js';
import { OAuthAccessService } from './oauth-access.service.js';
import { OAuthOriginInterceptor } from './oauth-origin.interceptor.js';
import { createSmsSender, type SmsSender } from './sms-sender.js';
import { SupportModeInterceptor } from './support-mode.interceptor.js';

/**
 * Autenticação (Better Auth em /v1/auth) e autorização: o AuthGuard global exige sessão em toda
 * rota não `@Public()`; `@SuperOnly()` e `@SpaceRoles()`/`@SpacePermission()` checam os papéis.
 */
@Global()
@Module({
  controllers: [AuthController, OAuthServerMetadataController],
  providers: [
    { provide: SMS_SENDER, inject: [ENV], useFactory: (env: Env) => createSmsSender(env) },
    { provide: CIMD_FETCH, useValue: fetchClientMetadataResource },
    {
      provide: AUTH,
      inject: [ENV, DB, Mailer, SMS_SENDER, REDIS, DomainEvents, PhotoStorage, CIMD_FETCH],
      useFactory: (
        env: Env,
        db: Database,
        mailer: Mailer,
        sms: SmsSender | null,
        redis: Redis,
        events: DomainEvents,
        storage: PhotoStorage,
        cimdFetch: ClientMetadataResourceFetch,
      ) => createAuth({ env, db, mailer, sms, redis, events, storage, cimdFetch }),
    },
    {
      provide: AUTH_OPENAPI,
      inject: [AUTH],
      useFactory: (auth: Auth) => auth.api.generateOpenAPISchema(),
    },
    AuthService,
    OAuthAccessService,
    SuperGuard,
    SpaceRolesGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: SupportModeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: OAuthOriginInterceptor },
  ],
  exports: [AUTH, AUTH_OPENAPI, AuthService, SuperGuard, SpaceRolesGuard],
})
export class AuthModule {}
