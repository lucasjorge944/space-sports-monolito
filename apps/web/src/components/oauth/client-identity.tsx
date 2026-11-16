import { SpaceAvatar } from '@/components/space-avatar';
import { safeHttpsUrl, safeHttpUrl } from '@/lib/auth/oauth';
import { cn, textLink } from '@/lib/utils';

type ClientInfo = {
  name: string;
  host: string | null;
  uri: string | null;
  logoUrl: string | null;
};

/**
 * Quem pede ou recebeu o acesso: logo (ou iniciais), nome, domínio verificado do documento do cliente
 * (`host`) e o link da página dele. Nome e logo são do cliente (não confiáveis), então o domínio vai junto.
 */
export function ClientIdentity({
  client,
  size = 44,
  className,
}: {
  client: ClientInfo;
  size?: number;
  className?: string;
}) {
  const uri = safeHttpUrl(client.uri);
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Logo do cliente (não confiável): só `https:` e sem enviar o referrer ao domínio dele. */}
      <SpaceAvatar
        name={client.name}
        logoUrl={safeHttpsUrl(client.logoUrl)}
        size={size}
        referrerPolicy="no-referrer"
        decorative
      />
      <div className="min-w-0">
        <p className="font-semibold break-words" data-testid="client-name">
          {client.name}
        </p>
        {client.host ? (
          <p className="text-muted-foreground text-sm break-all" data-testid="client-host">
            {client.host}
          </p>
        ) : null}
        {uri ? (
          <a
            href={uri}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(textLink, 'text-sm break-all')}
          >
            Página do aplicativo
          </a>
        ) : null}
      </div>
    </div>
  );
}
