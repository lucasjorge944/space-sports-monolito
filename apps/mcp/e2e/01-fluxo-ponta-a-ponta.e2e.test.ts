import type { Client } from '@modelcontextprotocol/client';
import { MCP_OAUTH_SCOPES, MCP_RESOURCE_SCOPES } from '@space-sports/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import { API_URL, ISSUER, MCP_URL, USERS } from './support/env.js';
import {
  bookingRow,
  brl,
  createOpenClassSession,
  pickSlot,
  userByEmail,
} from './support/helpers.js';
import { call, mcpClient, ok, rawMcp } from './support/mcp.js';
import {
  CLIENT_ID,
  type Connected,
  connect,
  decodeJwt,
  disconnectAll,
  refreshTokens,
} from './support/oauth.js';

/**
 * (1) Ponta a ponta local — RF-MCP-01 a 04, RN-MCP-01 a 04. Tudo por HTTP, como o Claude faria:
 * descoberta (metadata do recurso e do servidor de autorização) → CIMD + PKCE → login do usuário do
 * seed → consentimento → token → cliente MCP do SDK por Streamable HTTP.
 * Usuário: jogador3.e2e (aluno de turma da Arena E2E).
 */
describe('jornada completa pelo OAuth e pelo cliente MCP', () => {
  let session: Connected;
  let client: Client;
  let userId: string;
  const created: { onSite?: string; pix?: string } = {};

  beforeAll(async () => {
    userId = (await userByEmail(USERS.c)).id;
    // Parte sempre da tela de consentimento (reexecução sem reseed deixaria o cliente já autorizado).
    await disconnectAll(USERS.c);
  });

  afterAll(async () => {
    await client?.close();
  });

  it('RF-MCP-01: o MCP sem token responde 401 e aponta o metadata do recurso (RFC 9728)', async () => {
    const res = await rawMcp({});
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toMatch(/^Bearer/i);
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
    expect(metadataUrl).toBeTruthy();

    const resource = await (await fetch(metadataUrl as string)).json();
    expect(resource.resource).toBe(MCP_URL);
    expect(resource.authorization_servers).toEqual([ISSUER]);
    // Fase 2 (MCP2.3): o conector do jogador anuncia também os escopos de gestão (decisão 121).
    expect(resource.scopes_supported).toEqual([...MCP_RESOURCE_SCOPES.USER]);
    expect(resource.bearer_methods_supported).toEqual(['header']);
  });

  it('metadata do servidor de autorização (RFC 8414, emissor com caminho): S256, CIMD e endpoints', async () => {
    const res = await fetch(`${API_URL}/.well-known/oauth-authorization-server/v1/auth`);
    expect(res.status).toBe(200);
    const meta = await res.json();
    expect(meta.issuer).toBe(ISSUER);
    expect(meta.authorization_endpoint).toBe(`${ISSUER}/oauth2/authorize`);
    expect(meta.token_endpoint).toBe(`${ISSUER}/oauth2/token`);
    expect(meta.jwks_uri).toBe(`${ISSUER}/jwks`);
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    expect(meta.grant_types_supported).toEqual(
      expect.arrayContaining(['authorization_code', 'refresh_token']),
    );
    expect(meta.client_id_metadata_document_supported).toBe(true);
    // Rotas desligadas não aparecem no metadata.
    expect(meta.userinfo_endpoint).toBeUndefined();
  });

  it('RF-MCP-01: authorize (PKCE S256) → /entrar → login → /autorizar → consentimento → token', async () => {
    session = await connect(USERS.c);
    const { header, payload } = decodeJwt(session.tokens.access_token);
    expect(header).toMatchObject({ alg: 'EdDSA', typ: 'at+jwt' });
    expect(payload).toMatchObject({
      iss: ISSUER,
      aud: MCP_URL,
      sub: userId,
      azp: CLIENT_ID,
    });
    expect(payload.exp - payload.iat).toBe(15 * 60);
    expect(session.tokens.token_type.toLowerCase()).toBe('bearer');
    expect(session.tokens.refresh_token).toBeTruthy();
    expect(session.tokens.scope.split(' ')).toEqual(
      expect.arrayContaining([...MCP_OAUTH_SCOPES, 'offline_access']),
    );
    // Tela de consentimento: cliente do CIMD com o domínio verificado e os cinco escopos.
    expect(session.consentRequest?.client).toMatchObject({
      clientId: CLIENT_ID,
      host: 'cimd.e2e.test',
    });
    expect(session.consentRequest?.scopes).toEqual([...MCP_OAUTH_SCOPES]);
  });

  it('RF-MCP-01: o SDK conecta por HTTP e lista as 14 tools', async () => {
    client = await mcpClient(session.tokens.access_token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'get_my_profile',
        'search_spaces',
        'get_space',
        'check_availability',
        'list_space_classes',
        'list_my_bookings',
        'get_booking',
        'prepare_booking',
        'create_booking',
        'prepare_cancel_booking',
        'cancel_booking',
        'list_my_classes',
        'confirm_class_attendance',
        'cancel_class_attendance',
      ].sort(),
    );
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.search_spaces?.annotations?.readOnlyHint).toBe(true);
    expect(byName.create_booking?.annotations?.readOnlyHint).toBe(false);
    expect(byName.cancel_booking?.annotations?.destructiveHint).toBe(true);
  });

  it('RF-MCP-02: perfil, busca de espaço, detalhes, horários livres e aulas abertas', async () => {
    const profile = await ok(client, 'get_my_profile');
    expect(profile).toEqual({ firstName: 'Jogador', favoriteSports: [] });

    const found = await ok(client, 'search_spaces', { text: 'Arena E2E Norte' });
    expect(found.spaces.map((s: { slug: string }) => s.slug)).toContain('arena-e2e-norte');

    const space = await ok(client, 'get_space', { space: 'arena-e2e' });
    expect(space.space.courts.map((c: { name: string }) => c.name)).toEqual(
      expect.arrayContaining(['Quadra A', 'Quadra B']),
    );
    expect(space.space.rental.pricePerHour.cents).toBe(10_000);

    const slot = await pickSlot(client, 'arena-e2e', 4);
    expect(slot.availability.price).toEqual({ cents: 10_000, formatted: brl(10_000) });

    const classes = await ok(client, 'list_space_classes', { space: 'arena-e2e' });
    expect(JSON.stringify(classes)).toContain('Futevôlei iniciante');
  });

  it('RF-MCP-03: reserva ON_SITE em duas etapas, com canal MCP e organizador certos (RN-MCP-02/03)', async () => {
    const slot = await pickSlot(client, 'arena-e2e', 5);
    const prepared = await ok(client, 'prepare_booking', {
      space: 'arena-e2e',
      date: slot.date,
      startTime: slot.startTime,
      durationMin: 60,
      peopleCount: 2,
      sport: 'futevolei',
      court: slot.court,
      paymentOption: 'ON_SITE',
    });
    expect(prepared.summary.price).toEqual({ cents: 10_000, formatted: brl(10_000) });
    // prepare não grava.
    const input = prepared.confirmation.createBookingInput;
    const before = await sql('select id from bookings where organizer_user_id=$1', [userId]);
    expect(before.map((r) => (r as { id: string }).id)).not.toContain(created.onSite);

    const result = await ok(client, 'create_booking', input);
    expect(result.booking).toMatchObject({
      status: 'CONFIRMED',
      date: slot.date,
      startTime: slot.startTime,
      peopleCount: 2,
    });
    created.onSite = result.booking.id;
    const row = await bookingRow(created.onSite as string);
    expect(row).toMatchObject({ status: 'CONFIRMED', channel: 'MCP', organizer_user_id: userId });

    // Idempotência: repetir com o mesmo código devolve a mesma reserva, sem duplicar.
    const countMcp = async () =>
      Number(
        (
          await sql<{ count: string }>(
            'select count(*) from bookings where organizer_user_id=$1 and channel=$2',
            [userId, 'MCP'],
          )
        )[0]?.count,
      );
    const afterFirst = await countMcp();
    const again = await ok(client, 'create_booking', input);
    expect(again.booking.id).toBe(created.onSite);
    expect(await countMcp()).toBe(afterFirst);
  });

  it('RF-MCP-03: reserva com Pix online (Arena E2E Norte) devolve o Pix copia e cola e o prazo', async () => {
    const slot = await pickSlot(client, 'arena-e2e-norte', 5);
    const prepared = await ok(client, 'prepare_booking', {
      space: 'arena-e2e-norte',
      date: slot.date,
      startTime: slot.startTime,
      durationMin: 60,
      peopleCount: 2,
      sport: 'futevolei',
      court: slot.court,
      paymentOption: 'ONLINE_PIX',
    });
    expect(prepared.summary.payment.option).toBe('ONLINE_PIX');
    const result = await ok(client, 'create_booking', prepared.confirmation.createBookingInput);
    created.pix = result.booking.id;
    // A reserva nasce confirmada e o pagamento fica pendente até o Pix (RN-ONPAY-02).
    expect(result.booking.status).toBe('CONFIRMED');
    expect(result.booking.payment).toMatchObject({ status: 'PENDING' });
    expect(result.booking.payment.pix.copyPaste).toMatch(/^000201.*br\.gov\.bcb\.pix/);
    expect(result.booking.payment.pix.amount).toEqual({ cents: 10_000, formatted: brl(10_000) });
    expect(result.booking.payment.pix.expiresAt.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const charges = await sql(
      "select status from online_charges where payable_type='BOOKING' and payable_id=$1",
      [created.pix],
    );
    expect(charges).toHaveLength(1);

    const detail = await ok(client, 'get_booking', { bookingId: created.pix });
    expect(detail.booking.id).toBe(created.pix);
  });

  it('RF-MCP-03: list_my_bookings e get_booking mostram só as próprias reservas', async () => {
    const mine = await ok(client, 'list_my_bookings');
    const ids = mine.bookings.map((b: { id: string }) => b.id);
    expect(ids).toEqual(expect.arrayContaining([created.onSite, created.pix]));
    const detail = await ok(client, 'get_booking', { bookingId: created.onSite });
    expect(detail.booking.id).toBe(created.onSite);
    expect(detail.booking.status).toBe('CONFIRMED');
  });

  it('RF-MCP-03: cancelamento em duas etapas (ON_SITE e Pix), idempotente depois de cancelada', async () => {
    for (const id of [created.onSite, created.pix] as string[]) {
      const prepared = await ok(client, 'prepare_cancel_booking', { bookingId: id });
      const cancelled = await ok(
        client,
        'cancel_booking',
        prepared.confirmation.cancelBookingInput,
      );
      expect(cancelled.booking.status).toBe('CANCELLED');
      expect((await bookingRow(id))?.status).toBe('CANCELLED');
      // Repetir numa reserva já cancelada devolve a reserva, sem erro (docs/14-mcp.md, seção 6).
      const again = await call(client, 'cancel_booking', prepared.confirmation.cancelBookingInput);
      expect(again.isError).toBe(false);
    }
    const pixCharge = await sql<{ status: string }>(
      "select status from online_charges where payable_type='BOOKING' and payable_id=$1",
      [created.pix],
    );
    expect(pixCharge[0]?.status).not.toBe('PAID');
  });

  it('RF-MCP-04: lista as próprias aulas e confirma e desmarca presença', async () => {
    const session = await createOpenClassSession();
    const mine = await ok(client, 'list_my_classes', {
      from: new Date(session.startsAt.getTime() - 86_400_000).toISOString().slice(0, 10),
      to: new Date(session.startsAt.getTime() + 2 * 86_400_000).toISOString().slice(0, 10),
    });
    const found = mine.classes.find((c: { id: string }) => c.id === session.id);
    expect(found, JSON.stringify(mine)).toBeTruthy();

    const confirmed = await ok(client, 'confirm_class_attendance', { sessionId: session.id });
    expect(confirmed.class.myAttendance.status).toBe('CONFIRMED');
    const [row] = await sql<{ status: string }>(
      'select status from attendances where session_id=$1 and user_id=$2',
      [session.id, userId],
    );
    expect(row?.status).toBe('CONFIRMED');

    const withdrawn = await ok(client, 'cancel_class_attendance', { sessionId: session.id });
    expect(withdrawn.class.myAttendance?.status ?? null).not.toBe('CONFIRMED');
    const after = await sql<{ status: string }>(
      'select status from attendances where session_id=$1 and user_id=$2',
      [session.id, userId],
    );
    expect(after.every((r) => r.status !== 'CONFIRMED')).toBe(true);
  });

  it('RN-MCP-03: cada escrita fica em audit_logs com origem MCP e o id do cliente', async () => {
    const rows = await sql<{ action: string; diff: Record<string, unknown> | null }>(
      `select action, diff from audit_logs where actor_id=$1 and created_at > now() - interval '15 minutes' order by created_at`,
      [userId],
    );
    const requests = rows.filter((r) => r.action === 'mcp.request');
    // 2 criações (+1 repetida) + 2 cancelamentos (+2 repetidos) + 2 presenças.
    expect(requests.length).toBeGreaterThanOrEqual(6);
    for (const r of rows.filter((r) => r.diff && 'origin' in r.diff)) {
      expect(r.diff).toMatchObject({ origin: 'MCP', oauthClientId: CLIENT_ID });
    }
  });

  it('RN-MCP-01: o refresh token rotaciona e o novo access token vale no MCP', async () => {
    const refreshed = await refreshTokens(session.tokens.refresh_token as string);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).not.toBe(session.tokens.access_token);
    expect(refreshed.body.refresh_token).not.toBe(session.tokens.refresh_token);
    const fresh = await mcpClient(refreshed.body.access_token);
    try {
      expect((await ok(fresh, 'get_my_profile')).firstName).toBe('Jogador');
    } finally {
      await fresh.close();
    }
  });

  it('o fluxo só tocou nos dois espaços da jornada e deixou as reservas canceladas', async () => {
    const rows = await sql<{ id: string; status: string; slug: string }>(
      `select b.id, b.status, s.slug from bookings b join spaces s on s.id = b.space_id
        where b.organizer_user_id=$1 and b.channel='MCP' and b.created_at > now() - interval '10 minutes'`,
      [userId],
    );
    const mine = rows.filter((r) => r.id === created.onSite || r.id === created.pix);
    expect(mine.map((r) => [r.slug, r.status]).sort()).toEqual([
      ['arena-e2e', 'CANCELLED'],
      ['arena-e2e-norte', 'CANCELLED'],
    ]);
    expect(rows.every((r) => ['arena-e2e', 'arena-e2e-norte'].includes(r.slug))).toBe(true);
  });
});
