'use client';

import { CircleAlert, CircleCheck } from 'lucide-react';
import { type ReactNode, useId, useMemo } from 'react';
import { FieldControlContext } from '@/components/ui/field-control';
import { Label } from '@/components/ui/label';

type FieldProps = {
  label: string;
  /** `id` do controle. Sem ele, o `Field` gera um e entrega ao controle. */
  htmlFor?: string;
  /** Acrescenta "(opcional)" ao rótulo: campos são obrigatórios por padrão. */
  optional?: boolean;
  error?: string | undefined;
  hint?: ReactNode;
  /** Dica só de contexto, que não ajuda a corrigir o erro: sai enquanto ele estiver visível. */
  hideHintOnError?: boolean;
  /** Confirmação assíncrona (ex.: CEP encontrado); nunca para validação comum. */
  confirmation?: string | undefined;
  /** Vários controles sob um rótulo (chips, período): o rótulo e o erro ficam no `role="group"`. */
  group?: boolean;
  children: ReactNode;
};

/**
 * Rótulo + controle + dica + erro (docs/05-design-system.md, "Anatomia de campo"). `Input`, `Textarea`,
 * os selects e os seletores de data recebem `aria-invalid` e `aria-describedby` daqui, pelo contexto.
 */
export function Field({
  label,
  htmlFor,
  optional,
  error,
  hint,
  hideHintOnError,
  confirmation,
  group,
  children,
}: FieldProps) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const confirmationId = `${id}-confirmation`;
  const labelId = `${id}-label`;
  const showHint = Boolean(hint) && !(hideHintOnError && error);
  const describedBy =
    [error && errorId, confirmation && confirmationId, showHint && hintId]
      .filter(Boolean)
      .join(' ') || undefined;

  const control = useMemo(
    () => ({ id: group ? undefined : id, invalid: Boolean(error), describedBy }),
    [group, id, error, describedBy],
  );

  const text = (
    <>
      {label}
      {optional ? <span className="text-muted-foreground font-normal"> (opcional)</span> : null}
    </>
  );

  return (
    <div className="grid content-start gap-1.5">
      {group ? (
        <span id={labelId} className="text-sm leading-none font-medium">
          {text}
        </span>
      ) : (
        <Label htmlFor={id}>{text}</Label>
      )}
      <FieldControlContext.Provider
        value={group ? { ...control, describedBy: undefined } : control}
      >
        {group ? (
          // biome-ignore lint/a11y/useSemanticElements: `fieldset` traz margem e borda próprias, e o rótulo vem do `aria-labelledby`.
          <div
            role="group"
            aria-labelledby={labelId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          >
            {children}
          </div>
        ) : (
          children
        )}
      </FieldControlContext.Provider>
      {showHint || error || confirmation ? (
        <div className="text-helper grid gap-1">
          {showHint ? (
            <p id={hintId} className="text-muted-foreground">
              {hint}
            </p>
          ) : null}
          {confirmation ? (
            <p
              id={confirmationId}
              className="text-success-subtle-foreground flex gap-1.5"
              role="status"
            >
              <CircleCheck className="mt-px size-4 shrink-0" aria-hidden />
              {confirmation}
            </p>
          ) : null}
          {error ? (
            <p id={errorId} className="text-input-error-foreground flex gap-1.5 font-medium">
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
