'use client';

import { Field } from '@/components/painel/field';
import { MaskedInput } from '@/components/ui/masked-input';
import { cn } from '@/lib/utils';

/**
 * Telefone obrigatório da conta (decisão 64), com a máscara `(31) 99999-8888`. O valor é o texto
 * mascarado; quem envia converte para E.164 (`phoneToE164`). Não é verificado por SMS.
 */
export function PhoneField({
  id = 'phone',
  value,
  onValueChange,
  error,
  hint,
  large,
  disabled,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  error?: string | undefined;
  hint?: React.ReactNode;
  /** 48 px, para as telas públicas (cadastro, completar cadastro). */
  large?: boolean;
  disabled?: boolean;
}) {
  return (
    <Field label="Telefone" htmlFor={id} error={error} hint={hint}>
      <MaskedInput
        mask="phone"
        id={id}
        name="phone"
        autoComplete="tel-national"
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        className={cn(large && 'h-12 text-base md:text-base')}
      />
    </Field>
  );
}
