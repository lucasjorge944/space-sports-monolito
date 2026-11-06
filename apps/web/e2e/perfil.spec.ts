import { expect, test } from './fixtures';
import { loginAs, MOCK_API, mockCalls, PASSWORD } from './helpers';

// Completar cadastro (decisão 66), Meu perfil (decisão 67) e foto de perfil (decisões 67 e 71) com a
// API simulada.

// PNG de 16×8 (não quadrado): o recorte no navegador o transforma em quadrado antes do envio.
const WIDE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAICAYAAADwdn+XAAAAFUlEQVR4nGP4vVfgPyWYYdSA4WAAAE1vY5C4pYx3AAAAAElFTkSuQmCC',
  'base64',
);

test.describe('completar cadastro', () => {
  test('conta antiga sem telefone não usa o painel antes de completar', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'legacy');
    await page.goto('/painel/agenda');
    await expect(page).toHaveURL(/\/completar-cadastro\?next=%2Fpainel%2Fagenda$/);
    await expect(page.getByRole('heading', { name: 'Complete seu cadastro' })).toBeVisible();
    // Pede só o que falta: o nome já existe.
    await expect(page.getByLabel('Nome')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();

    // Outra área do painel também volta para cá.
    await page.goto('/painel/perfil');
    await expect(page).toHaveURL(/\/completar-cadastro\?next=%2Fpainel%2Fperfil$/);

    const phone = page.getByLabel('Telefone');
    await phone.fill('319');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(phone).toHaveAccessibleDescription(/Informe um telefone brasileiro com DDD/);

    await phone.fill('31988887777');
    await page.getByRole('button', { name: 'Continuar' }).click();
    // "Sobre você" já preenchido antes: segue direto para a página pedida.
    await expect(page).toHaveURL(/\/painel\/perfil$/);
    await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible();
    const patch = (await mockCalls(request)).find((c) => c.path === 'PATCH /v1/me/profile');
    expect(patch?.body).toEqual({ phone: '+5531988887777' });

    // Completo, a tela de completar devolve à área.
    await page.goto('/completar-cadastro');
    await expect(page).toHaveURL(/\/painel$/);
  });

  test('primeiro login pelo Google: telefone e depois "Sobre você" com Pular', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'google');
    await page.goto('/painel');
    await expect(page).toHaveURL(/\/completar-cadastro\?next=%2Fpainel$/);
    await page.getByLabel('Telefone').fill('31988887777');
    await page.getByRole('button', { name: 'Continuar' }).click();

    await expect(page).toHaveURL(/\/cadastro\/sobre-voce\?next=%2Fpainel$/);
    await expect(page.getByRole('heading', { name: 'Sobre você' })).toBeVisible();
    await page.getByRole('button', { name: 'Pular' }).click();
    await expect(page).toHaveURL(/\/painel$/);
    const patches = (await mockCalls(request)).filter((c) => c.path === 'PATCH /v1/me/profile');
    expect(patches).toHaveLength(1);

    // Conta só Google: sem senha, o perfil explica que o login é pelo Google; a foto do Google vale.
    await page.goto('/painel/perfil');
    await expect(page.getByTestId('social-only')).toContainText('Você entra com Google');
    await expect(page.getByLabel('Senha atual')).toHaveCount(0);
    await expect(page.getByTestId('avatar-card').getByRole('img')).toHaveAttribute(
      'src',
      'https://lh3.googleusercontent.com/a/foto-exemplo',
    );
  });
});

