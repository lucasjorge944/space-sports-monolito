import { deflateSync } from 'node:zlib';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { loginAs, MOCK_API } from './helpers';

// Anúncios no /super (RF-ADS-01, 02, 03 e 09). A API simulada guarda o estado do Super em memória:
// os testes rodam em série e começam do zero.
test.describe.configure({ mode: 'serial' });

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const VERAO = ID(751);
const BLACK_FRIDAY = ID(752);
const LOJA_ANTIGA = ID(703);
const DESTAQUE_ESPACO = ID(753);

/** PNG de uma cor só, no tamanho pedido (para o recorte e a conferência do tamanho mínimo). */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([3, 84, 125], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function superCalls(request: APIRequestContext) {
  const response = await request.get(`${MOCK_API}/__super-calls`);
  return (await response.json()) as { path: string; body: Record<string, unknown> }[];
}

async function forceFailure(request: APIRequestContext, op: string, status: number, code: string) {
  await request.get(`${MOCK_API}/__super-ads-fail?op=${op}&status=${status}&code=${code}`);
}

const campaignRow = (page: Page, name: string) =>
  page.getByTestId('campaign-row').filter({ has: page.getByRole('link', { name, exact: true }) });

test.beforeEach(async ({ context, page, request }) => {
  await request.get(`${MOCK_API}/__super-reset`);
  await loginAs(context, 'super');
  // PUT direto ao storage (URL pré-assinada), fora da API.
  await page.route('http://storage.exemplo.test/**', (route) => route.fulfill({ status: 200 }));
});

test('menu Anúncios: campanhas com o selo de situação e filtros', async ({ page }) => {
  await page.goto('/super');
  await page.getByRole('link', { name: 'Anúncios' }).click();
  await expect(page.getByRole('heading', { name: 'Anúncios' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Campanhas' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  const situations: [string, string][] = [
    ['Verão Rede Quadra', 'No ar'],
    ['Black Friday', 'Agendada'],
    ['Destaque Espaço A', 'Pausada'],
    ['Inverno', 'Encerrada'],
    ['Lançamento sem peças', 'Sem peças'],
    ['Liquidação', 'Anunciante inativo'],
  ];
  for (const [name, situation] of situations) {
    await expect(campaignRow(page, name).getByTestId('campaign-situation')).toHaveText(situation);
  }

  await page.getByLabel('Vaga').selectOption({ label: 'Card na lista' });
  await expect(page.getByTestId('campaign-row')).toHaveCount(2);
  await expect(campaignRow(page, 'Verão Rede Quadra')).toHaveCount(0);
  await page.getByLabel('Vaga').selectOption('');

  await page.getByLabel('No ar agora').selectOption({ label: 'No ar agora' });
  await expect(page.getByTestId('campaign-row')).toHaveCount(1);
  await expect(campaignRow(page, 'Verão Rede Quadra')).toBeVisible();
  await page.getByLabel('No ar agora').selectOption('');

  await page
    .getByLabel('Anunciante', { exact: true })
    .selectOption({ label: 'Loja Antiga (inativo)' });
  await expect(page.getByTestId('campaign-row')).toHaveCount(1);
  await expect(campaignRow(page, 'Liquidação')).toBeVisible();
  await page.getByLabel('Anunciante', { exact: true }).selectOption('');

  await page.getByLabel('Status').selectOption({ label: 'Pausada' });
  await expect(page.getByTestId('campaign-row')).toHaveCount(1);
  await expect(campaignRow(page, 'Destaque Espaço A')).toBeVisible();
});

test('nº de campanhas do anunciante abre as campanhas filtradas; voltar e avançar trocam a aba', async ({
  page,
}) => {
  await page.goto('/super/anuncios');
  await page.getByRole('tab', { name: 'Anunciantes' }).click();
  await expect(page).toHaveURL(/\?aba=anunciantes$/);
  await page.getByRole('link', { name: /campanhas de Loja Antiga/ }).click();

  const campaignsTab = page.getByRole('tab', { name: 'Campanhas' });
  const advertisersTab = page.getByRole('tab', { name: 'Anunciantes' });
  await expect(page).toHaveURL(new RegExp(`\\?anunciante=${LOJA_ANTIGA}$`));
  await expect(campaignsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Anunciante', { exact: true })).toHaveValue(LOJA_ANTIGA);
  await expect(page.getByTestId('campaign-row')).toHaveCount(1);
  await expect(campaignRow(page, 'Liquidação')).toBeVisible();

  await page.goBack();
  await expect(advertisersTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: /campanhas de Loja Antiga/ })).toBeVisible();

  await page.goForward();
  await expect(campaignsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('campaign-row')).toHaveCount(1);
  await expect(campaignRow(page, 'Liquidação')).toBeVisible();

  // Tirar o filtro pelo seletor atualiza a URL e mostra todas as campanhas.
  await page.getByLabel('Anunciante', { exact: true }).selectOption('');
  await expect(page).toHaveURL(/\/super\/anuncios$/);
  await expect(page.getByTestId('campaign-row')).toHaveCount(6);

  // Trocar de aba pelo clique também entra no histórico.
  await advertisersTab.click();
  await expect(advertisersTab).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(campaignsTab).toHaveAttribute('aria-selected', 'true');
});

test('?anunciante= que não é UUID é ignorado, sem ir à API', async ({ page }) => {
  const filtered: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('advertiserId=')) filtered.push(req.url());
  });
  await page.goto('/super/anuncios?anunciante=nao-e-uuid');
  await expect(page.getByRole('tab', { name: 'Campanhas' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('campaign-row')).toHaveCount(6);
  await expect(page.getByLabel('Anunciante', { exact: true })).toHaveValue('');
  expect(filtered).toEqual([]);
});

test('cria anunciante empresa; a categoria não oferece bets nem álcool', async ({
  page,
  request,
}) => {
  await page.goto('/super/anuncios?aba=anunciantes');
  await expect(page.getByRole('cell', { name: 'Rede Quadra', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Novo anunciante' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo anunciante' });

  await dialog.getByRole('button', { name: 'Criar anunciante' }).click();
  await expect(dialog.getByText('Informe o nome do anunciante.')).toBeVisible();
  await expect(dialog.getByText('Escolha a categoria.')).toBeVisible();

  const categories = await dialog.getByLabel('Categoria').locator('option').allTextContents();
  expect(categories).toContain('Suplementos');
  expect(categories.join(' ')).not.toMatch(/apostas|bets|alcoólicas|cerveja/i);

  await dialog.getByLabel('Nome', { exact: true }).fill('Pulso Nutrition');
  await dialog.getByLabel('Categoria').selectOption({ label: 'Suplementos' });
  await dialog.getByLabel('E-mail (opcional)').fill('Comercial@Pulso.exemplo');
  await dialog.getByLabel('Telefone (opcional)').fill('31988887777');
  await dialog.getByLabel('Observações (opcional)').fill('Pacote de 3 meses.');
  await dialog.getByRole('button', { name: 'Criar anunciante' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('cell', { name: 'Pulso Nutrition', exact: true })).toBeVisible();
  const created = (await superCalls(request)).find((c) => c.path === '/v1/super/ads/advertisers');
  expect(created?.body).toEqual({
    kind: 'COMPANY',
    name: 'Pulso Nutrition',
    category: 'SUPPLEMENTS',
    contactName: null,
    contactEmail: 'comercial@pulso.exemplo',
    contactPhone: '+5531988887777',
    notes: 'Pacote de 3 meses.',
  });
});

test('recusa de categoria proibida (AD_CATEGORY_FORBIDDEN) aparece no campo', async ({
  page,
  request,
}) => {
  await forceFailure(request, 'advertiser-create', 422, 'AD_CATEGORY_FORBIDDEN');
  await page.goto('/super/anuncios?aba=anunciantes');
  await page.getByRole('button', { name: 'Novo anunciante' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo anunciante' });
  await dialog.getByLabel('Nome', { exact: true }).fill('Bebidas Gelo');
  await dialog.getByLabel('Categoria').selectOption({ label: 'Outros' });
  await dialog.getByRole('button', { name: 'Criar anunciante' }).click();

  await expect(
    dialog.getByText(
      'Apostas (bets) e bebidas alcoólicas não podem anunciar no Space Sports. Escolha outra categoria.',
    ),
  ).toBeVisible();
  await expect(dialog.getByLabel('Categoria')).toHaveAttribute('aria-invalid', 'true');
});

test('anunciante Espaço: escolhe o espaço; reativar com espaço suspenso explica o erro', async ({
  page,
  request,
}) => {
  await page.goto('/super/anuncios?aba=anunciantes');
  await page.getByRole('button', { name: 'Novo anunciante' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo anunciante' });
  await dialog.getByText(/^Espaço parceiro da plataforma/).click();
  await expect(dialog.getByRole('radio', { name: /Espaço/ })).toBeChecked();
  await dialog
    .getByLabel('Espaço anunciante')
    .selectOption({ label: 'Espaço Exemplo A · Belo Horizonte' });
  // O nome vem do espaço; a categoria, "Espaço esportivo".
  await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Espaço Exemplo A');
  await dialog.getByRole('button', { name: 'Criar anunciante' }).click();
  // O espaço já tem um anunciante ativo no mock.
  await expect(dialog.getByText(/Esse espaço já tem um anunciante ativo/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  await page.getByRole('button', { name: 'Reativar Espaço Exemplo B' }).click();
  const confirm = page.getByRole('dialog', { name: 'Reativar anunciante' });
  await confirm.getByRole('button', { name: 'Reativar' }).click();
  await expect(confirm.getByText(/não está ativo \(suspenso ou encerrado\)/)).toBeVisible();
  const calls = await superCalls(request);
  expect(calls.at(-1)).toMatchObject({
    path: `/v1/super/ads/advertisers/${ID(704)}`,
    body: { active: true },
  });
});

test('cria campanha com período em horário de Brasília enviado em UTC', async ({
  page,
  request,
}) => {
  await page.goto('/super/anuncios');
  await page.getByRole('link', { name: 'Nova campanha' }).click();
  await expect(page.getByRole('heading', { name: 'Nova campanha' })).toBeVisible();

  await page.getByRole('button', { name: 'Criar campanha' }).click();
  await expect(page.getByText('Escolha o anunciante.')).toBeVisible();
  await expect(page.getByText('Escolha a vaga.')).toBeVisible();

  await page
    .getByLabel('Anunciante', { exact: true })
    .selectOption({ label: 'Rede Quadra · Empresa' });
  await page.getByLabel('Nome da campanha').fill('Natal na areia');
  await expect(page.getByText(/Imagem 2:1, mínimo 960 × 480 px, até 2 MB/)).toBeVisible();
  await page.getByText('Card na lista', { exact: true }).click();
  await expect(page.getByRole('radio', { name: /Card na lista/ })).toBeChecked();
  await page.getByLabel('Data de início').fill('01/12/2026');
  await page.getByLabel('Hora de início').fill('08:00');
  await page.getByLabel('Data de fim').fill('31/12/2026');
  await page.getByLabel('Hora de fim').fill('23:59');
  await page.getByRole('button', { name: 'Belo Horizonte - MG' }).click();
  await page.getByLabel('Peso').selectOption('8');
  await page.getByLabel('Status').selectOption({ label: 'Ativa' });
  await page.getByRole('button', { name: 'Criar campanha' }).click();

  await expect(page.getByRole('heading', { name: /Natal na areia/ })).toBeVisible();
  await expect(
    page.getByText('Nenhuma peça. Sem peça ativa a campanha não vai ao ar.'),
  ).toBeVisible();
  const created = (await superCalls(request)).find((c) => c.path === '/v1/super/ads/campaigns');
  expect(created?.body).toMatchObject({
    advertiserId: ID(701),
    name: 'Natal na areia',
    placement: 'EXPLORE_FEED',
    startsAt: '2026-12-01T11:00:00.000Z',
    endsAt: '2027-01-01T02:59:00.000Z',
    weight: 8,
    status: 'ACTIVE',
    sportIds: [],
  });
  expect(created?.body.cityIds).toEqual([ID(401)]);
});

test('upload de peça com recorte e pré-visualização nos temas claro e escuro', async ({
  page,
  request,
}) => {
  await page.goto(`/super/anuncios/campanhas/${VERAO}`);
  await page.getByRole('link', { name: 'Nova peça' }).click();
  await expect(page.getByRole('heading', { name: 'Nova peça' })).toBeVisible();

  // Sem imagem, a prévia pede o formato da vaga.
  const preview = page.getByTestId('creative-preview');
  await expect(preview.getByText('Envie a imagem 2:1 (mín. 960 × 480)')).toBeVisible();

  // Imagem pequena demais para a vaga: o recorte não deixa enviar.
  await page.getByTestId('creative-image-input').setInputFiles({
    name: 'pequena.png',
    mimeType: 'image/png',
    buffer: png(600, 300),
  });
  const crop = page.getByRole('dialog', { name: 'Recortar imagem da peça' });
  await expect(crop.getByText(/a vaga pede no mínimo 960 × 480/)).toBeVisible();
  await expect(crop.getByRole('button', { name: 'Enviar imagem' })).toBeDisabled();
  await crop.getByRole('button', { name: 'Cancelar' }).click();

  await page.getByTestId('creative-image-input').setInputFiles({
    name: 'banner.png',
    mimeType: 'image/png',
    buffer: png(1500, 1000),
  });
  await expect(crop.getByText('Arquivo final: 1500 × 750 px.')).toBeVisible();
  await crop.getByRole('button', { name: 'Enviar imagem' }).click();
  await expect(crop).toBeHidden();
  await expect(page.getByTestId('creative-image')).toBeVisible();

  await page.getByLabel('Título').fill('Raquetes com até 30% off');
  await expect(page.getByText('24/40 caracteres')).toBeVisible();
  await page.getByLabel('Texto (opcional)').fill('Só nesta semana');
  await page.getByLabel('Botão').fill('Ver ofertas');
  await page.getByLabel('URL de destino').fill('http://redequadra.exemplo');
  await page.getByRole('button', { name: 'Criar peça' }).click();
  await expect(page.getByText(/Use uma URL que comece com https:\/\//).first()).toBeVisible();
  await page.getByLabel('URL de destino').fill('https://redequadra.exemplo/raquetes');

  // Prévia: claro e escuro, com o selo e os textos desenhados pelo app.
  const light = page.getByTestId('preview-light');
  await expect(light.getByText('Raquetes com até 30% off')).toBeVisible();
  await expect(light.getByTestId('sponsored-badge')).toHaveText(/Patrocinado\s·\sRede Quadra/);
  await expect(light.getByText('Ver ofertas')).toBeVisible();
  await expect(
    page.getByRole('figure', {
      name: 'Pré-visualização no app, tema claro. Patrocinado · Rede Quadra',
    }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Escuro' }).click();
  const dark = page.getByTestId('preview-dark');
  await expect(dark.getByText('Raquetes com até 30% off')).toBeVisible();
  await expect(dark.getByTestId('sponsored-badge')).toBeVisible();

  await page.getByRole('button', { name: 'Criar peça' }).click();
  await expect(page.getByRole('heading', { name: /Verão Rede Quadra/ })).toBeVisible();
  await expect(page.getByTestId('creative-item')).toHaveCount(3);

  const calls = await superCalls(request);
  const upload = calls.find((c) => c.path === '/v1/super/ads/creatives/uploads');
  expect(upload?.body).toMatchObject({ placement: 'EXPLORE_HERO', contentType: 'image/png' });
  const created = calls.find((c) => c.path === `/v1/super/ads/campaigns/${VERAO}/creatives`);
  expect(created?.body).toMatchObject({
    imageKey: expect.stringMatching(/^uploads\/ads\/EXPLORE_HERO\//),
    title: 'Raquetes com até 30% off',
    body: 'Só nesta semana',
    ctaLabel: 'Ver ofertas',
    destination: { type: 'URL', url: 'https://redequadra.exemplo/raquetes' },
    active: true,
  });
});

test('vaga mudou durante o envio (AD_PLACEMENT_CHANGED): pede a imagem de novo', async ({
  page,
  request,
}) => {
  await forceFailure(request, 'creative-save', 409, 'AD_PLACEMENT_CHANGED');
  await page.goto(`/super/anuncios/campanhas/${VERAO}/pecas/nova`);
  await page.getByTestId('creative-image-input').setInputFiles({
    name: 'banner.png',
    mimeType: 'image/png',
    buffer: png(1200, 600),
  });
  await page
    .getByRole('dialog', { name: 'Recortar imagem da peça' })
    .getByRole('button', { name: 'Enviar imagem' })
    .click();
  await expect(page.getByTestId('creative-image')).toBeVisible();
  await page.getByLabel('Título').fill('Peça nova');
  await page.getByLabel('Botão').fill('Ver');
  await page.getByLabel('URL de destino').fill('https://redequadra.exemplo');
  await page.getByRole('button', { name: 'Criar peça' }).click();

  await expect(
    page.getByRole('alert').filter({ hasText: /A vaga da campanha mudou.*Envie a imagem de novo/ }),
  ).toBeVisible();
  await expect(page.getByTestId('creative-image')).toHaveCount(0);
});

test('recorte que passa de 2 MB mesmo comprimido: mensagem própria e os controles continuam', async ({
  page,
}) => {
  // Simula um navegador que só consegue gerar arquivos de 3 MB a partir do recorte.
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type) {
      callback(new Blob([new Uint8Array(3 * 1024 * 1024)], { type: type ?? 'image/png' }));
    };
  });
  await page.goto(`/super/anuncios/campanhas/${VERAO}/pecas/nova`);
  await page.getByTestId('creative-image-input').setInputFiles({
    name: 'banner.png',
    mimeType: 'image/png',
    buffer: png(2400, 1200),
  });
  const crop = page.getByRole('dialog', { name: 'Recortar imagem da peça' });
  await crop.getByRole('button', { name: 'Enviar imagem' }).click();
  await expect(crop.getByRole('alert')).toHaveText(/passou de 2 MB mesmo comprimida/);
  await expect(crop.getByText('Não foi possível ler a imagem')).toHaveCount(0);
  await expect(crop.getByLabel('Zoom')).toBeEnabled();
  await expect(crop.getByRole('button', { name: 'Enviar imagem' })).toBeEnabled();

  // Mexer no recorte (ainda acima do mínimo da vaga) limpa a mensagem para tentar de novo.
  await crop.getByLabel('Zoom').fill('1.5');
  await expect(crop.getByText('Arquivo final: 1600 × 800 px.')).toBeVisible();
  await expect(crop.getByRole('alert')).toHaveCount(0);
});

test('anunciante Espaço publica sem imagem: a prévia mostra o card do espaço', async ({
  page,
  request,
}) => {
  await page.goto(`/super/anuncios/campanhas/${DESTAQUE_ESPACO}/pecas/nova`);
  await expect(page.getByText(/a peça pode ficar sem imagem/)).toBeVisible();
  await expect(page.getByLabel('Espaço de destino')).toHaveValue(ID(101));
  // O Espaço Exemplo A está fora da vitrine: o editor avisa que a peça não é entregue.
  await expect(
    page.getByRole('status').filter({ hasText: /fora da vitrine: a peça não é entregue/ }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId('preview-light')
      .getByText('O título e o texto não aparecem no card do espaço.'),
  ).toBeVisible();
  await expect(page.getByTestId('preview-light').getByTestId('sponsored-badge')).toHaveText(
    /Patrocinado\s·\sEspaço Exemplo A/,
  );

  await page.getByLabel('Título').fill('Quadras de areia em BH');
  await page.getByLabel('Botão').fill('Ver horários');
  await page.getByRole('button', { name: 'Criar peça' }).click();
  await expect(page.getByRole('heading', { name: /Destaque Espaço A/ })).toBeVisible();

  const created = (await superCalls(request)).find(
    (c) => c.path === `/v1/super/ads/campaigns/${DESTAQUE_ESPACO}/creatives`,
  );
  expect(created?.body).toEqual({
    title: 'Quadras de areia em BH',
    body: null,
    ctaLabel: 'Ver horários',
    destination: { type: 'SPACE', spaceId: ID(101) },
    active: true,
  });
});

test('pausa, ativa e arquiva a campanha pelo detalhe', async ({ page, request }) => {
  await page.goto(`/super/anuncios/campanhas/${BLACK_FRIDAY}`);
  const situation = page.getByTestId('campaign-situation').first();
  await expect(situation).toHaveText('Agendada');

  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  const pause = page.getByRole('dialog', { name: 'Pausar campanha' });
  await expect(pause.getByText(/sai do ar até ser ativada de novo/)).toBeVisible();
  await pause.getByRole('button', { name: 'Pausar' }).click();
  await expect(situation).toHaveText('Pausada');
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Ativar', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Ativar campanha' })
    .getByRole('button', { name: 'Ativar' })
    .click();
  await expect(situation).toHaveText('Agendada');

  await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
  const archive = page.getByRole('dialog', { name: 'Arquivar campanha' });
  await expect(archive.getByText(/Arquivar é definitivo/)).toBeVisible();
  await archive.getByRole('button', { name: 'Arquivar' }).click();
  await expect(situation).toHaveText('Arquivada');
  // Arquivada é final: sem botões de status nem edição.
  await expect(page.getByRole('button', { name: /^(Ativar|Pausar|Arquivar)$/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Editar', exact: true })).toHaveCount(0);

  const statuses = (await superCalls(request))
    .filter((c) => c.path === `/v1/super/ads/campaigns/${BLACK_FRIDAY}/status`)
    .map((c) => c.body);
  expect(statuses).toEqual([{ status: 'PAUSED' }, { status: 'ACTIVE' }, { status: 'ARCHIVED' }]);
});

test('desativar a única peça ativa tira a campanha do ar; reativar a devolve', async ({
  page,
  request,
}) => {
  await page.goto(`/super/anuncios/campanhas/${VERAO}`);
  const situation = page.getByTestId('campaign-situation').first();
  await expect(situation).toHaveText('No ar');
  const item = page.getByTestId('creative-item').filter({ hasText: 'Raquetes com 30% off' });
  await expect(item.getByText('Ativa', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Desativar Raquetes com 30% off' }).click();
  await expect(item.getByText('Inativa', { exact: true })).toBeVisible();
  await expect(situation).toHaveText('Sem peças');

  await page.getByRole('button', { name: 'Ativar Raquetes com 30% off' }).click();
  await expect(item.getByText('Ativa', { exact: true })).toBeVisible();
  await expect(situation).toHaveText('No ar');

  const patches = (await superCalls(request))
    .filter((c) => c.path === `/v1/super/ads/campaigns/${VERAO}/creatives/${ID(801)}`)
    .map((c) => c.body);
  expect(patches).toEqual([{ active: false }, { active: true }]);
});

test('ordena as peças e duplica a campanha', async ({ page, request }) => {
  await page.goto(`/super/anuncios/campanhas/${VERAO}`);
  await page.getByRole('button', { name: 'Subir Bolas de beach tennis' }).click();
  await expect(page.getByTestId('creative-item').first()).toContainText('Bolas de beach tennis');
  const order = (await superCalls(request)).find((c) => c.path.endsWith('/creatives/order'));
  expect(order?.body).toEqual({ creativeIds: [ID(802), ID(801)] });

  await page.getByRole('button', { name: 'Duplicar Verão Rede Quadra' }).click();
  await page
    .getByRole('dialog', { name: 'Duplicar campanha' })
    .getByRole('button', { name: 'Duplicar' })
    .click();
  await expect(page.getByRole('heading', { name: /Verão Rede Quadra \(cópia\)/ })).toBeVisible();
  await expect(page.getByTestId('campaign-situation').first()).toHaveText('Rascunho');
});

test('relatório: totais, tabela diária, período e exportação CSV', async ({ page }) => {
  await page.goto(`/super/anuncios/campanhas/${VERAO}?aba=relatorio`);
  const totals = page.getByRole('region', { name: 'Totais' });
  await expect(totals.getByText('3.300', { exact: true })).toBeVisible();
  await expect(totals.getByText('75', { exact: true })).toBeVisible();
  await expect(totals.getByText('2,27%')).toBeVisible();
  const daily = page.getByRole('table', { name: 'Relatório diário' });
  await expect(daily.getByRole('row')).toHaveCount(4);
  await expect(daily.getByRole('row', { name: /01\/10\/2026/ })).toContainText('1.000');

  await page.getByLabel('De', { exact: true }).fill('01/10/2026');
  await page.getByLabel('Até', { exact: true }).fill('05/10/2026');
  await expect(daily.getByRole('row')).toHaveCount(6);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('anuncio-verao-rede-quadra-2026-10-01_2026-10-05.csv');
  const path = await file.path();
  const { readFile } = await import('node:fs/promises');
  const csv = await readFile(path, 'utf8');
  expect(csv).toContain('dia,impressoes,cliques,ctr_percentual');
  expect(csv).toContain('05/10/2026,1400,40');
});
