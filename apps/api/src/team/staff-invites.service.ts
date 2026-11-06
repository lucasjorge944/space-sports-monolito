import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type InviteStaffInput,
  type Membership,
  type SpaceRole,
  STAFF_INVITE_TTL_DAYS,
  type StaffInvite,
  type StaffInvitePreview,
} from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service.js';
import { assertSpaceWritable, audit, type Tx } from '../bookings/db-utils.js';
import { maskEmail } from '../common/mask-email.js';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import type { Database } from '../db/client.js';
import { spaceMembers, spaces, staffInvites, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { Mailer } from '../mail/mailer.js';
import { normalizeEmail } from '../users/normalize.js';
import {
  alreadyMember,
  inviteEmailMismatch,
  inviteEmailNotVerified,
  inviteExpired,
  inviteNotFound,
  invitePending,
  inviteResendTooSoon,
  inviteUnavailable,
  ownerProtected,
  ownerRoleRestricted,
} from './team.errors.js';
import { assertCanTouch, lockSpace, type TeamActor } from './team.service.js';
import { staffInviteEmail } from './team-emails.js';

type InviteRow = typeof staffInvites.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Intervalo mínimo entre dois envios do mesmo convite (o envio é e-mail real, com custo e spam). */
export const STAFF_INVITE_RESEND_COOLDOWN_MS = 60_000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Convites de equipe por e-mail (RF-NOTIF-02, RN-AUTH-01/03). O token vai só por e-mail e só o
 * hash fica no banco; reenviar gera um token novo (o link anterior deixa de valer) e só é aceito
 * depois do intervalo mínimo do último envio. O aceite exige a conta com o mesmo e-mail do convite,
 * sem diferenciar maiúsculas, já verificado: quem acabou de se cadastrar com outro e-mail é recusado
 * pelo e-mail, não pela verificação pendente (a pessoa pode criar a conta antes de aceitar).
 */
@Injectable()
export class StaffInvitesService {
  private readonly logger = new Logger(StaffInvitesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly mailer: Mailer,
    private readonly authService: AuthService,
  ) {}

  /**
   * Convida `input.email` para o papel. `allowOwner` é para o painel Super (o Dono só entra pela
   * plataforma); as rotas do espaço nunca o ligam.
   */
  async create(
    spaceId: string,
    actor: TeamActor,
    input: Omit<InviteStaffInput, 'role'> & { role: SpaceRole },
    { allowOwner = false }: { allowOwner?: boolean } = {},
  ): Promise<StaffInvite> {
    if (input.role === 'OWNER' && !allowOwner) throw ownerRoleRestricted();
    const email = normalizeEmail(input.email);

    const { invite, token, space, inviterName } = await this.db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const [space] = await tx
        .select({ name: spaces.name })
        .from(spaces)
        .where(eq(spaces.id, spaceId));
      if (!space) throw new Error('Espaço do convite não encontrado.');

      // Convidar quem já é Dono mexe no vínculo dele: só o Dono pode.
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      if (existing) {
        const roles = await tx
          .select({ role: spaceMembers.role })
          .from(spaceMembers)
          .where(
            and(
              eq(spaceMembers.spaceId, spaceId),
              eq(spaceMembers.userId, existing.id),
              eq(spaceMembers.status, 'ACTIVE'),
            ),
          );
        const current = roles.map((row) => row.role);
        if (!allowOwner) assertCanTouch(actor, current);
        if (current.includes(input.role)) throw alreadyMember();
      }

      const [open] = await tx
        .select()
        .from(staffInvites)
        .where(
          and(
            eq(staffInvites.spaceId, spaceId),
            eq(staffInvites.email, email),
            eq(staffInvites.role, input.role),
            eq(staffInvites.status, 'PENDING'),
          ),
        );
      if (open) {
        if (open.expiresAt.getTime() > Date.now()) throw invitePending();
        await tx
          .update(staffInvites)
          .set({ status: 'REVOKED' })
          .where(eq(staffInvites.id, open.id));
      }

      const token = newToken();
      const [invite] = await tx
        .insert(staffInvites)
        .values({
          spaceId,
          email,
          role: input.role,
          tokenHash: hashToken(token),
          expiresAt: newExpiry(),
          invitedBy: actor.userId,
        })
        .returning();
      if (!invite) throw new Error('Insert de convite sem retorno.');
      await audit(tx, {
        actorId: actor.userId,
        spaceId,
        action: 'team.invite_create',
        entity: 'staff_invite',
        entityId: invite.id,
        diff: { email: maskEmail(email), role: input.role },
      });
      return { invite, token, space, inviterName: await userName(tx, actor.userId) };
    });

    this.sendInBackground(invite, token, space.name, inviterName);
    return toStaffInvite(invite, inviterName, actor.userId);
  }

  /** Gera um token novo e prazo novo (também para o convite vencido) e reenvia o e-mail. */
  async resend(spaceId: string, actor: TeamActor, inviteId: string): Promise<StaffInvite> {
    const { invite, token, space, inviterName } = await this.db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const current = await this.pendingInvite(tx, spaceId, inviteId);
      assertCanHandle(actor, current);
      assertResendAllowed(current);
      const token = newToken();
      const [invite] = await tx
        .update(staffInvites)
        .set({ tokenHash: hashToken(token), expiresAt: newExpiry() })
        .where(eq(staffInvites.id, inviteId))
        .returning();
      if (!invite) throw new Error('Update de convite sem retorno.');
      await audit(tx, {
        actorId: actor.userId,
        spaceId,
        action: 'team.invite_resend',
        entity: 'staff_invite',
        entityId: invite.id,
        diff: { email: maskEmail(invite.email), role: invite.role },
      });
      const [space] = await tx
        .select({ name: spaces.name })
        .from(spaces)
        .where(eq(spaces.id, spaceId));
      return {
        invite,
        token,
        space: space ?? { name: '' },
        inviterName: await userName(tx, invite.invitedBy),
      };
    });

    this.sendInBackground(invite, token, space.name, inviterName);
    return toStaffInvite(invite, inviterName, invite.invitedBy);
  }

  async revoke(spaceId: string, actor: TeamActor, inviteId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const invite = await this.pendingInvite(tx, spaceId, inviteId);
      assertCanHandle(actor, invite);
      await tx.update(staffInvites).set({ status: 'REVOKED' }).where(eq(staffInvites.id, inviteId));
      await audit(tx, {
        actorId: actor.userId,
        spaceId,
        action: 'team.invite_revoke',
        entity: 'staff_invite',
        entityId: inviteId,
        diff: { email: maskEmail(invite.email), role: invite.role },
      });
    });
  }

  /** Prévia pública: quem tem o token (enviado ao e-mail convidado) vê o espaço e o papel. */
  async preview(token: string): Promise<StaffInvitePreview> {
    const [row] = await this.db
      .select({ invite: staffInvites, space: spaces })
      .from(staffInvites)
      .innerJoin(spaces, eq(spaces.id, staffInvites.spaceId))
      .where(eq(staffInvites.tokenHash, hashToken(token)));
    if (!row) throw inviteNotFound();
    assertUsable(row.invite);

    const [account] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, row.invite.email));
    return {
      email: row.invite.email,
      role: row.invite.role,
      expiresAt: row.invite.expiresAt.toISOString(),
      space: {
        id: row.space.id,
        name: row.space.name,
        slug: row.space.slug,
        status: row.space.status,
      },
      hasAccount: Boolean(account),
    };
  }

  /**
   * Aceita o convite com a conta logada, que precisa ter o e-mail convidado. Cria (ou reativa) o
   * vínculo ACTIVE; é idempotente para quem já aceitou.
   */
  async accept(
    user: { id: string; email: string | null; emailVerified: boolean },
    token: string,
  ): Promise<Membership> {
    const spaceId = await this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ spaceId: staffInvites.spaceId })
        .from(staffInvites)
        .where(eq(staffInvites.tokenHash, hashToken(token)));
      if (!found) throw inviteNotFound();
      // Mesma ordem de trava das demais mutações (espaço primeiro) para evitar deadlock.
      await lockSpace(tx, found.spaceId);
      const [invite] = await tx
        .select()
        .from(staffInvites)
        .where(eq(staffInvites.tokenHash, hashToken(token)))
        .for('update');
      if (!invite) throw inviteNotFound();

      if (invite.status === 'ACCEPTED' && invite.acceptedBy === user.id) {
        // Repetir o aceite não ressuscita um vínculo que a gestão já removeu.
        const [active] = await tx
          .select({ id: spaceMembers.id })
          .from(spaceMembers)
          .where(
            and(
              eq(spaceMembers.userId, user.id),
              eq(spaceMembers.spaceId, invite.spaceId),
              eq(spaceMembers.role, invite.role),
              eq(spaceMembers.status, 'ACTIVE'),
            ),
          );
        if (!active) throw inviteUnavailable();
        return invite.spaceId;
      }
      assertUsable(invite);
      if (!user.email || normalizeEmail(user.email) !== invite.email) {
        throw inviteEmailMismatch();
      }
      // O convite dá acesso ao espaço a quem controla o e-mail: sem verificação, qualquer um
      // cadastraria o e-mail alheio e entraria na equipe.
      if (!user.emailVerified) throw inviteEmailNotVerified();
      await assertSpaceWritable(tx, invite.spaceId);

      await tx
        .insert(spaceMembers)
        .values({
          userId: user.id,
          spaceId: invite.spaceId,
          role: invite.role,
          status: 'ACTIVE',
        })
        .onConflictDoUpdate({
          target: [spaceMembers.userId, spaceMembers.spaceId, spaceMembers.role],
          set: { status: 'ACTIVE', updatedAt: new Date() },
        });
      await tx
        .update(staffInvites)
        .set({ status: 'ACCEPTED', acceptedBy: user.id, acceptedAt: new Date() })
        .where(eq(staffInvites.id, invite.id));
      await audit(tx, {
        actorId: user.id,
        spaceId: invite.spaceId,
        action: 'team.invite_accept',
        entity: 'staff_invite',
        entityId: invite.id,
        diff: { role: invite.role },
      });
      return invite.spaceId;
    });

    const memberships = await this.authService.memberships(user.id);
    const membership = memberships.find((m) => m.space.id === spaceId);
    if (!membership) throw new Error('Vínculo recém-criado não encontrado.');
    return membership;
  }

  private async pendingInvite(tx: Tx, spaceId: string, inviteId: string): Promise<InviteRow> {
    const [invite] = await tx
      .select()
      .from(staffInvites)
      .where(and(eq(staffInvites.id, inviteId), eq(staffInvites.spaceId, spaceId)))
      .for('update');
    if (!invite) throw inviteNotFound();
    if (invite.status !== 'PENDING') throw inviteUnavailable();
    return invite;
  }

  /**
   * O envio não bloqueia a resposta; falha não desfaz o convite (a gestão pode reenviar).
   * O servidor SMTP lento ou fora do ar não segura a requisição da gestão.
   */
  private sendInBackground(
    invite: InviteRow,
    token: string,
    spaceName: string,
    inviterName: string,
  ): void {
    this.mailer
      .send(
        staffInviteEmail({
          to: invite.email,
          spaceName,
          role: invite.role,
          inviterName,
          url: `${this.env.WEB_URL}/convite/${token}`,
          expiresAt: invite.expiresAt,
        }),
      )
      .catch((err: unknown) => {
        this.logger.error({ err, inviteId: invite.id }, 'Falha ao enviar o e-mail do convite');
      });
  }
}

