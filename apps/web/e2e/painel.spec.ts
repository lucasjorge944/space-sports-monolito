import { expect, type Page, test } from './fixtures';
import { loginAs, mockCalls } from './helpers';

// Cada teste tem o seu escopo na API simulada (e2e/fixtures.ts): o registro de chamadas não é dividido
// com os testes que rodam em paralelo.
test.describe('agenda e reservas', () => {
  test('agenda mostra a reserva do dia e abre o detalhe com pagamentos', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/agenda');
    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
    const booking = page.getByTestId('agenda-booking');
    await expect(booking).toContainText('Carlos Souza');
    await expect(booking).toContainText('12:00–13:00');

    await booking.click();
    const detail = page.getByTestId('booking-detail');
    await expect(detail).toContainText('Quadra 1');
    await expect(detail).toContainText('R$ 120,00');
    await expect(detail.getByRole('button', { name: 'Registrar pagamento' })).toBeVisible();
  });

  test('reserva de balcão envia horário em UTC e telefone em E.164', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/agenda');
    await page.getByRole('button', { name: 'Reserva de balcão' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome do cliente').fill('Ana Paula');
    await dialog.getByLabel('Telefone (WhatsApp)').fill('(31) 98888-7777');
    await dialog.getByRole('button', { name: 'Criar reserva' }).click();
    await expect(page.getByText('Reserva de balcão criada.')).toBeVisible();

    const calls = await mockCalls(request);
    const create = calls.find(
      (c) => c.path.endsWith('/bookings') && c.body.guestName === 'Ana Paula',
    );
    expect(create?.body).toMatchObject({
      guestName: 'Ana Paula',
      guestPhone: '+5531988887777',
      durationMin: 60,
    });
    // 10:00 local (padrão do diálogo) = 13:00Z.
    expect(String(create?.body.startsAt)).toMatch(/T13:00:00\.000Z$/);
  });

  test('valida o telefone antes de chamar a API', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/agenda');
    await page.getByRole('button', { name: 'Reserva de balcão' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome do cliente').fill('Nome Invalido');
    await dialog.getByLabel('Telefone (WhatsApp)').fill('123');
    await dialog.getByRole('button', { name: 'Criar reserva' }).click();
    await expect(dialog.getByText('Informe o telefone com DDD')).toBeVisible();
    expect(
      (await mockCalls(request)).some(
        (c) => c.path.endsWith('/bookings') && c.body.guestName === 'Nome Invalido',
      ),
    ).toBe(false);
  });

  test('registra pagamento em centavos pelo detalhe', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/reservas/avulsas');
    await page.getByTestId('booking-row').click();
    await page
      .getByTestId('booking-detail')
      .getByRole('button', { name: 'Registrar pagamento' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Registrar pagamento' });
    await dialog.getByLabel('Valor recebido').fill('50,50');
    await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByText('Pagamento registrado.', { exact: true })).toBeVisible();

    const payment = (await mockCalls(request)).find(
      (c) => c.path.endsWith('/payments') && c.body.amountCents === 5050,
    );
    expect(payment?.body).toMatchObject({
      payableType: 'BOOKING',
      amountCents: 5050,
      method: 'PIX',
    });
  });

  test('o detalhe rotula a situação e organiza a reserva por seções', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/reservas/avulsas');
    await page.getByTestId('booking-row').click();
    const detail = page.getByTestId('booking-detail');

    const status = detail.getByTestId('booking-status');
    await expect(status).toContainText('Reserva: Confirmada');
    await expect(status).toContainText('Pagamento: Pendente');
    await expect(status).toContainText('Origem: Balcão');

    for (const title of ['Quando e onde', 'Cliente', 'Valores', 'Participantes', 'Ações']) {
      await expect(detail.getByRole('heading', { name: title })).toBeVisible();
    }

    // Decisão 50: a divisão é informação; o recebimento é da reserva inteira.
    await expect(detail.getByText('Dani Rocha')).toBeVisible();
    await expect(detail.getByText('o recebimento é da reserva inteira')).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Registrar pagamento' })).toHaveCount(1);
    await expect(detail.getByRole('button', { name: /Dani/ })).toHaveCount(0);

    // Registro antigo por participante continua legível, sem ação nova.
    await expect(detail.getByRole('list', { name: 'Pagamentos registrados' })).toContainText(
      'parte de participante',
    );
  });

  test('não deixa receber mais do que está em aberto', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/reservas/avulsas');
    await page.getByTestId('booking-row').click();
    await page
      .getByTestId('booking-detail')
      .getByRole('button', { name: 'Registrar pagamento' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Registrar pagamento' });
    await dialog.getByLabel('Valor recebido').fill('500');
    await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(dialog.getByText(/passa do que está em aberto/)).toBeVisible();
    expect(
      (await mockCalls(request)).some(
        (c) => c.path.endsWith('/payments') && c.body.amountCents === 50000,
      ),
    ).toBe(false);
  });
});

test.describe('recebimentos, mensalistas e permissões', () => {
  test('recebimentos mostra o total a receber hoje', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/recebimentos');
    await expect(page.getByTestId('total-due')).toHaveText(/R\$\s*120,00/);
    await expect(page.getByTestId('receivable-row')).toContainText('Carlos Souza');
    await expect(page.getByRole('button', { name: 'Exportar CSV' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Mensalidades|Inadimplentes/ })).toHaveCount(0);
  });

  test('extrato mostra totais, separa estornos e baixa o CSV com o período em UTC', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/recebimentos');
    await page.getByRole('tab', { name: 'Extrato' }).click();
    await expect(page.getByTestId('statement-total')).toHaveText(/R\$\s*120,00/);
    await expect(page.getByTestId('statement-by-method')).toContainText('Pix');
    await expect(page.getByTestId('statement-row')).toContainText('Carlos Souza');
    await expect(page.getByTestId('statement-reversal-row')).toContainText('Marina Lopes');
    await expect(page.getByTestId('statement-reversed-total')).toContainText('50,00');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/^extrato-\d{4}-\d{2}-01-a-/);

    const calls = await mockCalls(request);
    const csv = calls.find((c) => c.path.endsWith('/statement.csv'));
    // Dia 1º 00:00 em São Paulo (UTC-3) até o dia seguinte ao último dia, exclusivo.
    expect(csv?.body.from).toMatch(/-01T03:00:00\.000Z$/);
    expect(csv?.body.to).toMatch(/T03:00:00\.000Z$/);
  });

  test('mensalistas destaca a solicitação pendente e permite aprovar', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/reservas/mensalistas');
    await expect(page.getByRole('tab', { name: /Solicitações \(1\)/ })).toBeVisible();
    // Mensalista só ocupa horário: não há aba nem coluna de mensalidade.
    await expect(page.getByRole('tab', { name: 'Mensalidades' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Mensalidade' })).toHaveCount(0);
    await page.getByTestId('recurring-row').click();
    await expect(page.getByTestId('recurring-detail')).not.toContainText('Mensalidade');
    await page.getByTestId('recurring-detail').getByRole('button', { name: 'Aprovar' }).click();
    await expect(page.getByText('Mensalista aprovado.')).toBeVisible();
    expect((await mockCalls(request)).some((c) => c.path.endsWith('/approve'))).toBe(true);
  });

  test('professor vê a reserva sem valores nem pagamento (decisão 53)', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'teacher');
    await page.goto('/painel/reservas/avulsas');
    await page.getByTestId('booking-row').click();
    const detail = page.getByTestId('booking-detail');
    await expect(detail.getByText('Dani Rocha')).toBeVisible();
    await expect(detail.getByText('Valores')).toBeHidden();
    await expect(detail.getByText('Pagamento')).toBeHidden();
    await expect(detail.getByText(/R\$/)).toBeHidden();
    await expect(page.getByRole('columnheader', { name: 'Valor' })).toBeHidden();
    await expect(page.getByText('Pagamento')).toBeHidden();
  });

  test('professor não vê Equipe e não tem ações de gestão do espaço', async ({ page, context }) => {
    await loginAs(context, 'multi');
    await page.goto('/painel');
    // Dois espaços: antes de abrir o painel, escolhe qual.
    await expect(page.getByTestId('space-chooser')).toBeVisible();
    await page.getByRole('button', { name: 'Abrir painel' }).nth(1).click();
    await expect(page.getByTestId('space-switcher')).toContainText('Espaço Exemplo B');

    await page.goto('/painel/equipe');
    await expect(page.getByText('Sem permissão')).toBeVisible();

    await page.goto('/painel/espaco/configuracoes');
    await expect(
      page.getByText('Somente Dono e Admin podem alterar as configurações.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar configurações' })).toHaveCount(0);
  });
});

