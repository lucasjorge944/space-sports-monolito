import { expect, type Page, test } from './fixtures';
import { loginAs, MOCK_API, mockCalls } from './helpers';

// PNGs de 8×8 (quadrado) e 16×8 (não quadrado).
const SQUARE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAE0lEQVR4nGP4vVfgPz7MMDIUAADBfbHBonARzgAAAABJRU5ErkJggg==',
  'base64',
);
const WIDE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAICAYAAADwdn+XAAAAFUlEQVR4nGP4vVfgPyWYYdSA4WAAAE1vY5C4pYx3AAAAAElFTkSuQmCC',
  'base64',
);

test.beforeEach(async ({ request }) => {
  await request.get(`${MOCK_API}/__reset`);
});

test.describe('logo da marca', () => {
  test('páginas públicas: horizontal no cabeçalho e no rodapé, vertical no login', async ({
    page,
  }) => {
    await page.goto('/entrar');
    // Cabeçalho + rodapé (horizontal) e a vertical do cartão de entrada.
    await expect(page.getByRole('img', { name: 'Space Sports' })).toHaveCount(3);
    await expect(page.locator('header').getByRole('img', { name: 'Space Sports' })).toBeVisible();
    await expect(page.locator('footer').getByRole('img', { name: 'Space Sports' })).toBeVisible();
    // A logo do cabeçalho leva ao início.
    await expect(
      page.locator('header').getByRole('link', { name: 'Space Sports' }),
    ).toHaveAttribute('href', '/');
  });

  test('/excluir-conta também traz a logo no cabeçalho e no rodapé', async ({ page }) => {
    await page.goto('/excluir-conta');
    await expect(page.locator('header').getByRole('img', { name: 'Space Sports' })).toBeVisible();
    await expect(page.locator('footer').getByRole('img', { name: 'Space Sports' })).toBeVisible();
  });

  test('sidebar do /painel e do /super usa a logo horizontal', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel');
    const sidebar = page.locator('[data-slot="sidebar-container"]');
    await expect(sidebar.getByRole('img', { name: 'Space Sports' })).toBeVisible();
    // Largura mínima da horizontal na marca: 160 px.
    const box = await sidebar.getByRole('img', { name: 'Space Sports' }).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(160);

    await context.clearCookies();
    await loginAs(context, 'super');
    await page.goto('/super');
    await expect(sidebar.getByRole('img', { name: 'Space Sports' })).toBeVisible();
  });

  test('no tema escuro a logo é a negativa (a positiva fica oculta)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/entrar');
    const logo = page.locator('header [data-slot="logo"]');
    await expect(logo.locator('svg:visible')).toHaveCount(1);
    expect(await logo.locator('svg:visible').innerHTML()).toContain('#FFFFFF');
  });
});

test.describe('metadados da marca', () => {
  test('ícones, theme-color e imagem Open Graph', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('link[rel="icon"][href*="icon.svg"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('link[rel="icon"][href*="favicon.ico"]')).toHaveCount(1);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#03547D');
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
    const og = await page.locator('meta[property="og:image"]').getAttribute('content');
    const response = await page.request.get(new URL(og as string).pathname);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/png');
  });

  test('página do espaço sem logo mostra as iniciais; com foto de capa usa a capa no OG', async ({
    page,
  }) => {
    await page.goto('/espacos/arena-exemplo');
    await expect(page.locator('article > header [data-slot="space-avatar"]')).toContainText('AE');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      'https://example.com/capa.jpg',
    );
  });
});

async function openDados(page: Page) {
  await page.goto('/painel/espaco');
  await expect(page.getByTestId('logo-card')).toBeVisible();
}

