import { paymentLayout } from '@space-sports/ui-tokens';
import { FlaskConical } from 'lucide-react-native';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

/**
 * Selo "Ambiente de teste" (docs/05, "Pagamento online"): só quando a API indica o gateway fake
 * (`paymentEnvironment.sandbox`). Nunca interativo.
 */
export function SandboxBadge({ testID = 'pagamento-selo-teste' }: { testID?: string }) {
  const name = useThemeName();
  const { minHeight, paddingX, iconSize } = paymentLayout.sandboxBadge;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel="Ambiente de teste: nenhum valor é cobrado de verdade"
      className="flex-row items-center gap-1.5 self-center rounded-full border border-sandbox-border bg-sandbox"
      style={{ minHeight, paddingHorizontal: paddingX }}
    >
      <FlaskConical size={iconSize} color={color(name, 'sandboxForeground')} aria-hidden />
      <Text className="text-xs font-semibold text-sandbox-foreground">Ambiente de teste</Text>
    </View>
  );
}

/** O selo só aparece com o fake (a API manda `sandbox` preenchido). */
export function isSandbox(environment: { sandbox: unknown } | null | undefined): boolean {
  return Boolean(environment?.sandbox);
}