test.describe('agenda larga', () => {
  /** Rola a grade até o fim e conta quem ficou por cima do ponto do menu e quanto a página rolaria. */
  const scrollGrid = (page: Page, x: number) =>
    page.getByTestId('agenda-grid').evaluate((grid: HTMLElement, menuX: number) => {
      grid.scrollLeft = grid.scrollWidth;
      const y = grid.getBoundingClientRect().top + 60;
      const atMenu = document.elementFromPoint(menuX, y);
      const root = document.documentElement;
      return {
        gridScrolled: grid.scrollLeft > 0,
        menuOnTop: !!atMenu?.closest('[data-slot="sidebar-container"]'),
        pageOverflow: root.scrollWidth - root.clientWidth,
      };
    }, x);

  test.beforeEach(async ({ context }) => {
    await loginAs(context, 'manager');
  });

  test('a grade rola por dentro e não passa por cima do menu', async ({ page }) => {
    await page.goto('/painel/agenda?visao=semana');
    await expect(page.getByTestId('agenda-grid')).toBeVisible();
    expect(await scrollGrid(page, 100)).toEqual({
      gridScrolled: true,
      menuOnTop: true,
      pageOverflow: 0,
    });
  });

  test('com o menu recolhido a grade continua contida', async ({ page }) => {
    await page.goto('/painel/agenda?visao=semana');
    await page.getByRole('button', { name: 'Abrir/fechar menu' }).click();
    await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeAttached();
    await expect(page.getByTestId('agenda-grid')).toBeVisible();
    // O menu recolhido sai da tela (a animação leva 200 ms): a grade ganha a largura toda.
    await expect
      .poll(() =>
        page
          .locator('[data-slot="sidebar-container"]')
          .evaluate((el) => el.getBoundingClientRect().right),
      )
      .toBeLessThanOrEqual(0);
    const { gridScrolled, pageOverflow } = await scrollGrid(page, 30);
    expect({ gridScrolled, pageOverflow }).toEqual({ gridScrolled: true, pageOverflow: 0 });
  });

  test('no celular a página não rola de lado, só a grade', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/painel/agenda?visao=semana');
    await expect(page.getByTestId('agenda-grid')).toBeVisible();
    const { gridScrolled, pageOverflow } = await scrollGrid(page, 10);
    expect({ gridScrolled, pageOverflow }).toEqual({ gridScrolled: true, pageOverflow: 0 });
  });
});

