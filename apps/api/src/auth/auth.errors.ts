import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';

/** Mensagem do login e das rotas para a conta inativa (a mesma nos dois caminhos). */
export const ACCOUNT_INACTIVE_MESSAGE =
  'Conta inativa. Para reativá-la, fale com o espaço ou com o suporte da plataforma.';

export const unauthenticated = () =>
  new AppException({
    status: HttpStatus.UNAUTHORIZED,
    code: 'UNAUTHENTICATED',
    message: 'Faça login para continuar.',
  });

export const userBlocked = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'USER_BLOCKED',
    message: 'Conta bloqueada.',
  });

/** RF-AUTH-03: conta inativada pelo titular no app; só o Super reativa. */
export const accountInactive = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'ACCOUNT_INACTIVE',
    message: ACCOUNT_INACTIVE_MESSAGE,
  });

export const superRequired = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'SUPER_REQUIRED',
    message: 'Acesso restrito à equipe da plataforma.',
  });

export const spaceForbidden = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'SPACE_FORBIDDEN',
    message: 'Você não tem permissão para esta ação neste espaço.',
  });

export const spaceReadOnly = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'SPACE_READ_ONLY',
    message: 'Este espaço está suspenso ou encerrado: o painel está em modo somente leitura.',
  });

export const supportSessionInvalid = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'SUPPORT_SESSION_INVALID',
    message: 'Sessão de suporte inválida, expirada ou de outro espaço.',
  });

// Token OAuth do MCP (decisões 112 e 113; RN-MCP-01, RN-MCP-04).

/** `MCP_ENABLED=false`: todo token do MCP e o servidor de autorização ficam fora do ar. */
export const mcpDisabled = () =>
  new AppException({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    code: 'MCP_DISABLED',
    message: 'O acesso por assistentes de IA está desligado no momento.',
  });

/** Token do MCP inválido: assinatura, emissor, audiência, validade ou conexão revogada. */
export const oauthTokenInvalid = () =>
  new AppException({
    status: HttpStatus.UNAUTHORIZED,
    code: 'OAUTH_TOKEN_INVALID',
    message: 'Token de acesso inválido ou expirado. Conecte o assistente de novo.',
  });

/** Token do MCP em rota fora da lista permitida (docs/14-mcp.md 3.3). */
export const oauthRouteNotAllowed = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'OAUTH_ROUTE_NOT_ALLOWED',
    message:
      'Esta ação não está disponível para assistentes conectados. Use o app do Space Sports.',
  });

export const oauthInsufficientScope = (required: readonly string[]) =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'OAUTH_INSUFFICIENT_SCOPE',
    message: 'O assistente não tem permissão para esta ação. Conecte de novo e autorize o acesso.',
    details: { requiredScopes: required },
  });

/** Decisão 115: pagamento com cartão nunca pelo assistente; só no espaço ou Pix. */
export const oauthPaymentOptionNotAllowed = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'OAUTH_PAYMENT_OPTION_NOT_ALLOWED',
    message: 'Pelo assistente, pague no espaço ou com Pix. Cartão só pelo app do Space Sports.',
  });

/**
 * Decisão 119 (defesa em profundidade, BUG-MCP-2): pelo assistente, a reserva exige nome e telefone
 * do organizador, como o consentimento. `details.missing` segue `profile.missing` do GET /v1/me.
 */
export const profileIncomplete = (missing: readonly string[]) =>
  new AppException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: 'PROFILE_INCOMPLETE',
    message:
      'Complete seu cadastro (nome e telefone) no app do Space Sports para reservar pelo assistente.',
    details: { missing },
  });

/**
 * Resposta de gestão ou do Super que não bate com a lista de campos permitidos (decisão 122): nunca
 * sai pelo MCP. Quem lança registra no log a rota e os campos divergentes.
 */
export const oauthViewMismatch = () =>
  new AppException({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: 'Erro interno do servidor.',
  });
