'use client';

import {
  type ConnectedAppListItemsItem,
  getListConnectedAppsQueryKey,
  useDisconnectConnectedApp,
  useGetMe,
  useListConnectedApps,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate, formatDateTime } from '@/lib/format';
import { connectionExpiry, groupScopes, isPlatformResource } from '@/lib/mcp-scopes';
import { cn, focusRing, textLink } from '@/lib/utils';
import { ClientIdentity } from './client-identity';

/**
 * Apps conectados (RF-MCP-05, decisão 116): os assistentes que o jogador autorizou, com os escopos, a data
 * da autorização e o último uso, e "Desconectar". A API corta o token na hora (não espera os 15 min).
 * Página de conta: serve a qualquer perfil logado, fora do `/painel`.
 */
export function ConnectedAppsView() {
  const apps = useListConnectedApps();
  const me = useGetMe();
  const profilePath = me.data?.access.super
    ? '/super/perfil'
    : me.data?.access.management
      ? '/painel/perfil'
      : undefined;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <PageHeader
        title="Apps conectados"
        description="Assistentes de IA que você autorizou a usar o Space Sports em seu nome."
        actions={
          profilePath ? (
            <Link href={profilePath} className={cn(textLink, 'rounded-md text-sm', focusRing)}>
              Voltar ao perfil
            </Link>
          ) : null
        }
      />
      {apps.isPending ? (
        <LoadingBlock rows={2} label="Carregando os apps conectados" />
      ) : apps.isError ? (
        <ErrorState error={apps.error} onRetry={() => void apps.refetch()} />
      ) : apps.data.items.length === 0 ? (
        <EmptyState
          title="Nenhum app conectado"
          description={emptyText(
            Boolean(me.data?.access.management),
            Boolean(me.data?.access.super),
          )}
        />
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Apps conectados">
          {apps.data.items.map((app) => (
            <li key={app.id}>
              <AppCard app={app} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function emptyText(management: boolean, platform: boolean): string {
  let text =
    'Apps conectados são assistentes de IA, como o Claude, que você autoriza a ver espaços e horários, reservar quadras e confirmar presença em aulas por conversa, sempre em seu nome. Para conectar, adicione o Space Sports como conector no seu assistente e entre com esta conta.';
  if (management) {
    text +=
      ' Quem é da equipe de um espaço também consulta, pelo mesmo conector, os dados dos espaços em que trabalha (somente leitura).';
  }
  if (platform) {
    text +=
      ' O painel da plataforma tem um conector próprio, “Space Sports · Plataforma”, também só de leitura.';
  }
  return `${text} Quando um assistente se conectar, ele aparece aqui, e você pode desconectar quando quiser.`;
}

function AppCard({ app }: { app: ConnectedAppListItemsItem }) {
  const queryClient = useQueryClient();
  const disconnect = useDisconnectConnectedApp();
  const [confirming, setConfirming] = useState(false);
  const platform = isPlatformResource(app.resource.kind);
  const groups = groupScopes(app.scopes);
  const expiry = connectionExpiry(app.expiresAt);

  function confirm() {
    disconnect.mutate(
      { id: app.id },
      {
        onSuccess: async () => {
          setConfirming(false);
          await queryClient.invalidateQueries({ queryKey: getListConnectedAppsQueryKey() });
          toast.success(`${app.name} desconectado.`);
        },
      },
    );
  }

  return (
    <Card data-testid="connected-app">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <ClientIdentity client={app} />
            <Badge variant={platform ? 'info' : 'muted'} data-testid="connected-app-connector">
              Conector: {app.resource.name}
            </Badge>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              disconnect.reset();
              setConfirming(true);
            }}
          >
            Desconectar
          </Button>
        </div>
        <section aria-label={`O que ${app.name} pode fazer`} className="flex flex-col gap-1">
          <h2 className="text-muted-foreground text-xs font-semibold uppercase">Permissões</h2>
          {groups.map((group) => (
            <div key={group.group} className="flex flex-col gap-1">
              {groups.length > 1 ? <h3 className="text-sm font-semibold">{group.label}</h3> : null}
              <ul className="list-disc pl-5 text-sm">
                {group.items.map((item) => (
                  <li key={item.scope}>{item.label}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
        <dl className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-1">
            <dt>Autorizado em</dt>
            <dd className="text-foreground">{formatDate(app.authorizedAt)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Último uso</dt>
            <dd className="text-foreground">
              {app.lastUsedAt ? formatDateTime(app.lastUsedAt) : 'ainda não usado'}
            </dd>
          </div>
          {expiry ? (
            <div className="flex gap-1" data-testid="connected-app-expiry">
              <dt>{expiry.expired ? 'Conexão expirada em' : 'Expira em'}</dt>
              <dd className="text-foreground">{formatDateTime(expiry.expiresAt)}</dd>
            </div>
          ) : null}
        </dl>
        {expiry?.expired ? (
          <p className="text-muted-foreground text-sm">Conecte de novo no assistente.</p>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Desconectar ${app.name}?`}
        description={
          platform
            ? 'O assistente perde o acesso aos dados da plataforma na hora. Você pode conectar de novo quando quiser.'
            : 'O assistente perde o acesso à sua conta na hora e não poderá mais ver nem reservar em seu nome. Você pode conectar de novo quando quiser.'
        }
        confirmLabel="Desconectar"
        pending={disconnect.isPending}
        error={disconnect.error}
        onConfirm={confirm}
      />
    </Card>
  );
}
