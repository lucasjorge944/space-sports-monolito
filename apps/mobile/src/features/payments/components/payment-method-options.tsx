import type { PaymentOption } from '@space-sports/api-client';
import { paymentLayout } from '@space-sports/ui-tokens';
import { Check, CreditCard, QrCode, Store } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

const OPTION_TEXT: Record<PaymentOption, { title: string; description: string }> = {
  ONLINE_PIX: { title: 'Pix', description: 'Aprovação na hora' },
  ONLINE_CARD: { title: 'Cartão de crédito', description: 'À vista' },
  ON_SITE: { title: 'No local', description: 'Pague no espaço no dia do jogo' },
};

const ICONS = { ONLINE_PIX: QrCode, ONLINE_CARD: CreditCard, ON_SITE: Store } as const;

/** Sufixo do testID: `pagamento-opcao-pix|cartao|local`. */
export const OPTION_TEST_ID: Record<PaymentOption, string> = {
  ONLINE_PIX: 'pix',
  ONLINE_CARD: 'cartao',
  ON_SITE: 'local',
};

/**
 * Cartões de opção da etapa "Como você quer pagar?" (docs/05, "App — (1)"): radiogroup de largura
 * toda, um por meio; o selecionado ganha borda, fundo e o ícone de marcado (não só a cor). O
 * conteúdo extra do "No local" (chips da forma pretendida) entra por `onSiteExtra`.
 */
export function PaymentMethodOptions({
  options,
  value,
  onChange,
  onSiteExtra,
  testIDPrefix = 'pagamento-opcao',
}: {
  options: PaymentOption[];
  value: PaymentOption | null;
  onChange: (option: PaymentOption) => void;
  onSiteExtra?: ReactNode;
  testIDPrefix?: string;
}) {
  const name = useThemeName();
  const { minHeight, iconSize, gap } = paymentLayout.methodOption;
  return (
    <View role="radiogroup" accessibilityLabel="Forma de pagamento" style={{ gap }}>
      {options.map((option) => {
        const selected = value === option;
        const Icon = ICONS[option];
        const text = OPTION_TEXT[option];
        return (
          <Pressable
            key={option}
            testID={`${testIDPrefix}-${OPTION_TEST_ID[option]}`}
            role="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${text.title}, ${text.description}`}
            onPress={() => onChange(option)}
            className={cn(
              'rounded-lg border-[1.5px] px-4 py-3 active:bg-accent',
              selected ? 'border-chip-selected-border bg-accent' : 'border-border bg-card',
            )}
            style={{ minHeight }}
          >
            <View className="flex-row items-center gap-3">
              <View
                className={cn(
                  'h-5 w-5 items-center justify-center rounded-full border-2',
                  selected ? 'border-chip-selected-border' : 'border-muted-foreground',
                )}
                aria-hidden
              >
                {selected ? (
                  <View className="h-2.5 w-2.5 rounded-full bg-chip-selected-border" />
                ) : null}
              </View>
              <Icon size={iconSize} color={color(name, 'foreground')} aria-hidden />
              <View className="flex-1">
                <Text className="font-semibold">{text.title}</Text>
                <Text variant="muted">{text.description}</Text>
              </View>
              {selected ? <Check size={20} color={color(name, 'foreground')} aria-hidden /> : null}
            </View>
            {option === 'ON_SITE' && selected && onSiteExtra ? (
              <View className="mt-3 gap-2">{onSiteExtra}</View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
