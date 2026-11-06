import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { loginAs, mockCalls } from './helpers';

const heading = (name: string) => ({ name, exact: true });

test.describe('convite público (RF-CONTACT-02)', () => {
  test('mostra o resumo, fica fora de buscadores e não expõe o que a prévia não traz', async ({
    page,
  }) => {
    await page.goto('/r/aberto');
    await expect(page.getByRole('heading', heading('Convite para jogar'))).toBeVisible();
    const summary = page.getByRole('list', { name: 'Reserva' });
    await expect(summary).toContainText('Arena Exemplo');
    await expect(summary).toContainText('Quadra 1 · Futevôlei');
    await expect(summary).toContainText('Organizado por Marina');
    await expect(summary).toContainText('R$ 60,00');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('button', { name: 'Confirmar presença' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Não vou' })).toBeVisible();
  });

  test('confirma sem conta com WhatsApp em E.164 e consentimento desmarcado', async ({
    page,
    request,
  }) => {
    await page.goto('/r/aberto');
    await page.getByRole('button', { name: 'Confirmar presença' }).click();

    const consent = page.getByRole('checkbox', {
      name: 'Quero receber novidades e convites do Space Sports',
    });
    await expect(consent).not.toBeChecked();
    await expect(page.getByText(/ficam com o Space Sports e com o espaço/)).toBeVisible();

    await page.getByRole('button', { name: 'Confirmar presença' }).click();
    await expect(page.getByText('Informe seu nome')).toBeVisible();
    await expect(page.getByText('Informe o WhatsApp ou o e-mail', { exact: true })).toBeVisible();

    await page.getByLabel('Seu nome').fill('  Bruna Lima ');
    const whatsapp = page.getByLabel('WhatsApp');
    await whatsapp.pressSequentially('31988887777');
    await expect(whatsapp).toHaveValue('(31) 98888-7777');
    await page.getByRole('button', { name: 'Confirmar presença' }).click();

    await expect(page.getByRole('heading', heading('Presença confirmada'))).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir no app' })).toHaveAttribute(
      'href',
      'spacesports://convite/aberto',
    );
    const signUp = await page.getByRole('link', { name: 'Criar conta' }).getAttribute('href');
    expect(new URLSearchParams(signUp?.split('?')[1]).get('next')).toBe('/r/aberto?aceitar=1');

    const call = (await mockCalls(request)).find((c) => c.path.includes('/aberto/confirm'));
    expect(call?.body).toEqual({
      name: 'Bruna Lima',
      phone: '+5531988887777',
      marketingConsent: false,
    });
  });

  test('confirma por e-mail só com a caixa marcada pela pessoa', async ({ page, request }) => {
    await page.goto('/r/aberto');
    await page.getByRole('button', { name: 'Confirmar presença' }).click();
    await page.getByLabel('Seu nome').fill('Davi');
    await page.getByLabel('E-mail').fill('Davi@Exemplo.com');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Confirmar presença' }).click();
    await expect(page.getByRole('heading', heading('Presença confirmada'))).toBeVisible();

    const call = (await mockCalls(request)).find((c) => c.path.includes('/aberto/confirm'));
    expect(call?.body).toEqual({
      name: 'Davi',
      email: 'davi@exemplo.com',
      marketingConsent: true,
    });
  });

  test('WhatsApp incompleto não vai para a API', async ({ page, request }) => {
    await page.goto('/r/aberto');
    await page.getByRole('button', { name: 'Confirmar presença' }).click();
    await page.getByLabel('Seu nome').fill('Bruna');
    await page.getByLabel('WhatsApp').fill('3198');
    await page.getByRole('button', { name: 'Confirmar presença' }).click();
    await expect(page.getByText('Informe o WhatsApp com DDD')).toBeVisible();
    expect((await mockCalls(request)).some((c) => c.path.includes('/confirm'))).toBe(false);
  });

  test('"Não vou" pede confirmação, não pede dados e avisa o organizador', async ({
    page,
    request,
  }) => {
    await page.goto('/r/aberto');
    await page.getByRole('button', { name: 'Não vou' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Voltar' }).click();
    expect((await mockCalls(request)).some((c) => c.path.includes('/decline'))).toBe(false);

    await page.getByRole('button', { name: 'Não vou' }).click();
    await dialog.getByRole('button', { name: 'Não vou' }).click();
    await expect(page.getByRole('heading', heading('Resposta enviada'))).toBeVisible();
    await expect(page.getByText('Avisamos Marina que você não vai.')).toBeVisible();
    expect((await mockCalls(request)).some((c) => c.path.includes('/aberto/decline'))).toBe(true);
  });

  for (const [token, title, text] of [
    ['expirado', 'Convite expirado', 'já terminou'],
    ['terminado', 'Convite expirado', 'já terminou'],
    ['cancelado', 'Reserva cancelada', 'foi cancelada'],
    ['respondido', 'Convite já respondido', 'já foi confirmada'],
    ['recusado', 'Convite já respondido', 'Não vou'],
    ['ocupada', 'Vaga ocupada', 'já foi preenchida'],
  ] as const) {
    test(`estado: ${token}`, async ({ page }) => {
      await page.goto(`/r/${token}`);
      await expect(page.getByRole('heading', heading(title))).toBeVisible();
      await expect(page.getByText(text)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Confirmar presença' })).toBeHidden();
    });
  }

  test('convite direto a uma conta manda entrar, sem formulário', async ({ page }) => {
    await page.goto('/r/conta');
    await expect(page.getByText('Este convite é para uma conta')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Entrar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar presença' })).toBeHidden();
  });

  test('link que não existe mais', async ({ page }) => {
    await page.goto('/r/nao-existe');
    await expect(page.getByRole('heading', heading('Convite indisponível'))).toBeVisible();
    await expect(page.getByText('Peça um novo ao organizador')).toBeVisible();
  });

  test('a vaga ocupada durante o preenchimento aparece sem perder a pessoa', async ({ page }) => {
    await page.goto('/r/disputado');
    await page.getByRole('button', { name: 'Confirmar presença' }).click();
    await page.getByLabel('Seu nome').fill('Bruna');
    await page.getByLabel('E-mail').fill('bruna@exemplo.com');
    await page.getByRole('button', { name: 'Confirmar presença' }).click();
    await expect(page.getByRole('heading', heading('Vaga ocupada'))).toBeVisible();
  });

  // A.14 / RF-CONTACT-02: a API recusa com INVITE_SLOT_TAKEN quem chega depois de outra pessoa SEM
  // conta. A prévia anônima não diz quem ficou com a vaga (ela mostraria "Convite já respondido",
  // como se fosse a mesma pessoa): só o erro garante que quem está na tela não ficou com ela.
  test('vaga confirmada por outra pessoa sem conta: "Vaga ocupada", não "Presença confirmada"', async ({
    page,
    request,
  }) => {
    await page.goto('/r/disputadoSemConta');
    await page.getByRole('button', { name: 'Confirmar presença' }).click();
    await page.getByLabel('Seu nome').fill('Bruna');
    await page.getByLabel('E-mail').fill('bruna@exemplo.com');
    await page.getByRole('button', { name: 'Confirmar presença' }).click();

    await expect(page.getByRole('heading', heading('Vaga ocupada'))).toBeVisible();
    await expect(page.getByText('já foi preenchida')).toBeVisible();
    await expect(page.getByRole('heading', heading('Presença confirmada'))).toBeHidden();
    await expect(page.getByRole('heading', heading('Convite já respondido'))).toBeHidden();
    expect(
      (await mockCalls(request)).some((c) => c.path.includes('/disputadoSemConta/confirm')),
    ).toBe(true);
  });

  test('link já confirmado por outra pessoa, aberto depois, não oferece a confirmação', async ({
    page,
  }) => {
    await page.goto('/r/respondido');
    await expect(page.getByRole('heading', heading('Convite já respondido'))).toBeVisible();
    await expect(page.getByText('Se não foi você, peça outro link a Marina')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar presença' })).toBeHidden();
  });

  test('limite de tentativas mantém o formulário preenchido', async ({ page }) => {
    await page.goto('/r/limite');
    await page.getByRole('button', { name: 'Confirmar presença' }).click();
    await page.getByLabel('Seu nome').fill('Bruna');
    await page.getByLabel('E-mail').fill('bruna@exemplo.com');
    await page.getByRole('button', { name: 'Confirmar presença' }).click();
    await expect(page.getByText('Muitas tentativas seguidas')).toBeVisible();
    await expect(page.getByLabel('Seu nome')).toHaveValue('Bruna');
  });
});

test.describe('convite com conta (RF-CONTACT-03)', () => {
  test('com sessão, confirma pela conta, sem pedir dados', async ({ page, context, request }) => {
    await loginAs(context, 'player');
    await page.goto('/r/aberto');
    await page.getByRole('button', { name: 'Confirmar presença' }).click();
    await expect(page.getByRole('heading', heading('Presença confirmada'))).toBeVisible();
    await expect(page.getByText('A reserva está na sua conta.')).toBeVisible();
    await expect(page.getByLabel('Seu nome')).toBeHidden();

    const paths = (await mockCalls(request)).map((c) => c.path);
    expect(paths).toContain('POST /invites/aberto/accept');
    expect(paths.some((p) => p.includes('/public/invites/aberto/confirm'))).toBe(false);

    await page.reload();
    await expect(page.getByRole('heading', heading('Presença confirmada'))).toBeVisible();
  });

  test('confirma sem conta, cria a conta e o convite é aceito ao voltar', async ({
    page,
    request,
  }) => {
    await page.goto('/r/respondido');
    await page.getByRole('link', { name: 'Criar conta' }).click();
    await page.getByLabel('Nome').fill('Nova Jogadora');
    await page.getByLabel('E-mail').fill('nova@exemplo.com');
    await page.getByLabel('Telefone').fill('31988887777');
    await page.getByLabel('Senha', { exact: true }).fill('senha-1234');
    await page.getByLabel('Confirmar senha').fill('senha-1234');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await page.getByRole('button', { name: 'Pular' }).click();

    await expect(page).toHaveURL(/verificar-email/);
    const signUp = (await mockCalls(request)).find((c) => c.path === '/sign-up/email');
    expect(signUp?.body.callbackURL).toContain(encodeURIComponent('/r/respondido?aceitar=1'));

    await page.getByRole('link', { name: 'Continuar' }).click();
    await expect(page.getByText('A reserva está na sua conta.')).toBeVisible();
    const accepts = (await mockCalls(request)).filter((c) => c.path.endsWith('/accept'));
    expect(accepts).toHaveLength(1);
  });

  test('convite direto pendente com ?aceitar=1 aceita de fato pela conta certa', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'player');
    await page.goto('/r/direto?aceitar=1');
    await expect(page.getByRole('heading', heading('Presença confirmada'))).toBeVisible();
    await expect(page.getByText('A reserva está na sua conta.')).toBeVisible();
    const accepts = (await mockCalls(request)).filter(
      (c) => c.path === 'POST /invites/direto/accept',
    );
    expect(accepts).toHaveLength(1);
  });

  test('convite direto pendente, sem ?aceitar=1, espera a resposta da conta certa', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'player');
    await page.goto('/r/direto');
    await expect(page.getByRole('heading', heading('Convite para jogar'))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Não vou' })).toBeVisible();
    await expect(page.getByRole('heading', heading('Presença confirmada'))).toBeHidden();
    expect((await mockCalls(request)).some((c) => c.path.endsWith('/accept'))).toBe(false);

    await page.getByRole('button', { name: 'Confirmar presença' }).click();
    await expect(page.getByText('A reserva está na sua conta.')).toBeVisible();
  });

  test('convite direto de outra conta oferece trocar de conta antes do clique', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/r/conta?aceitar=1');
    await expect(page.getByText('Este convite é para outra conta')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar presença' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Não vou' })).toBeHidden();
    await expect(page.getByText('A reserva está na sua conta.')).toBeHidden();
    expect((await mockCalls(request)).some((c) => c.path.endsWith('/accept'))).toBe(false);

    await page.getByRole('button', { name: 'Trocar de conta' }).click();
    await expect(page).toHaveURL(/\/entrar/);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/r/conta?aceitar=1');
  });

  test('presença confirmada com contato da conta pode vir para ela', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'player');
    await page.goto('/r/respondido');
    await page.getByRole('button', { name: 'Trazer para minha conta' }).click();
    await expect(page.getByText('A reserva está na sua conta.')).toBeVisible();
    const paths = (await mockCalls(request)).map((c) => c.path);
    expect(paths).toContain('POST /invites/respondido/accept');
  });

  test('vaga confirmada por outra pessoa não oferece trazer para a conta', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'player');
    await page.goto('/r/alheio?aceitar=1');
    await expect(page.getByRole('heading', heading('Vaga ocupada'))).toBeVisible();
    await expect(page.getByText('use a conta com o e-mail ou o telefone')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trazer para minha conta' })).toBeHidden();
    expect((await mockCalls(request)).some((c) => c.path.endsWith('/accept'))).toBe(false);
  });

  test('vaga tomada entre a prévia e o clique mostra a vaga ocupada', async ({ page, context }) => {
    await loginAs(context, 'player');
    await page.goto('/r/tomado');
    await page.getByRole('button', { name: 'Trazer para minha conta' }).click();
    await expect(page.getByRole('heading', heading('Vaga ocupada'))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trazer para minha conta' })).toBeHidden();
    await expect(page.getByText('A reserva está na sua conta.')).toBeHidden();
  });
});

