import { expect, test } from './fixtures';
import { fillLogin, loginAs, MOCK_API, mockCalls, PASSWORD, users } from './helpers';

test.describe('login', () => {
  test('credenciais erradas mostram o erro em PT-BR', async ({ page }) => {
    await page.goto('/entrar');
    await fillLogin(page, users.manager, 'senha-errada');
    await expect(page.locator('[data-slot="alert"]')).toHaveText('E-mail ou senha incorretos.');
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('conta inativa mostra a mensagem própria, diferente de bloqueada', async ({ page }) => {
    await page.goto('/entrar');
    await fillLogin(page, 'inativa@exemplo.com', PASSWORD);
    await expect(page.locator('[data-slot="alert"]')).toHaveText(
      'Conta inativa. Para reativá-la, fale com o espaço ou com o suporte da plataforma.',
    );
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('valida campos antes de chamar a API', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByText('Informe seu e-mail')).toBeVisible();
    await expect(page.getByText('Informe sua senha')).toBeVisible();
  });

  test('só mostra os provedores sociais habilitados', async ({ page }) => {
    await page.goto('/entrar');
    await expect(page.getByRole('button', { name: 'Continuar com Google' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continuar com Apple' })).toHaveCount(0);
  });

  test('gestor entra no /painel, vê os espaços do /v1/me e sai', async ({ page }) => {
    await page.goto('/entrar');
    await fillLogin(page, users.manager, PASSWORD);
    await expect(page).toHaveURL(/\/painel$/);
    await expect(page.getByTestId('space-switcher')).toContainText('Espaço Exemplo A');

    await page.getByTestId('user-menu').click();
    await expect(page.getByText(users.manager)).toBeVisible();
    await page.getByRole('menuitem', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/entrar$/);

    await page.goto('/painel');
    await expect(page).toHaveURL(/\/entrar\?next=%2Fpainel$/);
  });

  test('Super entra no /super', async ({ page }) => {
    await page.goto('/entrar');
    await fillLogin(page, users.super, PASSWORD);
    await expect(page).toHaveURL(/\/super$/);
  });

  test('jogador sem vínculo cai em /sem-acesso', async ({ page }) => {
    await page.goto('/entrar');
    await fillLogin(page, users.player, PASSWORD);
    await expect(page).toHaveURL(/\/sem-acesso$/);
    await expect(page.getByText('Sem acesso ao painel').first()).toBeVisible();
  });

  test('volta para a página pedida depois do login (next)', async ({ page }) => {
    await page.goto('/painel/aulas/turmas');
    await expect(page).toHaveURL(/\/entrar\?next=%2Fpainel%2Faulas%2Fturmas$/);
    await fillLogin(page, users.manager, PASSWORD);
    await expect(page).toHaveURL(/\/painel\/aulas\/turmas$/);
  });

  test('next externo é ignorado', async ({ page }) => {
    await page.goto('/entrar?next=//evil.com');
    await fillLogin(page, users.manager, PASSWORD);
    await expect(page).toHaveURL(/\/painel$/);
  });
});

test.describe('redirecionamento por perfil', () => {
  test('gestor que abre /super volta para /painel', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/super');
    await expect(page).toHaveURL(/\/painel$/);
  });

  test('Super sem espaço que abre /painel vai para /super', async ({ page, context }) => {
    await loginAs(context, 'super');
    await page.goto('/painel');
    await expect(page).toHaveURL(/\/super$/);
  });

  test('jogador sem vínculo não acessa /painel nem /super', async ({ page, context }) => {
    await loginAs(context, 'player');
    await page.goto('/painel');
    await expect(page).toHaveURL(/\/sem-acesso$/);
    await page.goto('/super');
    await expect(page).toHaveURL(/\/sem-acesso$/);
  });

  test('quem já tem sessão sai de /entrar para a área do perfil', async ({ page, context }) => {
    await loginAs(context, 'super');
    await page.goto('/entrar');
    await expect(page).toHaveURL(/\/super$/);
  });

  test('cookie de sessão inválido é tratado como deslogado', async ({ page, context }) => {
    await context.addCookies([
      { name: 'space-sports.session_token', value: 'lixo', url: 'http://localhost:3100' },
    ]);
    await page.goto('/painel');
    await expect(page).toHaveURL(/\/entrar\?next=%2Fpainel$/);
  });
});

test.describe('seletor de espaço', () => {
  test('lista os espaços do /v1/me e troca o selecionado', async ({ page, context }) => {
    await loginAs(context, 'multi');
    await page.goto('/painel');
    const switcher = page.getByTestId('space-switcher');
    await expect(switcher).toContainText('Espaço Exemplo A');
    await switcher.click();
    await page.getByRole('menuitem', { name: 'Espaço Exemplo B' }).click();
    await expect(switcher).toContainText('Espaço Exemplo B');
    await page.reload();
    await expect(switcher).toContainText('Espaço Exemplo B');
  });
});

test.describe('cadastro', () => {
  test('valida as senhas', async ({ page }) => {
    await page.goto('/cadastro');
    await page.getByLabel('Nome').fill('Novo Jogador');
    await page.getByLabel('E-mail').fill('novo@exemplo.com');
    await page.getByLabel('Senha', { exact: true }).fill('curta');
    await page.getByLabel('Confirmar senha').fill('outra');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByText('A senha deve ter pelo menos 8 caracteres.')).toBeVisible();
    await expect(page.getByText('As senhas não conferem')).toBeVisible();
  });

  test('e-mail já cadastrado mostra o erro traduzido', async ({ page }) => {
    await page.goto('/cadastro');
    await page.getByLabel('Nome').fill('Alguém');
    await page.getByLabel('E-mail').fill('existente@exemplo.com');
    await page.getByLabel('Telefone').fill('31988887777');
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirmar senha').fill(PASSWORD);
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.locator('[data-slot="alert"]')).toHaveText(
      'Já existe uma conta com este e-mail.',
    );
  });

  test('cadastra, manda o callbackURL do web e abre a tela de verificação', async ({
    page,
    request,
  }) => {
    await page.goto('/cadastro');
    await page.getByLabel('Nome').fill('Novo Jogador');
    await page.getByLabel('E-mail').fill('Novo@Exemplo.com');
    await page.getByLabel('Telefone').fill('31988887777');
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirmar senha').fill(PASSWORD);
    await page.getByRole('button', { name: 'Criar conta' }).click();

    // Decisão 70: a etapa "Sobre você" vem depois da conta criada, em rota própria, com "Pular".
    // Recarregar não perde o passo nem o destino seguinte (a confirmação do e-mail).
    await expect(page).toHaveURL(/\/cadastro\/sobre-voce\?next=%2Fverificar-email/);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sobre você' })).toBeVisible();
    await page.getByRole('button', { name: 'Pular' }).click();

    await expect(page).toHaveURL(/\/verificar-email\?email=novo%40exemplo\.com/);
    await expect(page.getByText('novo@exemplo.com').first()).toBeVisible();

    const signUp = (await mockCalls(request)).find(
      (c) => c.path === '/sign-up/email' && c.body.email === 'novo@exemplo.com',
    );
    expect(signUp?.body).toMatchObject({
      name: 'Novo Jogador',
      email: 'novo@exemplo.com',
      phone: '+5531988887777',
      callbackURL: 'http://localhost:3100/verificar-email?status=confirmado',
    });
    // Pular não grava nada no perfil.
    expect((await mockCalls(request)).some((c) => c.path === 'PATCH /v1/me/profile')).toBe(false);

    await page.getByRole('button', { name: 'Reenviar e-mail' }).click();
    await expect(page.getByText('Link reenviado.')).toBeVisible();
  });
});

test.describe('cadastro: telefone e "Sobre você" (decisões 64 e 70)', () => {
  test('telefone obrigatório e brasileiro, com a máscara, antes de chamar a API', async ({
    page,
    request,
  }) => {
    await page.goto('/cadastro');
    await page.getByLabel('Nome').fill('Novo Jogador');
    await page.getByLabel('E-mail').fill('novo@exemplo.com');
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirmar senha').fill(PASSWORD);
    await page.getByRole('button', { name: 'Criar conta' }).click();
    const phone = page.getByLabel('Telefone');
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    await expect(phone).toHaveAccessibleDescription(/Informe seu telefone com DDD/);

    await phone.fill('3198888');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(phone).toHaveAccessibleDescription(/Informe um telefone brasileiro com DDD/);
    expect((await mockCalls(request)).some((c) => c.path === '/sign-up/email')).toBe(false);

    await phone.fill('');
    await phone.pressSequentially('31988887777');
    await expect(phone).toHaveValue('(31) 98888-7777');
  });

  test('telefone recusado pela API (INVALID_PHONE_NUMBER) vai para o campo', async ({
    page,
    request,
  }) => {
    await request.get(`${MOCK_API}/__fail`, {
      params: { op: 'sign-up', status: 400, code: 'INVALID_PHONE_NUMBER' },
    });
    await page.goto('/cadastro');
    await page.getByLabel('Nome').fill('Novo Jogador');
    await page.getByLabel('E-mail').fill('novo@exemplo.com');
    await page.getByLabel('Telefone').fill('31988887777');
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirmar senha').fill(PASSWORD);
    await page.getByRole('button', { name: 'Criar conta' }).click();
    const phone = page.getByLabel('Telefone');
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    await expect(phone).toHaveAccessibleDescription(/Informe um telefone brasileiro com DDD/);
    await expect(page).toHaveURL(/\/cadastro$/);
  });

  test('preenche "Sobre você" e salva pelo PATCH do perfil antes da verificação', async ({
    page,
    request,
  }) => {
    await page.goto('/cadastro?next=%2Fconvite%2Fabc');
    await page.getByLabel('Nome').fill('Nova Jogadora');
    await page.getByLabel('E-mail').fill('nova@exemplo.com');
    await page.getByLabel('Telefone').fill('31988887777');
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirmar senha').fill(PASSWORD);
    await page.getByRole('button', { name: 'Criar conta' }).click();

    await expect(page.getByRole('heading', { name: 'Sobre você' })).toBeVisible();
    // Data futura não passa.
    const birth = page.getByLabel('Data de nascimento');
    await birth.fill('01/01/2999');
    await expect(birth).toHaveAttribute('aria-invalid', 'true');
    await birth.fill('20/05/1990');
    await page.getByLabel('Gênero').selectOption({ label: 'Feminino' });
    await page.getByRole('button', { name: 'Futevôlei' }).click();
    await page.getByRole('button', { name: 'Beach tênis' }).click();
    await page.getByLabel('Nível em Futevôlei').selectOption({ label: 'Avançado' });
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();

    // Segue o destino que o cadastro já tinha (aqui, um convite).
    await expect(page).toHaveURL(
      /\/verificar-email\?email=nova%40exemplo\.com&next=%2Fconvite%2Fabc/,
    );
    const patch = (await mockCalls(request)).find((c) => c.path === 'PATCH /v1/me/profile');
    expect(patch?.body).toEqual({
      birthDate: '1990-05-20',
      gender: 'FEMALE',
      favoriteSports: [
        { sportId: '00000000-0000-4000-8000-000000000301', level: 'ADVANCED' },
        { sportId: '00000000-0000-4000-8000-000000000302', level: null },
      ],
    });
  });
});

test.describe('verificação de e-mail', () => {
  test('link confirmado mostra o sucesso', async ({ page }) => {
    await page.goto('/verificar-email?status=confirmado');
    await expect(page.getByText('Seu e-mail foi confirmado.')).toBeVisible();
  });

  test('link com erro mostra a mensagem e deixa pedir outro', async ({ page }) => {
    await page.goto('/verificar-email?error=token_expired');
    await expect(page.getByText('O link expirou. Peça um novo.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reenviar e-mail' })).toBeVisible();
  });
});

test.describe('senha', () => {
  test('esqueci a senha manda o redirectTo do web', async ({ page, request }) => {
    await page.goto('/esqueci-senha');
    await page.getByLabel('E-mail').fill(users.manager);
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByText('enviamos um link para redefinir a senha')).toBeVisible();

    const call = (await mockCalls(request)).find(
      (c) => c.path === '/request-password-reset' && c.body.email === users.manager,
    );
    expect(call?.body).toMatchObject({
      email: users.manager,
      redirectTo: 'http://localhost:3100/redefinir-senha',
    });
  });

  test('redefine a senha com o token do link', async ({ page }) => {
    await page.goto('/redefinir-senha?token=valido');
    await page.getByLabel('Nova senha', { exact: true }).fill('nova-senha-123');
    await page.getByLabel('Confirmar nova senha').fill('nova-senha-123');
    await page.getByRole('button', { name: 'Redefinir senha' }).click();
    await expect(page).toHaveURL(/\/entrar\?senha=redefinida$/);
    await expect(page.getByText('Senha redefinida. Entre com a nova senha.')).toBeVisible();
  });

  test('token inválido mostra o erro traduzido', async ({ page }) => {
    await page.goto('/redefinir-senha?error=INVALID_TOKEN');
    await expect(page.getByText('O link é inválido ou já foi usado. Peça um novo.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pedir novo link' })).toBeVisible();
  });
});
