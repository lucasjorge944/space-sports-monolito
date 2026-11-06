import { type NextRequest, NextResponse } from 'next/server';
import { decideAccess } from '@/lib/auth/navigation';
import { fetchServerSession } from '@/lib/auth/server-session';
import { hasSessionCookie } from '@/lib/auth/session-cookie';
import { SUPPORT_COOKIE } from '@/lib/support/cookie';

// Next 16: o antigo `middleware.ts` agora se chama `proxy.ts`.

/**
 * Controle de acesso (RN-AUTH-01/02). A sessão é validada com `GET /v1/me` na API, repassando o
 * cookie do web (o browser fala com a API pelo rewrite de `/v1`, então o cookie é do nosso domínio).
 * A regra está em `decideAccess`; a API continua sendo a regra de verdade de cada endpoint.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const cookie = request.headers.get('cookie');

  let me = null;
  if (hasSessionCookie(cookie)) {
    const session = await fetchServerSession(cookie as string);
    if (session.status === 'unavailable') {
      // Sem como validar: libera as telas de login; as áreas protegidas ficam indisponíveis.
      if (!pathname.startsWith('/painel') && !pathname.startsWith('/super')) {
        return NextResponse.next();
      }
      return new NextResponse(
        'Serviço temporariamente indisponível. Tente novamente em instantes.',
        {
          status: 503,
          headers: { 'Retry-After': '10', 'Content-Type': 'text/plain; charset=utf-8' },
        },
      );
    }
    if (session.status === 'ok') me = session.me;
  }

  const supportMode = request.cookies.get(SUPPORT_COOKIE)?.value === '1';
  const decision = decideAccess({ pathname, search, me, supportMode });
  if (decision.type === 'redirect') return NextResponse.redirect(new URL(decision.to, request.url));
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/painel/:path*',
    '/super/:path*',
    '/entrar',
    '/cadastro',
    '/cadastro/sobre-voce',
    '/esqueci-senha',
    '/completar-cadastro',
  ],
};
