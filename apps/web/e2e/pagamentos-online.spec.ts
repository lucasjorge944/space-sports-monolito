import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAs, MOCK_API, mockCalls } from './helpers';

// Pagamento online no painel e no /super (PG.3; RF-ONPAY-01, 02, 07 a 12; RN-ONPAY-05). A API
// simulada guarda o cenário por teste (`/__online-setup`, e2e/mock-online-payments.mjs).

async function setup(request: APIRequestContext, scenario: Record<string, string> = {}) {
  await request.get(`${MOCK_API}/__online-setup?${new URLSearchParams(scenario)}`);
}

test.describe('recebimentos online: permissões', () => {
  test('professor não vê o item nem a página', async ({ page, context, request }) => {
    await setup(request);
    await loginAs(context, 'teacher');
    await page.goto('/painel/recebimentos-online');
    await expect(page.getByText('Sem permissão')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Recebimentos online' })).toHaveCount(0);
  });

  test('admin vê o status, mas só o dono faz o cadastro (decisão 95)', async ({
    page,
    context,
    request,
  }) => {
    await setup(request);
    await loginAs(context, 'admin');
    await page.goto('/painel/recebimentos-online');
    const card = page.getByTestId('merchant-card');
    await expect(card).toContainText('Não iniciado');
    await expect(card).toContainText('Só o dono do espaço pode fazer o cadastro.');
    await expect(card.getByRole('link', { name: 'Começar cadastro' })).toHaveCount(0);

    await page.goto('/painel/recebimentos-online/cadastro');
    await expect(page.getByText('Sem permissão')).toBeVisible();
  });

  test('sem cadastro aprovado, as formas de pagamento ficam bloqueadas', async ({
    page,
    context,
    request,
  }) => {
    await setup(request);
    await loginAs(context, 'manager');
    await page.goto('/painel/recebimentos-online');
    const modes = page.getByTestId('modes-card');
    await expect(modes).toContainText('Disponível depois que a conta de recebimento for aprovada.');
    await expect(modes.getByRole('radio', { name: /Online obrigatório/ })).toBeDisabled();
    await expect(modes.getByRole('button', { name: 'Salvar alterações' })).toHaveCount(0);
    // Taxa vigente, só leitura, com o exemplo calculado.
    const fee = page.getByTestId('fee-card');
    await expect(fee).toContainText('4%');
    await expect(fee).toContainText('6%');
    await expect(fee.getByTestId('fee-example')).toContainText('o espaço recebe R$ 96,00');
  });

  test('pagamento online desligado na plataforma', async ({ page, context, request }) => {
    await setup(request, { merchant: 'APPROVED', disabled: '1' });
    await loginAs(context, 'manager');
    await page.goto('/painel/recebimentos-online?aba=configuracao');
    await expect(page.getByTestId('online-disabled')).toContainText(
      'O pagamento pelo app está desligado na plataforma.',
    );
    await expect(page.getByRole('link', { name: 'Trocar conta bancária' })).toHaveCount(0);
  });
});

test.describe('recebimentos online: cadastro e modos', () => {
  test('dono faz o cadastro em etapas e envia (RF-ONPAY-01)', async ({
    page,
    context,
    request,
  }) => {
    await setup(request);
    await loginAs(context, 'manager');
    await page.goto('/painel/recebimentos-online');
    await page.getByRole('link', { name: 'Começar cadastro' }).click();
    await expect(
      page.getByRole('heading', { name: 'Cadastro da conta de recebimento' }),
    ).toBeVisible();
    // Gateway simulado: faixa de teste com a dica que a API manda.
    await expect(page.getByTestId('sandbox-banner')).toContainText(
      'Documento terminado em 0000 é recusado.',
    );

    // 1. Quem recebe: validação antes de seguir.
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByText('Informe um CNPJ válido')).toBeVisible();
    await page.getByRole('textbox', { name: 'CNPJ' }).fill('11.222.333/0001-81');
    await page.getByLabel('Razão social').fill('Arena Exemplo Ltda');
    await page.getByLabel('Responsável pela conta').fill('Gestora Ana');
    await page.getByLabel('Telefone').fill('(31) 99999-8888');
    await page.getByLabel('E-mail').fill('financeiro@arena.exemplo');
    // Com CNPJ, o CPF do responsável é obrigatório e validado (PG.2b), com máscara.
    await page.getByRole('button', { name: 'Continuar' }).click();
    const responsibleCpf = page.getByRole('textbox', { name: 'CPF do responsável' });
    await expect(page.getByText('Informe um CPF válido')).toBeVisible();
    await responsibleCpf.fill('111.111.111-11');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByText('Informe um CPF válido')).toBeVisible();
    await responsibleCpf.fill('52998224725');
    await expect(responsibleCpf).toHaveValue('529.982.247-25');
    await page.getByRole('button', { name: 'Continuar' }).click();

    // 2. Endereço: o CEP preenche rua, bairro, cidade e UF.
    await page.getByLabel('CEP').fill('30130-010');
    await expect(page.getByLabel('Rua')).toHaveValue('Avenida Afonso Pena');
    await page.getByLabel('Número').fill('100');
    await page.getByRole('button', { name: 'Continuar' }).click();

    // 3. Onde receber.
    await page.getByRole('combobox', { name: 'Banco' }).fill('260');
    await page.getByRole('textbox', { name: 'Agência' }).fill('0001');
    await page.getByRole('textbox', { name: 'Conta com dígito' }).fill('12345-6');
    await page.getByRole('button', { name: 'Continuar' }).click();

    // 4. Revisão: sem o aceite, não envia.
    await expect(page.getByText('Banco 260 · Ag. 0001 · Conta corrente 12345-6')).toBeVisible();
    await expect(page.getByText('Responsável: Gestora Ana · CPF 529.982.247-25')).toBeVisible();
    await page.getByRole('button', { name: 'Enviar cadastro' }).click();
    await expect(page.getByText('Aceite os termos para continuar')).toBeVisible();
    await page.getByLabel(/Li e aceito os termos/).check();
    await page.getByRole('button', { name: 'Enviar cadastro' }).click();

    await expect(page.getByText('Cadastro enviado')).toBeVisible();
    await expect(page.getByTestId('merchant-card')).toContainText('Em análise');
    // Depois de enviado, o CPF do responsável só aparece mascarado (decisão 97).
    await expect(page.getByTestId('merchant-summary')).toContainText(
      'Responsável: Gestora Ana · CPF ***.982.247-**',
    );

    const submit = (await mockCalls(request)).find((c) =>
      c.path.startsWith('PUT /online-payments/merchant-account'),
    );
    expect(submit?.body).toMatchObject({
      documentType: 'CNPJ',
      document: '11222333000181',
      legalName: 'Arena Exemplo Ltda',
      responsibleName: 'Gestora Ana',
      responsibleCpf: '52998224725',
      phone: '+5531999998888',
      address: { postalCode: '30130010', number: '100', state: 'MG', city: 'Belo Horizonte' },
      payout: {
        kind: 'BANK_ACCOUNT',
        bankCode: '260',
        agency: '0001',
        account: '12345',
        accountDigit: '6',
        accountType: 'CHECKING',
      },
      acceptTerms: true,
    });
  });

  test('cadastro recusado mostra o motivo e o reenvio', async ({ page, context, request }) => {
    await setup(request, { merchant: 'REJECTED' });
    await loginAs(context, 'manager');
    await page.goto('/painel/recebimentos-online');
    const card = page.getByTestId('merchant-card');
    await expect(card).toContainText('O parceiro recusou o cadastro.');
    await expect(card).toContainText('Motivo: Documento não confere com a razão social.');
    await card.getByRole('link', { name: 'Corrigir e reenviar' }).click();
    // Dados não sensíveis voltam preenchidos; documento e conta são digitados de novo.
    await expect(page.getByLabel('Razão social')).toHaveValue('Arena Exemplo Ltda');
    await expect(page.getByRole('textbox', { name: 'CNPJ' })).toHaveValue('');
  });

  test('ativa o modo de pagamento com o cadastro aprovado (RF-ONPAY-02)', async ({
    page,
    context,
    request,
  }) => {
    await setup(request, { merchant: 'APPROVED' });
    await loginAs(context, 'admin');
    await page.goto('/painel/recebimentos-online');
    await page.getByRole('tab', { name: 'Configuração' }).click();
    await expect(page).toHaveURL(/aba=configuracao/);
    const modes = page.getByTestId('modes-card');
    const save = modes.getByRole('button', { name: 'Salvar alterações' });
    await expect(save).toBeDisabled();
    await modes
      .getByRole('radiogroup', { name: 'Reservas pelo app' })
      .getByText('Online obrigatório')
      .click();
    await save.click();
    await expect(page.getByText('Formas de pagamento salvas')).toBeVisible();

    const put = (await mockCalls(request)).find((c) => c.path === 'PUT /online-payments/settings');
    expect(put?.body).toEqual({ bookingMode: 'ONLINE_REQUIRED', classMode: 'ON_SITE' });
    // Admin não troca a conta bancária.
    await expect(page.getByTestId('merchant-card')).toContainText(
      'Só o dono do espaço pode trocar a conta.',
    );
  });
});

