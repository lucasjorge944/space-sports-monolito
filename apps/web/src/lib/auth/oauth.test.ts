import { describe, expect, it } from 'vitest';
import {
  isConsentAccessDenied,
  isConsentExpired,
  isConsentProfileIncomplete,
  isConsentRequestGone,
  isConsentUnavailable,
  isOAuthFlow,
  oauthLoginPath,
  queryStringOf,
  redirectTarget,
  safeHttpsUrl,
  safeHttpUrl,
  safeOAuthRedirect,
} from './oauth';

describe('isOAuthFlow', () => {
  it('exige sig e client_id', () => {
    expect(isOAuthFlow(new URLSearchParams('sig=a&client_id=b'))).toBe(true);
    expect(isOAuthFlow(new URLSearchParams('sig=a'))).toBe(false);
    expect(isOAuthFlow(new URLSearchParams('client_id=b'))).toBe(false);
    expect(isOAuthFlow(new URLSearchParams('next=/painel'))).toBe(false);
  });
});

describe('queryStringOf', () => {
  it('mantém ordem e valores repetidos (ba_param) e ignora o que não veio', () => {
    expect(queryStringOf({ client_id: 'a b', ba_param: ['x', 'y'], vazio: undefined })).toBe(
      'client_id=a+b&ba_param=x&ba_param=y',
    );
  });
});

describe('oauthLoginPath', () => {
  it('volta ao /entrar com a query', () => {
    expect(oauthLoginPath('sig=a')).toBe('/entrar?sig=a');
    expect(oauthLoginPath('')).toBe('/entrar');
  });
});

describe('safeOAuthRedirect', () => {
  it('aceita caminho interno, https e http em loopback', () => {
    expect(safeOAuthRedirect('/autorizar?sig=a')).toBe('/autorizar?sig=a');
    expect(safeOAuthRedirect('https://claude.ai/cb?code=1&state=2')).toBe(
      'https://claude.ai/cb?code=1&state=2',
    );
    expect(safeOAuthRedirect('http://localhost:3000/cb?code=1')).toBe(
      'http://localhost:3000/cb?code=1',
    );
    expect(safeOAuthRedirect('http://127.0.0.1:8080/cb')).toBe('http://127.0.0.1:8080/cb');
  });

  it('recusa esquema perigoso, http público e caminhos disfarçados', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,x',
      'http://evil.com/cb',
      'myapp://callback',
      '//evil.com',
      '/\\evil.com',
      'não é url',
      '',
    ]) {
      expect(safeOAuthRedirect(url)).toBeUndefined();
    }
    expect(safeOAuthRedirect(undefined)).toBeUndefined();
    expect(safeOAuthRedirect(42)).toBeUndefined();
  });
});

describe('redirectTarget', () => {
  it('só segue quando a API mandou redirecionar', () => {
    expect(redirectTarget({ redirect: true, url: '/autorizar?x=1' })).toBe('/autorizar?x=1');
    expect(redirectTarget({ redirect: false, url: '/autorizar' })).toBeUndefined();
    expect(redirectTarget({ redirect: true, url: 'javascript:alert(1)' })).toBeUndefined();
    expect(redirectTarget(null)).toBeUndefined();
    expect(redirectTarget({ token: 'x' })).toBeUndefined();
  });
});

describe('safeHttpUrl', () => {
  it('descarta o que não é http(s) (logo e página vêm do cliente)', () => {
    expect(safeHttpUrl('https://claude.ai/logo.png')).toBe('https://claude.ai/logo.png');
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('data:image/svg+xml,<svg/>')).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
  });
});

describe('safeHttpsUrl', () => {
  it('logo só em https: http, javascript:, data: e lixo são descartados', () => {
    expect(safeHttpsUrl('https://claude.ai/logo.png')).toBe('https://claude.ai/logo.png');
    expect(safeHttpsUrl('http://claude.ai/logo.png')).toBeUndefined();
    expect(safeHttpsUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpsUrl('data:image/svg+xml,<svg/>')).toBeUndefined();
    expect(safeHttpsUrl('logo.png')).toBeUndefined();
    expect(safeHttpsUrl(null)).toBeUndefined();
  });
});

describe('isConsentRequestGone', () => {
  it('reconhece pedido adulterado, vencido ou de cliente inexistente', () => {
    expect(isConsentRequestGone({ status: 400, code: 'OAUTH_REQUEST_INVALID' })).toBe(true);
    expect(isConsentRequestGone({ status: 404, code: 'OAUTH_CLIENT_NOT_FOUND' })).toBe(true);
    expect(isConsentRequestGone({ status: 400, error: 'invalid_signature' })).toBe(true);
  });

  it('erro de servidor ou de rede dá para tentar de novo', () => {
    expect(isConsentRequestGone({ status: 500 })).toBe(false);
    expect(isConsentRequestGone({ status: 429 })).toBe(false);
    expect(isConsentRequestGone(null)).toBe(false);
  });
});

describe('isConsentExpired', () => {
  const now = Date.parse('2026-11-11T12:00:00.000Z');
  it('compara com o prazo do pedido', () => {
    expect(isConsentExpired('2026-11-11T12:05:00.000Z', now)).toBe(false);
    expect(isConsentExpired('2026-11-11T12:00:00.000Z', now)).toBe(true);
    expect(isConsentExpired('2026-11-11T11:00:00.000Z', now)).toBe(true);
  });
});

describe('isConsentAccessDenied', () => {
  it('reconhece a recusa por falta de acesso ao conector', () => {
    expect(isConsentAccessDenied({ status: 403, code: 'OAUTH_ACCESS_DENIED' })).toBe(true);
    expect(isConsentAccessDenied({ status: 403, error: 'access_denied' })).toBe(true);
  });
  it('reconhece o cliente fora da lista (400 unauthorized_client), que não é pedido vencido', () => {
    const failure = { status: 400, error: 'unauthorized_client' };
    expect(isConsentAccessDenied(failure)).toBe(true);
    // O mesmo status 400 do "pedido vencido": por isso a tela confere o acesso primeiro.
    expect(isConsentRequestGone(failure)).toBe(true);
  });
  it('não confunde o cadastro incompleto com falta de acesso (mesmo error: access_denied)', () => {
    // Formato real da API (oauthProfileIncomplete): 403, `error: access_denied` e `code: PROFILE_INCOMPLETE`.
    const failure = {
      status: 403,
      error: 'access_denied',
      code: 'PROFILE_INCOMPLETE',
    };
    expect(isConsentAccessDenied(failure)).toBe(false);
    expect(isConsentProfileIncomplete(failure)).toBe(true);
  });
  it('não confunde com sucesso', () => {
    expect(isConsentAccessDenied(null)).toBe(false);
  });
});

describe('isConsentProfileIncomplete', () => {
  it('só o código PROFILE_INCOMPLETE', () => {
    expect(isConsentProfileIncomplete({ status: 403, code: 'OAUTH_ACCESS_DENIED' })).toBe(false);
    expect(isConsentProfileIncomplete({ status: 403, error: 'access_denied' })).toBe(false);
    expect(isConsentProfileIncomplete(undefined)).toBe(false);
  });
});

describe('isConsentUnavailable', () => {
  it('reconhece o conector desligado', () => {
    expect(isConsentUnavailable({ status: 503, code: 'MCP_DISABLED' })).toBe(true);
    expect(isConsentUnavailable({ status: 503, error: 'temporarily_unavailable' })).toBe(true);
    expect(isConsentUnavailable({ status: 500, error: 'server_error' })).toBe(false);
  });
});
