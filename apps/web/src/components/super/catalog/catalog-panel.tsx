'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '@/components/auth/form-alert';
import { SubmitButton } from '@/components/auth/submit-button';
import { Field } from '@/components/painel/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MaskedInput } from '@/components/ui/masked-input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fieldErrorsFrom } from '@/lib/super/api-errors';
import { focusFirstInvalid } from '@/lib/utils';
import { describeError, EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';

export type CatalogField = {
  name: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  type?: 'text' | 'number' | 'checkbox';
  hint?: string;
  maxLength?: number;
};

export type CatalogValues = Record<string, string | boolean>;

type CatalogPanelProps<T extends { id: string }> = {
  /** Nome do item no singular, ex.: "esporte". */
  noun: string;
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  items: T[] | undefined;
  fields: CatalogField[];
  columns: { header: string; cell: (item: T) => React.ReactNode }[];
  itemName: (item: T) => string;
  initialValues: (item: T | undefined) => CatalogValues;
  /** Valida e devolve erros por campo (vazio = ok). */
  validate: (values: CatalogValues) => Record<string, string>;
  onSave: (values: CatalogValues, item: T | undefined) => Promise<unknown>;
  onDelete?: (item: T) => Promise<unknown>;
};

/** Lista + diálogo de criar/editar/excluir de um catálogo (RF-SUPER-06). */
export function CatalogPanel<T extends { id: string }>(props: CatalogPanelProps<T>) {
  const { noun, query, items, columns, itemName, onDelete } = props;
  const [editing, setEditing] = useState<{ item: T | undefined }>();
  const [deleting, setDeleting] = useState<T>();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => setEditing({ item: undefined })}>
          <Plus aria-hidden="true" />
          Novo {noun}
        </Button>
      </div>

      {query.isPending ? (
        <LoadingBlock rows={4} />
      ) : query.isError ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : !items || items.length === 0 ? (
        <EmptyBlock>Nenhum item cadastrado.</EmptyBlock>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column.header}>{column.header}</TableHead>
                ))}
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  {columns.map((column) => (
                    <TableCell key={column.header}>{column.cell(item)}</TableCell>
                  ))}
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Editar ${itemName(item)}`}
                        onClick={() => setEditing({ item })}
                      >
                        Editar
                      </Button>
                      {onDelete ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Excluir ${itemName(item)}`}
                          onClick={() => setDeleting(item)}
                        >
                          Excluir
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        <DialogContent>
          {editing ? (
            <CatalogForm
              key={editing.item?.id ?? 'new'}
              {...props}
              item={editing.item}
              onClose={() => setEditing(undefined)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== undefined}
        onOpenChange={(open) => !open && setDeleting(undefined)}
      >
        <DialogContent>
          {deleting && onDelete ? (
            <DeleteConfirm
              noun={noun}
              name={itemName(deleting)}
              onCancel={() => setDeleting(undefined)}
              onConfirm={async () => {
                await onDelete(deleting);
                setDeleting(undefined);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CatalogForm<T extends { id: string }>({
  noun,
  fields,
  item,
  initialValues,
  validate,
  onSave,
  onClose,
}: CatalogPanelProps<T> & { item: T | undefined; onClose: () => void }) {
  const [values, setValues] = useState<CatalogValues>(() => initialValues(item));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return focusFirstInvalid(event.currentTarget);
    setPending(true);
    try {
      await onSave(values, item);
      onClose();
    } catch (thrown) {
      const apiErrors = fieldErrorsFrom(thrown);
      setErrors(apiErrors);
      setFormError(
        Object.keys(apiErrors).length > 0 ? 'Confira os campos destacados.' : describeError(thrown),
      );
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{item ? `Editar ${noun}` : `Novo ${noun}`}</DialogTitle>
        <DialogDescription>Catálogo da plataforma, usado por todos os espaços.</DialogDescription>
      </DialogHeader>
      {fields.map((field) =>
        field.type === 'checkbox' ? (
          <label key={field.name} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={values[field.name] === true}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.checked })}
            />
            {field.label}
          </label>
        ) : (
          <Field
            key={field.name}
            htmlFor={field.name}
            label={field.label}
            optional={field.optional ?? false}
            error={errors[field.name]}
          >
            {field.type === 'number' ? (
              <MaskedInput
                mask="integer"
                name={field.name}
                value={String(values[field.name] ?? '')}
                onValueChange={(value) => setValues({ ...values, [field.name]: value })}
                autoComplete="off"
              />
            ) : (
              <Input
                name={field.name}
                value={String(values[field.name] ?? '')}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                maxLength={field.maxLength}
                placeholder={field.hint}
                autoComplete="off"
              />
            )}
          </Field>
        ),
      )}
      <FormError message={formError} />
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
          Cancelar
        </Button>
        <SubmitButton pending={pending} pendingLabel="Salvando…">
          Salvar
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

function DeleteConfirm({
  noun,
  name,
  onCancel,
  onConfirm,
}: {
  noun: string;
  name: string;
  onCancel: () => void;
  onConfirm: () => Promise<unknown>;
}) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Excluir {noun}</DialogTitle>
        <DialogDescription>
          “{name}” será removido do catálogo. Itens em uso por espaços não podem ser excluídos.
        </DialogDescription>
      </DialogHeader>
      <FormError message={error} />
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(undefined);
            try {
              await onConfirm();
            } catch (thrown) {
              setError(describeError(thrown));
              setPending(false);
            }
          }}
        >
          {pending ? 'Excluindo…' : 'Excluir'}
        </Button>
      </DialogFooter>
    </div>
  );
}