test.describe('recebimentos online: troca de conta (decisões 95 e 98)', () => {
  test('troca de conta em análise não bloqueia as formas de pagamento', async ({
    page,
    context,
    request,
  }) => {
    await setup(request, { merchant: 'PENDING', approved: '1' });
    await loginAs(context, 'manager');
    await page.goto('/painel/recebimentos-online?aba=configuracao');
    const modes = page.getByTestId('modes-card');
    await expect(modes.getByRole('radio', { name: /Online obrigatório/ })).toBeEnabled();
    await expect(modes).not.toContainText('Disponível depois');
  });

  test('troca recusada: aviso com o motivo e a conta anterior segue valendo (decisão 98)', async ({
    page,
    context,
    request,
  }) => {
    await setup(request, { merchant: 'APPROVED', changeRejected: '1' });
    await loginAs(context, 'manager');
    await page.goto('/painel/recebimentos-online?aba=configuracao');
    const card = page.getByTestId('merchant-card');
    await expect(card).toContainText('Aprovado');
    const warning = card.getByTestId('payout-change-rejected');
    await expect(warning).toContainText('recusou a troca para a conta ****-9 em 06/11/2026');
    await expect(warning).toContainText('A conta anterior continua valendo.');
    await expect(warning).toContainText('Motivo: A conta não está no CNPJ do cadastro.');
    await expect(card).toContainText('****-6');
    // O pagamento online segue: os modos continuam liberados (onlineReady).
    const modes = page.getByTestId('modes-card');
    await expect(modes.getByRole('radio', { name: /Online obrigatório/ })).toBeEnabled();

    // Tentar outra conta abre só "Onde receber", com o motivo da recusa à vista.
    await card.getByRole('link', { name: 'Trocar conta bancária' }).click();
    await expect(page).toHaveURL(/cadastro\?troca=1/);
    const steps = page.getByRole('list', { name: 'Etapas do cadastro' });
    await expect(steps.getByRole('listitem')).toHaveText(['1Onde receber', '2Revisão e envio']);
    await expect(page.getByTestId('payout-change-rejected')).toContainText(
      'A conta não está no CNPJ',
    );
    await expect(page.getByRole('textbox', { name: 'CNPJ' })).toHaveCount(0);
  });

  test('espaço já aprovado não abre o cadastro inteiro pela URL', async ({
    page,
    context,
    request,
  }) => {
    await setup(request, { merchant: 'APPROVED', changeRejected: '1' });
    await loginAs(context, 'manager');
    await page.goto('/painel/recebimentos-online/cadastro');
    await expect(page.getByText('O cadastro já foi aprovado.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'CNPJ' })).toHaveCount(0);
  });

  test('modos seguem o onlineReady da API, mesmo com o cadastro aprovado', async ({
    page,
    context,
    request,
  }) => {
    await setup(request, { merchant: 'APPROVED', ready: '0' });
    await loginAs(context, 'manager');
    await page.goto('/painel/recebimentos-online?aba=configuracao');
    const modes = page.getByTestId('modes-card');
    await expect(modes).toContainText('O pagamento pelo app não está disponível para o espaço');
    await expect(modes.getByRole('radio', { name: /Online obrigatório/ })).toBeDisabled();
    await expect(modes.getByRole('button', { name: 'Salvar alterações' })).toHaveCount(0);
  });
});

test.describe('recebimentos online: carteira e contestações', () => {
  test('carteira com saldos, a liberar, repasses, lançamentos e CSV (RF-ONPAY-07)', async ({
    page,
    context,
    request,
  }) => {
    await setup(request, { merchant: 'APPROVED' });
    await loginAs(context, 'manager');
    await page.goto('/painel/recebimentos-online');
    const wallet = page.getByTestId('wallet');
    await expect(wallet.getByTestId('wallet-available')).toHaveText(/1\.284,40/);
    await expect(wallet.getByTestId('wallet-pending')).toHaveText(/3\.912,00/);
    await expect(wallet.getByTestId('wallet-paid-out')).toHaveText(/18\.420,75/);
    await expect(wallet.getByTestId('sandbox-banner')).toContainText('os valores são simulados');
    await expect(wallet.getByTestId('release-list').getByRole('listitem')).toHaveCount(3);
    await expect(wallet.getByTestId('payouts-list')).toContainText('Repassado');

    const rows = wallet.getByTestId('ledger-row');
    const pages = wallet.getByRole('navigation', { name: 'Paginação dos lançamentos' });
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Venda');
    await expect(rows.nth(1)).toContainText('Taxa de serviço');
    // "Página X de N" pelo total dos filtros (30 lançamentos, 25 por página).
    await expect(pages).toContainText('Página 1 de 2');
    await pages.getByRole('button', { name: 'Próxima' }).click();
    await expect(pages).toContainText('Página 2 de 2');

    // Filtro "Meio": só os lançamentos de cobranças no cartão, de volta à página 1.
    await wallet.getByLabel('Meio').click();
    await page.getByRole('option', { name: 'Cartão' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Mensalidade · Marina L.');
    await expect(rows.first()).toContainText('Cartão');
    await expect(pages).toContainText('Página 1 de 1');

    const cardCsv = page.waitForEvent('download');
    await wallet.getByRole('button', { name: 'Exportar CSV' }).click();
    await cardCsv;
    const csvByMethod = (await mockCalls(request)).find((c) =>
      c.path.endsWith('/online-payments/wallet/entries.csv'),
    );
    expect(csvByMethod?.body).toMatchObject({ method: 'CARD' });
    expect(csvByMethod?.body).not.toHaveProperty('kind');

    // "Ver todos" dos repasses filtra por tipo, limpa o meio e volta à página 1.
    await wallet.getByRole('button', { name: 'Ver todos' }).click();
    await expect(pages).toContainText('Página 1 de 1');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Repasse');

    const download = page.waitForEvent('download');
    await wallet.getByRole('button', { name: 'Exportar CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/^carteira-espaco-a-.+\.csv$/);
    const csv = (await mockCalls(request))
      .filter((c) => c.path.endsWith('/online-payments/wallet/entries.csv'))
      .at(-1);
    expect(csv?.body).toMatchObject({ kind: 'PAYOUT' });
    expect(csv?.body).not.toHaveProperty('method');
  });

  test('responde a contestação no cartão (RF-ONPAY-09)', async ({ page, context, request }) => {
    await setup(request, { merchant: 'APPROVED' });
    await loginAs(context, 'manager');
    await page.goto('/painel/recebimentos-online');
    await expect(page.getByText('1 contestação aguardando resposta até 12/11.')).toBeVisible();
    await page.getByRole('button', { name: 'Responder' }).click();
    await expect(page).toHaveURL(/aba=contestacoes/);

    const row = page.getByTestId('chargeback-row');
    await expect(row).toContainText('Maria Oliveira');
    await expect(row).toContainText('Aguardando resposta');
    await row.getByRole('button', { name: 'Responder' }).click();

    const dialog = page.getByRole('dialog', { name: 'Responder contestação' });
    await dialog.getByLabel('Sua resposta').fill('Curto');
    await dialog.getByRole('button', { name: 'Enviar resposta' }).click();
    await expect(dialog.getByText('Escreva pelo menos 20 caracteres')).toBeVisible();

    const text = 'A cliente jogou das 18h às 19h30; temos o registro de entrada.';
    await dialog.getByLabel('Sua resposta').fill(text);
    await dialog.getByLabel(/Links de anexos/).fill('https://exemplo.com/entrada.pdf');
    await dialog.getByRole('button', { name: 'Enviar resposta' }).click();
    await expect(page.getByText('Resposta enviada', { exact: true })).toBeVisible();

    const dispute = (await mockCalls(request)).find((c) => c.path.endsWith('/dispute'));
    expect(dispute?.body).toEqual({ text, attachmentUrls: ['https://exemplo.com/entrada.pdf'] });
    await expect(row).toContainText('Resposta enviada');
  });
});

test.describe('pagamento online na reserva', () => {
  for (const profile of ['manager', 'admin'] as const) {
    test(`${profile === 'manager' ? 'dono' : 'admin'} vê o bloco e estorna parte do valor (RN-ONPAY-05)`, async ({
      page,
      context,
      request,
    }) => {
      await setup(request, { merchant: 'APPROVED', booking: 'paid' });
      await loginAs(context, profile);
      await page.goto('/painel/reservas/avulsas');
      await page.getByTestId('booking-row').click();
      const detail = page.getByTestId('booking-detail');

      // Abatimento por estorno (decisão 93) e o registro online sem estorno manual.
      await expect(detail).toContainText('Abatimento por estorno');
      const records = detail.getByRole('list', { name: 'Pagamentos registrados' });
      await expect(records).toContainText('Online');
      await expect(records.getByRole('button', { name: 'Estornar' })).toHaveCount(0);

      const block = detail.getByTestId('online-charge');
      await expect(block).toContainText('Pix · pago em 08/11 18:42');
      await expect(block).toContainText('Estorno parcial');
      await expect(block).toContainText('Taxa de serviço (4%)');
      await expect(block).toContainText('O espaço recebe');
      await expect(block).toContainText('Estorno em 09/11 por Gestora Ana');
      await expect(block).toContainText('“Quadra sem iluminação”');

      await block.getByRole('button', { name: 'Estornar' }).click();
      const dialog = page.getByRole('dialog', { name: 'Estornar pagamento online' });
      await expect(dialog).toContainText('Já estornado: R$ 40,00');
      await dialog.getByText('Parte do valor').click();
      await dialog.getByLabel('Valor a devolver').fill('90,00');
      await dialog.getByLabel('Motivo').fill('Chuva interrompeu o jogo');
      await dialog.getByRole('button', { name: /^Estornar/ }).click();
      await expect(dialog.getByText('Informe um valor até R$ 80,00')).toBeVisible();

      await dialog.getByLabel('Valor a devolver').fill('30,00');
      // Regra acumulada (decisão 94): round(480 × 7000 ÷ 12000) − 160 = R$ 1,20.
      await expect(dialog.getByTestId('refund-estimate')).toContainText('1,20');
      await dialog.getByRole('button', { name: 'Estornar R$ 30,00' }).click();
      await expect(page.getByText('Estorno de R$ 30,00 enviado ao cliente.')).toBeVisible();

      const refund = (await mockCalls(request)).find((c) => c.path.endsWith('/refunds'));
      expect(refund?.body).toEqual({
        amountCents: 3000,
        reason: 'Chuva interrompeu o jogo',
        chargeAgain: false,
      });
      // O estorno que o parceiro ainda não confirmou aparece na lista da cobrança.
      await expect(block).toContainText('em processamento');
    });
  }

  test('"Tudo o que falta" envia o valor confirmado', async ({ page, context, request }) => {
    await setup(request, { merchant: 'APPROVED', booking: 'paid' });
    await loginAs(context, 'manager');
    await page.goto('/painel/reservas/avulsas');
    await page.getByTestId('booking-row').click();
    await page.getByTestId('online-charge').getByRole('button', { name: 'Estornar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Estornar pagamento online' });
    await dialog.getByLabel('Motivo').fill('Quadra interditada');
    await dialog.getByRole('button', { name: 'Estornar R$ 80,00' }).click();
    await expect(page.getByText('Estorno de R$ 80,00 enviado ao cliente.')).toBeVisible();
    const refund = (await mockCalls(request)).find((c) => c.path.endsWith('/refunds'));
    expect(refund?.body).toEqual({
      amountCents: 8000,
      reason: 'Quadra interditada',
      chargeAgain: false,
    });
  });

  test('valor acima do reembolsável atual recarrega o diálogo', async ({
    page,
    context,
    request,
  }) => {
    await setup(request, { merchant: 'APPROVED', booking: 'paid', stale: '1' });
    await loginAs(context, 'manager');
    await page.goto('/painel/reservas/avulsas');
    await page.getByTestId('booking-row').click();
    await page.getByTestId('online-charge').getByRole('button', { name: 'Estornar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Estornar pagamento online' });
    await dialog.getByLabel('Motivo').fill('Quadra interditada');
    await dialog.getByRole('button', { name: 'Estornar R$ 80,00' }).click();
    // Outro estorno de R$ 30,00 entrou antes: a API recusa e o diálogo mostra o novo saldo.
    await expect(
      dialog.getByText('O valor passa do que ainda pode ser estornado (R$ 50,00).'),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Estornar R$ 50,00' })).toBeVisible();
  });

  test('professor não vê o pagamento online da reserva', async ({ page, context, request }) => {
    await setup(request, { merchant: 'APPROVED', booking: 'paid' });
    await loginAs(context, 'teacher');
    await page.goto('/painel/reservas/avulsas');
    await page.getByTestId('booking-row').click();
    const detail = page.getByTestId('booking-detail');
    await expect(detail.getByText('Quando e onde')).toBeVisible();
    await expect(detail.getByTestId('online-payment')).toHaveCount(0);
    await expect(detail.getByText(/R\$/)).toBeHidden();
  });

  test('reserva aguardando pagamento: rótulo, filtro e sem registro no local', async ({
    page,
    context,
    request,
  }) => {
    await setup(request, { merchant: 'APPROVED', booking: 'pending' });
    await loginAs(context, 'manager');
    await page.goto('/painel/reservas/avulsas');
    const row = page.getByTestId('booking-row');
    await expect(row).toContainText('Aguardando pagamento');
    await expect(row).toContainText('Guardado até');

    await page.getByLabel('Situação').click();
    await expect(page.getByRole('option', { name: 'Aguardando pagamento' })).toBeVisible();
    await page.keyboard.press('Escape');

    await row.click();
    const detail = page.getByTestId('booking-detail');
    await expect(detail.getByTestId('payment-hold')).toContainText(
      'o cliente está pagando pelo app',
    );
    await expect(detail.getByTestId('online-open-charge')).toContainText('Pix aberto até');
    await expect(detail.getByRole('button', { name: 'Registrar pagamento' })).toHaveCount(0);
  });

  test('agenda mostra a reserva aguardando pagamento', async ({ page, context, request }) => {
    await setup(request, { merchant: 'APPROVED', booking: 'pending' });
    await loginAs(context, 'manager');
    await page.goto('/painel/agenda');
    await expect(page.getByTestId('agenda-booking')).toContainText('Aguardando pagamento');
  });

  test('registro no local com Pix aberto: aviso e recusa se já foi pago (decisão 96)', async ({
    page,
    context,
    request,
  }) => {
    await setup(request, { merchant: 'APPROVED', booking: 'open' });
    await loginAs(context, 'manager');
    await page.goto('/painel/reservas/avulsas');
    await page.getByTestId('booking-row').click();
    await page
      .getByTestId('booking-detail')
      .getByRole('button', { name: 'Registrar pagamento' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Registrar pagamento' });
    await expect(dialog.getByTestId('open-online-charge-warning')).toContainText(
      'Registrar o pagamento no local cancela essa cobrança.',
    );
    await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(
      dialog.getByText('O cliente acabou de pagar pelo app. A reserva foi atualizada.'),
    ).toBeVisible();
  });
});

test.describe('super: pagamento online', () => {
  test('receita com a taxa recobrada e o relatório da NFS-e (RF-ONPAY-11)', async ({
    page,
    context,
    request,
  }) => {
    await setup(request);
    await loginAs(context, 'super');
    await page.goto('/super/pagamentos');
    await expect(page.getByRole('heading', { name: 'Pagamento online' })).toBeVisible();
    // Gateway simulado: selo na barra do /super.
    await expect(page.getByTestId('sandbox-badge')).toBeVisible();

    const totals = page.getByTestId('revenue-totals');
    await expect(totals).toContainText('Taxa recobrada');
    await expect(totals).toContainText('4,9% do volume');
    await expect(page.getByTestId('revenue-row').first()).toContainText('Espaço Exemplo A');

    await page.getByRole('button', { name: 'Relatório NFS-e' }).click();
    const dialog = page.getByRole('dialog', { name: 'Relatório para NFS-e' });
    await dialog.getByRole('button', { name: 'Ver relatório' }).click();
    // Documento completo só aqui (decisão 97), com a base da nota.
    await expect(dialog.getByTestId('nfse-row')).toContainText('12345678000195');
    await expect(dialog.getByRole('columnheader', { name: 'Recobrada' })).toBeVisible();
    expect(
      (await mockCalls(request)).some((c) =>
        c.path.startsWith('GET /v1/super/online-payments/reports/monthly'),
      ),
    ).toBe(true);
  });

  test('altera a taxa padrão e cria condição por espaço (RF-ONPAY-10)', async ({
    page,
    context,
    request,
  }) => {
    await setup(request);
    await loginAs(context, 'super');
    await page.goto('/super/pagamentos?aba=taxas');
    const defaults = page.getByTestId('default-fees');
    await expect(defaults.getByLabel('Pix (%)')).toHaveValue('4');
    await defaults.getByLabel('Pix (%)').fill('3,5');
    await expect(defaults.getByTestId('fee-live-example')).toContainText('taxa R$ 3,50');
    await defaults.getByRole('button', { name: 'Salvar taxa padrão' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByText('Taxa padrão salva.')).toBeVisible();

    await page.getByRole('button', { name: 'Adicionar condição' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adicionar condição' });
    await dialog.getByLabel('Espaço').selectOption({ label: 'Espaço Exemplo A' });
    await dialog.getByLabel('Pix (%)').fill('3');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByTestId('space-fee-row')).toContainText('3%');
    await expect(page.getByTestId('space-fee-row')).toContainText('padrão');

    const calls = await mockCalls(request);
    expect(calls.find((c) => c.path === 'PUT /v1/super/online-payments/fees')?.body).toEqual({
      pixFeeBps: 350,
      cardFeeBps: 600,
      minFeeCents: 100,
      feePayer: 'SPACE',
    });
    expect(
      calls.find((c) => c.path.startsWith('PUT /v1/super/online-payments/fees/spaces/'))?.body,
    ).toEqual({ pixFeeBps: 300, cardFeeBps: null, minFeeCents: null, feePayer: null });
  });

  test('cadastros no gateway por status', async ({ page, context, request }) => {
    await setup(request);
    await loginAs(context, 'super');
    await page.goto('/super/pagamentos?aba=cadastros');
    await expect(page.getByTestId('merchant-row')).toHaveCount(2);
    await page.getByRole('button', { name: /^Recusados/ }).click();
    await expect(page.getByTestId('merchant-row')).toHaveCount(1);
    await expect(page.getByTestId('merchant-row')).toContainText('Documento não confere');
  });

  test('simulador com aviso de teste paga um Pix (RF-ONPAY-12)', async ({
    page,
    context,
    request,
  }) => {
    await setup(request);
    await loginAs(context, 'super');
    await page.goto('/super/pagamentos?aba=simulador');
    await expect(page.getByTestId('simulator-banner')).toContainText('nunca em produção');
    await page.getByTestId('simulator-charge').getByRole('button', { name: 'Pagar' }).click();
    await expect(page.getByText(/pago\. O webhook foi enviado\./)).toBeVisible();
    expect(
      (await mockCalls(request)).some(
        (c) =>
          c.path.startsWith('POST /v1/super/online-payments/simulator/charges/') &&
          c.path.endsWith('/pay'),
      ),
    ).toBe(true);
  });

  test('sem as rotas do simulador, a aba não aparece', async ({ page, context, request }) => {
    await setup(request, { simulator: '0' });
    await loginAs(context, 'super');
    await page.goto('/super/pagamentos?aba=simulador');
    await expect(page.getByRole('tab', { name: 'Receita' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Simulador' })).toHaveCount(0);
  });
});
