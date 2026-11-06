import { expect, test } from '@playwright/test';
import { loginAs } from './helpers';

test('home pública abre', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('/painel abre com sidebar e seletor de espaço', async ({ page, context }) => {
  await loginAs(context, 'manager');
  await page.goto('/painel');
  await expect(page.getByRole('heading', { name: 'Hoje' })).toBeVisible();
  await expect(page.getByTestId('space-switcher')).toContainText('Espaço Exemplo A');
  await page.getByRole('link', { name: 'Turmas' }).click();
  await expect(page).toHaveURL(/\/painel\/aulas\/turmas$/);
  await expect(page.getByRole('heading', { name: 'Turmas' })).toBeVisible();
});

test('/super abre com sidebar própria', async ({ page, context }) => {
  await loginAs(context, 'super');
  await page.goto('/super');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Auditoria' })).toBeVisible();
});

test('rota inexistente no painel retorna 404', async ({ page, context }) => {
  await loginAs(context, 'manager');
  // Com loading.tsx o status já foi enviado em streaming; valida pelo conteúdo.
  await page.goto('/painel/nao-existe');
  await expect(page.getByText('Página não encontrada')).toBeVisible();
});
