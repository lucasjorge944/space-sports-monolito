import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { color, type ThemeToken } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

type Tone = 'success' | 'muted' | 'info' | 'destructive';

const CIRCLE: Record<Tone, string> = {
  success: 'bg-success-subtle',
  muted: 'bg-muted',
  info: 'bg-info-subtle',
  destructive: 'bg-destructive-subtle',
};

const ICON: Record<Tone, ThemeToken> = {
  success: 'successSubtleForeground',
  muted: 'mutedForeground',
  info: 'infoSubtleForeground',
  destructive: 'destructiveSubtleForeground',
};

/**
 * Estado de tela inteira do pagamento (confirmado, vencido, estornado, erro): círculo de 96 com o
 * ícone de 48, título h3, texto de até 3 linhas e os botões empilhados (docs/05, "Estados").
 */
export function ResultState({
  tone,
  icon: Icon,
  title,
  lines,
  actions,
  testID,
}: {
  tone: Tone;
  icon: LucideIcon;
  title: string;
  lines: (string | null | undefined)[];
  actions?: ReactNode;
  testID?: string;
}) {
  const name = useThemeName();
  return (
    <View
      testID={testID}
      className="items-center gap-3 px-4 pt-12"
      accessibilityLiveRegion="polite"
    >
      <View className={cn('h-24 w-24 items-center justify-center rounded-full', CIRCLE[tone])}>
        <Icon size={48} color={color(name, ICON[tone])} aria-hidden />
      </View>
      <Text variant="h3" className="text-center" role="heading">
        {title}
      </Text>
      {lines.filter(Boolean).map((line) => (
        <Text key={line} className="text-center text-muted-foreground tabular-nums">
          {line}
        </Text>
      ))}
      {actions ? <View className="mt-5 w-full gap-3">{actions}</View> : null}
    </View>
  );
}
