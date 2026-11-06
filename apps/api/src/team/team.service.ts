import { Inject, Injectable } from '@nestjs/common';
import { SPACE_ROLES, type SpaceRole, type Team, type TeamMember } from '@space-sports/shared';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { audit, type Tx } from '../bookings/db-utils.js';
import { releaseTeacher } from '../classes/class-teachers.js';
import type { Database } from '../db/client.js';
import { spaceMembers, spaces, staffInvites, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { lastOwner, memberNotFound, ownerProtected, ownerRoleRestricted } from './team.errors.js';

/** Quem executa a ação: o usuário e os papéis dele no espaço. */
export interface TeamActor {
  userId: string;
  roles: readonly SpaceRole[];
}

const byRoleOrder = (a: SpaceRole, b: SpaceRole) => SPACE_ROLES.indexOf(a) - SPACE_ROLES.indexOf(b);

/**
 * Equipe do espaço (RN-AUTH-01/03/04). Um usuário tem uma linha ACTIVE em `space_members` por
 * papel no espaço; remover um papel marca a linha como REMOVED (histórico). O acesso do painel é
 * lido de `space_members` a cada requisição, então remover o vínculo encerra o acesso na hora.
 *
 * Regras da matriz ("Admin ✅ exceto Dono"): o Admin gerencia Admin e Professor, mas não convida,
 * altera nem remove quem é Dono. O papel de Dono só é concedido pela plataforma (Super) e o
 * espaço nunca fica sem Dono. As mutações travam a linha do espaço para que duas remoções
 * simultâneas não deixem o espaço sem Dono.
 */
@Injectable()
export class TeamService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(spaceId: string): Promise<Team> {
    const memberRows = await this.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        role: spaceMembers.role,
        createdAt: spaceMembers.createdAt,
      })
      .from(spaceMembers)
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.status, 'ACTIVE')))
      .orderBy(asc(users.name), asc(users.id));

    const members = new Map<string, TeamMember>();
    for (const row of memberRows) {
      const member = members.get(row.userId) ?? {
        userId: row.userId,
        name: row.name,
        email: row.email,
        avatarUrl: row.avatarUrl,
        roles: [],
        joinedAt: row.createdAt.toISOString(),
      };
      member.roles.push(row.role);
      if (row.createdAt.toISOString() < member.joinedAt) {
        member.joinedAt = row.createdAt.toISOString();
      }
      members.set(row.userId, member);
    }
    for (const member of members.values()) member.roles.sort(byRoleOrder);

    const inviteRows = await this.db
      .select({
        id: staffInvites.id,
        email: staffInvites.email,
        role: staffInvites.role,
        expiresAt: staffInvites.expiresAt,
        createdAt: staffInvites.createdAt,
        inviterId: users.id,
        inviterName: users.name,
      })
      .from(staffInvites)
      .innerJoin(users, eq(users.id, staffInvites.invitedBy))
      .where(and(eq(staffInvites.spaceId, spaceId), eq(staffInvites.status, 'PENDING')))
      .orderBy(desc(staffInvites.createdAt), desc(staffInvites.id));
    const now = Date.now();

    return {
      members: [...members.values()],
      invites: inviteRows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.expiresAt.getTime() > now ? ('PENDING' as const) : ('EXPIRED' as const),
        expiresAt: row.expiresAt.toISOString(),
        invitedBy: { id: row.inviterId, name: row.inviterName },
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Substitui os papéis do membro no espaço (RN-AUTH-03). Papéis novos viram vínculo ACTIVE; os
   * que saíram do conjunto, REMOVED. Para tirar a pessoa da equipe, use `remove`.
   */
  async replaceRoles(
    spaceId: string,
    actor: TeamActor,
    userId: string,
    roles: readonly SpaceRole[],
  ): Promise<TeamMember> {
    await this.db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const current = await activeRoles(tx, spaceId, userId);
      if (!current.length) throw memberNotFound();
      assertCanTouch(actor, current);
      if (roles.includes('OWNER') && !current.includes('OWNER')) throw ownerRoleRestricted();
      if (current.includes('OWNER') && !roles.includes('OWNER')) {
        await assertOtherOwner(tx, spaceId, userId);
      }

      const added = roles.filter((role) => !current.includes(role));
      const dropped = current.filter((role) => !roles.includes(role));
      if (dropped.includes('TEACHER')) await releaseTeacher(tx, spaceId, userId);
      if (added.length) {
        await tx
          .insert(spaceMembers)
          .values(added.map((role) => ({ userId, spaceId, role, status: 'ACTIVE' as const })))
          .onConflictDoUpdate({
            target: [spaceMembers.userId, spaceMembers.spaceId, spaceMembers.role],
            set: { status: 'ACTIVE', updatedAt: new Date() },
          });
      }
      if (dropped.length) {
        await tx
          .update(spaceMembers)
          .set({ status: 'REMOVED', updatedAt: new Date() })
          .where(memberRows(spaceId, userId, dropped));
      }
      if (added.length || dropped.length) {
        await audit(tx, {
          actorId: actor.userId,
          spaceId,
          action: 'team.roles_change',
          entity: 'user',
          entityId: userId,
          diff: { before: [...current].sort(byRoleOrder), after: [...roles].sort(byRoleOrder) },
        });
      }
    });
    return this.getMember(spaceId, userId);
  }

  /** Encerra todos os vínculos do usuário com o espaço; o acesso acaba na próxima requisição. */
  async remove(spaceId: string, actor: TeamActor, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const current = await activeRoles(tx, spaceId, userId);
      if (!current.length) throw memberNotFound();
      assertCanTouch(actor, current);
      if (current.includes('OWNER')) await assertOtherOwner(tx, spaceId, userId);
      if (current.includes('TEACHER')) await releaseTeacher(tx, spaceId, userId);

      await tx
        .update(spaceMembers)
        .set({ status: 'REMOVED', updatedAt: new Date() })
        .where(memberRows(spaceId, userId, current));
      await audit(tx, {
        actorId: actor.userId,
        spaceId,
        action: 'team.member_remove',
        entity: 'user',
        entityId: userId,
        diff: { roles: [...current].sort(byRoleOrder) },
      });
    });
  }

  private async getMember(spaceId: string, userId: string): Promise<TeamMember> {
    const { members } = await this.list(spaceId);
    const member = members.find((m) => m.userId === userId);
    if (!member) throw memberNotFound();
    return member;
  }
}