test.describe('equipe e convite', () => {
  test('convida por e-mail com o papel escolhido', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/equipe');
    await expect(page.getByTestId('member-row')).toHaveCount(4);
    await page.getByRole('button', { name: 'Convidar' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('E-mail').fill('nova@exemplo.com');
    await dialog.getByRole('button', { name: 'Enviar convite' }).click();
    await expect(page.getByText('Convite enviado por e-mail.')).toBeVisible();
    const call = (await mockCalls(request)).find(
      (c) => c.path.endsWith('/team/invites') && c.body.email === 'nova@exemplo.com',
    );
    expect(call?.body).toEqual({ email: 'nova@exemplo.com', role: 'ADMIN' });
  });

  test('o Dono não tem ações sobre si mesmo', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/equipe');
    const owner = page.getByTestId('member-row').filter({ hasText: 'Gestora Ana' });
    await expect(owner).toContainText('(você)');
    await expect(owner.getByRole('button')).toHaveCount(0);
    await expect(
      page.getByTestId('member-row').filter({ hasText: 'Rafa' }).getByRole('button'),
    ).toHaveCount(2);
  });

  test('convite sem sessão leva a entrar com o next do convite', async ({ page }) => {
    await page.goto('/convite/valido');
    await expect(
      page.getByText('Arena', { exact: false }).or(page.getByText('Espaço Exemplo A')),
    ).toBeVisible();
    await expect(page.getByText('rafa@exemplo.com').first()).toBeVisible();
    await page.getByRole('link', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/entrar\?next=%2Fconvite%2Fvalido$/);
  });

  test('login e cadastro pelo convite travam o e-mail convidado', async ({ page }) => {
    await page.goto('/entrar?next=%2Fconvite%2Fvalido');
    const email = page.getByLabel('E-mail');
    await expect(email).toHaveValue('rafa@exemplo.com');
    await expect(email).not.toBeEditable();
    await expect(page.getByText('E-mail do convite.')).toBeVisible();

    await page.getByRole('link', { name: 'Criar conta' }).click();
    await expect(page).toHaveURL(/\/cadastro\?next=%2Fconvite%2Fvalido$/);
    await expect(email).toHaveValue('rafa@exemplo.com');
    await expect(email).not.toBeEditable();
  });

  test('sem convite, ou com convite indisponível, o e-mail fica livre', async ({ page }) => {
    await page.goto('/entrar');
    await expect(page.getByLabel('E-mail')).toBeEditable();
    await expect(page.getByLabel('E-mail')).toHaveValue('');
    await page.goto('/cadastro?next=%2Fconvite%2Fexpirado');
    await expect(page.getByRole('heading', { name: 'Criar conta' })).toBeVisible();
    await expect(page.getByLabel('E-mail')).toBeEditable();
  });

  test('logado com outro e-mail, explica e oferece trocar de conta', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/convite/valido');
    await expect(page.getByText(/o convite é para rafa@exemplo.com/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aceitar convite' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Trocar de conta' }).click();
    await expect(page).toHaveURL(/\/entrar\?next=%2Fconvite%2Fvalido$/);
    await expect(page.getByLabel('E-mail')).toHaveValue('rafa@exemplo.com');
    await expect(page.getByLabel('E-mail')).not.toBeEditable();
  });

  test('convite expirado e inexistente mostram a mensagem', async ({ page }) => {
    await page.goto('/convite/expirado');
    await expect(page.getByText('Este convite expirou. Peça um novo ao espaço.')).toBeVisible();
    await page.goto('/convite/xyz');
    await expect(page.getByText(/Este link de convite não existe/)).toBeVisible();
  });
});

test.describe('página pública do espaço', () => {
  test('tem metadados, JSON-LD e o botão abrir no app', async ({ page }) => {
    await page.goto('/espacos/arena-exemplo');
    await expect(page.getByRole('heading', { level: 1, name: 'Arena Exemplo' })).toBeVisible();
    await expect(page).toHaveTitle(/Arena Exemplo · Belo Horizonte/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      'https://example.com/capa.jpg',
    );
    await expect(page.getByTestId('open-in-app')).toHaveAttribute(
      'href',
      'spacesports://espacos/arena-exemplo',
    );

    const ld = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}',
    );
    expect(ld['@type']).toBe('SportsActivityLocation');
    expect(ld.name).toBe('Arena Exemplo');
    await expect(page.getByText('R$ 120,00')).toBeVisible();
  });

  test('espaço inexistente retorna 404', async ({ page }) => {
    await page.goto('/espacos/nao-existe');
    await expect(page.getByText('Página não encontrada')).toBeVisible();
  });
});
