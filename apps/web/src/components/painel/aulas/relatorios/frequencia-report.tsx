'use client';

import { useGetClassGroupFrequency, useListClassGroups } from '@space-sports/api-client';
import { addDays } from '@space-sports/shared';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/painel/field';
import type { SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/painel/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-picker';
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
import { formatLocalDate } from '@/lib/format';
import { formatClassSlot } from '@/lib/painel/aulas';
import { downloadCsv, toCsv } from '@/lib/painel/csv';
import { formatRate, frequencyCsvRows, lastDaysRange } from '@/lib/painel/subscriptions';
import { Stat } from './stat';

/** O histórico e a frequência aceitam no máximo 366 dias (a API devolve 422 acima disso). */
const MAX_DAYS = 366;

/** Frequência por turma e período (RF-CLASS-08..10): presenças, faltas e sem marcação por aluno. */
export function FrequenciaReport({ scope }: { scope: SpaceScope }) {
  const groups = useListClassGroups(scope.spaceId);
  const [classGroupId, setClassGroupId] = useState('');
  const [range, setRange] = useState(() => lastDaysRange(30));

  if (groups.isPending) return <LoadingBlock rows={3} label="Carregando turmas" />;
  if (groups.isError)
    return <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />;

  const options = groups.data.items;
  if (options.length === 0) {
    return (
      <EmptyState
        title="Nenhuma turma"
        description="Cadastre as turmas em Aulas → Turmas para ver a frequência."
      />
    );
  }
  const selected = classGroupId || (options[0]?.id ?? '');
  const selectedGroup = options.find((g) => g.id === selected);

  const invalid = range.from > range.to || range.to > addDays(range.from, MAX_DAYS - 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:max-w-3xl">
        <Field label="Turma" htmlFor="freq-group">
          <Select value={selected} onValueChange={setClassGroupId}>
            <SelectTrigger id="freq-group" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name} · {formatClassSlot(g)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Período" group>
          <DateRangePicker
            from={range.from}
            to={range.to}
            onValueChange={(next) => next.from && next.to && setRange(next)}
          />
        </Field>
      </div>
      {selectedGroup && !selectedGroup.active ? (
        <Badge variant="muted" className="w-fit">
          Turma inativa
        </Badge>
      ) : null}

      {invalid ? (
        <EmptyState
          title="Período inválido"
          description="A data inicial precisa ser igual ou anterior à final, com no máximo 366 dias."
        />
      ) : (
        <Frequency
          spaceId={scope.spaceId}
          classGroupId={selected}
          groupName={selectedGroup?.name ?? 'turma'}
          from={range.from}
          to={range.to}
        />
      )}
    </div>
  );
}

function Frequency({
  spaceId,
  classGroupId,
  groupName,
  from,
  to,
}: {
  spaceId: string;
  classGroupId: string;
  groupName: string;
  from: string;
  to: string;
}) {
  const query = useGetClassGroupFrequency(spaceId, classGroupId, { from, to });

  if (query.isPending) return <LoadingBlock rows={4} label="Carregando frequência" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const { totals, students } = query.data;

  function exportCsv() {
    const { header, rows } = frequencyCsvRows(students);
    downloadCsv(
      `frequencia-${groupName.toLowerCase().replace(/\s+/g, '-')}-${from}-a-${to}.csv`,
      toCsv(header, rows),
    );
  }

  return (
    <>
      <p className="text-muted-foreground text-sm">
        {formatLocalDate(query.data.from)} a {formatLocalDate(query.data.to)}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Aulas dadas"
          value={query.data.sessionsDone}
          hint={`${query.data.sessionsCancelled} cancelada(s)`}
          testId="freq-done"
        />
        <Stat label="Presenças" value={totals.present} testId="freq-present" />
        <Stat label="Faltas" value={totals.absent} testId="freq-absent" />
        <Stat label="Sem marcação" value={totals.unmarked} testId="freq-unmarked" />
        <Stat label="Frequência" value={formatRate(totals.attendanceRate)} testId="freq-rate" />
      </div>

      <div className="flex justify-end">
        <Button variant="outline" disabled={students.length === 0} onClick={exportCsv}>
          <Download /> Baixar CSV
        </Button>
      </div>

      {students.length === 0 ? (
        <EmptyState
          title="Nenhum aluno no período"
          description="Ainda não há alunos matriculados nem presenças registradas para esta turma."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aluno</TableHead>
                <TableHead className="text-right">Presenças</TableHead>
                <TableHead className="text-right">Faltas</TableHead>
                <TableHead className="text-right">Sem marcação</TableHead>
                <TableHead className="text-right">Frequência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => (
                <TableRow key={s.userId} data-testid="frequency-row">
                  <TableCell>
                    <span className="font-medium">{s.name}</span>
                    {!s.enrolled ? (
                      <Badge variant="muted" className="ml-2">
                        Não matriculado
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.present}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.absent}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.unmarked}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRate(s.attendanceRate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
