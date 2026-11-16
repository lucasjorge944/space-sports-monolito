import { describe, expect, it } from 'vitest';
import {
  advertisedAuthServerMetadata,
  advertisedAuthServerMetadataResponse,
  clientAssertionSubject,
  rejectDpop,
  requireConsentPage,
  tokenRequestClientIdOf,
} from './oauth-server.js';

const BASE = 'https://api.example.com/v1/auth';

/** Recorte do que o `@better-auth/oauth-provider` 1.7.20 publica (com o `cimd`). */
const pluginMetadata = {
  issuer: BASE,
  authorization_endpoint: `${BASE}/oauth2/authorize`,
  token_endpoint: `${BASE}/oauth2/token`,
  jwks_uri: `${BASE}/jwks`,
  registration_endpoint: `${BASE}/oauth2/register`,
  introspection_endpoint: `${BASE}/oauth2/introspect`,
  introspection_endpoint_auth_methods_supported: ['client_secret_basic'],
  introspection_endpoint_auth_signing_alg_values_supported: ['EdDSA'],
  revocation_endpoint: `${BASE}/oauth2/revoke`,
  revocation_endpoint_auth_methods_supported: ['client_secret_basic'],
  userinfo_endpoint: `${BASE}/oauth2/userinfo`,
  end_session_endpoint: `${BASE}/oauth2/end-session`,
  code_challenge_methods_supported: ['S256'],
  dpop_signing_alg_values_supported: ['ES256'],
  backchannel_logout_supported: true,
  backchannel_logout_session_supported: true,
  client_id_metadata_document_supported: true,
};

