import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ClassSessionStatus,
  SPACE_SETTINGS_DEFAULTS,
  type UpdateClassSessionInput,
} from '@space-sports/shared';
import { and, asc, eq, inArray, lte, type SQL, sql } from 'drizzle-orm';
import { slotUnavailable } from '../bookings/bookings.errors.js';
import { audit, isSlotConflict, type Tx } from '../bookings/db-utils.js';
import { SpaceContextService } from '../bookings/space-context.js';
import type { Database } from '../db/client.js';
import {
  auditLogs,
  classSessions,
  courtOccupations,
  spaceSettings,
  spaces,
  teacherOccupations,
} from '../db/schema/index.js';
import { DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { sessionStatusConflict } from './attendance.errors.js';
import {
  lockSession,
  occupiedCount,
  promoteWaitlist,
  type SessionRow,
  UPCOMING_STATUSES,
} from './attendance-core.js';
import {
  assertTeachers,
  replaceSessionTeachers,
  sameTeachers,
  sessionTeachers,
} from './class-teachers.js';
import {
  capacityBelowConfirmed,
  classSessionNotEditable,
  classSessionNotFound,
} from './classes.errors.js';
import { type ClassesScope, sessionScope } from './classes-scope.js';

export interface AttendanceTickSummary {
  opened: number;
  closed: number;
  done: number;
  failures: number;
}

/**
 * Ciclo da sessão (RN-CLASS-04): `SCHEDULED → OPEN ⇄ CLOSED → DONE`, ou `CANCELLED`.
 * - Modo AUTOMATIC: o job de 1 minuto abre em `starts_at − attendance_open_before_min` e fecha em
 *   `starts_at − attendance_close_before_min`.
 * - Modo MANUAL: fica `SCHEDULED` até a gestão abrir.
 * - Em qualquer modo, Dono/Admin/Professor (só nas sessões em que está) abre, fecha e reabre. Reabrir
 *   depois do horário de fechamento automático segura a lista aberta até alguém fechar.
 * - Depois do fim, o job leva a `DONE`. Toda ação vai para `audit_logs` (as do job sem ator,
 *   inclusive a ida para `DONE`).
 */
@Injectable()
export class ClassSessionLifecycleService {
  private readonly logger = new Logger(ClassSessionLifecycleService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: DomainEvents,
    private readonly spaces: SpaceContextService,
  ) {}

  /** Abre a lista (ou reabre a fechada). Só antes do fim da aula. */
  async open(spaceId: string, actorId: string, scope: ClassesScope, sessionId: string) {
    const now = new Date();
    const firstOpen = await this.db.transaction(async (tx) => {
      const session = await this.lockScoped(tx, spaceId, scope, sessionId);
      if (!['SCHEDULED', 'CLOSED'].includes(session.status) || session.endsAt <= now) {
        throw sessionStatusConflict(session.status, 'open');
      }
      await tx
        .update(classSessions)
        .set({ status: 'OPEN', openedAt: now, openedBy: actorId })
        .where(eq(classSessions.id, sessionId));
      const reopen = session.status === 'CLOSED';
      await audit(tx, {
        actorId,
        spaceId,
        action: reopen ? 'class_session.reopen' : 'class_session.open',
        entity: 'class_session',
        entityId: sessionId,
        diff: { before: session.status, after: 'OPEN' },
      });
      return !reopen;
    });
    // Reabrir não avisa os alunos de novo.
    if (firstOpen) await this.events.publish({ type: 'class_session.opened', sessionId });
  }

  async close(spaceId: string, actorId: string, scope: ClassesScope, sessionId: string) {
    await this.db.transaction(async (tx) => {
      const session = await this.lockScoped(tx, spaceId, scope, sessionId);
      if (session.status !== 'OPEN') throw sessionStatusConflict(session.status, 'close');
      await tx
        .update(classSessions)
        .set({ status: 'CLOSED', closedAt: new Date(), closedBy: actorId })
        .where(eq(classSessions.id, sessionId));
      await audit(tx, {
        actorId,
        spaceId,
        action: 'class_session.close',
        entity: 'class_session',
        entityId: sessionId,
        diff: { before: 'OPEN', after: 'CLOSED' },
      });
    });
  }

  /**
   * Cancela a aula (feriado, chuva; RF-CLASS-09): libera a quadra (a ocupação CLASS fica
   * inativa) e a agenda dos professores (decisão 47) e avisa os alunos. A lista fica como estava,
   * para o histórico; a sessão cancelada não volta a ser gerada pelo job.
   */
  async cancel(spaceId: string, actorId: string, sessionId: string, reason: string) {
    await this.db.transaction(async (tx) => {
      const session = await this.lockScoped(tx, spaceId, { kind: 'ALL' }, sessionId);
      if (!UPCOMING_STATUSES.includes(session.status)) {
        throw sessionStatusConflict(session.status, 'cancel');
      }
      await tx
        .update(classSessions)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: actorId,
          cancelReason: reason,
        })
        .where(eq(classSessions.id, sessionId));
      await tx
        .update(courtOccupations)
        .set({ active: false })
        .where(and(eq(courtOccupations.kind, 'CLASS'), eq(courtOccupations.refId, sessionId)));
      await tx
        .update(teacherOccupations)
        .set({ active: false })
        .where(eq(teacherOccupations.classSessionId, sessionId));
      await audit(tx, {
        actorId,
        spaceId,
        action: 'class_session.cancel',
        entity: 'class_session',
        entityId: sessionId,
        diff: { before: session.status, after: 'CANCELLED', reason },
      });
    });
    await this.events.publish({ type: 'class_session.cancelled', sessionId, cancelledBy: actorId });
  }

  /**
   * Ajustes só desta aula (a turma não muda): capacidade (não abaixo dos confirmados e das
   * presenças marcadas; aumentar promove a espera antes do início, RN-CLASS-03) e a lista de
   * professores (RF-CLASS-09, decisão 47: quem entra passa pela agenda em outros espaços).
   * Deadlock na disputa pelo horário vira 409 SLOT_UNAVAILABLE.
   */
  async update(
    spaceId: string,
    actorId: string,
    sessionId: string,
    input: UpdateClassSessionInput,
  ): Promise<void> {
    let promoted: string[];
    try {
      promoted = await this.db.transaction(async (tx) => {
        const session = await this.lockScoped(tx, spaceId, { kind: 'ALL' }, sessionId);
        if (!UPCOMING_STATUSES.includes(session.status)) {
          throw classSessionNotEditable(session.status);
        }
        const promotedIds: string[] = [];
        if (input.capacity !== undefined && input.capacity !== session.capacity) {
          const occupied = await occupiedCount(tx, sessionId);
          if (input.capacity < occupied) throw capacityBelowConfirmed(occupied);
          await tx
            .update(classSessions)
            .set({ capacity: input.capacity })
            .where(eq(classSessions.id, sessionId));
          await audit(tx, {
            actorId,
            spaceId,
            action: 'class_session.capacity_change',
            entity: 'class_session',
            entityId: sessionId,
            diff: { before: session.capacity, after: input.capacity },
          });
          promotedIds.push(
            ...(await promoteWaitlist(tx, { ...session, capacity: input.capacity })),
          );
        }
        const before = (await sessionTeachers(tx, [sessionId])).get(sessionId) ?? [];
        if (input.teacherMemberIds !== undefined && !sameTeachers(before, input.teacherMemberIds)) {
          const after = await assertTeachers(tx, spaceId, input.teacherMemberIds);
          const { timeZone } = await this.spaces.load(spaceId, tx);
          await replaceSessionTeachers(tx, session, after, timeZone);
          await audit(tx, {
            actorId,
            spaceId,
            action: 'class_session.teacher_change',
            entity: 'class_session',
            entityId: sessionId,
            diff: {
              before: before.map((teacher) => teacher.memberId),
              after: input.teacherMemberIds,
            },
          });
        }
        return promotedIds;
      });
    } catch (err) {
      if (isSlotConflict(err)) throw slotUnavailable();
      throw err;
    }
    await this.publishPromoted(sessionId, promoted);
  }

  async publishPromoted(sessionId: string, userIds: string[]): Promise<void> {
    for (const userId of userIds) {
      await this.events.publish({ type: 'class_attendance.promoted', sessionId, userId });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Job de 1 minuto

  /**
   * Uma rodada do job: leva a `DONE` o que terminou, fecha e abre as listas do modo AUTOMATIC.
   * Idempotente: cada sessão muda numa transação própria, com a linha travada e o status
   * conferido de novo; repetir a rodada (retry) não repete transição nem aviso. A falha de uma
   * sessão é contada e o resto segue.
   */
  async tick(now: Date = new Date()): Promise<AttendanceTickSummary> {
    const summary: AttendanceTickSummary = { opened: 0, closed: 0, done: 0, failures: 0 };

    try {
      summary.done = await this.finishEnded(now);
    } catch (err) {
      summary.failures++;
      this.logger.error({ err }, 'Falha ao encerrar as aulas terminadas');
    }

    const d = SPACE_SETTINGS_DEFAULTS;
    const automatic = sql`coalesce(${spaceSettings.attendanceMode}, ${d.attendanceMode}) = 'AUTOMATIC'`;
    const closeAt = sql`${classSessions.startsAt} - make_interval(mins => coalesce(${spaceSettings.attendanceCloseBeforeMin}, ${d.attendanceCloseBeforeMin}::int))`;
    const openAt = sql`${classSessions.startsAt} - make_interval(mins => coalesce(${spaceSettings.attendanceOpenBeforeMin}, ${d.attendanceOpenBeforeMin}::int))`;

    // Fecha: a aberta que chegou ao horário de fechamento (se não foi reaberta depois dele) e a
    // que nem chegou a abrir (job parado, turma criada em cima da hora).
    const toClose = await this.due(
      and(
        automatic,
        sql`${closeAt} <= ${now}`,
        sql`(${classSessions.status} = 'SCHEDULED' OR (${classSessions.status} = 'OPEN' AND ${classSessions.openedAt} < ${closeAt}))`,
      ),
    );
    for (const { id, spaceId } of toClose) {
      await this.autoTransition(id, spaceId, ['SCHEDULED', 'OPEN'], 'CLOSED', now, summary);
    }

    // Abre: espaços ativos, entre o horário de abertura e o de fechamento.
    const toOpen = await this.due(
      and(
        automatic,
        eq(spaces.status, 'ACTIVE'),
        eq(classSessions.status, 'SCHEDULED'),
        sql`${openAt} <= ${now}`,
        sql`${closeAt} > ${now}`,
      ),
    );
    for (const { id, spaceId } of toOpen) {
      await this.autoTransition(id, spaceId, ['SCHEDULED'], 'OPEN', now, summary);
    }
    return summary;
  }

  /**
   * Terminou: `DONE` (em qualquer modo e status de espaço), em lote, com uma linha de auditoria
   * por sessão (`class_session.done`, sem ator). As linhas são travadas em ordem de id: uma
   * rodada paralela espera e, ao reler, não acha mais a sessão (nem audita de novo).
   */
  private async finishEnded(now: Date): Promise<number> {
    return this.db.transaction(async (tx) => {
      const ended = await tx
        .select({
          id: classSessions.id,
          spaceId: classSessions.spaceId,
          status: classSessions.status,
        })
        .from(classSessions)
        .where(
          and(
            inArray(classSessions.status, [...UPCOMING_STATUSES]),
            lte(classSessions.endsAt, now),
          ),
        )
        .orderBy(asc(classSessions.id))
        .for('update');
      if (!ended.length) return 0;
      await tx
        .update(classSessions)
        .set({ status: 'DONE' })
        .where(
          inArray(
            classSessions.id,
            ended.map((row) => row.id),
          ),
        );
      await tx.insert(auditLogs).values(
        ended.map((row) => ({
          actorId: null,
          spaceId: row.spaceId,
          action: 'class_session.done',
          entity: 'class_session',
          entityId: row.id,
          diff: { before: row.status, after: 'DONE', automatic: true },
        })),
      );
      return ended.length;
    });
  }

  private due(where: SQL | undefined) {
    return this.db
      .select({ id: classSessions.id, spaceId: classSessions.spaceId })
      .from(classSessions)
      .innerJoin(spaces, eq(spaces.id, classSessions.spaceId))
      .leftJoin(spaceSettings, eq(spaceSettings.spaceId, classSessions.spaceId))
      .where(and(inArray(classSessions.status, ['SCHEDULED', 'OPEN']), where))
      .orderBy(asc(classSessions.startsAt), asc(classSessions.id));
  }

  private async autoTransition(
    sessionId: string,
    spaceId: string,
    from: ClassSessionStatus[],
    to: 'OPEN' | 'CLOSED',
    now: Date,
    summary: AttendanceTickSummary,
  ): Promise<void> {
    try {
      const changed = await this.db.transaction(async (tx) => {
        const session = await lockSession(tx, eq(classSessions.id, sessionId));
        // Outra rodada (ou a gestão) já mexeu nela.
        if (!session || !from.includes(session.status)) return false;
        await tx
          .update(classSessions)
          .set(
            to === 'OPEN'
              ? { status: 'OPEN', openedAt: now, openedBy: null }
              : { status: 'CLOSED', closedAt: now, closedBy: null },
          )
          .where(eq(classSessions.id, sessionId));
        await audit(tx, {
          actorId: null,
          spaceId,
          action: to === 'OPEN' ? 'class_session.open' : 'class_session.close',
          entity: 'class_session',
          entityId: sessionId,
          diff: { before: session.status, after: to, automatic: true },
        });
        return true;
      });
      if (!changed) return;
      if (to === 'OPEN') {
        summary.opened++;
        await this.events.publish({ type: 'class_session.opened', sessionId });
      } else {
        summary.closed++;
      }
    } catch (err) {
      summary.failures++;
      this.logger.error({ err, sessionId, to }, 'Falha na transição automática da lista');
    }
  }

  private async lockScoped(
    tx: Tx,
    spaceId: string,
    scope: ClassesScope,
    sessionId: string,
  ): Promise<SessionRow> {
    const session = await lockSession(
      tx,
      and(eq(classSessions.spaceId, spaceId), eq(classSessions.id, sessionId), sessionScope(scope)),
    );
    if (!session) throw classSessionNotFound();
    return session;
  }
}
