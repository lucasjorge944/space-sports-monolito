'use client';

import {
  type ClassSession,
  type ListClassSessionsStatusItem,
  useListClassGroups,
  useListClassSessions,
  useListTeachers,
} from '@space-sports/api-client';
import { addDays } from '@space-sports/shared';
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDayLabel, formatLocalDate, todayLocal } from '@/lib/format';
import { weekDates } from '@/lib/painel/agenda';
import { groupByDay, SESSION_STATUS } from '@/lib/painel/sessions';
import { overline } from '@/lib/utils';
import { SessionCard } from './session-card';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALL = 'all';
const STATUSES = Object.keys(SESSION_STATUS) as ListClassSessionsStatusItem[];

export function SessoesView() {
  return (
    <SpaceGate permission="classes.view" loadingRows={6}>
      {(scope) => <Sessoes scope={scope} />}
    </SpaceGate>
  );
}

function Sessoes({ scope }: { scope: SpaceScope }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const rawDate = params.get('data');
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : todayLocal();
  const view = params.get('visao') === 'dia' ? 'dia' : 'semana';
  const classGroupId = params.get('turma') ?? ALL;
  const teacherMemberId = params.get('professor') ?? ALL;
  const status = (params.get('situacao') ?? ALL) as ListClassSessionsStatusItem | typeof ALL;

  function navigate(next: Record<string, string | null>) {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === ALL) search.delete(key);
      else search.set(key, value);
    }
    router.replace(`${pathname}?${search.toString()}`, { scroll: false });
  }

  const days = useMemo(() => (view === 'semana' ? weekDates(date) : [date]), [view, date]);
  const from = days[0] as string;
  const to = days[days.length - 1] as string;

  const sessionsQuery = useListClassSessions(
    scope.spaceId,
    {
      from,
      to,
      ...(classGroupId !== ALL ? { classGroupId } : {}),
      ...(teacherMemberId !== ALL ? { teacherMemberId } : {}),
      ...(status !== ALL ? { status: [status] } : {}),
    },
    // O job de 1 minuto abre/fecha as listas: mantém o calendário em dia.
    { query: { refetchInterval: 60_000 } },
  );
  const groupsQuery = useListClassGroups(scope.spaceId, {});
  // O Professor (sem outro papel) só vê as próprias aulas: não há o que filtrar por professor.
  const showTeacherFilter = scope.roles.some((r) => r !== 'TEACHER');
  const teachersQuery = useListTeachers(scope.spaceId, {
    query: { enabled: showTeacherFilter },
  });

  const sessions: ClassSession[] = sessionsQuery.data?.items ?? [];
  const byDay = useMemo(() => groupByDay(sessions), [sessions]);
  const onlyOwn = !showTeacherFilter;

  const title =
    view === 'semana' ? `${formatLocalDate(from)} a ${formatLocalDate(to)}` : formatDayLabel(date);
  const step = view === 'semana' ? 7 : 1;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Sessões"
        description={
          onlyOwn ? `${title} · suas aulas` : `${title} · aulas geradas pelas turmas do espaço`
        }
        actions={
          <Button variant="outline" asChild>
            <Link href="/painel/aulas/sessoes/presencas">
              <CalendarCheck /> Presença e frequência
            </Link>
          </Button>
        }
      />
      <ReadOnlyNotice scope={scope} />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={view === 'semana' ? 'Semana anterior' : 'Dia anterior'}
          onClick={() => navigate({ data: addDays(date, -step) })}
        >
          <ChevronLeft />
        </Button>
        <Button variant="outline" onClick={() => navigate({ data: todayLocal() })}>
          Hoje
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={view === 'semana' ? 'Próxima semana' : 'Próximo dia'}
          onClick={() => navigate({ data: addDays(date, step) })}
        >
          <ChevronRight />
        </Button>
        <DatePicker
          aria-label="Ir para a data"
          className="w-40"
          value={date}
          onValueChange={(d) => d && navigate({ data: d })}
        />
        <Tabs value={view} onValueChange={(v) => navigate({ visao: v })}>
          <TabsList>
            <TabsTrigger value="dia">Dia</TabsTrigger>
            <TabsTrigger value="semana">Semana</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={classGroupId} onValueChange={(v) => navigate({ turma: v })}>
          <SelectTrigger aria-label="Filtrar por turma" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as turmas</SelectItem>
            {(groupsQuery.data?.items ?? []).map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showTeacherFilter ? (
          <Select value={teacherMemberId} onValueChange={(v) => navigate({ professor: v })}>
            <SelectTrigger aria-label="Filtrar por professor" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os professores</SelectItem>
              {(teachersQuery.data?.items ?? []).map((t) => (
                <SelectItem key={t.memberId} value={t.memberId}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={status} onValueChange={(v) => navigate({ situacao: v })}>
          <SelectTrigger aria-label="Filtrar por situação" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as situações</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {SESSION_STATUS[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {sessionsQuery.isPending ? (
        <LoadingBlock rows={5} label="Carregando as sessões" />
      ) : sessionsQuery.error ? (
        <ErrorState
          error={sessionsQuery.error}
          title="Não foi possível carregar as sessões"
          onRetry={() => void sessionsQuery.refetch()}
        />
      ) : sessions.length === 0 ? (
        <EmptyState
          title="Nenhuma aula neste período"
          description={
            classGroupId !== ALL || teacherMemberId !== ALL || status !== ALL
              ? 'Nenhuma sessão atende aos filtros. Limpe-os ou mude o período.'
              : 'As sessões nascem das turmas ativas; cadastre turmas em Aulas → Turmas.'
          }
        />
      ) : (
        <div
          className={
            view === 'semana' ? 'grid gap-4 xl:grid-cols-7 xl:gap-2' : 'grid gap-4 md:max-w-xl'
          }
        >
          {days.map((day) => {
            const items = byDay.get(day) ?? [];
            return (
              <section
                key={day}
                aria-label={formatDayLabel(day)}
                data-testid="sessions-day"
                className="flex flex-col gap-2"
              >
                <h2 className={overline}>
                  {formatDayLabel(day)}
                  {day === todayLocal() ? ' · hoje' : ''}
                </h2>
                {items.length === 0 ? (
                  <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-xs">
                    Sem aulas
                  </p>
                ) : (
                  items.map((s) => <SessionCard key={s.id} session={s} />)
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
