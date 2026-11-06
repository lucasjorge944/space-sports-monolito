import { Inject, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_TIME_ZONE } from '@space-sports/shared';
import { and, eq, inArray } from 'drizzle-orm';
import {
  attendanceSettingsOf,
  type EnrollmentState,
  enrollmentBlock,
  enrollmentStates,
} from '../classes/attendance-rules.js';
import type { Database } from '../db/client.js';
import { attendances, cities, classGroups, classSessions, spaces } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { formatWhen } from './booking-notifier.js';
import { NotificationsService, type NotifyInput } from './notifications.service.js';

interface SessionContext {
  id: string;
  spaceId: string;
  classGroupId: string;
  groupName: string;
  spaceName: string;
  startsAt: Date;
  cancelReason: string | null;
  timeZone: string;
}

/**
 * Textos e destinatários das notificações de aula (RF-NOTIF-01, RF-CLASS-08..10): lista
 * aberta, promovido da espera e aula cancelada. Os pushes levam `classSessionId` para o deep
 * link do app.
 */
@Injectable()
export class ClassNotifier {
  private readonly logger = new Logger(ClassNotifier.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Lista aberta: avisa os matriculados que ainda não estão na lista e que podem confirmar
   * (`enrollmentBlock` com as configurações e o fuso do espaço: fica de fora a aula depois do
   * último dia do plano cancelado e o atraso com a regra ligada).
   */
  async listOpened(sessionId: string): Promise<void> {
    const session = await this.load(sessionId);
    if (!session) return;
    const listed = new Set(
      (
        await this.db
          .select({ userId: attendances.userId })
          .from(attendances)
          .where(
            and(
              eq(attendances.sessionId, sessionId),
              inArray(attendances.status, ['CONFIRMED', 'WAITLIST', 'PRESENT', 'ABSENT']),
            ),
          )
      ).map((row) => row.userId),
    );
    const states = await enrollmentStates(this.db, { classGroupIds: [session.classGroupId] });
    const settings = await attendanceSettingsOf(this.db, session.spaceId);
    const now = new Date();
    const byUser = new Map<string, EnrollmentState[]>();
    for (const state of states) {
      if (listed.has(state.userId)) continue;
      byUser.set(state.userId, [...(byUser.get(state.userId) ?? []), state]);
    }
    const recipients = [...byUser]
      .filter(([, userStates]) => !enrollmentBlock(userStates, session.startsAt, now, settings))
      .map(([userId]) => userId);
    await this.notifyEach(recipients, (userId) => ({
      userId,
      type: 'CLASS_LIST_OPEN',
      title: 'Lista de presença aberta',
      body: `${this.where(session)} · ${formatWhen(session.startsAt, session.timeZone)}`,
      data: { classSessionId: sessionId, spaceId: session.spaceId },
    }));
  }

  /** Saiu da espera: a vaga é dele. */
  async promoted(sessionId: string, userId: string): Promise<void> {
    const session = await this.load(sessionId);
    if (!session) return;
    await this.notifications.notify({
      userId,
      type: 'CLASS_WAITLIST_PROMOTED',
      title: 'Vaga confirmada na aula',
      body: `Você saiu da lista de espera · ${this.where(session)} · ${formatWhen(session.startsAt, session.timeZone)}`,
      data: { classSessionId: sessionId, spaceId: session.spaceId },
    });
  }

  /** Aula cancelada: avisa os matriculados e quem estava na lista, menos quem cancelou. */
  async cancelled(sessionId: string, cancelledBy: string): Promise<void> {
    const session = await this.load(sessionId);
    if (!session) return;
    const listed = await this.db
      .select({ userId: attendances.userId })
      .from(attendances)
      .where(
        and(
          eq(attendances.sessionId, sessionId),
          inArray(attendances.status, ['CONFIRMED', 'WAITLIST']),
        ),
      );
    const states = await enrollmentStates(this.db, { classGroupIds: [session.classGroupId] });
    const recipients = new Set([...states.map((s) => s.userId), ...listed.map((r) => r.userId)]);
    recipients.delete(cancelledBy);
    const reason = session.cancelReason ? ` · ${session.cancelReason}` : '';
    await this.notifyEach([...recipients], (userId) => ({
      userId,
      type: 'CLASS_SESSION_CANCELLED',
      title: 'Aula cancelada',
      body: `${this.where(session)} · ${formatWhen(session.startsAt, session.timeZone)}${reason}`,
      data: { classSessionId: sessionId, spaceId: session.spaceId },
    }));
  }

  /** Cada destinatário isolado: o erro de um é logado e os demais seguem. */
  private async notifyEach(
    userIds: string[],
    build: (userId: string) => NotifyInput,
  ): Promise<void> {
    for (const userId of userIds) {
      try {
        await this.notifications.notify(build(userId));
      } catch (err) {
        this.logger.error({ err, userId }, 'Falha ao notificar destinatário');
      }
    }
  }

  private where(session: SessionContext): string {
    return `${session.groupName} · ${session.spaceName}`;
  }

  private async load(sessionId: string): Promise<SessionContext | undefined> {
    const [row] = await this.db
      .select({
        id: classSessions.id,
        spaceId: classSessions.spaceId,
        classGroupId: classSessions.classGroupId,
        groupName: classGroups.name,
        spaceName: spaces.name,
        startsAt: classSessions.startsAt,
        cancelReason: classSessions.cancelReason,
        timeZone: cities.timezone,
      })
      .from(classSessions)
      .innerJoin(classGroups, eq(classGroups.id, classSessions.classGroupId))
      .innerJoin(spaces, eq(spaces.id, classSessions.spaceId))
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(eq(classSessions.id, sessionId));
    return row && { ...row, timeZone: row.timeZone || DEFAULT_TIME_ZONE };
  }
}
