'use client';

import { type CepAddress, isApiError, useLookupCep } from '@space-sports/api-client';
import { normalizeCep } from '@space-sports/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MaskedInput } from '@/components/ui/masked-input';
import { Field } from './field';

type CepFieldProps = {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Preenche o formulário com o endereço; o que devolver vira aviso abaixo do campo. */
  onFound: (address: CepAddress) => string | undefined;
  error?: string | undefined;
  disabled?: boolean;
};

/**
 * CEP que busca o endereço na API ao completar 8 dígitos (decisão 52). Falha nunca trava o formulário:
 * vira um aviso discreto e o endereço segue editável à mão.
 */
export function CepField({ id, value, onValueChange, onFound, error, disabled }: CepFieldProps) {
  // Só busca o que foi digitado agora: abrir um espaço com CEP salvo não reescreve o endereço dele.
  const [typed, setTyped] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();
  const filled = useRef<string | null>(null);
  const lookup = useLookupCep(typed ?? '', { query: { enabled: typed !== null, retry: false } });
  const address = typed !== null ? lookup.data : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: preenche uma vez por CEP, não a cada render do formulário
  useEffect(() => {
    if (!address || filled.current === address.postalCode) return;
    filled.current = address.postalCode;
    setNotice(onFound(address));
  }, [address]);

  function change(text: string) {
    const cep = normalizeCep(text);
    if (cep !== typed) {
      filled.current = null;
      setNotice(undefined);
    }
    setTyped(cep);
    onValueChange(text);
  }

  const searching = typed !== null && lookup.isFetching;
  const failed = typed !== null && lookup.isError;
  const hint = failed ? failureMessage(lookup.error) : notice;

  return (
    <Field
      label="CEP"
      htmlFor={id}
      error={error}
      hint={hint}
      confirmation={address && !notice ? 'Endereço preenchido pelo CEP' : undefined}
    >
      <div className="relative">
        <MaskedInput
          mask="cep"
          value={value}
          onValueChange={change}
          disabled={disabled ?? false}
          aria-busy={searching || undefined}
          className="pr-9"
        />
        {searching ? (
          <Loader2
            aria-hidden
            className="text-muted-foreground absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin"
          />
        ) : null}
      </div>
    </Field>
  );
}

function failureMessage(error: unknown): string {
  return isApiError(error) && error.code === 'CEP_NOT_FOUND'
    ? 'CEP não encontrado. Preencha à mão'
    : 'Não foi possível buscar o CEP. Preencha à mão';
}
