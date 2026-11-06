import { Inject, Injectable, Logger } from '@nestjs/common';
import { addMinutes } from '@space-sports/shared';
import { and, asc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import type { Database } from '../db/client.js';
import { bookings } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { BookingNotifier } from './booking-notifier.js';

/** Reservas reservadas por rodada; o resto fica para a próxima (o job roda a cada minuto). */
const BATCH = 500;

/**
 * Lembrete antes da reserva (RF-NOTIF-01), executado a cada minuto pelo job. Idempotente: cada
 * reserva é "reservada" com um UPDATE atômico em `reminder_sent_at` (`FOR UPDATE SKIP LOCKED`),
 * então duas execuções concorrentes ou repetidas nunca lembram a mesma reserva duas vezes.
 * Reservas feitas já dentro da janela do lembrete não recebem lembrete (o aviso seria redundante
 * com a confirmação).
 */
@Injectable()
export class BookingRemindersService {
  private readonly logger = new Logger(BookingRemindersService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly notifier: BookingNotifier,
  ) {}

  /** Devolve quantas reservas foram lembradas. */
  async run(now: Date = new Date()): Promise<number> {
    const leadMin = this.env.BOOKING_REMINDER_LEAD_MIN;
    const claimed = await this.db
      .update(bookings)
      .set({ reminderSentAt: now })
      .where(
        inArray(
          bookings.id,
          this.db
            .select({ id: bookings.id })
            .from(bookings)
            .where(
              and(
                eq(bookings.status, 'CONFIRMED'),
                isNull(bookings.reminderSentAt),
                gt(bookings.startsAt, now),
                lte(bookings.startsAt, addMinutes(now, leadMin)),
                sql`${bookings.createdAt} <= ${bookings.startsAt} - ${leadMin} * interval '1 minute'`,
              ),
            )
            .orderBy(asc(bookings.startsAt))
            .limit(BATCH)
            .for('update', { skipLocked: true }),
        ),
      )
      .returning({ id: bookings.id });

    for (const { id } of claimed) {
      try {
        await this.notifier.reminder(id);
      } catch (err) {
        // A reserva já está marcada: melhor perder um lembrete do que repetir para quem já recebeu.
        this.logger.error({ err, bookingId: id }, 'Falha ao enviar lembrete');
      }
    }
    return claimed.length;
  }
}
