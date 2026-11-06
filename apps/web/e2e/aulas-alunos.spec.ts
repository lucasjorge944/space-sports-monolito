import { expect, type Page, test } from './fixtures';
import { loginAs, mockCalls } from './helpers';

// Cada teste tem o seu escopo na API simulada (e2e/fixtures.ts): o registro de chamadas não é dividido
// com os testes que rodam em paralelo.

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BEGINNER = ID(1101);
const ADVANCED = ID(1102);

async function pickOption(page: Page, triggerId: string, option: string) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function callTo(request: Parameters<typeof mockCalls>[0], method: string, suffix: string) {
  return (await mockCalls(request)).find(
    (c) => c.path.startsWith(`${method} `) && c.path.endsWith(suffix),
  );
}

test.describe('alunos', () => {
  test('lista as assinaturas com plano, turmas, situação e cobrança', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await expect(page.getByRole('heading', { name: 'Alunos' })).toBeVisible();
    const rows = page.getByTestId('subscription-row');
    await expect(rows).toHaveCount(10);

    const marina = rows.filter({ hasText: 'Marina Lopes' });
    await expect(marina).toContainText('Futevôlei livre');
    await expect(marina).toContainText('Futevôlei Avançado');
    await expect(marina).toContainText('Qui 20:00');
    await expect(marina).toContainText('Ativa');
    await expect(marina).toContainText('R$');
    await expect(marina).toContainText('10/11/2026');

    const bruno = rows.filter({ hasText: 'Bruno Atrasado' });
    await expect(bruno).toContainText('Inadimplente');
    await expect(bruno).toContainText('310,00 vencidos');

    const sara = rows.filter({ hasText: 'Sara Saindo' });
    await expect(sara).toContainText('Cancelado');
    await expect(sara).toContainText('Acesso até 30/11/2099');
    const caio = rows.filter({ hasText: 'Caio Cancelado' });
    await expect(caio).toContainText('Cancelada');
    await expect(caio).toContainText('Acesso até 31/10/2026');
  });

  test('filtra por situação e destaca os pedidos aguardando aprovação', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await expect(page.getByRole('tab', { name: 'Aguardando aprovação (4)' })).toBeVisible();

    await page.getByRole('tab', { name: /Aguardando aprovação/ }).click();
    await expect(page.getByTestId('subscription-row')).toHaveCount(4);
    await expect(page.getByTestId('subscription-row').first()).toContainText(
      'Aguardando aprovação',
    );

    await page.getByRole('tab', { name: 'Inadimplentes' }).click();
    await expect(page.getByTestId('subscription-row')).toHaveCount(1);
    await expect(page.getByTestId('subscription-row')).toContainText('Bruno Atrasado');

    await expect(page.getByRole('tab', { name: /Pausad/ })).toHaveCount(0);
  });

  test('mostra o vazio quando o filtro não encontra assinaturas', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await pickOption(page, 'alunos-plan', 'Futevôlei 1x (antigo)');
    await expect(page.getByText('Nenhuma assinatura encontrada')).toBeVisible();
  });

  test('aprova o pedido sem mexer nas turmas (corpo vazio)', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await page
      .getByTestId('subscription-row')
      .filter({ hasText: 'Ana Aprovável' })
      .getByRole('button', { name: 'Aprovar' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Aprovar assinatura')).toBeVisible();
    await expect(dialog.getByLabel(/Futevôlei Iniciante/)).toBeChecked();
    await dialog.getByRole('button', { name: 'Aprovar', exact: true }).click();
    await expect(page.getByText('Assinatura aprovada. O aluno foi avisado.')).toBeVisible();

    const call = await callTo(request, 'POST', `/subscriptions/${ID(2003)}/approve`);
    expect(call?.body).toEqual({});
  });

  test('turma lotada na aprovação aparece por código e dá para trocar a turma', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await page
      .getByTestId('subscription-row')
      .filter({ hasText: 'Pedro Pendente' })
      .getByRole('button', { name: 'Aprovar' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/Futevôlei Avançado/)).toBeChecked();
    await expect(dialog.getByText(/Lotada/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Aprovar', exact: true }).click();
    await expect(dialog.getByText('A turma não tem mais vagas.')).toBeVisible();

    // Troca para a turma com vaga; sem nenhuma turma o botão fica desabilitado.
    await dialog.getByLabel(/Futevôlei Avançado/).uncheck();
    await expect(dialog.getByRole('button', { name: 'Aprovar', exact: true })).toBeDisabled();
    await dialog.getByLabel(/Futevôlei Iniciante/).check();
    await dialog.getByRole('button', { name: 'Aprovar', exact: true }).click();
    await expect(page.getByText('Assinatura aprovada. O aluno foi avisado.')).toBeVisible();

    const calls = (await mockCalls(request)).filter((c) =>
      c.path.endsWith(`/subscriptions/${ID(2002)}/approve`),
    );
    expect(calls.at(-1)?.body).toEqual({ classGroupIds: [BEGINNER] });
  });

  test('turma pedida desativada aparece como indisponível e dá para trocar por outra', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await page
      .getByTestId('subscription-row')
      .filter({ hasText: 'Lia Indisponível' })
      .getByRole('button', { name: 'Aprovar' })
      .click();
    const dialog = page.getByRole('dialog');
    const extinct = dialog.getByLabel(/Futevôlei Extinta/);
    await expect(extinct).toBeChecked();
    await expect(dialog.getByText(/Indisponível: turma desativada/)).toBeVisible();
    // Enquanto a turma indisponível estiver marcada, não dá para aprovar.
    await expect(dialog.getByRole('button', { name: 'Aprovar', exact: true })).toBeDisabled();

    await extinct.uncheck();
    await dialog.getByLabel(/Futevôlei Iniciante/).check();
    await dialog.getByRole('button', { name: 'Aprovar', exact: true }).click();
    await expect(page.getByText('Assinatura aprovada. O aluno foi avisado.')).toBeVisible();

    const calls = (await mockCalls(request)).filter((c) =>
      c.path.endsWith(`/subscriptions/${ID(2008)}/approve`),
    );
    expect(calls.at(-1)?.body).toEqual({ classGroupIds: [BEGINNER] });
  });

  test('recusa o pedido com o motivo', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await page
      .getByTestId('subscription-row')
      .filter({ hasText: 'Rita Recusável' })
      .getByRole('button', { name: 'Recusar' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Motivo (opcional)').fill('Turma sem vaga neste horário');
    await dialog.getByRole('button', { name: 'Recusar', exact: true }).click();
    await expect(page.getByText('Pedido recusado. O aluno foi avisado.')).toBeVisible();

    const call = await callTo(request, 'POST', `/subscriptions/${ID(2004)}/reject`);
    expect(call?.body).toEqual({ reason: 'Turma sem vaga neste horário' });
  });

  test('ficha do aluno: turmas, mensalidades e histórico de presença', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await page.getByTestId('subscription-row').filter({ hasText: 'Marina Lopes' }).click();
    const detail = page.getByTestId('subscription-detail');
    await expect(detail).toContainText('Marina Lopes');
    await expect(detail.getByTestId('enrollment-row')).toContainText('Futevôlei Avançado');
    await expect(detail.getByTestId('enrollment-row')).toContainText('Quadra 1');

    await expect(detail.getByTestId('sheet-charge-row')).toHaveCount(2);
    await expect(detail.getByTestId('sheet-charge-row').first()).toContainText('11/2026');
    await expect(detail.getByTestId('sheet-charge-row').nth(1)).toContainText('Paga');

    await expect(detail.getByTestId('attendance-row')).toHaveCount(4);
    await expect(detail.getByTestId('attendance-row').nth(0)).toContainText('Presente');
    await expect(detail.getByTestId('attendance-row').nth(1)).toContainText('Faltou');
    await expect(detail.getByTestId('attendance-row').nth(2)).toContainText('Sem marcação');
    await expect(detail.getByTestId('attendance-row').nth(3)).toContainText('Confirmado');
    await expect(detail.getByTestId('attendance-summary')).toContainText('50%');
    // 22:00Z = 19:00 em São Paulo.
    await expect(detail.getByTestId('attendance-row').nth(0)).toContainText('27/10/2026, 19:00');
  });

  test('troca a turma do aluno', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await page.getByTestId('subscription-row').filter({ hasText: 'Marina Lopes' }).click();
    await page.getByRole('button', { name: 'Trocar Futevôlei Avançado' }).click();
    const dialog = page.getByRole('dialog', { name: 'Trocar de turma' });
    await pickOption(page, 'swap-to', 'Futevôlei Iniciante · Ter 19:00 · 8 vagas');
    await dialog.getByRole('button', { name: 'Trocar', exact: true }).click();
    await expect(page.getByText('Turma trocada.')).toBeVisible();

    const call = await callTo(request, 'POST', `/subscriptions/${ID(2001)}/swap-class-group`);
    expect(call?.body).toEqual({ fromClassGroupId: ADVANCED, toClassGroupId: BEGINNER });
  });

  test('matricula em outra turma e desmatricula', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await page.getByTestId('subscription-row').filter({ hasText: 'Marina Lopes' }).click();

    await page.getByRole('button', { name: 'Matricular em outra' }).click();
    const add = page.getByRole('dialog', { name: 'Matricular em outra turma' });
    await pickOption(page, 'add-class-group', 'Futevôlei Iniciante · Ter 19:00 · 8 vagas');
    await add.getByRole('button', { name: 'Matricular', exact: true }).click();
    await expect(page.getByText('Aluno matriculado.')).toBeVisible();
    const added = await callTo(request, 'POST', `/subscriptions/${ID(2001)}/enrollments`);
    expect(added?.body).toEqual({ classGroupId: BEGINNER });

    await page.getByRole('button', { name: 'Desmatricular de Futevôlei Avançado' }).click();
    const end = page.getByRole('dialog', { name: 'Desmatricular aluno' });
    await expect(end).toContainText('a vaga é liberada');
    await end.getByRole('button', { name: 'Desmatricular', exact: true }).click();
    await expect(page.getByText('Aluno desmatriculado.')).toBeVisible();
    expect(
      await callTo(request, 'DELETE', `/subscriptions/${ID(2001)}/enrollments/${ID(2501)}`),
    ).toBeTruthy();
  });

  test('plano Nx cheio não oferece matricular em mais uma turma', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await page.getByTestId('subscription-row').filter({ hasText: 'Bruno Atrasado' }).click();
    await expect(page.getByTestId('enrollment-row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Matricular em outra' })).toHaveCount(0);
  });

  test('pagamento parcial mostra o valor que falta na mensalidade da ficha', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await page.getByTestId('subscription-row').filter({ hasText: 'Bruno Atrasado' }).click();
    const due = page.getByTestId('sheet-charge-due');
    await expect(due).toHaveCount(1);
    await expect(due).toContainText(/faltam R\$\s*130,00/);
  });

  test('o Professor não vê assinaturas nem valores', async ({ page, context }) => {
    await loginAs(context, 'teacher');
    await page.goto('/painel/aulas/alunos');
    await expect(page.getByText('Sem permissão')).toBeVisible();
    await expect(page.getByTestId('subscription-row')).toHaveCount(0);
    await page.goto('/painel/aulas/mensalidades');
    await expect(page.getByText('Sem permissão')).toBeVisible();
  });

  test('aprovação recusada por choque de horário mostra a turma que conflita', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await page
      .getByTestId('subscription-row')
      .filter({ hasText: 'Rita Recusável' })
      .getByRole('button', { name: 'Aprovar' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Aprovar', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'O aluno já tem a turma Vôlei Misto (Arena Beira-Mar), Terça 19:00 neste horário. Escolha outra turma.',
    );
  });

  test('trocar e matricular em turma no mesmo horário de outra turma do aluno mostram o conflito', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/alunos');
    await page.getByTestId('subscription-row').filter({ hasText: 'Otávio Choque' }).click();
    const conflict =
      'O aluno já tem a turma Vôlei Misto (Arena Beira-Mar), Terça 19:00 neste horário.';

    await page.getByRole('button', { name: 'Trocar Futevôlei Avançado' }).click();
    const swap = page.getByRole('dialog', { name: 'Trocar de turma' });
    await pickOption(page, 'swap-to', 'Futevôlei Iniciante · Ter 19:00 · 8 vagas');
    await swap.getByRole('button', { name: 'Trocar', exact: true }).click();
    await expect(swap.getByRole('alert')).toContainText(conflict);
    await swap.getByRole('button', { name: 'Voltar' }).click();

    await page.getByRole('button', { name: 'Matricular em outra' }).click();
    const add = page.getByRole('dialog', { name: 'Matricular em outra turma' });
    await pickOption(page, 'add-class-group', 'Futevôlei Iniciante · Ter 19:00 · 8 vagas');
    await add.getByRole('button', { name: 'Matricular', exact: true }).click();
    await expect(add.getByRole('alert')).toContainText(conflict);
  });
});

