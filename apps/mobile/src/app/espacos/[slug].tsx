import { SpaceDeepLink } from '@/features/space/space-deep-link';

/** Deep link `spacesports://espacos/<slug>` (veja `SpaceDeepLink`). */
export default function EspacosDeepLink() {
  return <SpaceDeepLink screen="space" />;
}