test.describe('logo do espaço (RF-SPACE-11)', () => {
  // A API simulada tem um estado único (logo e chamadas registradas): estes testes não podem rodar em paralelo.
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ context, page }) => {
    await loginAs(context, 'manager');
    // O storage é externo à API: aceita o PUT da URL pré-assinada.
    await page.route('http://storage.exemplo.test/**', (route) => route.fulfill({ status: 200 }));
  });

  test('sem logo: iniciais; escolhe, vê a prévia, envia e a logo aparece no seletor', async ({
    page,
    request,
  }) => {
    await openDados(page);
    const card = page.getByTestId('logo-card');
    await expect(card.locator('[data-slot="space-avatar"]')).toContainText('EE');
    await expect(card.getByRole('button', { name: 'Remover' })).toHaveCount(0);

    await page.getByTestId('logo-input').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: SQUARE,
    });
    await expect(page.getByTestId('logo-preview')).toBeVisible();
    // Nada foi enviado ainda.
    expect((await mockCalls(request)).filter((c) => c.path.includes('/logo'))).toHaveLength(0);

    await card.getByRole('button', { name: 'Enviar logo' }).click();
    await expect(page.getByText('Logo adicionada.')).toBeVisible();

    const calls = (await mockCalls(request)).filter((c) => c.path.includes('/logo'));
    expect(calls.map((c) => c.path.replace(/spaces\/[^/]+/, 'spaces/:id'))).toEqual([
      'POST /v1/manage/spaces/:id/logo/uploads',
      'PUT /v1/manage/spaces/:id/logo',
    ]);
    expect(calls[0]?.body).toEqual({ contentType: 'image/png', size: SQUARE.length });
    expect(calls[1]?.body).toEqual({ key: 'spaces/espaco-a/logo/abc.png' });

    // Agora há logo: aparece no cartão e no seletor da sidebar, com as opções de trocar e remover.
    // Sozinha no cartão, a logo tem nome; ao lado do nome do espaço (seletor), é decorativa.
    await expect(card.locator('[data-slot="space-avatar"] img')).toHaveAttribute(
      'alt',
      'Logo de Espaço Exemplo A',
    );
    await expect(page.getByTestId('space-switcher').locator('img')).toHaveAttribute('alt', '');
    await expect(card.getByRole('button', { name: 'Trocar logo' })).toBeVisible();
  });

  test('recusa logo não quadrada antes de enviar', async ({ page, request }) => {
    await openDados(page);
    await page.getByTestId('logo-input').setInputFiles({
      name: 'larga.png',
      mimeType: 'image/png',
      buffer: WIDE,
    });
    await expect(page.getByTestId('logo-error')).toContainText('quadrada');
    await expect(page.getByTestId('logo-error')).toContainText('16×8');
    await expect(page.getByTestId('logo-preview')).toHaveCount(0);
    expect((await mockCalls(request)).filter((c) => c.path.includes('/logo'))).toHaveLength(0);
  });

  test('recusa tipo inválido e arquivo acima de 2 MB', async ({ page }) => {
    await openDados(page);
    await page.getByTestId('logo-input').setInputFiles({
      name: 'logo.gif',
      mimeType: 'image/gif',
      buffer: Buffer.from('GIF89a'),
    });
    await expect(page.getByTestId('logo-error')).toContainText('JPEG, PNG ou WebP');

    await page.getByTestId('logo-input').setInputFiles({
      name: 'grande.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
    });
    await expect(page.getByTestId('logo-error')).toContainText('2 MB');
  });

  test('mostra em português os erros da API (LOGO_* e STORAGE_UNAVAILABLE)', async ({ page }) => {
    await openDados(page);
    const pick = () =>
      page.getByTestId('logo-input').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: SQUARE,
      });
    const send = () => page.getByRole('button', { name: 'Enviar logo' }).click();
    const apiError = (status: number, code: string, details?: unknown) =>
      page.route('**/v1/manage/spaces/*/logo', (route) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code, message: 'x', details }, requestId: 'r' }),
        }),
      );

    await apiError(422, 'LOGO_NOT_UPLOADED');
    await pick();
    await send();
    await expect(page.getByTestId('logo-error')).toContainText('não foi concluído');

    await page.unroute('**/v1/manage/spaces/*/logo');
    await apiError(422, 'INVALID_LOGO_FILE', { width: 10, height: 20 });
    await send();
    await expect(page.getByTestId('logo-error')).toContainText('tem 10×20 px');

    await page.unroute('**/v1/manage/spaces/*/logo');
    await page.route('**/v1/manage/spaces/*/logo/uploads', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'STORAGE_UNAVAILABLE', message: 'x' },
          requestId: 'r',
        }),
      }),
    );
    await send();
    await expect(page.getByTestId('logo-error')).toContainText('armazenamento de imagens');
  });

  test('falha do storage mostra mensagem própria; remover volta às iniciais', async ({
    page,
    request,
  }) => {
    await openDados(page);
    await page.unroute('http://storage.exemplo.test/**');
    await page.route('http://storage.exemplo.test/**', (route) => route.fulfill({ status: 500 }));
    await page.getByTestId('logo-input').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: SQUARE,
    });
    await page.getByRole('button', { name: 'Enviar logo' }).click();
    await expect(page.getByTestId('logo-error')).toContainText('envio ao armazenamento falhou');

    // Segunda tentativa com o storage de volta.
    await page.unroute('http://storage.exemplo.test/**');
    await page.route('http://storage.exemplo.test/**', (route) => route.fulfill({ status: 200 }));
    await page.getByRole('button', { name: 'Enviar logo' }).click();
    await expect(page.getByText('Logo adicionada.')).toBeVisible();

    await page
      .getByTestId('logo-card')
      .getByRole('button', { name: 'Remover', exact: true })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remover', exact: true }).click();
    await expect(page.getByText('Logo removida.')).toBeVisible();
    await expect(page.getByTestId('logo-card').locator('[data-slot="space-avatar"]')).toContainText(
      'EE',
    );
    expect((await mockCalls(request)).some((c) => c.path === 'DELETE /logo')).toBe(true);
  });

  test('Professor não vê a ação de enviar logo (só Dono e Admin)', async ({ page, context }) => {
    await context.clearCookies();
    await loginAs(context, 'teacher');
    await page.goto('/painel/espaco');
    const card = page.getByTestId('logo-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('button')).toHaveCount(0);
  });
});
