import { Inject, Injectable } from '@nestjs/common';
import type { CourtBlock, CourtBlocksQuery, CreateCourtBlockInput } from '@space-sports/shared';
import { and, asc, eq, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { courtBlocks, courtOccupations, courts } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { courtBlockNotFound, courtNotFound, slotUnavailable } from './bookings.errors.js';
import { audit, isSlotConflict } from './db-utils.js';

type BlockRow = typeof courtBlocks.$inferSelect;

/**
 * Bloqueios manuais da quadra (RF-BOOK-06): ocupam a agenda com kind = BLOCK. Conflito com
 * reserva/aula/jogo/outro bloqueio é recusado pela constraint de exclusão (RN-BOOK-03).
 */
@Injectable()
export class CourtBlocksService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(spaceId: string, query: CourtBlocksQuery): Promise<CourtBlock[]> {
    const rows = await this.db
      .select({ block: courtBlocks })
      .from(courtBlocks)
      .innerJoin(courts, eq(courts.id, courtBlocks.courtId))
      .where(
        and(
          eq(courts.spaceId, spaceId),
          query.courtId ? eq(courtBlocks.courtId, query.courtId) : undefined,
          sql`${courtBlocks.period} && tstzrange(${query.from.toISOString()}::timestamptz, ${query.to.toISOString()}::timestamptz, '[)')`,
        ),
      )
      .orderBy(asc(sql`lower(${courtBlocks.period})`), asc(courtBlocks.id));
    return rows.map(({ block }) => toCourtBlock(block));
  }

  async create(
    spaceId: string,
    actorId: string,
    input: CreateCourtBlockInput,
  ): Promise<CourtBlock> {
    const [court] = await this.db
      .select({ id: courts.id })
      .from(courts)
      .where(and(eq(courts.id, input.courtId), eq(courts.spaceId, spaceId)));
    if (!court) throw courtNotFound();
    const period = { start: input.startsAt, end: input.endsAt };
    try {
      return await this.db.transaction(async (tx) => {
        const [block] = await tx
          .insert(courtBlocks)
          .values({ courtId: court.id, period, reason: input.reason ?? null, createdBy: actorId })
          .returning();
        if (!block) throw new Error('Insert de bloqueio sem retorno.');
        await tx
          .insert(courtOccupations)
          .values({ courtId: court.id, period, kind: 'BLOCK', refId: block.id });
        await audit(tx, {
          actorId,
          spaceId,
          action: 'court_block.create',
          entity: 'court_block',
          entityId: block.id,
          diff: {
            courtId: court.id,
            startsAt: period.start.toISOString(),
            endsAt: period.end.toISOString(),
            reason: block.reason,
          },
        });
        return toCourtBlock(block);
      });
    } catch (err) {
      if (isSlotConflict(err)) throw slotUnavailable();
      throw err;
    }
  }

  /** Remove o bloqueio e libera a agenda. */
  async remove(spaceId: string, actorId: string, blockId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ block: courtBlocks })
        .from(courtBlocks)
        .innerJoin(courts, eq(courts.id, courtBlocks.courtId))
        .where(and(eq(courtBlocks.id, blockId), eq(courts.spaceId, spaceId)) as SQL)
        .for('update', { of: courtBlocks });
      if (!found) throw courtBlockNotFound();
      await tx
        .delete(courtOccupations)
        .where(and(eq(courtOccupations.kind, 'BLOCK'), eq(courtOccupations.refId, blockId)));
      await tx.delete(courtBlocks).where(eq(courtBlocks.id, blockId));
      await audit(tx, {
        actorId,
        spaceId,
        action: 'court_block.delete',
        entity: 'court_block',
        entityId: blockId,
        diff: {
          courtId: found.block.courtId,
          startsAt: found.block.period.start.toISOString(),
          endsAt: found.block.period.end.toISOString(),
          reason: found.block.reason,
        },
      });
    });
  }
}

function toCourtBlock(block: BlockRow): CourtBlock {
  return {
    id: block.id,
    courtId: block.courtId,
    startsAt: block.period.start.toISOString(),
    endsAt: block.period.end.toISOString(),
    reason: block.reason,
    createdBy: block.createdBy,
    createdAt: block.createdAt.toISOString(),
  };
}
