'use client';

import { type SuperListAuditLogsParams, useSuperListAuditLogs } from '@space-sports/api-client';
import { keepPreviousData } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '@/components/auth/form-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-picker';
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
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '../page-header';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';

const LIMIT = 50;

/** Log de auditoria global, com paginação por cursor (RF-SUPER-10, RN-SUPER-01). */
export function AuditLog() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [mode, setMode] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Pilha de cursores: o último é o da página atual (vazia = primeira página).
  const [cursors, setCursors] = useState<string[]>([]);
  const debouncedAction = useDebouncedValue(action.trim());
  const debouncedEntity = useDebouncedValue(entity.trim());

  const validRange = !from || !to || from <= to;
  const cursor = cursors.at(-1);
  const params: SuperListAuditLogsParams = {
    limit: LIMIT,
    ...(cursor ? { cursor } : {}),
    ...(debouncedAction ? { action: debouncedAction } : {}),
    ...(debouncedEntity ? { entity: debouncedEntity } : {}),
    ...(mode ? { actingAsSuper: mode as 'true' | 'false' } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const logs = useSuperListAuditLogs(params, {
    query: { enabled: validRange, placeholderData: keepPreviousData },
  });

  const filter =
    (set: (value: string) => void) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      set(event.target.value);
      setCursors([]);
    };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Auditoria"
        description="Ações sensíveis em toda a plataforma, incluindo tudo o que é feito em modo suporte."
      />
      <form
        aria-label="Filtros da auditoria"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(event) => event.preventDefault()}
      >
        <Input
          aria-label="Ação (prefixo)"
          placeholder="Ação, ex.: support."
          value={action}
          onChange={filter(setAction)}
        />
        <Input
          aria-label="Entidade"
          placeholder="Entidade"
          value={entity}
          onChange={filter(setEntity)}
        />
        <Select aria-label="Origem" value={mode} onChange={filter(setMode)}>
          <option value="">Todas as origens</option>
          <option value="true">Só modo suporte</option>
          <option value="false">Sem modo suporte</option>
        </Select>
        <DateRangePicker
          className="sm:col-span-2"
          from={from}
          to={to}
          onValueChange={(next) => {
            setFrom(next.from);
            setTo(next.to);
            setCursors([]);
          }}
        />
      </form>
      <FormError
        message={!validRange ? 'A data inicial não pode ser depois da final.' : undefined}
      />

      {!validRange ? null : logs.isPending ? (
        <LoadingBlock />
      ) : logs.isError ? (
        <ErrorBlock error={logs.error} onRetry={() => void logs.refetch()} />
      ) : logs.data.items.length === 0 ? (
        <EmptyBlock>Nenhum registro encontrado.</EmptyBlock>
      ) : (
        <>
          <div className="rounded-lg border" aria-busy={logs.isPlaceholderData}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Quem</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Espaço</TableHead>
                  <TableHead>Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.data.items.map((entry) => (
                  <TableRow key={entry.id} className="align-top">
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell>
                      {entry.actorName ?? 'Sistema'}
                      {entry.actingAsSuper ? (
                        <Badge variant="outline" className="ml-2">
                          Suporte
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{entry.action}</code>
                      <span className="text-muted-foreground block text-xs">{entry.entity}</span>
                    </TableCell>
                    <TableCell>{entry.spaceName ?? '—'}</TableCell>
                    <TableCell>
                      <details>
                        <summary className="text-link hover:text-link-hover cursor-pointer text-sm">
                          Ver
                        </summary>
                        <pre className="bg-muted mt-2 max-w-md overflow-x-auto rounded-md p-2 text-xs">
                          {JSON.stringify(entry.diff, null, 2)}
                        </pre>
                      </details>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <nav aria-label="Paginação" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Página {cursors.length + 1}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={cursors.length === 0}
                onClick={() => setCursors((current) => current.slice(0, -1))}
              >
                <ChevronLeft aria-hidden="true" />
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!logs.data.nextCursor}
                onClick={() => {
                  const next = logs.data.nextCursor;
                  if (next) setCursors((current) => [...current, next]);
                }}
              >
                Próxima
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
