import { getStored, removeStored, STORAGE_KEYS, setStored } from '@/lib/storage';

/** Formato do slug do espaço (o mesmo do check `spaces_slug_format` da API). */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSpaceSlug(slug: string): boolean {
  return slug.length <= 100 && SLUG_PATTERN.test(slug);
}

/** Tela do espaço a abrir depois do login: a página ou a tela de avaliar (RF-REVIEW-02). */
export type PendingSpaceScreen = 'space' | 'review';

export interface PendingSpace {
  slug: string;
  screen: PendingSpaceScreen;
}

const REVIEW_SUFFIX = '/avaliar';

/**
 * Quem abre o "Abrir no app" da página pública (ou o link de avaliar) deslogado precisa entrar
 * antes. O destino fica guardado e, depois do login, a pessoa é levada a ele (`takePendingSpace`).
 */
export async function savePendingSpace(
  slug: string,
  screen: PendingSpaceScreen = 'space',
): Promise<void> {
  if (!isValidSpaceSlug(slug)) return;
  await setStored(STORAGE_KEYS.pendingSpaceSlug, screen === 'review' ? slug + REVIEW_SUFFIX : slug);
}

export async function takePendingSpace(): Promise<PendingSpace | null> {
  const value = await getStored(STORAGE_KEYS.pendingSpaceSlug);
  if (value === null) return null;
  await removeStored(STORAGE_KEYS.pendingSpaceSlug);
  const review = value.endsWith(REVIEW_SUFFIX);
  const slug = review ? value.slice(0, -REVIEW_SUFFIX.length) : value;
  return isValidSpaceSlug(slug) ? { slug, screen: review ? 'review' : 'space' } : null;
}
