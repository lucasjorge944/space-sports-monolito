import { brandLogos, brandSvg, type LogoLayout, logoMinWidth } from '@space-sports/ui-tokens';
import { useId } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useThemeName } from '@/theme/theme-provider';

export type LogoVariant = LogoLayout;
/** `auto` escolhe pelo tema: positivo no claro, negativo no escuro. */
export type LogoTone = 'auto' | 'positive' | 'negative' | 'on-sol';

const DEFAULT_WIDTH: Record<LogoVariant, number> = { vertical: 160, horizontal: 176, symbol: 48 };

/**
 * Logo da marca (SVG de `@space-sports/ui-tokens`, nome já em contorno). Nunca abaixo do mínimo
 * digital da prancha 02 (vertical 96, horizontal 160, símbolo 40); a área de proteção é do chamador.
 */
export function Logo({
  variant = 'vertical',
  tone = 'auto',
  width,
  testID,
}: {
  variant?: LogoVariant;
  tone?: LogoTone;
  width?: number;
  testID?: string;
}) {
  const theme = useThemeName();
  // O clipPath da bola precisa de id único quando a logo aparece mais de uma vez na árvore.
  const suffix = useId().replace(/[^a-zA-Z0-9]/g, '');
  const resolved = tone === 'auto' ? (theme === 'dark' ? 'negative' : 'positive') : tone;
  const asset = brandLogos[variant][resolved] ?? brandLogos[variant].positive;
  if (!asset) return null;

  const renderedWidth = Math.max(width ?? DEFAULT_WIDTH[variant], logoMinWidth[variant]);
  const height = (renderedWidth * asset.height) / asset.width;

  return (
    <View
      testID={testID}
      accessible
      role="img"
      accessibilityLabel="Space Sports"
      style={{ width: renderedWidth, height }}
    >
      <SvgXml xml={brandSvg(asset, suffix)} width={renderedWidth} height={height} />
    </View>
  );
}
