import { expect, type Page, test } from './fixtures';
import { loginAs, MOCK_API, mockCalls, PASSWORD, users } from './helpers';

// MCP.3 (RF-MCP-01 e RF-MCP-05, docs/14-mcp.md seção 3.5): /entrar → /autorizar → redirect e Apps conectados.

const ASSISTANT = 'https://assistente.exemplo/cimd';
const SCOPE_TEXTS = [
  'Ver espaços, quadras, horários e aulas',
  'Ver suas reservas',
  'Reservar e cancelar quadras em seu nome',
  'Ver suas aulas',
  'Confirmar e desmarcar presença em aulas',
];

/** `/entrar` ou `/autorizar` como o authorize da API monta: parâmetros do pedido + `exp`, `ba_*` e `sig`. */
function flowUrl(
  path: '/entrar' | '/autorizar',
  clientId = ASSISTANT,
  expiresInSeconds = 600,
  scope = 'spaces:read bookings:read bookings:write classes:read classes:write offline_access',
  resource = 'https://mcp.exemplo/mcp',
) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: `${MOCK_API}/__client-callback`,
    scope,
    state: 'estado-123',
    code_challenge: 'desafio',
    code_challenge_method: 'S256',
    resource,
    exp: String(Math.floor(Date.now() / 1000) + expiresInSeconds),
    ba_iat: String(Date.now()),
  });
  for (const name of [...params.keys(), 'ba_param']) params.append('ba_param', name);
  params.set('sig', 'assinatura');
  return `${path}?${params}`;
}

// Fase 2 (docs/14-mcp.md 8.1): o conector do jogador e da gestão pede os 7 escopos; o da plataforma, só `super:read`.
const USER_CONNECTOR_SCOPE = `${'spaces:read bookings:read bookings:write classes:read classes:write manage:read manage:finance:read'} offline_access`;
const ADMIN_CONNECTOR_SCOPE = 'super:read offline_access';
const ADMIN_RESOURCE = 'https://mcp-admin.exemplo/mcp';
const MANAGE_TEXT =
  'Ver a agenda, as reservas, as quadras, as aulas, a presença, as avaliações e a equipe dos espaços em que você trabalha';
const FINANCE_TEXT =
  'Ver recebimentos, extrato, mensalidades, inadimplência e pagamentos online dos espaços em que você é Dono ou Admin';
const SUPER_TEXT = 'Ler os dados de todos os espaços, usuários e pagamentos da plataforma';
const PLATFORM_NOTICE =
  'O assistente vai poder LER dados de todos os espaços da plataforma. Somente leitura; a conexão vale por até 24 horas.';

const userConnector = (clientId = ASSISTANT) =>
  flowUrl('/autorizar', clientId, 600, USER_CONNECTOR_SCOPE);
const adminConnector = (clientId = ASSISTANT) =>
  flowUrl('/autorizar', clientId, 600, ADMIN_CONNECTOR_SCOPE, ADMIN_RESOURCE);

const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#06202E"/></svg>';

async function setup(page: Page, query: string) {
  await page.request.get(`${MOCK_API}/__mcp-setup?${query}`);
}

test.describe('login dentro do fluxo OAuth', () => {
  test('jogador sem espaço entra pelo fluxo e cai no consentimento, não no painel', async ({
    page,
  }) => {
    await page.goto(flowUrl('/entrar'));
    await page.getByLabel('E-mail').fill(users.player);
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();

    await expect(page).toHaveURL(/\/autorizar\?/);
    await expect(page.getByTestId('client-name')).toHaveText('Assistente Exemplo');
    // O login levou o pedido assinado, não a página.
    const login = (await mockCalls(page.request)).find((call) => call.path === '/sign-in/email');
    expect(String(login?.body.oauth_query)).toContain('sig=assinatura');
  });

  test('gestor também volta ao fluxo, em vez de ir para o /painel', async ({ page }) => {
    await page.goto(flowUrl('/entrar'));
    await page.getByLabel('E-mail').fill(users.manager);
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/autorizar\?/);
  });

  test('já logado, o /entrar do fluxo oferece "Continuar como" e segue para o consentimento', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'player');
    await page.goto(flowUrl('/entrar'));
    await expect(page).toHaveURL(/\/entrar\?/);
    await expect(page.getByTestId('oauth-account')).toContainText(users.player);
    await page.getByRole('button', { name: 'Continuar como Jogador' }).click();
    await expect(page).toHaveURL(/\/autorizar\?/);
    await expect(page.getByRole('heading', { name: 'Permitir acesso' })).toBeAttached();
  });

  test('"Usar outra conta" encerra a sessão e mostra o login do fluxo', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'player');
    await page.goto(flowUrl('/entrar'));
    await page.getByRole('button', { name: 'Usar outra conta' }).click();
    await expect(page.getByLabel('E-mail')).toBeVisible();
    await expect(page).toHaveURL(/\/entrar\?.*sig=assinatura/);
  });

  test('/entrar comum continua mandando quem já tem sessão para a própria área', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/entrar');
    await expect(page).toHaveURL(/\/painel$/);
  });

  test('sem sessão, /autorizar volta ao /entrar com a mesma query', async ({ page }) => {
    await page.goto(flowUrl('/autorizar'));
    await expect(page).toHaveURL(/\/entrar\?.*sig=assinatura/);
    await expect(page.getByLabel('E-mail')).toBeVisible();
  });
});

