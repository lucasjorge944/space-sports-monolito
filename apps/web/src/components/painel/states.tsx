import { AlertCircle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiErrorMessage } from '@/lib/painel/errors';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-h3">{title}</h1>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function LoadingBlock({
  rows = 4,
  label = 'Carregando',
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: esqueleto estático
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
      <Inbox className="size-6" aria-hidden />
      <p className="text-foreground font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm">{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = 'Não foi possível carregar',
}: {
  error?: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <Alert variant="destructive" className="flex flex-col items-start gap-2 py-4">
      <div className="flex items-center gap-2 font-medium">
        <AlertCircle className="size-4" aria-hidden />
        {title}
      </div>
      <p>{apiErrorMessage(error)}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </Alert>
  );
}

/** Mensagem de campo/ação bloqueada pelo papel ou pelo espaço suspenso. */
export function NoPermission({
  message = 'Seu papel neste espaço não permite acessar esta área.',
}) {
  return <EmptyState title="Sem permissão" description={message} />;
}
