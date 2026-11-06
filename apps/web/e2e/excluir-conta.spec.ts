import { expect, test } from './fixtures';
import { mockCalls } from './helpers';

async function deletionCalls(request: import('@playwright/test').APIRequestContext) {
  return (await mockCalls(request)).filter((c) => c.path === 'POST /v1/public/deletion-request');
}

test.describe('excluir conta (página pública)', () => {
  test('o rodapé das páginas públicas leva à página de exclusão', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Excluir minha conta' }).click();
    await expect(page).toHaveURL(/\/excluir-conta$/);
    await expect(
      page.getByRole('heading', { name: 'Excluir minha conta', level: 1 }),
    ).toBeVisible();
  });

  test('explica o que acontece, o prazo de 15 dias e quem não tem senha', async ({ page }) => {
    await page.goto('/excluir-conta');
    await expect(page.getByText('Sua conta é inativada na hora.')).toBeVisible();
    await expect(page.getByText(/em até 15\s+dias/)).toBeVisible();
    await expect(page.getByText(/anonimizados/)).toBeVisible();
    await expect(page.getByText(/continuam no histórico dos espaços/)).toBeVisible();
    await expect(page.getByText(/Fale com o atendimento|fale com o atendimento/)).toBeVisible();
    const note = page.getByTestId('password-only-note');
    await expect(note).toContainText('e-mail e senha');
    await expect(note).toContainText('Google, Apple ou telefone');
    await expect(note).toContainText('pelo app');
    await expect(note).toContainText('atendimento');
  });

  test('exige e-mail válido e senha antes de enviar', async ({ page, request }) => {
    await page.goto('/excluir-conta');
    await page.getByRole('button', { name: 'Pedir exclusão da conta' }).click();
    await expect(page.getByText('Informe seu e-mail')).toBeVisible();
    await expect(page.getByText('Informe sua senha')).toBeVisible();

    await page.getByLabel('E-mail da conta').fill('maria');
    await page.getByLabel('Senha').fill('segredo');
    await page.getByRole('button', { name: 'Pedir exclusão da conta' }).click();
    await expect(page.getByText('Informe um e-mail válido')).toBeVisible();
    // O registro é do escopo deste teste; o filtro garante que o e-mail inválido não chegou à API.
    expect((await deletionCalls(request)).filter((c) => c.body.email === 'maria')).toHaveLength(0);
  });

  test('envia o pedido e mostra a resposta genérica', async ({ page, request }) => {
    await page.goto('/excluir-conta');
    await page.getByLabel('E-mail da conta').fill(' Titular.Envio@Exemplo.com ');
    await page.getByLabel('Senha').fill('senha-1234');
    await page.getByLabel('Motivo (opcional)').fill('Não uso mais');
    await page.getByRole('button', { name: 'Pedir exclusão da conta' }).click();

    const notice = page.getByRole('status').filter({ hasText: 'Pedido enviado.' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('titular.envio@exemplo.com');
    await expect(notice).toContainText('Se o e-mail e a senha informados conferem');
    await expect(notice).toContainText('esta página não informa se a conta existe');
    await expect(page.getByLabel('Senha')).toHaveCount(0);

    const call = (await deletionCalls(request)).find(
      (c) => c.body.email === 'titular.envio@exemplo.com',
    );
    expect(call?.body).toEqual({
      email: 'titular.envio@exemplo.com',
      password: 'senha-1234',
      reason: 'Não uso mais',
    });
  });

  test('o limite de tentativas aparece como erro e deixa tentar de novo', async ({ page }) => {
    await page.goto('/excluir-conta');
    await page.getByLabel('E-mail da conta').fill('muitas@exemplo.com');
    await page.getByLabel('Senha').fill('senha-1234');
    await page.getByRole('button', { name: 'Pedir exclusão da conta' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Muitas tentativas' })).toBeVisible();
    await expect(page.getByLabel('E-mail da conta')).toHaveValue('muitas@exemplo.com');
    await expect(page.getByRole('button', { name: 'Pedir exclusão da conta' })).toBeEnabled();
  });
});
