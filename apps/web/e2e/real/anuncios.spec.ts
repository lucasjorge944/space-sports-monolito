import { expect, type Locator, test } from '@playwright/test';
import {
  anonymous,
  apiAs,
  body,
  disposeClients,
  errorOf,
  type Json,
  login,
  RUN,
} from './support/api';
import { USERS } from './support/env';

// Anúncios no /super contra a API real (RF-ADS-01, 02, 03, 09; RN-ADS-01, 02, 05). Complementa
// e2e/anuncios.spec.ts (API simulada) com o que só o servidor prova: a campanha "No ar" de verdade
// (entrega pública), o relatório com contadores reais, a recusa de categoria proibida e o acesso
// só do Super.
//
// Upload de imagem: o e2e real roda a API SEM storage (nenhum S3_BUCKET no playwright.real.config.ts),
// então o envio real de imagem não é exercitado aqui. A peça com imagem fica coberta pelo e2e com
// API simulada, pelos testes de integração da API (test/ads/super-ads.int.test.ts, com storage
// falso) e pelo seed de teste. Aqui valem o caminho sem imagem (anunciante Espaço, RN-ADS-05) e a
// mensagem de storage indisponível.
test.describe.configure({ mode: 'serial' });

const NAME = `Teste ${RUN}`;
const CAMPAIGN = `Campanha ${RUN}`;
const SPACE_CAMPAIGN = `Destaque ${RUN}`;

/** Escolhe no <select> a opção cujo texto começa com `prefix` (o rótulo completo traz a cidade). */
async function selectStartingWith(select: Locator, prefix: string) {
  // As opções vêm da API depois de a tela abrir: espera a que interessa aparecer.
  let label: string | undefined;
  await expect
    .poll(
      async () => {
        const labels = await select.locator('option').allTextContents();
        label = labels.find((text) => text.trim().startsWith(prefix));
        return label;
      },
      { message: `opção "${prefix}…"` },
    )
    .toBeDefined();
  await select.selectOption({ label: label as string });
}

const state = {} as { companyCampaignUrl: string; spaceCampaignId: string; creativeToken: string };

test.afterAll(disposeClients);

test('Dono do espaço não vê nem usa o /super/anuncios (RN-ADS-02)', async ({
  page,
  playwright,
}) => {
  const owner = await apiAs(playwright, USERS.owner);
  for (const path of [
    '/v1/super/ads/campaigns',
    '/v1/super/ads/advertisers',
    '/v1/super/ads/campaigns/00000000-0000-4000-8000-000000000000/report',
  ]) {
    const res = await owner.get(path);
    expect(res.status(), path).toBe(403);
    expect((await errorOf(res)).code).toBe('SUPER_REQUIRED');
  }
  const created = await owner.post('/v1/super/ads/advertisers', {
    data: { name: 'Intruso', kind: 'COMPANY', category: 'OTHER' },
  });
  expect(created.status()).toBe(403);

  // Na tela, o Dono não chega às campanhas.
  await login(page, USERS.owner, /\/painel/);
  await page.goto('/super/anuncios');
  await expect(page.getByRole('heading', { name: 'Anúncios' })).toHaveCount(0);
  await expect(page.getByTestId('campaign-row')).toHaveCount(0);
});

test('Super vê as campanhas do seed "No ar" nas duas vagas', async ({ page }) => {
  await login(page, USERS.super, /\/super$/);
  await page.goto('/super/anuncios');
  await expect(page.getByRole('heading', { name: 'Anúncios' })).toBeVisible();

  const row = (title: string) =>
    page
      .getByTestId('campaign-row')
      .filter({ has: page.getByRole('link', { name: `E2E · ${title}`, exact: true }) });
  for (const title of [
    'Raquetes E2E em oferta',
    'Arena E2E Norte no destaque',
    'Whey E2E para o jogo',
    'Arena E2E Norte na lista',
  ]) {
    await expect(row(title).getByTestId('campaign-situation')).toHaveText('No ar');
  }

  // "No ar agora" e a vaga filtram a lista.
  await page.getByLabel('Vaga').selectOption({ label: 'Card na lista' });
  await expect(row('Whey E2E para o jogo')).toBeVisible();
  await expect(row('Raquetes E2E em oferta')).toHaveCount(0);
});

