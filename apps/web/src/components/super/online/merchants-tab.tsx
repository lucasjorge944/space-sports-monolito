'use client';

import { useSuperListMerchantAccounts } from '@space-sports/api-client';
import type { MerchantAccountStatus } from '@space-sports/shared';
import { keepPreviousData } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { StatusBadge } from '@/components/painel/status-badge';
import { ChipButton } from '@/components/ui/chip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatShortDate } from '@/lib/format';
import { MERCHANT_STATUS } from '@/lib/painel/labels';
import { Pagination } from '../pagination';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';

const FILTERS: { value: MerchantAccountStatus | null; label: string }[] = [
  { value: null, label: 'Todos' },
  { value: 'PENDING', label: 'Em análise' },
  { value: 'REJECTED', label: 'Recusados' },
  { value: 'APPROVED', label: 'Aprovados' },
  { value: 'NOT_STARTED', label: 'Não iniciados' },
];

const PAGE_SIZE = 20;

/** Quantos cadastros há num status (para o número no chip). */
function useCount(status: MerchantAccountStatus | null) {
  const query = useSuperListMerchantAccounts({
    ...(status ? { status } : {}),
    page: 1,
    pageSize: 1,
  });
  return query.data?.total;
}

function FilterChip({
  value,
  label,
  selected,
  onSelect,
}: {
  value: MerchantAccountStatus | null;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const count = useCount(value);
  return (
    <ChipButton selected={selected} onClick={onSelect}>
      {label}
      {count !== undefined ? ` ${count}` : ''}
    </ChipButton>
  );
}

/** Cadastros no gateway por status (RF-ONPAY-10): só leitura, documento mascarado. */
export function MerchantsTab() {
  const [status, setStatus] = useState<MerchantAccountStatus | null>(null);
  const [page, setPage] = useState(1);
  const query = useSuperListMerchantAccounts(
    { ...(status ? { status } : {}), page, pageSize: PAGE_SIZE },
    { query: { placeholderData: keepPreviousData } },
  );

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Filtrar por situação</legend>
        {FILTERS.map((f) => (
          <FilterChip
            key={f.label}
            value={f.value}
            label={f.label}
            selected={status === f.value}
            onSelect={() => {
              setStatus(f.value);
              setPage(1);
            }}
          />
        ))}
      </fieldset>
      {query.isPending ? (
        <LoadingBlock />
      ) : query.isError ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyBlock>Nenhum cadastro com este filtro.</EmptyBlock>
      ) : (
        <>
          <div className="rounded-lg border" aria-busy={query.isPlaceholderData}>
            <Table aria-label="Cadastros no gateway">
              <TableHeader>
                <TableRow>
                  <TableHead>Espaço</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Enviado</TableHead>
                  <TableHead>Decidido</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((m) => {
                  const decided = m.approvedAt ?? m.rejectedAt;
                  return (
                    <TableRow key={m.spaceId} data-testid="merchant-row">
                      <TableCell>
                        <Link
                          href={`/super/espacos/${m.spaceId}`}
                          className="text-link hover:underline"
                        >
                          {m.spaceName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge info={MERCHANT_STATUS[m.status]} />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {m.documentMasked
                          ? `${m.documentType ?? ''} ${m.documentMasked}`.trim()
                          : '—'}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {m.submittedAt ? formatShortDate(m.submittedAt) : '—'}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {decided ? formatShortDate(decided) : '—'}
                      </TableCell>
                      <TableCell
                        className="max-w-56 truncate"
                        title={m.rejectionReason ?? undefined}
                      >
                        {m.rejectionReason ?? '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={query.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

/** Número de cadastros em análise, para o rótulo da aba. */
export function usePendingMerchants(): number | undefined {
  return useCount('PENDING');
}
