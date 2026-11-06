import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAs, mockCalls } from './helpers';

// Avaliações de espaços (AV.3; RF-REVIEW-03 a 07). Dados em e2e/mock-reviews.mjs: a Arena Exemplo
// tem 23 avaliações visíveis (resumo), a Quadra Nova tem 2 ("Novo").
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SPACE_A = ID(101);

async function jsonLd(page: Page) {
  const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
  return JSON.parse(raw ?? '{}') as Record<string, unknown>;
}

test.describe('página pública (RF-REVIEW-03 e 04)', () => {
  test('com 5 ou mais avaliações: resumo, recentes e JSON-LD com AggregateRating', async ({
    page,
  }) => {
    await page.goto('/espacos/arena-exemplo');
    const block = page.getByTestId('espaco-avaliacoes');
    await expect(block.getByRole('heading', { name: 'Avaliações' })).toBeVisible();
    await expect(block.getByRole('group', { name: 'Nota 4,5 de 5, 23 avaliações' })).toBeVisible();
    await expect(block.getByRole('list', { name: 'Distribuição das notas' })).toContainText('16');
    await expect(block.getByText('Mais citados')).toBeVisible();
    await expect(page.getByTestId('espaco-nota')).toHaveAttribute('href', '#avaliacoes');
    // O cabeçalho segue o resumo do bloco, mesmo com o `rating` do cadastro atrasado no mock.
    await expect(page.getByTestId('espaco-nota')).toContainText('4,5');
    await expect(page.getByTestId('espaco-nota')).toContainText('23 avaliações');

    // Os 3 comentários visíveis mais recentes; o oculto e os só com nota ficam de fora.
    const items = block.locator('article');
    await expect(items).toHaveCount(3);
    await expect(items.first()).toContainText('Ana S.');
    await expect(items.first()).toContainText('A quadra estava ótima');
    await expect(block.getByText('Texto ofensivo de exemplo')).toHaveCount(0);
    // Editada depois da resposta do espaço.
    const bruno = block.getByTestId(`avaliacao-item-${ID(1002)}`);
    await expect(bruno).toContainText('editada');
    await expect(bruno.getByRole('group', { name: 'Resposta do Arena Exemplo' })).toContainText(
      'Valeu, Bruno!',
    );

    await expect(block.getByRole('link', { name: 'pelo app' })).toHaveAttribute(
      'href',
      'spacesports://espacos/arena-exemplo/avaliar',
    );
    await expect(block.getByTestId('espaco-avaliacoes-ver-todas')).toHaveAttribute(
      'href',
      '/espacos/arena-exemplo/avaliacoes',
    );
    // Sem sessão no web: sem o menu "Denunciar".
    await expect(block.getByRole('button', { name: /Mais opções da avaliação/ })).toHaveCount(0);

    const ld = await jsonLd(page);
    expect(ld.aggregateRating).toMatchObject({
      '@type': 'AggregateRating',
      ratingValue: 4.5,
      reviewCount: 23,
    });
    expect(Array.isArray(ld.review) && ld.review.length).toBe(3);
  });

  test('com menos de 5: selo "Novo", sem resumo e sem AggregateRating', async ({ page }) => {
    await page.goto('/espacos/quadra-nova');
    const block = page.getByTestId('espaco-avaliacoes');
    await expect(block.getByTestId('avaliacoes-resumo-novo')).toContainText(
      'Ainda poucas avaliações',
    );
    await expect(block.getByTestId('avaliacoes-resumo')).toHaveCount(0);
    await expect(page.getByTestId('espaco-nota')).toContainText('Novo');
    await expect(block.locator('article')).toHaveCount(1);
    await expect(block.getByTestId('espaco-avaliacoes-ver-todas')).toContainText(
      'Ver todas as 2 avaliações',
    );

    const ld = await jsonLd(page);
    expect(ld['@type']).toBe('SportsActivityLocation');
    expect(ld.aggregateRating).toBeUndefined();
    expect(ld.review).toBeUndefined();
  });

  test('"Ver todas": filtro por nota, paginação e página com cursor fora do índice', async ({
    page,
  }) => {
    await page.goto('/espacos/arena-exemplo/avaliacoes');
    await expect(page.getByRole('heading', { name: 'Avaliações de Arena Exemplo' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute('content', /noindex/);
    const list = page.getByTestId('avaliacoes-lista');
    await expect(list.locator('article')).toHaveCount(20);
    // O oculto aparece na lista completa, só com a nota e o aviso.
    await expect(list.getByTestId(`avaliacao-item-${ID(1003)}`)).toContainText(
      'Comentário oculto pela moderação.',
    );
    await expect(list.getByTestId(`avaliacao-item-${ID(1004)}`)).toContainText('Usuário removido');

    // Com JS, "Carregar mais" acrescenta a página seguinte sem sair da URL.
    await page.getByRole('link', { name: 'Carregar mais avaliações' }).click();
    await expect(list.locator('article')).toHaveCount(23);
    await expect(page).toHaveURL(/\/avaliacoes$/);
    await expect(page.getByText('3 avaliações carregadas')).toBeAttached();
    await expect(page.getByRole('link', { name: 'Carregar mais avaliações' })).toHaveCount(0);

    // Filtro por link (funciona sem JS): só as de 2 estrelas.
    await page.getByTestId('avaliacoes-filtro-2').click();
    await expect(page).toHaveURL(/\?nota=2$/);
    await expect(page.getByTestId('avaliacoes-filtro-2')).toHaveAttribute('aria-current', 'true');
    await expect(list.locator('article')).toHaveCount(1);
    await expect(list).toContainText('Achei caro pelo que oferece.');
    // Nota sem avaliações fica desabilitada (sem link).
    await expect(page.getByTestId('avaliacoes-filtro-3')).toHaveCount(0);

    // A página do cursor (sem JS) não é indexada e mostra o caminho de volta.
    await page.goto('/espacos/arena-exemplo/avaliacoes?cursor=c20');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /follow/);
    await expect(page.getByTestId('avaliacoes-lista').locator('article')).toHaveCount(3);
    await expect(page.getByRole('link', { name: 'Voltar ao começo' })).toHaveAttribute(
      'href',
      '/espacos/arena-exemplo/avaliacoes',
    );
  });

  test('segundo clique em "Carregar mais" durante o carregamento não sai da página', async ({
    page,
  }) => {
    // Segura a página seguinte (busca feita pelo browser) para o segundo clique cair no carregamento.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/v1\/spaces\/[^/]+\/reviews\?.*cursor=/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto('/espacos/arena-exemplo/avaliacoes');
    const list = page.getByTestId('avaliacoes-lista');
    await expect(list.locator('article')).toHaveCount(20);
    const more = page.getByRole('link', { name: 'Carregar mais avaliações' });
    await more.click();
    await expect(more).toHaveAttribute('aria-disabled', 'true');
    // `force`: o link está com aria-disabled, mas a pessoa ainda consegue clicar nele.
    await more.click({ force: true });
    release();
    await expect(list.locator('article')).toHaveCount(23);
    await expect(page).toHaveURL(/\/avaliacoes$/);
  });

  test('página com cursor além do fim diz que não há mais avaliações', async ({ page }) => {
    await page.goto('/espacos/arena-exemplo/avaliacoes?cursor=c40');
    const empty = page.getByTestId('avaliacoes-vazio');
    await expect(empty).toContainText('Não há mais avaliações');
    await expect(empty).not.toContainText('Ninguém avaliou ainda');
    await empty.getByRole('link', { name: 'Ir para a primeira página' }).click();
    await expect(page).toHaveURL(/\/espacos\/arena-exemplo\/avaliacoes$/);
    await expect(page.getByTestId('avaliacoes-lista').locator('article')).toHaveCount(20);
  });

  test('com sessão no web, denuncia uma avaliação (estado local "Denúncia enviada")', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/espacos/arena-exemplo');
    const item = page.getByTestId(`avaliacao-item-${ID(1001)}`);
    await item.getByRole('button', { name: 'Mais opções da avaliação de Ana S.' }).click();
    await page.getByRole('menuitem', { name: 'Denunciar avaliação' }).click();

    const dialog = page.getByRole('dialog', { name: 'Denunciar avaliação' });
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
    await expect(dialog.getByText('Escolha um motivo')).toBeVisible();
    await dialog.getByTestId('denuncia-motivo-OTHER').check();
    await expect(dialog.getByText('Conte o que há de errado')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Detalhes' }).fill('  Não aconteceu assim.  ');
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();

    await expect(page.getByText('Denúncia enviada. Obrigado por avisar.')).toBeVisible();
    await expect(dialog).toBeHidden();
    await item.getByRole('button', { name: 'Mais opções da avaliação de Ana S.' }).click();
    await expect(page.getByRole('menuitem', { name: 'Denúncia enviada' })).toBeDisabled();

    const call = (await mockCalls(request)).find(
      (c) => c.path === `POST /v1/reviews/${ID(1001)}/reports`,
    );
    expect(call?.body).toEqual({ reason: 'OTHER', details: 'Não aconteceu assim.' });
  });

  test('denúncia repetida (409) avisa e marca o item como enviado', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/espacos/arena-exemplo');
    const item = page.getByTestId(`avaliacao-item-${ID(1005)}`);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt === 1) await page.reload();
      await item.getByRole('button', { name: /Mais opções da avaliação/ }).click();
      await page.getByRole('menuitem', { name: 'Denunciar avaliação' }).click();
      const dialog = page.getByRole('dialog', { name: 'Denunciar avaliação' });
      await dialog.getByTestId('denuncia-motivo-SPAM').check();
      await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
      await expect(dialog).toBeHidden();
    }
    await expect(page.getByText('Você já denunciou esta avaliação.')).toBeVisible();
    await item.getByRole('button', { name: /Mais opções da avaliação/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Denúncia enviada' })).toBeDisabled();
  });
});

test.describe('painel /painel/avaliacoes (RF-REVIEW-06)', () => {
  test('espaço fora da vitrine com 2 avaliações: o apoio diz que o público não vê', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'outside');
    await page.goto('/painel/avaliacoes');
    await expect(page.getByRole('heading', { name: 'Avaliações', level: 1 })).toBeVisible();
    // Com 5 o público continuaria sem ver a nota: nada de "faltam N".
    await expect(page.getByTestId('avaliacoes-media')).toContainText('3,5');
    await expect(page.getByTestId('avaliacoes-media')).toContainText(
      'Não aparece no app nem no site: espaço fora da vitrine',
    );
    await expect(page.getByTestId('avaliacoes-media')).not.toContainText('faltam');
    await expect(page.getByTestId('avaliacoes-total')).toContainText('2');
    await expect(page.getByText('Boa quadra, pena que fechou.')).toBeVisible();
  });

  test('Dono vê os indicadores, responde, edita e remove a resposta', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/avaliacoes');
    await expect(page.getByRole('heading', { name: 'Avaliações', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Avaliações' })).toBeVisible();
    await expect(page.getByTestId('avaliacoes-media')).toContainText('4,5');
    await expect(page.getByTestId('avaliacoes-media')).toContainText('Aparece no app e no site');
    await expect(page.getByTestId('avaliacoes-total')).toContainText('23');
    await expect(
      page.getByRole('img', { name: /Média semanal dos últimos 90 dias/ }),
    ).toBeVisible();
    // Uma coluna por ponto que a API mandar (13 semanas no mock).
    await expect(page.getByTestId('avaliacoes-tendencia').locator('span')).toHaveCount(13);
    // Total e média dos 90 dias vêm prontos da API (`trend.count`/`trend.average`): 22 das 23.
    await expect(page.getByTestId('avaliacoes-90-dias')).toContainText('22 avaliações · geral 4,5');
    // Destaques: até 5 por grupo, na ordem da API, com a contagem.
    const elogios = page.getByTestId('destaques-elogios').getByRole('listitem');
    await expect(elogios).toHaveCount(5);
    await expect(elogios.first()).toHaveText(/Limpo\s*6/);
    await expect(elogios.nth(1)).toHaveText(/Quadra boa\s*2/);
    // O sexto elogio (empate, último no catálogo) não vem da API.
    await expect(page.getByTestId('destaques-elogios')).not.toContainText('Horário respeitado');
    const criticas = page.getByTestId('destaques-criticas').getByRole('listitem');
    await expect(criticas).toHaveCount(2);
    await expect(criticas.first()).toHaveText(/Sujo\s*1/);
    await expect(criticas.nth(1)).toHaveText(/Caro\s*1/);

    const ana = page.getByTestId(`avaliacao-item-${ID(1001)}`);
    await ana.getByTestId(`painel-avaliacoes-responder-${ID(1001)}`).click();
    const field = ana.getByLabel('Responder como Espaço Exemplo A');
    await expect(field).toBeFocused();
    await ana.getByRole('button', { name: 'Publicar resposta' }).click();
    await expect(ana.getByText('Escreva a resposta')).toBeVisible();
    await field.fill('Obrigado pela visita, Ana!');
    await expect(ana.getByText('26/500')).toBeVisible();
    await ana.getByRole('button', { name: 'Publicar resposta' }).click();
    await expect(page.getByText('Resposta publicada')).toBeVisible();
    await expect(ana.getByRole('group', { name: 'Resposta do Espaço Exemplo A' })).toContainText(
      'Obrigado pela visita, Ana!',
    );

    await ana.getByRole('button', { name: 'Editar resposta' }).click();
    await ana.getByLabel('Responder como Espaço Exemplo A').fill('Valeu, Ana!');
    await ana.getByRole('button', { name: 'Salvar resposta' }).click();
    await expect(page.getByText('Resposta atualizada')).toBeVisible();
    await expect(ana).toContainText('Valeu, Ana!');

    await ana.getByRole('button', { name: 'Remover resposta' }).click();
    const confirm = page.getByRole('dialog', { name: 'Remover a resposta?' });
    await confirm.getByRole('button', { name: 'Remover' }).click();
    await expect(page.getByText('Resposta removida')).toBeVisible();
    await expect(ana.getByTestId(`painel-avaliacoes-responder-${ID(1001)}`)).toBeVisible();

    const calls = (await mockCalls(request)).filter((c) => c.path.includes('/reply'));
    expect(calls.map((c) => c.path.split(' ')[0])).toEqual(['PUT', 'PUT', 'DELETE']);
    expect(calls[0]?.body).toEqual({ body: 'Obrigado pela visita, Ana!' });
  });

  test('filtros por nota e "sem resposta" ficam na URL', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/avaliacoes');
    await page
      .getByTestId('avaliacoes-total')
      .getByRole('button', { name: '22 sem resposta' })
      .click();
    await expect(page).toHaveURL(/sem-resposta=1/);
    await expect(
      page.getByRole('button', { name: 'Sem resposta', exact: true, pressed: true }),
    ).toBeVisible();
    await expect(page.getByTestId('avaliacoes-contagem')).toHaveText('22 avaliações');
    await expect(page.getByTestId(`avaliacao-item-${ID(1002)}`)).toHaveCount(0);

    await page.getByRole('button', { name: 'Sem resposta', exact: true }).click();
    // Duas mudanças seguidas: a segunda não pode desfazer a primeira.
    await page.getByLabel('Nota', { exact: true }).selectOption('2');
    await expect(page).not.toHaveURL(/sem-resposta/);
    await expect(page).toHaveURL(/nota=2/);
    await expect(page.getByTestId('avaliacoes-contagem')).toHaveText('1 avaliação');
    await expect(page.locator('article')).toHaveCount(1);

    await page.getByLabel('Nota', { exact: true }).selectOption('3');
    await expect(page.getByText('Nenhuma avaliação com esses filtros')).toBeVisible();
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(page).toHaveURL(/\/painel\/avaliacoes$/);
  });

  test('Professor só lê: sem responder, editar, remover nem denunciar', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'teacher');
    await page.goto('/painel/avaliacoes');
    await expect(
      page.getByText('Você vê as avaliações do espaço. Só o Dono e os Administradores respondem.'),
    ).toBeVisible();
    await expect(page.getByTestId(`avaliacao-item-${ID(1001)}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Responder' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Editar resposta' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remover resposta' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Mais opções da avaliação/ })).toHaveCount(0);
    // A resposta existente continua visível para leitura.
    await expect(
      page.getByTestId(`avaliacao-item-${ID(1002)}`).getByRole('group', { name: /Resposta do/ }),
    ).toBeVisible();
  });

  test('Admin denuncia pelo painel', async ({ page, context, request }) => {
    await loginAs(context, 'admin');
    await page.goto('/painel/avaliacoes');
    const dani = page.getByTestId(`avaliacao-item-${ID(1005)}`);
    await dani.getByRole('button', { name: 'Mais opções da avaliação de Dani R.' }).click();
    await page.getByRole('menuitem', { name: 'Denunciar avaliação' }).click();
    const dialog = page.getByRole('dialog', { name: 'Denunciar avaliação' });
    await expect(dialog).toContainText('O espaço não apaga avaliações.');
    await dialog.getByTestId('denuncia-motivo-FALSE_INFO').check();
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
    await expect(page.getByText('Denúncia enviada. Obrigado por avisar.')).toBeVisible();
    await dani.getByRole('button', { name: /Mais opções da avaliação/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Denúncia enviada' })).toBeDisabled();
    const call = (await mockCalls(request)).find((c) => c.path.endsWith(`${ID(1005)}/reports`));
    expect(call?.path).toBe(`POST /v1/manage/spaces/${SPACE_A}/reviews/${ID(1005)}/reports`);
    expect(call?.body).toEqual({ reason: 'FALSE_INFO', details: null });
  });
});

test.describe('Super: moderação (RF-REVIEW-07)', () => {
  test('fila de denúncias, ocultar e reexibir o comentário com motivo', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'super');
    await page.goto('/super/avaliacoes');
    await expect(page.getByRole('tab', { name: 'Abertas', selected: true })).toBeVisible();
    const rows = page.getByRole('row');
    await expect(rows).toHaveCount(3); // cabeçalho + 2 abertas
    await expect(page.getByTestId(`denuncia-${ID(3002)}`)).toContainText(
      'Autor bloqueado · fora da média',
    );
    await expect(page.getByTestId(`denuncia-${ID(3002)}`)).toContainText('Espaço · Arena Exemplo');

    await page
      .getByTestId(`denuncia-${ID(3001)}`)
      .getByText('Achei caro pelo que oferece.')
      .click();
    await expect(page).toHaveURL(new RegExp(`/super/avaliacoes/${ID(1005)}$`));
    await expect(page.getByRole('link', { name: 'Dani Rocha' })).toHaveAttribute(
      'href',
      `/super/usuarios/${ID(2005)}`,
    );

    await page.getByTestId('super-avaliacao-ocultar').click();
    const hide = page.getByRole('dialog', { name: 'Ocultar o comentário?' });
    await hide.getByRole('button', { name: 'Ocultar comentário' }).click();
    await expect(hide.getByText('Escreva o motivo')).toBeVisible();
    await hide.getByLabel('Motivo').fill('Ataque pessoal');
    await hide.getByRole('button', { name: 'Ocultar comentário' }).click();
    await expect(page.getByText('Comentário ocultado')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reexibir comentário' })).toBeVisible();
    await expect(page.getByTestId('historico-moderacao')).toContainText('Ocultado por Super Admin');
    await expect(page.getByTestId(`denuncia-${ID(3001)}`)).toContainText('Resolvida');

    await page.getByRole('button', { name: 'Reexibir comentário' }).click();
    const unhide = page.getByRole('dialog', { name: 'Reexibir o comentário?' });
    await unhide.getByLabel('Motivo').fill('Revisado');
    await unhide.getByRole('button', { name: 'Reexibir comentário' }).click();
    await expect(page.getByText('Comentário reexibido')).toBeVisible();
    await expect(page.getByTestId('super-avaliacao-ocultar')).toBeVisible();

    const calls = (await mockCalls(request)).filter((c) => /\/(hide|unhide)$/.test(c.path));
    expect(calls).toEqual([
      { path: `POST /v1/super/reviews/${ID(1005)}/hide`, body: { reason: 'Ataque pessoal' } },
      { path: `POST /v1/super/reviews/${ID(1005)}/unhide`, body: { reason: 'Revisado' } },
    ]);
  });

  test('descarta uma denúncia com motivo e vê as avaliações por espaço', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'super');
    await page.goto(`/super/avaliacoes/${ID(1024)}`);
    await expect(page.getByTestId('selo-autor-bloqueado')).toBeVisible();
    const report = page.getByTestId(`denuncia-${ID(3002)}`);
    await report.getByRole('button', { name: 'Descartar' }).click();
    const dismiss = page.getByRole('dialog', { name: 'Descartar esta denúncia?' });
    // Motivo opcional (RN-REVIEW-04).
    await expect(dismiss.getByLabel(/Motivo/)).toBeVisible();
    await dismiss.getByLabel(/Motivo/).fill('Não é spam');
    await dismiss.getByRole('button', { name: 'Descartar' }).click();
    await expect(page.getByText('Denúncia descartada', { exact: true })).toBeVisible();
    await expect(report).toContainText('Descartada');
    await expect(report).toContainText('Motivo: Não é spam');
    await expect(page.getByTestId('historico-moderacao')).toContainText(
      'Denúncia descartada por Super Admin',
    );
    await expect(page.getByTestId('historico-moderacao')).toContainText('Motivo: Não é spam');
    const dismissCalls = (await mockCalls(request)).filter((c) => c.path.endsWith('/dismiss'));
    expect(dismissCalls).toEqual([
      {
        path: `POST /v1/super/reviews/reports/${ID(3002)}/dismiss`,
        body: { reason: 'Não é spam' },
      },
    ]);

    await page.goto(`/super/espacos/${SPACE_A}`);
    // O link mostra a nota e o total (`rating` do `superGetSpace`).
    const link = page.getByRole('link', { name: 'Avaliações, nota 4,5 de 5, 23 avaliações' });
    await expect(link).toContainText('4,5 (23)');
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/super/espacos/${SPACE_A}/avaliacoes$`));
    // Indicadores do resumo do Super: a média e quantas estão fora dela (autor bloqueado). No mock
    // do Super o Espaço A está fora da vitrine (quadra inativa): o apoio diz isso, não "aparece".
    await expect(page.getByTestId('super-avaliacoes-media')).toContainText('4,5');
    await expect(page.getByTestId('super-avaliacoes-media')).toContainText(
      'Não aparece no app nem no site: espaço fora da vitrine',
    );
    await expect(page.getByTestId('super-avaliacoes-total')).toContainText('23');
    await expect(page.getByTestId('super-avaliacoes-total')).toContainText(
      '1 avaliação fora da média (autor bloqueado)',
    );
    await expect(page.getByTestId('destaques-elogios').getByRole('listitem')).toHaveCount(5);
    await page.getByRole('button', { name: 'Com comentário oculto' }).click();
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.getByTestId(`avaliacao-item-${ID(1003)}`)).toContainText(
      'Texto ofensivo de exemplo.',
    );
    await page.getByRole('link', { name: 'Moderar' }).click();
    await expect(page).toHaveURL(new RegExp(`/super/avaliacoes/${ID(1003)}$`));
  });

  test('espaço na vitrine com 5 avaliações: o público já vê a média', async ({ page, context }) => {
    await loginAs(context, 'super');
    // Espaço D (na vitrine): exatamente 5 avaliações.
    await page.goto(`/super/espacos/${ID(105)}`);
    const link = page.getByRole('link', { name: 'Avaliações, nota 4,4 de 5, 5 avaliações' });
    await expect(link).toContainText('4,4 (5)');
    await link.click();
    await expect(page.getByTestId('super-avaliacoes-media')).toContainText('4,4');
    await expect(page.getByTestId('super-avaliacoes-media')).toContainText(
      'Aparece no app e no site',
    );
    await expect(page.getByTestId('super-avaliacoes-total')).toContainText('5');
  });

  test('espaço fora da vitrine: o resumo do Super aparece mesmo assim', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'super');
    // Espaço B (suspenso, sem avaliações): o resumo público responderia 404. Sem avaliações, o
    // link é só "Avaliações", sem "(0)".
    await page.goto(`/super/espacos/${ID(102)}`);
    const link = page.getByTestId('super-espaco-avaliacoes');
    await expect(link).toHaveText('Avaliações');
    await expect(link).toHaveAccessibleName('Avaliações do espaço');
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/super/espacos/${ID(102)}/avaliacoes$`));
    await expect(page.getByTestId('super-avaliacoes-media')).toContainText('—');
    // Fora da vitrine vem antes de "Ainda sem avaliações".
    await expect(page.getByTestId('super-avaliacoes-media')).toContainText(
      'Não aparece no app nem no site: espaço fora da vitrine',
    );
    await expect(page.getByTestId('super-avaliacoes-total')).toContainText('Nenhuma fora da média');
    await expect(page.getByText('Nenhum destaque escolhido ainda')).toBeVisible();
  });

  test('espaço fora da vitrine com menos de 5 avaliações: não promete aparecer com 5', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'super');
    // Espaço C (ativo, sem preço/hora): 2 avaliações. Com 5 o público continuaria sem ver a nota.
    await page.goto(`/super/espacos/${ID(104)}`);
    const link = page.getByRole('link', { name: 'Avaliações, 2 avaliações' });
    await expect(link).toContainText('(2)');
    await link.click();
    await expect(page.getByTestId('super-avaliacoes-media')).toContainText('3,5');
    await expect(page.getByTestId('super-avaliacoes-media')).toContainText(
      'Não aparece no app nem no site: espaço fora da vitrine',
    );
    await expect(page.getByTestId('super-avaliacoes-media')).not.toContainText('faltam');
    await expect(page.getByTestId('super-avaliacoes-total')).toContainText('2');
    await expect(page.locator('article')).toHaveCount(2);
    await expect(page.getByText('Boa quadra, pena que fechou.')).toBeVisible();
  });
});
