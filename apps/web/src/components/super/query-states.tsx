import { isApiError } from '@space-sports/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export function describeError(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 403) return 'Você não tem permissão para fazer isso.';
    if (error.status >= 500) return 'Erro no servidor. Tente novamente em instantes.';
    return error.message;
  }
  if (error instanceof TypeError) {
    return 'Não foi possível conectar. Verifique sua internet e tente de novo.';
  }
  return 'Não foi possível concluir. Tente novamente.';
}

export function LoadingBlock({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Carregando">
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: linhas de esqueleto estáticas
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3 p-4">
      <p>{describeError(error)}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </Alert>
  );
}

export function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
      {children}
    </div>
  );
}
