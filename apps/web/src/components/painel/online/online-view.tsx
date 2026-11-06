'use client';

import {
  useGetMerchantAccount,
  useGetSpacePaymentSettings,
  useGetWalletSummary,
} from '@space-sports/api-client';
import { Info } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { Alert } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type OnlineTab, parseOnlineTab } from '@/lib/painel/online-payments';
import { isExpired, useSupportSession } from '@/lib/support/session';
import { ChargebacksView } from './chargebacks-view';
import { FeeCard, type MerchantAccess, MerchantCard, ModesCard } from './settings-cards';
import { WalletView } from './wallet-view';

/** "Recebimentos online" (RF-ONPAY-01, 02, 07 e 09): Dono e Admin; o Professor não vê. */
export function OnlineView() {
  return (
    <SpaceGate permission="payments.online.manage">
      {(scope) => <OnlinePayments scope={scope} />}
    </SpaceGate>
  );
}

/** Modo suporte neste espaço (decisão 95: cadastro e conta não são alterados no suporte). */
export function useSupportHere(spaceId: string): boolean {
  const session = useSupportSession();
  return Boolean(session && session.spaceId === spaceId && !isExpired(session));
}

export function useMerchantAccess(scope: SpaceScope, enabled: boolean): MerchantAccess {
  const support = useSupportHere(scope.spaceId);
  const isOwner = scope.can('merchant.manage');
  return {
    canSubmit: isOwner && !support && enabled && scope.canWrite('merchant.manage'),
    isOwner,
    support,
    enabled,
  };
}

function OnlinePayments({ scope }: { scope: SpaceScope }) {
  const settings = useGetSpacePaymentSettings(scope.spaceId);
  // Em análise, a página reconsulta o cadastro a cada 15 s (docs/05).
  const merchant = useGetMerchantAccount(scope.spaceId, {
    query: { refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 15_000 : false) },
  });
  const enabled = settings.data?.paymentEnvironment.enabled ?? true;
  const access = useMerchantAccess(scope, enabled);

  const header = (
    <PageHeader
      title="Recebimentos online"
      description="Pix e cartão pelo app, com o dinheiro direto na conta do espaço."
    />
  );

  if (settings.isPending || merchant.isPending) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <LoadingBlock rows={4} label="Carregando recebimentos online" />
      </div>
    );
  }
  if (settings.isError || merchant.isError) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <ErrorState
          error={settings.error ?? merchant.error}
          onRetry={() => {
            void settings.refetch();
            void merchant.refetch();
          }}
        />
      </div>
    );
  }

  // Depois da primeira aprovação, a página ganha abas (mesmo com a troca de conta em análise).
  const everApproved = merchant.data.status === 'APPROVED' || merchant.data.approvedAt !== null;
  const configuration = (
    <div className="flex max-w-[880px] flex-col gap-6">
      <MerchantCard merchant={merchant.data} access={access} />
      <ModesCard scope={scope} settings={settings.data} merchant={merchant.data} />
      <FeeCard fee={settings.data.fee} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {header}
      <ReadOnlyNotice scope={scope} />
      {!enabled ? (
        <Alert variant="info" role="status" data-testid="online-disabled">
          <Info aria-hidden />
          <p>
            O pagamento pelo app está desligado na plataforma. Reservas e mensalidades seguem pagas
            no local.
          </p>
        </Alert>
      ) : null}
      {everApproved ? (
        <ApprovedTabs scope={scope} configuration={configuration} enabled={enabled} />
      ) : (
        configuration
      )}
    </div>
  );
}

function ApprovedTabs({
  scope,
  configuration,
  enabled,
}: {
  scope: SpaceScope;
  configuration: React.ReactNode;
  enabled: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = parseOnlineTab(params.get('aba'));
  const merchant = useGetMerchantAccount(scope.spaceId);
  const wallet = useGetWalletSummary(scope.spaceId);
  const openDisputes = wallet.data?.openDisputes.count ?? 0;

  const go = (next: OnlineTab) => {
    const search = new URLSearchParams(params);
    search.set('aba', next);
    router.replace(`${pathname}?${search.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={tab} onValueChange={(value) => go(value as OnlineTab)}>
      <TabsList>
        <TabsTrigger value="carteira">Carteira</TabsTrigger>
        <TabsTrigger value="contestacoes">
          Contestações{openDisputes > 0 ? ` ${openDisputes}` : ''}
        </TabsTrigger>
        <TabsTrigger value="configuracao">Configuração</TabsTrigger>
      </TabsList>
      <TabsContent value="carteira" className="mt-4">
        {merchant.data ? (
          <WalletView
            scope={scope}
            merchant={merchant.data}
            onOpenDisputes={() => go('contestacoes')}
          />
        ) : null}
      </TabsContent>
      <TabsContent value="contestacoes" className="mt-4">
        <ChargebacksView scope={scope} enabled={enabled} />
      </TabsContent>
      <TabsContent value="configuracao" className="mt-4">
        {configuration}
      </TabsContent>
    </Tabs>
  );
}
