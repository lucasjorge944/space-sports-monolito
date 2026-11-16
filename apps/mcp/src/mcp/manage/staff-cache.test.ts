import type { StaffSpacesResponse } from '@space-sports/api-client/dist/fetch.js';
import { describe, expect, it, vi } from 'vitest';
import { StaffSpacesCache } from './staff-cache.js';

/** Resposta como a da API, com a agenda de hoje e os nomes (que o cache não pode guardar). */
const list = (name: string) =>
  ({
    items: [
      {
        space: {
          id: 'a0000000-0000-4000-8000-000000000001',
          slug: 'arena',
          name,
          status: 'ACTIVE',
          timeZone: 'America/Sao_Paulo',
          logoUrl: null,
        },
        roles: ['OWNER'],
        today: {
          date: '2026-11-12',
          bookings: [{ id: 'b1', customerName: 'Cliente do Balcão' }],
          classSessions: [{ id: 's1', attendees: [{ name: 'Aluna Joana' }] }],
        },
      },
    ],
  }) as unknown as StaffSpacesResponse;

function setup(maxEntries = 3) {
  const clock = { now: new Date('2026-11-12T13:00:00Z') };
  const cache = new StaffSpacesCache(() => clock.now, 60_000, maxEntries);
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  return { cache, advance };
}

describe('StaffSpacesCache', () => {
  it('a chave é o sub + hash do token: nunca o token, uma por usuário e por token', () => {
    const token = 'eyJhbGciOiJFZERTQSJ9.payload-secreto.assinatura';
    const key = StaffSpacesCache.keyOf('user-1', token);
    expect(key.startsWith('user-1:')).toBe(true);
    expect(key).not.toContain(token);
    expect(key).not.toContain('payload-secreto');
    expect(StaffSpacesCache.keyOf('user-2', token)).not.toBe(key);
    expect(StaffSpacesCache.keyOf('user-1', `${token}x`)).not.toBe(key);
  });

  it('serve do cache por 60 s e lê de novo depois', async () => {
    const { cache, advance } = setup();
    const load = vi.fn(async () => list('A'));
    await cache.get('k', load);
    advance(59_000);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(1);
    advance(1_000);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('refresh sempre lê da API, devolve a resposta inteira e renova a entrada', async () => {
    const { cache } = setup();
    expect((await cache.get('k', async () => list('velho'))).cached).toBe(false);
    const fresh = await cache.refresh('k', async () => list('novo'));
    expect(fresh.items[0]?.today.bookings).toHaveLength(1);
    const cached = await cache.get('k', async () => list('outro'));
    expect(cached).toMatchObject({ cached: true, items: [{ name: 'novo' }] });
  });

  it('guarda só id, slug, nome, papéis e fuso (nunca a agenda nem os nomes de clientes)', async () => {
    const { cache } = setup();
    await cache.refresh('k', async () => list('Arena'));
    const { items, cached } = await cache.get('k', async () => list('outro'));
    expect(cached).toBe(true);
    expect(items).toEqual([
      {
        id: 'a0000000-0000-4000-8000-000000000001',
        slug: 'arena',
        name: 'Arena',
        roles: ['OWNER'],
        timeZone: 'America/Sao_Paulo',
      },
    ]);
    expect(JSON.stringify(items)).not.toContain('Cliente do Balcão');
    expect(JSON.stringify(items)).not.toContain('Joana');
  });

  it('falha da API não fica no cache', async () => {
    const { cache } = setup();
    await expect(cache.get('k', async () => Promise.reject(new Error('503')))).rejects.toThrow();
    expect(cache.size).toBe(0);
    expect((await cache.get('k', async () => list('A'))).items).toHaveLength(1);
  });

  it('limita as entradas (a mais antiga sai) e descarta as vencidas', async () => {
    const { cache, advance } = setup(3);
    for (const key of ['a', 'b', 'c', 'd']) await cache.get(key, async () => list(key));
    expect(cache.size).toBe(3);
    const reload = vi.fn(async () => list('a2'));
    await cache.get('a', reload);
    expect(reload).toHaveBeenCalledTimes(1);
    advance(61_000);
    await cache.get('e', async () => list('e'));
    expect(cache.size).toBe(1);
  });
});
