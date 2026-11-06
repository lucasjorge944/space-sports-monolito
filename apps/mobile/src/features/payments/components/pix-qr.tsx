import { formatCents } from '@space-sports/shared';
import { paymentLayout } from '@space-sports/ui-tokens';
import { Image } from 'expo-image';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Skeleton } from '@/components/ui/skeleton';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

const { size, platePadding, plateRadius } = paymentLayout.qr;
const PLATE = size + platePadding * 2;

/**
 * QR do Pix sobre a placa branca (`qr-plate`), com os módulos em `qr-module`, iguais nos dois temas
 * (leitores de banco falham com QR invertido). O SVG da API usa `currentColor`; uma imagem (PNG de
 * um gateway real) entra sem recolorir.
 */
export function PixQr({ qr, amountCents }: { qr: string; amountCents: number }) {
  const name = useThemeName();
  const isSvg = qr.trimStart().startsWith('<');
  return (
    <View
      testID="pix-qr"
      accessible
      accessibilityRole="image"
      accessibilityLabel={`QR code do Pix de ${formatCents(amountCents)}`}
      className="items-center justify-center self-center border border-border bg-qr-plate"
      style={{ width: PLATE, height: PLATE, borderRadius: plateRadius }}
    >
      {isSvg ? (
        <SvgXml xml={qr} width={size} height={size} color={color(name, 'qrModule')} />
      ) : (
        <Image source={{ uri: qr }} style={{ width: size, height: size }} contentFit="contain" />
      )}
    </View>
  );
}

/** Esqueleto da placa enquanto o Pix é gerado. */
export function PixQrSkeleton() {
  return (
    <Skeleton
      testID="pix-qr-carregando"
      className="self-center"
      style={{ width: PLATE, height: PLATE, borderRadius: plateRadius }}
    />
  );
}
