'use client';

import { useSimulatorListCharges, useSuperGetPaymentFees } from '@space-sports/api-client';
import { Info } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseSuperPaymentTab, type SuperPaymentTab } from '@/lib/super/online-payments';
import { PageHeader } from '../page-header';
import { FeesTab } from './fees-tab';
import { MerchantsTab, usePendingMerchants } from './merchants-tab';
import { RevenueTab } from './revenue-tab';
import { SimulatorTab } from './simulator-tab';

/**
 * O simulador só aparece quando a API expõe as rotas (gateway fake, RF-ONPAY-12): sem elas, a
 * consulta responde 404 e a aba some.
 */
export function useSimulatorAvailable(): boolean {
  const probe = useSimulatorListCharges({ limit: 1 }, { query: { retry: false } });
  return probe.isSuccess;
}

/** Pagamento online no Super (RF-ONPAY-10 a 12): receita, taxas, cadastros e simulador. */
export function OnlinePaymentsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const simulator = useSimulatorAvailable();
  const fees = useSuperGetPaymentFees();
  const pending = usePendingMerchants();
  const tab = parseSuperPaymentTab(params.get('aba'), simulator);
  const disabled = fees.data?.paymentEnvironment.enabled === false;

  const go = (next: SuperPaymentTab) => {
    const search = new URLSearchParams(params);
    search.set('aba', next);
    router.replace(`${pathname}?${search.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pagamento online"
        description="Receita da plataforma com a taxa de serviço, taxas, cadastros dos espaços no gateway e o simulador do ambiente de teste."
      />
      {disabled ? (
        <Alert variant="info" role="status" data-testid="online-disabled">
          <Info aria-hidden />
          <p>
            Pagamento online desligado (<code>PAYMENTS_PROVIDER=none</code>). Nenhuma cobrança nova
            é criada; o histórico continua aqui.
          </p>
        </Alert>
      ) : null}
      <Tabs value={tab} onValueChange={(value) => go(value as SuperPaymentTab)}>
        <TabsList>
          <TabsTrigger value="receita">Receita</TabsTrigger>
          <TabsTrigger value="taxas">Taxas</TabsTrigger>
          <TabsTrigger value="cadastros">Cadastros{pending ? ` ${pending}` : ''}</TabsTrigger>
          {simulator ? <TabsTrigger value="simulador">Simulador</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="receita" className="mt-4">
          <RevenueTab />
        </TabsContent>
        <TabsContent value="taxas" className="mt-4">
          <FeesTab />
        </TabsContent>
        <TabsContent value="cadastros" className="mt-4">
          <MerchantsTab />
        </TabsContent>
        {simulator ? (
          <TabsContent value="simulador" className="mt-4">
            <SimulatorTab />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