test.describe('consentimento (/autorizar)', () => {
  test.beforeEach(async ({ context }) => {
    await loginAs(context, 'player');
  });

  test('mostra o cliente, a conta, os escopos em português, o aviso e os botões', async ({
    page,
  }) => {
    await page.goto(flowUrl('/autorizar'));
    await expect(page.getByTestId('client-name')).toHaveText('Assistente Exemplo');
    await expect(page.getByTestId('client-host')).toHaveText('assistente.exemplo');
    await expect(page.getByRole('link', { name: 'Página do aplicativo' })).toHaveAttribute(
      'href',
      'https://assistente.exemplo',
    );
    await expect(page.getByTestId('consent-account')).toContainText(
      `Entrou como Jogador Caio (${users.player})`,
    );
    await expect(page.getByRole('button', { name: 'Não é você? Trocar de conta' })).toBeVisible();
    for (const text of SCOPE_TEXTS)
      await expect(page.getByText(text, { exact: true })).toBeVisible();
    // `offline_access` é de protocolo: não aparece como permissão.
    await expect(page.getByText('offline_access')).toHaveCount(0);
    await expect(
      page.getByText(
        'O assistente vai poder agir em seu nome dentro desses limites. Você pode desconectar quando quiser em Apps conectados.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Apps conectados' })).toHaveAttribute(
      'href',
      '/conta/apps-conectados',
    );
    await expect(page.getByRole('button', { name: 'Permitir' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
  });

  test('cliente sem logo nem página não mostra link e usa iniciais', async ({ page }) => {
    await page.goto(flowUrl('/autorizar', 'https://sem-logo.exemplo/cimd'));
    await expect(page.getByTestId('client-name')).toHaveText('Zeca IA');
    await expect(page.getByRole('link', { name: 'Página do aplicativo' })).toHaveCount(0);
  });

  test('logo https carrega sem mandar o referrer ao domínio do cliente', async ({ page }) => {
    let referer: string | undefined = 'não chamou';
    await page.route('https://assistente.exemplo/logo.svg', async (route) => {
      referer = (await route.request().allHeaders()).referer;
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: LOGO_SVG });
    });
    await page.goto(flowUrl('/autorizar'));
    const logo = page.locator('[data-slot="space-avatar"] img');
    await expect(logo).toHaveAttribute('src', 'https://assistente.exemplo/logo.svg');
    await expect(logo).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect.poll(() => referer).toBeUndefined();
  });

  test('logo em http: nem é pedida (a imagem seria carregada se o web a aceitasse)', async ({
    page,
  }) => {
    let requested = false;
    await page.route('http://logo-http.exemplo/logo.svg', async (route) => {
      requested = true;
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: LOGO_SVG });
    });
    await page.goto(flowUrl('/autorizar', 'https://logo-http.exemplo/cimd'));
    await expect(page.getByTestId('client-name')).toHaveText('Assistente Sem Cadeado');
    await page.waitForLoadState('networkidle');
    expect(requested).toBe(false);
    await expect(page.locator('[data-slot="space-avatar"] img')).toHaveCount(0);
  });

  test('logo javascript: não vira imagem', async ({ page }) => {
    await page.goto(flowUrl('/autorizar', 'https://logo-js.exemplo/cimd'));
    await expect(page.getByTestId('client-name')).toHaveText('Assistente Script');
    await expect(page.locator('[data-slot="space-avatar"] img')).toHaveCount(0);
  });

  test('escopo desconhecido não aparece como item em branco nem com o código', async ({ page }) => {
    await page.goto(flowUrl('/autorizar', 'https://escopo-novo.exemplo/cimd'));
    const scopes = page.getByRole('region', { name: 'Este assistente poderá:' });
    await expect(scopes.getByRole('listitem')).toHaveCount(5);
    await expect(page.getByText('admin:all')).toHaveCount(0);
  });

  test('destino de redirect que não é seguro (javascript:) é recusado', async ({ page }) => {
    await page.goto(flowUrl('/autorizar', 'https://redirect-ruim.exemplo/cimd'));
    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page.locator('[data-slot="alert"]')).toHaveText(
      'Não foi possível concluir. Tente novamente.',
    );
    await expect(page).toHaveURL(/\/autorizar\?/);
    expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
    await expect(page.getByRole('button', { name: 'Permitir' })).toBeEnabled();
  });

  test('Permitir devolve o código ao cliente e a conexão passa a existir', async ({ page }) => {
    await setup(page, 'apps=empty');
    await page.goto(flowUrl('/autorizar'));
    await page.getByRole('button', { name: 'Permitir' }).click();

    await expect(page).toHaveURL(/__client-callback\?.*code=codigo-de-teste/);
    await expect(page).toHaveURL(/state=estado-123/);
    const consent = (await mockCalls(page.request)).find((call) => call.path === '/oauth2/consent');
    expect(consent?.body.accept).toBe(true);
    expect(String(consent?.body.oauth_query)).toContain('sig=assinatura');

    await page.goto('/conta/apps-conectados');
    await expect(page.getByTestId('connected-app')).toHaveCount(1);
    await expect(page.getByTestId('connected-app')).toContainText('Assistente Exemplo');
  });

  test('Cancelar devolve access_denied ao cliente e não cria conexão', async ({ page }) => {
    await setup(page, 'apps=empty');
    await page.goto(flowUrl('/autorizar'));
    await page.getByRole('button', { name: 'Cancelar' }).click();

    await expect(page).toHaveURL(/__client-callback\?.*error=access_denied/);
    await expect(page).not.toHaveURL(/code=/);
    const consent = (await mockCalls(page.request)).find((call) => call.path === '/oauth2/consent');
    expect(consent?.body.accept).toBe(false);

    await page.goto('/conta/apps-conectados');
    await expect(page.getByText('Nenhum app conectado')).toBeVisible();
  });

  test('falha do servidor ao permitir mostra o erro e deixa tentar de novo', async ({ page }) => {
    await page.goto(flowUrl('/autorizar', 'https://instavel.exemplo/cimd'));
    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page.locator('[data-slot="alert"]')).toHaveText(
      'Não foi possível concluir. Tente novamente.',
    );
    await expect(page.getByRole('button', { name: 'Permitir' })).toBeEnabled();
    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page).toHaveURL(/__client-callback\?.*code=/);
  });

  test('pedido que vence antes do Permitir vira o estado de erro, sem detalhe técnico', async ({
    page,
  }) => {
    await page.goto(flowUrl('/autorizar', 'https://gone.exemplo/cimd'));
    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page.getByRole('heading', { name: 'Pedido inválido ou vencido' })).toBeAttached();
    await expect(page.getByText(/Volte ao assistente e tente conectar de novo/)).toBeVisible();
    await expect(page.getByText(/invalid_|OAUTH_|signature/i)).toHaveCount(0);
  });

  test('pedido vencido (API recusa) mostra o estado de erro e nenhum botão de permitir', async ({
    page,
  }) => {
    await page.goto(flowUrl('/autorizar', 'https://vencido.exemplo/cimd'));
    await expect(page.getByRole('heading', { name: 'Pedido inválido ou vencido' })).toBeAttached();
    await expect(page.getByRole('button', { name: 'Permitir' })).toHaveCount(0);
    await expect(page.getByText(/invalid_|OAUTH_|signature/i)).toHaveCount(0);
  });

  test('cliente que não existe mais cai no mesmo estado de erro', async ({ page }) => {
    await page.goto(flowUrl('/autorizar', 'https://sumiu.exemplo/cimd'));
    await expect(page.getByRole('heading', { name: 'Pedido inválido ou vencido' })).toBeAttached();
  });

  test('pedido já vencido pelo prazo (exp no passado) não pede consentimento', async ({ page }) => {
    await page.goto(flowUrl('/autorizar', ASSISTANT, -5));
    await expect(page.getByRole('heading', { name: 'Pedido inválido ou vencido' })).toBeAttached();
  });

  test('pedido que vence com a página aberta passa a "vencido" sozinho', async ({ page }) => {
    await page.goto(flowUrl('/autorizar', ASSISTANT, 3));
    await expect(page.getByRole('button', { name: 'Permitir' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pedido inválido ou vencido' })).toBeAttached({
      timeout: 8000,
    });
    await expect(page.getByRole('button', { name: 'Permitir' })).toHaveCount(0);
  });

  test('"Trocar de conta" sai e volta ao login do fluxo', async ({ page }) => {
    await page.goto(flowUrl('/autorizar'));
    await page.getByRole('button', { name: 'Não é você? Trocar de conta' }).click();
    await expect(page).toHaveURL(/\/entrar\?.*sig=assinatura/);
    await expect(page.getByLabel('E-mail')).toBeVisible();
  });
});

