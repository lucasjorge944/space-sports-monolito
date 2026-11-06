import { exploreLayout } from '@space-sports/ui-tokens';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { Text } from '@/components/ui/text';

const MAX_FONT = exploreLayout.mediaMaxFontSizeMultiplier;

/**
 * Selo "Patrocinado · <anunciante>" (RF-ADS-06), sempre visível sobre a foto. "Patrocinado" nunca
 * é cortado; o nome encolhe com reticências. Fora da árvore de acessibilidade: o rótulo da peça já
 * começa com "Patrocinado, <anunciante>".
 */
export function SponsoredBadge({
  advertiser,
  maxWidth,
  style,
  testID,
}: {
  advertiser: string;
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      className="min-h-6 flex-row items-center self-start rounded-full bg-sponsored px-2.5 py-0.5"
      style={[{ maxWidth: maxWidth ?? '100%' }, style]}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT}
        className="text-sm font-semibold text-sponsored-foreground"
      >
        Patrocinado
      </Text>
      <Text
        maxFontSizeMultiplier={MAX_FONT}
        numberOfLines={1}
        className="shrink text-sm font-medium text-sponsored-foreground"
      >
        {` · ${advertiser}`}
      </Text>
    </View>
  );
}
