import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardLabel } from '@/components/ui/card';

/** Número grande com rótulo, para os resumos dos relatórios. */
export function Stat({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  testId?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardLabel>{label}</CardLabel>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className="font-display text-3xl font-bold tabular-nums" data-testid={testId}>
          {value}
        </p>
        {hint ? <p className="text-muted-foreground text-sm">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
