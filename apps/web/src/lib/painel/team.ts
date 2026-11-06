import type { SpaceRole, TeamMember } from '@space-sports/api-client';

/** Papéis que se concede pelo painel; o de Dono só vem da plataforma (Super). */
export const GRANTABLE_ROLES = ['ADMIN', 'TEACHER'] as const satisfies readonly SpaceRole[];

type Actor = { userId: string; roles: readonly SpaceRole[] };

/**
 * A API é a regra de verdade; isto só esconde o que ela recusaria: ninguém mexe no próprio
 * vínculo e só o Dono mexe no vínculo de outro Dono (OWNER_PROTECTED, CANNOT_ACT_ON_SELF).
 */
export function canManageMember(
  actor: Actor,
  member: Pick<TeamMember, 'userId' | 'roles'>,
): boolean {
  if (member.userId === actor.userId) return false;
  if (member.roles.includes('OWNER') && !actor.roles.includes('OWNER')) return false;
  return true;
}

/** Papéis a enviar ao salvar: mantém `OWNER` se o membro já era Dono (a API não aceita concedê-lo). */
export function rolesToSave(
  member: Pick<TeamMember, 'roles'>,
  chosen: readonly SpaceRole[],
): SpaceRole[] {
  const keepOwner = member.roles.includes('OWNER');
  const set = new Set<SpaceRole>(chosen.filter((r) => r !== 'OWNER'));
  if (keepOwner) set.add('OWNER');
  return (['OWNER', 'ADMIN', 'TEACHER'] as const).filter((r) => set.has(r));
}

/**
 * Como tirar alguém da lista de professores: quem só é Professor sai da equipe do espaço; quem tem
 * outros papéis (ex.: Admin) perde só o de Professor e mantém o acesso.
 */
export function teacherRemoval(
  member: Pick<TeamMember, 'roles'>,
): { kind: 'remove' } | { kind: 'drop-role'; roles: SpaceRole[] } {
  const rest = member.roles.filter((r) => r !== 'TEACHER');
  return rest.length === 0 ? { kind: 'remove' } : { kind: 'drop-role', roles: rest };
}
