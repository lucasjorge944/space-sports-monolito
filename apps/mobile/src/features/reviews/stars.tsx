import { reviewLayout, type StarFill, starFills } from '@space-sports/ui-tokens';
import { Star, StarHalf } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { cn } from '@/lib/utils';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { starOptionLabel } from './format';

type StarSize = keyof typeof reviewLayout.star;

/**
 * Uma estrela (docs/05, "Avaliações (1)"): cheia com preenchimento `rating` e contorno
 * `rating-border`; vazia só com o contorno `rating-empty`; meia = vazia com a `StarHalf` cheia
 * por cima. Decorativa: quem usa diz a nota em texto ou no rótulo do contêiner.
 */
export function StarIcon({ fill, size }: { fill: StarFill; size: number }) {
  const name = useThemeName();
  const full = { fill: color(name, 'rating'), color: color(name, 'ratingBorder') };
  if (fill === 'full') return <Star size={size} strokeWidth={2} {...full} aria-hidden />;
  const empty = <Star size={size} strokeWidth={2} fill="none" color={color(name, 'ratingEmpty')} />;
  if (fill === 'empty') return <View aria-hidden>{empty}</View>;
  return (
    <View aria-hidden style={{ width: size, height: size }}>
      {empty}
      <View className="absolute inset-0">
        <StarHalf size={size} strokeWidth={2} {...full} />
      </View>
    </View>
  );
}

/** 5 estrelas de uma nota ou média (meias pela `starFills`), sem toque. */
export function StarRow({
  value,
  size = 'item',
  testID,
}: {
  value: number;
  size?: Exclude<StarSize, 'prompt' | 'input'>;
  testID?: string;
}) {
  const spec = reviewLayout.star[size];
  return (
    <View
      testID={testID}
      className="flex-row items-center"
      style={{ gap: spec.gap }}
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      {starFills(value).map((fill, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: posição fixa da estrela
        <StarIcon key={i} fill={fill} size={spec.size} />
      ))}
    </View>
  );
}

/**
 * Entrada da nota (tela de avaliar e card da reserva): `radiogroup` com 5 alvos (52 ou 44). Tocar
 * escolhe; tocar na escolhida não apaga; arrastar o dedo não muda a nota (só o toque conta).
 */
export function StarInput({
  value,
  onChange,
  size,
  label,
  disabled,
  testIDPrefix,
}: {
  value: number | null;
  onChange: (rating: number) => void;
  size: 'prompt' | 'input';
  label: string;
  disabled?: boolean;
  testIDPrefix: string;
}) {
  const spec = reviewLayout.star[size];
  return (
    <View
      role="radiogroup"
      accessibilityLabel={label}
      className={cn('flex-row items-center', size === 'input' && 'self-center')}
      style={{ gap: spec.gap }}
    >
      {[1, 2, 3, 4, 5].map((rating) => (
        <Pressable
          key={rating}
          testID={`${testIDPrefix}-${rating}`}
          role="radio"
          aria-checked={value === rating}
          aria-disabled={disabled ?? false}
          accessibilityLabel={starOptionLabel(rating)}
          disabled={disabled}
          onPress={() => onChange(rating)}
          className="items-center justify-center rounded-full active:bg-accent"
          style={{ width: spec.hitSize, height: spec.hitSize }}
        >
          <StarIcon fill={value !== null && rating <= value ? 'full' : 'empty'} size={spec.size} />
        </Pressable>
      ))}
    </View>
  );
}
