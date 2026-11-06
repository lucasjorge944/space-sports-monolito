import { type ComponentRef, useRef, useState } from 'react';
import { AccessibilityInfo, type TextInput } from 'react-native';

type Validate = (value: string) => string | null;

/**
 * Estado de um campo pela regra do doc 05: valida ao sair e ao enviar, nunca na primeira digitação;
 * depois que o erro aparece, revalida a cada alteração. `format` aplica a máscara. `bind` vai no
 * `Field`.
 */
export function useFormField({
  initial = '',
  validate,
  format,
}: {
  initial?: string;
  validate?: Validate;
  format?: (value: string) => string;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<ComponentRef<typeof TextInput>>(null);

  const check = (current: string) => {
    const message = validate?.(current) ?? null;
    setError(message);
    return message;
  };

  return {
    value,
    error,
    setError,
    setValue,
    check: () => check(value),
    focus: () => ref.current?.focus(),
    bind: {
      ref,
      value,
      error,
      onChangeText: (text: string) => {
        const next = format ? format(text) : text;
        setValue(next);
        if (error) check(next);
      },
      // Campo vazio e intocado não dá erro ao sair: quem só passou por ele vê o aviso ao enviar.
      onBlur: () => {
        if (value !== initial) check(value);
      },
    },
  };
}

type FormField = Pick<ReturnType<typeof useFormField>, 'check' | 'focus'>;

/**
 * Valida tudo ao enviar. Com erro, foca o primeiro campo inválido e anuncia a mensagem
 * (`accessibilityLiveRegion` só funciona no Android).
 */
export function validateFields(fields: FormField[]): boolean {
  let first: { field: FormField; message: string } | null = null;
  for (const field of fields) {
    const message = field.check();
    if (message && !first) first = { field, message };
  }
  if (!first) return true;
  first.field.focus();
  AccessibilityInfo.announceForAccessibility(first.message);
  return false;
}
