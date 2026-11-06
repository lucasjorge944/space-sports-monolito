import type { PaymentMethod, PublicSpace } from '@space-sports/api-client';
import { maskPhone } from '@space-sports/shared';
import {
  Accessibility,
  AtSign,
  Banknote,
  CircleCheck,
  CreditCard,
  Lightbulb,
  type LucideIcon,
  MapPin,
  MessageCircle,
  Phone,
  QrCode,
  Shirt,
  ShowerHead,
  SquareParking,
  Toilet,
  Utensils,
  Volleyball,
  Wallet,
  Wifi,
} from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { PAYMENT_METHOD_LABELS } from './labels';
import {
  instagramHandle,
  instagramUrl,
  mapsUrl,
  openLink,
  telUrl,
  wazeUrl,
  whatsappUrl,
} from './links';
import { LocationMap } from './location-map';
import { OpeningHours } from './opening-hours';
import { formatAddress } from './space-format';
import { SpaceSection } from './space-section';

/** Texto maior que isso abre recolhido, em 3 linhas. */
const LONG_DESCRIPTION = 160;

const AMENITY_ICONS: Record<string, LucideIcon> = {
  banheiro: Toilet,
  vestiario: Shirt,
  chuveiro: ShowerHead,
  'bar-lanchonete': Utensils,
  estacionamento: SquareParking,
  'iluminacao-noturna': Lightbulb,
  'aluguel-equipamento': Volleyball,
  acessibilidade: Accessibility,
  'wi-fi': Wifi,
};

const PAYMENT_ICONS: Record<PaymentMethod, LucideIcon> = {
  PIX: QrCode,
  CARD: CreditCard,
  CASH: Banknote,
  OTHER: Wallet,
};

async function openOrWarn(url: string, what: string) {
  if (!(await openLink(url)))
    Alert.alert('Não foi possível abrir', `Instale um app para abrir ${what}.`);
}

function IconLabel({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  const name = useThemeName();
  return (
    <View className="min-h-8 min-w-[45%] flex-1 flex-row items-center gap-2">
      <Icon size={18} color={color(name, 'primary')} aria-hidden />
      <Text className="flex-1">{label}</Text>
    </View>
  );
}

function ContactRow({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const name = useThemeName();
  return (
    <Pressable
      role="link"
      accessibilityLabel={label}
      className="min-h-11 flex-row items-center gap-3 rounded-md px-1 active:bg-accent"
      onPress={onPress}
    >
      <Icon size={20} color={color(name, 'primary')} aria-hidden />
      <Text className="flex-1">{label}</Text>
    </Pressable>
  );
}

function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > LONG_DESCRIPTION;
  return (
    <View className="items-start gap-1">
      <Text numberOfLines={long && !expanded ? 3 : undefined}>{text}</Text>
      {long ? (
        <Pressable
          role="button"
          accessibilityState={{ expanded }}
          className="min-h-11 justify-center"
          onPress={() => setExpanded(!expanded)}
        >
          <Text className="font-medium text-link">{expanded ? 'Ver menos' : 'Ver mais'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Sobre, comodidades, horários, pagamento, contato e localização (RF-SPACE-08). Cada seção só
 * aparece com dado preenchido; nada é inventado (doc 08).
 */
export function SpaceInfo({ space }: { space: PublicSpace }) {
  const name = useThemeName();
  const { location, phone, whatsapp, instagram } = space;
  const hasContact = phone || whatsapp || instagram;

  return (
    <View className="gap-6">
      {space.description ? (
        <SpaceSection title="Sobre">
          <Description text={space.description} />
        </SpaceSection>
      ) : null}

      {space.amenities.length > 0 ? (
        <SpaceSection title="Comodidades">
          <View className="flex-row flex-wrap gap-x-3 gap-y-2">
            {space.amenities.map((amenity) => (
              <IconLabel
                key={amenity.id}
                icon={AMENITY_ICONS[amenity.slug] ?? CircleCheck}
                label={amenity.name}
              />
            ))}
          </View>
        </SpaceSection>
      ) : null}

      <OpeningHours hours={space.openingHours} />

      {space.acceptedPaymentMethods.length > 0 ? (
        <SpaceSection title="Pagamento no espaço">
          <View className="flex-row flex-wrap gap-x-3 gap-y-2">
            {space.acceptedPaymentMethods.map((method) => (
              <IconLabel
                key={method}
                icon={PAYMENT_ICONS[method]}
                label={PAYMENT_METHOD_LABELS[method]}
              />
            ))}
          </View>
        </SpaceSection>
      ) : null}

      {hasContact ? (
        <SpaceSection title="Contato">
          {whatsapp ? (
            <Button
              testID="espaco-whatsapp"
              variant="outline"
              accessibilityLabel={`Falar no WhatsApp, ${maskPhone(whatsapp)}`}
              onPress={() => void openOrWarn(whatsappUrl(whatsapp), 'o WhatsApp')}
            >
              <MessageCircle size={20} color={color(name, 'foreground')} aria-hidden />
              <Text>Falar no WhatsApp</Text>
            </Button>
          ) : null}
          {phone ? (
            <ContactRow
              icon={Phone}
              label={maskPhone(phone)}
              onPress={() => void openOrWarn(telUrl(phone), 'o telefone')}
            />
          ) : null}
          {instagram ? (
            <ContactRow
              icon={AtSign}
              label={instagramHandle(instagram)}
              onPress={() => void openOrWarn(instagramUrl(instagram), 'o Instagram')}
            />
          ) : null}
        </SpaceSection>
      ) : null}

      <SpaceSection title="Localização">
        {location ? (
          <LocationMap
            location={location}
            label={space.name}
            onPress={() => void openOrWarn(mapsUrl(location, space.name), 'o mapa')}
          />
        ) : null}
        <View className="flex-row items-start gap-3">
          <MapPin size={20} color={color(name, 'primary')} aria-hidden />
          <Text className="flex-1">{formatAddress(space.address)}</Text>
        </View>
        {location ? (
          <View className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onPress={() => void openOrWarn(mapsUrl(location, space.name), 'o mapa')}
            >
              <Text>Como chegar</Text>
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onPress={() => void openOrWarn(wazeUrl(location), 'o Waze')}
            >
              <Text>Waze</Text>
            </Button>
          </View>
        ) : null}
      </SpaceSection>
    </View>
  );
}
