import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  addDays,
  addMinutes,
  laterDate,
  type OccupationKind,
  RECURRING_GENERATION_DAYS,
  timeToMinutes,
  utcToZoned,
  weekdayDates,
  zonedToUtc,
} from '@space-sports/shared';
import { and, asc, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm';
import { slotUnavailable } from '../bookings/bookings.errors.js';
import { isOverlapViolation, type Tx } from '../bookings/db-utils.js';
import { type SpaceContext, SpaceContextService } from '../bookings/space-context.js';
import type { Database } from '../db/client.js';
import {
  bookings,
  courtOccupations,
  recurringBookingConflicts,
  recurringBookings,
  spaces,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';

export type RecurringRow = typeof recurringBookings.$inferSelect;

/**
 * Motivos gravados em `bookings.cancel_reason` quando o mensalista deixa de ocupar a agenda. São
 * só texto para exibição: a retomada usa `bookings.cancelled_by_pause`.
 */
export const RECURRING_PAUSED_REASON = 'Mensalista pausado';
export const RECURRING_ENDED_REASON = 'Mensalista encerrado';

/**
 * `STRICT` (aprovação, cadastro direto e retomada): se uma reserva ou aula já ocupa o horário,
 * recusa tudo com 409 SLOT_UNAVAILABLE. `FLAG` (job): ocorrência que não cabe é sinalizada para a
 * gestão e o job segue.
 */
export type GenerationMode = 'STRICT' | 'FLAG';

export interface GenerationResult {
  /** Ocorrências novas. */
  created: number;
  /** Ocorrências canceladas por pausa que voltaram a valer. */
  revived: number;
  /** Ocorrências que não couberam na agenda (sinalizadas). */
  conflicts: number;
}

export interface GenerationSummary extends GenerationResult {
  recurringBookings: number;
  failures: number;
}

/**
 * Conflito que o `STRICT` recusa. Bloqueio e torneio são interrupções pontuais previstas pela
 * RN-BOOK-08: o mensalista é aprovado e a ocorrência afetada é sinalizada. Reserva ou aula no
 * mesmo horário semanal é conflito de verdade, e a gestão decide antes de aprovar.
 */
const STRICT_CONFLICT_KINDS: readonly OccupationKind[] = ['BOOKING', 'CLASS'];

/**
 * Ocorrências do mensalista (RN-BOOK-08): reservas semanais (`bookings` com source RECURRING +
 * `court_occupations`) geradas com 4 semanas de antecedência, sem cobrança (o mensalista paga
 * direto no espaço, decisão 27). Idempotente: `UNIQUE(recurring_booking_id, starts_at)` e a trava da linha do
 * mensalista impedem duplicar, mesmo com dois jobs ou com a aprovação ao mesmo tempo.
 */
@Injectable()
export class OccurrencesService {
  private readonly logger = new Logger(OccurrencesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
  ) {}

  /**
   * Gera as ocorrências que faltam entre hoje e daqui a 4 semanas. Tem de rodar dentro de uma
   * transação com a linha do mensalista travada (`lockRecurring`).
   */
  async generateFor(
    tx: Tx,
    recurring: RecurringRow,
    space: SpaceContext,
    mode: GenerationMode,
    now: Date = new Date(),
  ): Promise<GenerationResult> {
    const result: GenerationResult = { created: 0, revived: 0, conflicts: 0 };
    const today = utcToZoned(now, space.timeZone).date;
    const from = laterDate(recurring.startsOn, today);
    let to = addDays(today, RECURRING_GENERATION_DAYS);
    if (recurring.endsOn && recurring.endsOn < to) to = recurring.endsOn;
    const dates = weekdayDates(recurring.weekday, from, to);
    if (!dates.length) return result;

    const startMinute = timeToMinutes(recurring.startTime);
    const slots = dates
      .map((date) => zonedToUtc(date, startMinute, space.timeZone))
      // Ocorrência de hoje que já começou não é gerada.
      .filter((startsAt) => startsAt > now);
    const first = slots[0];
    if (!first) return result;

    const existing = new Map(
      (
        await tx
          .select()
          .from(bookings)
          .where(and(eq(bookings.recurringBookingId, recurring.id), gte(bookings.startsAt, first)))
      ).map((booking) => [booking.startsAt.getTime(), booking]),
    );

    for (const startsAt of slots) {
      const found = existing.get(startsAt.getTime());
      // Já existe viva, ou foi cancelada à mão (semana que o mensalista não vem): não recria.
      if (found && !(found.status === 'CANCELLED' && found.cancelledByPause)) continue;
      const endsAt = addMinutes(startsAt, recurring.durationMin);
      try {
        // Savepoint: a falha da constraint de exclusão não derruba a transação inteira.
        await tx.transaction(async (sp) => {
          if (found) {
            await sp
              .update(bookings)
              .set({
                status: 'CONFIRMED',
                cancelledAt: null,
                cancelledBy: null,
                cancelReason: null,
                cancelledByPause: false,
              })
              .where(eq(bookings.id, found.id));
            const [occupation] = await sp
              .update(courtOccupations)
              .set({ active: true })
              .where(
                and(eq(courtOccupations.kind, 'BOOKING'), eq(courtOccupations.refId, found.id)),
              )
              .returning({ id: courtOccupations.id });
            if (!occupation) {
              await sp.insert(courtOccupations).values({
                courtId: recurring.courtId,
                period: { start: startsAt, end: endsAt },
                kind: 'BOOKING',
                refId: found.id,
              });
            }
            return;
          }
          const [booking] = await sp
            .insert(bookings)
            .values({
              spaceId: recurring.spaceId,
              courtId: recurring.courtId,
              organizerUserId: recurring.userId,
              guestName: recurring.guestName,
              guestPhone: recurring.guestPhone,
              sportId: recurring.sportId,
              startsAt,
              endsAt,
              durationMin: recurring.durationMin,
              peopleCount: recurring.peopleCount,
              pricePerHourCents: space.pricePerHourCents ?? 0,
              // RN-BOOK-08: a ocorrência não tem cobrança (o mensalista paga direto no espaço).
              priceCents: 0,
              status: 'CONFIRMED',
              paymentStatus: 'PAID',
              source: 'RECURRING',
              recurringBookingId: recurring.id,
            })
            .returning({ id: bookings.id });
          if (!booking) throw new Error('Insert de ocorrência sem retorno.');
          await sp.insert(courtOccupations).values({
            courtId: recurring.courtId,
            period: { start: startsAt, end: endsAt },
            kind: 'BOOKING',
            refId: booking.id,
          });
        });
      } catch (err) {
        if (!isOverlapViolation(err)) throw err;
        const kind = await conflictingKind(tx, recurring.courtId, startsAt, endsAt);
        if (mode === 'STRICT' && STRICT_CONFLICT_KINDS.includes(kind)) throw slotUnavailable();
        await tx
          .insert(recurringBookingConflicts)
          .values({ recurringBookingId: recurring.id, startsAt, endsAt, conflictsWith: kind })
          .onConflictDoUpdate({
            target: [
              recurringBookingConflicts.recurringBookingId,
              recurringBookingConflicts.startsAt,
            ],
            set: { endsAt, conflictsWith: kind, resolvedAt: null },
          });
        result.conflicts++;
        continue;
      }
      if (found) result.revived++;
      else result.created++;
      // O horário voltou a caber: o aviso à gestão deixa de valer.
      await tx
        .update(recurringBookingConflicts)
        .set({ resolvedAt: now })
        .where(
          and(
            eq(recurringBookingConflicts.recurringBookingId, recurring.id),
            eq(recurringBookingConflicts.startsAt, startsAt),
            isNull(recurringBookingConflicts.resolvedAt),
          ),
        );
    }
    return result;
  }

  /** Pausa/encerramento: ver `cancelUpcomingOccurrences`. */
  cancelUpcoming(
    tx: Tx,
    recurringId: string,
    actorId: string | null,
    cause: 'PAUSE' | 'END',
    now: Date = new Date(),
  ): Promise<number> {
    return cancelUpcomingOccurrences(tx, recurringId, actorId, cause, now);
  }

  /** Trava a linha do mensalista para serializar geração, aprovação, pausa e encerramento. */
  async lockRecurring(tx: Tx, recurringId: string): Promise<RecurringRow | undefined> {
    const [row] = await tx
      .select()
      .from(recurringBookings)
      .where(eq(recurringBookings.id, recurringId))
      .for('update');
    return row;
  }

  /**
   * Job diário: gera as ocorrências de todos os mensalistas ativos de espaços ativos. Cada
   * mensalista tem a própria transação; um erro isolado é registrado e não interrompe o resto.
   */
  async generateAll(now: Date = new Date()): Promise<GenerationSummary> {
    const rows = await this.db
      .select({ id: recurringBookings.id, spaceId: recurringBookings.spaceId })
      .from(recurringBookings)
      .innerJoin(spaces, eq(spaces.id, recurringBookings.spaceId))
      .where(and(eq(recurringBookings.status, 'ACTIVE'), eq(spaces.status, 'ACTIVE')))
      .orderBy(asc(recurringBookings.createdAt), asc(recurringBookings.id));

    const summary: GenerationSummary = {
      recurringBookings: rows.length,
      created: 0,
      revived: 0,
      conflicts: 0,
      failures: 0,
    };
    const contexts = new Map<string, SpaceContext>();
    for (const { id, spaceId } of rows) {
      try {
        let space = contexts.get(spaceId);
        if (!space) {
          space = await this.spaces.load(spaceId);
          contexts.set(spaceId, space);
        }
        const context = space;
        const result = await this.db.transaction(async (tx) => {
          const recurring = await this.lockRecurring(tx, id);
          // Pausado ou encerrado depois da consulta: nada a gerar.
          if (recurring?.status !== 'ACTIVE') return null;
          return this.generateFor(tx, recurring, context, 'FLAG', now);
        });
        if (result) {
          summary.created += result.created;
          summary.revived += result.revived;
          summary.conflicts += result.conflicts;
          if (result.conflicts) {
            this.logger.warn(
              { recurringBookingId: id, spaceId, conflicts: result.conflicts },
              'Ocorrências de mensalista em conflito com a agenda (sinalizadas para a gestão)',
            );
          }
        }
      } catch (err) {
        summary.failures++;
        this.logger.error({ err, recurringBookingId: id, spaceId }, 'Falha ao gerar ocorrências');
      }
    }
    return summary;
  }
}

/**
 * Pausa/encerramento (inclusive pela exclusão da conta): cancela as ocorrências futuras que
 * ainda não começaram, libera a quadra e encerra os avisos de conflito. As canceladas pela pausa
 * ficam marcadas (`cancelled_by_pause`) para a retomada reativá-las. Devolve quantas foram
 * canceladas.
 */
export async function cancelUpcomingOccurrences(
  tx: Tx,
  recurringId: string,
  actorId: string | null,
  cause: 'PAUSE' | 'END',
  now: Date = new Date(),
): Promise<number> {
  const cancelled = await tx
    .update(bookings)
    .set({
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledBy: actorId,
      cancelReason: cause === 'PAUSE' ? RECURRING_PAUSED_REASON : RECURRING_ENDED_REASON,
      cancelledByPause: cause === 'PAUSE',
    })
    .where(
      and(
        eq(bookings.recurringBookingId, recurringId),
        eq(bookings.status, 'CONFIRMED'),
        gt(bookings.startsAt, now),
      ),
    )
    .returning({ id: bookings.id });
  if (cancelled.length) {
    await tx
      .update(courtOccupations)
      .set({ active: false })
      .where(
        and(
          eq(courtOccupations.kind, 'BOOKING'),
          inArray(
            courtOccupations.refId,
            cancelled.map((b) => b.id),
          ),
        ),
      );
  }
  await tx
    .update(recurringBookingConflicts)
    .set({ resolvedAt: now })
    .where(
      and(
        eq(recurringBookingConflicts.recurringBookingId, recurringId),
        isNull(recurringBookingConflicts.resolvedAt),
      ),
    );
  return cancelled.length;
}

/**
 * O que ocupa o horário (a primeira ocupação ativa que sobrepõe). Usado depois que a constraint
 * de exclusão recusou uma ocupação, para dizer à gestão com o que conflitou.
 */
export async function conflictingKind(
  tx: Tx,
  courtId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<OccupationKind> {
  const [occupation] = await tx
    .select({ kind: courtOccupations.kind })
    .from(courtOccupations)
    .where(
      and(
        eq(courtOccupations.courtId, courtId),
        eq(courtOccupations.active, true),
        sql`${courtOccupations.period} && tstzrange(${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz, '[)')`,
      ),
    )
    .orderBy(sql`lower(${courtOccupations.period})`)
    .limit(1);
  // Se a ocupação sumiu entre o erro e a consulta, trata como reserva (o caso mais comum).
  return occupation?.kind ?? 'BOOKING';
}
