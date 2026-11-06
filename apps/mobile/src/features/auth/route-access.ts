import type { MeResponse } from '@space-sports/api-client';

/**
 * Estado da sessão no app:
 * - `loading`: lendo o token e validando em GET /v1/me (a splash fica na tela);
 * - `offline`: há token, mas não deu para validar (sem rede); o token é mantido;
 * - `error`: o servidor respondeu, mas o /v1/me veio fora do contrato (versão incompatível);
 * - `signed-out` / `signed-in`.
 */
export type SessionState =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; me: MeResponse };

/** Quais grupos de rotas a pessoa pode abrir agora; o Expo Router redireciona o resto. */
export interface RouteAccess {
  /** Entrar, cadastro e esqueci a senha. */
  auth: boolean;
  /** Completar o cadastro: nome e/ou telefone que faltam (decisão 66). */
  completeProfile: boolean;
  /** Abas do jogador. */
  app: boolean;
}

/**
 * Cadastro incompleto (decisão 66): a API lista em `profile.missing` o que falta (nome e/ou
 * telefone), como na conta antiga sem telefone e na criada pelo Google. Enquanto houver algo, o
 * app só libera o completar perfil.
 */
export function isProfileIncomplete(me: Pick<MeResponse, 'profile'>): boolean {
  return me.profile.missing.length > 0;
}

/** Modo gestão (RN-AUTH-04): só com vínculo em algum espaço. A regra de verdade é da API. */
export function isManagement(me: Pick<MeResponse, 'access'> | null | undefined): boolean {
  return me?.access.management === true;
}

export function getRouteAccess(state: SessionState): RouteAccess {
  switch (state.status) {
    case 'signed-out':
      return { auth: true, completeProfile: false, app: false };
    case 'signed-in': {
      const incomplete = isProfileIncomplete(state.me);
      return { auth: false, completeProfile: incomplete, app: !incomplete };
    }
    default:
      return { auth: false, completeProfile: false, app: false };
  }
}

/** Para onde mandar quem caiu numa rota que a sessão atual não acessa. */
export function homeHref(state: SessionState): '/' | '/entrar' | '/completar-perfil' {
  const access = getRouteAccess(state);
  if (access.auth) return '/entrar';
  if (access.completeProfile) return '/completar-perfil';
  return '/';
}
