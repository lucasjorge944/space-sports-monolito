import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  BlockUser,
  CreateDeletionRequest,
  DeletionRequest,
  DeletionRequestsQuery,
  DeletionSpacePending,
  PromoteSuper,
  SuperUser,
  SuperUsersQuery,
  UserStatus,
} from '@space-sports/shared';
import { and, asc, count, desc, eq, gt, ilike, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import { isUniqueViolation } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import {
  accountDeletionRequests,
  sessions,
  spaceMembers,
  spaces,
  users,
} from '../db/schema/index.js';
import { type DomainEvent, DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { Mailer, type MailMessage } from '../mail/mailer.js';
import { OnlineChargesService } from '../payments/online-charges.service.js';
import { setUserReviewsCounted } from '../reviews/review-rules.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import { anonymizeUser } from '../users/anonymize.js';
import { deleteUserMedia } from '../users/avatar-storage.js';
import { ACCOUNT_DELETED_REASON, cancelUserCommitments } from '../users/deletion-cleanup.js';
import { deletionCompletedEmail, deletionRejectedEmail } from '../users/deletion-emails.js';
import { deletionPendingByUser } from '../users/deletion-pending.js';
import { deletionDueAt } from '../users/deletion-request.js';
import { soleOwnedSpaceId } from '../users/sole-owner.js';
import {
  cannotActOnSelf,
  deletionRequestNotFound,
  deletionRequestPending,
  deletionRequestResolved,
  emailNotVerified,
  lastOwner,
  lastSuper,
  lastSuperDeletion,
  notSuper,
  userDeleted,
  userIsBlocked,
  userIsInactive,
  userNotFound,
} from './super.errors.js';
import { likePattern, superAudit } from './super-audit.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const userListColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
  phoneVerified: users.phoneVerified,
  status: users.status,
  platformRole: users.platformRole,
  createdAt: users.createdAt,
  deletedAt: users.deletedAt,
  spacesCount: sql<number>`(
    SELECT count(DISTINCT ${spaceMembers.spaceId})::int FROM ${spaceMembers}
    WHERE ${spaceMembers.userId} = ${users}.id AND ${spaceMembers.status} = 'ACTIVE'
  )`,
};

type UserListRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  phoneVerified: boolean;
  status: UserStatus;
  platformRole: 'USER' | 'SUPER';
  createdAt: Date;
  deletedAt: Date | null;
  spacesCount: number;
};

const toListItem = (row: UserListRow) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  deletedAt: row.deletedAt?.toISOString() ?? null,
});

/** Usuários, usuários Super e pedidos de exclusão LGPD (RF-SUPER-07, RF-SUPER-08). */
@Injectable()
export class SuperUsersService {
  private readonly logger = new Logger(SuperUsersService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: DomainEvents,
    private readonly mailer: Mailer,
    private readonly storage: PhotoStorage,
    private readonly online: OnlineChargesService,
  ) {}

  // Usuários -------------------------------------------------------------------------------------

