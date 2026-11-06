import type { Href } from 'expo-router';

/** Página do espaço (`app/espaco/[slug]`). */
export function spaceHref(slug: string): Href {
  return { pathname: '/espaco/[slug]', params: { slug } };
}
