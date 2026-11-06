import { addDays, addMinutes } from '@space-sports/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SpaceContextService } from '../../src/bookings/space-context.js';
import type { Database } from '../../src/db/client.js';
import {
  bookings,
  courtOccupations,
  recurringBookingCharges,
  recurringBookingConflicts,
  recurringBookings,
  spaceSettings,
  spaces,
} from '../../src/db/schema/index.js';
import { OccurrencesService } from '../../src/recurring/occurrences.service.js';
import {
  PartialJobFailure,
  RECURRING_JOBS,
  runRecurringJob,
} from '../../src/recurring/recurring.jobs.js';
import { createTestApp, type SignedUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space, useMiddayClock } from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';
import { occurrenceStart, slotWeekday, today } from './fixtures.js';

// RN-BOOK-08: job que gera as ocorrências semanais do mensalista (sem mensalidade, decisão 27).

useMiddayClock();

type RecurringInsert = typeof recurringBookings.$inferInsert;

describe('jobs do mensalista', () => {
  let t: TestApp;
  let occurrences: OccurrencesService;
  let manager: SignedUp;
  let space: Space;
  let nextTime = 0;

  beforeAll(async () => {
    t = await createTestApp();
    occurrences = t.app.get(OccurrencesService);
  });
  afterAll(() => t.close());
  // Os jobs varrem todos os mensalistas ativos: encerra os do teste anterior para os totais
  // de cada execução refletirem só o teste em curso.
  afterEach(async () => {
    await t.db.update(recurringBookings).set({ status: 'ENDED' });
  });

  /** Espaço próprio por bloco, para os jobs (que varrem todos os espaços) não se misturarem. */
  async function freshSpace(slug: string) {
    space = await createSpace(t.db, slug);
    manager = await member(t, `gestor-${slug}@exemplo.com`, space.id, 'ADMIN');
    nextTime = 0;
  }

  /** Horário de 30 min sem repetir dentro do espaço. */
  const newTime = () => {
    const i = nextTime++;
    return `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
  };

  /** Mensalista inserido direto no banco (sem ocorrências), como se tivesse sido aprovado antes. */
  async function insertRecurring(overrides: Partial<RecurringInsert> = {}, db: Database = t.db) {
    return first(
      await db
        .insert(recurringBookings)
        .values({
          spaceId: space.id,
          courtId: space.courtA,
          sportId: space.sportId,
          guestName: 'Mensalista Teste',
          guestPhone: '+5531988887777',
          weekday: slotWeekday(),
          startTime: newTime(),
          durationMin: 30,
          peopleCount: 4,
          startsOn: today(),
          status: 'ACTIVE',
          ...overrides,
        })
        .returning(),
    );
  }

  const bookingsOf = (recurringId: string) =>
    t.db
      .select()
      .from(bookings)
      .where(eq(bookings.recurringBookingId, recurringId))
      .orderBy(asc(bookings.startsAt));

  const chargesOf = (recurringId: string) =>
    t.db
      .select()
      .from(recurringBookingCharges)
      .where(eq(recurringBookingCharges.recurringBookingId, recurringId))
      .orderBy(asc(recurringBookingCharges.periodStart));

  const manage = (path: string) => `/v1/manage/spaces/${space.id}/${path}`;

  describe('geração das ocorrências', () => {
    beforeAll(() => freshSpace('arena-job-ocorrencias'));

    it('gera 4 semanas de ocorrências sem cobrança própria e é idempotente', async () => {
      const recurring = await insertRecurring();
      const start = recurring.startTime.slice(0, 5);

      const run1 = await occurrences.generateAll();
      expect(run1).toMatchObject({ created: 4, conflicts: 0, failures: 0 });
      const rows = await bookingsOf(recurring.id);
      expect(rows.map((b) => b.startsAt)).toEqual(
        [0, 1, 2, 3].map((n) => occurrenceStart(n, start)),
      );
      expect(rows.every((b) => b.source === 'RECURRING' && b.priceCents === 0)).toBe(true);

      // Rodar de novo (e de novo) não duplica nada.
      expect(await occurrences.generateAll()).toMatchObject({ created: 0, revived: 0 });
      expect(await occurrences.generateAll()).toMatchObject({ created: 0 });
      expect(await bookingsOf(recurring.id)).toHaveLength(4);
      const occupations = await t.db
        .select()
        .from(courtOccupations)
        .where(
          and(
            eq(courtOccupations.kind, 'BOOKING'),
            inArray(
              courtOccupations.refId,
              rows.map((b) => b.id),
            ),
          ),
        );
      expect(occupations).toHaveLength(4);
    });

    it('execuções simultâneas (duas instâncias) não duplicam as ocorrências', async () => {
      const recurring = await insertRecurring();
      await Promise.all([occurrences.generateAll(), occurrences.generateAll()]);
      expect(await bookingsOf(recurring.id)).toHaveLength(4);
    });

    it('a janela anda com o tempo: uma semana depois entra só a ocorrência nova', async () => {
      const recurring = await insertRecurring();
      await occurrences.generateAll();
      const weekLater = addMinutes(new Date(), 7 * 24 * 60);
      const run = await occurrences.generateAll(weekLater);
      expect(run).toMatchObject({ created: 1, conflicts: 0 });
      const rows = await bookingsOf(recurring.id);
      expect(rows).toHaveLength(5);
      expect(rows.at(-1)?.startsAt).toEqual(occurrenceStart(4, recurring.startTime.slice(0, 5)));
    });

    it('ocorrência cancelada à mão (semana que o mensalista não vem) não é recriada', async () => {
      const recurring = await insertRecurring();
      await occurrences.generateAll();
      const [, second] = await bookingsOf(recurring.id);
      if (!second) throw new Error('Sem ocorrências.');
      await t
        .http()
        .post(manage(`bookings/${second.id}/cancel`))
        .set(...bearer(manager))
        .send({ reason: 'Mensalista avisou que não vem' })
        .expect(200);

      expect(await occurrences.generateAll()).toMatchObject({ created: 0, revived: 0 });
      const rows = await bookingsOf(recurring.id);
      expect(rows.filter((b) => b.status === 'CANCELLED').map((b) => b.id)).toEqual([second.id]);
    });

    it('ocorrência que conflita com bloqueio é sinalizada e não falha o job; ao liberar, o job gera e resolve', async () => {
      const recurring = await insertRecurring();
      const startTime = recurring.startTime.slice(0, 5);
      const blockStart = occurrenceStart(2, startTime);
      const block = await t
        .http()
        .post(manage('court-blocks'))
        .set(...bearer(manager))
        .send({
          courtId: space.courtA,
          startsAt: blockStart.toISOString(),
          endsAt: addMinutes(blockStart, 30).toISOString(),
          reason: 'Evento',
        })
        .expect(201);

      const run = await occurrences.generateAll();
      expect(run).toMatchObject({ created: 3, conflicts: 1, failures: 0 });
      expect(await bookingsOf(recurring.id)).toHaveLength(3);

      const open = await t
        .http()
        .get(manage('recurring-conflicts'))
        .set(...bearer(manager))
        .expect(200);
      const mine = open.body.filter(
        (c: { recurringBookingId: string }) => c.recurringBookingId === recurring.id,
      );
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        conflictsWith: 'BLOCK',
        startsAt: blockStart.toISOString(),
        court: { id: space.courtA },
        customer: { name: 'Mensalista Teste' },
      });

      // Rodar de novo com o bloqueio ainda lá: continua sinalizado, sem duplicar o aviso.
      expect(await occurrences.generateAll()).toMatchObject({ created: 0, conflicts: 1 });
      const stored = await t.db
        .select()
        .from(recurringBookingConflicts)
        .where(eq(recurringBookingConflicts.recurringBookingId, recurring.id));
      expect(stored).toHaveLength(1);

      // A gestão remove o bloqueio: o job gera a ocorrência e o aviso some.
      await t
        .http()
        .delete(manage(`court-blocks/${block.body.id}`))
        .set(...bearer(manager))
        .expect(204);
      expect(await occurrences.generateAll()).toMatchObject({ created: 1, conflicts: 0 });
      expect(await bookingsOf(recurring.id)).toHaveLength(4);
      const after = await t
        .http()
        .get(manage(`recurring-bookings/${recurring.id}`))
        .set(...bearer(manager))
        .expect(200);
      expect(after.body.conflicts).toEqual([]);
    });

    it('conflito com reserva avulsa também é sinalizado pelo job (e não apaga a reserva)', async () => {
      const recurring = await insertRecurring();
      const taken = occurrenceStart(1, recurring.startTime.slice(0, 5));
      const other = await t
        .http()
        .post(manage('bookings'))
        .set(...bearer(manager))
        .send({
          courtId: space.courtA,
          sportId: space.sportId,
          startsAt: taken.toISOString(),
          durationMin: 30,
          peopleCount: 2,
          guestName: 'Avulso',
          guestPhone: '+5531977776666',
        })
        .expect(201);

      expect(await occurrences.generateAll()).toMatchObject({
        created: 3,
        conflicts: 1,
        failures: 0,
      });
      const [conflict] = await t.db
        .select()
        .from(recurringBookingConflicts)
        .where(eq(recurringBookingConflicts.recurringBookingId, recurring.id));
      expect(conflict?.conflictsWith).toBe('BOOKING');
      const [kept] = await t.db.select().from(bookings).where(eq(bookings.id, other.body.id));
      expect(kept?.status).toBe('CONFIRMED');
    });

    it('só gera para mensalista ACTIVE de espaço ativo', async () => {
      const pending = await insertRecurring({ status: 'PENDING_APPROVAL' });
      const paused = await insertRecurring({ status: 'PAUSED' });
      const ended = await insertRecurring({ status: 'ENDED', endsOn: today() });
      const rejected = await insertRecurring({ status: 'REJECTED' });
      const future = await insertRecurring({ startsOn: addDays(today(), 60) });
      await occurrences.generateAll();
      for (const r of [pending, paused, ended, rejected, future]) {
        expect(await bookingsOf(r.id), r.status).toHaveLength(0);
      }

      const suspended = await createSpace(t.db, 'arena-job-suspensa');
      const row = await insertRecurring({
        spaceId: suspended.id,
        courtId: suspended.courtA,
        sportId: suspended.sportId,
      });
      await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, suspended.id));
      await occurrences.generateAll();
      expect(await bookingsOf(row.id)).toHaveLength(0);
    });

    it('respeita ends_on: não gera depois da data final', async () => {
      const recurring = await insertRecurring({ endsOn: addDays(today(), 10) });
      await occurrences.generateAll();
      // Amanhã e +7 dias; as demais passam de ends_on.
      expect(await bookingsOf(recurring.id)).toHaveLength(2);
    });

    it('o banco recusa duas ocorrências do mesmo mensalista no mesmo horário', async () => {
      const recurring = await insertRecurring();
      await occurrences.generateAll();
      const [existing] = await bookingsOf(recurring.id);
      if (!existing) throw new Error('Sem ocorrências.');
      const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = existing;
      await expect(t.db.insert(bookings).values(copy)).rejects.toMatchObject({
        cause: { code: '23505', constraint: 'bookings_recurring_booking_starts_at_unique' },
      });
    });
  });

  describe('sem mensalidade (decisão 27)', () => {
    beforeAll(() => freshSpace('arena-job-sem-mensalidade'));

    it('o job gera só as ocorrências, mesmo com valor mensal legado salvo nas configurações', async () => {
      // Valores antigos continuam no banco (as colunas não foram apagadas), mas não têm efeito.
      await t.db
        .update(spaceSettings)
        .set({ recurringMonthlyPriceCents: 20_000, recurringBillingDay: 5 })
        .where(eq(spaceSettings.spaceId, space.id));
      const recurring = await insertRecurring();

      await runRecurringJob(RECURRING_JOBS.generateOccurrences, { occurrences });
      expect(await bookingsOf(recurring.id)).toHaveLength(4);
      expect(await chargesOf(recurring.id)).toEqual([]);
      // O job antigo de mensalidades, se ainda estiver na fila, não faz nada.
      await expect(runRecurringJob('generate-charges', { occurrences })).resolves.toEqual({
        retired: true,
      });
      expect(await chargesOf(recurring.id)).toEqual([]);
    });
  });

  describe('falha parcial e nova tentativa do BullMQ', () => {
    let broken: Space;
    beforeAll(async () => {
      await freshSpace('arena-job-falha-parcial');
      broken = await createSpace(t.db, 'arena-job-falha-parcial-b');
    });
    afterEach(() => vi.restoreAllMocks());

    /** Faz a carga do espaço `broken` falhar uma vez (erro pontual de banco, por exemplo). */
    const failOnce = () => {
      const contexts = t.app.get(SpaceContextService);
      const load = contexts.load.bind(contexts);
      let failed = false;
      vi.spyOn(contexts, 'load').mockImplementation((spaceId, db) => {
        if (spaceId === broken.id && !failed) {
          failed = true;
          return Promise.reject(new Error('Conexão perdida.'));
        }
        return load(spaceId, db);
      });
    };
    const services = () => ({ occurrences });
    const inBroken = () => ({
      spaceId: broken.id,
      courtId: broken.courtA,
      sportId: broken.sportId,
    });

    it('ocorrências: o job falha (para o retry), grava o resto e a nova tentativa só completa', async () => {
      const ok = await insertRecurring();
      const failing = await insertRecurring(inBroken());
      failOnce();

      const error = await runRecurringJob(RECURRING_JOBS.generateOccurrences, services()).catch(
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(PartialJobFailure);
      expect((error as PartialJobFailure).summary).toMatchObject({ created: 4, failures: 1 });
      expect(await bookingsOf(ok.id)).toHaveLength(4);
      expect(await bookingsOf(failing.id)).toHaveLength(0);

      // Retry: gera só o que faltou, sem duplicar o que já tinha sido gravado.
      await expect(
        runRecurringJob(RECURRING_JOBS.generateOccurrences, services()),
      ).resolves.toMatchObject({ created: 4, failures: 0 });
      expect(await bookingsOf(ok.id)).toHaveLength(4);
      expect(await bookingsOf(failing.id)).toHaveLength(4);
    });
  });
});
