import { expect, type Page, test } from '@playwright/test';
import { login as loginAs } from './support/api';

// E2E do painel contra a API real e o seed de teste (apps/api/test/e2e-seed): "Arena E2E",
// Quadra A e B, R$ 100/h, aberta 24h. Os testes rodam em sequência e compartilham a agenda.
// Cobre: RF-BOOK-06 (agenda por quadra, reserva de balcão, bloqueio), RN-BOOK-01 (preço) e
// RN-BOOK-03 (sem sobreposição), além do login do gestor (RF-AUTH). Os horários são fixos por teste.
test.describe.configure({ mode: 'serial' });

const OWNER = { email: 'dono.e2e@exemplo.com' };
const SPACE_NAME = 'Arena E2E';

/** Data (AAAA-MM-DD) daqui a `days` dias em America/Sao_Paulo: dentro da janela e da antecedência. */
function localDate(days: number) {
  const target = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(target);
}
const DAY = localDate(3);

const login = (page: Page) => loginAs(page, OWNER.email, /\/painel$/);

async function openAgenda(page: Page) {
  await page.goto(`/painel/agenda?data=${DAY}`);
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
  await expect(page.getByTestId('agenda-grid')).toBeVisible();
}

/** Escolhe uma opção de um Select (Radix) pelo id do gatilho. */
async function pick(page: Page, triggerId: string, option: string) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Abre o diálogo de balcão pelo botão do topo (o slot ocupado fica coberto pela reserva). */
async function deskBooking(page: Page, court: string, time: string, name: string) {
  await page.getByRole('button', { name: 'Reserva de balcão' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reserva de balcão' });
  await pick(page, 'desk-court', court);
  await dialog.locator('#desk-date').fill(DAY);
  await pick(page, 'desk-start', time);
  await dialog.getByLabel('Nome do cliente').fill(name);
  await dialog.getByLabel('Telefone (WhatsApp)').fill('(31) 98888-7777');
  return dialog;
}

test('RF-AUTH: gestor entra no /painel e vê o seu espaço', async ({ page }) => {
  await login(page);
  await expect(page.getByTestId('space-switcher')).toContainText(SPACE_NAME);
});

test('RF-BOOK-06: agenda do dia tem uma coluna por quadra', async ({ page }) => {
  await login(page);
  await openAgenda(page);
  const grid = page.getByTestId('agenda-grid');
  await expect(grid.getByText('Quadra A', { exact: true })).toBeVisible();
  await expect(grid.getByText('Quadra B', { exact: true })).toBeVisible();
  await expect(page.getByText('Nenhuma reserva neste período.')).toBeVisible();
});

test('RF-BOOK-06 / RN-BOOK-01: reserva de balcão aparece na coluna da quadra com o valor do espaço', async ({
  page,
}) => {
  await login(page);
  await openAgenda(page);
  const dialog = await deskBooking(page, 'Quadra A', '10:00', 'Ana Paula');
  // RN-BOOK-01: o preço vem do espaço (R$ 100/h × 1h), em centavos na API.
  await expect(dialog.getByText('R$ 100,00')).toBeVisible();
  await pick(page, 'desk-method', 'Pix');
  await dialog.getByRole('button', { name: 'Criar reserva' }).click();
  await expect(page.getByText('Reserva de balcão criada.')).toBeVisible();

  const booking = page.getByTestId('agenda-booking');
  await expect(booking).toHaveCount(1);
  await expect(booking).toContainText('Ana Paula');
  await expect(booking).toContainText('10:00–11:00');
});

test('RN-BOOK-03: segunda reserva no mesmo horário e quadra é recusada (SLOT_UNAVAILABLE)', async ({
  page,
}) => {
  await login(page);
  await openAgenda(page);
  // Mesmo horário da reserva do teste anterior (Quadra A, 10:00).
  const dialog = await deskBooking(page, 'Quadra A', '10:00', 'Bruno Lima');
  const response = page.waitForResponse(
    (r) => r.url().includes('/bookings') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Criar reserva' }).click();

  const res = await response;
  expect(res.status()).toBe(409);
  expect((await res.json()).error.code).toBe('SLOT_UNAVAILABLE');
  await expect(dialog.getByRole('alert')).toHaveText('Esse horário já está ocupado nesta quadra.');
  await expect(page.getByText('Reserva de balcão criada.')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Voltar' }).click();

  // Nada foi criado: continua só a reserva da Ana Paula.
  await page.reload();
  await expect(page.getByTestId('agenda-booking')).toHaveCount(1);
});

test('RN-BOOK-03: o mesmo horário em outra quadra continua livre', async ({ page }) => {
  await login(page);
  await openAgenda(page);
  const dialog = await deskBooking(page, 'Quadra B', '10:00', 'Carla Dias');
  await dialog.getByRole('button', { name: 'Criar reserva' }).click();
  await expect(page.getByText('Reserva de balcão criada.')).toBeVisible();
  await expect(page.getByTestId('agenda-booking')).toHaveCount(2);
});

test('RN-BOOK-03: reserva sobreposta em parte do horário também conflita', async ({ page }) => {
  await login(page);
  await openAgenda(page);
  // 10:30–11:30 invade a reserva de 10:00–11:00 na Quadra A.
  const dialog = await deskBooking(page, 'Quadra A', '10:30', 'Davi Melo');
  await dialog.getByRole('button', { name: 'Criar reserva' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Esse horário já está ocupado nesta quadra.');
});

test('RF-BOOK-06: bloqueia um horário da quadra e o balcão não consegue reservá-lo', async ({
  page,
}) => {
  await login(page);
  await openAgenda(page);
  await page.getByRole('button', { name: 'Bloquear horário' }).click();
  const block = page.getByRole('dialog', { name: 'Bloquear horário' });
  await pick(page, 'block-court', 'Quadra A');
  await block.locator('#block-date').fill(DAY);
  await pick(page, 'block-start', '14:00');
  await pick(page, 'block-end', '16:00');
  await block.getByLabel('Motivo (opcional)').fill('Manutenção da areia');
  await block.getByRole('button', { name: 'Bloquear', exact: true }).click();
  await expect(page.getByText('Horário bloqueado.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Bloqueado\s*Manutenção da areia/ })).toBeVisible();

  // Dentro do bloqueio (14:30–15:30): conflito.
  const dialog = await deskBooking(page, 'Quadra A', '14:30', 'Eva Rocha');
  await dialog.getByRole('button', { name: 'Criar reserva' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Esse horário já está ocupado nesta quadra.');
  await dialog.getByRole('button', { name: 'Voltar' }).click();

  // A outra quadra no mesmo horário não é afetada.
  const other = await deskBooking(page, 'Quadra B', '14:30', 'Eva Rocha');
  await other.getByRole('button', { name: 'Criar reserva' }).click();
  await expect(page.getByText('Reserva de balcão criada.')).toBeVisible();
});

test('RF-BOOK-06: não bloqueia horário que já tem reserva', async ({ page }) => {
  await login(page);
  await openAgenda(page);
  await page.getByRole('button', { name: 'Bloquear horário' }).click();
  const block = page.getByRole('dialog', { name: 'Bloquear horário' });
  await pick(page, 'block-court', 'Quadra A');
  await block.locator('#block-date').fill(DAY);
  await pick(page, 'block-start', '10:00');
  await pick(page, 'block-end', '11:00');
  await block.getByRole('button', { name: 'Bloquear', exact: true }).click();
  await expect(block.getByRole('alert')).toHaveText('Esse horário já está ocupado nesta quadra.');
  await expect(page.getByText('Horário bloqueado.')).toHaveCount(0);
});

test('RF-BOOK-06: remover o bloqueio libera o horário', async ({ page }) => {
  await login(page);
  await openAgenda(page);
  await page.getByRole('button', { name: /Bloqueado\s*Manutenção da areia/ }).click();
  await page.getByRole('button', { name: /Remover bloqueio/ }).click();
  await expect(page.getByText('Bloqueio removido.')).toBeVisible();

  const dialog = await deskBooking(page, 'Quadra A', '14:30', 'Fábio Reis');
  await dialog.getByRole('button', { name: 'Criar reserva' }).click();
  await expect(page.getByText('Reserva de balcão criada.')).toBeVisible();
});
