export const SOCIAL_PROVIDERS = ['google', 'apple'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/**
 * Lê `AUTH_PROVIDERS` (ex.: `google,apple`): os provedores sociais ligados na API. A API ainda não
 * expõe essa lista, então o web repete a configuração; vazio = só e-mail e senha.
 */
export function parseSocialProviders(value: string | undefined): SocialProvider[] {
  const wanted = new Set(
    (value ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  return SOCIAL_PROVIDERS.filter((provider) => wanted.has(provider));
}
