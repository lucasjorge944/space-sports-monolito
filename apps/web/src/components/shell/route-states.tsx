'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export function RouteLoading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Carregando">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3" role="alert">
      <h1 className="font-display text-h3">Algo deu errado</h1>
      <p className="text-muted-foreground text-sm">
        Não foi possível carregar esta página. Tente novamente.
      </p>
      {error.digest ? <code className="text-muted-foreground text-xs">{error.digest}</code> : null}
      <Button onClick={reset}>Tentar novamente</Button>
    </div>
  );
}
