import type { SuperSpaceChecklist } from '@space-sports/api-client';
import { CheckCircle2, Circle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { checklistLabel, checklistMissingText } from '@/lib/super/labels';

/** Checklist de implantação calculado pela API (RF-SUPER-02): etapa, situação e o que falta. */
export function OnboardingChecklist({ checklist }: { checklist: SuperSpaceChecklist }) {
  return (
    <div className="grid gap-3">
      <p className="text-sm" aria-live="polite">
        {checklist.completed
          ? 'Implantação concluída.'
          : `${checklist.doneCount} de ${checklist.total} etapas concluídas.`}
      </p>
      <ul className="grid gap-3">
        {checklist.items.map((item) => (
          <li
            key={item.key}
            className="flex items-start gap-2 text-sm"
            data-testid="onboarding-step"
          >
            {item.done ? (
              <CheckCircle2
                className="text-success-subtle-foreground mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
            ) : (
              <Circle className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{checklistLabel[item.key]}</span>
                <Badge variant={item.done ? 'success' : 'warning'}>
                  {item.done ? 'Concluída' : 'Pendente'}
                </Badge>
              </div>
              {!item.done && item.missing.length > 0 ? (
                <span className="text-muted-foreground block text-xs">
                  Falta: {checklistMissingText(item.missing)}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
