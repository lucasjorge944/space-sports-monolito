'use client';

import {
  isApiError,
  type SuperAdmin,
  useSuperDemoteAdmin,
  useSuperListAdmins,
  useSuperPromoteAdmin,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormError } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { SubmitButton } from '@/components/auth/submit-button';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { normalizeEmail, validateEmail } from '@/lib/auth/validation';
import { formatDate } from '@/lib/format';
import { invalidateSuper } from '@/lib/super/invalidate';
import { UserStatusBadge } from '../badges';
import { describeError, EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import { ReasonDialog } from '../reason-dialog';

/** Quem tem acesso ao painel Super (RF-SUPER-08). Promover exige conta com e-mail verificado. */
export function SuperAdmins() {
  const queryClient = useQueryClient();
  const admins = useSuperListAdmins();
  const promote = useSuperPromoteAdmin();
  const demote = useSuperDemoteAdmin();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [removing, setRemoving] = useState<SuperAdmin>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(undefined);
    const invalid = validateEmail(email);
    setError(invalid);
    if (invalid) return;
    try {
      const admin = await promote.mutateAsync({ data: { email: normalizeEmail(email) } });
      setNotice(`${admin.name} agora tem acesso ao painel Super.`);
      setEmail('');
      await invalidateSuper(queryClient);
    } catch (thrown) {
      setError(
        isApiError(thrown) && thrown.code === 'USER_IS_INACTIVE'
          ? 'Reative a conta antes de promovê-la.'
          : describeError(thrown),
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} noValidate className="grid max-w-md gap-3">
        <FormField
          name="admin-email"
          label="Promover usuário a Super (e-mail)"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="off"
        />
        <FormError message={error} />
        {notice ? (
          <p role="status" className="text-sm">
            {notice}
          </p>
        ) : null}
        <SubmitButton pending={promote.isPending} pendingLabel="Promovendo…" className="w-fit">
          Promover
        </SubmitButton>
      </form>

      {admins.isPending ? (
        <LoadingBlock rows={3} />
      ) : admins.isError ? (
        <ErrorBlock error={admins.error} onRetry={() => void admins.refetch()} />
      ) : admins.data.items.length === 0 ? (
        <EmptyBlock>Nenhum usuário Super.</EmptyBlock>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Desde</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.data.items.map((admin) => (
                <TableRow key={admin.id}>
                  <TableCell>
                    <span className="font-medium">{admin.name}</span>
                    <span className="text-muted-foreground block text-xs">{admin.email}</span>
                  </TableCell>
                  <TableCell>
                    <UserStatusBadge status={admin.status} />
                  </TableCell>
                  <TableCell>{formatDate(admin.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setRemoving(admin)}>
                      Remover acesso
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ReasonDialog
        open={removing !== undefined}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
        title="Remover acesso Super"
        description={
          removing
            ? `${removing.name} deixa de acessar o painel da plataforma. A conta continua existindo.`
            : undefined
        }
        withReason={false}
        confirmLabel="Remover acesso"
        pendingLabel="Removendo…"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await demote.mutateAsync({ userId: removing.id });
          await invalidateSuper(queryClient);
        }}
      />
    </div>
  );
}
