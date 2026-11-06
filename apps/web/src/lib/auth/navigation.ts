import type { MeResponse } from '@space-sports/api-client';

/** Quem não tem acesso a nenhuma área do web (jogador sem vínculo com espaço). */
export const NO_ACCESS_PATH = '/sem-acesso';
export const LOGIN_PATH = '/entrar';
/** Etapa obrigatória para contas sem nome ou telefone (decisão 66): conta antiga ou login Google. */
export const COMPLETE_PROFILE_PATH = '/completar-cadastro';

type AccessInfo = Pick<MeResponse, 'access'> & {
  /** `profile.missing` do `/v1/me`; ausente é tratado como cadastro completo. */
  profile?: { missing: readonly string[] } | undefined;
};

/** Faltam dados obrigatórios (nome e/ou telefone) para usar o painel (decisão 66)? */
export function needsProfileCompletion(me: AccessInfo): boolean {
  return (me.profile?.missing.length ?? 0) > 0;
}

/** Completar cadastro guardando a página pedida, para voltar a ela depois. */
export function completeProfilePath(next: string | undefined): string {
  const safe = safeNextPath(next);
  return safe ? `${COMPLETE_PROFILE_PATH}?next=${encodeURIComponent(safe)}` : COMPLETE_PROFILE_PATH;
}

/**
 * Etapa "Sobre você" (decisão 70), em rota própria para sobreviver a um recarregamento: vem depois
 * do cadastro (com a sessão já aberta) e do completar cadastro de conta nova. Não é só para
 * deslogados, como o `/cadastro`.
 */
export const ABOUT_YOU_PATH = '/cadastro/sobre-voce';

/** "Sobre você" seguido de `next` (ex.: a confirmação do e-mail, que leva o convite adiante). */
export function aboutYouPath(next: string | undefined): string {
  const safe = safeNextPath(next);
  return safe ? `${ABOUT_YOU_PATH}?next=${encodeURIComponent(safe)}` : ABOUT_YOU_PATH;
}

/** Área inicial conforme o perfil: Super → `/super`, gestão → `/painel`, senão `/sem-acesso`. */
export function destinationFor(me: AccessInfo): string {
  if (me.access.super) return '/super';
  if (me.access.management) return '/painel';
  return NO_ACCESS_PATH;
}

/**
 * Valida o `next` vindo da URL: só caminhos internos (começam com uma barra, sem `//` nem `\`),
 * para não virar redirecionamento aberto. Devolve `undefined` se inválido.
 */
export function safeNextPath(value: string | null | undefined): string | undefined {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return undefined;
  }
  // Caracteres de controle (quebra de linha etc.) não têm lugar em um caminho.
  for (const char of value)
    if (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) return undefined;
  return value;
}

/** Token do convite de equipe quando o `next` volta para ele (`/convite/<token>`). */
export function inviteTokenFromNext(next: string | undefined): string | null {
  return /^\/convite\/([^/?#]+)$/.exec(next ?? '')?.[1] ?? null;
}

export function loginPathWithNext(next: string): string {
  const safe = safeNextPath(next);
  return safe && safe !== '/' ? `${LOGIN_PATH}?next=${encodeURIComponent(safe)}` : LOGIN_PATH;
}

/** Para onde o link do e-mail de verificação volta, sem perder o destino (ex.: convite por link). */
export function verifiedEmailPath(next: string | undefined): string {
  const params = new URLSearchParams({ status: 'confirmado' });
  if (next) params.set('next', next);
  return `/verificar-email?${params}`;
}

const GUEST_ONLY_PATHS = new Set(['/entrar', '/cadastro', '/esqueci-senha']);

export type AccessDecision = { type: 'allow' } | { type: 'redirect'; to: string };

const allow: AccessDecision = { type: 'allow' };
const redirect = (to: string): AccessDecision => ({ type: 'redirect', to });

function isArea(pathname: string, area: '/painel' | '/super'): boolean {
  return pathname === area || pathname.startsWith(`${area}/`);
}

/**
 * Regra de acesso do `proxy.ts` (RN-AUTH-01/02): `me` é o `GET /v1/me` da sessão, ou `null` sem
 * sessão válida. A API continua sendo a regra de verdade; isto só evita mostrar a área errada.
 * - sem sessão em `/painel` ou `/super` → `/entrar?next=…`;
 * - `/super` só com `access.super`; `/painel` só com `access.management` (ou Super em modo suporte);
 * - quem já tem sessão e abre `/entrar`, `/cadastro` ou `/esqueci-senha` vai para `next` ou a área do perfil;
 * - `/cadastro/sobre-voce` exige sessão (é a etapa seguinte ao cadastro);
 * - conta sem nome ou telefone (`profile.missing`) não usa `/painel` nem `/super` antes do
 *   `/completar-cadastro` (decisão 66); com o cadastro completo, essa tela devolve ao `next`.
 */
export function decideAccess(input: {
  pathname: string;
  search?: string;
  me: AccessInfo | null;
  /** Super com sessão de suporte aberta (cookie de roteamento): pode entrar no `/painel` (RF-SUPER-04). */
  supportMode?: boolean;
}): AccessDecision {
  const { pathname, search = '', me, supportMode = false } = input;

  if (GUEST_ONLY_PATHS.has(pathname)) {
    if (!me) return allow;
    const next = safeNextPath(new URLSearchParams(search).get('next'));
    return redirect(next ?? destinationFor(me));
  }

  // "Sobre você" pede a sessão (grava pelo `PATCH /v1/me/profile`); sem ela, login e volta.
  if (pathname === ABOUT_YOU_PATH) {
    return me ? allow : redirect(loginPathWithNext(`${pathname}${search}`));
  }

  if (pathname === COMPLETE_PROFILE_PATH) {
    if (!me) return redirect(loginPathWithNext(`${pathname}${search}`));
    if (needsProfileCompletion(me)) return allow;
    const next = safeNextPath(new URLSearchParams(search).get('next'));
    return redirect(next ?? destinationFor(me));
  }

  const inSuper = isArea(pathname, '/super');
  const inPainel = isArea(pathname, '/painel');
  if (!inSuper && !inPainel) return allow;

  if (!me) return redirect(loginPathWithNext(`${pathname}${search}`));
  // Sem acesso à área, o destino do perfil decide; com acesso, o cadastro precisa estar completo.
  const area = inSuper ? me.access.super : me.access.management || (me.access.super && supportMode);
  if (area && needsProfileCompletion(me))
    return redirect(completeProfilePath(`${pathname}${search}`));
  if (inSuper) return me.access.super ? allow : redirect(destinationFor(me));
  if (me.access.super && supportMode) return allow;
  return me.access.management ? allow : redirect(destinationFor(me));
}
