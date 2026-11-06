import { SpaceDeepLink } from '@/features/space/space-deep-link';

/** Deep link `spacesports://espacos/<slug>/avaliar` (RF-REVIEW-02; veja `SpaceDeepLink`). */
export default function EspacosAvaliarDeepLink() {
  return <SpaceDeepLink screen="review" />;
}