test('cria anunciante empresa; a categoria não oferece bets nem álcool e a API recusa', async ({
  page,
  playwright,
}) => {
  await login(page, USERS.super, /\/super$/);
  await page.goto('/super/anuncios?aba=anunciantes');
  await page.getByRole('button', { name: 'Novo anunciante' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo anunciante' });

  const categories = await dialog.getByLabel('Categoria').locator('option').allTextContents();
  expect(categories).toContain('Suplementos');
  expect(categories.join(' ')).not.toMatch(/apostas|bets|alcoólicas|cerveja|cassino/i);

  await dialog.getByLabel('Nome', { exact: true }).fill(NAME);
  await dialog.getByLabel('Categoria').selectOption({ label: 'Suplementos' });
  await dialog.getByRole('button', { name: 'Criar anunciante' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('cell', { name: NAME, exact: true })).toBeVisible();

  // Categoria proibida: a API recusa mesmo fora da tela, e nada é gravado (RN-ADS-01).
  const superApi = await apiAs(playwright, USERS.super);
  for (const category of ['BETTING', 'ALCOHOL']) {
    const res = await superApi.post('/v1/super/ads/advertisers', {
      data: { name: `Proibida ${category} ${RUN}`, kind: 'COMPANY', category },
    });
    expect(res.status(), category).toBe(422);
    expect((await errorOf(res)).code).toBe('AD_CATEGORY_FORBIDDEN');
  }
  const list = (await body(await superApi.get('/v1/super/ads/advertisers?q=Proibida'))) as Json;
  expect(list.items.filter((item: Json) => item.name.includes(RUN))).toEqual([]);
  await page.reload();
  await expect(page.getByRole('cell', { name: /^Proibida/ })).toHaveCount(0);
});

test('cria a campanha (carrossel, em horário de Brasília) e ela fica sem peças', async ({
  page,
}) => {
  await login(page, USERS.super, /\/super$/);
  await page.goto('/super/anuncios/campanhas/nova');
  await expect(page.getByRole('heading', { name: 'Nova campanha' })).toBeVisible();

  await page.getByLabel('Anunciante', { exact: true }).selectOption({ label: `${NAME} · Empresa` });
  await page.getByLabel('Nome da campanha').fill(CAMPAIGN);
  await page.getByText('Carrossel do topo', { exact: true }).click();
  await expect(page.getByRole('radio', { name: /Carrossel do topo/ })).toBeChecked();
  await expect(page.getByText(/Imagem 2:1, mínimo 960 × 480 px, até 2 MB/)).toBeVisible();
  const today = new Date();
  const ymd = (d: Date) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d);
  await page.getByLabel('Data de início').fill(ymd(new Date(today.getTime() - 86_400_000)));
  await page.getByLabel('Hora de início').fill('00:00');
  await page.getByLabel('Data de fim').fill(ymd(new Date(today.getTime() + 30 * 86_400_000)));
  await page.getByLabel('Hora de fim').fill('23:59');
  await page.getByLabel('Status').selectOption({ label: 'Ativa' });
  await page.getByRole('button', { name: 'Criar campanha' }).click();

  await expect(page.getByRole('heading', { name: new RegExp(CAMPAIGN) })).toBeVisible();
  // Ativa, no período, mas sem peça: não vai ao ar (RF-ADS-02).
  await expect(page.getByTestId('campaign-situation').first()).toHaveText('Sem peças');
  await expect(
    page.getByText('Nenhuma peça. Sem peça ativa a campanha não vai ao ar.'),
  ).toBeVisible();
  state.companyCampaignUrl = page.url();
});

test('sem storage no ambiente, o envio da imagem da peça diz que está indisponível', async ({
  page,
}) => {
  await login(page, USERS.super, /\/super$/);
  await page.goto(`${state.companyCampaignUrl}/pecas/nova`);
  await expect(page.getByRole('heading', { name: 'Nova peça' })).toBeVisible();

  // PNG 1x1 esticado não serve para o recorte; um 1200x600 mínimo gerado no navegador.
  const png = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#03547d';
      ctx.fillRect(0, 0, 1200, 600);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return Array.from(new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0)));
  });
  await page.getByTestId('creative-image-input').setInputFiles({
    name: 'banner.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png),
  });
  const crop = page.getByRole('dialog', { name: 'Recortar imagem da peça' });
  await crop.getByRole('button', { name: 'Enviar imagem' }).click();
  // 503 STORAGE_UNAVAILABLE da API sem S3: mensagem na tela, sem imagem anexada.
  await expect(page.getByText(/indispon[ií]vel/i).first()).toBeVisible();
  await expect(page.getByTestId('creative-image')).toHaveCount(0);
});

