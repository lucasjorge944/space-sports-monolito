'use client';

import { canInSpace, type SpacePermission, type SpaceRole } from '@space-sports/api-client';
import type { ReactNode } from 'react';
import { useSelectedSpace } from '@/components/shell/selected-space';
import { Alert } from '@/components/ui/alert';
import { SpaceChooser } from './space-chooser';
import { EmptyState, ErrorState, LoadingBlock, NoPermission } from './states';

export type SpaceScope = {
  spaceId: string;
  spaceName: string;
  slug: string;
  roles: SpaceRole[];
  /** Espaço suspenso/encerrado: a API só aceita leitura (RF-SUPER-03). */
  readOnly: boolean;
  /** O papel permite a ação? (a regra de verdade é da API). */
  can: (permission: SpacePermission) => boolean;
  /** Pode escrever: papel permite e o espaço não está em somente leitura. */
  canWrite: (permission: SpacePermission) => boolean;
};

/**
 * Contexto do espaço selecionado (RN-AUTH-03): trata carregando, erro, sem vínculo e a escolha
 * quando há mais de um espaço. `permission` bloqueia a tela inteira para quem não pode vê-la.
 */
export function SpaceGate({
  permission,
  loadingRows,
  children,
}: {
  permission?: SpacePermission;
  loadingRows?: number;
  children: (scope: SpaceScope) => ReactNode;
}) {
  const { status, selected, needsChoice, retry } = useSelectedSpace();

  if (status === 'loading') return <LoadingBlock rows={loadingRows} />;
  if (status === 'error') return <ErrorState onRetry={retry} />;
  if (!selected) {
    return (
      <EmptyState
        title="Nenhum espaço"
        description="Sua conta ainda não tem vínculo com um espaço."
      />
    );
  }
  if (needsChoice) return <SpaceChooser />;

  const { space, roles } = selected;
  const readOnly = space.status !== 'ACTIVE';
  const can = (p: SpacePermission) => canInSpace(roles, p);
  const scope: SpaceScope = {
    spaceId: space.id,
    spaceName: space.name,
    slug: space.slug,
    roles,
    readOnly,
    can,
    canWrite: (p) => can(p) && !readOnly,
  };
  if (permission && !can(permission)) return <NoPermission />;
  return <>{children(scope)}</>;
}

/** Aviso exibido no topo das telas quando o espaço está em somente leitura. */
export function ReadOnlyNotice({ scope }: { scope: SpaceScope }) {
  if (!scope.readOnly) return null;
  return (
    <Alert variant="warning" role="status" className="py-2">
      Este espaço está suspenso ou encerrado: o painel fica somente para consulta.
    </Alert>
  );
}
