'use client';

import { useListClassAttendances } from '@space-sports/api-client';
import { useState } from 'react';
import { ErrorState, LoadingBlock } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select-menu';
import { formatDateTime } from '@/lib/format';
import { attendanceInfo } from '@/lib/painel/labels';
import { formatRate, lastDaysRange } from '@/lib/painel/subscriptions';
import { overline } from '@/lib/utils';

const PERIODS = [
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: '180', label: 'Últimos 180 dias' },
];

/** Histórico de presença do aluno nas aulas (RF-CLASS-05); `summary` conta só aulas já dadas. */
export function AttendanceHistory({ spaceId, userId }: { spaceId: string; userId: string }) {
  const [days, setDays] = useState('30');
  const range = lastDaysRange(Number(days));
  const query = useListClassAttendances(spaceId, { userId, ...range });

  return (
    <section className="flex flex-col gap-3" aria-labelledby="hist-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="hist-title" className={overline}>
          Histórico de presença
        </h3>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-44" aria-label="Período do histórico">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {query.isPending ? (
        <LoadingBlock rows={3} label="Carregando presenças" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <dl className="grid grid-cols-4 gap-2 text-center" data-testid="attendance-summary">
            <Stat label="Presenças" value={query.data.summary.present} />
            <Stat label="Faltas" value={query.data.summary.absent} />
            <Stat label="Sem marcação" value={query.data.summary.unmarked} />
            <Stat label="Frequência" text={formatRate(query.data.summary.attendanceRate)} />
          </dl>
          {query.data.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma aula no período.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {query.data.items.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  data-testid="attendance-row"
                >
                  <div>
                    <div className="font-medium">{a.session.classGroup.name}</div>
                    <div className="text-muted-foreground text-xs tabular-nums">
                      {formatDateTime(a.session.startsAt)}
                    </div>
                  </div>
                  <StatusBadge info={attendanceInfo(a.status, a.session.status)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, text }: { label: string; value?: number; text?: string }) {
  return (
    <div className="rounded-lg border px-2 py-2">
      <dd className="font-display text-xl font-semibold tabular-nums">{text ?? value}</dd>
      <dt className="text-muted-foreground text-xs">{label}</dt>
    </div>
  );
}
