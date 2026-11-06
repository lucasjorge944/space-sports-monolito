import type { SpaceRole, SpaceStatus } from '@space-sports/shared';

export const ROLE_LABEL: Record<SpaceRole, string> = {
  OWNER: 'Dono',
  ADMIN: 'Admin',
  TEACHER: 'Professor',
};

export const SPACE_STATUS_NOTICE: Partial<Record<SpaceStatus, string>> = {
  SUSPENDED: 'Este espaço está suspenso: apenas leitura.',
  CLOSED: 'Este espaço foi encerrado.',
};

export function rolesLabel(roles: SpaceRole[]): string {
  return roles.map((role) => ROLE_LABEL[role]).join(' · ');
}
