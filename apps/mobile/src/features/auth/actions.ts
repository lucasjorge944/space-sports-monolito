import {
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  signInEmail,
  signUpWithEmailAndPassword,
  type UpdateProfileInput,
  updateMyProfile,
} from '@space-sports/api-client';
import * as Linking from 'expo-linking';
import { useMemo } from 'react';
import type { SocialProvider } from './config';
import { useSession } from './session';
import { signInWithSocial } from './social-sign-in';
import { normalizeEmailInput } from './validation';

/** Deep links que a API usa nos e-mails (verificação e redefinição de senha) para voltar ao app. */
export const VERIFY_EMAIL_PATH = '/verificar-email';
export const RESET_PASSWORD_PATH = '/redefinir-senha';

export const verifyEmailCallbackUrl = () => Linking.createURL(VERIFY_EMAIL_PATH);
export const resetPasswordRedirectUrl = () => Linking.createURL(RESET_PASSWORD_PATH);

/**
 * Operações de auth do app. Cada uma chama o cliente da API; o token novo (header
 * `set-auth-token`) é guardado pelo `fetch` configurado em `setupApiClient`, e `refresh()`
 * valida a sessão em GET /v1/me, o que libera as rotas protegidas.
 */
export function useAuthActions() {
  const { refresh } = useSession();

  return useMemo(
    () => ({
      async signInWithEmail(input: { email: string; password: string }) {
        await signInEmail({ email: normalizeEmailInput(input.email), password: input.password });
        await refresh();
      },

      /**
       * `phone` em E.164 brasileiro (decisão 64), gravado sem verificação. O token já fica
       * guardado, mas a sessão só é validada em `refresh()`: a tela de cadastro chama depois da
       * etapa "Sobre você" (decisão 70), para o cadastro não ser trocado pelas abas no meio.
       */
      async signUpWithEmail(input: {
        name: string;
        email: string;
        password: string;
        phone: string;
      }) {
        await signUpWithEmailAndPassword({
          name: input.name.trim(),
          email: normalizeEmailInput(input.email),
          password: input.password,
          phone: input.phone,
          callbackURL: verifyEmailCallbackUrl(),
        });
      },

      async requestPasswordReset(email: string) {
        await requestPasswordReset({
          email: normalizeEmailInput(email),
          redirectTo: resetPasswordRedirectUrl(),
        });
      },

      async resetPassword(input: { token: string; newPassword: string }) {
        await resetPassword({ token: input.token, newPassword: input.newPassword });
      },

      async resendVerificationEmail(email: string) {
        await sendVerificationEmail({
          email: normalizeEmailInput(email),
          callbackURL: verifyEmailCallbackUrl(),
        });
      },

      /**
       * PATCH /v1/me/profile (parcial). Não relê o /me: quem chama decide quando (`refresh()`),
       * porque o completar perfil só troca de tela depois da etapa "Sobre você".
       */
      async updateProfile(input: UpdateProfileInput) {
        return updateMyProfile(input);
      },

      async signInWithSocial(provider: SocialProvider) {
        const result = await signInWithSocial(provider);
        if (result === 'signed-in') await refresh();
        return result;
      },
    }),
    [refresh],
  );
}