/** Convite de Dono só é mexido por Dono (ou pela plataforma, que não passa por aqui). */
function assertCanHandle(actor: TeamActor, invite: InviteRow): void {
  if (invite.role === 'OWNER' && !actor.roles.includes('OWNER')) throw ownerProtected();
}

/**
 * `updatedAt` de um convite pendente só muda ao criar ou reenviar, então marca o último envio.
 * Convite vencido pode ser reenviado sem esperar (ninguém consegue usar o link antigo).
 */
function assertResendAllowed(invite: InviteRow): void {
  if (invite.expiresAt.getTime() <= Date.now()) return;
  const waitMs = invite.updatedAt.getTime() + STAFF_INVITE_RESEND_COOLDOWN_MS - Date.now();
  if (waitMs > 0) throw inviteResendTooSoon(Math.ceil(waitMs / 1000));
}

function assertUsable(invite: InviteRow): void {
  if (invite.status !== 'PENDING') throw inviteUnavailable();
  if (invite.expiresAt.getTime() <= Date.now()) throw inviteExpired();
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function newExpiry(): Date {
  return new Date(Date.now() + STAFF_INVITE_TTL_DAYS * DAY_MS);
}

async function userName(tx: Tx, userId: string): Promise<string> {
  const [row] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return row?.name ?? '';
}

function toStaffInvite(invite: InviteRow, inviterName: string, inviterId: string): StaffInvite {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    status: invite.expiresAt.getTime() > Date.now() ? 'PENDING' : 'EXPIRED',
    expiresAt: invite.expiresAt.toISOString(),
    invitedBy: { id: inviterId, name: inviterName },
    createdAt: invite.createdAt.toISOString(),
  };
}
