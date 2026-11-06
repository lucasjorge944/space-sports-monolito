import { Inject, Injectable, Logger } from '@nestjs/common';
import { addMinutes } from '@space-sports/shared';
import { sql } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import type { Database } from '../db/client.js';
import {
  attendances,
  bookingParticipants,
  bookings,
  classSessions,
  notificationPreferences,
  reviewPrompts,
  spaceMembers,
  spaceReviews,
  spaces,
  users,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import {
  REVIEW_PROMPT_ANSWER_DAYS,
  reviewableAttendanceStatuses,
  reviewableBookingStatuses,
} from '../reviews/review-rules.js';
import { visibleInShowcase } from '../spaces/space-queries.js';
import { ReviewNotifier } from './review-notifier.js';

/** O job não volta mais do que isso: o que terminou antes ficou para trás (RN-REVIEW-02). */
export const REVIEW_REQUEST_LOOKBACK_MIN = 24 * 60;
/** No máximo um pedido por espaço nesse intervalo (decisão 101). */
export const REVIEW_REQUEST_COOLDOWN_DAYS = 30;
/**
 * Pedido sem avaliação criada nesse prazo conta como ignorado; a avaliação criada nesse prazo
 * grava `review_prompts.answered_at` (`markPromptsAnswered`).
 */
export const REVIEW_REQUEST_IGNORED_AFTER_DAYS = REVIEW_PROMPT_ANSWER_DAYS;
/** Com esse número de pedidos ignorados, o espaço não pede mais. */
export const REVIEW_REQUEST_MAX_IGNORED = 2;
/** Pedidos gravados por rodada; o resto fica para a próxima (o job roda a cada 5 min). */
const BATCH = 500;

/**
 * Pedidos de avaliação (RN-REVIEW-02, decisão 101), executado a cada 5 min pelo job. Pega as
 * reservas e aulas elegíveis (como em RN-REVIEW-01) que terminaram há `REVIEW_REQUEST_DELAY_MIN`
 * minutos ou mais, sem voltar mais de 24 h, e escolhe um uso por (pessoa, espaço) — o mais
 * recente — se: o espaço está na vitrine; a conta está ativa e não é da equipe do espaço; a pessoa
 * ainda não avaliou o espaço; não recebeu pedido dele nos últimos 30 dias; ignorou menos de 2
 * pedidos dele (sem `answered_at` e com mais de 7 dias); e não desligou os dois canais de
 * `REVIEW_REQUEST`. O pedido é gravado em `review_prompts` antes da notificação: o mesmo uso
 * nunca gera dois pedidos (único por pessoa e uso), e as rodadas não se sobrepõem (trava
 * consultiva na transação).
 */
@Injectable()
export class ReviewRequestsService {
  private readonly logger = new Logger(ReviewRequestsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly notifier: ReviewNotifier,
  ) {}

  /** Devolve quantos pedidos foram gravados nesta rodada. */
  async run(now: Date = new Date()): Promise<number> {
    const until = addMinutes(now, -this.env.REVIEW_REQUEST_DELAY_MIN);
    const since = addMinutes(now, -REVIEW_REQUEST_LOOKBACK_MIN);
    const promptIds = await this.db.transaction(async (tx) => {
      const { rows: lock } = await tx.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext('review_prompts')) AS locked`,
      );
      // Outra rodada (outra instância) está gravando: ela cuida destes usos.
      if (!lock[0]?.locked) return [];
      const { rows } = await tx.execute<{ id: string }>(sql`
        WITH uses AS (
          SELECT ${bookings.organizerUserId} AS user_id, ${bookings.spaceId} AS space_id,
            'BOOKING'::review_prompt_source AS source_type, ${bookings.id} AS source_id,
            ${bookings.endsAt} AS ended_at
          FROM ${bookings}
          WHERE ${bookings.status} IN ${reviewableBookingStatuses}
            AND ${bookings.endsAt} > ${since} AND ${bookings.endsAt} <= ${until}
            AND ${bookings.organizerUserId} IS NOT NULL
          UNION ALL
          SELECT ${bookingParticipants.userId}, ${bookings.spaceId}, 'BOOKING', ${bookings.id},
            ${bookings.endsAt}
          FROM ${bookings}
          JOIN ${bookingParticipants} ON ${bookingParticipants.bookingId} = ${bookings.id}
          WHERE ${bookings.status} IN ${reviewableBookingStatuses}
            AND ${bookings.endsAt} > ${since} AND ${bookings.endsAt} <= ${until}
            AND ${bookingParticipants.status} = 'ACCEPTED' AND ${bookingParticipants.userId} IS NOT NULL
          UNION ALL
          SELECT ${attendances.userId}, ${classSessions.spaceId}, 'CLASS_SESSION', ${classSessions.id},
            ${classSessions.endsAt}
          FROM ${classSessions}
          JOIN ${attendances} ON ${attendances.sessionId} = ${classSessions.id}
          WHERE ${classSessions.status} <> 'CANCELLED'
            AND ${classSessions.endsAt} > ${since} AND ${classSessions.endsAt} <= ${until}
            AND ${attendances.status} IN ${reviewableAttendanceStatuses}
        ),
        candidates AS (
          SELECT DISTINCT ON (uses.user_id, uses.space_id)
            uses.user_id, uses.space_id, uses.source_type, uses.source_id
          FROM uses
          JOIN ${users} ON ${users.id} = uses.user_id
          JOIN ${spaces} ON ${spaces.id} = uses.space_id
          WHERE ${users.status} = 'ACTIVE' AND ${users.deletedAt} IS NULL
            AND ${visibleInShowcase}
            -- O mesmo uso nunca pede duas vezes.
            AND NOT EXISTS (
              SELECT 1 FROM ${reviewPrompts} done
              WHERE done.user_id = uses.user_id AND done.source_type = uses.source_type
                AND done.source_id = uses.source_id
            )
            -- A equipe não avalia o próprio espaço.
            AND NOT EXISTS (
              SELECT 1 FROM ${spaceMembers}
              WHERE ${spaceMembers.userId} = uses.user_id AND ${spaceMembers.spaceId} = uses.space_id
                AND ${spaceMembers.status} = 'ACTIVE'
            )
            -- Já avaliou.
            AND NOT EXISTS (
              SELECT 1 FROM ${spaceReviews}
              WHERE ${spaceReviews.userId} = uses.user_id AND ${spaceReviews.spaceId} = uses.space_id
            )
            -- Um pedido por espaço a cada 30 dias.
            AND NOT EXISTS (
              SELECT 1 FROM ${reviewPrompts} recent
              WHERE recent.user_id = uses.user_id AND recent.space_id = uses.space_id
                AND recent.sent_at > ${now}::timestamptz - make_interval(days => ${REVIEW_REQUEST_COOLDOWN_DAYS}::int)
            )
            -- Ignorou menos de 2: pedido sem a marca de respondido (avaliação criada em até 7
            -- dias, gravada na criação e mantida se a avaliação for excluída) e com mais de 7 dias.
            AND (
              SELECT count(*) FROM ${reviewPrompts} ignored
              WHERE ignored.user_id = uses.user_id AND ignored.space_id = uses.space_id
                AND ignored.answered_at IS NULL
                AND ignored.sent_at <= ${now}::timestamptz - make_interval(days => ${REVIEW_REQUEST_IGNORED_AFTER_DAYS}::int)
            ) < ${REVIEW_REQUEST_MAX_IGNORED}
            -- Preferência: algum canal de REVIEW_REQUEST ligado (sem linha = ligado).
            AND NOT EXISTS (
              SELECT 1 FROM ${notificationPreferences}
              WHERE ${notificationPreferences.userId} = uses.user_id
                AND ${notificationPreferences.type} = 'REVIEW_REQUEST'
                AND NOT ${notificationPreferences.pushEnabled}
                AND NOT ${notificationPreferences.inAppEnabled}
            )
          ORDER BY uses.user_id, uses.space_id, uses.ended_at DESC, uses.source_id
          LIMIT ${BATCH}
        )
        INSERT INTO ${reviewPrompts} (user_id, space_id, source_type, source_id, sent_at)
        SELECT user_id, space_id, source_type, source_id, ${now} FROM candidates
        ON CONFLICT (user_id, source_type, source_id) DO NOTHING
        RETURNING id
      `);
      return rows.map((row) => row.id);
    });

    for (const id of promptIds) {
      try {
        await this.notifier.request(id);
      } catch (err) {
        // O pedido já está gravado: melhor perder uma notificação do que pedir duas vezes.
        this.logger.error({ err, promptId: id }, 'Falha ao enviar pedido de avaliação');
      }
    }
    return promptIds.length;
  }
}
