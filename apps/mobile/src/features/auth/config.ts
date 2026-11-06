export const SOCIAL_PROVIDERS = ['google', 'apple'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const DEFAULT_API_URL = 'http://localhost:3333';

/** `google,apple` → provedores conhecidos, sem repetição; o que não é reconhecido é ignorado. */
export function parseSocialProviders(raw: string | undefined): SocialProvider[] {
  const wanted = new Set(
    (raw ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  return SOCIAL_PROVIDERS.filter((provider) => wanted.has(provider));
}

/** Origem da API, sem barra final nem `/v1` (os caminhos do cliente já trazem o prefixo). */
export function normalizeApiUrl(raw: string | undefined): string {
  const url = raw?.trim() || DEFAULT_API_URL;
  return url.replace(/\/+$/, '').replace(/\/v1$/, '');
}

// O Expo só injeta `process.env.EXPO_PUBLIC_*` quando a leitura é literal.
export const API_URL = normalizeApiUrl(process.env.EXPO_PUBLIC_API_URL);
export const ENABLED_SOCIAL_PROVIDERS = parseSocialProviders(
  process.env.EXPO_PUBLIC_AUTH_SOCIAL_PROVIDERS,
);
