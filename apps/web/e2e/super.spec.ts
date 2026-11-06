import { expect, test } from '@playwright/test';
import { loginAs, MOCK_API } from './helpers';

// A API simulada guarda o estado do Super em memória: os testes rodam em série e começam do zero.
test.describe.configure({ mode: 'serial' });

async function superCalls(request: import('@playwright/test').APIRequestContext) {
  const response = await request.get(`${MOCK_API}/__super-calls`);
  return (await response.json()) as { path: string; body: Record<string, unknown> }[];
}

test.beforeEach(async ({ context, request }) => {
  await request.get(`${MOCK_API}/__super-reset`);
  await loginAs(context, 'super');
});

test('dashboard mostra o resumo e o uso por espaço', async ({ page }) => {
  await page.goto('/super');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Reservas no período')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Espaço Exemplo A' })).toBeVisible();
});

test('lista de espaços filtra por status e abre o detalhe com o checklist', async ({ page }) => {
  await page.goto('/super/espacos');
  await expect(page.getByRole('link', { name: 'Espaço Exemplo B' })).toBeVisible();

  await page.getByLabel('Status').selectOption('SUSPENDED');
  await expect(page.getByRole('link', { name: 'Espaço Exemplo A' })).toBeHidden();
  await page.getByLabel('Status').selectOption('');

  await page.getByRole('link', { name: 'Espaço Exemplo A' }).click();
  await expect(page.getByRole('heading', { name: /Espaço Exemplo A/ })).toBeVisible();
  await expect(page.getByText('4 de 5 etapas concluídas.')).toBeVisible();
  const steps = page.getByTestId('onboarding-step');
  await expect(steps.filter({ hasText: 'Dados do espaço' })).toContainText('Concluída');
  const owner = steps.filter({ hasText: 'Dono do espaço' });
  await expect(owner).toContainText('Pendente');
  await expect(owner).toContainText('Falta: um Dono ativo');
  await expect(page.getByText('activeOwner')).toHaveCount(0);
  await expect(page.getByText('Gestora Ana')).toBeVisible();
});

test('implantações: etapa, situação e o que falta em português', async ({ page }) => {
  await page.goto('/super/implantacoes');
  const row = page.getByRole('row', { name: /Espaço Exemplo B/ });
  await expect(row).toContainText('1 de 5');
  await expect(row).toContainText('Em andamento');
  await expect(row.getByTestId('onboarding-pending')).toContainText('Fotos: ao menos uma foto');
  await expect(row.getByTestId('onboarding-pending')).toContainText(
    'Quadras: ao menos uma quadra ativa com esporte',
  );
  await expect(page.getByText('activeCourtWithSport')).toHaveCount(0);
});

test('cria um espaço e mostra o resultado do convite do Dono', async ({ page, request }) => {
  await page.goto('/super/espacos/novo');
  await page.getByRole('button', { name: 'Criar espaço' }).click();
  await expect(page.getByText('Informe o nome do espaço')).toBeVisible();
  await expect(page.getByText('Escolha a cidade')).toBeVisible();

  await page.getByLabel('Nome do espaço').fill('Arena Nova');
  await page.getByLabel('Cidade').selectOption({ label: 'Belo Horizonte - MG' });
  await page.getByLabel('E-mail do Dono (opcional)').fill('Dono@Exemplo.com');
  await page.getByRole('button', { name: 'Criar espaço' }).click();

  await expect(page.getByRole('heading', { name: /Arena Nova/ })).toBeVisible();
  await expect(page.getByText(/Espaço criado\./)).toBeVisible();
  const created = (await superCalls(request)).find((c) => c.path === '/v1/super/spaces');
  expect(created?.body).toMatchObject({ name: 'Arena Nova', ownerEmail: 'dono@exemplo.com' });
});

