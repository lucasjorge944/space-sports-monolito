import { FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

type Environment = { provider: string; enabled: boolean; sandbox: unknown | null };

/** O gateway é o simulado: a API manda `sandbox` só com o fake (decisão 92). */
export function isSandbox(environment: Environment | null | undefined): boolean {
  return Boolean(environment?.sandbox);
}

/**
 * Selo "Ambiente de teste" (docs/05, "Pagamento online"): pílula com as cores do selo, nunca
 * interativa. Lido como "Ambiente de teste: nenhum valor é cobrado de verdade".
 */
export function SandboxBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'border-sandbox-border bg-sandbox text-sandbox-foreground inline-flex min-h-6 w-fit items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold',
        className,
      )}
      role="img"
      aria-label="Ambiente de teste: nenhum valor é cobrado de verdade"
      data-testid="sandbox-badge"
    >
      <FlaskConical className="size-3.5" aria-hidden />
      Ambiente de teste
    </span>
  );
}

/** Faixa de teste no topo do cadastro e da carteira (só com o gateway simulado). */
export function SandboxBanner({ children }: { children: ReactNode }) {
  return (
    <Alert variant="sandbox" role="note" data-testid="sandbox-banner">
      <FlaskConical aria-hidden />
      <div className="grid gap-1">{children}</div>
    </Alert>
  );
}
