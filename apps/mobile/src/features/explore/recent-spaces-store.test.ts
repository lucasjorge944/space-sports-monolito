import type { PublicSpace } from '@space-sports/api-client';
import {
  clearRecentSpaces,
  getRecentSpaces,
  loadRecentSpaces,
  mergeRecentSpaces,
  RECENT_SPACES_LIMIT,
  type RecentSpaceEntry,
  recentEntryFromSpace,
  recentSpacesFile,
  recordRecentSpace,
  removeRecentSpace,
  resetRecentSpacesForTests,
} from './recent-spaces-store';
import { makeSpace } from './test-fixtures';

jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { document: {} } }));

let disk: string | null = null;

beforeEach(() => {
  disk = null;
  resetRecentSpacesForTests();
  jest.spyOn(recentSpacesFile, 'read').mockImplementation(async () => disk);
  jest.spyOn(recentSpacesFile, 'write').mockImplementation(async (content) => {
    disk = content;
  });
  jest.spyOn(recentSpacesFile, 'remove').mockImplementation(async () => {
    disk = null;
  });
});
afterEach(() => jest.restoreAllMocks());

function entry(i: number, viewedAt = `2026-11-0${(i % 9) + 1}T12:00:00.000Z`): RecentSpaceEntry {
  const { id, slug, name, logoUrl, neighborhood, city, cover } = makeSpace(i);
  return { id, slug, name, logoUrl, neighborhood, city, cover, viewedAt };
}

const slugs = () => getRecentSpaces().map((e) => e.slug);

describe('histórico local de espaços recentes (RF-SPACE-12)', () => {
  it('grava o mais recente na frente, um por slug', async () => {
    await recordRecentSpace(entry(1));
    await recordRecentSpace(entry(2));
    await recordRecentSpace(entry(1));
    expect(slugs()).toEqual(['espaco-1', 'espaco-2']);
    expect(JSON.parse(disk ?? '[]').map((e: RecentSpaceEntry) => e.slug)).toEqual([
      'espaco-1',
      'espaco-2',
    ]);
  });

  it('guarda no máximo 10', async () => {
    for (let i = 0; i < 14; i++) await recordRecentSpace(entry(i));
    expect(getRecentSpaces()).toHaveLength(RECENT_SPACES_LIMIT);
    expect(slugs()[0]).toBe('espaco-13');
    expect(slugs()).not.toContain('espaco-3');
  });

  it('lê o histórico gravado no aparelho ao abrir o app', async () => {
    disk = JSON.stringify([entry(5), entry(6)]);
    await loadRecentSpaces();
    expect(slugs()).toEqual(['espaco-5', 'espaco-6']);
  });

  it('arquivo corrompido vira histórico vazio', async () => {
    disk = '{nada';
    await loadRecentSpaces();
    expect(getRecentSpaces()).toEqual([]);
  });

  it('abrir um espaço antes de a leitura terminar não perde o histórico antigo', async () => {
    disk = JSON.stringify([entry(5)]);
    await recordRecentSpace(entry(7));
    expect(slugs()).toEqual(['espaco-7', 'espaco-5']);
  });

  it('sai do histórico quando a página responde 404 (removido, suspenso ou fora da vitrine)', async () => {
    await recordRecentSpace(entry(1));
    await recordRecentSpace(entry(2));
    await removeRecentSpace('espaco-1');
    expect(slugs()).toEqual(['espaco-2']);
    expect(disk).not.toContain('espaco-1');
  });

  it('é apagado ao sair da conta (inclusive na exclusão e na inativação)', async () => {
    await recordRecentSpace(entry(1));
    await clearRecentSpaces();
    expect(getRecentSpaces()).toEqual([]);
    expect(disk).toBeNull();
    // Uma leitura depois da limpeza não ressuscita nada.
    await loadRecentSpaces();
    expect(getRecentSpaces()).toEqual([]);
  });

  it('limpeza durante a leitura não traz o histórico de volta', async () => {
    disk = JSON.stringify([entry(5)]);
    const loading = loadRecentSpaces();
    await clearRecentSpaces();
    await loading;
    expect(getRecentSpaces()).toEqual([]);
  });

  it('monta a entrada a partir da página do espaço (capa = primeira foto)', () => {
    const space = {
      id: 'id-1',
      slug: 'arena',
      name: 'Arena',
      logoUrl: 'https://cdn.test/logo.png',
      address: { neighborhood: 'Centro', city: { id: 'c', name: 'Belo Horizonte', state: 'MG' } },
      photos: [
        { id: 'p2', url: 'https://cdn.test/2.jpg', blurhash: null, position: 2 },
        { id: 'p1', url: 'https://cdn.test/1.jpg', blurhash: 'LKO', position: 1 },
      ],
    } as unknown as PublicSpace;
    expect(recentEntryFromSpace(space, new Date('2026-11-03T10:00:00Z'))).toEqual({
      id: 'id-1',
      slug: 'arena',
      name: 'Arena',
      logoUrl: 'https://cdn.test/logo.png',
      neighborhood: 'Centro',
      city: 'Belo Horizonte',
      cover: { url: 'https://cdn.test/1.jpg', blurhash: 'LKO' },
      viewedAt: '2026-11-03T10:00:00.000Z',
    });
  });
});

describe('mergeRecentSpaces', () => {
  it('histórico do aparelho primeiro, depois os da conta, sem repetir e até 10', () => {
    const local = [entry(1), entry(2)];
    const remote = [makeSpace(3), makeSpace(1), makeSpace(4)];
    expect(mergeRecentSpaces(local, remote).map((s) => s.slug)).toEqual([
      'espaco-1',
      'espaco-2',
      'espaco-3',
      'espaco-4',
    ]);
    const many = Array.from({ length: 12 }, (_, i) => makeSpace(i + 10));
    expect(mergeRecentSpaces(local, many)).toHaveLength(RECENT_SPACES_LIMIT);
  });
});
