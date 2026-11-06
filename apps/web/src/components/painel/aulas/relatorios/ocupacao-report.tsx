'use client';

import { useListClassGroups } from '@space-sports/api-client';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/painel/field';
import type { SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/painel/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatClassSlot, teacherNames } from '@/lib/painel/aulas';
import { downloadCsv, toCsv } from '@/lib/painel/csv';
import {
  formatRate,
  occupancyCsvRows,
  occupancyRate,
  occupancyTotals,
} from '@/lib/painel/subscriptions';
import { Stat } from './stat';

const VIEWS = { true: 'Turmas ativas', false: 'Turmas inativas', all: 'Todas' } as const;

/** Ocupação das turmas (RF-CLASS-11): matriculados × capacidade, com as vagas livres. */
export function OcupacaoReport({ scope }: { scope: SpaceScope }) {
  const query = useListClassGroups(scope.spaceId);
  const [view, setView] = useState<keyof typeof VIEWS>('true');

  if (query.isPending) return <LoadingBlock rows={4} label="Carregando ocupação" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const all = query.data.items;
  const totals = occupancyTotals(all);
  const shown = all.filter((g) => view === 'all' || String(g.active) === view);

  function exportCsv() {
    const { header, rows } = occupancyCsvRows(shown);
    downloadCsv('ocupacao-das-turmas.csv', toCsv(header, rows));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Turmas ativas" value={totals.groups} testId="occupancy-groups" />
        <Stat
          label="Ocupação"
          value={formatRate(totals.rate)}
          hint={`${totals.enrolled} de ${totals.capacity} vagas`}
          testId="occupancy-rate"
        />
        <Stat label="Vagas livres" value={totals.spots} testId="occupancy-spots" />
        <Stat label="Turmas lotadas" value={totals.full} testId="occupancy-full" />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-56">
          <Field label="Mostrar" htmlFor="occupancy-view">
            <Select value={view} onValueChange={(v) => setView(v as keyof typeof VIEWS)}>
              <SelectTrigger id="occupancy-view" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(VIEWS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Button variant="outline" disabled={shown.length === 0} onClick={exportCsv}>
          <Download /> Baixar CSV
        </Button>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title="Nenhuma turma"
          description="Cadastre as turmas em Aulas → Turmas para acompanhar a ocupação."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Turma</TableHead>
                <TableHead>Horário</TableHead>
                <TableHead>Professores</TableHead>
                <TableHead className="w-56">Ocupação</TableHead>
                <TableHead className="text-right">Vagas livres</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((g) => {
                const rate = occupancyRate(g);
                return (
                  <TableRow key={g.id} data-testid="occupancy-row">
                    <TableCell>
                      <div className="font-medium">{g.name}</div>
                      <div className="text-muted-foreground text-xs">{g.sport.name}</div>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatClassSlot(g)}</TableCell>
                    <TableCell>{teacherNames(g.teachers)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div
                          className="bg-muted h-2 flex-1 overflow-hidden rounded-full"
                          role="progressbar"
                          aria-label={`Ocupação de ${g.name}`}
                          aria-valuemin={0}
                          aria-valuemax={g.capacity}
                          aria-valuenow={g.enrolledCount}
                        >
                          <div
                            className="bg-chart-1 h-full"
                            style={{ width: `${Math.round((rate ?? 0) * 100)}%` }}
                          />
                        </div>
                        <span className="text-sm tabular-nums">
                          {g.enrolledCount}/{g.capacity}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {!g.active ? (
                        <Badge variant="muted">Inativa</Badge>
                      ) : g.availableSpots === 0 ? (
                        <Badge variant="warning">Lotada</Badge>
                      ) : (
                        g.availableSpots
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
