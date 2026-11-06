'use client';

import {
  type ClassGroup,
  useGetClassGroupFrequency,
  useListClassAttendances,
  useListClassGroups,
} from '@space-sports/api-client';
import { ArrowLeft, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FormError } from '@/components/auth/form-alert';
import { SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime, formatLocalDate, todayLocal } from '@/lib/format';
import { defaultPeriod, formatRate, historyStatus, periodError } from '@/lib/painel/sessions';
import { textLink } from '@/lib/utils';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALL = 'all';

export function PresencasView() {
  return (
    <SpaceGate permission="classes.view" loadingRows={5}>
      {(scope) => <Presencas scope={scope} />}
    </SpaceGate>
  );
}

function Presencas({ scope }: { scope: SpaceScope }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const tab = params.get('aba') === 'aluno' ? 'aluno' : 'turma';
  const fallback = defaultPeriod(todayLocal());
  const rawFrom = params.get('de');
  const rawTo = params.get('ate');
  const from = rawFrom && DATE_RE.test(rawFrom) ? rawFrom : fallback.from;
  const to = rawTo && DATE_RE.test(rawTo) ? rawTo : fallback.to;
  const classGroupId = params.get('turma') ?? '';
  const studentId = params.get('aluno') ?? '';

  function navigate(next: Record<string, string | null>) {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') search.delete(key);
      else search.set(key, value);
    }
    router.replace(`${pathname}?${search.toString()}`, { scroll: false });
  }

  const groupsQuery = useListClassGroups(scope.spaceId, {});
  const groups = groupsQuery.data?.items ?? [];
  const invalidPeriod = periodError(from, to);

  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" className="self-start" asChild>
        <Link href="/painel/aulas/sessoes">
          <ArrowLeft /> Voltar às sessões
        </Link>
      </Button>
      <PageHeader
        title="Presença e frequência"
        description="Frequência de cada turma e histórico de presença por aluno, só das aulas já realizadas."
      />

      <Tabs value={tab} onValueChange={(v) => navigate({ aba: v })}>
        <TabsList>
          <TabsTrigger value="turma">Frequência por turma</TabsTrigger>
          <TabsTrigger value="aluno">Histórico de presença</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={classGroupId || ALL}
          onValueChange={(v) => navigate({ turma: v === ALL ? null : v })}
        >
          <SelectTrigger aria-label="Turma" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {tab === 'turma' ? 'Escolha a turma' : 'Todas as turmas'}
            </SelectItem>
            {groups.map((g: ClassGroup) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangePicker
          className="w-72"
          from={from}
          to={to}
          onValueChange={(next) =>
            next.from && next.to && navigate({ de: next.from, ate: next.to })
          }
        />
      </div>
      <FormError message={invalidPeriod ?? undefined} />

      {groupsQuery.isPending ? (
        <LoadingBlock rows={4} label="Carregando as turmas" />
      ) : groupsQuery.error ? (
        <ErrorState
          error={groupsQuery.error}
          title="Não foi possível carregar as turmas"
          onRetry={() => void groupsQuery.refetch()}
        />
      ) : tab === 'turma' ? (
        <Frequencia
          spaceId={scope.spaceId}
          classGroupId={classGroupId}
          from={from}
          to={to}
          enabled={!invalidPeriod}
          onOpenStudent={(userId) => navigate({ aba: 'aluno', aluno: userId })}
        />
      ) : (
        <Historico
          spaceId={scope.spaceId}
          classGroupId={classGroupId}
          studentId={studentId}
          from={from}
          to={to}
          enabled={!invalidPeriod}
          onClearStudent={() => navigate({ aluno: null })}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-display text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Frequencia({
  spaceId,
  classGroupId,
  from,
  to,
  enabled,
  onOpenStudent,
}: {
  spaceId: string;
  classGroupId: string;
  from: string;
  to: string;
  enabled: boolean;
  onOpenStudent: (userId: string) => void;
}) {
  const query = useGetClassGroupFrequency(
    spaceId,
    classGroupId,
    { from, to },
    { query: { enabled: enabled && !!classGroupId } },
  );

  if (!classGroupId) {
    return (
      <EmptyState
        title="Escolha uma turma"
        description="Veja presenças, faltas e a taxa de frequência de cada aluno no período."
      />
    );
  }
  if (!enabled) return null;
  if (query.isPending) return <LoadingBlock rows={4} label="Carregando a frequência" />;
  if (query.error) {
    return (
      <ErrorState
        error={query.error}
        title="Não foi possível carregar a frequência"
        onRetry={() => void query.refetch()}
      />
    );
  }

  const data = query.data;
  return (
    <div className="flex flex-col gap-4" data-testid="frequency">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Aulas dadas" value={data.sessionsDone} />
        <Stat label="Aulas canceladas" value={data.sessionsCancelled} />
        <Stat label="Presenças" value={data.totals.present} />
        <Stat label="Faltas" value={data.totals.absent} />
        <Stat label="Sem marcação" value={data.totals.unmarked} />
        <Stat label="Frequência" value={formatRate(data.totals.attendanceRate)} />
      </dl>
      {data.students.length === 0 ? (
        <EmptyState
          title="Nenhum aluno no período"
          description="A turma não tem matriculados nem presenças entre essas datas."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aluno</TableHead>
              <TableHead className="text-right">Presenças</TableHead>
              <TableHead className="text-right">Faltas</TableHead>
              <TableHead className="text-right">Sem marcação</TableHead>
              <TableHead className="text-right">Frequência</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Histórico</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.students.map((s) => (
              <TableRow key={s.userId} data-testid="frequency-row">
                <TableCell className="font-medium">
                  {s.name}
                  {s.enrolled ? null : (
                    <span className="text-muted-foreground ml-2 text-xs">não matriculado hoje</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{s.present}</TableCell>
                <TableCell className="text-right tabular-nums">{s.absent}</TableCell>
                <TableCell className="text-right tabular-nums">{s.unmarked}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRate(s.attendanceRate)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Ver histórico de ${s.name}`}
                    onClick={() => onOpenStudent(s.userId)}
                  >
                    Histórico
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function Historico({
  spaceId,
  classGroupId,
  studentId,
  from,
  to,
  enabled,
  onClearStudent,
}: {
  spaceId: string;
  classGroupId: string;
  studentId: string;
  from: string;
  to: string;
  enabled: boolean;
  onClearStudent: () => void;
}) {
  const hasFilter = !!classGroupId || !!studentId;
  const query = useListClassAttendances(
    spaceId,
    {
      from,
      to,
      ...(classGroupId ? { classGroupId } : {}),
      ...(studentId ? { userId: studentId } : {}),
    },
    { query: { enabled: enabled && hasFilter } },
  );

  if (!hasFilter) {
    return (
      <EmptyState
        title="Escolha uma turma ou um aluno"
        description="Selecione uma turma acima ou abra o histórico de um aluno pela aba de frequência."
      />
    );
  }
  if (!enabled) return null;
  if (query.isPending) return <LoadingBlock rows={4} label="Carregando o histórico" />;
  if (query.error) {
    return (
      <ErrorState
        error={query.error}
        title="Não foi possível carregar o histórico"
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { items, summary } = query.data;
  const studentName = studentId ? items[0]?.student.name : undefined;
  return (
    <div className="flex flex-col gap-4" data-testid="history">
      {studentId ? (
        <div className="flex items-center gap-2 text-sm">
          <span>
            Histórico de <strong>{studentName ?? 'aluno'}</strong>
          </span>
          <Button size="sm" variant="ghost" onClick={onClearStudent} aria-label="Limpar aluno">
            <X /> Limpar
          </Button>
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Presenças" value={summary.present} />
        <Stat label="Faltas" value={summary.absent} />
        <Stat label="Sem marcação" value={summary.unmarked} />
        <Stat label="Frequência" value={formatRate(summary.attendanceRate)} />
      </dl>
      {items.length === 0 ? (
        <EmptyState
          title="Nenhum registro no período"
          description={`Sem presenças entre ${formatLocalDate(from)} e ${formatLocalDate(to)}.`}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aula</TableHead>
              <TableHead>Turma</TableHead>
              {studentId ? null : <TableHead>Aluno</TableHead>}
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} data-testid="history-row">
                <TableCell>
                  <Link className={textLink} href={`/painel/aulas/sessoes/${item.session.id}`}>
                    {formatDateTime(item.session.startsAt)}
                  </Link>
                </TableCell>
                <TableCell>{item.session.classGroup.name}</TableCell>
                {studentId ? null : <TableCell>{item.student.name}</TableCell>}
                <TableCell>
                  <StatusBadge info={historyStatus(item.status, item.session.status)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
