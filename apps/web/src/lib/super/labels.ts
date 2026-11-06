import type {
  PaymentMethod,
  SpaceStatus,
  SuperSpaceChecklistItemsItemKey,
} from '@space-sports/api-client';
import type { UserStatus } from '@space-sports/shared';

export const spaceStatusLabel: Record<SpaceStatus, string> = {
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  CLOSED: 'Encerrado',
};

export const userStatusLabel: Record<UserStatus, string> = {
  ACTIVE: 'Ativo',
  BLOCKED: 'Bloqueado',
  INACTIVE: 'Inativa',
};
export const platformRoleLabel = { USER: 'Usuário', SUPER: 'Super' } as const;

export const memberRoleLabel = {
  OWNER: 'Dono',
  ADMIN: 'Admin',
  TEACHER: 'Professor',
} as const;
export const memberStatusLabel = {
  INVITED: 'Convidado',
  ACTIVE: 'Ativo',
  REMOVED: 'Removido',
} as const;

export const serviceLabel = {
  RENTAL: 'Aluguel',
  CLASSES: 'Aulas',
  TOURNAMENTS: 'Torneios',
} as const;

export const methodLabel: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  CARD: 'Cartão',
  CASH: 'Dinheiro',
  OTHER: 'Outra',
};

export const checklistLabel: Record<SuperSpaceChecklistItemsItemKey, string> = {
  DATA: 'Dados do espaço',
  PHOTOS: 'Fotos',
  COURTS: 'Quadras',
  PRICE: 'Preço por hora',
  TEAM: 'Dono do espaço',
};

/** Pendências que a API devolve em `missing` (códigos estáveis, não texto de tela). */
const checklistMissingLabel: Record<string, string> = {
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

/** `['address', 'contact']` → `endereço completo, telefone ou WhatsApp`; nunca mostra o código. */
export function checklistMissingText(missing: readonly string[]): string {
  return [...new Set(missing.map((key) => checklistMissingLabel[key] ?? 'outro dado'))].join(', ');
}

export const showcaseMissingLabel = {
  ACTIVE_STATUS: 'espaço ativo',
  ACTIVE_COURT: 'ao menos uma quadra ativa',
  PRICE_PER_HOUR: 'preço por hora',
} as const;

export const deletionStatusLabel = {
  PENDING: 'Pendente',
  COMPLETED: 'Atendido',
  REJECTED: 'Recusado',
  CANCELLED: 'Cancelado',
} as const;
export const deletionSourceLabel = {
  USER: 'Pedido do usuário',
  SUPER: 'Aberto pelo Super',
} as const;

export const levelLabel = {
  BEGINNER: 'Iniciante',
  INTERMEDIATE: 'Intermediário',
  ADVANCED: 'Avançado',
  PRO: 'Profissional',
} as const;

export const ownerInviteMessage = {
  LINKED: 'A conta já existia e foi vinculada como Dono.',
  INVITED: 'Convite enviado por e-mail.',
  AWAITING_SIGNUP: 'Ainda não há conta com esse e-mail. Peça o cadastro e repita o convite depois.',
  AWAITING_VERIFICATION:
    'Há conta com esse e-mail, mas ele não foi verificado. Repita o convite depois da verificação.',
} as const;
