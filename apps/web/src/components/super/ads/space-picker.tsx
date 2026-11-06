'use client';

import { useSuperListSpaces } from '@space-sports/api-client';
import { keepPreviousData } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { Field } from '@/components/painel/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

type SpacePickerProps = {
  label: string;
  value: string;
  onChange: (spaceId: string, space: { id: string; name: string } | null) => void;
  /** Nome do espaço já escolhido (mantém a opção mesmo fora do resultado da busca). */
  selectedName?: string | undefined;
  error?: string | undefined;
  hint?: ReactNode;
  disabled?: boolean;
};

/**
 * Escolha de um espaço ativo da plataforma: busca por nome (`GET /v1/super/spaces?status=ACTIVE`) e a
 * lista de resultados num `<select>` nativo. Só espaços ativos, como a API exige (RN-ADS-05).
 */
export function SpacePicker({
  label,
  value,
  onChange,
  selectedName,
  error,
  hint,
  disabled,
}: SpacePickerProps) {
  const id = useId();
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim());
  const spaces = useSuperListSpaces(
    { status: 'ACTIVE', pageSize: 50, ...(search ? { q: search } : {}) },
    { query: { placeholderData: keepPreviousData } },
  );
  const items = spaces.data?.items ?? [];
  const missingSelected = value && !items.some((space) => space.id === value);

  return (
    <div className="grid gap-2">
      <Field label={label} htmlFor={`${id}-select`} error={error} hint={hint}>
        <Select
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const space = items.find((item) => item.id === event.target.value);
            onChange(event.target.value, space ? { id: space.id, name: space.name } : null);
          }}
        >
          <option value="">
            {spaces.isPending
              ? 'Carregando espaços…'
              : spaces.isError
                ? 'Não foi possível carregar os espaços'
                : items.length === 0
                  ? 'Nenhum espaço ativo encontrado'
                  : 'Escolha o espaço'}
          </option>
          {missingSelected ? (
            <option value={value}>{selectedName ?? 'Espaço escolhido'}</option>
          ) : null}
          {items.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name} · {space.city.name}
            </option>
          ))}
        </Select>
      </Field>
      {disabled ? null : (
        <div className="relative">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <Input
            id={`${id}-search`}
            type="search"
            aria-label="Buscar espaço pelo nome"
            placeholder="Buscar espaço pelo nome"
            className="pl-8"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
      )}
    </div>
  );
}