test.describe('consentimento por conta e conector (fase 2, RN-MCP-06)', () => {
  const groups = (page: Page) => page.getByRole('region', { name: 'Este assistente poderá:' });

  test('jogador sem papel: só "Como jogador"; a gestão aparece como fora da conexão', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'player');
    await setup(page, 'apps=empty');
    await page.goto(userConnector());
    await expect(page.getByRole('heading', { name: 'Permitir acesso', exact: true })).toBeVisible();
    await expect(groups(page).getByRole('heading', { name: 'Como jogador' })).toBeVisible();
    await expect(groups(page).getByRole('listitem')).toHaveCount(5);
    await expect(page.getByText('Gestão dos seus espaços')).toHaveCount(1);
    await expect(groups(page).getByText(MANAGE_TEXT)).toHaveCount(0);
    await expect(groups(page).getByText(FINANCE_TEXT)).toHaveCount(0);
    const denied = page.getByRole('region', { name: 'Fora desta conexão' });
    await expect(denied).toContainText('não é da equipe de nenhum espaço');
    await expect(page.getByTestId('platform-notice')).toHaveCount(0);

    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page).toHaveURL(/__client-callback\?.*code=codigo-de-teste/);
    await page.goto('/conta/apps-conectados');
    const app = page.getByTestId('connected-app');
    await expect(app).toHaveCount(1);
    await expect(app.getByText(MANAGE_TEXT)).toHaveCount(0);
    await expect(app.getByText('Ver suas reservas')).toBeVisible();
  });

  test('Professor: gestão sim, com o aviso do papel; valores ficam de fora', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'teacher');
    await setup(page, 'apps=empty');
    await page.goto(userConnector());
    await expect(groups(page).getByRole('heading', { name: 'Como jogador' })).toBeVisible();
    const manage = page.getByTestId('consent-group-manage');
    await expect(manage.getByRole('heading', { name: 'Gestão dos seus espaços' })).toBeVisible();
    await expect(manage.getByText(MANAGE_TEXT)).toBeVisible();
    await expect(manage).toContainText('espaços em que você é da equipe');
    await expect(manage).toContainText('O Professor não vê valores');
    await expect(groups(page).getByText(FINANCE_TEXT)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Fora desta conexão' })).toContainText(
      'só Dono e Admin',
    );

    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page).toHaveURL(/code=codigo-de-teste/);
    await page.goto('/conta/apps-conectados');
    const app = page.getByTestId('connected-app');
    await expect(app.getByText(MANAGE_TEXT)).toBeVisible();
    await expect(app.getByText(FINANCE_TEXT)).toHaveCount(0);
  });

  test('Dono: gestão e financeiro, sem nada fora da conexão', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await setup(page, 'apps=empty');
    await page.goto(userConnector());
    const manage = page.getByTestId('consent-group-manage');
    await expect(manage.getByText(MANAGE_TEXT)).toBeVisible();
    await expect(manage.getByText(FINANCE_TEXT)).toBeVisible();
    await expect(manage.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('region', { name: 'Fora desta conexão' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page).toHaveURL(/code=codigo-de-teste/);
    await page.goto('/conta/apps-conectados');
    const app = page.getByTestId('connected-app');
    await expect(app.getByText(FINANCE_TEXT)).toBeVisible();
    await expect(app.getByRole('heading', { name: 'Gestão dos seus espaços' })).toBeVisible();
  });

  test('Admin também recebe o financeiro', async ({ page, context }) => {
    await loginAs(context, 'admin');
    await page.goto(userConnector());
    await expect(page.getByTestId('consent-group-manage').getByText(FINANCE_TEXT)).toBeVisible();
  });

  test('Super no conector da plataforma: título e aviso próprios, só leitura, sem escopos de jogador', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'super');
    await setup(page, 'apps=empty');
    await page.goto(adminConnector());
    await expect(page.getByRole('heading', { name: 'Permitir acesso à plataforma' })).toBeVisible();
    await expect(page.getByTestId('platform-notice')).toHaveText(PLATFORM_NOTICE);
    await expect(groups(page).getByRole('heading', { name: 'Painel da plataforma' })).toBeVisible();
    await expect(groups(page).getByText(SUPER_TEXT)).toBeVisible();
    await expect(groups(page).getByRole('listitem')).toHaveCount(1);
    await expect(page.getByText('agir em seu nome')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Fora desta conexão' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page).toHaveURL(/code=codigo-de-teste/);

    await page.goto('/conta/apps-conectados');
    const app = page.getByTestId('connected-app');
    await expect(app).toHaveCount(1);
    await expect(app.getByTestId('connected-app-connector')).toHaveText(
      'Conector: Space Sports · Plataforma',
    );
    await expect(app.getByText(SUPER_TEXT)).toBeVisible();
    await expect(app.getByTestId('connected-app-expiry')).toContainText('Expira em');
  });

  test('Super no conector do jogador: só jogador, sem painel da plataforma', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'super');
    await page.goto(userConnector());
    await expect(groups(page).getByRole('listitem')).toHaveCount(5);
    await expect(groups(page).getByText(SUPER_TEXT)).toHaveCount(0);
  });

  for (const profile of ['player', 'manager', 'teacher'] as const) {
    test(`${profile} (não-Super) no conector da plataforma: "sua conta não tem acesso", sem Permitir`, async ({
      page,
      context,
    }) => {
      await loginAs(context, profile);
      await setup(page, 'apps=empty');
      await page.goto(adminConnector());
      await expect(page.getByRole('heading', { name: 'Sua conta não tem acesso' })).toBeVisible();
      await expect(page.getByTestId('consent-no-access')).toContainText(
        'Nada foi liberado para o assistente',
      );
      await expect(page.getByRole('button', { name: 'Permitir' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Trocar de conta' })).toBeVisible();

      await page.getByRole('button', { name: 'Voltar ao assistente' }).click();
      await expect(page).toHaveURL(/__client-callback\?.*error=access_denied/);
      await expect(page).not.toHaveURL(/code=/);
      const consent = (await mockCalls(page.request)).find(
        (call) => call.path === '/oauth2/consent',
      );
      expect(consent?.body.accept).toBe(false);
      await page.goto('/conta/apps-conectados');
      await expect(page.getByText('Nenhum app conectado')).toBeVisible();
    });
  }

  const SUPER_BLOCKED_TEXT =
    'Este assistente não está liberado para o painel da plataforma, ou o conector está desligado.';

  test('Super com cliente fora da lista do conector fica sem acesso, com o motivo certo', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'super');
    await page.goto(adminConnector('https://fora-da-lista.exemplo/cimd'));
    await expect(page.getByRole('heading', { name: 'Sua conta não tem acesso' })).toBeVisible();
    await expect(page.getByText(SUPER_BLOCKED_TEXT)).toBeVisible();
    await expect(page.getByText('só para quem administra a plataforma')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Permitir' })).toHaveCount(0);
  });

  test('Super com o conector da plataforma desligado: o pedido já abre sem acesso (caminho real)', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'super');
    await setup(page, 'apps=empty&adminDisabled=1');
    await page.goto(adminConnector());
    await expect(page.getByRole('heading', { name: 'Sua conta não tem acesso' })).toBeVisible();
    await expect(page.getByText(SUPER_BLOCKED_TEXT)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Permitir' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Voltar ao assistente' }).click();
    await expect(page).toHaveURL(/__client-callback\?.*error=access_denied/);
    // O desligado só vale para o conector da plataforma: o do jogador segue normal.
    await page.goto(userConnector());
    await expect(page.getByRole('button', { name: 'Permitir' })).toBeVisible();
  });

  test('não-Super no conector da plataforma continua lendo "só para quem administra"', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto(adminConnector());
    await expect(page.getByText(/só para quem administra a plataforma Space Sports/)).toBeVisible();
    await expect(page.getByText(SUPER_BLOCKED_TEXT)).toHaveCount(0);
  });

  test('"Permitir" com 403 PROFILE_INCOMPLETE vai completar o cadastro, não mostra "sem acesso"', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await setup(page, 'apps=empty');
    await page.goto(userConnector('https://cadastro-incompleto.exemplo/cimd'));
    const toComplete = page.waitForRequest(/\/completar-cadastro\?next=%2Fautorizar%3F/);
    await page.getByRole('button', { name: 'Permitir' }).click();
    await toComplete;
    await expect(page.getByRole('heading', { name: 'Sua conta não tem acesso' })).toHaveCount(0);
  });

  test('"Permitir" com 400 unauthorized_client vira sem acesso, não "pedido vencido"', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'super');
    await setup(page, 'apps=empty');
    await page.goto(adminConnector('https://saiu-da-lista.exemplo/cimd'));
    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page.getByRole('heading', { name: 'Sua conta não tem acesso' })).toBeVisible();
    await expect(page.getByText('Pedido inválido ou vencido')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Permitir' })).toHaveCount(0);
  });

  test('"Permitir" recusado com 403 (perdeu o acesso) vira o estado de sem acesso', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await setup(page, 'apps=empty');
    await page.goto(userConnector('https://perdeu-acesso.exemplo/cimd'));
    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page.getByRole('heading', { name: 'Sua conta não tem acesso' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Permitir' })).toHaveCount(0);
    await page.goto('/conta/apps-conectados');
    await expect(page.getByText('Nenhum app conectado')).toBeVisible();
  });

  test('corrida: conector desligado entre abrir e permitir (503) mostra o aviso e deixa tentar', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'super');
    await page.goto(adminConnector('https://desligado.exemplo/cimd'));
    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page.locator('[data-slot="alert"]')).toContainText('temporariamente indisponível');
    await expect(page).toHaveURL(/\/autorizar\?/);
    await expect(page.getByRole('button', { name: 'Permitir' })).toBeEnabled();
  });
});