test.describe('mensalidades', () => {
  test('o menu leva às mensalidades de aula', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel');
    await page.getByRole('link', { name: 'Mensalidades' }).click();
    await expect(page).toHaveURL(/\/painel\/aulas\/mensalidades$/);
    await expect(page.getByRole('heading', { name: 'Mensalidades' })).toBeVisible();
  });

  test('a receber: lista as mensalidades em aberto com o total', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/mensalidades');
    const rows = page.getByTestId('charge-row');
    await expect(rows).toHaveCount(3);
    await expect(page.getByTestId('charges-total-due')).toHaveText(/R\$\s*490,00/);

    const partial = rows.filter({ hasText: 'Bruno Atrasado' }).filter({ hasText: '10/2026' });
    await expect(partial).toContainText('Vencida');
    await expect(partial).toContainText('50,00');
    await expect(partial).toContainText('130,00');
    await expect(partial).toContainText('10/10/2026');
    await expect(rows.filter({ hasText: 'Marina Lopes' })).toContainText('A vencer');
  });

  test('filtra vencidas, pagas e dispensadas', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/mensalidades');
    const rows = page.getByTestId('charge-row');
    await expect(rows).toHaveCount(3);

    await pickOption(page, 'charges-filter', 'Vencidas');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('charges-total-due')).toHaveText(/R\$\s*310,00/);

    await pickOption(page, 'charges-filter', 'Pagas');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('Paga');
    await expect(rows.getByRole('button', { name: /Registrar pagamento/ })).toHaveCount(0);

    await pickOption(page, 'charges-filter', 'Dispensadas');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('Dispensada');
    await expect(rows.getByRole('button', { name: /Dispensar|Registrar/ })).toHaveCount(0);
  });

  test('filtra pelo vencimento e avisa do período inválido', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/mensalidades');
    await page.getByLabel('Vence de').fill('01/11/2026');
    await expect(page.getByTestId('charge-row')).toHaveCount(1);
    await expect(page.getByTestId('charge-row')).toContainText('Marina Lopes');

    await page.getByLabel('Vence até').fill('01/10/2026');
    await expect(page.getByText('Período inválido')).toBeVisible();
  });

  test('registra o pagamento com valor, forma e data', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/mensalidades');
    await page
      .getByRole('button', { name: 'Registrar pagamento de Marina Lopes (11/2026)' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Mensalidade 11/2026 de Marina Lopes');
    await expect(dialog.getByLabel('Valor recebido')).toHaveValue('180,00');
    await dialog.getByLabel('Valor recebido').fill('100');
    await pickOption(page, 'pay-method', 'Dinheiro');
    await dialog.getByLabel('Data do pagamento').fill('15/01/2020');
    await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByText('Pagamento registrado.')).toBeVisible();

    const call = (await mockCalls(request)).find(
      (c) => c.path.endsWith('/payments') && c.body.payableId === ID(3001),
    );
    // Meio-dia de São Paulo (UTC-3) da data escolhida.
    expect(call?.body).toEqual({
      payableType: 'SUBSCRIPTION_CHARGE',
      payableId: ID(3001),
      amountCents: 10000,
      method: 'CASH',
      paidAt: '2020-01-15T15:00:00.000Z',
    });
  });

  test('não deixa registrar mais que o valor em aberto nem data futura', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/mensalidades');
    await page
      .getByRole('button', { name: 'Registrar pagamento de Bruno Atrasado (10/2026)' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Valor recebido')).toHaveValue('130,00');
    await dialog.getByLabel('Valor recebido').fill('200');
    await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(dialog.getByText(/passa do que está em aberto/)).toBeVisible();

    await dialog.getByLabel('Valor recebido').fill('130');
    await dialog.getByLabel('Data do pagamento').fill('01/01/2999');
    await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(dialog.getByText('A data do pagamento não pode ser futura')).toBeVisible();
    expect(
      (await mockCalls(request)).some(
        (c) =>
          c.path.endsWith('/payments') &&
          c.body.payableId === ID(3004) &&
          c.body.amountCents === 20000,
      ),
    ).toBe(false);
  });

  test('estorna um pagamento da mensalidade', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/mensalidades');
    await page.getByRole('button', { name: 'Pagamentos de Bruno Atrasado (10/2026)' }).click();
    const payments = page.getByRole('dialog', { name: 'Pagamentos da mensalidade' });
    await expect(payments.getByTestId('charge-payment-row')).toContainText('50,00');
    await expect(payments.getByTestId('charge-payment-row')).toContainText('Dinheiro');
    await payments.getByRole('button', { name: 'Estornar' }).click();

    const reason = page.getByRole('dialog', { name: 'Estornar pagamento' });
    await reason.getByLabel('Motivo (opcional)').fill('Lançado no aluno errado');
    await reason.getByRole('button', { name: 'Estornar', exact: true }).click();
    await expect(page.getByText('Pagamento estornado.')).toBeVisible();

    const call = await callTo(request, 'POST', `/payments/${ID(3901)}/reverse`);
    expect(call?.body).toEqual({ reason: 'Lançado no aluno errado' });
  });

  test('pagamento feito pelo app: etiqueta "Online" e sem o estorno manual (PG.2b)', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/mensalidades');
    await pickOption(page, 'charges-filter', 'Pagas');
    await page.getByRole('button', { name: 'Pagamentos de Marina Lopes (09/2026)' }).click();
    const payments = page.getByRole('dialog', { name: 'Pagamentos da mensalidade' });
    const row = payments.getByTestId('charge-payment-row');
    await expect(row).toContainText('180,00');
    await expect(row).toContainText('Online');
    await expect(row.getByRole('button', { name: 'Estornar' })).toHaveCount(0);
  });

  test('dispensa a mensalidade (Dono) e só quando não há pagamento', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/mensalidades');
    // Com pagamento registrado não há "Dispensar": é preciso estornar antes.
    await expect(
      page.getByRole('button', { name: 'Dispensar mensalidade de Bruno Atrasado (10/2026)' }),
    ).toHaveCount(0);

    await page
      .getByRole('button', { name: 'Dispensar mensalidade de Marina Lopes (11/2026)' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Dispensar mensalidade' });
    await dialog.getByLabel('Motivo (opcional)').fill('Aluno bolsista');
    await dialog.getByRole('button', { name: 'Dispensar', exact: true }).click();
    await expect(page.getByText('Mensalidade dispensada.')).toBeVisible();

    const call = await callTo(request, 'POST', `/subscription-charges/${ID(3001)}/waive`);
    expect(call?.body).toEqual({ reason: 'Aluno bolsista' });
  });

  test('inadimplentes: total, dias de atraso e atalho para as mensalidades do aluno', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/mensalidades');
    await page.getByRole('tab', { name: 'Inadimplentes' }).click();
    await expect(page.getByTestId('delinquents-total')).toHaveText(/R\$\s*310,00/);
    const row = page.getByTestId('delinquent-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Bruno Atrasado');
    await expect(row).toContainText('48 dias');
    await expect(row).toContainText('10/09/2026');
    await expect(row).toContainText('Inadimplente');

    await row.getByRole('button', { name: 'Ver mensalidades de Bruno Atrasado' }).click();
    await expect(page.getByTestId('student-filter')).toContainText('Bruno Atrasado');
    await expect(page.getByTestId('charge-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Limpar' }).click();
    await expect(page.getByTestId('charge-row')).toHaveCount(3);
  });

  test('extrato vem filtrado pelo serviço de aula', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/mensalidades');
    await page.getByRole('tab', { name: 'Extrato' }).click();
    await expect(page.getByLabel('Serviço')).toContainText('Mensalidade de aula');
    await expect(page.getByTestId('statement-total')).toHaveText(/R\$\s*360,00/);
    const row = page.getByTestId('statement-row');
    await expect(row).toContainText('Marina Lopes');
    await expect(row).toContainText('Mensalidade 10/2026 · Futevôlei livre');
  });
});