test.describe('Meu perfil', () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAs(context, 'manager');
    await page.route('http://storage.exemplo.test/**', (route) => route.fulfill({ status: 200 }));
  });

  test('abre pelo menu da conta e edita só o que mudou', async ({ page, request }) => {
    await page.goto('/painel');
    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: 'Meu perfil' }).click();
    await expect(page).toHaveURL(/\/painel\/perfil$/);

    await expect(page.getByLabel('Nome')).toHaveValue('Gestora Ana');
    await expect(page.getByLabel('Telefone')).toHaveValue('(31) 99999-0000');
    await expect(page.getByLabel('Data de nascimento')).toHaveValue('20/05/1990');
    await expect(page.getByLabel('Gênero')).toHaveValue('FEMALE');
    await expect(page.getByRole('button', { name: 'Futevôlei' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByLabel('Nível em Futevôlei')).toHaveValue('ADVANCED');
    await expect(page.getByTestId('profile-email')).toHaveText('gestora@exemplo.com');
    await expect(page.getByText('Verificado', { exact: true })).toBeVisible();
    // Nada mudou: não há o que salvar.
    await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();

    // Telefone inválido não sai do navegador.
    await page.getByLabel('Telefone').fill('3199');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByLabel('Telefone')).toHaveAttribute('aria-invalid', 'true');
    expect((await mockCalls(request)).some((c) => c.path === 'PATCH /v1/me/profile')).toBe(false);

    await page.getByLabel('Nome').fill('Ana Souza');
    await page.getByLabel('Telefone').fill('31977776666');
    await page.getByLabel('Gênero').selectOption({ label: 'Prefiro não informar' });
    await page.getByRole('button', { name: 'Beach tênis' }).click();
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByText('Perfil atualizado.')).toBeVisible();

    const patch = (await mockCalls(request)).find((c) => c.path === 'PATCH /v1/me/profile');
    expect(patch?.body).toEqual({
      name: 'Ana Souza',
      phone: '+5531977776666',
      gender: 'UNDISCLOSED',
      favoriteSports: [
        { sportId: '00000000-0000-4000-8000-000000000301', level: 'ADVANCED' },
        { sportId: '00000000-0000-4000-8000-000000000302', level: null },
      ],
    });
    // O nome novo aparece no menu da conta.
    await expect(page.getByTestId('user-menu')).toContainText('Ana Souza');
    await page.reload();
    await expect(page.getByLabel('Nome')).toHaveValue('Ana Souza');
  });

  test('alterar senha: senha atual errada e depois a certa', async ({ page, request }) => {
    await page.goto('/painel/perfil');
    await page.getByLabel('Senha atual').fill('errada-123');
    await page.getByLabel('Nova senha', { exact: true }).fill('nova-senha-123');
    await page.getByLabel('Confirmar nova senha').fill('nova-senha-123');
    await page.getByRole('button', { name: 'Alterar senha' }).click();
    await expect(page.getByLabel('Senha atual')).toHaveAccessibleDescription(
      /Senha atual incorreta/,
    );

    await page.getByLabel('Senha atual').fill(PASSWORD);
    await page.getByRole('button', { name: 'Alterar senha' }).click();
    await expect(page.getByText('Senha alterada.', { exact: false })).toBeVisible();
    const change = (await mockCalls(request)).filter((c) => c.path === '/change-password');
    expect(change.at(-1)?.body).toEqual({
      currentPassword: PASSWORD,
      newPassword: 'nova-senha-123',
      revokeOtherSessions: true,
    });
  });

  test('foto: recorta, envia pelo fluxo de upload, aparece no menu e é removida', async ({
    page,
    request,
  }) => {
    await page.goto('/painel/perfil');
    const card = page.getByTestId('avatar-card');
    await expect(card.locator('[data-slot="user-avatar"]')).toContainText('GA');

    await page.getByTestId('avatar-input').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: WIDE,
    });
    const dialog = page.getByRole('dialog', { name: 'Recortar foto' });
    await expect(dialog).toBeVisible();
    // Nada foi enviado antes de confirmar o recorte.
    expect((await mockCalls(request)).some((c) => c.path.includes('/avatar'))).toBe(false);
    await dialog.getByRole('button', { name: 'Salvar foto' }).click();
    await expect(page.getByText('Foto adicionada.')).toBeVisible();
    await expect(dialog).toBeHidden();

    const calls = (await mockCalls(request)).filter((c) => c.path.includes('/avatar'));
    expect(calls.map((c) => c.path)).toEqual(['POST /v1/me/avatar/uploads', 'PUT /v1/me/avatar']);
    // O recorte é PNG (a origem era PNG) e já quadrado.
    expect(calls[0]?.body).toMatchObject({ contentType: 'image/png' });
    expect(calls[1]?.body).toEqual({ key: 'uploads/users/u1/avatar/abc.png' });

    await expect(card.getByRole('img', { name: 'Foto de Gestora Ana' })).toBeVisible();
    await expect(page.getByTestId('user-menu').locator('img')).toHaveCount(1);

    await card.getByRole('button', { name: 'Remover' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remover' }).click();
    await expect(page.getByText('Foto removida.')).toBeVisible();
    await expect(card.locator('[data-slot="user-avatar"]')).toContainText('GA');
    expect((await mockCalls(request)).some((c) => c.path === 'DELETE /v1/me/avatar')).toBe(true);
  });

  // Erros do contrato real (C.1): a mensagem aparece no diálogo do recorte, que continua aberto.
  const failures = [
    {
      op: 'avatar-upload',
      status: 503,
      code: 'STORAGE_UNAVAILABLE',
      message: 'O envio de fotos está indisponível no momento.',
    },
    {
      op: 'avatar-upload',
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Muitos envios de foto na última hora.',
    },
    {
      op: 'avatar-set',
      status: 422,
      code: 'IMAGE_NOT_SQUARE',
      message: 'A foto precisa ser quadrada.',
    },
    { op: 'avatar-set', status: 422, code: 'IMAGE_TOO_LARGE', message: 'A foto passa de 2 MB.' },
  ];
  for (const failure of failures) {
    test(`foto: ${failure.code} mostra a mensagem e deixa tentar de novo`, async ({
      page,
      request,
    }) => {
      await request.get(`${MOCK_API}/__fail`, {
        params: { op: failure.op, status: failure.status, code: failure.code },
      });
      await page.goto('/painel/perfil');
      await page.getByTestId('avatar-input').setInputFiles({
        name: 'foto.png',
        mimeType: 'image/png',
        buffer: WIDE,
      });
      const dialog = page.getByRole('dialog', { name: 'Recortar foto' });
      await dialog.getByRole('button', { name: 'Salvar foto' }).click();
      await expect(dialog.getByText(failure.message, { exact: false })).toBeVisible();

      // O erro vale uma vez: a nova tentativa, sem escolher o arquivo de novo, envia.
      await dialog.getByRole('button', { name: 'Salvar foto' }).click();
      await expect(page.getByText('Foto adicionada.')).toBeVisible();
      await expect(dialog).toBeHidden();
    });
  }

  test('recorte pelo teclado: controles de zoom e posição', async ({ page }) => {
    await page.goto('/painel/perfil');
    await page.getByTestId('avatar-input').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: WIDE,
    });
    const dialog = page.getByRole('dialog', { name: 'Recortar foto' });
    const horizontal = dialog.getByRole('slider', { name: 'Posição horizontal' });
    const vertical = dialog.getByRole('slider', { name: 'Posição vertical' });
    // Imagem mais larga que alta, sem zoom: só há o que mover na horizontal.
    await expect(horizontal).toBeEnabled();
    await expect(vertical).toBeDisabled();
    await expect(horizontal).toHaveAttribute('aria-valuetext', 'Centro');
    await horizontal.focus();
    await page.keyboard.press('End');
    await expect(horizontal).toHaveAttribute('aria-valuetext', '100% da esquerda');

    const zoom = dialog.getByRole('slider', { name: 'Zoom' });
    await zoom.focus();
    await page.keyboard.press('End');
    await expect(zoom).toHaveAttribute('aria-valuetext', '300%');
    await expect(vertical).toBeEnabled();
  });

  test('telefone recusado pela API (INVALID_PHONE_NUMBER) vai para o campo', async ({
    page,
    request,
  }) => {
    await request.get(`${MOCK_API}/__fail`, {
      params: { op: 'profile', status: 400, code: 'INVALID_PHONE_NUMBER' },
    });
    await page.goto('/painel/perfil');
    await page.getByLabel('Telefone').fill('31977776666');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByLabel('Telefone')).toHaveAccessibleDescription(
      /Informe um telefone brasileiro com DDD/,
    );
    await expect(page.locator('[data-slot="alert"]')).toHaveCount(0);
  });

  test('arquivo que não é imagem é recusado antes do recorte', async ({ page }) => {
    await page.goto('/painel/perfil');
    await page.getByTestId('avatar-input').setInputFiles({
      name: 'nota.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('oi'),
    });
    await expect(page.getByText('Use uma imagem JPEG, PNG ou WebP.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Super abre o perfil dentro do /super', async ({ page, context }) => {
    await loginAs(context, 'super');
    await page.goto('/super');
    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: 'Meu perfil' }).click();
    await expect(page).toHaveURL(/\/super\/perfil$/);
    await expect(page.getByLabel('Nome')).toHaveValue('Super Admin');
  });
});
