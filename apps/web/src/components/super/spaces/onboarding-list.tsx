'use client';

import { useSuperGetSpace, useSuperListSpaces } from '@space-sports/api-client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { checklistLabel, checklistMissingText } from '@/lib/super/labels';
import { textLink } from '@/lib/utils';
import { SpaceStatusBadge } from '../badges';
import { PageHeader } from '../page-header';
import { Pagination } from '../pagination';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';

const PAGE_SIZE = 50;
type Filter = 'pending' | 'done' | 'all';

/** Implantações: andamento do checklist de cada espaço (RF-SUPER-02); o detalhe do item fica no espaço. */
export function OnboardingList() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>('pending');
  const spaces = useSuperListSpaces({ page, pageSize: PAGE_SIZE });

  const items = (spaces.data?.items ?? [])
    .filter((space) => {
      const done = space.onboarding.doneCount === space.onboarding.total;
      return filter === 'all' || (filter === 'done' ? done : !done);
    })
    .sort(
      (a, b) =>
        a.onboarding.doneCount / a.onboarding.total - b.onboarding.doneCount / b.onboarding.total,
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Implantações"
        description="Etapas de cada espaço: dados, fotos, quadras, preço e Dono."
      />
      <div className="max-w-xs">
        <Select
          aria-label="Filtrar implantações"
          value={filter}
          onChange={(event) => setFilter(event.target.value as Filter)}
        >
          <option value="pending">Em andamento</option>
          <option value="done">Concluídas</option>
          <option value="all">Todas</option>
        </Select>
      </div>

      {spaces.isPending ? (
        <LoadingBlock />
      ) : spaces.isError ? (
        <ErrorBlock error={spaces.error} onRetry={() => void spaces.refetch()} />
      ) : (
        <>
          {items.length === 0 ? (
            <EmptyBlock>
              {filter === 'pending'
                ? 'Nenhuma implantação em andamento.'
                : 'Nenhum espaço neste filtro.'}
            </EmptyBlock>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Espaço</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>O que falta</TableHead>
                    <TableHead>Vitrine</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((space) => {
                    const { doneCount, total } = space.onboarding;
                    const done = doneCount === total;
                    return (
                      <TableRow key={space.id}>
                        <TableCell className="font-medium">
                          <div className="flex flex-col items-start gap-1">
                            <Link href={`/super/espacos/${space.id}`} className={textLink}>
                              {space.name}
                            </Link>
                            {space.status === 'ACTIVE' ? null : (
                              <SpaceStatusBadge status={space.status} />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <progress
                              className="[&::-moz-progress-bar]:bg-chart-1 [&::-webkit-progress-value]:bg-chart-1 [&::-webkit-progress-bar]:bg-muted h-2 w-24 overflow-hidden rounded-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:rounded-full"
                              value={doneCount}
                              max={total}
                              aria-label={`${space.name}: ${doneCount} de ${total} etapas`}
                            />
                            <span className="text-sm tabular-nums">
                              {doneCount} de {total}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={done ? 'success' : 'warning'}>
                            {done ? 'Concluída' : 'Em andamento'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {done ? (
                            <span className="text-muted-foreground text-sm">Nada</span>
                          ) : (
                            <PendingSteps spaceId={space.id} />
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={space.showcaseVisible ? 'success' : 'outline'}>
                            {space.showcaseVisible ? 'Visível' : 'Fora da vitrine'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <Pagination
            page={spaces.data.page}
            pageSize={spaces.data.pageSize}
            total={spaces.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

/** O que falta nas etapas pendentes. A lista da API só traz a contagem: o detalhe vem do espaço. */
function PendingSteps({ spaceId }: { spaceId: string }) {
  const query = useSuperGetSpace(spaceId);
  if (query.isPending) return <Skeleton className="h-4 w-40" />;
  if (query.isError) return <span className="text-muted-foreground text-sm">Veja no espaço</span>;
  return (
    <ul className="grid gap-0.5 text-sm" data-testid="onboarding-pending">
      {query.data.checklist.items
        .filter((item) => !item.done)
        .map((item) => (
          <li key={item.key}>
            <span className="font-medium">{checklistLabel[item.key]}</span>
            {item.missing.length > 0 ? (
              <span className="text-muted-foreground">: {checklistMissingText(item.missing)}</span>
            ) : null}
          </li>
        ))}
    </ul>
  );
}