test.describe('cadastro incompleto antes do consentimento (decisão 66)', () => {
  const COMPLETE_NEXT = /\/completar-cadastro\?next=%2Fautorizar%3F/;

  async function completePhone(page: Page) {
    await page.getByLabel('Telefone').fill('31988887777');
    await page.getByRole('button', { name: 'Continuar' }).click();
  }

  test('conta sem telefone: /autorizar → completa → volta ao /autorizar com a mesma query → Permitir', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'incomplete');
    await page.goto(flowUrl('/autorizar'));
    await expect(page).toHaveURL(COMPLETE_NEXT);
    await expect(page.getByRole('button', { name: 'Permitir' })).toHaveCount(0);

    await completePhone(page);
    await expect(page).toHaveURL(/\/autorizar\?.*sig=assinatura/);
    await expect(page.getByTestId('client-name')).toHaveText('Assistente Exemplo');
    const patch = (await mockCalls(page.request)).find((c) => c.path === 'PATCH /v1/me/profile');
    expect(patch?.body).toEqual({ phone: '+5531988887777' });

    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page).toHaveURL(/__client-callback\?.*code=codigo-de-teste/);
    const consent = (await mockCalls(page.request)).find((c) => c.path === '/oauth2/consent');
    expect(String(consent?.body.oauth_query)).toContain('sig=assinatura');
  });

  test('entrando pelo fluxo com a conta incompleta: login → completar → consentimento', async ({
    page,
  }) => {
    await page.goto(flowUrl('/entrar'));
    await page.getByLabel('E-mail').fill(users.incomplete);
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(COMPLETE_NEXT);

    await completePhone(page);
    await expect(page).toHaveURL(/\/autorizar\?.*sig=assinatura/);
    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page).toHaveURL(/__client-callback\?.*code=/);
  });

  test('já logada no /entrar do fluxo: completa e volta ao "Continuar como"', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'incomplete');
    await page.goto(flowUrl('/entrar'));
    await expect(page).toHaveURL(/\/completar-cadastro\?next=%2Fentrar%3F/);

    await completePhone(page);
    await expect(page).toHaveURL(/\/entrar\?.*sig=assinatura/);
    await page.getByRole('button', { name: 'Continuar como Jogadora' }).click();
    await expect(page).toHaveURL(/\/autorizar\?/);
    await expect(page.getByRole('button', { name: 'Permitir' })).toBeVisible();
  });

  test('se o pedido vence enquanto completa, o estado de erro manda conectar de novo', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'incomplete');
    await page.goto(flowUrl('/autorizar', ASSISTANT, 2));
    await expect(page).toHaveURL(COMPLETE_NEXT);
    // O pedido assinado vale poucos segundos neste cenário: deixa passar do prazo.
    await page.waitForTimeout(2500);

    await completePhone(page);
    await expect(page.getByRole('heading', { name: 'Pedido inválido ou vencido' })).toBeAttached();
    await expect(page.getByText(/tente conectar de novo/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Permitir' })).toHaveCount(0);
  });

  test('conta completa não passa pela tela de completar', async ({ page, context }) => {
    await loginAs(context, 'player');
    await page.goto(flowUrl('/autorizar'));
    await expect(page).toHaveURL(/\/autorizar\?/);
    await expect(page.getByRole('button', { name: 'Permitir' })).toBeVisible();
  });

  test('Apps conectados continua acessível sem o cadastro completo (dá para desconectar)', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'incomplete');
    await setup(page, 'apps=seed');
    await page.goto('/conta/apps-conectados');
    await expect(page).toHaveURL(/\/conta\/apps-conectados$/);
    await expect(page.getByTestId('connected-app')).toHaveCount(2);
  });
});

