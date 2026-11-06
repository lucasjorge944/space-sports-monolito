import { useState } from 'react';
import { TextInput } from 'react-native';
import { cn } from '@/lib/utils';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

type InputProps = React.ComponentProps<typeof TextInput> & { invalid?: boolean };

/** Classes de borda, fundo e texto por estado (doc 05, "Anatomia de campo"). O erro vence o foco. */
function inputStateClasses(state: { invalid?: boolean; focused: boolean; disabled: boolean }) {
  if (state.disabled) return 'border-disabled bg-input-disabled text-disabled-foreground';
  if (state.invalid) return 'border-input-error bg-input-error-background text-foreground';
  if (state.focused) return 'border-input-focus bg-input-focus-background text-foreground';
  return 'border-input bg-input-background text-foreground';
}

/**
 * Campo da prancha 06/07: 48 de altura, raio 12; a largura da borda fica em 1.5 para o conteúdo não
 * mexer. O anel de foco fica de fora: no `TextInput`, o foco também dispara no toque.
 */
function Input({ className, invalid, editable, onFocus, onBlur, ...props }: InputProps) {
  const name = useThemeName();
  const [focused, setFocused] = useState(false);
  const disabled = editable === false;
  return (
    <TextInput
      className={cn(
        'h-12 rounded-md border-[1.5px] px-3.5 font-sans text-base',
        inputStateClasses({ invalid, focused, disabled }),
        className,
      )}
      placeholderTextColor={color(name, disabled ? 'disabledForeground' : 'mutedForeground')}
      editable={editable}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      {...props}
    />
  );
}

export type { InputProps };
export { Input };