test.describe('descadastro (RF-CONTACT-08)', () => {
  const VALID = '00000000-0000-4000-8000-000000000001.assinatura_ok-1';

  test('só descadastra com o clique, não ao abrir o link', async ({ page, request }) => {
    await page.goto(`/descadastro/${VALID}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('button', { name: 'Confirmar descadastro' })).toBeVisible();
    expect((await mockCalls(request)).some((c) => c.path.includes('unsubscribe'))).toBe(false);

    await page.getByRole('button', { name: 'Confirmar descadastro' }).click();
    await expect(page.getByRole('heading', heading('Descadastro feito'))).toBeVisible();
    const call = (await mockCalls(request)).find((c) => c.path.includes('unsubscribe'));
    expect(call?.body).toEqual({ token: VALID });
  });

  test('link inválido explica o que houve', async ({ page }) => {
    await page.goto('/descadastro/token-errado');
    await page.getByRole('button', { name: 'Confirmar descadastro' }).click();
    await expect(page.getByRole('heading', heading('Link inválido'))).toBeVisible();
  });
});

test.describe('contatos no painel (RF-CONTACT-07)', () => {
  test('lista com consentimento, origem, data e WhatsApp, sem conta nem apagar', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel');
    await page.getByRole('link', { name: 'Contatos' }).click();
    await expect(page.getByRole('heading', { name: 'Contatos' })).toBeVisible();

    const bruna = page.getByRole('row', { name: /Bruna Lima/ });
    await expect(bruna).toContainText('Com consentimento');
    await expect(bruna).toContainText('desde 01/10/2026');
    await expect(bruna).toContainText('Convite respondido');
    await expect(bruna.getByRole('link', { name: 'WhatsApp de Bruna Lima' })).toHaveAttribute(
      'href',
      'https://wa.me/5531988887777',
    );

    const noName = page.getByRole('row', { name: /Sem nome/ });
    await expect(noName).toContainText('Sem consentimento');
    await expect(noName).toContainText('15/09/2026');
    await expect(noName.getByRole('link')).toHaveCount(0);

    await expect(page.getByRole('row', { name: /Davi Reis/ })).toContainText('Descadastrado');
    await expect(page.getByRole('columnheader', { name: 'Conta', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: /Apagar/ })).toHaveCount(0);
  });

  test('busca e filtros', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/contatos');
    await page.getByLabel('Buscar por nome').fill('davi');
    await expect(page.getByRole('row', { name: /Bruna Lima/ })).toBeHidden();
    await expect(page.getByRole('row', { name: /Davi Reis/ })).toBeVisible();

    await page.getByLabel('Buscar por nome').fill('');
    await page.getByLabel('Origem').selectOption('DESK_BOOKING');
    await expect(page.getByRole('row', { name: /Sem nome/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Bruna Lima/ })).toBeHidden();

    await page.getByLabel('Origem').selectOption('');
    await page.getByLabel('Buscar por nome').fill('ninguem');
    await expect(page.getByText('Nenhum contato encontrado')).toBeVisible();
  });

  test('exporta com os filtros da tela, e não oferece o filtro que sairia vazio', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/contatos');
    await page.getByLabel('Origem').selectOption('BOOKING_INVITE_SELF');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^contatos-espaco-a-\d{4}-\d{2}-\d{2}\.csv$/);
    const bytes = await readFile((await file.path()) as string);
    // Um BOM só: o `fetch` tira o da API, e o Excel precisa dele para os acentos.
    expect(bytes.subarray(0, 3).toString('hex')).toBe('efbbbf');
    expect(bytes.subarray(3, 6).toString('hex')).not.toBe('efbbbf');
    expect(bytes.toString('utf8')).toContain('/descadastro/');

    const call = (await mockCalls(request)).find((c) => c.path === 'GET /contacts/export.csv');
    expect(call?.body).toEqual({ origin: 'BOOKING_INVITE_SELF' });

    await page.getByLabel('Consentimento').selectOption('false');
    await expect(page.getByRole('button', { name: 'Exportar CSV' })).toBeDisabled();
  });

  test('professor não vê Contatos no menu nem a tela', async ({ page, context }) => {
    await loginAs(context, 'teacher');
    await page.goto('/painel');
    await expect(page.getByRole('link', { name: 'Agenda' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contatos' })).toHaveCount(0);
    await page.goto('/painel/contatos');
    await expect(page.getByText('Sem permissão')).toBeVisible();
  });
});

test.describe('contatos no Super (RF-CONTACT-06/08)', () => {
  test('mostra conta vinculada e o que foi informado em cada espaço', async ({ page, context }) => {
    await loginAs(context, 'super');
    await page.goto('/super');
    await page.getByRole('link', { name: 'Contatos' }).click();

    const bruna = page.getByRole('row', { name: /Bruna Lima/ });
    await expect(bruna.getByRole('link', { name: 'Ver conta' })).toHaveAttribute(
      'href',
      /\/super\/usuarios\//,
    );
    await expect(bruna).toContainText('Espaço Exemplo A');
    await expect(page.getByRole('row', { name: /Caio Prado/ })).toContainText('Sem conta');

    await bruna.getByRole('button', { name: 'Ver detalhes de Bruna Lima' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toContainText('Bruninha');
    await expect(sheet).toContainText('Convite respondido');
  });

  test('filtra por conta e por espaço e exporta com esses filtros', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'super');
    await page.goto('/super/contatos');
    await page.getByLabel('Conta', { exact: true }).selectOption('false');
    await expect(page.getByRole('row', { name: /Bruna Lima/ })).toBeHidden();
    await expect(page.getByRole('row', { name: /Caio Prado/ })).toBeVisible();

    await page.getByLabel('Conta', { exact: true }).selectOption('');
    await page.getByLabel('Espaço').selectOption({ label: 'Espaço Exemplo A' });
    await expect(page.getByRole('row', { name: /Caio Prado/ })).toBeHidden();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    await download;
    const call = (await mockCalls(request)).find(
      (c) => c.path === 'GET /super/contacts/export.csv',
    );
    expect(Object.keys(call?.body ?? {})).toEqual(['spaceId']);
  });

  test('apaga depois de confirmar', async ({ page, context, request }) => {
    await loginAs(context, 'super');
    await page.goto('/super/contatos');
    await page.getByRole('button', { name: 'Apagar Caio Prado' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Não dá para desfazer');
    await dialog.getByRole('button', { name: 'Voltar' }).click();
    expect((await mockCalls(request)).some((c) => c.path.startsWith('DELETE'))).toBe(false);

    await page.getByRole('button', { name: 'Apagar Caio Prado' }).click();
    await dialog.getByRole('button', { name: 'Apagar contato' }).click();
    await expect(page.getByText('Contato apagado.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Caio Prado/ })).toBeHidden();
    await expect(page.getByRole('row', { name: /Bruna Lima/ })).toBeVisible();
  });
});

test.describe('agenda (RF-CONTACT-05)', () => {
  test('reserva de balcão explica para que serve o telefone', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/agenda');
    await page.getByRole('button', { name: 'Reserva de balcão' }).click();
    await expect(page.getByText(/Serve para reconhecer o cliente depois/)).toBeVisible();
  });

  test('mensalista de balcão explica para que serve o telefone', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/reservas/mensalistas');
    await page
      .getByRole('button', { name: /mensalista/i })
      .first()
      .click();
    await expect(page.getByText(/Serve para reconhecer o cliente depois/)).toBeVisible();
  });

  test('telefone só sugere: vincular exige a confirmação da gestão', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/agenda');
    await page.getByTestId('agenda-booking').click();
    const suggestion = page.getByTestId('suggested-user');
    await expect(suggestion).toContainText('Carlos');

    await suggestion.getByRole('button', { name: 'Vincular a esta conta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Vincular a esta conta' });
    await expect(dialog).toContainText('Minhas reservas');
    expect((await mockCalls(request)).some((c) => c.path.includes('confirm-link'))).toBe(false);

    await dialog.getByRole('button', { name: 'Vincular', exact: true }).click();
    await expect(page.getByText('Reserva vinculada à conta.')).toBeVisible();
    await expect(page.getByTestId('suggested-user')).toBeHidden();

    const call = (await mockCalls(request)).find((c) => c.path.includes('confirm-link'));
    expect(call?.body).toEqual({ userId: '00000000-0000-4000-8000-000000000061' });
  });

  test('sugestão que mudou mostra o erro no diálogo', async ({ page, context }) => {
    await context.addCookies([
      { name: 'e2e-stale-link', value: '1', url: 'http://localhost:3100' },
    ]);
    await loginAs(context, 'manager');
    await page.goto('/painel/agenda');
    await page.getByTestId('agenda-booking').click();
    await page.getByRole('button', { name: 'Vincular a esta conta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Vincular a esta conta' });
    await dialog.getByRole('button', { name: 'Vincular', exact: true }).click();
    await expect(dialog).toContainText('Esta sugestão não vale mais');
  });
});
