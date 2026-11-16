/** Rótulos em português dos enums da API, para o assistente não precisar adivinhar. */

export const BOOKING_STATUS: Record<string, string> = {
  PENDING_PAYMENT: 'aguardando pagamento',
  CONFIRMED: 'confirmada',
  COMPLETED: 'concluída',
  CANCELLED: 'cancelada',
  NO_SHOW: 'não compareceu',
};

export const BOOKING_PAYMENT_STATUS: Record<string, string> = {
  PENDING: 'pendente',
  PARTIALLY_PAID: 'parcialmente pago',
  PAID: 'pago',
};

export const CANCEL_REASON: Record<string, string> = {
  PAYMENT_EXPIRED: 'o prazo do pagamento online venceu',
  PAYMENT_ABANDONED: 'o pagamento online não foi concluído',
};

export const PAYMENT_OPTION: Record<string, string> = {
  ON_SITE: 'pagar no espaço',
  ONLINE_PIX: 'Pix online',
  ONLINE_CARD: 'cartão online (só pelo app)',
};

export const PAYMENT_METHOD: Record<string, string> = {
  PIX: 'Pix',
  CARD: 'cartão',
  CASH: 'dinheiro',
  OTHER: 'outro',
};

export const SPACE_SERVICE: Record<string, string> = {
  RENTAL: 'aluguel de quadra',
  CLASSES: 'aulas',
  TOURNAMENTS: 'torneios',
};

export const CLASS_LEVEL: Record<string, string> = {
  BEGINNER: 'iniciante',
  INTERMEDIATE: 'intermediário',
  ADVANCED: 'avançado',
  PRO: 'profissional',
};

export const CLASS_SESSION_STATUS: Record<string, string> = {
  SCHEDULED: 'agendada (lista ainda não abriu)',
  OPEN: 'lista de presença aberta',
  CLOSED: 'lista de presença fechada',
  DONE: 'realizada',
  CANCELLED: 'cancelada',
};

export const ATTENDANCE_STATUS: Record<string, string> = {
  CONFIRMED: 'presença confirmada',
  WAITLIST: 'na lista de espera',
  CANCELLED: 'presença desmarcada',
  PRESENT: 'presente',
  ABSENT: 'falta',
};

export const ATTENDANCE_BLOCKED: Record<string, string> = {
  LIST_NOT_OPEN: 'a lista de presença ainda não abriu',
  NOT_ENROLLED: 'o usuário não está matriculado nesta turma',
  SUBSCRIPTION_ACCESS_ENDED: 'o plano de aulas do usuário terminou',
  SUBSCRIPTION_PAST_DUE: 'há mensalidade em atraso',
  SCHEDULE_OVERLAP: 'o usuário já está em outra aula no mesmo horário',
};

export const label = (map: Record<string, string>, value: string | null | undefined) =>
  value ? (map[value] ?? value) : null;

/** Só o primeiro nome de outra pessoa (RN-MCP-05). */
export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

// Plataforma (Super; os mesmos textos do /super no web).

export const SPACE_STATUS: Record<string, string> = {
  ACTIVE: 'ativo',
  SUSPENDED: 'suspenso',
  CLOSED: 'encerrado',
};

export const USER_STATUS: Record<string, string> = {
  ACTIVE: 'ativa',
  BLOCKED: 'bloqueada',
  INACTIVE: 'inativa',
};

export const PLATFORM_ROLE: Record<string, string> = {
  USER: 'usuário',
  SUPER: 'Super',
};

export const REVIEW_REPORT_REASON: Record<string, string> = {
  SPAM: 'spam ou propaganda',
  OFFENSIVE: 'ofensivo ou discriminatório',
  FALSE_INFO: 'informação falsa',
  PERSONAL_DATA: 'expõe dados pessoais',
  OTHER: 'outro motivo',
};

export const REVIEW_REPORT_STATUS: Record<string, string> = {
  OPEN: 'aberta',
  RESOLVED: 'resolvida (comentário ocultado)',
  DISMISSED: 'descartada',
};

/** Itens do checklist de implantação (RF-SUPER-02). */
export const ONBOARDING_ITEM: Record<string, string> = {
  DATA: 'dados do espaço',
  PHOTOS: 'fotos',
  COURTS: 'quadras',
  PRICE: 'preço por hora',
  TEAM: 'Dono do espaço',
};

/** Pendências de cada item do checklist (códigos estáveis da API). */
export const ONBOARDING_MISSING: Record<string, string> = {
  description: 'descrição',
  address: 'endereço completo',
  location: 'localização no mapa',
  contact: 'telefone ou WhatsApp',
  openingHours: 'horário de funcionamento',
  photos: 'ao menos uma foto',
  activeCourtWithSport: 'ao menos uma quadra ativa com esporte',
  pricePerHour: 'valor da hora',
  activeOwner: 'um Dono ativo',
};

/** O que falta para o espaço aparecer na vitrine (RN-SPACE-01). */
export const SHOWCASE_MISSING: Record<string, string> = {
  ACTIVE_STATUS: 'espaço ativo',
  ACTIVE_COURT: 'ao menos uma quadra ativa',
  PRICE_PER_HOUR: 'preço por hora',
};
