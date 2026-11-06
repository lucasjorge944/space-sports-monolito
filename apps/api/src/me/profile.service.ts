import { Inject, Injectable } from '@nestjs/common';
import {
  type FavoriteSport,
  type MeResponse,
  missingProfileFields,
  type UpdateProfile,
} from '@space-sports/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service.js';
import { audit, type DbOrTx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { sports, userSportProfiles, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { favoriteSportNotFound } from './me.errors.js';

const meColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  emailVerified: users.emailVerified,
  phone: users.phone,
  phoneVerified: users.phoneVerified,
  avatarUrl: users.avatarUrl,
  birthDate: users.birthDate,
  gender: users.gender,
  platformRole: users.platformRole,
};

/** Perfil do próprio usuário (RF-AUTH-02; decisões 64 a 70). */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly authService: AuthService,
  ) {}

  /** GET /v1/me: conta, perfil, o que falta no cadastro e os vínculos com espaços. */
  async me(userId: string): Promise<MeResponse> {
    const [user] = await this.db
      .select(meColumns)
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));
    // As rotas exigem sessão de conta ativa: a conta existe e não foi excluída.
    if (!user) throw new Error('Conta da sessão não encontrada.');
    const [favoriteSports, memberships] = await Promise.all([
      favoriteSportsOf(this.db, userId),
      this.authService.memberships(userId),
    ]);
    return {
      ...user,
      favoriteSports,
      profile: { missing: missingProfileFields(user) },
      memberships,
      access: { super: user.platformRole === 'SUPER', management: memberships.length > 0 },
    };
  }

  /**
   * PATCH /v1/me/profile: só os campos enviados mudam. Trocar o telefone grava
   * `phone_verified = false` (decisão 64): o número digitado não prova nada, nem quando o anterior
   * era verificado. `favoriteSports` é a lista completa e substitui a anterior (decisão 69). A
   * auditoria guarda só os nomes dos campos alterados, nunca os valores.
   */
  async update(userId: string, input: UpdateProfile): Promise<MeResponse> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          name: users.name,
          phone: users.phone,
          birthDate: users.birthDate,
          gender: users.gender,
        })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .for('update');
      if (!current) throw new Error('Conta da sessão não encontrada.');

      const patch: Partial<typeof users.$inferInsert> = {};
      if (input.name !== undefined && input.name !== current.name) patch.name = input.name;
      if (input.phone !== undefined && input.phone !== current.phone) {
        patch.phone = input.phone;
        patch.phoneVerified = false;
      }
      if (input.birthDate !== undefined && input.birthDate !== current.birthDate) {
        patch.birthDate = input.birthDate;
      }
      if (input.gender !== undefined && input.gender !== current.gender) {
        patch.gender = input.gender;
      }
      const changed: string[] = Object.keys(patch).filter((field) => field !== 'phoneVerified');
      if (changed.length) await tx.update(users).set(patch).where(eq(users.id, userId));

      if (input.favoriteSports !== undefined) {
        const sportsChanged = await replaceFavoriteSports(tx, userId, input.favoriteSports);
        if (sportsChanged) changed.push('favoriteSports');
      }

      if (changed.length) {
        await audit(tx, {
          actorId: userId,
          spaceId: null,
          action: 'user.profile.update',
          entity: 'user',
          entityId: userId,
          diff: { fields: changed },
        });
      }
    });
    return this.me(userId);
  }
}

/** Esportes favoritos, pelo nome do esporte. */
async function favoriteSportsOf(db: DbOrTx, userId: string): Promise<FavoriteSport[]> {
  const rows = await db
    .select({
      id: sports.id,
      name: sports.name,
      slug: sports.slug,
      level: userSportProfiles.level,
    })
    .from(userSportProfiles)
    .innerJoin(sports, eq(sports.id, userSportProfiles.sportId))
    .where(eq(userSportProfiles.userId, userId))
    .orderBy(asc(sports.name), asc(sports.id));
  return rows.map(({ level, ...sport }) => ({ sport, level }));
}

/**
 * Troca a lista inteira. Os esportes precisam estar no catálogo; a trava compartilhada impede que
 * o Super tire um deles do catálogo no meio da troca. Devolve se algo mudou.
 */
async function replaceFavoriteSports(
  tx: DbOrTx,
  userId: string,
  list: NonNullable<UpdateProfile['favoriteSports']>,
): Promise<boolean> {
  const ids = list.map((item) => item.sportId);
  if (ids.length) {
    const found = await tx
      .select({ id: sports.id })
      .from(sports)
      .where(inArray(sports.id, ids))
      .for('share');
    if (found.length !== ids.length) throw favoriteSportNotFound();
  }

  const previous = await tx
    .select({ sportId: userSportProfiles.sportId, level: userSportProfiles.level })
    .from(userSportProfiles)
    .where(eq(userSportProfiles.userId, userId));
  const key = (items: { sportId: string; level: string | null }[]) =>
    items
      .map((item) => `${item.sportId}:${item.level ?? ''}`)
      .sort()
      .join('|');
  if (key(previous) === key(list)) return false;

  await tx.delete(userSportProfiles).where(eq(userSportProfiles.userId, userId));
  if (list.length) {
    await tx
      .insert(userSportProfiles)
      .values(list.map(({ sportId, level }) => ({ userId, sportId, level })));
  }
  return true;
}
