import type { SpaceRole } from '@space-sports/shared';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { DbOrTx } from '../bookings/db-utils.js';
import {
  classGroups,
  classGroupTeachers,
  classSessions,
  classSessionTeachers,
  spaceMembers,
} from '../db/schema/index.js';

/**
 * O que o papel enxerga e opera das turmas e sessões (matriz de docs/02): Dono e Admin, tudo;
 * quem é só Professor, as turmas e sessões em que está entre os professores. As duas listas são
 * independentes: quem assume uma aula avulsa vê a aula, não a turma.
 */
export type ClassesScope = { kind: 'ALL' } | { kind: 'TEACHER'; memberId: string };

const SEES_ALL: readonly SpaceRole[] = ['OWNER', 'ADMIN'];

/** O vínculo está entre os professores da turma. */
export const groupHasTeacher = (memberId: string): SQL =>
  sql`EXISTS (SELECT 1 FROM ${classGroupTeachers} WHERE ${classGroupTeachers.classGroupId} = ${classGroups.id} AND ${classGroupTeachers.teacherMemberId} = ${memberId})`;

/** O vínculo está entre os professores da aula. */
export const sessionHasTeacher = (memberId: string): SQL =>
  sql`EXISTS (SELECT 1 FROM ${classSessionTeachers} WHERE ${classSessionTeachers.classSessionId} = ${classSessions.id} AND ${classSessionTeachers.teacherMemberId} = ${memberId})`;

/** Filtro das turmas pelo escopo (matriz de docs/02). */
export const groupScope = (scope: ClassesScope): SQL | undefined =>
  scope.kind === 'TEACHER' ? groupHasTeacher(scope.memberId) : undefined;

/** Filtro das aulas pelo escopo (matriz de docs/02). */
export const sessionScope = (scope: ClassesScope): SQL | undefined =>
  scope.kind === 'TEACHER' ? sessionHasTeacher(scope.memberId) : undefined;

export async function classesScope(
  db: DbOrTx,
  spaceId: string,
  userId: string,
  roles: readonly SpaceRole[],
): Promise<ClassesScope> {
  if (roles.some((role) => SEES_ALL.includes(role))) return { kind: 'ALL' };
  const [member] = await db
    .select({ id: spaceMembers.id })
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.userId, userId),
        eq(spaceMembers.role, 'TEACHER'),
        eq(spaceMembers.status, 'ACTIVE'),
      ),
    );
  // O guard já exigiu um papel do espaço; sem vínculo de Professor, não vê nenhuma turma.
  return { kind: 'TEACHER', memberId: member?.id ?? '00000000-0000-0000-0000-000000000000' };
}
