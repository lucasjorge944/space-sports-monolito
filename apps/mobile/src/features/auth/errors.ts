import { isApiError } from '@space-sports/api-client';

const GENERIC_MESSAGE = 'Algo deu errado. Tente novamente.';
const NETWORK_MESSAGE = 'Sem conexão com o servidor. Verifique sua internet e tente de novo.';

/**
 * Mensagens em PT-BR por `code` do erro da API. Os códigos do Better Auth chegam em maiúsculas
 * (o AuthController converte para o formato padrão), mais os da própria API.
 */
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  // Login e cadastro
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  INVALID_PASSWORD: 'Senha incorreta.',
  INVALID_EMAIL: 'Confira o e-mail',
  USER_NOT_FOUND: 'Conta não encontrada.',
  USER_EMAIL_NOT_FOUND: 'Não encontramos um e-mail nesta conta.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'Esta conta não usa senha. Entre com outro método.',
  USER_ALREADY_EXISTS: 'Já existe uma conta com este e-mail',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Já existe uma conta com este e-mail',
  PASSWORD_TOO_SHORT: 'A senha precisa ter pelo menos 8 caracteres.',
  PASSWORD_TOO_LONG: 'A senha é longa demais (máximo de 128 caracteres).',
  EMAIL_NOT_VERIFIED: 'Confirme seu e-mail para continuar.',
  EMAIL_ALREADY_VERIFIED: 'Este e-mail já foi confirmado.',
  FAILED_TO_CREATE_USER: 'Não foi possível criar a conta. Tente novamente.',
  FAILED_TO_CREATE_SESSION: 'Não foi possível iniciar a sessão. Tente novamente.',
  FAILED_TO_GET_SESSION: 'Não foi possível carregar sua sessão. Entre novamente.',
  USER_BLOCKED: 'Sua conta está bloqueada. Fale com o suporte.',
  ACCOUNT_INACTIVE:
    'Conta inativa. Para reativá-la, fale com o espaço ou com o suporte da plataforma.',
  // Redefinição de senha e links
  INVALID_TOKEN: 'O link é inválido ou já foi usado. Peça um novo.',
  TOKEN_EXPIRED: 'O link expirou. Peça um novo.',
  // Login social
  PROVIDER_NOT_FOUND: 'Este método de entrada não está disponível.',
  SOCIAL_ACCOUNT_ALREADY_LINKED: 'Esta conta já está vinculada a outro usuário.',
  FAILED_TO_GET_USER_INFO: 'Não conseguimos obter seus dados do provedor. Tente novamente.',
  ACCOUNT_NOT_FOUND: 'Conta não encontrada.',
  // Telefone do cadastro e do perfil (decisão 64; o login por telefone está desligado, decisão 65)
  INVALID_PHONE_NUMBER: 'Informe o telefone com DDD',
  // Perfil e foto (RF-AUTH-02)
  SPORT_NOT_FOUND: 'Um dos esportes escolhidos não está mais disponível. Atualize a lista.',
  IMAGE_NOT_ALLOWED: 'A foto só pode ser trocada pelo botão da foto.',
  IMAGE_TOO_LARGE: 'A foto passa de 2 MB. Escolha outra imagem.',
  IMAGE_NOT_SQUARE: 'A foto precisa ser quadrada. Recorte e tente de novo.',
  INVALID_IMAGE_FILE: 'Não conseguimos ler esta imagem. Use uma foto JPG, PNG ou WebP.',
  INVALID_UPLOAD_KEY: 'O envio da foto expirou. Tente de novo.',
  UPLOAD_NOT_FOUND: 'O envio da foto não terminou. Tente de novo.',
  STORAGE_UNAVAILABLE: 'O envio de fotos está indisponível no momento. Tente mais tarde.',
  // Origem/callback (configuração do app ou da API)
  INVALID_ORIGIN: 'Não foi possível validar o app com o servidor.',
  MISSING_OR_NULL_ORIGIN: 'Não foi possível validar o app com o servidor.',
  INVALID_CALLBACK_URL: 'Não foi possível validar o app com o servidor.',
  INVALID_REDIRECT_URL: 'Não foi possível validar o app com o servidor.',
  // API
  VALIDATION_ERROR: 'Confira os dados informados.',
  MISSING_FIELD: 'Preencha todos os campos.',
  UNAUTHENTICATED: 'Sua sessão expirou. Entre novamente.',
  SESSION_EXPIRED: 'Sua sessão expirou. Entre novamente.',
  FORBIDDEN: 'Você não tem permissão para isso.',
  TOO_MANY_REQUESTS: 'Muitas tentativas. Aguarde um instante e tente de novo.',
  INTERNAL_SERVER_ERROR: 'O servidor teve um problema. Tente novamente em instantes.',
  BAD_GATEWAY: 'O servidor está indisponível. Tente novamente em instantes.',
  SERVICE_UNAVAILABLE: 'O servidor está indisponível. Tente novamente em instantes.',
  GATEWAY_TIMEOUT: 'O servidor demorou para responder. Tente novamente.',
};

/** Erro de rede do `fetch` (offline, DNS, timeout): não é um `ApiError`. */
export function isNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      /network|failed to fetch|fetch failed|timed out/i.test(error.message))
  );
}

interface ErrorInfo {
  code: string | null;
  status: number | null;
}

/** `ApiError` do cliente da API ou erro do cliente do Better Auth (`{ status, code?, message }`). */
function errorInfo(error: unknown): ErrorInfo | null {
  if (isApiError(error)) return { code: error.code, status: error.status };
  if (error && typeof error === 'object' && !(error instanceof Error)) {
    const { code, status } = error as { code?: unknown; status?: unknown };
    if (typeof code === 'string' || typeof status === 'number') {
      return {
        code: typeof code === 'string' ? code : null,
        status: typeof status === 'number' ? status : null,
      };
    }
  }
  return null;
}

const FIELD_BY_CODE: Record<string, 'email' | 'phone'> = {
  INVALID_EMAIL: 'email',
  USER_ALREADY_EXISTS: 'email',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'email',
  INVALID_PHONE_NUMBER: 'phone',
};

/** `code` do erro (da API ou do cliente do Better Auth), em maiúsculas; `null` se não houver. */
export function authErrorCode(error: unknown): string | null {
  return errorInfo(error)?.code?.toUpperCase() ?? null;
}

/** Campo a que o erro da API pertence (doc 05): com campo, a mensagem entra nele, não no topo. */
export function authErrorField(error: unknown): 'email' | 'phone' | null {
  const code = errorInfo(error)?.code;
  return (code && FIELD_BY_CODE[code.toUpperCase()]) || null;
}

/** Mensagem em PT-BR para qualquer erro de chamada de auth, nunca o texto cru (em inglês) da API. */
export function authErrorMessage(error: unknown): string {
  const info = errorInfo(error);
  if (info) {
    const byCode = info.code ? AUTH_ERROR_MESSAGES[info.code.toUpperCase()] : undefined;
    if (byCode) return byCode;
    if (info.status === 404) return 'Este recurso não está disponível no momento.';
    if (info.status === 429) return AUTH_ERROR_MESSAGES.TOO_MANY_REQUESTS as string;
    if (info.status !== null && info.status >= 500) {
      return AUTH_ERROR_MESSAGES.INTERNAL_SERVER_ERROR as string;
    }
    return GENERIC_MESSAGE;
  }
  if (isNetworkError(error)) return NETWORK_MESSAGE;
  return GENERIC_MESSAGE;
}