/**
 * Serializa as mutações de equipe do espaço (garante a regra do último Dono). `NO KEY UPDATE` não
 * conflita com o `KEY SHARE` das FKs para `spaces`: quem insere uma turma com o vínculo do
 * professor travado não fica em deadlock com a equipe.
 */
export async function lockSpace(tx: Tx, spaceId: string): Promise<void> {
  await tx
    .select({ id: spaces.id })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .for('no key update');
}

async function activeRoles(tx: Tx, spaceId: string, userId: string): Promise<SpaceRole[]> {
  const rows = await tx
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.userId, userId),
        eq(spaceMembers.status, 'ACTIVE'),
      ),
    );
  return rows.map((row) => row.role);
}

const memberRows = (spaceId: string, userId: string, roles: readonly SpaceRole[]) =>
  and(
    eq(spaceMembers.spaceId, spaceId),
    eq(spaceMembers.userId, userId),
    eq(spaceMembers.status, 'ACTIVE'),
    inArray(spaceMembers.role, [...roles]),
  );

/** Só o Dono mexe no vínculo de quem é Dono. */
export function assertCanTouch(actor: TeamActor, targetRoles: readonly SpaceRole[]): void {
  if (targetRoles.includes('OWNER') && !actor.roles.includes('OWNER')) throw ownerProtected();
}

/** RN-AUTH-01: tem de restar outro Dono ACTIVE além de `userId`. */
async function assertOtherOwner(tx: Tx, spaceId: string, userId: string): Promise<void> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.role, 'OWNER'),
        eq(spaceMembers.status, 'ACTIVE'),
        ne(spaceMembers.userId, userId),
      ),
    );
  if (!row?.count) throw lastOwner();
}