  async list(query: SuperUsersQuery) {
    const conditions: SQL[] = [];
    if (query.q) {
      const pattern = likePattern(query.q);
      conditions.push(
        or(
          ilike(users.name, pattern),
          ilike(users.email, pattern),
          ilike(users.phone, pattern),
        ) as SQL,
      );
    }
    if (query.status) conditions.push(eq(users.status, query.status));
    if (query.platformRole) conditions.push(eq(users.platformRole, query.platformRole));
    const where = conditions.length ? and(...conditions) : undefined;

    const [totalRow] = await this.db.select({ total: count() }).from(users).where(where);
    const rows = await this.db
      .select(userListColumns)
      .from(users)
      .where(where)
      .orderBy(asc(users.name), asc(users.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return {
      items: rows.map(toListItem),
      page: query.page,
      pageSize: query.pageSize,
      total: totalRow?.total ?? 0,
    };
  }

  async get(userId: string): Promise<SuperUser> {
    const [row] = await this.db.select(userListColumns).from(users).where(eq(users.id, userId));
    if (!row) throw userNotFound();

    const [memberships, sessionCount, pending] = await Promise.all([
      this.db
        .select({
          spaceId: spaces.id,
          spaceName: spaces.name,
          spaceSlug: spaces.slug,
          spaceStatus: spaces.status,
          role: spaceMembers.role,
          status: spaceMembers.status,
        })
        .from(spaceMembers)
        .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
        .where(eq(spaceMembers.userId, userId))
        .orderBy(asc(spaces.name), asc(spaces.id), asc(spaceMembers.role)),
      this.db
        .select({ total: count() })
        .from(sessions)
        .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date()))),
      this.db
        .select({ id: accountDeletionRequests.id })
        .from(accountDeletionRequests)
        .where(
          and(
            eq(accountDeletionRequests.userId, userId),
            eq(accountDeletionRequests.status, 'PENDING'),
          ),
        ),
    ]);
    return {
      ...toListItem(row),
      memberships,
      activeSessions: sessionCount[0]?.total ?? 0,
      pendingDeletionRequestId: pending[0]?.id ?? null,
    };
  }

  /** Bloqueia a conta e encerra todas as sessões na mesma transação (RF-SUPER-07). */
  async block(actorId: string, userId: string, { reason }: BlockUser): Promise<SuperUser> {
    if (userId === actorId) throw cannotActOnSelf();
    await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (user.deletedAt) throw userDeleted();
      await tx.update(users).set({ status: 'BLOCKED' }).where(eq(users.id, userId));
      // RN-REVIEW-03: as avaliações saem da média enquanto durar o bloqueio.
      await setUserReviewsCounted(tx, userId, false);
      const ended = await tx
        .delete(sessions)
        .where(eq(sessions.userId, userId))
        .returning({ id: sessions.id });
      await superAudit(tx, actorId, {
        action: 'super.user.block',
        entity: 'user',
        entityId: userId,
        diff: { sessionsEnded: ended.length, ...(reason ? { reason } : {}) },
      });
    });
    return this.get(userId);
  }

  /**
   * Desbloqueia a conta bloqueada ou reativa a inativada pelo titular (RF-AUTH-03, decisão 29):
   * as duas voltam a ACTIVE. A auditoria guarda de qual status a conta saiu.
   */
  async unblock(actorId: string, userId: string): Promise<SuperUser> {
    await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (user.deletedAt) throw userDeleted();
      await tx.update(users).set({ status: 'ACTIVE' }).where(eq(users.id, userId));
      await setUserReviewsCounted(tx, userId, true);
      await superAudit(tx, actorId, {
        action: user.status === 'INACTIVE' ? 'super.user.reactivate' : 'super.user.unblock',
        entity: 'user',
        entityId: userId,
        diff: { from: user.status },
      });
    });
    return this.get(userId);
  }

  // Usuários Super -------------------------------------------------------------------------------

  async listSupers() {
    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(eq(users.platformRole, 'SUPER'), isNull(users.deletedAt)))
      .orderBy(asc(users.name), asc(users.id));
    return { items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
  }

  /**
   * Promove uma conta existente a Super. Exige e-mail verificado: sem isso, quem se cadastrasse
   * com o e-mail combinado antes do dono real herdaria o acesso à plataforma.
   */
  async promote(actorId: string, { email }: PromoteSuper) {
    const [user] = await this.db
      .select({
        id: users.id,
        emailVerified: users.emailVerified,
        status: users.status,
        platformRole: users.platformRole,
      })
      .from(users)
      .where(and(eq(users.email, email.trim().toLowerCase()), isNull(users.deletedAt)));
    if (!user) throw userNotFound();
    if (!user.emailVerified) throw emailNotVerified();
    if (user.status === 'BLOCKED') throw userIsBlocked();
    if (user.status === 'INACTIVE') throw userIsInactive();
    if (user.platformRole !== 'SUPER') {
      await this.db.transaction(async (tx) => {
        await tx.update(users).set({ platformRole: 'SUPER' }).where(eq(users.id, user.id));
        await superAudit(tx, actorId, {
          action: 'super.admin.promote',
          entity: 'user',
          entityId: user.id,
        });
      });
    }
    return this.superAdmin(user.id);
  }

  async demote(actorId: string, userId: string): Promise<void> {
    if (userId === actorId) throw cannotActOnSelf();
    await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (user.platformRole !== 'SUPER') throw notSuper();
      const [others] = await tx
        .select({ total: count() })
        .from(users)
        .where(
          and(
            eq(users.platformRole, 'SUPER'),
            eq(users.status, 'ACTIVE'),
            isNull(users.deletedAt),
            ne(users.id, userId),
          ),
        );
      if (!others?.total) throw lastSuper();
      await tx.update(users).set({ platformRole: 'USER' }).where(eq(users.id, userId));
      await superAudit(tx, actorId, {
        action: 'super.admin.demote',
        entity: 'user',
        entityId: userId,
      });
    });
  }

  private async superAdmin(userId: string) {
    const { items } = await this.listSupers();
    const admin = items.find((item) => item.id === userId);
    if (!admin) throw userNotFound();
    return admin;
  }

  // Pedidos de exclusão (LGPD) -------------------------------------------------------------------

  /**
   * Decisão 40: os pendentes primeiro, do mais antigo (o prazo vencido no topo); depois os
   * resolvidos, do mais recente. Os pendentes trazem as pendências da conta por espaço.
   */
  async listDeletionRequests(query: DeletionRequestsQuery) {
    const where = query.status ? eq(accountDeletionRequests.status, query.status) : undefined;
    const [totalRow] = await this.db
      .select({ total: count() })
      .from(accountDeletionRequests)
      .where(where);
    const isPending = sql`${accountDeletionRequests.status} = 'PENDING'`;
    const rows = await this.selectRequests()
      .where(where)
      .orderBy(
        desc(isPending),
        sql`CASE WHEN ${isPending} THEN ${accountDeletionRequests.createdAt} END ASC`,
        desc(accountDeletionRequests.createdAt),
        desc(accountDeletionRequests.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return {
      items: await this.withPending(rows),
      page: query.page,
      pageSize: query.pageSize,
      total: totalRow?.total ?? 0,
    };
  }

  /** Registra um pedido recebido fora do app (ex.: e-mail do titular). */
  async createDeletionRequest(
    actorId: string,
    userId: string,
    { note }: CreateDeletionRequest,
  ): Promise<DeletionRequest> {
    const requestId = await this.db
      .transaction(async (tx) => {
        const user = await this.lockUser(tx, userId);
        if (user.deletedAt) throw userDeleted();
        const [request] = await tx
          .insert(accountDeletionRequests)
          .values({ userId, source: 'SUPER', note: note ?? null })
          .returning({ id: accountDeletionRequests.id });
        if (!request) throw new Error('Insert do pedido sem retorno.');
        await superAudit(tx, actorId, {
          action: 'super.deletion_request.create',
          entity: 'user',
          entityId: userId,
          diff: { requestId: request.id },
        });
        return request.id;
      })
      .catch((err: unknown) => {
        if (isUniqueViolation(err, 'account_deletion_requests_user_pending_unique')) {
          throw deletionRequestPending();
        }
        throw err;
      });
    return this.getRequest(requestId);
  }

  /**
   * Atende o pedido (RF-AUTH-03, decisão 40), numa transação: cancela as reservas futuras e os
   * mensalistas do titular (liberando a quadra), encerra as assinaturas, tira-o das aulas futuras
   * promovendo a espera, anonimiza a conta, encerra os vínculos com espaços e conclui o pedido.
   * Os pagamentos no local ficam; o online das reservas futuras e dos meses ainda não começados é
   * estornado inteiro (RN-ONPAY-05). Não deixa o espaço sem Dono nem atende conta Super. Depois do
   * commit apaga do storage tudo sob `users/<id>/` e `uploads/users/<id>/` (falha só é logada), avisa os
   * participantes e os promovidos e manda o e-mail de concluído; a gestão dos espaços não é
   * avisada (a exclusão de conta é só do Super).
   */
  async fulfillDeletionRequest(
    actorId: string,
    requestId: string,
    note?: string,
  ): Promise<DeletionRequest> {
    const done = await this.db.transaction(async (tx) => {
      const request = await this.lockPendingRequest(tx, requestId);
      if (request.userId === actorId) throw cannotActOnSelf();
      const user = await this.lockUser(tx, request.userId);

      if (await soleOwnedSpaceId(tx, request.userId)) throw lastOwner();
      if (user.platformRole === 'SUPER') throw lastSuperDeletion();

      const now = new Date();
      const affected = (await deletionPendingByUser(tx, [request.userId], now)).get(request.userId);
      const cleanup = await cancelUserCommitments(tx, request.userId, actorId, now);
      // RN-ONPAY-05: o que foi pago online nas reservas futuras e nos meses ainda não começados
      // volta inteiro, ao meio original (o gateway guarda o pagador); antes de anonimizar.
      const afterPayments = await this.online.onAccountDeleted(tx, {
        userId: request.userId,
        actorId,
        cancelledBookingIds: cleanup.allCancelledBookingIds,
        waiveReason: ACCOUNT_DELETED_REASON,
        now,
      });
      await anonymizeUser(tx, request.userId, now);
      await tx
        .update(accountDeletionRequests)
        .set({
          status: 'COMPLETED',
          resolvedAt: now,
          resolvedBy: actorId,
          ...(note ? { note } : {}),
        })
        .where(eq(accountDeletionRequests.id, requestId));
      await superAudit(tx, actorId, {
        action: 'super.deletion_request.fulfill',
        entity: 'user',
        entityId: request.userId,
        diff: {
          requestId,
          cancelled: cleanup.counts,
          promoted: cleanup.promoted.length,
          spaces: (affected ?? []).map((space) => space.spaceId),
        },
      });
      return { user, userId: request.userId, cleanup, afterPayments };
    });
    await done.afterPayments();
    await deleteUserMedia(this.storage, done.userId);

    const events: DomainEvent[] = [
      ...done.cleanup.cancelledBookingIds.map(
        (bookingId): DomainEvent => ({
          type: 'booking.cancelled',
          bookingId,
          cancelledBy: actorId,
        }),
      ),
      ...done.cleanup.promoted.map(
        ({ sessionId, userId }): DomainEvent => ({
          type: 'class_attendance.promoted',
          sessionId,
          userId,
        }),
      ),
    ];
    for (const event of events) await this.events.publish(event);
    if (done.user.email) {
      this.sendInBackground(deletionCompletedEmail({ to: done.user.email, name: done.user.name }));
    }
    return this.getRequest(requestId);
  }

  /** Recusa (fraude ou exigência legal, com o motivo): a conta continua como está (inativa). */
  async rejectDeletionRequest(
    actorId: string,
    requestId: string,
    note: string,
  ): Promise<DeletionRequest> {
    const user = await this.db.transaction(async (tx) => {
      const request = await this.lockPendingRequest(tx, requestId);
      await tx
        .update(accountDeletionRequests)
        .set({ status: 'REJECTED', resolvedAt: new Date(), resolvedBy: actorId, note })
        .where(eq(accountDeletionRequests.id, requestId));
      await superAudit(tx, actorId, {
        action: 'super.deletion_request.reject',
        entity: 'user',
        entityId: request.userId,
        diff: { requestId, note },
      });
      return this.lockUser(tx, request.userId);
    });
    if (user.email) {
      this.sendInBackground(
        deletionRejectedEmail({
          to: user.email,
          name: user.name,
          note,
          inactive: user.status === 'INACTIVE',
        }),
      );
    }
    return this.getRequest(requestId);
  }

  /**
   * Desistência do titular pelo atendimento (decisão 40): o pedido fica CANCELLED e a conta
   * inativada pelo pedido volta a ACTIVE (bloqueada continua bloqueada).
   */
  async cancelDeletionRequest(
    actorId: string,
    requestId: string,
    note?: string,
  ): Promise<DeletionRequest> {
    await this.db.transaction(async (tx) => {
      const request = await this.lockPendingRequest(tx, requestId);
      const user = await this.lockUser(tx, request.userId);
      const reactivated = user.status === 'INACTIVE';
      if (reactivated) {
        await tx.update(users).set({ status: 'ACTIVE' }).where(eq(users.id, request.userId));
      }
      await tx
        .update(accountDeletionRequests)
        .set({
          status: 'CANCELLED',
          resolvedAt: new Date(),
          resolvedBy: actorId,
          ...(note ? { note } : {}),
        })
        .where(eq(accountDeletionRequests.id, requestId));
      await superAudit(tx, actorId, {
        action: 'super.deletion_request.cancel',
        entity: 'user',
        entityId: request.userId,
        diff: { requestId, reactivated, ...(note ? { note } : {}) },
      });
    });
    return this.getRequest(requestId);
  }

  // ---------------------------------------------------------------------------------------------

  private selectRequests() {
    return this.db
      .select({
        id: accountDeletionRequests.id,
        userId: accountDeletionRequests.userId,
        userName: users.name,
        status: accountDeletionRequests.status,
        source: accountDeletionRequests.source,
        reason: accountDeletionRequests.reason,
        requestedAt: accountDeletionRequests.createdAt,
        resolvedAt: accountDeletionRequests.resolvedAt,
        resolvedBy: accountDeletionRequests.resolvedBy,
        note: accountDeletionRequests.note,
      })
      .from(accountDeletionRequests)
      .innerJoin(users, eq(users.id, accountDeletionRequests.userId));
  }

  private async getRequest(requestId: string): Promise<DeletionRequest> {
    const [row] = await this.selectRequests().where(eq(accountDeletionRequests.id, requestId));
    if (!row) throw deletionRequestNotFound();
    const [request] = await this.withPending([row]);
    if (!request) throw deletionRequestNotFound();
    return request;
  }

  private async withPending(rows: RequestRow[]): Promise<DeletionRequest[]> {
    const now = new Date();
    const pendingUsers = rows.filter((row) => row.status === 'PENDING').map((row) => row.userId);
    const pending = await deletionPendingByUser(this.db, [...new Set(pendingUsers)], now);
    return rows.map((row) => toRequest(row, now, pending.get(row.userId) ?? []));
  }

  /** O envio não bloqueia a resposta; a falha só é logada (a decisão já foi gravada). */
  private sendInBackground(message: MailMessage): void {
    this.mailer.send(message).catch((err: unknown) => {
      this.logger.error({ err, subject: message.subject }, 'Falha ao enviar e-mail');
    });
  }

  private async lockPendingRequest(tx: Tx, requestId: string) {
    const [request] = await tx
      .select({
        userId: accountDeletionRequests.userId,
        status: accountDeletionRequests.status,
      })
      .from(accountDeletionRequests)
      .where(eq(accountDeletionRequests.id, requestId))
      .for('update');
    if (!request) throw deletionRequestNotFound();
    if (request.status !== 'PENDING') throw deletionRequestResolved();
    return request;
  }

  private async lockUser(tx: Tx, userId: string) {
    const [user] = await tx
      .select({
        deletedAt: users.deletedAt,
        platformRole: users.platformRole,
        status: users.status,
        email: users.email,
        name: users.name,
      })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!user) throw userNotFound();
    return user;
  }
}

type RequestRow = {
  id: string;
  userId: string;
  userName: string;
  status: DeletionRequest['status'];
  source: DeletionRequest['source'];
  reason: string | null;
  requestedAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  note: string | null;
};

function toRequest(row: RequestRow, now: Date, pending: DeletionSpacePending[]): DeletionRequest {
  const dueAt = deletionDueAt(row.requestedAt);
  const isPending = row.status === 'PENDING';
  return {
    ...row,
    requestedAt: row.requestedAt.toISOString(),
    dueAt: dueAt.toISOString(),
    overdue: isPending && dueAt <= now,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    pending: isPending ? pending : null,
  };
}
