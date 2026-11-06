import { Inject, Injectable } from '@nestjs/common';
import type { Membership, SpaceRole, SpaceStatus } from '@space-sports/shared';
import { fromNodeHeaders } from 'better-auth/node';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { Request, Response } from 'express';
import type { Database } from '../db/client.js';
import { spaceMembers, spaces, supportSessions, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { accountInactive, unauthenticated, userBlocked } from './auth.errors.js';
import type { Auth } from './auth.js';
import { AUTH } from './auth.tokens.js';
import type { AuthContext } from './auth-context.js';

const userColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  emailVerified: users.emailVerified,
  phone: users.phone,
  phoneVerified: users.phoneVerified,
  avatarUrl: users.avatarUrl,
  platformRole: users.platformRole,
  status: users.status,
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB) private readonly db: Database,
  ) {}

  /**
   * Sessão da requisição, pelo cookie (web) ou pelo header Authorization: Bearer (app). Devolve
   * `null` sem sessão válida ou se a conta foi excluída. Se o Better Auth renovar a sessão, o
   * cookie atualizado segue na resposta.
   */
  async resolve(req: Request, res: Response): Promise<AuthContext | null> {
    if (!req.headers.cookie && !req.headers.authorization) return null;

    const { headers, response } = await this.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      returnHeaders: true,
    });
    const cookies = headers.getSetCookie();
    if (cookies.length) res.append('set-cookie', cookies);
    if (!response) return null;

    const [user] = await this.db
      .select(userColumns)
      .from(users)
      .where(and(eq(users.id, response.user.id), isNull(users.deletedAt)));
    if (!user) return null;
    return {
      user,
      session: { id: response.session.id, expiresAt: new Date(response.session.expiresAt) },
    };
  }

  /** Sessão de conta que pode usar a API; sem ela, o erro de quem exige login. */
  async requireSession(req: Request, res: Response): Promise<AuthContext> {
    const auth = await this.resolve(req, res);
    if (!auth) throw unauthenticated();
    if (auth.user.status === 'BLOCKED') throw userBlocked();
    if (auth.user.status === 'INACTIVE') throw accountInactive();
    return auth;
  }

  /** Vínculos ativos do usuário (espaço + papéis), ordenados pelo nome do espaço (RN-AUTH-03). */
  async memberships(userId: string): Promise<Membership[]> {
    const rows = await this.db
      .select({
        spaceId: spaces.id,
        spaceName: spaces.name,
        spaceSlug: spaces.slug,
        spaceStatus: spaces.status,
        spaceLogoUrl: spaces.logoUrl,
        role: spaceMembers.role,
      })
      .from(spaceMembers)
      .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
      .where(and(eq(spaceMembers.userId, userId), eq(spaceMembers.status, 'ACTIVE')))
      .orderBy(asc(spaces.name), asc(spaces.id), asc(spaceMembers.role));

    const bySpace = new Map<string, Membership>();
    for (const row of rows) {
      const entry = bySpace.get(row.spaceId) ?? {
        space: {
          id: row.spaceId,
          name: row.spaceName,
          slug: row.spaceSlug,
          status: row.spaceStatus,
          logoUrl: row.spaceLogoUrl,
        },
        roles: [],
      };
      entry.roles.push(row.role);
      bySpace.set(row.spaceId, entry);
    }
    return [...bySpace.values()];
  }

  /**
   * Status do espaço e papéis ativos do usuário nele, na ordem do enum (`null` se o espaço não
   * existe; `roles` vazio sem vínculo ativo).
   */
  async spaceAccess(
    userId: string,
    spaceId: string,
  ): Promise<{ status: SpaceStatus; roles: SpaceRole[] } | null> {
    const rows = await this.db
      .select({ status: spaces.status, role: spaceMembers.role })
      .from(spaces)
      .leftJoin(
        spaceMembers,
        and(
          eq(spaceMembers.spaceId, spaces.id),
          eq(spaceMembers.userId, userId),
          eq(spaceMembers.status, 'ACTIVE'),
        ),
      )
      .where(eq(spaces.id, spaceId))
      .orderBy(asc(spaceMembers.role));
    const [first] = rows;
    if (!first) return null;
    return {
      status: first.status,
      roles: rows.flatMap((row) => (row.role ? [row.role] : [])),
    };
  }

  /** A sessão de suporte está ativa, é do Super e vale para o espaço? (RF-SUPER-04) */
  async isSupportSessionValid(
    sessionId: string,
    superUserId: string,
    spaceId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: supportSessions.id })
      .from(supportSessions)
      .where(
        and(
          eq(supportSessions.id, sessionId),
          eq(supportSessions.superUserId, superUserId),
          eq(supportSessions.spaceId, spaceId),
          isNull(supportSessions.endedAt),
          gt(supportSessions.expiresAt, new Date()),
        ),
      );
    return Boolean(row);
  }
}
