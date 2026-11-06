'use client';

import {
  isApiError,
  useSuperBlockUser,
  useSuperCreateDeletionRequest,
  useSuperGetUser,
  useSuperUnblockUser,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { FormError } from '@/components/auth/form-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatPhone } from '@/lib/format';
import { invalidateSuper } from '@/lib/super/invalidate';
import { memberRoleLabel, memberStatusLabel, platformRoleLabel } from '@/lib/super/labels';
import { cn, textLink } from '@/lib/utils';
import { PhoneUnverifiedBadge, SpaceStatusBadge, UserStatusBadge } from '../badges';
import { PageHeader } from '../page-header';
import { describeError, EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import { ReasonDialog } from '../reason-dialog';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm">{children || '—'}</dd>
    </div>
  );
}

type Dialog = 'block' | 'deletion';

export function UserDetail({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const query = useSuperGetUser(userId);
  const block = useSuperBlockUser();
  const unblock = useSuperUnblockUser();
  const requestDeletion = useSuperCreateDeletionRequest();
  const [dialog, setDialog] = useState<Dialog>();
  const [actionError, setActionError] = useState<string>();
  const back = { href: '/super/usuarios', label: 'Usuários' };

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Usuário" back={back} />
        <LoadingBlock />
      </div>
    );
  }
  if (query.isError) {
    const notFound = isApiError(query.error) && query.error.status === 404;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Usuário" back={back} />
        {notFound ? (
          <EmptyBlock>Usuário não encontrado.</EmptyBlock>
        ) : (
          <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }

  const user = query.data;
  const deleted = Boolean(user.deletedAt);
  const unblockLabel =
    user.status === 'INACTIVE'
      ? { idle: 'Reativar conta', pending: 'Reativando' }
      : { idle: 'Desbloquear', pending: 'Desbloqueando' };

  async function onUnblock() {
    setActionError(undefined);
    try {
      await unblock.mutateAsync({ userId });
      await invalidateSuper(queryClient);
    } catch (thrown) {
      setActionError(describeError(thrown));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {user.name}
            {deleted ? (
              <Badge variant="muted">Excluído</Badge>
            ) : (
              <UserStatusBadge status={user.status} />
            )}
          </span>
        }
        description={user.email}
        actions={
          deleted ? null : (
            <>
              {user.status !== 'BLOCKED' ? (
                <Button variant="outline" onClick={() => setDialog('block')}>
                  Bloquear
                </Button>
              ) : null}
              {user.status !== 'ACTIVE' ? (
                <Button onClick={onUnblock} disabled={unblock.isPending}>
                  {unblock.isPending ? `${unblockLabel.pending}…` : unblockLabel.idle}
                </Button>
              ) : null}
              {user.pendingDeletionRequestId ? null : (
                <Button variant="outline" onClick={() => setDialog('deletion')}>
                  Abrir pedido de exclusão
                </Button>
              )}
            </>
          )
        }
      />

      <FormError message={actionError} />
      {user.status === 'INACTIVE' && !deleted ? (
        <p role="status" className="bg-card rounded-lg border p-3 text-sm">
          O titular inativou a conta pelo app. Reservas, mensalistas e pagamentos continuam como
          estavam. Use "Reativar conta" para devolver o acesso.
        </p>
      ) : null}
      {user.pendingDeletionRequestId ? (
        <p role="status" className="bg-card rounded-lg border p-3 text-sm">
          Há um pedido de exclusão pendente.{' '}
          <Link href="/super/usuarios?aba=lgpd" className={textLink}>
            Atender na aba LGPD
          </Link>
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conta</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3">
              <Row label="E-mail">{user.email}</Row>
              <Row label="Telefone">
                {user.phone ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {formatPhone(user.phone)}
                    {user.phoneVerified ? null : <PhoneUnverifiedBadge />}
                  </span>
                ) : null}
              </Row>
              <Row label="Papel">{platformRoleLabel[user.platformRole]}</Row>
              <Row label="Sessões ativas">{String(user.activeSessions)}</Row>
              <Row label="Cadastro">{formatDateTime(user.createdAt)}</Row>
              {user.deletedAt ? (
                <Row label="Excluído em">{formatDateTime(user.deletedAt)}</Row>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vínculos com espaços</CardTitle>
            <CardDescription>Papéis do usuário em cada espaço.</CardDescription>
          </CardHeader>
          <CardContent>
            {user.memberships.length === 0 ? (
              <EmptyBlock>Sem vínculo com espaços.</EmptyBlock>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Espaço</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Vínculo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {user.memberships.map((m) => (
                    <TableRow key={`${m.spaceId}-${m.role}`}>
                      <TableCell>
                        <Link
                          href={`/super/espacos/${m.spaceId}`}
                          className={cn(textLink, 'font-medium')}
                        >
                          {m.spaceName}
                        </Link>{' '}
                        <SpaceStatusBadge status={m.spaceStatus} />
                      </TableCell>
                      <TableCell>{memberRoleLabel[m.role]}</TableCell>
                      <TableCell>{memberStatusLabel[m.status]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <ReasonDialog
        open={dialog === 'block'}
        onOpenChange={(open) => !open && setDialog(undefined)}
        title="Bloquear usuário"
        description={`${user.name} perde o acesso e todas as sessões abertas são encerradas na hora.`}
        confirmLabel="Bloquear"
        pendingLabel="Bloqueando…"
        destructive
        onConfirm={async (reason) => {
          await block.mutateAsync({ userId, data: reason ? { reason } : {} });
          await invalidateSuper(queryClient);
        }}
      />
      <ReasonDialog
        open={dialog === 'deletion'}
        onOpenChange={(open) => !open && setDialog(undefined)}
        title="Abrir pedido de exclusão (LGPD)"
        description="Registra o pedido; a conta só é anonimizada quando você atender na aba LGPD."
        reasonLabel="Nota"
        confirmLabel="Abrir pedido"
        pendingLabel="Abrindo…"
        onConfirm={async (note) => {
          await requestDeletion.mutateAsync({ userId, data: note ? { note } : {} });
          await invalidateSuper(queryClient);
        }}
      />
    </div>
  );
}
