'use client';

import {
  isApiError,
  type OAuthConsentRequest,
  useGetMe,
  useGetOAuthConsentRequest,
} from '@space-sports/api-client';
import { Check, Minus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { FormError } from '@/components/auth/form-alert';
import { LoadingBlock } from '@/components/painel/states';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth/client';
import { thrownErrorMessage } from '@/lib/auth/errors';
import { completeProfilePath, needsProfileCompletion } from '@/lib/auth/navigation';
import {
  AUTHORIZE_PATH,
  CONNECTED_APPS_PATH,
  isConsentAccessDenied,
  isConsentExpired,
  isConsentProfileIncomplete,
  isConsentRequestGone,
  isConsentUnavailable,
  oauthLoginPath,
  redirectTarget,
} from '@/lib/auth/oauth';
import { signOut } from '@/lib/auth/sign-out';
import {
  canWrite,
  deniedNotes,
  groupScopes,
  isPlatformResource,
  platformNotice,
} from '@/lib/mcp-scopes';
import { cn, textLink } from '@/lib/utils';
import { ClientIdentity } from './client-identity';

const GONE_TITLE = 'Pedido inválido ou vencido';
const UNAVAILABLE_TEXT =
  'Este conector está temporariamente indisponível. Volte ao assistente e tente de novo mais tarde.';
const GONE_TEXT =
  'Este pedido de conexão venceu ou não é mais válido. Volte ao assistente e tente conectar de novo: é só repetir.';

/**
 * Consentimento do MCP (`/autorizar`, RF-MCP-01, docs/14-mcp.md 3.5): mostra quem pede o acesso, a
 * conta logada e o que será permitido; "Permitir" e "Cancelar" respondem ao Better Auth e a API devolve
 * o destino (o `redirect_uri` do cliente, com `code` ou `error=access_denied`).
 */
export function ConsentView({ oauthQuery }: { oauthQuery: string }) {
  const me = useGetMe();
  const sessionExpired = isApiError(me.error) && me.error.status === 401;
  // Cadastro incompleto (decisão 66): o `proxy.ts` já desvia; isto cobre quando ele não pôde validar.
  const incomplete = me.data ? needsProfileCompletion(me.data) : false;
  const request = useGetOAuthConsentRequest(
    { oauthQuery },
    { query: { enabled: Boolean(me.data) && !incomplete, retry: false } },
  );

  useEffect(() => {
    if (sessionExpired) window.location.assign(oauthLoginPath(oauthQuery));
  }, [sessionExpired, oauthQuery]);

  useEffect(() => {
    if (incomplete) {
      window.location.assign(completeProfilePath(`${AUTHORIZE_PATH}?${oauthQuery}`));
    }
  }, [incomplete, oauthQuery]);

  if (me.isError && !sessionExpired) {
    return (
      <StatusCard
        title="Não foi possível carregar"
        text="Tente novamente em instantes."
        onRetry={() => void me.refetch()}
      />
    );
  }
  if (!me.data || incomplete || request.isPending) {
    return (
      <AuthCard title="Permitir acesso" className="max-w-md">
        <LoadingBlock rows={3} label="Carregando o pedido" />
      </AuthCard>
    );
  }
  if (request.isError) {
    if (isApiError(request.error) && isConsentUnavailable(request.error)) {
      return <StatusCard title="Conector indisponível" text={UNAVAILABLE_TEXT} home />;
    }
    return isApiError(request.error) && isConsentRequestGone(request.error) ? (
      <StatusCard title={GONE_TITLE} text={GONE_TEXT} home />
    ) : (
      <StatusCard
        title="Não foi possível carregar o pedido"
        text="Tente novamente em instantes."
        onRetry={() => void request.refetch()}
      />
    );
  }
  return (
    <ConsentCard
      request={request.data}
      account={{ name: me.data.name, email: me.data.email }}
      isSuper={me.data.access.super}
      oauthQuery={oauthQuery}
    />
  );
}

function StatusCard({
  title,
  text,
  onRetry,
  home,
}: {
  title: string;
  text: string;
  onRetry?: () => void;
  home?: boolean;
}) {
  return (
    <AuthCard title={title} description={text} className="max-w-md">
      {onRetry ? (
        <Button size="xl" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
      {home ? (
        <Button asChild variant="outline" size="xl">
          <Link href="/">Ir para o Space Sports</Link>
        </Button>
      ) : null}
    </AuthCard>
  );
}

type Decision = 'allow' | 'deny';

function ConsentCard({
  request,
  account: accountInfo,
  isSuper,
  oauthQuery,
}: {
  request: OAuthConsentRequest;
  account: { name: string; email: string | null };
  isSuper: boolean;
  oauthQuery: string;
}) {
  const [decision, setDecision] = useState<Decision>();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string>();
  // O "Permitir" pode descobrir que a conta não tem acesso (RN-MCP-06): vira o mesmo estado do pedido.
  const [refused, setRefused] = useState(false);
  const [gone, setGone] = useState(() => isConsentExpired(request.expiresAt));

  // O pedido vale por 10 min: se a página ficar aberta além disso, vira "vencido" sozinha.
  useEffect(() => {
    const remaining = Date.parse(request.expiresAt) - Date.now();
    if (!(remaining > 0)) return;
    const timer = setTimeout(() => setGone(true), Math.min(remaining, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [request.expiresAt]);

  if (gone) return <StatusCard title={GONE_TITLE} text={GONE_TEXT} home />;

  const busy = decision !== undefined || switching;

  async function respond(accept: boolean) {
    setDecision(accept ? 'allow' : 'deny');
    setError(undefined);
    try {
      const { data, error: failure } = await authClient.$fetch<unknown>('/oauth2/consent', {
        method: 'POST',
        body: { accept },
      });
      const target = redirectTarget(data);
      if (!failure && target) {
        // Fica "ocupado" até a navegação terminar: não dá para decidir duas vezes.
        window.location.assign(target);
        return;
      }
      // Cadastro incompleto (decisão 119): completa e volta ao pedido (vem antes do "sem acesso").
      if (isConsentProfileIncomplete(failure)) {
        window.location.assign(completeProfilePath(`${AUTHORIZE_PATH}?${oauthQuery}`));
        return;
      }
      if (failure?.status === 401) {
        window.location.assign(oauthLoginPath(oauthQuery));
        return;
      }
      if (isConsentAccessDenied(failure)) {
        setRefused(true);
        setDecision(undefined);
        return;
      }
      if (isConsentRequestGone(failure)) {
        setGone(true);
        return;
      }
      if (isConsentUnavailable(failure)) {
        setError(UNAVAILABLE_TEXT);
        setDecision(undefined);
        return;
      }
      setError('Não foi possível concluir. Tente novamente.');
    } catch (thrown) {
      setError(thrownErrorMessage(thrown));
    }
    setDecision(undefined);
  }

  const platform = isPlatformResource(request.resource.kind);
  const groups = groupScopes(request.scopes);
  const denied = deniedNotes(request.deniedScopes);

  const account = (
    <p className="text-sm" data-testid="consent-account">
      Entrou como <strong className="font-semibold break-words">{accountInfo.name}</strong>
      {accountInfo.email ? (
        <span className="text-muted-foreground"> ({accountInfo.email})</span>
      ) : null}
      .{' '}
      <button
        type="button"
        className={cn(textLink, 'disabled:opacity-60')}
        disabled={busy}
        onClick={() => {
          setSwitching(true);
          void signOut(oauthLoginPath(oauthQuery));
        }}
      >
        Não é você? Trocar de conta
      </button>
    </p>
  );

  // Nenhum escopo concedível (ex.: quem não é Super no conector da plataforma): sem "Permitir".
  if (!request.canAuthorize || groups.length === 0 || refused) {
    return (
      <AuthCard
        title="Sua conta não tem acesso"
        description={
          platform
            ? isSuper
              ? 'Este assistente não está liberado para o painel da plataforma, ou o conector está desligado.'
              : `Este conector (${request.resource.name}) é só para quem administra a plataforma Space Sports.`
            : `Sua conta não pode usar o conector ${request.resource.name} neste momento.`
        }
        className="max-w-md"
      >
        <ClientIdentity client={request.client} className="rounded-lg border p-3" />
        {account}
        <p className="text-muted-foreground text-sm" data-testid="consent-no-access">
          Nada foi liberado para o assistente. Volte a ele para encerrar o pedido, ou troque de
          conta se você tem outra com acesso.
        </p>
        <FormError message={error} />
        <Button variant="outline" size="xl" disabled={busy} onClick={() => void respond(false)}>
          {decision === 'deny' ? 'Voltando…' : 'Voltar ao assistente'}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={platform ? 'Permitir acesso à plataforma' : 'Permitir acesso'}
      description={
        platform
          ? 'Um assistente quer ler os dados da plataforma Space Sports com a sua conta.'
          : 'Um assistente quer usar o Space Sports com a sua conta.'
      }
      className="max-w-md"
    >
      <ClientIdentity client={request.client} className="rounded-lg border p-3" />

      {account}

      {platform ? (
        <div
          role="note"
          data-testid="platform-notice"
          className="border-warning bg-warning-subtle text-warning-subtle-foreground rounded-lg border px-4 py-3 text-sm font-medium"
        >
          {platformNotice(request.resource.maxConnectionHours)}
        </div>
      ) : null}

      <section aria-labelledby="consent-scopes" className="flex flex-col gap-3">
        <h2 id="consent-scopes" className="text-sm font-semibold">
          Este assistente poderá:
        </h2>
        {groups.map((group) => (
          <div
            key={group.group}
            className="flex flex-col gap-2"
            data-testid={`consent-group-${group.group.toLowerCase()}`}
          >
            <h3 className="text-muted-foreground text-xs font-semibold uppercase">{group.label}</h3>
            <ul className="flex flex-col gap-2 text-sm">
              {group.items.map((item) => (
                <li key={item.scope} className="flex items-start gap-2">
                  <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
            {group.note ? <p className="text-muted-foreground text-sm">{group.note}</p> : null}
          </div>
        ))}
      </section>

      {denied.length > 0 ? (
        <section aria-labelledby="consent-denied" className="flex flex-col gap-2">
          <h2 id="consent-denied" className="text-sm font-semibold">
            Fora desta conexão
          </h2>
          <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
            {denied.map((note) => (
              <li key={note} className="flex items-start gap-2">
                <Minus className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-muted-foreground text-sm">
        {platform
          ? ''
          : canWrite(request.scopes)
            ? 'O assistente vai poder agir em seu nome dentro desses limites. '
            : 'O assistente só vai poder ler esses dados. '}
        Você pode desconectar quando quiser em{' '}
        <a
          href={CONNECTED_APPS_PATH}
          target="_blank"
          rel="noopener noreferrer"
          className={textLink}
        >
          Apps conectados
        </a>
        .
      </p>

      <FormError message={error} />
      <div className="flex flex-col gap-3">
        <Button size="xl" disabled={busy} onClick={() => void respond(true)}>
          {decision === 'allow' ? 'Permitindo…' : 'Permitir'}
        </Button>
        <Button variant="outline" size="xl" disabled={busy} onClick={() => void respond(false)}>
          {decision === 'deny' ? 'Cancelando…' : 'Cancelar'}
        </Button>
      </div>
    </AuthCard>
  );
}
