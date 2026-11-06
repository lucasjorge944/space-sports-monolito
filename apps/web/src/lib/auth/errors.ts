/**
 * Mensagens em PT-BR para os erros do Better Auth. O código vem da API (`error.code`, sempre em
 * maiúsculas) ou do parâmetro `?error=` dos redirecionamentos de e-mail (ex.: `invalid_token`).
 */
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  INVALID_PASSWORD: 'Senha incorreta.',
  INVALID_EMAIL: 'Informe um e-mail válido.',
  USER_NOT_FOUND: 'Conta não encontrada.',
  ACCOUNT_NOT_FOUND: 'Conta não encontrada.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'Esta conta não tem senha. Entre com Google ou Apple.',
  USER_ALREADY_EXISTS: 'Já existe uma conta com este e-mail.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Já existe uma conta com este e-mail.',
  PASSWORD_TOO_SHORT: 'A senha deve ter pelo menos 8 caracteres.',
  PASSWORD_TOO_LONG: 'A senha deve ter no máximo 128 caracteres.',
  EMAIL_NOT_VERIFIED: 'Confirme seu e-mail para entrar.',
  EMAIL_ALREADY_VERIFIED: 'Este e-mail já foi confirmado.',
  INVALID_TOKEN: 'O link é inválido ou já foi usado. Peça um novo.',
  TOKEN_EXPIRED: 'O link expirou. Peça um novo.',
  USER_BLOCKED: 'Sua conta está bloqueada. Fale com o suporte.',
  ACCOUNT_INACTIVE:
    'Conta inativa. Para reativá-la, fale com o espaço ou com o suporte da plataforma.',
  SESSION_EXPIRED: 'Sua sessão expirou. Entre novamente.',
  PROVIDER_NOT_FOUND: 'Este método de login não está disponível.',
  PROVIDER_NOT_CONFIGURED: 'Este método de login não está disponível.',
  FAILED_TO_GET_USER_INFO: 'Não foi possível obter seus dados no provedor. Tente novamente.',
  USER_EMAIL_NOT_FOUND: 'O provedor não informou um e-mail. Use outro método de login.',
  LINKING_NOT_ALLOWED: 'Já existe uma conta com este e-mail. Entre com e-mail e senha.',
  LINKING_DIFFERENT_EMAILS_NOT_ALLOWED: 'Já existe uma conta com este e-mail.',
  ACCOUNT_NOT_LINKED: 'Já existe uma conta com este e-mail. Entre com e-mail e senha.',
  OAUTH_LINK_ERROR: 'Não foi possível entrar com o provedor. Tente novamente.',
  ACCESS_DENIED: 'O acesso foi cancelado. Tente novamente.',
  EMAIL_PASSWORD_DISABLED: 'O login com e-mail e senha está indisponível.',
  EMAIL_PASSWORD_SIGN_UP_DISABLED: 'O cadastro está indisponível no momento.',
  RESET_PASSWORD_DISABLED: 'A redefinição de senha está indisponível.',
  VALIDATION_ERROR: 'Confira os dados informados.',
  INVALID_PHONE_NUMBER: 'Informe um telefone brasileiro com DDD.',
  IMAGE_NOT_ALLOWED: 'A foto só pode ser trocada pelo envio de imagem.',
  MISSING_FIELD: 'Preencha todos os campos.',
  INVALID_ORIGIN: 'Origem não autorizada. Recarregue a página e tente novamente.',
  MISSING_OR_NULL_ORIGIN: 'Origem não autorizada. Recarregue a página e tente novamente.',
  INVALID_CALLBACK_URL: 'Endereço de retorno inválido. Tente novamente.',
  INVALID_REDIRECT_URL: 'Endereço de retorno inválido. Tente novamente.',
  TOO_MANY_REQUESTS: 'Muitas tentativas. Aguarde um pouco e tente novamente.',
  UNAUTHENTICATED: 'Faça login para continuar.',
  UNAUTHORIZED: 'Faça login para continuar.',
  FAILED_TO_CREATE_USER: 'Não foi possível criar a conta. Tente novamente.',
  FAILED_TO_CREATE_SESSION: 'Não foi possível iniciar a sessão. Tente novamente.',
  INTERNAL_SERVER_ERROR: 'Erro no servidor. Tente novamente em instantes.',
  INTERNAL_ERROR: 'Erro no servidor. Tente novamente em instantes.',
};

export const NETWORK_ERROR_MESSAGE =
  'Não foi possível conectar. Verifique sua internet e tente de novo.';
export const FALLBACK_ERROR_MESSAGE = 'Não foi possível concluir. Tente novamente.';

/** Normaliza `invalid_token`, `Invalid-Token` etc. para `INVALID_TOKEN`. */
export function normalizeAuthErrorCode(code: string): string {
  return code
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

/** Mensagem PT-BR de um código de erro conhecido; `undefined` se não houver tradução. */
export function messageForCode(code: string | null | undefined): string | undefined {
  return code ? MESSAGES[normalizeAuthErrorCode(code)] : undefined;
}

type ErrorLike = {
  code?: unknown;
  status?: unknown;
  /** Formato padrão da API: `{ error: { code, message } }`, que o client do Better Auth repassa. */
  error?: { code?: unknown } | null;
};

/**
 * Extrai o `code` do erro devolvido pelo client do Better Auth. A API responde no formato padrão
 * (`{ error: { code, message } }`), então o código chega em `error.error.code`; o formato nativo
 * (`error.code`) também é aceito.
 */
export function getAuthErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { code, error: nested } = error as ErrorLike;
  if (typeof nested?.code === 'string' && nested.code) return nested.code;
  if (typeof code === 'string' && code) return code;
  return undefined;
}

/** Texto PT-BR para mostrar ao usuário a partir de um erro do client do Better Auth. */
export function authErrorMessage(error: unknown): string {
  const code = getAuthErrorCode(error);
  const byCode = messageForCode(code);
  if (byCode) return byCode;
  const status = error && typeof error === 'object' ? (error as ErrorLike).status : undefined;
  if (status === 429) return MESSAGES.TOO_MANY_REQUESTS as string;
  if (status === 0) return NETWORK_ERROR_MESSAGE;
  if (typeof status === 'number' && status >= 500) return MESSAGES.INTERNAL_SERVER_ERROR as string;
  return FALLBACK_ERROR_MESSAGE;
}

/** Erro de rede/exceção (o client do Better Auth lança em falha de conexão). */
export function thrownErrorMessage(error: unknown): string {
  return error instanceof TypeError ? NETWORK_ERROR_MESSAGE : FALLBACK_ERROR_MESSAGE;
}