describe('advertisedAuthServerMetadata (BUG-MCP-1)', () => {
  it('tira os endpoints desligados, os campos derivados deles e o que a API não oferece', () => {
    expect(advertisedAuthServerMetadata(pluginMetadata, '/v1/auth')).toEqual({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth2/authorize`,
      token_endpoint: `${BASE}/oauth2/token`,
      jwks_uri: `${BASE}/jwks`,
      registration_endpoint: `${BASE}/oauth2/register`,
      revocation_endpoint: `${BASE}/oauth2/revoke`,
      revocation_endpoint_auth_methods_supported: ['client_secret_basic'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
    });
  });

  it('não confunde rota desligada de outro prefixo, URL inválida nem texto comum', () => {
    const metadata = {
      issuer: 'https://outra.example.com/oauth2/introspect',
      op_policy_uri: 'não é URL',
      service_documentation: `${BASE}/oauth2/introspect-docs`,
    };
    expect(advertisedAuthServerMetadata(metadata, '/v1/auth')).toEqual(metadata);
  });

  it('na resposta: filtra o 200 JSON mantendo os headers e deixa erros intactos', async () => {
    const ok = await advertisedAuthServerMetadataResponse(
      new Response(JSON.stringify(pluginMetadata), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=15' },
      }),
      '/v1/auth',
    );
    expect(ok.headers.get('cache-control')).toBe('public, max-age=15');
    const body = await ok.json();
    expect(body.introspection_endpoint).toBeUndefined();
    expect(body.backchannel_logout_supported).toBeUndefined();
    expect(body.token_endpoint).toBe(`${BASE}/oauth2/token`);

    const failure = new Response('{"error":"x"}', {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
    expect(await advertisedAuthServerMetadataResponse(failure, '/v1/auth')).toBe(failure);
  });
});

describe('requireConsentPage (decisão 119 no authorize)', () => {
  const http = (method: string) =>
    new Request('https://api.example.com/v1/auth/oauth2/authorize', { method });
  // Reentrada do plugin (login com `oauth_query`): a requisição é a do login, os parâmetros na query.
  const signIn = new Request('https://api.example.com/v1/auth/sign-in/email', { method: 'POST' });

  it('acrescenta `consent` ao prompt, onde os parâmetros estão', () => {
    expect(
      requireConsentPage({ request: http('GET'), query: { client_id: 'c' } }, undefined),
    ).toEqual({ context: { query: { client_id: 'c', prompt: 'consent' } } });
    expect(
      requireConsentPage(
        { request: http('POST'), body: { client_id: 'c', prompt: 'login' } },
        undefined,
      ),
    ).toEqual({ context: { body: { client_id: 'c', prompt: 'login consent' } } });
    expect(
      requireConsentPage(
        { request: signIn, body: { email: 'x' }, query: { client_id: 'c' } },
        undefined,
      ),
    ).toEqual({ context: { query: { client_id: 'c', prompt: 'consent' } } });
  });

  it('parte do que o prepareAuthorizeRequest já mudou e não repete o `consent`', () => {
    expect(
      requireConsentPage(
        { request: http('GET'), query: { client_id: 'c' } },
        { context: { query: { client_id: 'c', resource: 'r', prompt: 'consent' } } },
      ),
    ).toEqual({ context: { query: { client_id: 'c', resource: 'r', prompt: 'consent' } } });
  });

  it('prompt=none: interaction_required, sem tela', () => {
    expect(() =>
      requireConsentPage({ request: http('GET'), query: { prompt: 'none' } }, undefined),
    ).toThrow(
      expect.objectContaining({ body: expect.objectContaining({ error: 'interaction_required' }) }),
    );
  });
});

describe('rejectDpop', () => {
  it('recusa o header DPoP e o dpop_jkt; sem eles, passa', () => {
    const invalid = expect.objectContaining({
      body: expect.objectContaining({ error: 'invalid_request' }),
    });
    expect(() => rejectDpop({ headers: new Headers({ dpop: 'x' }) })).toThrow(invalid);
    expect(() => rejectDpop({ query: { dpop_jkt: 'abc' } })).toThrow(invalid);
    expect(() => rejectDpop({ body: { dpop_jkt: 'abc' } })).toThrow(invalid);
    expect(() =>
      rejectDpop({ headers: new Headers({ authorization: 'Bearer x' }), query: { a: '1' } }),
    ).not.toThrow();
  });
});

describe('cliente do pedido de token (tokenRequestClientIdOf, na ordem do plugin)', () => {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const assertion = (payload: unknown) => `${part({ alg: 'EdDSA' })}.${part(payload)}.assinatura`;
  const basic = (id: string, secret = 'segredo') =>
    `Basic ${Buffer.from(`${encodeURIComponent(id)}:${secret}`).toString('base64')}`;
  const A = 'https://a.example.com/client.json';
  const B = 'https://b.example.com/client.json';
  const C = 'https://c.example.com/client.json';

  it('a asserção vem antes do Basic e do corpo; sem `sub`, vale o `iss`', () => {
    expect(
      tokenRequestClientIdOf({ client_assertion: assertion({ sub: A }), client_id: C }, basic(B)),
    ).toBe(A);
    expect(tokenRequestClientIdOf({ client_assertion: assertion({ iss: A }) }, null)).toBe(A);
    expect(clientAssertionSubject(assertion({ sub: A, iss: B }))).toBe(A);
  });

  it('o Basic vem antes do `client_id` do corpo (decodificado como formulário)', () => {
    expect(tokenRequestClientIdOf({ client_id: C }, basic(B))).toBe(B);
    expect(tokenRequestClientIdOf({}, basic('cliente com espaço'))).toBe('cliente com espaço');
    expect(tokenRequestClientIdOf({}, `basic   ${basic(A).slice(6)}`)).toBe(A);
  });

  it('só o corpo: o `client_id` dele', () => {
    expect(tokenRequestClientIdOf({ client_id: C }, null)).toBe(C);
    expect(tokenRequestClientIdOf({ client_id: C }, 'Bearer x.y.z')).toBe(C);
  });

  it('sem cliente identificável: null', () => {
    expect(tokenRequestClientIdOf(undefined, undefined)).toBeNull();
    expect(tokenRequestClientIdOf({ client_id: '' }, null)).toBeNull();
    expect(tokenRequestClientIdOf({ client_id: 42 }, null)).toBeNull();
    expect(tokenRequestClientIdOf({}, 'Basic !!!')).toBeNull();
    expect(
      tokenRequestClientIdOf({ client_assertion: 'nao-e-jwt', client_id: C }, null),
    ).toBeNull();
    expect(clientAssertionSubject(assertion({ sub: 42 }))).toBeNull();
    expect(clientAssertionSubject(assertion({ sub: '' }))).toBeNull();
    expect(clientAssertionSubject(assertion({}))).toBeNull();
    expect(clientAssertionSubject('a.b.c')).toBeNull();
  });
});
