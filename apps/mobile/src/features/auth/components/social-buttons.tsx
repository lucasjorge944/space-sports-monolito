import { useMutation } from '@tanstack/react-query';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuthActions } from '../actions';
import { ENABLED_SOCIAL_PROVIDERS, type SocialProvider } from '../config';
import { authErrorMessage } from '../errors';
import { FormError } from './field';

const LABELS: Record<SocialProvider, string> = {
  google: 'Continuar com Google',
  apple: 'Continuar com Apple',
};

/** Botões de Google/Apple; só os provedores habilitados (EXPO_PUBLIC_AUTH_SOCIAL_PROVIDERS). */
export function SocialButtons({
  providers = ENABLED_SOCIAL_PROVIDERS,
}: {
  providers?: SocialProvider[];
}) {
  const { signInWithSocial } = useAuthActions();
  const mutation = useMutation({ mutationFn: signInWithSocial });
  if (providers.length === 0) return null;

  return (
    <View className="gap-3">
      {providers.map((provider) => (
        <Button
          key={provider}
          variant="outline"
          disabled={mutation.isPending}
          onPress={() => mutation.mutate(provider)}
          accessibilityLabel={LABELS[provider]}
        >
          <Text>{LABELS[provider]}</Text>
        </Button>
      ))}
      <FormError message={mutation.error ? authErrorMessage(mutation.error) : null} />
    </View>
  );
}
