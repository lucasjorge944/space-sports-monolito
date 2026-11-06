import { Inject, Injectable } from '@nestjs/common';
import type { OwnerInviteResult } from '@space-sports/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { spaceMembers, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';

/**
 * Convite do Dono de um espaço criado pelo Super (RF-SUPER-02). A tarefa 1.4 (equipe) substitui
 * a implementação padrão por convite com token e e-mail; o Super só depende desta interface.
 */
export abstract class OwnerInviter {
  abstract inviteOwner(input: {
    spaceId: string;
    email: string;
    invitedBy: string;
  }): Promise<OwnerInviteResult>;
}

/**
 * Padrão até o convite por token existir: se já há conta com o e-mail **verificado**, o vínculo
 * de Dono nasce ACTIVE (a implantação é assistida pelo Super). Sem conta, nada é gravado e o
 * resultado é `AWAITING_SIGNUP`; com conta de e-mail não verificado, também nada é gravado e o
 * resultado é `AWAITING_VERIFICATION` (quem se cadastra antes do dono real com o e-mail dele não
 * vira Dono). Nos dois casos o Super repete o convite depois.
 */
@Injectable()
export class DirectOwnerInviter extends OwnerInviter {
  constructor(@Inject(DB) private readonly db: Database) {
    super();
  }

  async inviteOwner({
    spaceId,
    email,
  }: {
    spaceId: string;
    email: string;
    invitedBy: string;
  }): Promise<OwnerInviteResult> {
    const normalized = email.trim().toLowerCase();
    const [user] = await this.db
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(and(eq(users.email, normalized), sql`${users.deletedAt} IS NULL`));
    if (!user) return { email: normalized, status: 'AWAITING_SIGNUP' };
    if (!user.emailVerified) return { email: normalized, status: 'AWAITING_VERIFICATION' };

    await this.db
      .insert(spaceMembers)
      .values({ userId: user.id, spaceId, role: 'OWNER', status: 'ACTIVE' })
      .onConflictDoUpdate({
        target: [spaceMembers.userId, spaceMembers.spaceId, spaceMembers.role],
        set: { status: 'ACTIVE' },
      });
    return { email: normalized, status: 'LINKED' };
  }
}
