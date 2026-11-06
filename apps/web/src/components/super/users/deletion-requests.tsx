'use client';

import {
  type DeletionRequest,
  type DeletionRequestStatus,
  useSuperCancelDeletionRequest,
  useSuperFulfillDeletionRequest,
  useSuperListDeletionRequests,
  useSuperRejectDeletionRequest,
} from '@space-sports/api-client';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatDateTime } from '@/lib/format';
import { pendingLines } from '@/lib/super/deletion';
import { invalidateSuper } from '@/lib/super/invalidate';
import { deletionSourceLabel, deletionStatusLabel } from '@/lib/super/labels';
import { cn, textLink } from '@/lib/utils';
import { Pagination } from '../pagination';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import { ReasonDialog } from '../reason-dialog';

const PAGE_SIZE = 20;
type Resolution = { request: DeletionRequest; kind: 'fulfill' | 'reject' | 'cancel' };

const DIALOG = {
  fulfill: {
    title: 'Atender exclusão de conta',
    reasonLabel: 'Nota',
    confirmLabel: 'Atender e anonimizar',
  },
  reject: {
    title: 'Recusar exclusão de conta',
    reasonLabel: 'Motivo da recusa',
    confirmLabel: 'Recusar pedido',
  },
  cancel: {
    title: 'Cancelar pedido de exclusão',
    reasonLabel: 'Nota',
    confirmLabel: 'Cancelar pedido e reativar',
  },
} as const;

function resolutionDescription({ request, kind }: Resolution): string {
  if (kind === 'fulfill')
    return `A conta de ${request.userName} será anonimizada agora, na mesma operação: as reservas futuras são canceladas (a quadra é liberada), os mensalistas e as assinaturas de aula são encerrados e o titular sai das aulas que ainda não começaram (a lista de espera é promovida). Pagamentos e mensalidades já devidas ficam no histórico dos espaços, sem os dados pessoais. A gestão dos espaços afetados é avisada. Não dá para desfazer.`;
  if (kind === 'reject')
    return `Só por fraude ou exigência legal. A conta de ${request.userName} continua inativa e o titular recebe a justificativa por e-mail.`;
  return `${request.userName} desistiu da exclusão. O pedido é encerrado e a conta inativada volta a ficar ativa (uma conta bloqueada continua bloqueada). Nada é cancelado ou anonimizado.`;
}

/**
 * Pedidos de exclusão de conta (LGPD, decisão 40): atender anonimiza a conta; recusar exige
 * justificativa; cancelar é a desistência do titular e reativa a conta (RF-SUPER-07).
 */
export function DeletionRequests() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<DeletionRequestStatus | ''>('PENDING');
  const [page, setPage] = useState(1);
  const [resolution, setResolution] = useState<Resolution>();
  const requests = useSuperListDeletionRequests(
    { page, pageSize: PAGE_SIZE, ...(status ? { status } : {}) },
    { query: { placeholderData: keepPreviousData } },
  );
  const fulfill = useSuperFulfillDeletionRequest();
  const reject = useSuperRejectDeletionRequest();
  const cancel = useSuperCancelDeletionRequest();

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xs">
        <Select
          aria-label="Status do pedido"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as typeof status);
            setPage(1);
          }}
        >
          <option value="PENDING">Pendentes</option>
          <option value="COMPLETED">Atendidos</option>
          <option value="REJECTED">Recusados</option>
          <option value="CANCELLED">Cancelados</option>
          <option value="">Todos</option>
        </Select>
      </div>

      {requests.isPending ? (
        <LoadingBlock rows={3} />
      ) : requests.isError ? (
        <ErrorBlock error={requests.error} onRetry={() => void requests.refetch()} />
      ) : requests.data.items.length === 0 ? (
        <EmptyBlock>Nenhum pedido de exclusão neste filtro.</EmptyBlock>
      ) : (
        <>
          <div className="rounded-lg border" aria-busy={requests.isPlaceholderData}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Pedido em</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Pendências da conta</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.data.items.map((request) => (
                  <TableRow key={request.id} data-testid="deletion-row">
                    <TableCell className="whitespace-nowrap">
                      <Link
                        href={`/super/usuarios/${request.userId}`}
                        className={cn(textLink, 'font-medium')}
                      >
                        {request.userName}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {deletionSourceLabel[request.source]}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(request.requestedAt)}
                    </TableCell>
                    <TableCell>
                      {request.status === 'PENDING' ? (
                        <>
                          {formatDate(request.dueAt)}
                          {request.overdue ? (
                            <Badge variant="destructive" className="mt-1 block w-fit">
                              Vencido
                            </Badge>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="max-w-72 text-xs whitespace-normal">
                      <Pending request={request} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={request.status === 'PENDING' ? 'warning' : 'info'}>
                        {deletionStatusLabel[request.status]}
                      </Badge>
                      {request.resolvedAt ? (
                        <span className="text-muted-foreground block text-xs">
                          {formatDateTime(request.resolvedAt)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-64 truncate" title={request.note ?? undefined}>
                      {request.note ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {request.status === 'PENDING' ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setResolution({ request, kind: 'fulfill' })}
                          >
                            Atender
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setResolution({ request, kind: 'reject' })}
                          >
                            Recusar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setResolution({ request, kind: 'cancel' })}
                          >
                            Cancelar pedido
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={requests.data.page}
            pageSize={requests.data.pageSize}
            total={requests.data.total}
            onPageChange={setPage}
          />
        </>
      )}

      <ReasonDialog
        open={resolution !== undefined}
        onOpenChange={(open) => {
          if (!open) setResolution(undefined);
        }}
        title={resolution ? DIALOG[resolution.kind].title : ''}
        description={resolution ? resolutionDescription(resolution) : undefined}
        reasonLabel={resolution ? DIALOG[resolution.kind].reasonLabel : 'Nota'}
        required={resolution?.kind === 'reject'}
        confirmLabel={resolution ? DIALOG[resolution.kind].confirmLabel : ''}
        pendingLabel="Salvando…"
        destructive={resolution?.kind === 'fulfill'}
        onConfirm={async (note) => {
          if (!resolution) return;
          const requestId = resolution.request.id;
          if (resolution.kind === 'fulfill') {
            await fulfill.mutateAsync({ requestId, data: note ? { note } : {} });
          } else if (resolution.kind === 'cancel') {
            await cancel.mutateAsync({ requestId, data: note ? { note } : {} });
          } else {
            await reject.mutateAsync({ requestId, data: { note: note ?? '' } });
          }
          await invalidateSuper(queryClient);
        }}
      />
    </div>
  );
}

/** Pendências por espaço (só dos pedidos em aberto): a equipe avalia, mas elas não impedem a exclusão. */
function Pending({ request }: { request: DeletionRequest }) {
  if (request.status !== 'PENDING') return <>—</>;
  const lines = pendingLines(request.pending);
  if (lines.length === 0) return <span className="text-muted-foreground">Nenhuma pendência.</span>;
  return (
    <ul className="grid gap-1">
      {lines.map((line) => (
        <li key={line.spaceId}>
          <span className="font-medium">{line.spaceName}:</span> {line.text}
        </li>
      ))}
    </ul>
  );
}
