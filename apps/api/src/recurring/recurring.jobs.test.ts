import { describe, expect, it, vi } from 'vitest';
import type { OccurrencesService } from './occurrences.service.js';
import {
  bullConnection,
  PartialJobFailure,
  RECURRING_JOBS,
  runRecurringJob,
} from './recurring.jobs.js';

describe('bullConnection', () => {
  it('lê host, porta, credenciais e banco do REDIS_URL e libera o retry do worker', () => {
    expect(bullConnection('redis://usuario:s%40nha@cache.interno:6380/2')).toEqual({
      host: 'cache.interno',
      port: 6380,
      username: 'usuario',
      password: 's@nha',
      db: 2,
      maxRetriesPerRequest: null,
    });
  });

  it('usa a porta padrão e liga TLS em rediss://', () => {
    expect(bullConnection('rediss://cache.interno')).toMatchObject({
      host: 'cache.interno',
      port: 6379,
      tls: {},
      maxRetriesPerRequest: null,
    });
    expect(bullConnection('redis://localhost:6379')).not.toHaveProperty('tls');
  });
});

describe('runRecurringJob', () => {
  const now = new Date('2026-11-02T06:00:00Z');
  const make = () => {
    const occurrences = { generateAll: vi.fn().mockResolvedValue({ created: 4, failures: 0 }) };
    return {
      occurrences,
      services: { occurrences: occurrences as unknown as OccurrencesService },
    };
  };

  it('gerar ocorrências chama o serviço de ocorrências', async () => {
    const { occurrences, services } = make();
    await expect(
      runRecurringJob(RECURRING_JOBS.generateOccurrences, services, now),
    ).resolves.toEqual({ created: 4, failures: 0 });
    expect(occurrences.generateAll).toHaveBeenCalledWith(now);
  });

  it('não existe mais job de mensalidades (decisão 27)', () => {
    expect(Object.values(RECURRING_JOBS)).toEqual(['generate-occurrences']);
  });

  it('job antigo de mensalidades que ainda esteja na fila é descartado sem erro', async () => {
    const { occurrences, services } = make();
    await expect(runRecurringJob('generate-charges', services, now)).resolves.toEqual({
      retired: true,
    });
    expect(occurrences.generateAll).not.toHaveBeenCalled();
  });

  it('job desconhecido falha (o BullMQ tenta de novo e registra)', async () => {
    await expect(runRecurringJob('outro-job', make().services, now)).rejects.toThrow(
      /desconhecido/,
    );
  });

  it('falha parcial faz o job falhar (o BullMQ tenta de novo)', async () => {
    const { occurrences, services } = make();
    occurrences.generateAll.mockResolvedValue({ created: 3, failures: 1 });
    const error = await runRecurringJob(RECURRING_JOBS.generateOccurrences, services, now).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(PartialJobFailure);
    expect((error as PartialJobFailure).summary.failures).toBe(1);
  });
});
