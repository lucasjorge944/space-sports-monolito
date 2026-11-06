import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { errorMessage } from '@/lib/api-errors';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

export function LoadingView({ label = 'Carregando…' }: { label?: string }) {
  const name = useThemeName();
  return (
    <View className="flex-1 items-center justify-center gap-3 p-6" accessibilityLabel={label}>
      <ActivityIndicator color={color(name, 'primary')} />
      <Text variant="muted">{label}</Text>
    </View>
  );
}

export function EmptyView({
  title,
  description,
  action,
  testID,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  testID?: string;
}) {
  return (
    <View testID={testID} className="items-center gap-2 p-8">
      <Text variant="large" className="text-center">
        {title}
      </Text>
      {description ? (
        <Text variant="muted" className="text-center">
          {description}
        </Text>
      ) : null}
      {action ? <View className="mt-2">{action}</View> : null}
    </View>
  );
}

/** Erro com o motivo em PT-BR e botão para tentar de novo (rede lenta/offline). */
export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <View className="items-center gap-3 p-8" accessibilityRole="alert">
      <Text variant="large" className="text-center">
        Não deu certo
      </Text>
      <Text variant="muted" className="text-center">
        {errorMessage(error)}
      </Text>
      {onRetry ? (
        <Button variant="outline" onPress={onRetry}>
          <Text>Tentar novamente</Text>
        </Button>
      ) : null}
    </View>
  );
}

/** Aviso de erro dentro de um formulário. */
export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" className="text-sm text-destructive">
      {message}
    </Text>
  );
}
