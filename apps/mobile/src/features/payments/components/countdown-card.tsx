import { AlarmClock, Clock } from 'lucide-react-native';
import { ActivityIndicator, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import type { PayableKind } from '../charge-state';
import {
  countdownA11yLabel,
  formatClock,
  formatDeadline,
  formatLongCountdown,
  isUrgent,
} from '../countdown';

/**
 * Prazo do Pix (docs/05, "App — (2)", item 2): contagem (mm:ss) e hora de relógio, porque a
 * contagem some quando a pessoa sai para o app do banco. Urgente abaixo de 3 min (reserva) ou 1 h
 * (mensalidade). Na reserva opcional, só a linha "Pix válido até 18:47".
 */
export function CountdownCard({
  kind,
  deadline,
  remainingMs,
  checking,
  timeZone,
}: {
  kind: PayableKind;
  deadline: string;
  remainingMs: number;
  checking: boolean;
  timeZone?: string;
}) {
  const name = useThemeName();
  const until = formatDeadline(deadline, timeZone);
  if (checking) {
    return (
      <View
        testID="pix-conferindo"
        className="flex-row items-center gap-3 rounded-lg border border-border bg-card p-4"
        accessibilityLiveRegion="polite"
      >
        <ActivityIndicator color={color(name, 'mutedForeground')} />
        <Text className="font-display-semibold text-xl">Conferindo…</Text>
      </View>
    );
  }
  if (kind === 'optional') {
    return (
      <Text variant="muted" testID="pix-validade" className="tabular-nums">
        Pix válido até {until}
      </Text>
    );
  }
  const urgent = isUrgent(remainingMs, kind === 'subscription' ? 'classCharge' : 'booking');
  const Icon = urgent ? AlarmClock : Clock;
  const clock =
    kind === 'subscription' ? formatLongCountdown(remainingMs) : formatClock(remainingMs);
  const primary =
    kind === 'subscription' && remainingMs >= 60 * 60_000 ? `Faltam ${clock}` : `Pague em ${clock}`;
  const secondary =
    kind === 'subscription'
      ? urgent
        ? 'Gere outro depois, se precisar'
        : `Válido até ${until}`
      : urgent
        ? `O horário é liberado às ${until}`
        : `Horário guardado até ${until}`;
  return (
    <View
      testID="pix-contagem"
      className={cn(
        'flex-row items-start gap-3 rounded-lg border p-4',
        urgent ? 'border-warning-subtle-border bg-warning-subtle' : 'border-border bg-card',
      )}
    >
      <Icon
        size={20}
        color={color(name, urgent ? 'warningSubtleForeground' : 'foreground')}
        aria-hidden
      />
      <View className="flex-1 gap-0.5">
        <Text
          accessibilityLabel={countdownA11yLabel(remainingMs)}
          className={cn(
            'font-display-semibold text-2xl tabular-nums',
            urgent && 'text-warning-subtle-foreground',
          )}
        >
          {primary}
        </Text>
        <Text
          className={cn(
            'text-sm',
            urgent ? 'text-warning-subtle-foreground' : 'text-muted-foreground',
          )}
        >
          {secondary}
        </Text>
      </View>
    </View>
  );
}
