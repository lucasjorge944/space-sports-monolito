import { isApiError } from '@space-sports/api-client';
import { DISPLAY_TIME_ZONE, formatDateTime, formatMoney, formatTime } from '@/lib/format';
import { WEEKDAY_LABEL } from './labels';

/** Mensagens para os códigos estáveis da API (o `message` dela é técnico e pode vir em inglês). */
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Sua sessão expirou. Entre novamente.',
  FORBIDDEN: 'Você não tem permissão para esta ação.',
  SPACE_FORBIDDEN: 'Você não tem permissão para esta ação neste espaço.',
  SPACE_READ_ONLY: 'Este espaço está suspenso ou encerrado: só é possível consultar.',
  SLOT_UNAVAILABLE: 'Esse horário já está ocupado nesta quadra.',
  SLOT_TAKEN: 'Esse horário acabou de ser ocupado.',
  COURT_UNAVAILABLE: 'A quadra não está disponível para reservas.',
  COURT_NOT_FOUND: 'Quadra não encontrada.',
  COURT_NAME_TAKEN: 'Já existe uma quadra com esse nome.',
  COURT_HAS_BOOKINGS: 'A quadra tem reservas e não pode ser excluída. Marque-a como inativa.',
  PEOPLE_EXCEED_CAPACITY: 'O número de pessoas passa da capacidade da quadra para o esporte.',
  SPORT_NOT_OFFERED: 'Essa quadra não oferece o esporte escolhido.',
  DURATION_OUT_OF_RANGE: 'Duração fora do mínimo/máximo permitido pelo espaço.',
  OUTSIDE_OPENING_HOURS: 'Horário fora do funcionamento do espaço.',
  BOOKING_IN_THE_PAST: 'Não é possível reservar um horário que já passou.',
  BOOKING_TOO_SOON: 'Antecedência mínima de reserva não respeitada.',
  BOOKING_BEYOND_WINDOW: 'Data além da janela máxima de reservas do espaço.',
  MISALIGNED_START: 'O horário precisa começar em hora cheia ou meia hora.',
  CUSTOMER_NOT_FOUND: 'Cliente não encontrado.',
  BOOKING_NOT_FOUND: 'Reserva não encontrada.',
  INVALID_BOOKING_STATUS: 'A reserva não está em um estado que permita esta ação.',
  BOOKING_NOT_STARTED:
    'A reserva só pode ser concluída ou marcada como não comparecimento depois do início.',
  BOOKING_NOT_PAYABLE: 'Esta reserva não aceita pagamentos.',
  PAYABLE_NOT_FOUND: 'Item de cobrança não encontrado.',
  PAYMENT_EXCEEDS_DUE: 'O valor é maior que o que está em aberto.',
  PAYMENT_NOT_FOUND: 'Pagamento não encontrado.',
  PAYMENT_ALREADY_REVERSED: 'Este pagamento já foi estornado.',
  COURT_BLOCK_NOT_FOUND: 'Bloqueio não encontrado.',
  RECURRING_BOOKING_NOT_FOUND: 'Mensalista não encontrado.',
  INVALID_RECURRING_STATUS: 'O mensalista não está em um estado que permita esta ação.',
  RECURRING_START_IN_PAST: 'A data de início não pode ser anterior a hoje.',
  STAFF_INVITE_NOT_FOUND: 'Convite não encontrado.',
  STAFF_INVITE_UNAVAILABLE: 'Este convite não está mais disponível.',
  STAFF_INVITE_EXPIRED: 'Este convite expirou. Peça um novo ao espaço.',
  STAFF_INVITE_EMAIL_MISMATCH:
    'Este convite foi enviado para outro e-mail. Entre com a conta convidada.',
  STAFF_INVITE_PENDING: 'Já existe um convite pendente para este e-mail.',
  ALREADY_TEAM_MEMBER: 'Esta pessoa já faz parte da equipe.',
  TOO_MANY_INVITES: 'Muitos convites seguidos. Tente de novo em instantes.',
  TOO_MANY_REQUESTS: 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.',
  INVITE_NOT_FOUND: 'Convite não encontrado.',
  INVITE_UNAVAILABLE: 'Este convite não está mais disponível.',
  INVITE_SLOT_TAKEN: 'Esta vaga já foi preenchida por outra pessoa.',
  ALREADY_PARTICIPANT: 'Você já participa desta reserva.',
  SUGGESTED_USER_MISMATCH: 'Esta sugestão não vale mais. Confira a reserva de novo.',
  CONTACT_NOT_FOUND: 'Contato não encontrado.',
  EMAIL_NOT_VERIFIED: 'Confirme o e-mail da sua conta para continuar.',
  LAST_OWNER: 'O último Dono do espaço não pode ser removido nem perder o papel.',
  OWNER_PROTECTED: 'Apenas o Dono pode alterar o Dono.',
  OWNER_ROLE_RESTRICTED: 'O papel de Dono só é concedido pela plataforma.',
  CANNOT_ACT_ON_SELF: 'Você não pode fazer isso com a sua própria conta.',
  MEMBER_NOT_FOUND: 'Membro não encontrado.',
  INVALID_PHOTO_FILE: 'Arquivo de foto inválido. Use JPEG, PNG ou WebP.',
  PHOTO_TOO_LARGE: 'A foto é grande demais (máximo de 10 MB).',
  PHOTO_LIMIT_REACHED: 'O espaço já tem o máximo de 20 fotos.',
  PHOTO_ALREADY_ADDED: 'Esta foto já foi adicionada.',
  PHOTO_NOT_UPLOADED: 'O envio da foto não foi concluído. Tente de novo.',
  INVALID_LOGO_KEY: 'O envio da logo expirou ou não é deste espaço. Escolha o arquivo de novo.',
  LOGO_NOT_UPLOADED: 'O envio da logo não foi concluído. Tente de novo.',
  LOGO_TOO_LARGE: 'A logo é maior que o limite de 2 MB.',
  INVALID_LOGO_FILE: 'O arquivo da logo não é uma imagem válida. Use JPEG, PNG ou WebP.',
  STORAGE_UNAVAILABLE:
    'O armazenamento de imagens está indisponível agora. Tente de novo em instantes.',
  GEOCODING_UNAVAILABLE: 'Não foi possível localizar o endereço agora. Tente de novo.',
  ADDRESS_NOT_FOUND: 'Endereço não encontrado. Confira os dados.',
  CLASS_SCHEDULE_CONFLICT: 'O horário da turma conflita com a agenda da quadra.',
  CAPACITY_BELOW_ENROLLMENTS:
    'A capacidade não pode ficar abaixo do número de alunos matriculados.',
  CLASS_GROUP_HAS_ACTIVE_ENROLLMENTS:
    'A turma tem alunos matriculados. Transfira ou desmatricule os alunos antes.',
  CLASS_GROUP_HAS_HISTORY:
    'A turma já tem aulas realizadas ou alunos confirmados e não pode ser excluída. Desative-a.',
  CAPACITY_BELOW_CONFIRMED: 'A capacidade fica abaixo dos alunos já confirmados na aula.',
  CLASS_SESSION_NOT_EDITABLE: 'Esta aula não pode mais ser alterada.',
  CLASS_GROUP_NOT_FOUND: 'Turma não encontrada.',
  CLASS_SESSION_NOT_FOUND: 'Aula não encontrada.',
  PLAN_NOT_FOUND: 'Plano não encontrado.',
  PLAN_HAS_SUBSCRIPTIONS: 'O plano tem assinaturas e não pode ser excluído. Desative-o.',
  TEACHER_NOT_FOUND: 'Professor não encontrado neste espaço.',
  TEACHER_HAS_CLASS_GROUPS:
    'Este é o único professor de turmas ativas ou aulas por acontecer. Inclua outro professor nelas ou desative as turmas antes.',
  TEACHER_SCHEDULE_CONFLICT:
    'Um dos professores já tem aula em outro espaço neste horário. Escolha outro horário ou professor.',
  SPORT_NOT_FOUND: 'Esporte não encontrado.',
  SPORT_CHANGE_NOT_ALLOWED: 'Não é possível trocar o esporte com alunos ou assinaturas ativas.',
  COURT_HAS_CLASS_GROUPS: 'A quadra tem turmas. Mude ou desative as turmas antes.',
  SUBSCRIPTION_NOT_FOUND: 'Assinatura não encontrada.',
  SUBSCRIPTION_CHARGE_NOT_FOUND: 'Mensalidade não encontrada.',
  ENROLLMENT_NOT_FOUND: 'Matrícula não encontrada.',
  PLAN_INACTIVE: 'O plano está inativo.',
  SUBSCRIPTION_ALREADY_EXISTS: 'O aluno já tem uma assinatura em aberto neste plano.',
  INVALID_SUBSCRIPTION_STATUS: 'A assinatura não está em um estado que permita esta ação.',
  CLASS_GROUP_FULL: 'A turma não tem mais vagas.',
  ALREADY_ENROLLED: 'O aluno já está matriculado nesta turma.',
  PLAN_FREQUENCY_REACHED:
    'O plano já tem o número de turmas da frequência. Troque uma turma em vez de adicionar.',
  CLASS_SCHEDULE_OVERLAP: 'A turma tem o mesmo horário de outra turma do aluno.',
  CLASS_SESSION_OVERLAP: 'O aluno já está na lista de outra aula no mesmo horário.',
  CHARGE_NOT_PAYABLE: 'Esta mensalidade foi dispensada e não aceita pagamento.',
  CHARGE_NOT_WAIVABLE: 'Só é possível dispensar uma mensalidade em aberto.',
  CHARGE_HAS_PAYMENTS: 'A mensalidade tem pagamento registrado. Estorne o pagamento antes.',
  CLASS_GROUP_NOT_ELIGIBLE:
    'A turma está indisponível para este plano (inativa ou de outro esporte).',
  CLASS_GROUP_COUNT_MISMATCH: 'O número de turmas escolhidas não bate com a frequência do plano.',
  CLASS_GROUPS_OVERLAP: 'As turmas escolhidas acontecem no mesmo horário.',
  ATTENDANCE_FILTER_REQUIRED: 'Escolha um aluno ou uma turma para ver a presença.',
  ATTENDANCE_RANGE_TOO_LONG: 'O período é longo demais (máximo de 366 dias).',
  INVALID_CURSOR: 'A lista mudou. Recarregue a página.',
  INVALID_PHONE_NUMBER: 'Informe um telefone brasileiro com DDD.',
  IMAGE_TOO_LARGE: 'A foto passa de 2 MB.',
  IMAGE_NOT_SQUARE: 'A foto precisa ser quadrada.',
  INVALID_IMAGE_FILE: 'O arquivo não é uma imagem válida. Use JPEG, PNG ou WebP.',
  IMAGE_NOT_ALLOWED: 'A foto só pode ser trocada pelo envio de imagem.',
  // Pagamento online (docs/13 §13).
  ONLINE_PAYMENTS_DISABLED: 'O pagamento pelo app está desligado na plataforma.',
  ONLINE_PAYMENT_UNAVAILABLE: 'O pagamento online não está disponível para este item agora.',
  MERCHANT_NOT_APPROVED: 'Disponível depois que a conta de recebimento for aprovada.',
  MERCHANT_ACCOUNT_PENDING: 'O cadastro está em análise. Aguarde a resposta do parceiro.',
  MERCHANT_ACCOUNT_APPROVED:
    'O cadastro já foi aprovado. Para mudar a conta, use "Trocar conta bancária".',
  MERCHANT_ACCOUNT_NOT_FOUND: 'Cadastro da conta de recebimento não encontrado.',
  SUPPORT_MODE_FORBIDDEN: 'No modo suporte, o cadastro e a conta bancária não podem ser alterados.',
  ONLINE_CHARGE_NOT_FOUND: 'Pagamento online não encontrado.',
  CHARGE_NOT_REFUNDABLE: 'Este pagamento não pode mais ser estornado.',
  REFUND_EXCEEDS_BALANCE: 'O valor passa do que ainda pode ser estornado.',
  CHARGEBACK_NOT_FOUND: 'Contestação não encontrada.',
  DISPUTE_CLOSED: 'Esta contestação já foi respondida ou encerrada.',
  DISPUTE_DEADLINE_PASSED: 'O prazo para responder a contestação acabou.',
  PAYMENT_GATEWAY_UNAVAILABLE:
    'O parceiro de pagamentos não respondeu. Tente de novo em instantes.',
  PAYMENT_IN_PROGRESS:
    'Outra operação de pagamento está em andamento neste item. Aguarde alguns segundos e tente de novo.',
  ONLINE_CHARGE_ALREADY_PAID: 'O cliente acabou de pagar pelo app.',
  ONLINE_PAYMENT_NEEDS_REFUND:
    'Pagamento feito pelo app: para devolver o valor, use "Estornar" no bloco Pagamento online.',
  PAYMENT_HOLD_EXPIRED: 'O prazo para pagar esta reserva acabou.',
  ALREADY_PAID: 'Não há valor em aberto para pagar.',
  NOT_PAYABLE_ONLINE: 'Este item não pode ser pago online agora.',
  BOOKING_TOO_SOON_FOR_ONLINE_PAYMENT:
    'O horário começa em poucos minutos: não dá tempo de pagar online.',
  FEE_PAYER_NOT_ALLOWED: 'Por enquanto, a taxa só pode ser paga pelo espaço.',
  // Avaliações (docs/02 §12).
  REVIEW_NOT_FOUND: 'Avaliação não encontrada. Ela pode ter sido excluída pelo autor.',
  REVIEW_REPLY_NOT_FOUND: 'Esta avaliação não tem resposta para remover.',
  REVIEW_ALREADY_REPORTED: 'Você já denunciou esta avaliação.',
  REVIEW_REPORT_OWN: 'Você não pode denunciar a sua avaliação.',
  REVIEW_REPORT_NOT_FOUND: 'Denúncia não encontrada.',
  REVIEW_REPORT_RESOLVED: 'Esta denúncia já foi resolvida ou descartada.',
  REVIEW_NO_COMMENT: 'Esta avaliação não tem comentário para ocultar.',
  REVIEW_COMMENT_HIDDEN: 'O comentário já está oculto.',
  REVIEW_COMMENT_NOT_HIDDEN: 'O comentário já está visível.',
  REVIEW_NOT_ALLOWED: 'A equipe do espaço não avalia o próprio espaço.',
  REVIEW_NOT_ELIGIBLE: 'Só avalia quem jogou ou fez aula no espaço nos últimos 6 meses.',
  REVIEW_TAGS_MISMATCH: 'Os destaques escolhidos não combinam com a nota.',
  REVIEW_ALREADY_EXISTS: 'Esta pessoa já avaliou o espaço.',
  VALIDATION_ERROR: 'Confira os campos: há valores inválidos.',
  SERVICE_UNAVAILABLE: 'Serviço indisponível no momento. Tente de novo.',
  INTERNAL_ERROR: 'Erro inesperado. Tente de novo em instantes.',
};

