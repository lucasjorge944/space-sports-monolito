import { Redis } from 'ioredis';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CEP_CACHE_PREFIX,
  CEP_FOUND_TTL_SEC,
  CEP_NOT_FOUND_TTL_SEC,
  CEP_RATE_LIMIT,
} from '../../src/address/cep-lookup.service.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer } from '../bookings/fixtures.js';

/** Mesma imagem do docker-compose.yml. */
const REDIS_IMAGE = 'redis:7-alpine';

const CEP = '30130010';
const VIACEP_URL = `https://viacep.com.br/ws/${CEP}/json/`;
const BRASILAPI_URL = `https://brasilapi.com.br/api/cep/v1/${CEP}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const VIACEP_FOUND = () =>
  json({
    cep: '30130-010',
    logradouro: 'Avenida Afonso Pena',
    complemento: '',
    bairro: 'Centro',
    localidade: 'Belo Horizonte',
    uf: 'MG',
  });
const BRASILAPI_FOUND = () =>
  json({
    cep: CEP,
    state: 'MG',
    city: 'Belo Horizonte',
    neighborhood: 'Centro',
    street: 'Avenida Afonso Pena',
    service: 'correios',
  });
const ADDRESS = {
  postalCode: CEP,
  street: 'Avenida Afonso Pena',
  neighborhood: 'Centro',
  city: 'Belo Horizonte',
  state: 'MG',
};

type Reply = () => Response;

/** HTTP simulado: nada sai para a rede, e um provedor sem resposta definida falha o teste. */
function simulate(fetchMock: ReturnType<typeof vi.fn>, replies: { via?: Reply; api?: Reply }) {
  fetchMock.mockImplementation(async (url: string) => {
    const reply = String(url).startsWith('https://viacep.com.br/') ? replies.via : replies.api;
    if (!reply) throw new Error(`Chamada inesperada: ${url}`);
    return reply();
  });
}

const timeout = () => {
  throw new DOMException('O provedor demorou demais.', 'TimeoutError');
};

describe('busca de CEP (decisão 52)', () => {
  let container: StartedTestContainer;
  let redis: Redis;
  let t: TestApp;
  let user: SignedUp;
  const fetchMock = vi.fn();

  const lookup = (cep: string, as = user) =>
    t
      .http()
      .get(`/v1/address/cep/${encodeURIComponent(cep)}`)
      .set(...bearer(as));

  const calledUrls = () => fetchMock.mock.calls.map(([url]) => String(url));
  const ttlOf = (cep: string) => redis.ttl(`${CEP_CACHE_PREFIX}${cep}`);

  beforeAll(async () => {
    container = await new GenericContainer(REDIS_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();
    const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
    redis = new Redis(url);
    t = await createTestApp({ env: { REDIS_URL: url, AUTH_RATE_LIMIT_ENABLED: 'true' } });
    user = await signUp(t, 'cep@exemplo.com');
  });
  beforeEach(async () => {
    await redis.flushall();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await t?.close();
    redis?.disconnect();
    await container?.stop();
  });

  it('exige sessão', async () => {
    await t.http().get(`/v1/address/cep/${CEP}`).expect(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normaliza o CEP e devolve logradouro, bairro, cidade e UF', async () => {
    simulate(fetchMock, { via: VIACEP_FOUND });
    const res = await lookup('30130-010').expect(200);
    expect(res.body).toEqual(ADDRESS);
    expect(calledUrls()).toEqual([VIACEP_URL]);
    // Timeout curto no provedor.
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('CEP sem 8 dígitos é 422 CEP_INVALID, sem consultar ninguém', async () => {
    for (const cep of ['3013001', '301300100', '3013001a', 'abc']) {
      const res = await lookup(cep).expect(422);
      expect(res.body.error.code).toBe('CEP_INVALID');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('guarda o endereço por 30 dias e não consulta de novo', async () => {
    simulate(fetchMock, { via: VIACEP_FOUND });
    await lookup(CEP).expect(200);
    expect(await ttlOf(CEP)).toBeGreaterThan(CEP_FOUND_TTL_SEC - 60);
    expect(await ttlOf(CEP)).toBeLessThanOrEqual(CEP_FOUND_TTL_SEC);

    const cached = await lookup('30130-010').expect(200);
    expect(cached.body).toEqual(ADDRESS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['boolean', true],
    ['texto', 'true'],
  ])('CEP inexistente no ViaCEP (erro em %s): 404, guardado por 1 dia', async (_, erro) => {
    simulate(fetchMock, { via: () => json({ erro }) });
    const res = await lookup(CEP).expect(404);
    expect(res.body.error.code).toBe('CEP_NOT_FOUND');
    expect(calledUrls()).toEqual([VIACEP_URL]);
    expect(await ttlOf(CEP)).toBeGreaterThan(CEP_NOT_FOUND_TTL_SEC - 60);
    expect(await ttlOf(CEP)).toBeLessThanOrEqual(CEP_NOT_FOUND_TTL_SEC);

    await lookup(CEP).expect(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Reply]>([
    ['erro 500', () => json({ message: 'fora do ar' }, 500)],
    ['timeout', timeout],
    ['corpo sem os campos', () => json({ cep: CEP })],
    ['corpo que não é JSON', () => new Response('<html>', { status: 200 })],
  ])('ViaCEP com %s: usa a BrasilAPI como reserva', async (_, via) => {
    simulate(fetchMock, { via, api: BRASILAPI_FOUND });
    const res = await lookup(CEP).expect(200);
    expect(res.body).toEqual(ADDRESS);
    expect(calledUrls()).toEqual([VIACEP_URL, BRASILAPI_URL]);
    expect(await ttlOf(CEP)).toBeGreaterThan(CEP_FOUND_TTL_SEC - 60);
  });

  it('ViaCEP indisponível e BrasilAPI sem o CEP: 404, guardado por 1 dia', async () => {
    simulate(fetchMock, { via: timeout, api: () => json({ name: 'CepPromiseError' }, 404) });
    const res = await lookup(CEP).expect(404);
    expect(res.body.error.code).toBe('CEP_NOT_FOUND');
    expect(await ttlOf(CEP)).toBeLessThanOrEqual(CEP_NOT_FOUND_TTL_SEC);
    expect(await ttlOf(CEP)).toBeGreaterThan(0);
  });

  it('os dois fora do ar: 503 CEP_LOOKUP_UNAVAILABLE, sem guardar a falha', async () => {
    simulate(fetchMock, { via: timeout, api: () => json({}, 503) });
    const res = await lookup(CEP).expect(503);
    expect(res.body.error.code).toBe('CEP_LOOKUP_UNAVAILABLE');
    expect(await redis.exists(`${CEP_CACHE_PREFIX}${CEP}`)).toBe(0);

    simulate(fetchMock, { via: VIACEP_FOUND });
    await lookup(CEP).expect(200);
  });

  it('CEP geral do município: logradouro e bairro nulos', async () => {
    simulate(fetchMock, {
      via: () => json({ logradouro: '', bairro: ' ', localidade: 'Itabirito', uf: 'MG' }),
    });
    const res = await lookup(CEP).expect(200);
    expect(res.body).toEqual({
      postalCode: CEP,
      street: null,
      neighborhood: null,
      city: 'Itabirito',
      state: 'MG',
    });
  });

  it('cache corrompido vale como vazio', async () => {
    await redis.set(`${CEP_CACHE_PREFIX}${CEP}`, 'não é json');
    simulate(fetchMock, { via: VIACEP_FOUND });
    await lookup(CEP).expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('limita por usuário: 429 TOO_MANY_REQUESTS, sem afetar os outros', async () => {
    simulate(fetchMock, { via: VIACEP_FOUND });
    for (let i = 0; i < CEP_RATE_LIMIT.max; i++) await lookup(CEP).expect(200);

    const blocked = await lookup(CEP).expect(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(blocked.body.error.details.retryAfter).toBeGreaterThan(0);

    const other = await signUp(t, 'cep-outro@exemplo.com');
    await lookup(CEP, other).expect(200);
  });

  describe('sem Redis', () => {
    let offline: TestApp;
    let account: SignedUp;

    beforeAll(async () => {
      // O REDIS_URL padrão dos testes aponta para uma porta sem ninguém.
      offline = await createTestApp({ env: { AUTH_RATE_LIMIT_ENABLED: 'true' } });
      account = await signUp(offline, 'sem-redis@exemplo.com');
    });
    afterAll(() => offline?.close());

    it('a busca continua funcionando, só sem cache', async () => {
      simulate(fetchMock, { via: VIACEP_FOUND });
      for (let i = 1; i <= 2; i++) {
        await offline
          .http()
          .get(`/v1/address/cep/${CEP}`)
          .set(...bearer(account))
          .expect(200);
        expect(fetchMock).toHaveBeenCalledTimes(i);
      }
    });
  });
});
