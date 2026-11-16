import type { PublicSpace } from '@space-sports/api-client/dist/fetch.js';
import { z } from 'zod';
import { normalize } from './space-resolver.js';
import { ToolError } from './tool-error.js';

export interface SportChoice {
  sportId: string;
  slug: string;
  name: string;
}

export const sportRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .describe(
    'Esporte: slug ou nome (ex.: "beach-tennis", "Futevôlei"). Veja os esportes em get_space.',
  );

export const courtRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe('Quadra: id ou nome (ex.: "Quadra 1"). Veja as quadras em get_space.');

/** Esportes reserváveis do espaço (os das quadras ativas, com o id que a API pede). */
function sportsOf(space: PublicSpace): SportChoice[] {
  const bySlug = new Map<string, SportChoice>();
  for (const court of space.courts) {
    for (const sport of court.sports) {
      bySlug.set(sport.slug, { sportId: sport.sportId, slug: sport.slug, name: sport.name });
    }
  }
  return [...bySlug.values()];
}

/** Esporte pelo slug ou nome; sem informar, só se o espaço tiver um único esporte. */
export function resolveSport(space: PublicSpace, ref: string | undefined): SportChoice {
  const sports = sportsOf(space);
  const options = sports.map(({ slug, name }) => ({ slug, name }));
  if (!ref) {
    if (sports.length === 1 && sports[0]) return sports[0];
    throw new ToolError(
      sports.length ? 'SPORT_REQUIRED' : 'NO_SPORTS',
      sports.length
        ? 'O espaço tem mais de um esporte: pergunte ao usuário qual e informe o parâmetro sport.'
        : 'O espaço não tem quadras disponíveis para reserva.',
      { options },
    );
  }
  const key = normalize(ref);
  const found = sports.find((sport) => sport.slug === key || normalize(sport.name) === key);
  if (!found) {
    throw new ToolError('SPORT_NOT_OFFERED', `O espaço não oferece "${ref}".`, { options });
  }
  return found;
}

/** Quadra pelo id ou nome, entre as que aceitam o esporte. */
export function resolveCourt(space: PublicSpace, ref: string, sport: SportChoice) {
  const courts = space.courts.filter((court) =>
    court.sports.some((item) => item.sportId === sport.sportId),
  );
  const key = normalize(ref);
  const found = courts.find((court) => court.id === ref || normalize(court.name) === key);
  if (!found) {
    throw new ToolError('COURT_NOT_FOUND', `Quadra "${ref}" não encontrada para ${sport.name}.`, {
      options: courts.map((court) => ({ id: court.id, name: court.name })),
    });
  }
  return found;
}