const CONFLICT_WITH_LABEL: Record<string, string> = {
  CLASS_GROUP: 'outra turma',
  RECURRING_BOOKING: 'um mensalista',
  BOOKING: 'uma reserva',
  BLOCK: 'um bloqueio da quadra',
  CLASS: 'outra aula',
  TOURNAMENT: 'um torneio',
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** `America/Manaus` → `Manaus`; só a cidade, que é o que o usuário reconhece. */
const zoneCity = (timeZone: string): string =>
  (timeZone.split('/').at(-1) ?? timeZone).replaceAll('_', ' ');

/**
 * `Futevôlei Iniciante (Espaço B), Terça 19:00` a partir do `details.conflict` de
 * `CLASS_SCHEDULE_OVERLAP`. O horário é do fuso do espaço da turma: fora de `America/Sao_Paulo`,
 * o fuso vai junto (`Terça 19:00, horário de Manaus`).
 */
function describeSlot(conflict: Record<string, unknown>): string {
  const space = typeof conflict.spaceName === 'string' ? ` (${conflict.spaceName})` : '';
  const weekday =
    typeof conflict.weekday === 'number' ? WEEKDAY_LABEL[conflict.weekday] : undefined;
  const time = typeof conflict.startTime === 'string' ? conflict.startTime : undefined;
  const zone =
    typeof conflict.timeZone === 'string' && conflict.timeZone !== DISPLAY_TIME_ZONE
      ? `, horário de ${zoneCity(conflict.timeZone)}`
      : '';
  const slot = weekday && time ? `, ${weekday} ${time}${zone}` : '';
  return `${String(conflict.classGroupName)}${space}${slot}`;
}

/** Complementa a mensagem com o que a API manda em `details` (nomes, quantidades, data do conflito). */
const DETAILED: Record<string, (details: Record<string, unknown>) => string | undefined> = {
  CLASS_SCHEDULE_CONFLICT: (d) => {
    const label = CONFLICT_WITH_LABEL[String(d.conflictsWith)];
    if (!label) return undefined;
    const when = typeof d.startsAt === 'string' ? ` em ${formatDateTime(d.startsAt)}` : '';
    return `O horário conflita com ${label}${when}. Escolha outro dia, horário ou quadra.`;
  },
  SPORT_CHANGE_NOT_ALLOWED: (d) => {
    if (typeof d.enrolledCount === 'number')
      return `A turma tem ${d.enrolledCount} aluno(s) matriculado(s): não dá para trocar o esporte.`;
    if (typeof d.subscriptionCount === 'number')
      return `O plano tem ${d.subscriptionCount} assinatura(s) em andamento: não dá para trocar o esporte.`;
    return undefined;
  },
  COURT_HAS_CLASS_GROUPS: (d) => {
    const names = Array.isArray(d.classGroups)
      ? d.classGroups.map((g) => String(asRecord(g).name ?? '')).filter(Boolean)
      : [];
    return names.length > 0
      ? `A quadra tem turmas: ${names.join(', ')}. Mude ou desative as turmas antes.`
      : undefined;
  },
  CLASS_GROUP_COUNT_MISMATCH: (d) =>
    typeof d.expected === 'number'
      ? `Este plano exige exatamente ${d.expected} turma(s); foram escolhidas ${String(d.received)}.`
      : undefined,
  REFUND_EXCEEDS_BALANCE: (d) =>
    typeof d.refundableCents === 'number'
      ? `O valor passa do que ainda pode ser estornado (${formatMoney(d.refundableCents)}).`
      : undefined,
  INVALID_LOGO_FILE: (d) =>
    typeof d.width === 'number' && typeof d.height === 'number'
      ? `A logo precisa ser quadrada (mesma largura e altura). A imagem enviada tem ${d.width}×${d.height} px.`
      : undefined,
  TEACHER_HAS_CLASS_GROUPS: (d) => {
    const names = new Set(
      [
        ...(Array.isArray(d.classGroups) ? d.classGroups : []),
        ...(Array.isArray(d.classSessions)
          ? d.classSessions.map((s) => asRecord(s).classGroup)
          : []),
      ]
        .map((g) => String(asRecord(g).name ?? ''))
        .filter(Boolean),
    );
    return names.size > 0
      ? `Este é o único professor de: ${[...names].join(', ')}. Inclua outro professor nelas ou desative as turmas antes.`
      : undefined;
  },
  // A API nunca diz qual é o outro espaço (decisão 47), e a tela também não.
  TEACHER_SCHEDULE_CONFLICT: (d) => {
    if (typeof d.startsAt !== 'string' || typeof d.endsAt !== 'string') return undefined;
    const name = asRecord(d.teacher).name;
    const who = typeof name === 'string' ? name : 'Um dos professores';
    return `${who} já tem aula em outro espaço em ${formatDateTime(d.startsAt)} às ${formatTime(d.endsAt)}. Escolha outro horário ou professor.`;
  },
  CLASS_SCHEDULE_OVERLAP: (d) => {
    const conflict = asRecord(d.conflict);
    return typeof conflict.classGroupName === 'string'
      ? `O aluno já tem a turma ${describeSlot(conflict)} neste horário. Escolha outra turma.`
      : undefined;
  },
  CLASS_SESSION_OVERLAP: (d) => {
    const conflict = asRecord(d.conflict);
    if (typeof conflict.classGroupName !== 'string') return undefined;
    const spaceName = typeof conflict.spaceName === 'string' ? ` (${conflict.spaceName})` : '';
    const when =
      typeof conflict.startsAt === 'string' && typeof conflict.endsAt === 'string'
        ? ` (${formatDateTime(conflict.startsAt)} às ${formatTime(conflict.endsAt)})`
        : '';
    return `O aluno já está na lista da aula ${conflict.classGroupName}${spaceName} no mesmo horário${when}.`;
  },
};

/** Texto em português para mostrar ao usuário a partir de um erro de mutation/query. */
export function apiErrorMessage(
  error: unknown,
  fallback = 'Não foi possível concluir. Tente novamente.',
) {
  if (isApiError(error)) {
    const detailed = DETAILED[error.code]?.(asRecord(error.details));
    if (detailed) return detailed;
    const known = MESSAGES[error.code];
    if (known) return known;
    if (error.status >= 500) return MESSAGES.INTERNAL_ERROR as string;
    return fallback;
  }
  // Erro de rede: o `fetch` lança TypeError.
  if (error instanceof TypeError) return 'Sem conexão com o servidor. Verifique a internet.';
  return fallback;
}

/** Espaço suspenso/encerrado: a API só aceita leitura (RF-SUPER-03). */
export function isReadOnlyError(error: unknown): boolean {
  return isApiError(error) && error.code === 'SPACE_READ_ONLY';
}