test('anunciante Espaço: campanha sem imagem vai ao ar, é entregue ao público e o relatório começa zerado', async ({
  page,
  playwright,
}) => {
  await login(page, USERS.super, /\/super$/);
  // 1) Anunciante do tipo Espaço (Arena E2E).
  await page.goto('/super/anuncios?aba=anunciantes');
  await page.getByRole('button', { name: 'Novo anunciante' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo anunciante' });
  await dialog.getByText(/^Espaço parceiro da plataforma/).click();
  await selectStartingWith(dialog.getByLabel('Espaço anunciante'), 'Arena E2E ·');
  await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Arena E2E');
  await dialog.getByRole('button', { name: 'Criar anunciante' }).click();
  await expect(dialog).toBeHidden();

  // 2) Campanha do carrossel, ativa.
  await page.goto('/super/anuncios/campanhas/nova');
  await selectStartingWith(page.getByLabel('Anunciante', { exact: true }), 'Arena E2E ·');
  await page.getByLabel('Nome da campanha').fill(SPACE_CAMPAIGN);
  await page.getByText('Carrossel do topo', { exact: true }).click();
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d);
  await page.getByLabel('Data de início').fill(fmt(new Date(Date.now() - 86_400_000)));
  await page.getByLabel('Hora de início').fill('00:00');
  await page.getByLabel('Data de fim').fill(fmt(new Date(Date.now() + 30 * 86_400_000)));
  await page.getByLabel('Hora de fim').fill('23:59');
  await page.getByLabel('Status').selectOption({ label: 'Ativa' });
  await page.getByRole('button', { name: 'Criar campanha' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(SPACE_CAMPAIGN) })).toBeVisible();
  state.spaceCampaignId = page.url().split('/campanhas/')[1]?.split(/[/?]/)[0] ?? '';
  expect(state.spaceCampaignId).toMatch(/^[0-9a-f-]{36}$/);

  // 3) Peça sem imagem, com destino no próprio espaço (RN-ADS-05).
  await page.goto(`/super/anuncios/campanhas/${state.spaceCampaignId}/pecas/nova`);
  await expect(page.getByText(/a peça pode ficar sem imagem/)).toBeVisible();
  await page.getByLabel('Título').fill(`Quadras ${RUN}`);
  await page.getByLabel('Botão').fill('Ver horários');
  await page.getByRole('button', { name: 'Criar peça' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(SPACE_CAMPAIGN) })).toBeVisible();
  await expect(page.getByTestId('creative-item')).toHaveCount(1);
  await expect(page.getByTestId('campaign-situation').first()).toHaveText('No ar');

  // 4) Entrega pública, sem login: a peça está no carrossel, com o selo do anunciante.
  const anon = await anonymous(playwright);
  const delivered = (await body(await anon.get('/v1/ads?placement=EXPLORE_HERO'))) as Json;
  const mine = delivered.items.find((item: Json) => item.campaignId === state.spaceCampaignId);
  expect(mine, 'peça da campanha na entrega pública').toBeDefined();
  expect(mine).toMatchObject({
    advertiser: { name: 'Arena E2E', kind: 'SPACE' },
    title: `Quadras ${RUN}`,
    imageUrl: null,
    destination: { type: 'SPACE', space: { slug: 'arena-e2e' } },
  });
  state.creativeToken = mine.deliveryToken;

  // 5) Relatório zerado (nada foi visto ainda).
  await page.goto(`/super/anuncios/campanhas/${state.spaceCampaignId}?aba=relatorio`);
  const totals = page.getByRole('region', { name: 'Totais' });
  await expect(totals).toBeVisible();
  await expect(totals.getByText('0', { exact: true }).first()).toBeVisible();
  await expect(totals.getByText('0,00%').or(totals.getByText('0%'))).toBeVisible();
});

test('impressão e clique reais aparecem no relatório e no CSV do Super', async ({
  page,
  playwright,
}) => {
  const anon = await anonymous(playwright);
  const sent = await anon.post('/v1/ads/events', {
    data: {
      events: [
        { token: state.creativeToken, type: 'IMPRESSION' },
        { token: state.creativeToken, type: 'CLICK' },
        // Reenvio do mesmo token não soma de novo.
        { token: state.creativeToken, type: 'IMPRESSION' },
      ],
    },
  });
  expect(sent.status()).toBe(202);
  expect(await body(sent)).toEqual({ accepted: 2 });

  await login(page, USERS.super, /\/super$/);
  await page.goto(`/super/anuncios/campanhas/${state.spaceCampaignId}?aba=relatorio`);
  const totals = page.getByRole('region', { name: 'Totais' });
  await expect(totals.getByText('1', { exact: true }).first()).toBeVisible();
  await expect(totals.getByText('100,00%').or(totals.getByText('100%'))).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^anuncio-.*\.csv$/);
  const { readFile } = await import('node:fs/promises');
  const csv = await readFile(await file.path(), 'utf8');
  expect(csv).toContain('dia,impressoes,cliques,ctr_percentual');
  expect(csv).toMatch(/total,1,1,"?100,00"?/);
});

test('o espaço já anunciante não pode ter um segundo anunciante ativo', async ({ playwright }) => {
  const superApi = await apiAs(playwright, USERS.super);
  const list = (await body(
    await superApi.get('/v1/super/ads/advertisers', { params: { q: 'Arena E2E' } }),
  )) as Json;
  const arena = list.items.find((item: Json) => item.name === 'Arena E2E' && item.kind === 'SPACE');
  expect(arena, JSON.stringify(list.items)).toBeDefined();
  const dup = await superApi.post('/v1/super/ads/advertisers', {
    data: {
      name: 'Arena E2E de novo',
      kind: 'SPACE',
      spaceId: arena.space.id,
      category: 'SPORTS_SPACE',
    },
  });
  expect(dup.status()).toBe(409);
});
