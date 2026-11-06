'use client';

import { createContext, useContext } from 'react';

/** O que o `Field` liga ao controle dentro dele: id, erro e dica/mensagem. */
export type FieldControl = {
  id: string | undefined;
  invalid: boolean;
  describedBy: string | undefined;
};

export const FieldControlContext = createContext<FieldControl | null>(null);

type AriaProps = {
  id?: string | undefined;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  'aria-describedby'?: string | undefined;
};

/**
 * Atributos que o controle herda do `Field` ao redor. O que o próprio controle passar prevalece; fora
 * de um `Field` nada muda.
 */
export function useFieldControl(props: AriaProps): Required<AriaProps> {
  const field = useContext(FieldControlContext);
  return {
    id: props.id ?? field?.id,
    'aria-invalid': props['aria-invalid'] ?? (field?.invalid ? true : undefined),
    'aria-describedby': props['aria-describedby'] ?? field?.describedBy,
  } as Required<AriaProps>;
}
