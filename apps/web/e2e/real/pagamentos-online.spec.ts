import { expect, type Page, test } from '@playwright/test';
import {
  apiAs,
  body,
  courtsAndSport,
  disposeClients,
  linkIn,
  localDate,
  login,
  RUN,
  saoPauloInstant,
  signUpByApi,
  waitForMail,
} from './support/api';
import { API, USERS, WEB } from './support/env';

// Pagamento online ponta a ponta contra a API real com o gateway fake e os jobs ligados (config
// playwright.real-payments.config.ts): o Dono faz o cadastro e ativa os modos, o jogador reserva com
// Pix, o Super paga o Pix no simulador, a carteira mostra a venda e a taxa, o Admin estorna parte do
// valor e a carteira reflete; o Super altera a taxa do espaço, vê a receita e a nova taxa vale na
// próxima cobrança. Cobre RF-ONPAY-01, 02, 07, 08, 10, 11 e 12; RN-ONPAY-01, 04, 05 e 08.
// A jornada do jogador é do app: aqui ele fala com a API (login por request, sem tela).
test.describe.configure({ mode: 'serial' });

const ADMIN_EMAIL = `admin.pagamentos.${RUN}@exemplo.com`;
/** Arena E2E: R$ 100/h (seed). Pix: 4% = R$ 4,00, acima do mínimo de R$ 1,00. */
const PRICE = 10_000;
const FEE = 400;
const REFUND = 3_000;
/** Taxa devolvida pela regra acumulada: arredondar(400 × 3000 ÷ 10000) = 120. */
const FEE_REFUND = 120;

/** Arena E2E, e não a "Arena E2E Norte" do mesmo seed. */
const ARENA = /^Arena E2E(?! Norte)/;

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const state = {} as {
  spaceId: string;
  sportId: string;
  courtA: string;
  courtB: string;
  bookingId: string;
  chargeId: string;
  secondChargeId: string;
};

test.afterAll(disposeClients);

test.beforeAll(async ({ playwright }) => {
  const owner = await apiAs(playwright, USERS.owner);
  state.spaceId = (await body(await owner.get('/v1/me'))).memberships[0].space.id;
  const catalog = await courtsAndSport(owner, state.spaceId);
  state.sportId = catalog.sportId;
  state.courtA = catalog.court('Quadra A');
  state.courtB = catalog.court('Quadra B');
});

/** Troca de usuário na mesma página: `/entrar` redireciona quem já está logado. */
async function loginAgain(page: Page, email: string) {
  await page.context().clearCookies();
  await login(page, email);
}

/** Espera o valor da carteira (o web atualiza por polling/recarga; recarrega a página a cada vez). */
async function waitFor(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 20_000, intervals: [500, 1_000, 2_000] });
}

async function bookWithPix(
  playwright: Parameters<typeof apiAs>[0],
  day: number,
  time: string,
  courtId: string,
) {
  const player = await apiAs(playwright, USERS.player);
  const res = await player.post('/v1/bookings', {
    data: {
      spaceId: state.spaceId,
      courtId,
      sportId: state.sportId,
      startsAt: saoPauloInstant(localDate(day), time).toISOString(),
      durationMin: 60,
      peopleCount: 2,
      paymentOption: 'ONLINE_PIX',
    },
  });
  expect(res.status(), JSON.stringify(await res.json())).toBe(201);
  return body(res);
}

