import { Minus, Plus } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

/** Contador de pessoas com alvos de 44pt. */
export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  testID,
  decreaseLabel = 'Menos uma pessoa',
  increaseLabel = 'Mais uma pessoa',
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  testID?: string;
  decreaseLabel?: string;
  increaseLabel?: string;
}) {
  const name = useThemeName();
  const button = (
    delta: number,
    disabled: boolean,
    text: string,
    Icon: typeof Plus,
    suffix: string,
  ) => (
    <Pressable
      testID={testID ? `${testID}-${suffix}` : undefined}
      role="button"
      accessibilityLabel={text}
      disabled={disabled}
      className={`h-11 w-11 items-center justify-center rounded-full border border-input active:bg-accent ${disabled ? 'opacity-40' : ''}`}
      onPress={() => onChange(value + delta)}
    >
      <Icon size={20} color={color(name, 'foreground')} />
    </Pressable>
  );
  return (
    <View
      className="flex-row items-center gap-4"
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value }}
    >
      {button(-1, value <= min, decreaseLabel, Minus, 'menos')}
      <Text
        variant="large"
        className="min-w-8 text-center tabular-nums"
        testID={testID ? `${testID}-valor` : undefined}
      >
        {value}
      </Text>
      {button(1, value >= max, increaseLabel, Plus, 'mais')}
    </View>
  );
}
