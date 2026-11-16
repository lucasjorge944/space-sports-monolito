import { describe, expect, it } from 'vitest';
import {
  canWrite,
  connectionExpiry,
  deniedNotes,
  groupScopes,
  isPlatformResource,
  platformNotice,
} from './mcp-scopes';

describe('groupScopes', () => {
  it('agrupa na ordem jogador, gestão e plataforma, com os textos do shared', () => {
    const groups = groupScopes(['super:read', 'manage:read', 'bookings:read', 'spaces:read']);
    expect(groups.map((g) => g.label)).toEqual([
      'Como jogador',
      'Gestão dos seus espaços',
      'Painel da plataforma',
    ]);
    expect(groups[0]?.items.map((i) => i.scope)).toEqual(['spaces:read', 'bookings:read']);
    expect(groups[0]?.items[1]?.label).toBe('Ver suas reservas');
  });

  it('explica só no grupo da gestão que vale por espaço e que o Professor não vê valores', () => {
    const [player, manage] = groupScopes(['spaces:read', 'manage:read']);
    expect(player?.note).toBeNull();
    expect(manage?.note).toMatch(/espaços em que você é da equipe/);
    expect(manage?.note).toMatch(/Professor não vê valores/);
  });

  it('descarta offline_access e escopo desconhecido; grupo vazio não aparece', () => {
    const groups = groupScopes(['manage:read', 'offline_access', 'admin:all']);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(1);
    expect(groupScopes(['offline_access'])).toEqual([]);
    expect(groupScopes([])).toEqual([]);
  });
});

describe('canWrite', () => {
  it('só com escopo de escrita de jogador', () => {
    expect(canWrite(['spaces:read', 'manage:read', 'manage:finance:read'])).toBe(false);
    expect(canWrite(['bookings:write'])).toBe(true);
    expect(canWrite(['classes:write'])).toBe(true);
  });
});

describe('deniedNotes', () => {
  it('sem papel em espaço: uma nota só para a gestão (o financeiro vai junto)', () => {
    const notes = deniedNotes(['manage:read', 'manage:finance:read']);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/não é da equipe de nenhum espaço/);
  });

  it('Professor (ou outro sem Dono/Admin): só os valores ficam de fora', () => {
    const notes = deniedNotes(['manage:finance:read']);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/só Dono e Admin/);
  });

  it('não-Super no conector da plataforma', () => {
    expect(deniedNotes(['super:read'])[0]).toMatch(/Painel da plataforma/);
  });

  it('nada negado, nada a explicar', () => {
    expect(deniedNotes([])).toEqual([]);
  });
});

describe('platformNotice', () => {
  it('usa a duração máxima da API', () => {
    expect(platformNotice(24)).toBe(
      'O assistente vai poder LER dados de todos os espaços da plataforma. Somente leitura; a conexão vale por até 24 horas.',
    );
    expect(platformNotice(null)).not.toMatch(/horas/);
  });
});

describe('connectionExpiry', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  it('sem prazo (conector do jogador) devolve nulo', () => {
    expect(connectionExpiry(null, now)).toBeNull();
    expect(connectionExpiry(undefined, now)).toBeNull();
  });
  it('marca vencida a partir do instante do prazo', () => {
    expect(connectionExpiry('2026-11-12T12:00:01Z', now)?.expired).toBe(false);
    expect(connectionExpiry('2026-11-12T12:00:00Z', now)?.expired).toBe(true);
    expect(connectionExpiry('2026-11-11T12:00:00Z', now)?.expired).toBe(true);
  });
});

describe('isPlatformResource', () => {
  it('só o recurso ADMIN é a plataforma', () => {
    expect(isPlatformResource('ADMIN')).toBe(true);
    expect(isPlatformResource('USER')).toBe(false);
  });
});