test.describe('Apps conectados (/conta/apps-conectados)', () => {
  test('sem sessão pede login e volta para a página', async ({ page }) => {
    await page.goto('/conta/apps-conectados');
    await expect(page).toHaveURL(/\/entrar\?next=%2Fconta%2Fapps-conectados$/);
  });

  test('vazio explica o que é e como conectar', async ({ page, context }) => {
    await loginAs(context, 'player');
    await setup(page, 'apps=empty');
    await page.goto('/conta/apps-conectados');
    await expect(page.getByText('Nenhum app conectado')).toBeVisible();
    await expect(page.getByText(/assistentes de IA, como o Claude/)).toBeVisible();
    await expect(page.getByText(/adicione o Space Sports como conector/)).toBeVisible();
  });

  test('lista nome, escopos, data da autorização e último uso', async ({ page, context }) => {
    await loginAs(context, 'player');
    await setup(page, 'apps=seed');
    await page.goto('/conta/apps-conectados');
    const apps = page.getByTestId('connected-app');
    await expect(apps).toHaveCount(2);
    // Do mais recente para o mais antigo.
    await expect(apps.nth(0)).toContainText('Assistente Exemplo');
    await expect(apps.nth(0)).toContainText('assistente.exemplo');
    for (const text of SCOPE_TEXTS) await expect(apps.nth(0).getByText(text)).toBeVisible();
    await expect(apps.nth(0)).toContainText('Autorizado em');
    await expect(apps.nth(0)).not.toContainText('ainda não usado');
    await expect(apps.nth(1)).toContainText('Zeca IA');
    await expect(apps.nth(1)).toContainText('ainda não usado');
    await expect(apps.nth(1).getByText('Ver suas reservas')).toBeVisible();
    await expect(apps.nth(1).getByText('Reservar e cancelar quadras em seu nome')).toHaveCount(0);
  });

  test('escopo desconhecido numa conexão não vira item em branco', async ({ page, context }) => {
    await loginAs(context, 'player');
    await setup(page, 'apps=seed&unknownScope=1');
    await page.goto('/conta/apps-conectados');
    const zeca = page.getByTestId('connected-app').nth(1);
    await expect(zeca).toContainText('Zeca IA');
    await expect(zeca.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByText('admin:all')).toHaveCount(0);
  });

  test('jogador sem espaço chega pelo /sem-acesso', async ({ page, context }) => {
    await loginAs(context, 'player');
    await page.goto('/sem-acesso');
    await page.getByRole('link', { name: 'Apps conectados' }).click();
    await expect(page).toHaveURL(/\/conta\/apps-conectados$/);
  });

  test('quem tem painel chega pelo menu da conta', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel');
    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: 'Apps conectados' }).click();
    await expect(page).toHaveURL(/\/conta\/apps-conectados$/);
  });

  test('desconectar pede confirmação; voltar não desconecta', async ({ page, context }) => {
    await loginAs(context, 'player');
    await setup(page, 'apps=seed');
    await page.goto('/conta/apps-conectados');
    await page
      .getByTestId('connected-app')
      .first()
      .getByRole('button', { name: 'Desconectar' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Desconectar Assistente Exemplo?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Voltar' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('connected-app')).toHaveCount(2);
    const calls = await mockCalls(page.request);
    expect(calls.some((call) => call.path.startsWith('DELETE /v1/me/connected-apps'))).toBe(false);
  });

  test('confirmar desconecta, remove o app da lista e chama a API com o id da conexão', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'player');
    await setup(page, 'apps=seed');
    await page.goto('/conta/apps-conectados');
    await page
      .getByTestId('connected-app')
      .first()
      .getByRole('button', { name: 'Desconectar' })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Desconectar' }).click();

    await expect(page.getByTestId('connected-app')).toHaveCount(1);
    await expect(page.getByTestId('connected-app')).toContainText('Zeca IA');
    await expect(page.getByText('Assistente Exemplo desconectado.')).toBeVisible();
    const calls = await mockCalls(page.request);
    expect(calls.map((call) => call.path)).toContain(
      'DELETE /v1/me/connected-apps/00000000-0000-4000-8000-000000000701',
    );
  });

  test('desconectar o último app volta ao estado vazio', async ({ page, context }) => {
    await loginAs(context, 'player');
    await setup(page, 'apps=seed');
    await page.goto('/conta/apps-conectados');
    for (const name of ['Assistente Exemplo', 'Zeca IA']) {
      await page
        .getByTestId('connected-app')
        .filter({ hasText: name })
        .getByRole('button', { name: 'Desconectar' })
        .click();
      await page.getByRole('dialog').getByRole('button', { name: 'Desconectar' }).click();
      await expect(page.getByTestId('connected-app').filter({ hasText: name })).toHaveCount(0);
    }
    await expect(page.getByText('Nenhum app conectado')).toBeVisible();
  });

  test('erro ao desconectar fica no diálogo e deixa tentar de novo', async ({ page, context }) => {
    await loginAs(context, 'player');
    await setup(page, 'apps=seed&failDelete=1');
    await page.goto('/conta/apps-conectados');
    await page
      .getByTestId('connected-app')
      .first()
      .getByRole('button', { name: 'Desconectar' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Desconectar' }).click();
    await expect(dialog.locator('[data-slot="alert"]')).toBeVisible();
    await expect(page.getByTestId('connected-app')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Desconectar' }).click();
    await expect(page.getByTestId('connected-app')).toHaveCount(1);
  });

  test('o perfil do painel leva para Apps conectados', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await setup(page, 'apps=seed');
    await page.goto('/painel/perfil');
    await page.getByRole('link', { name: 'Gerenciar apps conectados' }).click();
    await expect(page).toHaveURL(/\/conta\/apps-conectados$/);
    await expect(page.getByTestId('connected-app')).toHaveCount(2);
    await page.getByRole('link', { name: 'Voltar ao perfil' }).click();
    await expect(page).toHaveURL(/\/painel\/perfil$/);
  });
});

