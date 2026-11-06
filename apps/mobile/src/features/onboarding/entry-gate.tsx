import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { takePendingInvite } from '@/features/invites/pending-invite';
import { takePendingSpace } from '@/features/space/pending-space';
import { getStored, STORAGE_KEYS } from '@/lib/storage';

type Destination =
  | { kind: 'invite'; token: string }
  | { kind: 'space'; slug: string; review: boolean }
  | { kind: 'location' }
  | null;

/**
 * Primeira tela depois do login (monta dentro das abas):
 * 1. convite aberto antes de entrar → volta ao convite;
 * 2. link de espaço aberto antes de entrar (`espacos/[slug]`) → abre o espaço; o de avaliar
 *    (`espacos/[slug]/avaliar`, RF-REVIEW-02) → abre a tela de avaliar;
 * 3. primeiro acesso → onboarding da permissão de localização (uma vez só).
 * Resolve uma vez por montagem; fora disso não renderiza nada.
 */
export function EntryGate() {
  const [destination, setDestination] = useState<Destination>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // Os dois destinos são lidos (e apagados) juntos: o que sobrar não abre numa próxima vez.
      const token = await takePendingInvite();
      const space = await takePendingSpace();
      if (!active) return;
      if (token) return setDestination({ kind: 'invite', token });
      if (space) {
        return setDestination({
          kind: 'space',
          slug: space.slug,
          review: space.screen === 'review',
        });
      }
      const done = await getStored(STORAGE_KEYS.locationOnboardingDone);
      if (active && done === null) setDestination({ kind: 'location' });
    })();
    return () => {
      active = false;
    };
  }, []);

  if (destination?.kind === 'invite') {
    return (
      <Redirect href={{ pathname: '/convite/[token]', params: { token: destination.token } }} />
    );
  }
  if (destination?.kind === 'space') {
    return (
      <Redirect
        href={{
          pathname: destination.review ? '/espaco/[slug]/avaliar' : '/espaco/[slug]',
          params: { slug: destination.slug },
        }}
      />
    );
  }
  if (destination?.kind === 'location') return <Redirect href="/localizacao" />;
  return null;
}
