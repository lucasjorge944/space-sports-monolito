import { expect, test } from './fixtures';
import { loginAs, mockCalls } from './helpers';

test.describe('anatomia de campo', () => {
  test('erro liga ao campo, mantém a dica e leva o foco ao primeiro inválido', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/agenda');
    await page.getByRole('button', { name: 'Reserva de balcão' }).click();
    const dialog = page.getByRole('dialog');
    const phone = dialog.getByLabel('Telefone (WhatsApp)');
    await phone.fill('319');
    await dialog.getByRole('button', { name: 'Criar reserva' }).click();

    const name = dialog.getByLabel('Nome do cliente');
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAccessibleDescription('Informe o nome do cliente');

    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    await expect(phone).toHaveAccessibleDescription(
      /Informe o telefone com DDD.*Serve para reconhecer o cliente/,
    );
  });
});

test.describe('máscaras', () => {
  test('telefone formata ao digitar e vai em E.164 para a API', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/agenda');
    await page.getByRole('button', { name: 'Reserva de balcão' }).click();
    const dialog = page.getByRole('dialog');
    const phone = dialog.getByLabel('Telefone (WhatsApp)');
    await expect(phone).toHaveAttribute('inputmode', 'tel');
    await phone.pressSequentially('31988887777');
    await expect(phone).toHaveValue('(31) 98888-7777');

    await expect(dialog.getByRole('spinbutton')).toHaveCount(0);
    await dialog.getByLabel('Nome do cliente').fill('Cliente Máscara');
    await dialog.getByRole('button', { name: 'Criar reserva' }).click();
    await expect(page.getByText('Reserva de balcão criada.')).toBeVisible();
    const create = (await mockCalls(request)).find((c) => c.body.guestName === 'Cliente Máscara');
    expect(create?.body.guestPhone).toBe('+5531988887777');
  });

  test('corrigir um dígito no meio não joga o cursor para o fim', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/espaco');
    const phone = page.getByLabel('Telefone', { exact: true });
    await phone.fill('31988887777');
    await expect(phone).toHaveValue('(31) 98888-7777');
    await phone.evaluate((el: HTMLInputElement) => el.setSelectionRange(5, 5));
    await page.keyboard.press('Delete');
    await page.keyboard.type('7');
    await expect(phone).toHaveValue('(31) 78888-7777');
    await expect(phone).toHaveJSProperty('selectionStart', 6);
  });

  test('valor em reais tem prefixo, agrupa o milhar e completa os centavos', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/espaco/configuracoes');
    const price = page.getByLabel('Preço por hora');
    await expect(price).toHaveAttribute('inputmode', 'decimal');
    await price.fill('');
    await price.pressSequentially('1500');
    await expect(price).toHaveValue('1.500');
    await price.blur();
    await expect(price).toHaveValue('1.500,00');
    await expect(page.getByText('R$', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Salvar configurações' }).click();
    await expect(page.getByText('Configurações salvas.')).toBeVisible();
    const save = (await mockCalls(request)).find((c) => c.path.endsWith('/settings'));
    expect(save?.body.pricePerHourCents).toBe(150000);
  });

  test('hora de funcionamento com máscara, sem campo nativo', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/espaco');
    const opens = page.getByLabel('Segunda: abre').first();
    await opens.fill('');
    await opens.pressSequentially('0730');
    await expect(opens).toHaveValue('07:30');

    // Hora impossível não entra: volta ao valor anterior ao sair do campo.
    const closes = page.getByLabel('Segunda: fecha').first();
    const before = await closes.inputValue();
    await closes.fill('2590');
    await closes.blur();
    await expect(closes).toHaveValue(before);

    await page.getByRole('button', { name: 'Salvar horário' }).click();
    await expect(page.getByText('Horário de funcionamento salvo.')).toBeVisible();
    const save = (await mockCalls(request)).find((c) => c.path.endsWith('/opening-hours'));
    const hours = save?.body.openingHours as { weekday: number; opensAt: string }[];
    expect(hours.find((h) => h.weekday === 1)?.opensAt).toBe('07:30');
  });
});