test.describe('relatórios', () => {
  test('ocupação das turmas: totais e uma linha por turma ativa', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/relatorios');
    await expect(page.getByTestId('occupancy-groups')).toHaveText('2');
    await expect(page.getByTestId('occupancy-rate')).toHaveText('60%');
    await expect(page.getByTestId('occupancy-spots')).toHaveText('8');
    await expect(page.getByTestId('occupancy-full')).toHaveText('1');

    const rows = page.getByTestId('occupancy-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Futevôlei Iniciante' })).toContainText('4/12');
    await expect(rows.filter({ hasText: 'Futevôlei Avançado' })).toContainText('Lotada');

    await pickOption(page, 'occupancy-view', 'Todas');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Futevôlei Manhã' })).toContainText('Inativa');
  });

  test('ocupação baixa o CSV', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/relatorios');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar CSV' }).click();
    expect((await download).suggestedFilename()).toBe('ocupacao-das-turmas.csv');
  });

  test('frequência por turma e período', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/relatorios');
    await page.getByRole('tab', { name: 'Frequência' }).click();
    await expect(page.getByTestId('freq-done')).toHaveText('8');
    await expect(page.getByTestId('freq-present')).toHaveText('20');
    await expect(page.getByTestId('freq-absent')).toHaveText('4');
    await expect(page.getByTestId('freq-unmarked')).toHaveText('2');
    await expect(page.getByTestId('freq-rate')).toHaveText('77%');

    const rows = page.getByTestId('frequency-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Marina Lopes' })).toContainText('88%');
    await expect(rows.filter({ hasText: 'Tiago Ex-aluno' })).toContainText('Não matriculado');

    await pickOption(page, 'freq-group', 'Futevôlei Avançado · Qui · 20:00–21:30');
    await expect(page.getByText('Nenhum aluno no período')).toBeVisible();

    await page.getByLabel('De', { exact: true }).fill('01/01/2020');
    await expect(page.getByText('com no máximo 366 dias')).toBeVisible();
  });

  test('receita das mensalidades por período, com CSV', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/relatorios');
    await page.getByRole('tab', { name: 'Receita' }).click();
    await page.getByLabel('De', { exact: true }).fill('01/10/2026');
    await page.getByLabel('Até', { exact: true }).fill('31/10/2026');
    await expect(page.getByTestId('revenue-received')).toHaveText(/R\$\s*360,00/);
    await expect(page.getByTestId('revenue-reversed')).toHaveText(/R\$\s*180,00/);
    // Só o que vence em outubro e está em aberto (a mensalidade de novembro fica de fora).
    await expect(page.getByTestId('revenue-due')).toHaveText(/R\$\s*130,00/);
    await expect(page.getByTestId('revenue-overdue')).toHaveText(/R\$\s*310,00/);
    await expect(page.getByTestId('revenue-by-method')).toHaveCount(2);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar CSV dos recebimentos' }).click();
    expect((await download).suggestedFilename()).toBe(
      'receita-mensalidades-2026-10-01-a-2026-10-31.csv',
    );
    const csv = (await mockCalls(request)).find(
      (c) => c.path.endsWith('/statement.csv') && c.body.service === 'CLASS',
    );
    expect(csv?.body.from).toBe('2026-10-01T03:00:00.000Z');
    expect(csv?.body.to).toBe('2026-11-01T03:00:00.000Z');
  });

  test('o Professor vê ocupação e frequência das próprias turmas, sem receita', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'teacher');
    await page.goto('/painel/aulas/relatorios');
    await expect(page.getByRole('tab', { name: 'Receita' })).toHaveCount(0);
    await expect(page.getByTestId('occupancy-row')).toHaveCount(1);
    await expect(page.getByTestId('occupancy-row')).toContainText('Futevôlei Iniciante');
    await page.getByRole('tab', { name: 'Frequência' }).click();
    await expect(page.getByTestId('freq-rate')).toHaveText('77%');
  });
});