test('RF-ONPAY-01: o Dono faz o cadastro em etapas e o gateway aprova', async ({ page }) => {
  await login(page, USERS.owner);
  await page.goto('/painel/recebimentos-online');
  const card = page.getByTestId('merchant-card');
  await expect(card).toContainText('Não iniciado');
  await page.getByRole('link', { name: 'Começar cadastro' }).click();
  // Gateway simulado: a faixa de teste traz a dica do documento que força a recusa.
  await expect(page.getByTestId('sandbox-banner')).toContainText('terminado em 0000');

  // 1. Quem recebe: empresa (CNPJ) pede o CPF do responsável.
  await page.getByRole('textbox', { name: 'CNPJ' }).fill('11.222.333/0001-81');
  await page.getByLabel('Razão social').fill('Arena E2E Ltda (fictícia)');
  await page.getByLabel('Responsável pela conta').fill('Dono E2E');
  await page.getByLabel('Telefone').fill('(31) 99999-8888');
  await page.getByLabel('E-mail').fill('financeiro@arena-e2e.exemplo');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Informe um CPF válido')).toBeVisible();
  await page.getByRole('textbox', { name: 'CPF do responsável' }).fill('52998224725');
  await page.getByRole('button', { name: 'Continuar' }).click();

  // 2. Endereço: o CEP (simulado, final 111) preenche a rua.
  await page.getByLabel('CEP').fill(`${String(Date.now()).slice(-5)}111`);
  await expect(page.getByLabel('Rua')).toHaveValue('Rua ViaCEP');
  await page.getByLabel('Número').fill('100');
  await page.getByRole('button', { name: 'Continuar' }).click();

  // 3. Onde receber.
  await page.getByRole('combobox', { name: 'Banco' }).fill('260');
  await page.getByRole('textbox', { name: 'Agência' }).fill('0001');
  await page.getByRole('textbox', { name: 'Conta com dígito' }).fill('12345-6');
  await page.getByRole('button', { name: 'Continuar' }).click();

  // 4. Revisão: sem o aceite, não envia.
  await page.getByRole('button', { name: 'Enviar cadastro' }).click();
  await expect(page.getByText('Aceite os termos para continuar')).toBeVisible();
  await page.getByLabel(/Li e aceito os termos/).check();
  await page.getByRole('button', { name: 'Enviar cadastro' }).click();
  await expect(page.getByText('Cadastro enviado')).toBeVisible();

  // O documento e o CPF do responsável só aparecem mascarados depois do envio (RN-ONPAY-10).
  const summary = page.getByTestId('merchant-summary');
  await expect(summary).toContainText('***.982.247-**');
  await expect(page.locator('body')).not.toContainText('52998224725');
  await expect(page.locator('body')).not.toContainText('11222333000181');

  // O fake aprova sozinho (job da fila) em instantes.
  await waitFor(page, async () => {
    await page.goto('/painel/recebimentos-online?aba=configuracao');
    await expect(page.getByTestId('merchant-card')).toContainText('Aprovado');
  });
});

test('RF-ONPAY-02: o Dono ativa os modos de pagamento e a escolha fica salva', async ({
  page,
  playwright,
}) => {
  await login(page, USERS.owner);
  await page.goto('/painel/recebimentos-online?aba=configuracao');
  const modes = page.getByTestId('modes-card');
  const save = modes.getByRole('button', { name: 'Salvar alterações' });
  await expect(save).toBeDisabled();
  await modes
    .getByRole('radiogroup', { name: 'Reservas pelo app' })
    .getByText('No local ou online')
    .click();
  await save.click();
  await expect(page.getByText('Formas de pagamento salvas')).toBeVisible();

  const owner = await apiAs(playwright, USERS.owner);
  const settings = await body(
    await owner.get(`/v1/manage/spaces/${state.spaceId}/online-payments/settings`),
  );
  expect(settings).toMatchObject({ bookingMode: 'ONLINE_OPTIONAL', onlineReady: true });
  // A taxa vigente é só leitura: 4% no Pix com mínimo de R$ 1,00 (RF-ONPAY-02).
  await page.reload();
  await expect(page.getByTestId('fee-card')).toContainText('4%');
});

test('RF-ONPAY-12: o jogador reserva com Pix e o Super paga a cobrança no simulador', async ({
  page,
  playwright,
}) => {
  const booking = await bookWithPix(playwright, 2, '09:00', state.courtA);
  state.bookingId = booking.id;
  state.chargeId = booking.onlinePayment.id;
  expect(booking.status).toBe('CONFIRMED');
  expect(booking.onlinePayment).toMatchObject({
    method: 'PIX',
    status: 'PENDING',
    amountCents: PRICE,
  });

  await login(page, USERS.super);
  await page.goto('/super/pagamentos?aba=simulador');
  await expect(page.getByTestId('simulator-banner')).toContainText('nunca em produção');
  const row = page.getByTestId('simulator-charge').filter({ hasText: ARENA }).first();
  await expect(row).toContainText('Pix');
  await row.getByRole('button', { name: 'Pagar' }).click();
  await expect(page.getByText(/pago\. O webhook foi enviado\./)).toBeVisible();

  // O webhook (assinado) entra pela fila: a reserva passa a paga.
  const player = await apiAs(playwright, USERS.player);
  await expect(async () => {
    const detail = await body(await player.get(`/v1/bookings/${state.bookingId}`));
    expect(detail.paymentStatus).toBe('PAID');
  }).toPass({ timeout: 20_000 });
});

