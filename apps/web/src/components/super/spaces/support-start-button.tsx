'use client';

import { type SuperSpace, useSuperStartSupportSession } from '@space-sports/api-client';
import { LifeBuoy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { saveSupportSession } from '@/lib/support/session';
import { ReasonDialog } from '../reason-dialog';

/** Abre o painel do espaço em modo suporte (RF-SUPER-04): o motivo é obrigatório e fica na auditoria. */
export function SupportStartButton({
  space,
}: {
  space: Pick<SuperSpace, 'id' | 'name' | 'slug' | 'status'>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const start = useSuperStartSupportSession();

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <LifeBuoy aria-hidden="true" />
        Modo suporte
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Entrar em modo suporte"
        description={`Você vai agir como Dono de ${space.name} por até 2 horas. Toda ação fica registrada em seu nome.`}
        reasonLabel="Motivo do atendimento"
        required
        confirmLabel="Entrar no painel"
        pendingLabel="Abrindo…"
        onConfirm={async (reason) => {
          const session = await start.mutateAsync({
            spaceId: space.id,
            data: { reason: reason ?? '' },
          });
          saveSupportSession({
            id: session.id,
            spaceId: session.spaceId,
            spaceName: session.spaceName,
            spaceSlug: space.slug,
            spaceStatus: space.status,
            expiresAt: session.expiresAt,
          });
          router.push('/painel');
        }}
      />
    </>
  );
}
