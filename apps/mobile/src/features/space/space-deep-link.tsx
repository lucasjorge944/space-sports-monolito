import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { getRouteAccess, homeHref } from '@/features/auth/route-access';
import { useSession } from '@/features/auth/session';
import { isValidSpaceSlug, type PendingSpaceScreen, savePendingSpace } from './pending-space';

/**
 * Deep links `spacesports://espacos/<slug>` (o "Abrir no app" da página pública; o web gera
 * `espacos`, no plural) e `spacesports://espacos/<slug>/avaliar` (RF-REVIEW-02). Só redireciona:
 * - com acesso ao app → `/espaco/<slug>` ou `/espaco/<slug>/avaliar`;
 * - deslogado (ou sem nome no perfil) → guarda o destino e leva ao login; depois dele o
 *   `EntryGate` abre o destino, como no convite;
 * - slug inválido → início.
 * Fica fora das guardas de sessão do `ProtectedStack` para nunca perder o destino.
 */
export function SpaceDeepLink({ screen }: { screen: PendingSpaceScreen }) {
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = raw ?? '';
  const { state } = useSession();
  const valid = isValidSpaceSlug(slug);
  const inApp = getRouteAccess(state).app;
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!valid || inApp) return;
    let active = true;
    void savePendingSpace(slug, screen).then(() => {
      if (active) setSaved(true);
    });
    return () => {
      active = false;
    };
  }, [valid, inApp, slug, screen]);

  if (!valid) return <Redirect href={homeHref(state)} />;
  if (inApp) {
    return (
      <Redirect
        href={{
          pathname: screen === 'review' ? '/espaco/[slug]/avaliar' : '/espaco/[slug]',
          params: { slug },
        }}
      />
    );
  }
  // Só sai daqui com o destino já guardado, para o `EntryGate` encontrar depois do login.
  return saved ? <Redirect href={homeHref(state)} /> : null;
}
