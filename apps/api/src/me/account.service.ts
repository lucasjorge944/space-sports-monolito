import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AccountDeletionReceipt,
  DELETION_RECENT_SESSION_MINUTES,
  type PublicAccountDeletionInput,
  type PublicAccountDeletionResponse,
  type RequestAccountDeletionInput,
} from '@space-sports/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { redisRateLimitStorage } from '../auth/redis-rate-limit.js';
import { audit } from '../bookings/db-utils.js';
import { AppException } from '../common/app.exception.js';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import type { Database } from '../db/client.js';
import { devices, sessions, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { REDIS } from '../infra/redis.module.js';
import { Mailer, type MailMessage } from '../mail/mailer.js';
import { passwordMatches } from '../users/credential.js';
import { deletionNotOpenedEmail, deletionRequestedEmail } from '../users/deletion-emails.js';
import {
  deletionDueAt,
  type OpenedDeletionRequest,
  openDeletionRequest,
} from '../users/deletion-request.js';
import { normalizeEmail } from '../users/normalize.js';
import { soleOwnedSpaceId } from '../users/sole-owner.js';
import {
  invalidPassword,
  lastOwner,
  reauthenticationRequired,
  superAccount,
  tooManyRequests,
} from './me.errors.js';

/** Resposta do pedido pela página web, a mesma em todos os casos. */
export const PUBLIC_DELETION_MESSAGE =
  'Se o e-mail e a senha estiverem corretos, a conta foi inativada e o pedido de exclusão registrado. Você vai receber um e-mail com o prazo de resposta da equipe.';

/** Limites do pedido pela página web: por IP e por e-mail (tentativas de senha). */
export const PUBLIC_DELETION_LIMITS = {
  ip: { window: 10 * 60, max: 10 },
  email: { window: 60 * 60, max: 5 },
} as const;

/** Conta do próprio usuário (RF-AUTH-03). */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  private readonly rateLimit;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) redis: Redis,
    private readonly mailer: Mailer,
  ) {
    this.rateLimit = redisRateLimitStorage(redis);
  }

  /**
   * Inativação pelo app (RF-AUTH-03, decisão 29): marca a conta INACTIVE, encerra todas as
   * sessões e apaga os dispositivos (a conta inativa não recebe push), numa transação. Não anonimiza nem cancela nada: reservas, mensalistas, pagamentos e
   * vínculos com espaços continuam como estão, e valores em aberto não barram. Conta Super precisa
   * perder o acesso antes, e o único Dono (com conta ativa) de um espaço precisa passar o espaço
   * adiante. Só o Super reativa.
   */
  async deactivate(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // A rota já exige conta ativa; a trava põe em fila com o bloqueio e a reativação pelo Super.
      const [user] = await tx
        .select({ platformRole: users.platformRole })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (user?.platformRole === 'SUPER') throw superAccount();
      if (await soleOwnedSpaceId(tx, userId, { activeAccountsOnly: true })) throw lastOwner();

      await tx.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, userId));
      const ended = await tx
        .delete(sessions)
        .where(eq(sessions.userId, userId))
        .returning({ id: sessions.id });
      const removed = await tx
        .delete(devices)
        .where(eq(devices.userId, userId))
        .returning({ id: devices.id });
      await audit(tx, {
        actorId: userId,
        spaceId: null,
        action: 'user.deactivate',
        entity: 'user',
        entityId: userId,
        diff: { sessionsEnded: ended.length, devicesRemoved: removed.length },
      });
    });
  }

  /**
   * Pedido de exclusão pelo app (RF-AUTH-03, decisão 40): com a senha atual ou com uma sessão
   * aberta há pouco (conta sem senha), cria o pedido e inativa a conta; a equipe responde até
   * `dueAt`. O e-mail de pedido recebido sai depois do commit.
   */
  async requestDeletion(
    userId: string,
    sessionId: string,
    { password, reason }: RequestAccountDeletionInput,
  ): Promise<AccountDeletionReceipt> {
    if (password !== undefined) {
      if (!(await passwordMatches(this.db, userId, password))) throw invalidPassword();
    } else if (!(await this.recentSession(sessionId))) {
      throw reauthenticationRequired();
    }
    const opened = await this.db.transaction((tx) =>
      openDeletionRequest(tx, userId, { reason, channel: 'APP' }),
    );
    // A rota exige sessão de conta ativa: a conta existe e não foi excluída.
    if (!opened) throw new Error('Conta da sessão não encontrada.');
    this.sendReceived(opened);
    return {
      requestId: opened.id,
      requestedAt: opened.createdAt.toISOString(),
      dueAt: deletionDueAt(opened.createdAt).toISOString(),
    };
  }

  /**
   * Pedido pela página web pública (exigência do Google Play), com e-mail e senha. Responde sempre
   * a mesma mensagem: e-mail inexistente, senha errada e pedido recusado (único Dono, conta Super,
   * pedido já pendente) não se distinguem. Quem acertou a senha recebe por e-mail o resultado.
   * Vale também para a conta já inativa (que não entra mais no app).
   */
  async requestDeletionPublic(
    { email, password, reason }: PublicAccountDeletionInput,
    ip: string,
  ): Promise<PublicAccountDeletionResponse> {
    const normalized = normalizeEmail(email);
    await this.consume(`${ip}|/public/deletion-request`, PUBLIC_DELETION_LIMITS.ip);
    await this.consume(
      `email:${normalized}|/public/deletion-request`,
      PUBLIC_DELETION_LIMITS.email,
    );

    const [user] = await this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.email, normalized), isNull(users.deletedAt)));
    if (!(await passwordMatches(this.db, user?.id ?? null, password)) || !user) {
      return { message: PUBLIC_DELETION_MESSAGE };
    }
    try {
      const opened = await this.db.transaction((tx) =>
        openDeletionRequest(tx, user.id, { reason, channel: 'WEB' }),
      );
      if (opened) this.sendReceived(opened);
    } catch (err) {
      if (!(err instanceof AppException)) throw err;
      this.send(deletionNotOpenedEmail({ to: normalized, name: user.name, reason: err.message }));
    }
    return { message: PUBLIC_DELETION_MESSAGE };
  }

  /** Sessão aberta há no máximo `DELETION_RECENT_SESSION_MINUTES` minutos. */
  private async recentSession(sessionId: string): Promise<boolean> {
    const [session] = await this.db
      .select({ createdAt: sessions.createdAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    const limit = Date.now() - DELETION_RECENT_SESSION_MINUTES * 60 * 1000;
    return !!session && session.createdAt.getTime() >= limit;
  }

  private async consume(key: string, rule: { window: number; max: number }): Promise<void> {
    if (!this.env.AUTH_RATE_LIMIT_ENABLED) return;
    const { allowed, retryAfter } = await this.rateLimit.consume(key, rule);
    if (!allowed) throw tooManyRequests({ retryAfter });
  }

  private sendReceived(opened: OpenedDeletionRequest): void {
    if (!opened.email) return;
    this.send(
      deletionRequestedEmail({
        to: opened.email,
        name: opened.name,
        dueAt: deletionDueAt(opened.createdAt),
      }),
    );
  }

  /** O envio não bloqueia a resposta (nem revela, pelo tempo, se o e-mail existe). */
  private send(message: MailMessage): void {
    this.mailer.send(message).catch((err: unknown) => {
      this.logger.error({ err, subject: message.subject }, 'Falha ao enviar e-mail');
    });
  }
}
