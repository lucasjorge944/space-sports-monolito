import { CircleAlert } from 'lucide-react-native';
import { View } from 'react-native';
import { Input, type InputProps } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

/**
 * Campo do app (doc 05, "Anatomia de campo"): rótulo, controle, dica e erro. O erro entra abaixo da
 * dica; só a dica de contexto, que não ajuda a corrigir, sai com `hideHintOnError`.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  hideHintOnError,
  ...inputProps
}: InputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  hideHintOnError?: boolean;
}) {
  const name = useThemeName();
  const visibleHint = error && hideHintOnError ? undefined : hint;
  const spokenLabel = optional ? `${label} (opcional)` : label;
  return (
    <View className="gap-1.5">
      <Text variant="small">
        {label}
        {optional ? <Text className="font-normal text-muted-foreground"> (opcional)</Text> : null}
      </Text>
      <Input
        accessibilityLabel={error ? `${spokenLabel}, com erro` : spokenLabel}
        accessibilityHint={[error, visibleHint].filter(Boolean).join('. ') || undefined}
        invalid={!!error}
        {...inputProps}
      />
      {visibleHint || error ? (
        <View className="gap-1">
          {visibleHint ? (
            <Text className="text-sm text-muted-foreground">{visibleHint}</Text>
          ) : null}
          {error ? (
            <View className="flex-row gap-1.5" accessibilityLiveRegion="polite">
              <CircleAlert size={16} color={color(name, 'inputErrorForeground')} aria-hidden />
              <Text className="flex-1 text-sm font-medium text-input-error-foreground">
                {error}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Erro geral do formulário (vindo da API), em PT-BR, no topo do formulário. */
export function FormError({ message }: { message?: string | null }) {
  const name = useThemeName();
  if (!message) return null;
  return (
    <View
      className="flex-row gap-1.5 rounded-md border border-destructive-subtle-border bg-destructive-subtle p-3"
      accessible
      role="alert"
      accessibilityLiveRegion="polite"
    >
      <CircleAlert size={16} color={color(name, 'destructiveSubtleForeground')} aria-hidden />
      <Text className="flex-1 text-sm font-medium text-destructive-subtle-foreground">
        {message}
      </Text>
    </View>
  );
}
