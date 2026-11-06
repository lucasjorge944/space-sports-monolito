'use client';

import {
  getSuperListContactsQueryKey,
  type SuperContactPage,
  superExportContactsCsv,
  useSuperDeleteContact,
  useSuperListContacts,
  useSuperListSpaces,
} from '@space-sports/api-client';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { Eye, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ConsentBadge,
  ContactFilters,
  type ContactFilterValues,
  ContactIdentity,
  ExportContactsButton,
  OriginList,
  WhatsAppButton,
} from '@/components/contatos/contact-parts';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
import { textLink } from '@/lib/utils';
import { PageHeader } from '../page-header';
import { Pagination } from '../pagination';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';

const PAGE_SIZE = 20;

type SuperContact = SuperContactPage['items'][number];

/** Base inteira de contatos (RF-CONTACT-06/08): dados globais e o que veio de cada espaço. */
export function ContactsView() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ContactFilterValues>({ q: '', consent: '', origin: '' });
  const [hasAccount, setHasAccount] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<SuperContact | null>(null);
  const [deleting, setDeleting] = useState<SuperContact | null>(null);
  const q = useDebouncedValue(filters.q.trim());

  const params = {
    ...contactFilterParams({ ...filters, q }),
    ...(hasAccount ? { hasAccount } : {}),
    ...(spaceId ? { spaceId } : {}),
  };
  const contacts = useSuperListContacts(
    { page, pageSize: PAGE_SIZE, ...params },
    { query: { placeholderData: keepPreviousData } },
  );
  const spaces = useSuperListSpaces({ pageSize: 100 });
  const remove = useSuperDeleteContact();

  function confirmDelete() {
    if (!deleting) return;
    remove.mutate(
      { contactId: deleting.id },
      {
        onSuccess: () => {
          setDeleting(null);
          toast.success('Contato apagado.');
          // Apagar o último item da página não pode deixar a lista numa página vazia.
          if (contacts.data?.items.length === 1 && page > 1) setPage(page - 1);
          void queryClient.invalidateQueries({ queryKey: getSuperListContactsQueryKey() });
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Contatos"
        description="Base inteira da plataforma. A exportação traz só quem deu consentimento e não se descadastrou."
        actions={
          <ExportContactsButton
            filename={contactsCsvFilename('plataforma', todayLocal())}
            disabled={!canExportContacts(filters.consent)}
            fetchCsv={() => superExportContactsCsv(params)}
          />
        }
      />

      <ContactFilters
        values={filters}
        onChange={(patch) => {
          setFilters((current) => ({ ...current, ...patch }));
          setPage(1);
        }}
      >
        <Select
          aria-label="Conta"
          value={hasAccount}
          onChange={(event) => {
            setHasAccount(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Com ou sem conta</option>
          <option value="true">Com conta</option>
          <option value="false">Sem conta</option>
        </Select>
        <Select
          aria-label="Espaço"
          value={spaceId}
          onChange={(event) => {
            setSpaceId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos os espaços</option>
          {spaces.data?.items.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </Select>
      </ContactFilters>

      {contacts.isPending ? (
        <LoadingBlock />
      ) : contacts.isError ? (
        <ErrorBlock error={contacts.error} onRetry={() => void contacts.refetch()} />
      ) : contacts.data.items.length === 0 ? (
        <EmptyBlock>Nenhum contato encontrado.</EmptyBlock>
      ) : (
        <>
          <div className="rounded-lg border" aria-busy={contacts.isPlaceholderData}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contato</TableHead>
                  <TableHead>Consentimento</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Espaços</TableHead>
                  <TableHead>Cadastro</TableHead>
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
                      {contact.userId ? (
                        <Link href={`/super/usuarios/${contact.userId}`} className={textLink}>
                          Ver conta
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Sem conta</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {contact.spaces.map((space) => space.spaceName).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatDate(contact.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <WhatsAppButton phone={contact.phone} name={contact.name} />
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Ver detalhes de ${contact.name ?? 'contato sem nome'}`}
                          onClick={() => setViewing(contact)}
                        >
                          <Eye aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Apagar ${contact.name ?? 'contato sem nome'}`}
                          onClick={() => {
                            remove.reset();
                            setDeleting(contact);
                          }}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
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

      <ContactDetailSheet contact={viewing} onClose={() => setViewing(null)} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Apagar contato"
        description={`Apaga ${deleting?.name ?? 'este contato'}, o que foi informado em cada espaço e o nome digitado nos convites. As reservas ficam no histórico, sem o vínculo. Não dá para desfazer.`}
        confirmLabel="Apagar contato"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/** O que foi informado em cada espaço pode diferir dos dados globais (RN-CONTACT-02). */
function ContactDetailSheet({
  contact,
  onClose,
}: {
  contact: SuperContact | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={contact !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{contact?.name ?? 'Contato sem nome'}</SheetTitle>
          <SheetDescription>O que foi informado em cada espaço.</SheetDescription>
        </SheetHeader>
        <ul className="flex flex-col gap-3 px-4 pb-6">
          {contact?.spaces.map((space) => (
            <li key={space.spaceId} className="grid gap-2 rounded-lg border p-3 text-sm">
              <p className="font-semibold">{space.spaceName}</p>
              <div>
                <ContactIdentity name={space.name} email={space.email} phone={space.phone} />
              </div>
              <ConsentBadge marketingConsentAt={space.marketingConsentAt} />
              <OriginList origins={space.origins} />
              <p className="text-muted-foreground text-xs tabular-nums">
                De {formatDate(space.firstTouchAt)} a {formatDate(space.lastTouchAt)}
              </p>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
