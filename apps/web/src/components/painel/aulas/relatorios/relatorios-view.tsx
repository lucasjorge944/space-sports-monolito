'use client';

import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { PageHeader } from '@/components/painel/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FrequenciaReport } from './frequencia-report';
import { OcupacaoReport } from './ocupacao-report';
import { ReceitaReport } from './receita-report';

export function RelatoriosView() {
  // Ocupação e frequência valem para quem vê as turmas (o Professor, só as dele); a receita traz
  // valores e exige `payment.record`.
  return <SpaceGate permission="classes.view">{(scope) => <Relatorios scope={scope} />}</SpaceGate>;
}

function Relatorios({ scope }: { scope: SpaceScope }) {
  const showRevenue = scope.can('payment.record');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Relatórios das aulas"
        description="Ocupação das turmas, frequência dos alunos e receita das mensalidades."
      />
      <ReadOnlyNotice scope={scope} />

      <Tabs defaultValue="ocupacao">
        <TabsList>
          <TabsTrigger value="ocupacao">Ocupação das turmas</TabsTrigger>
          <TabsTrigger value="frequencia">Frequência</TabsTrigger>
          {showRevenue ? <TabsTrigger value="receita">Receita</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="ocupacao" className="mt-4">
          <OcupacaoReport scope={scope} />
        </TabsContent>
        <TabsContent value="frequencia" className="mt-4">
          <FrequenciaReport scope={scope} />
        </TabsContent>
        {showRevenue ? (
          <TabsContent value="receita" className="mt-4">
            <ReceitaReport scope={scope} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
