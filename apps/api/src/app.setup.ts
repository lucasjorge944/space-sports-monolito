import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { SUPPORT_MODE_HEADER, SUPPORT_SESSION_HEADER } from '@space-sports/shared';
import { Logger } from 'nestjs-pino';
import { AUTH_OPENAPI } from './auth/auth.tokens.js';
import { mergeAuthOpenApi } from './auth/auth-openapi.js';
import { ErrorResponseDto } from './common/error-response.js';
import type { Env } from './config/env.js';
import { ENV } from './config/env.module.js';
import { REQUEST_ID_HEADER } from './logger/logger.options.js';
import { mergeZodComponents } from './openapi/zod-openapi.js';

export const API_PREFIX = 'v1';

/** Opções de criação da app; o body parser é registrado no AppModule, depois do logger. */
export const APP_OPTIONS: NestApplicationOptions = { bufferLogs: true, bodyParser: false };

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Space Sports API')
    .setDescription(
      [
        'API do Space Sports. Erros seguem o formato `{ error: { code, message, details? }, requestId }`.',
        '',
        'Autenticação (Better Auth, tag `auth`): o web usa o cookie de sessão; o app usa',
        '`Authorization: Bearer <token>`, com o token do header `set-auth-token` (ou do campo',
        '`token`) devolvido no login.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ErrorResponseDto],
    operationIdFactory,
  });
  return mergeAuthOpenApi(mergeZodComponents(document), app.get(AUTH_OPENAPI));
}

/**
 * operationId vira o nome das funções e hooks do cliente orval (ex.: `getMe` → `useGetMe`).
 * Prefira um explícito em `@ApiOperation({ operationId })`; sem ele, `SpacesController.findAll`
 * vira `spacesFindAll` (em vez do `SpacesController_findAll` padrão do Nest).
 */
export function operationIdFactory(controllerKey: string, methodKey: string): string {
  const controller = controllerKey.replace(/Controller$/, '');
  return `${controller.charAt(0).toLowerCase()}${controller.slice(1)}${methodKey.charAt(0).toUpperCase()}${methodKey.slice(1)}`;
}

/** Configuração comum ao boot real e aos testes e2e. */
export function setupApp(app: INestApplication): INestApplication {
  app.useLogger(app.get(Logger));
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  // CORS só para as origens web confiáveis (os esquemas do app, como spacesports://, ficam de fora).
  const origins = app.get<Env>(ENV).TRUSTED_ORIGINS.filter((origin) => /^https?:\/\//.test(origin));
  if (origins.length) {
    app.enableCors({
      origin: origins,
      credentials: true,
      exposedHeaders: [
        'set-auth-token',
        REQUEST_ID_HEADER,
        SUPPORT_MODE_HEADER,
        SUPPORT_SESSION_HEADER,
      ],
    });
  }

  // /docs (Swagger UI) e /docs-json (fonte do orval) ficam fora do prefixo /v1.
  SwaggerModule.setup('docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'docs-json',
  });
  return app;
}
