/**
 * Ícones dos esportes do catálogo (atalhos do Explorar, AD.1). Desenhados na grade e no traço do
 * Lucide (24×24, traço 2, pontas e junções arredondadas), para conviverem com os ícones do app e
 * da web (`lucide-react-native`, `lucide-react`). O Lucide não tem raquete nem futevôlei:
 * - `volei-praia`: o `Volleyball` do Lucide, sem mudança (ISC, © Lucide Contributors);
 * - `futevolei`: o primeiro pé do `Footprints` do Lucide, deslocado (1, 4), com o traço do
 *   calcanhar, e uma bola desenhada por nós (pé derivado do Lucide: ISC, © Lucide Contributors);
 * - `beach-tennis`: desenho nosso.
 *
 * Licença ISC do Lucide (https://lucide.dev/license): "Permission to use, copy, modify, and/or
 * distribute this software for any purpose with or without fee is hereby granted, provided that
 * the above copyright notice and this permission notice appear in all copies."
 *
 * Chave: o `icon` do esporte no catálogo (`sports.icon`) ou, se vazio, o `slug`. Esporte sem
 * ícone fica só com o nome (`sportIconKey` devolve `null`).
 *
 * Web: renderize o markup inline. Mobile: `<SvgXml xml={sportIconSvg(key, { color })} width={18} height={18} />`.
 */
export const sportIcons = {
  'beach-tennis': [
    '<ellipse cx="10" cy="9" rx="6" ry="7"/>',
    '<rect x="8.5" y="16" width="3" height="6" rx="1.5"/>',
    '<path d="M8 7h.01M12 7h.01M10 9.5h.01M8 12h.01M12 12h.01"/>',
    '<circle cx="19" cy="15.5" r="2.5"/>',
  ],
  // Pé: `Footprints` do Lucide (ISC, © Lucide Contributors), deslocado (1, 4). Bola: nossa.
  futevolei: [
    '<path d="M5 20v-2.38C5 15.5 3.97 14.5 4 12c.03-2.72 1.49-6 4.5-6C10.37 6 11 7.8 11 9.5c0 3.11-2 5.66-2 8.68V20a2 2 0 1 1-4 0Z"/>',
    '<path d="M5 17h4"/>',
    '<circle cx="17.5" cy="6.5" r="4.5"/>',
    '<path d="M13.3 5.2a6 6 0 0 1 6.9 4.9"/>',
  ],
  // `Volleyball` do Lucide, sem mudança (ISC, © Lucide Contributors).
  'volei-praia': [
    '<path d="M11 7a16 16 20 0 1 10.98 4.362"/>',
    '<path d="M12 12a13 13 0 0 1-8.66 5"/>',
    '<path d="M16.83 13.634a16 16 0 0 1-9.267 7.328"/>',
    '<path d="M20.66 17A13 13 0 0 0 12 12a13 13 0 0 1 0-10"/>',
    '<path d="M8.17 15.366a16 16 0 0 1-1.713-11.69"/>',
    '<circle cx="12" cy="12" r="10"/>',
  ],
} as const satisfies Record<string, readonly string[]>;

export type SportIconKey = keyof typeof sportIcons;

function isSportIconKey(key: string): key is SportIconKey {
  return Object.hasOwn(sportIcons, key);
}

/** O ícone de um esporte do catálogo: `icon` se preenchido e conhecido, senão o `slug`; ou `null`. */
export function sportIconKey(sport: { icon?: string | null; slug: string }): SportIconKey | null {
  if (sport.icon && isSportIconKey(sport.icon)) return sport.icon;
  return isSportIconKey(sport.slug) ? sport.slug : null;
}

/**
 * Markup SVG do ícone, com a cor do traço (passe a cor do token do texto ao lado, ex.:
 * `chip-foreground` ou `chip-selected-foreground`). Sem largura e altura: o consumidor define.
 */
export function sportIconSvg(
  key: SportIconKey,
  { color, strokeWidth = 2 }: { color: string; strokeWidth?: number },
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${sportIcons[key].join('')}</svg>`;
}