/** Relógio fixo: 29/10/2026, para as datas de acesso não dependerem de hoje. */
const CLOCK = new Date('2026-10-29T15:00:00Z');

test.describe('cancelamento da assinatura (decisão 45)', () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.clock.install({ time: CLOCK });
    await page.goto('/painel/aulas/alunos');
  });

  const open = async (page: Page, name: string) => {
    await page.getByTestId('subscription-row').filter({ hasText: name }).click();
    return page.getByTestId('subscription-detail');
  };

  test('a ficha não tem mais pausa', async ({ page }) => {
    const detail = await open(page, 'Marina Lopes');
    await expect(detail.getByRole('button', { name: /Pausar|Retomar/ })).toHaveCount(0);
    await expect(detail).not.toContainText('pausa');
  });

  test('com mês pago, avisa até quando o acesso vai e cancela com motivo', async ({
    page,
    request,
  }) => {
    const detail = await open(page, 'Marina Lopes');
    await detail.getByRole('button', { name: 'Cancelar assinatura' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancelar assinatura' });
    await expect(dialog).toContainText('continua com acesso até 31/10/2026');
    await dialog.getByLabel('Motivo (opcional)').fill('Mudou de cidade');
    await dialog.getByRole('button', { name: 'Cancelar assinatura', exact: true }).click();
    await expect(page.getByText('Cancelamento registrado.')).toBeVisible();
    const call = await callTo(request, 'POST', `/subscriptions/${ID(2001)}/cancel`);
    expect(call?.body).toEqual({ reason: 'Mudou de cidade' });
  });

  test('sem mês pago, avisa que o acesso termina agora', async ({ page }) => {
    const detail = await open(page, 'Tânia Sem Mês Pago');
    await detail.getByRole('button', { name: 'Cancelar assinatura' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancelar assinatura' });
    await expect(dialog).toContainText('termina agora');
    // Sem mensalidade vencida, o aviso só fala do que se aplica a ela.
    await expect(dialog).not.toContainText('continua devida');
  });

  test('cancelada com acesso: mostra a data, a dispensa com motivo e desfaz pela ficha', async ({
    page,
    request,
  }) => {
    const detail = await open(page, 'Sara Saindo');
    await expect(detail).toContainText('Cancelado, com acesso até 30/11/2099');
    await expect(detail.getByRole('button', { name: 'Cancelar assinatura' })).toHaveCount(0);

    const waived = detail.getByTestId('sheet-charge-row').filter({ hasText: 'Dispensada' }).first();
    await expect(waived).toContainText('Motivo: Dispensada pelo cancelamento do plano');

    await detail.getByRole('button', { name: 'Desfazer cancelamento' }).click();
    const dialog = page.getByRole('dialog', { name: 'Desfazer o cancelamento' });
    await expect(dialog).toContainText('acesso até 30/11/2099');
    await expect(dialog).toContainText('as mensalidades voltam a ser geradas');
    await dialog.getByRole('button', { name: 'Desfazer cancelamento' }).click();
    await expect(page.getByText('Cancelamento desfeito.')).toBeVisible();
    expect(await callTo(request, 'POST', `/subscriptions/${ID(2006)}/resume-cancel`)).toBeTruthy();
  });

  test('desfaz o cancelamento direto da lista', async ({ page, request }) => {
    await page
      .getByTestId('subscription-row')
      .filter({ hasText: 'Sara Saindo' })
      .getByRole('button', { name: 'Desfazer cancelamento' })
      .click();
    await expect(page.getByTestId('subscription-detail')).toHaveCount(0);
    await page
      .getByRole('dialog', { name: 'Desfazer o cancelamento' })
      .getByRole('button', { name: 'Desfazer cancelamento' })
      .click();
    await expect(page.getByText('Cancelamento desfeito.')).toBeVisible();
    expect(await callTo(request, 'POST', `/subscriptions/${ID(2006)}/resume-cancel`)).toBeTruthy();
  });

  test('inadimplente pode cancelar e encerrada não oferece nada', async ({ page }) => {
    const bruno = await open(page, 'Bruno Atrasado');
    await expect(bruno.getByRole('button', { name: 'Cancelar assinatura' })).toBeVisible();
    await page.keyboard.press('Escape');
    // Espera a animação de saída: um clique durante ela não abre a próxima ficha.
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const caio = await open(page, 'Caio Cancelado');
    await expect(caio).toContainText('31/10/2026');
    await expect(caio.getByRole('button', { name: 'Cancelar assinatura' })).toHaveCount(0);
    await expect(caio.getByRole('button', { name: 'Desfazer cancelamento' })).toHaveCount(0);
  });
});
