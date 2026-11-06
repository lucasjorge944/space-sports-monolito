'use client';

import { exportSpaceContactsCsv, useListSpaceContacts } from '@space-sports/api-client';
import { keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ConsentBadge,
  ContactFilters,
  type ContactFilterValues,
  ContactIdentity,
  ExportContactsButton,
  OriginList,
  WhatsAppButton,
} from '@/components/contatos/contact-parts';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { Pagination } from '@/components/super/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { canExportContacts, contactFilterParams, contactsCsvFilename } from '@/lib/contacts';
import { formatDate, todayLocal } from '@/lib/format';

const PAGE_SIZE = 20;

/** Contatos que passaram pelo espaço (RF-CONTACT-07, decisão 48): só o que foi informado aqui. */
export function ContatosView() {
  return (
    <SpaceGate permission="contact.view">{(scope) => <SpaceContacts scope={scope} />}</SpaceGate>
  );
}

function SpaceContacts({ scope }: { scope: SpaceScope }) {
  const [filters, setFilters] = useState<ContactFilterValues>({ q: '', consent: '', origin: '' });
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(filters.q.trim());
  const params = contactFilterParams({ ...filters, q });

  const contacts = useListSpaceContacts(
    scope.spaceId,
    { page, pageSize: PAGE_SIZE, ...params },
    { query: { placeholderData: keepPreviousData } },
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Contatos"
        description="Quem passou pelo espaço, com os dados informados aqui. A exportação traz só quem deu consentimento neste espaço e não se descadastrou."
        actions={
          <ExportContactsButton
            filename={contactsCsvFilename(scope.slug, todayLocal())}
            disabled={!canExportContacts(filters.consent)}
            fetchCsv={() => exportSpaceContactsCsv(scope.spaceId, params)}
          />
        }
      />
      <ReadOnlyNotice scope={scope} />
      <ContactFilters
        values={filters}
        onChange={(patch) => {
          setFilters((current) => ({ ...current, ...patch }));
          setPage(1);
        }}
      />

      {contacts.isPending ? (
        <LoadingBlock rows={5} label="Carregando contatos" />
      ) : contacts.isError ? (
        <ErrorState error={contacts.error} onRetry={() => void contacts.refetch()} />
      ) : contacts.data.items.length === 0 ? (
        <EmptyState
          title="Nenhum contato encontrado"
          description="Os contatos chegam pelas reservas de balcão, pelos mensalistas e pelos convites."
        />
      ) : (
        <>
          <div className="rounded-lg border" aria-busy={contacts.isPlaceholderData}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contato</TableHead>
                  <TableHead>Consentimento</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Primeiro contato</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.data.items.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      <ContactIdentity
                        name={contact.name}
                        email={contact.email}
                        phone={contact.phone}
                      />
                    </TableCell>
                    <TableCell>
                      <ConsentBadge
                        marketingConsentAt={contact.marketingConsentAt}
                        unsubscribedAt={contact.unsubscribedAt}
                      />
                    </TableCell>
                    <TableCell>
                      <OriginList origins={contact.origins} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDate(contact.firstTouchAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <WhatsAppButton phone={contact.phone} name={contact.name} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={contacts.data.page}
            pageSize={contacts.data.pageSize}
            total={contacts.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
