import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardLabel } from '@/components/ui/card';

type StatCardProps = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
};

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader>
        <CardLabel>{label}</CardLabel>
      </CardHeader>
      <CardContent>
        <p className="font-display text-3xl font-bold tabular-nums">{value}</p>
        {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
