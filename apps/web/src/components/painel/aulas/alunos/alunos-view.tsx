'use client';

import {
  getListSpaceSubscriptionsQueryKey,
  listSpaceSubscriptions,
  type SubscriptionPageItemsItem,
  useListClassGroups,
  useListPlans,
} from '@space-sports/api-client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Check, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/painel/field';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime, formatLocalDate, formatMoney, todayLocal } from '@/lib/format';
import { SUBSCRIPTION_STATUS } from '@/lib/painel/labels';
import {
  activeEnrollments,
  cancelledAccessLabel,
  canResumeCancel,
  classSlotShort,
  pendingEnrollments,
  SUBSCRIPTION_FILTERS,
} from '@/lib/painel/subscriptions';
import { ApproveDialog, RejectDialog, type ReviewableSubscription } from './approve-dialogs';
import { ResumeCancelDialog } from './cancel-dialogs';
import { SubscriptionSheet } from './subscription-sheet';

const ALL = 'ALL';
const PAGE_SIZE = 50;

export function AlunosView() {
  // O Professor não vê assinaturas nem valores (docs/02): só Dono e Admin.
  return (
    <SpaceGate permission="enrollment.manage">{(scope) => <Alunos scope={scope} />}</SpaceGate>
  );
}

function Alunos({ scope }: { scope: SpaceScope }) {
  const canManage = scope.canWrite('enrollment.manage');
  const [status, setStatus] = useState<string>(ALL);
  const [planId, setPlanId] = useState(ALL);
  const [classGroupId, setClassGroupId] = useState(ALL);
  const [openId, setOpenId] = useState<string | null>(null);
  const [approving, setApproving] = useState<ReviewableSubscription | null>(null);
  const [rejecting, setRejecting] = useState<ReviewableSubscription | null>(null);
  const [resuming, setResuming] = useState<SubscriptionPageItemsItem | null>(null);

  const plans = useListPlans(scope.spaceId);
  const groups = useListClassGroups(scope.spaceId);

  const params = {
    ...(status !== ALL ? { status: [status as SubscriptionPageItemsItem['status']] } : {}),
    ...(planId !== ALL ? { planId } : {}),
    ...(classGroupId !== ALL ? { classGroupId } : {}),
    limit: PAGE_SIZE,
  };
  const query = useInfiniteQuery({
    queryKey: [...getListSpaceSubscriptionsQueryKey(scope.spaceId, params), 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listSpaceSubscriptions(scope.spaceId, {
        ...params,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  // Contador de pedidos para destacar a aba "Aguardando aprovação".
  const pending = useInfiniteQuery({
    queryKey: [
      ...getListSpaceSubscriptionsQueryKey(scope.spaceId, { status: ['PENDING_APPROVAL'] }),
      'count',
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: () =>
      listSpaceSubscriptions(scope.spaceId, { status: ['PENDING_APPROVAL'], limit: 100 }),
    getNextPageParam: () => undefined,
  });
  const pendingCount = pending.data?.pages[0]?.items.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Alunos"
        description="Assinaturas dos planos de aula: aprove pedidos, ajuste as turmas do aluno e acompanhe a presença."
      />
      <ReadOnlyNotice scope={scope} />

      <Tabs value={status} onValueChange={setStatus}>
        <TabsList className="flex-wrap">
          {SUBSCRIPTION_FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
              {f.value === 'PENDING_APPROVAL' && pendingCount > 0 ? ` (${pendingCount})` : ''}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Field label="Plano" htmlFor="alunos-plan">
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger id="alunos-plan" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os planos</SelectItem>
              {(plans.data?.items ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Turma" htmlFor="alunos-group">
          <Select value={classGroupId} onValueChange={setClassGroupId}>
            <SelectTrigger id="alunos-group" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as turmas</SelectItem>
              {(groups.data?.items ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {query.isPending ? (
        <LoadingBlock rows={5} label="Carregando alunos" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={
            status === 'PENDING_APPROVAL'
              ? 'Nenhum pedido aguardando'
              : 'Nenhuma assinatura encontrada'
          }
          description="Os alunos pedem o plano pelo app. Ajuste os filtros para ver outras assinaturas."
        />
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aluno</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Turmas</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Mensalidade</TableHead>
                  <TableHead>Cobrança</TableHead>
                  {canManage ? <TableHead className="w-44" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((s) => (
                  <SubscriptionRow
                    key={s.id}
                    item={s}
                    canManage={canManage}
                    onOpen={() => setOpenId(s.id)}
                    onApprove={() => setApproving(s)}
                    onReject={() => setRejecting(s)}
                    onResumeCancel={() => setResuming(s)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          {query.hasNextPage ? (
            <Button
              variant="outline"
              className="w-fit self-center"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
            </Button>
          ) : null}
        </>
      )}

      <SubscriptionSheet
        scope={scope}
        subscriptionId={openId}
        onClose={() => setOpenId(null)}
        onApprove={setApproving}
        onReject={setRejecting}
      />
      <ApproveDialog scope={scope} subscription={approving} onClose={() => setApproving(null)} />
      <RejectDialog scope={scope} subscription={rejecting} onClose={() => setRejecting(null)} />
      <ResumeCancelDialog scope={scope} target={resuming} onClose={() => setResuming(null)} />
    </div>
  );
}

function SubscriptionRow({
  item,
  canManage,
  onOpen,
  onApprove,
  onReject,
  onResumeCancel,
}: {
  item: SubscriptionPageItemsItem;
  canManage: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onReject: () => void;
  onResumeCancel: () => void;
}) {
  const isPending = item.status === 'PENDING_APPROVAL';
  const groups = isPending ? pendingEnrollments(item) : activeEnrollments(item);
  const cancelledAccess = cancelledAccessLabel(item);

  return (
    <TableRow
      tabIndex={0}
      className="cursor-pointer"
      data-testid="subscription-row"
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <TableCell>
        <div className="font-medium">{item.student.name}</div>
        <div className="text-muted-foreground text-xs">
          Pedido em {formatDateTime(item.createdAt)}
        </div>
      </TableCell>
      <TableCell>
        <div>{item.plan.name}</div>
        <div className="text-muted-foreground text-xs">{item.plan.sport.name}</div>
      </TableCell>
      <TableCell>
        {groups.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <ul className="text-sm">
            {groups.map((e) => (
              <li key={e.id}>
                {e.classGroup.name}{' '}
                <span className="text-muted-foreground tabular-nums">
                  {classSlotShort(e.classGroup)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </TableCell>
      <TableCell>
        <StatusBadge
          info={
            cancelledAccess
              ? { label: 'Cancelado', tone: 'warning' }
              : SUBSCRIPTION_STATUS[item.status]
          }
        />
        {(item.status === 'CANCELLED' || cancelledAccess) && item.accessUntil ? (
          <div className="text-muted-foreground mt-1 text-xs">
            Acesso até {formatLocalDate(item.accessUntil)}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatMoney(item.priceCents)}</TableCell>
      <TableCell>
        {item.overdueCents > 0 ? (
          <span className="text-destructive text-sm tabular-nums">
            {formatMoney(item.overdueCents)} vencidos
          </span>
        ) : item.nextCharge ? (
          <span className="text-sm tabular-nums">{formatLocalDate(item.nextCharge.dueDate)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      {canManage ? (
        <TableCell className="text-right">
          {isPending ? (
            <div className="flex justify-end gap-1">
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove();
                }}
              >
                <Check /> Aprovar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onReject();
                }}
              >
                <X /> Recusar
              </Button>
            </div>
          ) : canResumeCancel(item, todayLocal()) ? (
            <Button
              size="sm"
              variant="outline"
              aria-label="Desfazer cancelamento"
              onClick={(e) => {
                e.stopPropagation();
                onResumeCancel();
              }}
            >
              <RotateCcw /> Desfazer
            </Button>
          ) : null}
        </TableCell>
      ) : null}
    </TableRow>
  );
}
