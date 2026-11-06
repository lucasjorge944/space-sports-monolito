'use client';

import { useState } from 'react';
import { ExtratoView } from '@/components/painel/recebimentos/extrato-view';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { PageHeader } from '@/components/painel/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChargesList } from './charges-list';
import { DelinquentsList } from './delinquents-list';

export type StudentFilter = { subscriptionId: string; name: string };

export function MensalidadesView() {
  // A API exige `payment.record` para listar mensalidades e inadimplentes (Dono e Admin).
  return (
    <SpaceGate permission="payment.record">{(scope) => <Mensalidades scope={scope} />}</SpaceGate>
  );
}

function Mensalidades({ scope }: { scope: SpaceScope }) {
  const [tab, setTab] = useState('receber');
  const [student, setStudent] = useState<StudentFilter | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Mensalidades"
        description="Mensalidades dos planos de aula. O aluno paga direto no espaço; a plataforma só registra o recebimento."
      />
      <ReadOnlyNotice scope={scope} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="receber">A receber</TabsTrigger>
          <TabsTrigger value="inadimplentes">Inadimplentes</TabsTrigger>
          <TabsTrigger value="extrato">Extrato</TabsTrigger>
        </TabsList>

        <TabsContent value="receber" className="mt-4">
          <ChargesList scope={scope} student={student} onClearStudent={() => setStudent(null)} />
        </TabsContent>
        <TabsContent value="inadimplentes" className="mt-4">
          <DelinquentsList
            scope={scope}
            onShowCharges={(s) => {
              setStudent(s);
              setTab('receber');
            }}
          />
        </TabsContent>
        <TabsContent value="extrato" className="mt-4">
          <ExtratoView scope={scope} defaultService="CLASS" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