test('RF-ONPAY-07: a carteira mostra a venda, a taxa e o que falta liberar', async ({ page }) => {
  await login(page, USERS.owner);
  await page.goto('/painel/recebimentos-online');
  const wallet = page.getByTestId('wallet');
  await waitFor(page, async () => {
    await expect(wallet.getByTestId('wallet-pending')).toContainText(
      brl(PRICE - FEE).replace(/\s/g, ' '),
    );
  });
  const rows = wallet.getByTestId('ledger-row');
  await expect(rows.filter({ hasText: 'Venda' }).first()).toContainText(
    brl(PRICE).replace(/\s/g, ' '),
  );
  const feeRow = rows.filter({ hasText: 'Taxa de serviço' }).first();
  await expect(feeRow).toContainText(brl(FEE).replace(/\s/g, ' '));
  await expect(feeRow).toContainText('Pix');
});

test('RF-ONPAY-08: o Admin estorna parte do valor e a carteira reflete (RN-ONPAY-05)', async ({
  page,
  playwright,
  request,
}) => {
  // O Dono convida um Admin; ele cria a conta, confirma o e-mail e aceita o convite.
  const owner = await apiAs(playwright, USERS.owner);
  const invite = await owner.post(`/v1/manage/spaces/${state.spaceId}/team/invites`, {
    data: { email: ADMIN_EMAIL, role: 'ADMIN' },
  });
  expect(invite.status(), JSON.stringify(await invite.json())).toBe(201);
  const inviteMail = await waitForMail(request, ADMIN_EMAIL, /Convite para a equipe/);
  const token = linkIn(inviteMail, '/convite/').split('/convite/')[1]?.split(/[?#]/)[0] ?? '';
  const admin = await signUpByApi(playwright, ADMIN_EMAIL, 'Admin Pagamentos');
  const verification = await waitForMail(request, ADMIN_EMAIL, /Confirme seu e-mail/);
  await admin.get(linkIn(verification, '/v1/auth/verify-email').replace(WEB, API), {
    maxRedirects: 0,
  });
  const accepted = await admin.post(`/v1/staff-invites/${token}/accept`);
  expect(accepted.status(), JSON.stringify(await accepted.json().catch(() => ({})))).toBe(200);

  await login(page, ADMIN_EMAIL);
  await page.goto('/painel/reservas/avulsas');
  // A reserva do jogador (Quadra A), a única com Pix pago.
  await page
    .getByTestId('booking-row')
    .filter({ hasText: 'Jogador E2E' })
    .filter({ hasText: 'Quadra A' })
    .first()
    .click();
  const detail = page.getByTestId('booking-detail');
  const block = detail.getByTestId('online-charge');
  await expect(block).toContainText('Pix');
  await expect(block).toContainText('Taxa de serviço (4%)');
  // O registro online não tem "Estornar" manual (RN-ONPAY-04): só o bloco da cobrança.
  await expect(
    detail
      .getByRole('list', { name: 'Pagamentos registrados' })
      .getByRole('button', { name: 'Estornar' }),
  ).toHaveCount(0);

  await block.getByRole('button', { name: 'Estornar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Estornar pagamento online' });
  await dialog.getByText('Parte do valor').click();
  await dialog.getByLabel('Valor a devolver').fill('30,00');
  await dialog.getByLabel('Motivo').fill('Chuva interrompeu o jogo');
  await expect(dialog.getByTestId('refund-estimate')).toContainText('1,20');
  await dialog.getByRole('button', { name: 'Estornar R$ 30,00' }).click();
  await expect(page.getByText('Estorno de R$ 30,00 enviado ao cliente.')).toBeVisible();

  // Mesma conta, na carteira do Dono: estorno de R$ 30,00 e taxa devolvida de R$ 1,20.
  await loginAgain(page, USERS.owner);
  await page.goto('/painel/recebimentos-online');
  const wallet = page.getByTestId('wallet');
  const expectedPending = PRICE - FEE - REFUND + FEE_REFUND;
  await waitFor(page, async () => {
    await expect(wallet.getByTestId('wallet-pending')).toContainText(
      brl(expectedPending).replace(/\s/g, ' '),
    );
  });
  const rows = wallet.getByTestId('ledger-row');
  await expect(rows.filter({ hasText: 'Estorno' }).first()).toContainText(
    brl(REFUND).replace(/\s/g, ' '),
  );
  await expect(rows.filter({ hasText: 'Taxa devolvida' }).first()).toContainText(
    brl(FEE_REFUND).replace(/\s/g, ' '),
  );

  // O banco de dados e a API concordam com a tela: saldo = venda − taxa − estorno + taxa devolvida.
  const wallets = await body(
    await owner.get(`/v1/manage/spaces/${state.spaceId}/online-payments/wallet`),
  );
  expect(wallets.balanceCents).toBe(expectedPending);
  const charge = await body(
    await owner.get(`/v1/manage/spaces/${state.spaceId}/online-payments/charges/${state.chargeId}`),
  );
  expect(charge).toMatchObject({
    status: 'PARTIALLY_REFUNDED',
    refundedCents: REFUND,
    platformFeeCents: FEE,
  });

  // O Admin vê a carteira, mas não troca a conta de recebimento (decisão 95).
  await loginAgain(page, ADMIN_EMAIL);
  await page.goto('/painel/recebimentos-online?aba=configuracao');
  await expect(page.getByTestId('merchant-card')).toContainText(
    'Só o dono do espaço pode trocar a conta.',
  );
});

test('RF-ONPAY-10 e 11: o Super altera a taxa do espaço, vê a receita e a taxa nova vale na próxima cobrança', async ({
  page,
  playwright,
}) => {
  await login(page, USERS.super);
  await page.goto('/super/pagamentos');
  await expect(page.getByTestId('sandbox-badge')).toBeVisible();

  // Receita da venda: taxa R$ 4,00 − tarifa do gateway (0,99% de R$ 100,00 = R$ 0,99) − taxa
  // devolvida R$ 1,20 = R$ 1,81.
  // Os totais incluem o outro espaço do seed (Norte); a conferência exata é na linha da Arena E2E.
  await expect(page.getByTestId('revenue-totals')).toContainText('Taxa recobrada');
  const arenaRow = page.getByTestId('revenue-row').filter({ hasText: ARENA }).first();
  await expect(arenaRow).toBeVisible();
  for (const cents of [PRICE, FEE, FEE_REFUND]) {
    await expect(arenaRow).toContainText(brl(cents).replace(/\s/g, ' '));
  }

  const api = await apiAs(playwright, USERS.super);
  const revenue = await body(await api.get('/v1/super/online-payments/revenue'));
  const arena = revenue.bySpace.find((s: { spaceId: string }) => s.spaceId === state.spaceId);
  expect(arena).toMatchObject({
    grossFeeCents: FEE,
    feeRefundedCents: FEE_REFUND,
    volumeCents: PRICE,
  });
  expect(arena.netRevenueCents).toBe(
    arena.grossFeeCents - arena.gatewayCostCents - arena.feeRefundedCents + arena.feeRechargedCents,
  );

  // Condição própria do espaço: Pix a 3%.
  await page.goto('/super/pagamentos?aba=taxas');
  await page.getByRole('button', { name: 'Adicionar condição' }).click();
  const dialog = page.getByRole('dialog', { name: 'Adicionar condição' });
  await dialog.getByLabel('Espaço').selectOption({ label: 'Arena E2E' });
  await dialog.getByLabel('Pix (%)').fill('3');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByTestId('space-fee-row').filter({ hasText: ARENA })).toContainText('3%');

  // A cobrança nova usa a taxa nova: 3% de R$ 100,00 = R$ 3,00; a antiga fica como estava.
  const second = await bookWithPix(playwright, 2, '11:00', state.courtB);
  state.secondChargeId = second.onlinePayment.id;
  const owner = await apiAs(playwright, USERS.owner);
  const charges = `/v1/manage/spaces/${state.spaceId}/online-payments/charges`;
  const fresh = await body(await owner.get(`${charges}/${state.secondChargeId}`));
  expect(fresh).toMatchObject({ platformFeeCents: 300, feeBps: 300, spaceNetCents: PRICE - 300 });
  const old = await body(await owner.get(`${charges}/${state.chargeId}`));
  expect(old).toMatchObject({ platformFeeCents: FEE, feeBps: 400 });

  // O Dono vê a taxa vigente nova (somente leitura).
  await loginAgain(page, USERS.owner);
  await page.goto('/painel/recebimentos-online?aba=configuracao');
  await expect(page.getByTestId('fee-card')).toContainText('3%');
});

test('RN-ONPAY-08: o Dono do outro espaço não vê a carteira nem a cobrança do primeiro', async ({
  playwright,
}) => {
  const north = await apiAs(playwright, USERS.northOwner);
  const wallet = await north.get(`/v1/manage/spaces/${state.spaceId}/online-payments/wallet`);
  expect(wallet.status()).toBe(403);
  const charge = await north.get(
    `/v1/manage/spaces/${state.spaceId}/online-payments/charges/${state.chargeId}`,
  );
  expect(charge.status()).toBe(403);
});
