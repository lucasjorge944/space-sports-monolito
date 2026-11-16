import { createHash } from 'node:crypto';
import type { StaffSpacesResponse } from '@space-sports/api-client/dist/fetch.js';

/** Validade de uma lista no cache. */
export const STAFF_SPACES_TTL_MS = 60_000;
/** Máximo de listas guardadas (a mais antiga sai primeiro). */
export const STAFF_SPACES_MAX_ENTRIES = 256;

type StaffItem = StaffSpacesResponse['items'][number];

/**
 * O que o cache guarda de cada espaço: só o que o resolvedor e as tools usam (id, slug, nome, os
 * papéis do usuário e o fuso). A agenda de hoje, com os nomes de clientes e alunos, nunca fica em
 * memória: quem a mostra (`get_space_today`) lê sempre da API.
 */
export interface CachedStaffSpace {
  id: string;
  slug: string;
  name: string;
  roles: StaffItem['roles'];
  timeZone: string;
}

/** A resposta de `GET /v1/me/staff-spaces` reduzida aos campos do cache. */
export function toCachedStaffSpace({ space, roles }: StaffItem): CachedStaffSpace {
  return {
    id: space.id,
    slug: space.slug,
    name: space.name,
    roles: [...roles],
    timeZone: space.timeZone,
  };
}

export interface CachedStaffSpaces {
  items: readonly CachedStaffSpace[];
  /** `true` quando a lista veio do cache (pode estar até 60 s velha). */
  cached: boolean;
}

/**
 * Cache em memória de `GET /v1/me/staff-spaces` (a base do resolvedor de espaço das tools de
 * gestão), para um prompt de relatório, que encadeia várias tools, não gastar uma leitura do limite
 * da API (60 por minuto por usuário, RN-MCP-03) em cada uma.
 *
 * - A chave é o `sub` mais o SHA-256 do token: o token em claro nunca fica guardado, cada usuário
 *   (e cada token dele) tem a sua entrada e nada é compartilhado entre usuários. Token novo (a
 *   cada 15 minutos ou depois de reconectar) começa sem cache.
 * - Guarda só id, slug, nome, papéis e fuso de cada espaço (`CachedStaffSpace`), nunca a resposta
 *   inteira com a agenda e os nomes.
 * - 60 s de validade e no máximo `STAFF_SPACES_MAX_ENTRIES` entradas por processo.
 * - Não é barreira: cada tool chama a API em seguida com o mesmo token, e a API confere o papel
 *   no espaço e a conexão (um token revogado recebe 401 na chamada seguinte). O que pode ficar até
 *   60 s velho é só a resolução do nome do espaço, e o resolvedor relê a lista da API antes de
 *   recusar um espaço a partir do cache (`manage/context.ts`).
 */
export class StaffSpacesCache {
  private readonly entries = new Map<
    string,
    { expiresAt: number; items: readonly CachedStaffSpace[] }
  >();

  constructor(
    private readonly now: () => Date,
    private readonly ttlMs = STAFF_SPACES_TTL_MS,
    private readonly maxEntries = STAFF_SPACES_MAX_ENTRIES,
  ) {}

  /** Chave do usuário: `sub` + hash do token (nunca o token). */
  static keyOf(sub: string, token: string): string {
    return `${sub}:${createHash('sha256').update(token).digest('base64url')}`;
  }

  /** A lista reduzida do cache (se ainda valer) ou da API, dizendo de onde veio. */
  async get(key: string, load: () => Promise<StaffSpacesResponse>): Promise<CachedStaffSpaces> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now().getTime()) return { items: hit.items, cached: true };
    const response = await load();
    return { items: this.store(key, response), cached: false };
  }

  /** Sempre da API: devolve a resposta inteira (com a agenda) e guarda só a versão reduzida. */
  async refresh(
    key: string,
    load: () => Promise<StaffSpacesResponse>,
  ): Promise<StaffSpacesResponse> {
    const response = await load();
    this.store(key, response);
    return response;
  }

  get size(): number {
    return this.entries.size;
  }

  private store(key: string, response: StaffSpacesResponse): readonly CachedStaffSpace[] {
    const now = this.now().getTime();
    const items = response.items.map(toCachedStaffSpace);
    this.entries.delete(key);
    for (const [entryKey, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(entryKey);
    }
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { expiresAt: now + this.ttlMs, items });
    return items;
  }
}
