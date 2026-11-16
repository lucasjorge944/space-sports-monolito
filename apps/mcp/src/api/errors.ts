import { isApiError } from '@space-sports/api-client/dist/fetch.js';
import { ToolError } from '../mcp/tool-error.js';

/**
 * Orientação para o assistente por código de erro da API. Quando não há entrada, vale a mensagem
 * da própria API (já em português e feita para o usuário final).
 */
const HINTS: Record<string, string> = {
  UNAUTHENTICATED:
    'A conexão com o Space Sports expirou ou foi desconectada. Peça ao usuário para reconectar o Space Sports no assistente.',
  OAUTH_TOKEN_INVALID:
    'A conexão com o Space Sports não vale mais (expirou ou o usuário desconectou o assistente). Peça ao usuário para reconectar o Space Sports no assistente.',
  USER_BLOCKED:
    'A conta do usuário está bloqueada no Space Sports. Ele precisa falar com o suporte.',
  OAUTH_INSUFFICIENT_SCOPE:
    'Esta conexão não tem permissão para esta ação. O usuário pode reconectar o Space Sports e autorizar o acesso.',
  OAUTH_ROUTE_NOT_ALLOWED:
    'Esta ação não está disponível pelo assistente. O usuário pode fazê-la no app do Space Sports.',
  MCP_DISABLED:
    'O Space Sports está temporariamente indisponível no assistente. O usuário pode usar o app.',
  TOO_MANY_REQUESTS:
    'Muitas ações em pouco tempo. Espere alguns minutos antes de tentar de novo e avise o usuário.',
  SPACE_NOT_FOUND: 'Espaço não encontrado. Use search_spaces para encontrar o espaço certo.',
  COURT_NOT_FOUND: 'Quadra não encontrada neste espaço. Use get_space para ver as quadras.',
  BOOKING_NOT_FOUND: 'Reserva não encontrada entre as reservas do usuário. Use list_my_bookings.',
  CLASS_SESSION_NOT_FOUND: 'Aula não encontrada entre as aulas do usuário. Use list_my_classes.',
  SLOT_UNAVAILABLE:
    'Este horário acabou de ser ocupado. Nada foi reservado: use check_availability e prepare_booking para escolher outro horário.',
  IDEMPOTENCY_KEY_REUSED:
    'Este código de confirmação já foi usado em outra reserva. Chame prepare_booking de novo.',
  ONLINE_PAYMENT_REQUIRED:
    'Este espaço exige pagamento online para reservar. Pelo assistente, a opção é o Pix (paymentOption ONLINE_PIX); cartão só pelo app.',
  OAUTH_PAYMENT_OPTION_NOT_ALLOWED:
    'Pelo assistente, a reserva só pode ser paga no espaço ou por Pix online. Cartão só pelo app.',
  PROFILE_INCOMPLETE:
    'Nada foi reservado: o cadastro do usuário está incompleto (falta nome ou telefone, ver `missing`). Peça para ele completar o cadastro no app do Space Sports e depois tentar de novo.',
  ONLINE_PAYMENT_UNAVAILABLE:
    'Este espaço não aceita esta forma de pagamento online. Use get_space para ver as formas aceitas.',
  BOOKING_TOO_SOON_FOR_ONLINE_PAYMENT:
    'O horário começa em menos de 5 minutos e não dá tempo de pagar online. Escolha outro horário.',
  CANCELLATION_DEADLINE_PASSED:
    'O prazo para cancelar pelo app terminou. O usuário precisa falar com o espaço.',
  INVALID_BOOKING_STATUS: 'A reserva não está em um status que permita esta ação.',
  VALIDATION_ERROR: 'A API recusou os dados enviados. Confira os parâmetros e tente de novo.',
  // Gestão (docs/14-mcp.md 8.2 e 8.4).
  SPACE_FORBIDDEN:
    'O papel do usuário neste espaço não dá acesso a este dado (no painel também não: o Professor não vê valores nem a lista de clientes). Diga isso ao usuário e não estime nem invente os números.',
  ANALYTICS_PERIOD_TOO_LONG:
    'O período passa de 366 dias. Divida a consulta em períodos menores (ex.: um ano por vez).',
  ANALYTICS_PERIOD_INVALID:
    'O período começa no futuro. Use uma data inicial até hoje ou informe também a data final.',
  CLASS_SESSIONS_RANGE_TOO_LONG: 'O período das aulas passa do máximo. Use um período menor.',
  INVALID_CURSOR:
    'O cursor de paginação não vale mais. Repita a consulta sem o cursor para começar de novo.',
};

/** Erro sem resposta útil da API (rede, timeout, 5xx, proxy). */
const UNAVAILABLE = new ToolError(
  'API_UNAVAILABLE',
  'O Space Sports não respondeu agora. Tente de novo em instantes; se persistir, o usuário pode usar o app.',
);

/**
 * Converte um erro da chamada à API num `ToolError` com mensagem útil para o assistente, sem stack,
 * corpo cru, id de requisição nem detalhes internos.
 */
export function toToolError(
  error: unknown,
  overrides: Readonly<Record<string, string>> = {},
): ToolError {
  if (error instanceof ToolError) return error;
  if (!isApiError(error)) return UNAVAILABLE;
  if (error.status >= 500 || error.code === 'HTTP_ERROR') {
    return error.code === 'MCP_DISABLED'
      ? new ToolError(error.code, (overrides.MCP_DISABLED ?? HINTS.MCP_DISABLED) as string)
      : UNAVAILABLE;
  }
  const hint = overrides[error.code] ?? HINTS[error.code];
  const apiMessage = typeof error.message === 'string' ? error.message.slice(0, 300) : '';
  if (error.code === 'VALIDATION_ERROR') {
    return new ToolError(error.code, hint as string, { fields: validationFields(error.details) });
  }
  if (error.code === 'PROFILE_INCOMPLETE') {
    return new ToolError(error.code, hint as string, { missing: missingFields(error.details) });
  }
  const message =
    hint && apiMessage && !hint.includes(apiMessage)
      ? `${apiMessage} ${hint}`
      : (hint ?? apiMessage);
  return new ToolError(error.code, message || 'A API recusou o pedido.');
}

/** Campos do cadastro que faltam (`name`, `phone`), sem nenhum valor da conta. */
function missingFields(details: unknown): string[] | undefined {
  const missing = (details as { missing?: unknown } | null)?.missing;
  if (!Array.isArray(missing)) return undefined;
  const fields = missing.filter((field): field is string => field === 'name' || field === 'phone');
  return fields.length ? fields : undefined;
}

/** Só os nomes dos campos recusados (sem os valores enviados). */
function validationFields(details: unknown): string[] | undefined {
  if (!Array.isArray(details)) return undefined;
  const fields = details
    .map((item) =>
      item && typeof item === 'object' ? (item as { field?: unknown }).field : undefined,
    )
    .filter((field): field is string => typeof field === 'string');
  return fields.length ? [...new Set(fields)] : undefined;
}
