'use client';

import {
  type SuperSpace,
  useSuperCloseSpace,
  useSuperReactivateSpace,
  useSuperSuspendSpace,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { invalidateSuper } from '@/lib/super/invalidate';
import { availableStatusActions, type SpaceStatusAction } from '@/lib/super/space-status';
import { ReasonDialog } from '../reason-dialog';

const COPY: Record<
  SpaceStatusAction,
  { button: string; title: string; description: string; confirm: string; pending: string }
> = {
  suspend: {
    button: 'Suspender',
    title: 'Suspender espaço',
    description:
      'O espaço some da vitrine e o painel dele fica só em modo leitura. Dá para reativar depois.',
    confirm: 'Suspender',
    pending: 'Suspendendo…',
  },
  reactivate: {
    button: 'Reativar',
    title: 'Reativar espaço',
    description: 'O espaço volta a ficar ativo e, cumpridos os requisitos, reaparece na vitrine.',
    confirm: 'Reativar',
    pending: 'Reativando…',
  },
  close: {
    button: 'Encerrar',
    title: 'Encerrar espaço',
    description:
      'O espaço sai da vitrine e o painel dele fica só em modo leitura. É possível reativar depois.',
    confirm: 'Encerrar espaço',
    pending: 'Encerrando…',
  },
};

/** Suspender, reativar e encerrar (RF-SUPER-03), cada um com motivo opcional. */
export function SpaceStatusActions({ space }: { space: SuperSpace }) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<SpaceStatusAction>();
  const suspend = useSuperSuspendSpace();
  const reactivate = useSuperReactivateSpace();
  const close = useSuperCloseSpace();
  const mutations = { suspend, reactivate, close };

  return (
    <>
      {availableStatusActions(space.status).map((name) => (
        <Button
          key={name}
          variant={name === 'close' ? 'outline' : name === 'suspend' ? 'outline' : 'secondary'}
          onClick={() => setAction(name)}
        >
          {COPY[name].button}
        </Button>
      ))}
      <ReasonDialog
        open={action !== undefined}
        onOpenChange={(open) => {
          if (!open) setAction(undefined);
        }}
        title={action ? COPY[action].title : ''}
        description={action ? `${space.name}: ${COPY[action].description}` : undefined}
        confirmLabel={action ? COPY[action].confirm : ''}
        pendingLabel={action ? COPY[action].pending : ''}
        destructive={action === 'close'}
        onConfirm={async (reason) => {
          if (!action) return;
          await mutations[action].mutateAsync({
            spaceId: space.id,
            data: reason ? { reason } : {},
          });
          await invalidateSuper(queryClient);
        }}
      />
    </>
  );
}
