import { MessageCircle } from 'lucide-react-native';
import { useState } from 'react';
import { InlineError } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { openLink, whatsappUrl } from '@/features/space/links';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

/** "Fale com o espaço": o botão só existe se o espaço cadastrou WhatsApp. */
export function TalkToSpace({ whatsapp }: { whatsapp: string | null | undefined }) {
  const name = useThemeName();
  const [failed, setFailed] = useState(false);
  if (!whatsapp) return null;
  const open = async () => {
    setFailed(!(await openLink(whatsappUrl(whatsapp))));
  };
  return (
    <>
      <Button
        testID="reserva-whatsapp"
        variant="outline"
        accessibilityLabel="Falar com o espaço no WhatsApp"
        onPress={() => void open()}
      >
        <MessageCircle size={20} color={color(name, 'foreground')} aria-hidden />
        <Text>Falar no WhatsApp</Text>
      </Button>
      <InlineError message={failed ? 'Não foi possível abrir o WhatsApp neste aparelho.' : null} />
    </>
  );
}