test.describe('seletor de data', () => {
  test('calendário em português, semana a partir do domingo, e valor no formato da API', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/agenda?data=2026-11-10');
    await page.getByRole('button', { name: 'Bloquear horário' }).click();
    const dialog = page.getByRole('dialog');
    const date = dialog.getByLabel('Data');
    await expect(date).toHaveValue('10/11/2026');

    await dialog.getByRole('button', { name: 'Abrir calendário' }).click();
    const calendar = page.getByRole('grid', { name: /novembro/i });
    await expect(calendar).toBeVisible();
    await expect(calendar.locator('th').first()).toHaveText(/dom/i);
    await calendar.getByRole('button', { name: /25 de novembro de 2026/ }).click();

    await expect(calendar).toHaveCount(0);
    await expect(date).toHaveValue('25/11/2026');
    await dialog.getByRole('button', { name: 'Bloquear' }).click();
    await expect(page.getByText('Horário bloqueado.')).toBeVisible();
    const block = (await mockCalls(request)).find((c) => 'endsAt' in c.body);
    // 25/11 local; o instante vai em UTC.
    expect(String(block?.body.startsAt)).toContain('2026-11-25T');
  });

  test('digitação é opcional: só data completa e válida entra', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/agenda?data=2026-11-10');
    const date = page.getByLabel('Ir para a data');
    await date.fill('');
    await date.pressSequentially('31022026');
    await expect(date).toHaveValue('31/02/2026');
    await expect(date).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/data=2026-11-10/);
    await date.blur();
    await expect(date).toHaveValue('10/11/2026');

    await date.fill('');
    await date.pressSequentially('05122026');
    await expect(page).toHaveURL(/data=2026-12-05/);
  });

  test('período: dois cliques no calendário filtram em yyyy-MM-dd', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/reservas/avulsas');
    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/bookings')) requests.push(r.url());
    });
    await page.getByLabel('De', { exact: true }).fill('01/10/2026');
    await page.getByLabel('Até', { exact: true }).fill('31/10/2026');

    await page.getByRole('button', { name: 'Abrir calendário' }).click();
    const october = page.getByRole('grid', { name: /outubro/i });
    await october.getByRole('button', { name: /20 de outubro de 2026/ }).click();
    await expect(page.getByLabel('De', { exact: true })).toHaveValue('01/10/2026');
    await october.getByRole('button', { name: / 5 de outubro de 2026/ }).click();

    await expect(page.getByLabel('De', { exact: true })).toHaveValue('05/10/2026');
    await expect(page.getByLabel('Até', { exact: true })).toHaveValue('20/10/2026');
    await expect.poll(() => requests.some((u) => /from=2026-10-0[45]/.test(u))).toBe(true);
  });
});

test.describe('quadras', () => {
  test('cadastro só com esportes, em chips, e sem capacidade', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/espaco/quadras');
    await page.getByRole('button', { name: 'Nova quadra' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome').fill('Quadra Nova');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(dialog.getByText('Escolha ao menos um esporte')).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Esportes' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    const chip = dialog.getByRole('button', { name: 'Futevôlei' });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByText(/capacidade/i)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Quadra criada.')).toBeVisible();
    const create = (await mockCalls(request)).find((c) => c.body.name === 'Quadra Nova');
    expect(create?.body).toEqual({
      name: 'Quadra Nova',
      covered: false,
      status: 'ACTIVE',
      sportIds: [expect.any(String)],
    });
  });
});

test.describe('busca de CEP', () => {
  test('preenche o endereço e leva o foco ao número', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/espaco');
    const cep = page.getByLabel('CEP');
    await cep.pressSequentially('30130010');
    await expect(cep).toHaveValue('30130-010');
    await expect(page.getByLabel('Rua')).toHaveValue('Avenida Afonso Pena');
    await expect(page.getByLabel('Bairro')).toHaveValue('Centro');
    await expect(page.getByLabel('Número')).toBeFocused();
    await expect(page.getByText('Endereço preenchido pelo CEP')).toBeVisible();

    await page.getByLabel('Número').fill('100');
    await page.getByRole('button', { name: 'Salvar dados' }).click();
    await expect(page.getByText('Dados do espaço salvos.')).toBeVisible();
    const save = (await mockCalls(request)).find((c) => 'address' in c.body);
    expect(save?.body.address).toEqual({
      street: 'Avenida Afonso Pena',
      number: '100',
      neighborhood: 'Centro',
      postalCode: '30130010',
    });
  });

  test('CEP não encontrado avisa e deixa preencher à mão', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/espaco');
    const cep = page.getByLabel('CEP');
    await cep.pressSequentially('99999999');
    await expect(page.getByText('CEP não encontrado. Preencha à mão')).toBeVisible();
    await expect(cep).not.toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('Rua').fill('Rua à mão');
    await expect(page.getByLabel('Rua')).toHaveValue('Rua à mão');
  });

  test('busca fora do ar também não trava o formulário', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/espaco');
    await page.getByLabel('CEP').pressSequentially('88888888');
    await expect(page.getByText('Não foi possível buscar o CEP. Preencha à mão')).toBeVisible();
  });
});