test.describe('Apps conectados: dois conectores (fase 2)', () => {
  test('mostra a qual conector cada conexão pertence, mesmo sendo o mesmo cliente', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'super');
    await setup(page, 'apps=both');
    await page.goto('/conta/apps-conectados');
    const apps = page.getByTestId('connected-app');
    await expect(apps).toHaveCount(3);
    // Mais recente primeiro: Plataforma (4 h), Space Sports (30 h), Plataforma vencida (31 h).
    await expect(apps.nth(0).getByTestId('connected-app-connector')).toHaveText(
      'Conector: Space Sports · Plataforma',
    );
    await expect(apps.nth(0)).toContainText('Assistente Exemplo');
    await expect(apps.nth(1).getByTestId('connected-app-connector')).toHaveText(
      'Conector: Space Sports',
    );
    await expect(apps.nth(1)).toContainText('Assistente Exemplo');
  });

  test('escopos novos com os textos do shared, agrupados quando há mais de um grupo', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'super');
    await setup(page, 'apps=both');
    await page.goto('/conta/apps-conectados');
    const apps = page.getByTestId('connected-app');
    const userApp = apps.nth(1);
    await expect(userApp.getByRole('heading', { name: 'Como jogador' })).toBeVisible();
    await expect(userApp.getByRole('heading', { name: 'Gestão dos seus espaços' })).toBeVisible();
    await expect(userApp.getByText(MANAGE_TEXT)).toBeVisible();
    await expect(userApp.getByText(FINANCE_TEXT)).toBeVisible();
    // Um grupo só: sem subtítulo repetido.
    const platformApp = apps.nth(0);
    await expect(platformApp.getByText(SUPER_TEXT)).toBeVisible();
    await expect(platformApp.getByRole('heading', { name: 'Painel da plataforma' })).toHaveCount(0);
  });

  test('a conexão da plataforma mostra até quando vale; a vencida diz que acabou', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'super');
    await setup(page, 'apps=both');
    await page.goto('/conta/apps-conectados');
    const apps = page.getByTestId('connected-app');
    await expect(apps.nth(0).getByTestId('connected-app-expiry')).toContainText('Expira em');
    await expect(apps.nth(1).getByTestId('connected-app-expiry')).toHaveCount(0);
    await expect(apps.nth(2).getByTestId('connected-app-expiry')).toContainText(
      'Conexão expirada em',
    );
    await expect(apps.nth(2)).toContainText('Conecte de novo no assistente.');
    await expect(apps.nth(0)).not.toContainText('Conecte de novo no assistente.');
  });

  test('conexões da fase 1 aparecem no conector Space Sports, sem prazo', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'player');
    await setup(page, 'apps=seed');
    await page.goto('/conta/apps-conectados');
    for (const app of await page.getByTestId('connected-app').all()) {
      await expect(app.getByTestId('connected-app-connector')).toHaveText('Conector: Space Sports');
      await expect(app.getByTestId('connected-app-expiry')).toHaveCount(0);
    }
  });

  test('desconectar uma conexão não mexe na outra do mesmo cliente', async ({ page, context }) => {
    await loginAs(context, 'super');
    await setup(page, 'apps=both');
    await page.goto('/conta/apps-conectados');
    const apps = page.getByTestId('connected-app');
    await apps.nth(0).getByRole('button', { name: 'Desconectar' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('dados da plataforma');
    await dialog.getByRole('button', { name: 'Desconectar' }).click();
    await expect(page.getByText('Assistente Exemplo desconectado.')).toBeVisible();
    await expect(apps).toHaveCount(2);
    await expect(apps.nth(0).getByTestId('connected-app-connector')).toHaveText(
      'Conector: Space Sports',
    );
    const calls = await mockCalls(page.request);
    expect(
      calls
        .filter((call) => call.path.startsWith('DELETE /v1/me/connected-apps/'))
        .map((c) => c.path),
    ).toEqual(['DELETE /v1/me/connected-apps/00000000-0000-4000-8000-000000000722']);
  });

  test('vazio: quem é da equipe lê que o mesmo conector consulta os dados do espaço', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await setup(page, 'apps=empty');
    await page.goto('/conta/apps-conectados');
    await expect(page.getByText(/Quem é da equipe de um espaço também consulta/)).toBeVisible();
    await expect(page.getByText(/Space Sports · Plataforma/)).toHaveCount(0);
  });

  test('vazio: o Super vê o conector da plataforma; o jogador, nenhum dos dois avisos', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'super');
    await setup(page, 'apps=empty');
    await page.goto('/conta/apps-conectados');
    await expect(page.getByText(/conector próprio, “Space Sports · Plataforma”/)).toBeVisible();

    await context.clearCookies();
    await loginAs(context, 'player');
    await page.goto('/conta/apps-conectados');
    await expect(page.getByText(/assistentes de IA, como o Claude/)).toBeVisible();
    await expect(page.getByText(/Quem é da equipe de um espaço/)).toHaveCount(0);
    await expect(page.getByText(/conector próprio/)).toHaveCount(0);
  });
});

test.describe('anti-clickjacking (cabeçalhos no site todo)', () => {
  async function headersOf(page: Page, url: string) {
    const response = await page.goto(url);
    expect(response?.status()).toBe(200);
    return response?.headers() ?? {};
  }

  test('/entrar e /entrar do fluxo não podem ser enquadrados', async ({ page }) => {
    for (const url of ['/entrar', flowUrl('/entrar')]) {
      const headers = await headersOf(page, url);
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(headers['x-frame-options']).toBe('DENY');
    }
  });

  test('/autorizar (consentimento) e o painel também não', async ({ page, context }) => {
    await loginAs(context, 'manager');
    for (const url of [flowUrl('/autorizar'), '/painel', '/conta/apps-conectados']) {
      const headers = await headersOf(page, url);
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(headers['x-frame-options']).toBe('DENY');
    }
  });
});
