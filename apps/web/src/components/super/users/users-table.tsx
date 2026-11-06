'use client';

import { type SuperListUsersParams, useSuperListUsers } from '@space-sports/api-client';
import { keepPreviousData } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { formatDate, formatPhone } from '@/lib/format';
import { platformRoleLabel } from '@/lib/super/labels';
import { cn, textLink } from '@/lib/utils';
import { PhoneUnverifiedBadge, UserStatusBadge } from '../badges';
import { Pagination } from '../pagination';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';

const PAGE_SIZE = 20;

export function UsersTable() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(q.trim());

  const params: SuperListUsersParams = {
    page,
    pageSize: PAGE_SIZE,
    ...(search ? { q: search } : {}),
    ...(status ? { status: status as NonNullable<SuperListUsersParams['status']> } : {}),
    ...(role ? { platformRole: role as NonNullable<SuperListUsersParams['platformRole']> } : {}),
  };
  const users = useSuperListUsers(params, { query: { placeholderData: keepPreviousData } });

  return (
    <div className="flex flex-col gap-4">
      <form
        aria-label="Filtros de usuários"
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="relative">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            aria-label="Buscar por nome, e-mail ou telefone"
            placeholder="Nome, e-mail ou telefone"
            className="pl-8"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          aria-label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos os status</option>
          <option value="ACTIVE">Ativos</option>
          <option value="BLOCKED">Bloqueados</option>
          <option value="INACTIVE">Inativas</option>
        </Select>
        <Select
          aria-label="Papel na plataforma"
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos os papéis</option>
          <option value="USER">Usuários</option>
          <option value="SUPER">Super</option>
        </Select>
      </form>

      {users.isPending ? (
        <LoadingBlock />
      ) : users.isError ? (
        <ErrorBlock error={users.error} onRetry={() => void users.refetch()} />
      ) : users.data.items.length === 0 ? (
        <EmptyBlock>Nenhum usuário encontrado.</EmptyBlock>
      ) : (
        <>
          <div className="rounded-lg border" aria-busy={users.isPlaceholderData}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead className="text-right">Espaços</TableHead>
                  <TableHead>Cadastro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.items.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <Link
                        href={`/super/usuarios/${user.id}`}
                        className={cn(textLink, 'font-medium')}
                      >
                        {user.name}
                      </Link>
                      <span className="text-muted-foreground block text-xs">{user.email}</span>
                      {user.phone ? (
                        <span className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
                          {formatPhone(user.phone)}
                          {user.phoneVerified ? null : <PhoneUnverifiedBadge />}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {user.deletedAt ? (
                        <Badge variant="muted">Excluído</Badge>
                      ) : (
                        <UserStatusBadge status={user.status} />
                      )}
                    </TableCell>
                    <TableCell>{platformRoleLabel[user.platformRole]}</TableCell>
                    <TableCell className="text-right tabular-nums">{user.spacesCount}</TableCell>
                    <TableCell>{formatDate(user.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={users.data.page}
            pageSize={users.data.pageSize}
            total={users.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
