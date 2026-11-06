import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  type CreateDeskRecurringBookingInput,
  checkBookingTime,
  laterDate,
  type RecurringBooking,
  type RecurringBookingDetail,
  type RecurringBookingPage,
  type RecurringBookingsQuery,
  type RecurringConflict,
  type RecurringReasonInput,
  type RequestRecurringBookingInput,
  timeToMinutes,
  utcToZoned,
  weekdayDates,
  zonedToUtc,
} from '@space-sports/shared';
import { and, eq, ilike, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import {
  bookingTimeInvalid,
  invalidCursor,
  spaceNotBookable,
} from '../bookings/bookings.errors.js';
import { findCustomerUserId } from '../bookings/customers.js';
import { assertSpaceWritable, audit, type Tx } from '../bookings/db-utils.js';
import { type SpaceContext, SpaceContextService } from '../bookings/space-context.js';
import { captureContact } from '../contacts/contact-store.js';
import type { Database } from '../db/client.js';
import { recurringBookings, users } from '../db/schema/index.js';
import { DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { OccurrencesService, type RecurringRow } from './occurrences.service.js';
import {
  invalidRecurringStatus,
  recurringNotFound,
  recurringRequestDuplicate,
  recurringStartInPast,
} from './recurring.errors.js';
import { RecurringViews } from './recurring-views.js';

type SlotInput = RequestRecurringBookingInput | CreateDeskRecurringBookingInput;

/**
 * Mensalista (RF-BOOK-05, RF-BOOK-07, RN-BOOK-08): o jogador solicita um horário fixo semanal, a
 * gestão aprova/recusa/pausa/encerra ou cadastra direto (nasce ACTIVE).
 *
 * Estados: `PENDING_APPROVAL → ACTIVE ⇄ PAUSED | ENDED | REJECTED`. Aprovar e retomar geram as
 * ocorrências das próximas 4 semanas na mesma transação: se uma reserva ou aula já ocupa o
 * horário, nada muda e a resposta é 409 `SLOT_UNAVAILABLE`. Pausar e encerrar cancelam as
 * ocorrências futuras e liberam a quadra.
 */
@Injectable()
export class RecurringBookingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
    private readonly views: RecurringViews,
    private readonly occurrences: OccurrencesService,
    private readonly events: DomainEvents,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Jogador

  /** RF-BOOK-05: solicitação do jogador (aguarda a aprovação do espaço). */
  async requestForPlayer(
    userId: string,
    input: RequestRecurringBookingInput,
  ): Promise<RecurringBookingDetail> {
    const space = await this.spaces.load(input.spaceId);
    this.assertAccepting(space);
    await this.assertSlot(space, input);
    const row = await this.db.transaction(async (tx) => {
      // Duplo clique ou duas abas: a trava serializa as solicitações do mesmo horário.
      const key = `recurring-request:${userId}:${input.courtId}:${input.weekday}:${input.startTime}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      const [pending] = await tx
        .select({ id: recurringBookings.id })
        .from(recurringBookings)
        .where(
          and(
            eq(recurringBookings.userId, userId),
            eq(recurringBookings.courtId, input.courtId),
            eq(recurringBookings.weekday, input.weekday),
            eq(recurringBookings.startTime, input.startTime),
            eq(recurringBookings.status, 'PENDING_APPROVAL'),
          ),
        )
        .limit(1);
      if (pending) throw recurringRequestDuplicate();
      const [inserted] = await tx
        .insert(recurringBookings)
        .values({
          spaceId: space.id,
          courtId: input.courtId,
          userId,
          sportId: input.sportId,
          weekday: input.weekday,
          startTime: input.startTime,
          durationMin: input.durationMin,
          peopleCount: input.peopleCount,
          startsOn: input.startsOn ?? this.today(space),
          status: 'PENDING_APPROVAL',
        })
        .returning({ id: recurringBookings.id });
      return inserted;
    });
    if (!row) throw new Error('Insert de mensalista sem retorno.');
    return this.playerDetail(row.id, userId);
  }

  async listMine(userId: string): Promise<RecurringBooking[]> {
    return this.views.list(eq(recurringBookings.userId, userId), 100, { staff: false });
  }

  async getMine(userId: string, id: string): Promise<RecurringBookingDetail> {
    return this.playerDetail(id, userId);
  }

  /** O jogador encerra o próprio mensalista (ou retira a solicitação ainda pendente). */
  async endByPlayer(
    userId: string,
    id: string,
    input: RecurringReasonInput,
  ): Promise<RecurringBookingDetail> {
    await this.db.transaction(async (tx) => {
      const recurring = await this.lock(
        tx,
        and(eq(recurringBookings.id, id), eq(recurringBookings.userId, userId)),
      );
      // RF-SUPER-03: espaço suspenso/encerrado fica só leitura.
      await assertSpaceWritable(tx, recurring.spaceId);
      await this.end(tx, recurring, userId, input.reason, ['PENDING_APPROVAL', 'ACTIVE', 'PAUSED']);
    });
    return this.playerDetail(id, userId);
  }

  // -------------------------------------------------------------------------------------------
  // Gestão

  /** RF-BOOK-05: cadastro direto pela gestão; nasce ACTIVE e já gera as ocorrências. */
  async createAtDesk(
    spaceId: string,
    actorId: string,
    input: CreateDeskRecurringBookingInput,
  ): Promise<RecurringBookingDetail> {
    const space = await this.spaces.load(spaceId);
    this.assertAccepting(space);
    await this.assertSlot(space, input);
    const userId = await findCustomerUserId(this.db, input);

    const id = await this.db.transaction(async (tx) => {
      const [recurring] = await tx
        .insert(recurringBookings)
        .values({
          spaceId,
          courtId: input.courtId,
          userId,
          guestName: input.guestName ?? null,
          guestPhone: input.guestPhone ?? null,
          sportId: input.sportId,
          weekday: input.weekday,
          startTime: input.startTime,
          durationMin: input.durationMin,
          peopleCount: input.peopleCount,
          startsOn: input.startsOn ?? this.today(space),
          status: 'ACTIVE',
        })
        .returning();
      if (!recurring) throw new Error('Insert de mensalista sem retorno.');
      const generated = await this.activate(tx, recurring, space);
      await audit(tx, {
        actorId,
        spaceId,
        action: 'recurring.desk_create',
        entity: 'recurring_booking',
        entityId: recurring.id,
        diff: { ...slotDiff(recurring), userId, guestName: recurring.guestName, ...generated },
      });
      if (input.guestPhone) {
        await captureContact(
          tx,
          { name: input.guestName, phone: input.guestPhone },
          { origin: 'RECURRING_DESK', spaceId, capturedBy: actorId },
        );
      }
      return recurring.id;
    });
    return this.staffDetail(spaceId, id);
  }

  /** RF-BOOK-07: aprova a solicitação; o horário tem de caber na agenda (409 SLOT_UNAVAILABLE). */
  async approve(spaceId: string, actorId: string, id: string): Promise<RecurringBookingDetail> {
    await this.db.transaction(async (tx) => {
      const recurring = await this.lockInSpace(tx, spaceId, id);
      this.assertFrom(recurring, ['PENDING_APPROVAL']);
      const space = await this.spaces.load(spaceId, tx);
      this.assertAccepting(space);
      // Quadra, esporte e capacidade podem ter mudado desde a solicitação.
      await this.spaces.court(
        spaceId,
        recurring.courtId,
        recurring.sportId,
        recurring.peopleCount,
        tx,
      );
      const approved = await this.setStatus(tx, recurring, 'ACTIVE', null);
      const generated = await this.activate(tx, approved, space);
      await audit(tx, {
        actorId,
        spaceId,
        action: 'recurring.approve',
        entity: 'recurring_booking',
        entityId: id,
        diff: { from: recurring.status, to: 'ACTIVE', ...generated },
      });
    });
    await this.events.publish({ type: 'recurring.approved', recurringBookingId: id });
    return this.staffDetail(spaceId, id);
  }

  /** RF-BOOK-07: recusa a solicitação. */
  async reject(
    spaceId: string,
    actorId: string,
    id: string,
    input: RecurringReasonInput,
  ): Promise<RecurringBookingDetail> {
    await this.db.transaction(async (tx) => {
      const recurring = await this.lockInSpace(tx, spaceId, id);
      this.assertFrom(recurring, ['PENDING_APPROVAL']);
      await this.setStatus(tx, recurring, 'REJECTED', input.reason);
      await audit(tx, {
        actorId,
        spaceId,
        action: 'recurring.reject',
        entity: 'recurring_booking',
        entityId: id,
        diff: { from: recurring.status, to: 'REJECTED', reason: input.reason ?? null },
      });
    });
    await this.events.publish({ type: 'recurring.rejected', recurringBookingId: id });
    return this.staffDetail(spaceId, id);
  }

  /** Pausa: cancela as ocorrências futuras e libera a quadra. */
  async pause(
    spaceId: string,
    actorId: string,
    id: string,
    input: RecurringReasonInput,
  ): Promise<RecurringBookingDetail> {
    await this.db.transaction(async (tx) => {
      const recurring = await this.lockInSpace(tx, spaceId, id);
      this.assertFrom(recurring, ['ACTIVE']);
      await this.setStatus(tx, recurring, 'PAUSED', input.reason);
      const cancelled = await this.occurrences.cancelUpcoming(tx, id, actorId, 'PAUSE');
      await audit(tx, {
        actorId,
        spaceId,
        action: 'recurring.pause',
        entity: 'recurring_booking',
        entityId: id,
        diff: { from: recurring.status, to: 'PAUSED', reason: input.reason ?? null, cancelled },
      });
    });
    return this.staffDetail(spaceId, id);
  }

  /** Retoma o mensalista pausado; as ocorrências voltam se o horário ainda estiver livre (409 se não). */
  async resume(spaceId: string, actorId: string, id: string): Promise<RecurringBookingDetail> {
    await this.db.transaction(async (tx) => {
      const recurring = await this.lockInSpace(tx, spaceId, id);
      this.assertFrom(recurring, ['PAUSED']);
      const space = await this.spaces.load(spaceId, tx);
      this.assertAccepting(space);
      const resumed = await this.setStatus(tx, recurring, 'ACTIVE', null);
      const generated = await this.activate(tx, resumed, space);
      await audit(tx, {
        actorId,
        spaceId,
        action: 'recurring.resume',
        entity: 'recurring_booking',
        entityId: id,
        diff: { from: recurring.status, to: 'ACTIVE', ...generated },
      });
    });
    return this.staffDetail(spaceId, id);
  }

  /** Encerra o mensalista (definitivo): cancela as ocorrências futuras e libera a quadra. */
  async endByStaff(
    spaceId: string,
    actorId: string,
    id: string,
    input: RecurringReasonInput,
  ): Promise<RecurringBookingDetail> {
    await this.db.transaction(async (tx) => {
      const recurring = await this.lockInSpace(tx, spaceId, id);
      await this.end(tx, recurring, actorId, input.reason, ['ACTIVE', 'PAUSED']);
    });
    return this.staffDetail(spaceId, id);
  }

  // -------------------------------------------------------------------------------------------
  // Leitura (gestão)

  async listForSpace(
    spaceId: string,
    query: RecurringBookingsQuery,
  ): Promise<RecurringBookingPage> {
    const pattern = query.q ? `%${query.q.replace(/[\\%_]/g, '\\$&')}%` : undefined;
    const where = and(
      eq(recurringBookings.spaceId, spaceId),
      query.status?.length ? inArray(recurringBookings.status, query.status) : undefined,
      query.courtId ? eq(recurringBookings.courtId, query.courtId) : undefined,
      pattern
        ? or(
            ilike(recurringBookings.guestName, pattern),
            ilike(recurringBookings.guestPhone, pattern),
            ilike(users.name, pattern),
          )
        : undefined,
      query.cursor ? lt(recurringBookings.id, decodeIdCursor(query.cursor)) : undefined,
    );
    const items = await this.views.list(where, query.limit + 1, { staff: true });
    const hasMore = items.length > query.limit;
    const pageItems = hasMore ? items.slice(0, query.limit) : items;
    const last = pageItems.at(-1);
    return { items: pageItems, nextCursor: hasMore && last ? encodeIdCursor(last.id) : null };
  }

  async getForSpace(spaceId: string, id: string): Promise<RecurringBookingDetail> {
    return this.staffDetail(spaceId, id);
  }

  /** Ocorrências que não couberam na agenda e a gestão precisa resolver (RN-BOOK-08). */
  async openConflicts(spaceId: string): Promise<RecurringConflict[]> {
    return this.views.conflicts(eq(recurringBookings.spaceId, spaceId), { staff: true });
  }

  // -------------------------------------------------------------------------------------------

  private today(space: SpaceContext): string {
    return utcToZoned(new Date(), space.timeZone).date;
  }

  /** Espaço ativo. O mensalista não depende de valor mensal: não há cobrança (decisão 27). */
  private assertAccepting(space: SpaceContext): void {
    if (space.status !== 'ACTIVE') throw spaceNotBookable();
  }

  /**
   * RN-BOOK-02: quadra ativa que oferece o esporte e comporta as pessoas; início e duração em
   * múltiplos de 30 min e dentro do funcionamento do dia da semana. Duração mín./máx.,
   * antecedência e janela do aluguel avulso não se aplicam ao horário fixo.
   */
  private async assertSlot(space: SpaceContext, input: SlotInput): Promise<void> {
    await this.spaces.court(space.id, input.courtId, input.sportId, input.peopleCount);
    const now = new Date();
    const today = utcToZoned(now, space.timeZone).date;
    if (input.startsOn && input.startsOn < today) throw recurringStartInPast();
    // O funcionamento é por dia da semana: vale validar numa data futura qualquer com o mesmo dia.
    const [reference] = weekdayDates(input.weekday, addDays(today, 1), addDays(today, 7));
    if (!reference) throw new Error('Data de referência do mensalista não encontrada.');
    const violation = checkBookingTime({
      startsAt: zonedToUtc(reference, timeToMinutes(input.startTime), space.timeZone),
      durationMin: input.durationMin,
      openingHours: space.openingHours,
      timeZone: space.timeZone,
      rules: space.rules,
      now,
      actor: 'STAFF',
    });
    if (violation) throw bookingTimeInvalid(violation);
  }

  /** Mensalista ativo: gera as ocorrências (409 se conflitar). */
  private activate(tx: Tx, recurring: RecurringRow, space: SpaceContext) {
    return this.occurrences.generateFor(tx, recurring, space, 'STRICT');
  }

  private async end(
    tx: Tx,
    recurring: RecurringRow,
    actorId: string,
    reason: string | undefined,
    from: RecurringRow['status'][],
  ): Promise<void> {
    this.assertFrom(recurring, from);
    const space = await this.spaces.load(recurring.spaceId, tx);
    const today = this.today(space);
    const [ended] = await tx
      .update(recurringBookings)
      .set({
        status: 'ENDED',
        statusReason: reason ?? null,
        // Registra o fim; nunca antes do início (constraint recurring_bookings_dates_valid).
        endsOn: laterDate(today, recurring.startsOn),
      })
      .where(eq(recurringBookings.id, recurring.id))
      .returning({ id: recurringBookings.id });
    if (!ended) throw recurringNotFound();
    const cancelled = await this.occurrences.cancelUpcoming(tx, recurring.id, actorId, 'END');
    await audit(tx, {
      actorId,
      spaceId: recurring.spaceId,
      action: 'recurring.end',
      entity: 'recurring_booking',
      entityId: recurring.id,
      diff: { from: recurring.status, to: 'ENDED', reason: reason ?? null, cancelled },
    });
  }

  private assertFrom(recurring: RecurringRow, allowed: RecurringRow['status'][]): void {
    if (!allowed.includes(recurring.status)) throw invalidRecurringStatus(recurring.status);
  }

  private async setStatus(
    tx: Tx,
    recurring: RecurringRow,
    status: RecurringRow['status'],
    reason: string | null | undefined,
  ): Promise<RecurringRow> {
    const [updated] = await tx
      .update(recurringBookings)
      .set({ status, statusReason: reason ?? null })
      .where(eq(recurringBookings.id, recurring.id))
      .returning();
    if (!updated) throw recurringNotFound();
    return updated;
  }

  private async lock(tx: Tx, where: SQL | undefined): Promise<RecurringRow> {
    const [recurring] = await tx.select().from(recurringBookings).where(where).for('update');
    if (!recurring) throw recurringNotFound();
    return recurring;
  }

  private lockInSpace(tx: Tx, spaceId: string, id: string): Promise<RecurringRow> {
    return this.lock(tx, and(eq(recurringBookings.id, id), eq(recurringBookings.spaceId, spaceId)));
  }

  private async staffDetail(spaceId: string, id: string): Promise<RecurringBookingDetail> {
    const recurring = await this.views.one(
      and(eq(recurringBookings.id, id), eq(recurringBookings.spaceId, spaceId)) as SQL,
      { staff: true },
    );
    if (!recurring) throw recurringNotFound();
    return this.views.detail(recurring, { staff: true });
  }

  private async playerDetail(id: string, userId: string): Promise<RecurringBookingDetail> {
    const recurring = await this.views.one(
      and(eq(recurringBookings.id, id), eq(recurringBookings.userId, userId)) as SQL,
      { staff: false },
    );
    if (!recurring) throw recurringNotFound();
    return this.views.detail(recurring, { staff: false });
  }
}

const slotDiff = (r: RecurringRow) => ({
  courtId: r.courtId,
  sportId: r.sportId,
  weekday: r.weekday,
  startTime: r.startTime,
  durationMin: r.durationMin,
  startsOn: r.startsOn,
});

function encodeIdCursor(id: string): string {
  return Buffer.from(id).toString('base64url');
}

function decodeIdCursor(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw invalidCursor();
  }
  return id;
}
