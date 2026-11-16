import { z } from 'zod';
import { CLASS_LEVEL, label } from '../labels.js';
import { defineTool, done } from '../tool.js';

const getMyProfile = defineTool({
  name: 'get_my_profile',
  title: 'Quem está conectado',
  // `GET /v1/me/summary` aceita qualquer escopo do MCP (docs/14-mcp.md 3.3).
  scopes: [],
  description: [
    'Primeiro nome e esportes favoritos (com o nível) do usuário conectado.',
    'Use para cumprimentar o usuário pelo nome e para sugerir o esporte dele em buscas e reservas. Não traz contato nem outros dados pessoais.',
  ].join(' '),
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(_input, { api }) {
    const me = await api.getMySummary();
    return done(`Usuário conectado: ${me.firstName}.`, {
      firstName: me.firstName,
      favoriteSports: me.favoriteSports.map((favorite) => ({
        slug: favorite.sport.slug,
        name: favorite.sport.name,
        level: label(CLASS_LEVEL, favorite.level),
      })),
    });
  },
});

export const meTools = [getMyProfile];
