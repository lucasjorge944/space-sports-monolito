import type { PublicSpace, SpaceCard } from '@space-sports/api-client';
import { File, Paths } from 'expo-file-system';
import { useEffect, useSyncExternalStore } from 'react';

/** Até 10 espaços no histórico do aparelho (RF-SPACE-12). */
export const RECENT_SPACES_LIMIT = 10;
const FILE_NAME = 'recent-spaces.json';

/** Dados do card compacto de Espaços recentes. */
export type RecentSpace = Pick<
  SpaceCard,
  'id' | 'slug' | 'name' | 'logoUrl' | 'neighborhood' | 'city' | 'cover'
>;

export interface RecentSpaceEntry extends RecentSpace {
  /** Instante (ISO, UTC) em que a página foi aberta. */
  viewedAt: string;
}

/**
 * Onde o histórico fica no aparelho: um JSON nos documentos do app (o SecureStore tem limite de
 * ~2 KB por chave, pouco para 10 cards). Falha de leitura ou escrita nunca derruba a tela.
 */
export const recentSpacesFile = {
  async read(): Promise<string | null> {
    const file = new File(Paths.document, FILE_NAME);
    return file.exists ? file.text() : null;
  },
  async write(content: string): Promise<void> {
    const file = new File(Paths.document, FILE_NAME);
    await file.write(content);
  },
  async remove(): Promise<void> {
    const file = new File(Paths.document, FILE_NAME);
    if (file.exists) file.delete();
  },
};

function isEntry(value: unknown): value is RecentSpaceEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.slug === 'string' &&
    typeof v.name === 'string' &&
    typeof v.city === 'string' &&
    typeof v.viewedAt === 'string'
  );
}

/** Lê o JSON gravado; formato inválido vira histórico vazio. */
export function parseRecentSpaces(raw: string | null): RecentSpaceEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isEntry)
      .map((entry) => ({
        id: entry.id,
        slug: entry.slug,
        name: entry.name,
        logoUrl: entry.logoUrl ?? null,
        neighborhood: entry.neighborhood ?? null,
        city: entry.city,
        cover: entry.cover?.url
          ? { url: entry.cover.url, blurhash: entry.cover.blurhash ?? null }
          : null,
        viewedAt: entry.viewedAt,
      }))
      .slice(0, RECENT_SPACES_LIMIT);
  } catch {
    return [];
  }
}

/** Põe o espaço na frente (um por slug) e corta em 10. */
export function upsertRecentSpace(
  entries: readonly RecentSpaceEntry[],
  entry: RecentSpaceEntry,
): RecentSpaceEntry[] {
  return [entry, ...entries.filter((e) => e.slug !== entry.slug)].slice(0, RECENT_SPACES_LIMIT);
}

/**
 * Histórico do aparelho + `GET /v1/me/recent-spaces` (logado), sem repetir slug e até 10. A API não
 * devolve a data da interação, então o que foi aberto neste aparelho (já do mais recente para o
 * mais antigo) vem antes e os da conta completam, na ordem da API.
 */
export function mergeRecentSpaces(
  local: readonly RecentSpace[],
  remote: readonly RecentSpace[],
): RecentSpace[] {
  const seen = new Set<string>();
  const merged: RecentSpace[] = [];
  for (const space of [...local, ...remote]) {
    if (seen.has(space.slug)) continue;
    seen.add(space.slug);
    merged.push(space);
    if (merged.length === RECENT_SPACES_LIMIT) break;
  }
  return merged;
}

/** Entrada do histórico a partir da página do espaço (capa = primeira foto). */
export function recentEntryFromSpace(space: PublicSpace, now: Date = new Date()): RecentSpaceEntry {
  const cover = [...space.photos].sort((a, b) => a.position - b.position)[0];
  return {
    id: space.id,
    slug: space.slug,
    name: space.name,
    logoUrl: space.logoUrl,
    neighborhood: space.address.neighborhood,
    city: space.address.city.name,
    cover: cover ? { url: cover.url, blurhash: cover.blurhash } : null,
    viewedAt: now.toISOString(),
  };
}

// Estado em memória, carregado do arquivo na primeira leitura.
let entries: RecentSpaceEntry[] = [];
let loaded: Promise<void> | null = null;
/** Muda a cada limpeza: uma leitura ou escrita antiga não ressuscita o histórico apagado. */
let generation = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function set(next: RecentSpaceEntry[]) {
  entries = next;
  emit();
}

async function persist(gen: number): Promise<void> {
  if (gen !== generation) return;
  try {
    await recentSpacesFile.write(JSON.stringify(entries));
  } catch {
    // Sem armazenamento: o histórico vale só nesta execução.
  }
}

/** Carrega o histórico do aparelho (uma vez por execução). */
export function loadRecentSpaces(): Promise<void> {
  if (!loaded) {
    const gen = generation;
    loaded = (async () => {
      let raw: string | null = null;
      try {
        raw = await recentSpacesFile.read();
      } catch {
        raw = null;
      }
      if (gen !== generation) return;
      // O que foi gravado nesta execução antes da leitura terminar vem na frente.
      const stored = parseRecentSpaces(raw);
      let next = stored;
      for (const entry of [...entries].reverse()) next = upsertRecentSpace(next, entry);
      set(next);
    })();
  }
  return loaded;
}

export function getRecentSpaces(): RecentSpaceEntry[] {
  return entries;
}

/** Grava a abertura da página do espaço. */
export async function recordRecentSpace(entry: RecentSpaceEntry): Promise<void> {
  const gen = generation;
  set(upsertRecentSpace(entries, entry));
  await loadRecentSpaces();
  if (gen !== generation) return;
  // A leitura pode ter trazido o histórico antigo: garante a entrada nova na frente.
  if (entries[0]?.slug !== entry.slug) set(upsertRecentSpace(entries, entry));
  await persist(gen);
}

/** Tira o espaço do histórico (404: removido, suspenso ou fora da vitrine). */
export async function removeRecentSpace(slug: string): Promise<void> {
  const gen = generation;
  await loadRecentSpaces();
  if (gen !== generation || !entries.some((e) => e.slug === slug)) return;
  set(entries.filter((e) => e.slug !== slug));
  await persist(gen);
}

/** Apaga o histórico (sair da conta, excluir ou inativar a conta). */
export async function clearRecentSpaces(): Promise<void> {
  generation += 1;
  loaded = Promise.resolve();
  set([]);
  try {
    await recentSpacesFile.remove();
  } catch {
    // Arquivo já não existia.
  }
}

/** Só para testes: volta ao estado de antes da primeira leitura. */
export function resetRecentSpacesForTests(): void {
  generation += 1;
  entries = [];
  loaded = null;
  listeners.clear();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Histórico do aparelho, do mais recente para o mais antigo. */
export function useLocalRecentSpaces(): RecentSpaceEntry[] {
  useEffect(() => {
    void loadRecentSpaces();
  }, []);
  return useSyncExternalStore(subscribe, getRecentSpaces, getRecentSpaces);
}
