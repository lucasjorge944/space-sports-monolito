'use client';

import {
  useSuperListDeletionRequests,
  useSuperListSpaces,
  useSuperListUsers,
  useSuperSpaceMetrics,
} from '@space-sports/api-client';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatLocalDate } from '@/lib/format';
import { textLink } from '@/lib/utils';
import { SpaceStatusBadge } from './badges';
import { PageHeader } from './page-header';
import { EmptyBlock, ErrorBlock, LoadingBlock } from './query-states';
import { StatCard } from './stat-card';

const METRICS_PAGE_SIZE = 100;

function Count({
  value,
  isPending,
  isError,
}: {
  value?: number;
  isPending: boolean;
  isError: boolean;
}) {
  if (isPending) return '…';
  if (isError || value === undefined) return '—';
  return value;
}

/** Visão geral da plataforma (RF-SUPER-09): espaços, usuários e reservas do período. */
export function Dashboard() {
  const allSpaces = useSuperListSpaces({ pageSize: 1 });
  const activeSpaces = useSuperListSpaces({ pageSize: 1, status: 'ACTIVE' });
  const allUsers = useSuperListUsers({ pageSize: 1 });
  const blockedUsers = useSuperListUsers({ pageSize: 1, status: 'BLOCKED' });
  const deletions = useSuperListDeletionRequests({ pageSize: 1, status: 'PENDING' });
  const metrics = useSuperSpaceMetrics({ pageSize: METRICS_PAGE_SIZE });

  const bookings = metrics.data?.items.reduce((sum, item) => sum + item.bookings, 0);
  const truncated = metrics.data ? metrics.data.total > metrics.data.items.length : false;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description="Visão geral da plataforma." />

      <section aria-label="Resumo" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Espaços"
          value={<Count value={allSpaces.data?.total} {...allSpaces} />}
          hint={activeSpaces.data ? `${activeSpaces.data.total} ativos` : undefined}
        />
        <StatCard
          label="Usuários"
          value={<Count value={allUsers.data?.total} {...allUsers} />}
          hint={blockedUsers.data ? `${blockedUsers.data.total} bloqueados` : undefined}
        />
        <StatCard
          label="Reservas no período"
          value={<Count value={bookings} {...metrics} />}
          hint={
            metrics.data
              ? `${formatLocalDate(metrics.data.period.from)} a ${formatLocalDate(metrics.data.period.to)}${truncated ? ` · primeiros ${METRICS_PAGE_SIZE} espaços` : ''}`
              : undefined
          }
        />
        <StatCard
          label="Pedidos de exclusão (LGPD)"
          value={<Count value={deletions.data?.total} {...deletions} />}
          hint={
            deletions.data && deletions.data.total > 0 ? (
              <Link href="/super/usuarios?aba=lgpd" className={textLink}>
                Atender pendentes
              </Link>
            ) : (
              'Nenhum pendente'
            )
          }
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Uso por espaço</CardTitle>
          <CardDescription>
            Reservas, mensalistas e último acesso no período
            {metrics.data
              ? ` (${formatLocalDate(metrics.data.period.from)} a ${formatLocalDate(metrics.data.period.to)})`
              : ''}
            . Alunos, presenças e torneios entram com a Fase 2.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {metrics.isPending ? (
            <LoadingBlock rows={3} />
          ) : metrics.isError ? (
            <ErrorBlock error={metrics.error} onRetry={() => void metrics.refetch()} />
          ) : metrics.data.items.length === 0 ? (
            <EmptyBlock>Nenhum espaço cadastrado ainda.</EmptyBlock>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Espaço</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Reservas</TableHead>
                  <TableHead className="text-right">Mensalistas ativos</TableHead>
                  <TableHead>Último acesso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.data.items.map((item) => (
                  <TableRow key={item.spaceId}>
                    <TableCell className="font-medium">
                      <Link href={`/super/espacos/${item.spaceId}`} className={textLink}>
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <SpaceStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.bookings}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.activeRecurring}
                    </TableCell>
                    <TableCell>{formatDateTime(item.lastAccessAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