test('suspende e reativa o espaço', async ({ page }) => {
  await page.goto('/super/espacos');
  await page.getByRole('link', { name: 'Espaço Exemplo A' }).click();
  await page.getByRole('button', { name: 'Suspender' }).click();
  await page.getByLabel('Motivo (opcional)').fill('Inadimplência');
  await page.getByRole('dialog').getByRole('button', { name: 'Suspender' }).click();
  await expect(page.getByText('Suspenso', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reativar' })).toBeVisible();
});

test('modo suporte exige motivo, mostra a faixa no painel e permite sair', async ({ page }) => {
  await page.goto('/super/espacos');
  await page.getByRole('link', { name: 'Espaço Exemplo A' }).click();
  await page.getByRole('button', { name: 'Modo suporte' }).click();
  await page.getByRole('button', { name: 'Entrar no painel' }).click();
  await expect(page.getByText('Informe o motivo do atendimento')).toBeVisible();

  await page.getByLabel('Motivo do atendimento').fill('Ajustar horário');
  await page.getByRole('button', { name: 'Entrar no painel' }).click();

  await expect(page).toHaveURL(/\/painel$/);
  const banner = page.getByTestId('support-banner');
  await expect(banner).toContainText('Modo suporte');
  await expect(banner).toContainText('Espaço Exemplo A');
  await expect(page.getByTestId('space-switcher')).toContainText('Espaço Exemplo A');

  await banner.getByRole('button', { name: 'Sair do modo suporte' }).click();
  await expect(page).toHaveURL(/\/super\/espacos\/00000000-0000-4000-8000-000000000101$/);
  await expect(page.getByTestId('support-banner')).toBeHidden();
  // Fora do modo suporte, o Super volta a ser redirecionado do /painel.
  await page.goto('/painel');
  await expect(page).toHaveURL(/\/super$/);
});

test('financeiro mostra os totais e exporta o CSV', async ({ page }) => {
  await page.goto('/super/financeiro');
  await expect(page.getByRole('region', { name: 'Totais' }).getByText('R$ 1.250,50')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Pix' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^pagamentos-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/,
  );
});

test('telefone do usuário aparece como não verificado (decisão 64)', async ({ page }) => {
  await page.goto('/super/usuarios');
  const row = page.getByRole('row', { name: /Jogador Caio/ });
  await expect(row).toContainText('(31) 97777-6666');
  await expect(row.getByText('Não verificado')).toBeVisible();
  await page.getByRole('link', { name: 'Jogador Caio' }).click();
  await expect(page.getByText('(31) 97777-6666')).toBeVisible();
  await expect(page.getByText('Não verificado')).toBeVisible();
});

test('bloqueia um usuário pelo detalhe', async ({ page, request }) => {
  await page.goto('/super/usuarios');
  await page.getByRole('link', { name: 'Jogador Caio' }).click();
  await page.getByRole('button', { name: 'Bloquear' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Bloquear' }).click();
  await expect(page.getByRole('button', { name: 'Desbloquear' })).toBeVisible();
  expect((await superCalls(request)).some((c) => c.path.endsWith('/block'))).toBe(true);
});

test('filtra usuários inativos e reativa a conta pelo detalhe', async ({ page, request }) => {
  await page.goto('/super/usuarios');
  await expect(page.getByRole('link', { name: 'Jogadora Dani' })).toBeVisible();
  await page.getByLabel('Status').selectOption('INACTIVE');
  await expect(page.getByRole('link', { name: 'Jogador Caio' })).toBeHidden();
  await page.getByRole('link', { name: 'Jogadora Dani' }).click();

  await expect(page.getByText('Inativa', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desbloquear' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Bloquear' })).toBeVisible();
  await page.getByRole('button', { name: 'Reativar conta' }).click();
  await expect(page.getByRole('button', { name: 'Reativar conta' })).toBeHidden();
  await expect(page.getByText('Ativo', { exact: true })).toBeVisible();
  expect((await superCalls(request)).some((c) => c.path.endsWith('/unblock'))).toBe(true);
});

test('promover conta inativa a Super pede a reativação antes', async ({ page }) => {
  await page.goto('/super/usuarios?aba=super');
  await page.getByLabel('Promover usuário a Super (e-mail)').fill('inativa@exemplo.com');
  await page.getByRole('button', { name: 'Promover', exact: true }).click();
  await expect(page.getByText('Reative a conta antes de promovê-la.')).toBeVisible();
});

test('catálogos e auditoria carregam', async ({ page }) => {
  await page.goto('/super/catalogos');
  await expect(page.getByRole('cell', { name: 'Beach tennis' }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Cidades' }).click();
  await expect(page.getByRole('cell', { name: 'Belo Horizonte - MG' })).toBeVisible();

  await page.goto('/super/auditoria');
  await expect(page.getByText('support.start')).toBeVisible();
});

test.describe('pedidos de exclusão de conta (LGPD)', () => {
  const rows = (page: import('@playwright/test').Page) => page.getByTestId('deletion-row');

  test('lista origem, prazo (vencido em destaque) e as pendências da conta', async ({ page }) => {
    await page.goto('/super/usuarios?aba=lgpd');
    await expect(rows(page)).toHaveCount(2);

    const caio = rows(page).filter({ hasText: 'Jogador Caio' });
    await expect(caio).toContainText('Pedido do usuário');
    await expect(caio).toContainText('20/10/2026');
    await expect(caio.getByText('Vencido', { exact: true })).toBeVisible();
    await expect(caio).toContainText('Espaço Exemplo A:');
    await expect(caio).toContainText('2 reservas futuras');
    await expect(caio).toContainText('1 mensalista');
    await expect(caio).toContainText('1 assinatura de aula');
    await expect(caio).toContainText('3 presenças futuras em aula');
    await expect(caio).toContainText(/1 mensalidade em aberto \(R\$\s180,00\)/);

    const dani = rows(page).filter({ hasText: 'Jogadora Dani' });
    await expect(dani).toContainText('Aberto pelo Super');
    await expect(dani).toContainText('03/11/2026');
    await expect(dani.getByText('Vencido', { exact: true })).toHaveCount(0);
    await expect(dani).toContainText('Nenhuma pendência.');
  });

  test('filtra os cancelados e mostra o status Cancelado', async ({ page }) => {
    await page.goto('/super/usuarios?aba=lgpd');
    await page.getByLabel('Status do pedido').selectOption('CANCELLED');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('Ex-usuária Eva');
    await expect(rows(page)).toContainText('Cancelado');
    await expect(rows(page)).toContainText('Desistiu pelo atendimento');
    await expect(rows(page).getByRole('button')).toHaveCount(0);
  });

  test('atender explica o que será cancelado e anonimiza', async ({ page, request }) => {
    await page.goto('/super/usuarios?aba=lgpd');
    await rows(page)
      .filter({ hasText: 'Jogador Caio' })
      .getByRole('button', { name: 'Atender' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Atender exclusão de conta' });
    await expect(dialog).toContainText('anonimizada');
    await expect(dialog).toContainText('reservas futuras são canceladas');
    await expect(dialog).toContainText('assinaturas de aula são encerrados');
    await expect(dialog).toContainText('Pagamentos e mensalidades já devidas ficam no histórico');
    await expect(dialog).toContainText('A gestão dos espaços afetados é avisada');
    await dialog.getByRole('button', { name: 'Atender e anonimizar' }).click();

    await expect(rows(page)).toHaveCount(1);
    const call = (await superCalls(request)).find((c) => c.path.endsWith('/fulfill'));
    expect(call?.path).toBe(
      '/v1/super/deletion-requests/00000000-0000-4000-8000-000000000601/fulfill',
    );
  });

  test('recusar exige a justificativa', async ({ page, request }) => {
    await page.goto('/super/usuarios?aba=lgpd');
    await rows(page)
      .filter({ hasText: 'Jogadora Dani' })
      .getByRole('button', { name: 'Recusar' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Recusar exclusão de conta' });
    await dialog.getByRole('button', { name: 'Recusar pedido' }).click();
    await expect(dialog.getByText('Informe o motivo da recusa')).toBeVisible();

    await dialog.getByLabel('Motivo da recusa').fill('Fraude em investigação');
    await dialog.getByRole('button', { name: 'Recusar pedido' }).click();
    await expect(rows(page)).toHaveCount(1);
    const call = (await superCalls(request)).find((c) => c.path.endsWith('/reject'));
    expect(call?.body).toEqual({ note: 'Fraude em investigação' });
  });

  test('cancelar o pedido reativa a conta e a nota é opcional', async ({ page, request }) => {
    await page.goto('/super/usuarios?aba=lgpd');
    await rows(page)
      .filter({ hasText: 'Jogadora Dani' })
      .getByRole('button', { name: 'Cancelar pedido' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Cancelar pedido de exclusão' });
    await expect(dialog).toContainText('desistiu da exclusão');
    await expect(dialog).toContainText('volta a ficar ativa');
    await expect(dialog).toContainText('Nada é cancelado ou anonimizado');
    await dialog.getByLabel('Nota (opcional)').fill('Pediu pelo atendimento');
    await dialog.getByRole('button', { name: 'Cancelar pedido e reativar' }).click();

    await expect(rows(page)).toHaveCount(1);
    const call = (await superCalls(request)).find((c) => c.path.endsWith('/cancel'));
    expect(call?.body).toEqual({ note: 'Pediu pelo atendimento' });

    await page.getByLabel('Status do pedido').selectOption('CANCELLED');
    await expect(rows(page).filter({ hasText: 'Jogadora Dani' })).toContainText('Cancelado');
  });
});
