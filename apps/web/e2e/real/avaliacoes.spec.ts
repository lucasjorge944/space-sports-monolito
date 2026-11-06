import { expect, type Page, test } from '@playwright/test';
import { anonymous, apiAs, body, disposeClients, errorOf, type Json, login } from './support/api';
import { USERS } from './support/env';

// Avaliações de espaços contra a API REAL (AV.5; RF-REVIEW-03 a 07 e 09, RN-REVIEW-03, 04 e 05).
// Complementa e2e/avaliacoes.spec.ts (API simulada) com o que só o servidor prova: a página pública
// renderizada no servidor com os dados do seed, o JSON-LD, a resposta do Dono que vira pública, o
// Professor sem poder de escrita (na tela e na API) e a moderação do Super que esconde o texto sem
// tirar a nota da média.
//
// Dados: seed de teste (apps/api/test/e2e-seed/seed.ts). A Arena E2E tem 6 avaliações (soma 25,
// média 4,2): Mariana D. (5, 2 dias, comentário), Rafael N. (4, resposta do Dono), Camila R. (5, só
// nota), Diego F. (2, comentário oculto pelo Super), Larissa T. (5, "Aluno", comentário) e Felipe A.
// (4, só nota). A Arena E2E Norte tem 2 ("Novo"). Cada teste devolve o que mudou.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const SLUG = 'arena-e2e';
const NORTH_SLUG = 'arena-e2e-norte';
const SPACE_NAME = 'Arena E2E';
const HIDDEN_SEED_TEXT = 'Comentário ofensivo de exemplo, oculto pela moderação.';
const SEED_REPLY = 'Obrigado pela visita! Já trocamos a rede da quadra 2.';
const MARIANA_EMAIL = 'avaliador1.e2e@exemplo.com';

type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  commentHidden: boolean;
  author: { name: string };
  reply: { body: string } | null;
};

const state = {} as {
  spaceId: string;
  northId: string;
  mariana: string;
  larissa: string;
  diego: string;
};

test.beforeAll(async ({ playwright }) => {
  const anon = await anonymous(playwright);
  state.spaceId = (await body(await anon.get(`/v1/spaces/${SLUG}`))).id;
  state.northId = (await body(await anon.get(`/v1/spaces/${NORTH_SLUG}`))).id;
  const list = await body(await anon.get(`/v1/spaces/${state.spaceId}/reviews?limit=50`));
  const byAuthor = (name: string) => {
    const found = (list.items as PublicReview[]).find((item) => item.author.name === name);
    if (!found) throw new Error(`Avaliação de ${name} não está no seed.`);
    return found.id;
  };
  state.mariana = byAuthor('Mariana D.');
  state.larissa = byAuthor('Larissa T.');
  state.diego = byAuthor('Diego F.');
});
test.afterAll(disposeClients);

async function publicSummary(playwright: Parameters<typeof anonymous>[0]) {
  const anon = await anonymous(playwright);
  return body(await anon.get(`/v1/spaces/${state.spaceId}/reviews/summary`));
}

async function jsonLd(page: Page): Promise<Json> {
  const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
  return JSON.parse(raw ?? '{}') as Json;
}

/**
 * Item da lista pública pelo nome do autor ("Mariana D."). Na página pública não se usa o id da
 * avaliação: o servidor guarda o cache entre execuções e, depois de um novo seed, o primeiro render
 * ainda pode trazer os ids do seed anterior (o texto é o mesmo).
 */
const publicItem = (scope: Page, author: string) =>
  scope.getByTestId(/^avaliacao-item-/).filter({ hasText: author });

/**
 * A página pública é renderizada no servidor com cache de 60 s nas avaliações e de 5 min no cadastro
 * do espaço (docs/05, "Sessão na página pública"): uma resposta ou uma moderação chega à API na
 * hora, mas à página só depois da revalidação. Recarrega até a checagem passar (no máximo ~100 s).
 */
const REVALIDATION_MS = 100_000;
async function expectPublicPage(page: Page, url: string, check: () => Promise<void>) {
  await expect(async () => {
    await page.goto(url);
    await check();
  }).toPass({ timeout: REVALIDATION_MS, intervals: [3_000] });
}

// ---------------------------------------------------------------------------------------------
test('seed: o jogador.e2e tem reserva passada elegível e nenhuma avaliação (fluxo Maestro de avaliar)', async ({
  playwright,
}) => {
  const player = await apiAs(playwright, USERS.player);
  // O que `.maestro/scripts/past-booking.js` procura: reserva passada, confirmada ou concluída.
  const past = await body(await player.get('/v1/bookings?when=past&limit=50'));
  const found = (past.items as Json[]).find(
    (booking) =>
      booking.space.slug === SLUG && ['CONFIRMED', 'COMPLETED'].includes(booking.status as string),
  );
  expect(found, 'reserva passada do jogador.e2e na Arena E2E').toBeDefined();
  expect(new Date(found?.endsAt).getTime()).toBeLessThan(Date.now());
  expect(Date.now() - new Date(found?.endsAt).getTime()).toBeLessThan(180 * 86_400_000);

  // A API concorda: pode avaliar, ainda sem avaliação.
  const eligibility = await body(
    await player.get(`/v1/spaces/${state.spaceId}/reviews/eligibility`),
  );
  expect(eligibility).toMatchObject({
    canReview: true,
    canEdit: false,
    reason: null,
    myReview: null,
  });
  // Os demais jogadores de teste não avaliam por padrão.
  const north = await body(await player.get(`/v1/spaces/${state.northId}/reviews/eligibility`));
  expect(north).toMatchObject({ canReview: false, reason: 'REVIEW_NOT_ELIGIBLE' });
});

test('página pública (RF-REVIEW-03/05): resumo, distribuição, recentes e JSON-LD, sem texto oculto nem dados internos', async ({
  page,
  playwright,
}) => {
  // Quem é o autor real, para provar que nada dele vai na página (o Super enxerga).
  const superApi = await apiAs(playwright, USERS.super);
  const detail = await body(await superApi.get(`/v1/super/reviews/${state.mariana}`));
  const marianaUserId = detail.author.userId as string;

  // O cache do servidor pode vir de uma execução anterior: espera a página refletir o seed.
  await expectPublicPage(page, `/espacos/${SLUG}`, async () => {
    const block = page.getByTestId('espaco-avaliacoes');
    await expect(block.getByRole('heading', { name: 'Avaliações' })).toBeVisible();
    await expect(block.getByRole('group', { name: 'Nota 4,2 de 5, 6 avaliações' })).toBeVisible();
    const distribution = block.getByRole('list', { name: 'Distribuição das notas' });
    await expect(distribution).toBeVisible();
    await expect(block.getByText('Mais citados')).toBeVisible();
    await expect(page.getByTestId('espaco-nota')).toContainText('6 avaliações');

    // Os 3 comentários visíveis mais recentes: Mariana, Rafael e Larissa. O oculto, o do Diego, e os
    // sem comentário ficam de fora.
    const items = block.locator('article');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('Mariana D.');
    await expect(items.nth(1)).toContainText('Rafael N.');
    await expect(items.nth(2)).toContainText('Larissa T.');
    await expect(items.nth(2)).toContainText('Aluno');
    await expect(block.getByText(HIDDEN_SEED_TEXT)).toHaveCount(0);
    // A resposta do Dono aparece, assinada pelo espaço.
    await expect(
      items.nth(1).getByRole('group', { name: `Resposta do ${SPACE_NAME}` }),
    ).toContainText(SEED_REPLY);
    await expect(block.getByTestId('espaco-avaliacoes-ver-todas')).toHaveAttribute(
      'href',
      `/espacos/${SLUG}/avaliacoes`,
    );
    // Sem sessão: nada de "Denunciar".
    await expect(block.getByRole('button', { name: /Mais opções da avaliação/ })).toHaveCount(0);

    // JSON-LD (RF-REVIEW-05): AggregateRating com a média e o total, e as 3 avaliações recentes.
    const ld = await jsonLd(page);
    expect(ld.aggregateRating).toMatchObject({
      '@type': 'AggregateRating',
      ratingValue: 4.2,
      reviewCount: 6,
    });
    expect(Array.isArray(ld.review) && ld.review.length).toBe(3);
    expect(JSON.stringify(ld)).not.toContain(HIDDEN_SEED_TEXT);
    for (const review of ld.review as Json[]) {
      expect(review.reviewRating).toMatchObject({ '@type': 'Rating', bestRating: 5 });
    }

    // Privacidade no HTML renderizado (inclui o payload do servidor): nem o texto oculto, nem o id,
    // o e-mail ou o sobrenome do autor, nem o motivo da moderação.
    const html = await page.content();
    for (const forbidden of [
      HIDDEN_SEED_TEXT,
      'Linguagem ofensiva (seed)',
      marianaUserId,
      MARIANA_EMAIL,
      'Duarte',
      'Nogueira',
      'Teixeira',
    ]) {
      expect(html, `vazou na página pública: ${forbidden}`).not.toContain(forbidden);
    }
  });
});

test('espaço com menos de 5 avaliações: selo "Novo", sem resumo e sem AggregateRating', async ({
  page,
}) => {
  await expectPublicPage(page, `/espacos/${NORTH_SLUG}`, async () => {
    const block = page.getByTestId('espaco-avaliacoes');
    await expect(block.getByTestId('avaliacoes-resumo-novo')).toContainText(
      'Ainda poucas avaliações',
    );
    await expect(block.getByTestId('avaliacoes-resumo')).toHaveCount(0);
    await expect(page.getByTestId('espaco-nota')).toContainText('Novo');
    const ld = await jsonLd(page);
    expect(ld.aggregateRating).toBeUndefined();
    expect(ld.review).toBeUndefined();
  });
});

test('"Ver todas" (RF-REVIEW-04): as 6, o oculto só com a nota e o aviso, e o filtro por nota', async ({
  page,
}) => {
  const list = page.getByTestId('avaliacoes-lista');
  await expectPublicPage(page, `/espacos/${SLUG}/avaliacoes`, async () => {
    await expect(page.getByRole('heading', { name: `Avaliações de ${SPACE_NAME}` })).toBeVisible();
    await expect(list.locator('article')).toHaveCount(6);
    await expect(publicItem(page, 'Diego F.')).toContainText('Comentário oculto pela moderação.');
    await expect(list.getByText(HIDDEN_SEED_TEXT)).toHaveCount(0);
  });

  // Filtro por link: só as de 5 estrelas (Mariana, Camila e Larissa).
  await page.getByTestId('avaliacoes-filtro-5').click();
  await expect(page).toHaveURL(/\?nota=5$/);
  await expect(list.locator('article')).toHaveCount(3);
  await expect(list).not.toContainText('Rafael N.');
});

test('Dono responde no painel e a resposta aparece na página pública (RF-REVIEW-06, RN-REVIEW-05)', async ({
  page,
  browser,
  playwright,
}) => {
  test.setTimeout(240_000);
  const pubContext = await browser.newContext();
  const pub = await pubContext.newPage();
  const REPLY = 'Obrigada pela visita, Mariana! Esperamos você de novo.';

  await login(page, USERS.owner, /\/painel/);
  await page.goto('/painel/avaliacoes');
  await expect(page.getByRole('heading', { name: 'Avaliações', level: 1 })).toBeVisible();
  await expect(page.getByTestId('avaliacoes-media')).toContainText('4,2');
  await expect(page.getByTestId('avaliacoes-total')).toContainText('6');

  const item = page.getByTestId(`avaliacao-item-${state.mariana}`);
  await item.getByTestId(`painel-avaliacoes-responder-${state.mariana}`).click();
  const field = item.getByLabel(`Responder como ${SPACE_NAME}`);
  await expect(field).toBeFocused();
  await item.getByRole('button', { name: 'Publicar resposta' }).click();
  await expect(item.getByText('Escreva a resposta')).toBeVisible();
  await field.fill(REPLY);
  await item.getByRole('button', { name: 'Publicar resposta' }).click();
  await expect(page.getByText('Resposta publicada')).toBeVisible();
  await expect(item.getByRole('group', { name: `Resposta do ${SPACE_NAME}` })).toContainText(REPLY);

  // A resposta é pública: a API a entrega na hora e a página do espaço (sem login) a mostra depois
  // da revalidação do cache do servidor.
  const publicList = async () => {
    const anon = await anonymous(playwright);
    return (await body(await anon.get(`/v1/spaces/${state.spaceId}/reviews?limit=50`)))
      .items as PublicReview[];
  };
  expect((await publicList()).find((r) => r.id === state.mariana)?.reply?.body).toBe(REPLY);
  await expectPublicPage(pub, `/espacos/${SLUG}`, async () => {
    await expect(
      publicItem(pub, 'Mariana D.').getByRole('group', { name: `Resposta do ${SPACE_NAME}` }),
    ).toContainText(REPLY);
  });

  // RF-REVIEW-09: o autor foi avisado, sem o texto da resposta nem o nome de ninguém.
  const mariana = await apiAs(playwright, MARIANA_EMAIL);
  const inbox = await body(await mariana.get('/v1/me/notifications'));
  const replied = (inbox.items as Json[]).filter((n) => n.type === 'REVIEW_REPLIED');
  expect(replied).toHaveLength(1);
  expect(JSON.stringify(replied[0])).not.toContain('Esperamos você');
  expect(JSON.stringify(replied[0])).not.toContain('Dono E2E');

  // Editar muda o texto público; o autor não é avisado outra vez.
  await item.getByRole('button', { name: 'Editar resposta' }).click();
  await item.getByLabel(`Responder como ${SPACE_NAME}`).fill('Valeu, Mariana!');
  await item.getByRole('button', { name: 'Salvar resposta' }).click();
  await expect(page.getByText('Resposta atualizada')).toBeVisible();
  const edited = (await publicList()).find((r) => r.id === state.mariana);
  expect(edited?.reply?.body).toBe('Valeu, Mariana!');
  const after = await body(await mariana.get('/v1/me/notifications'));
  expect((after.items as Json[]).filter((n) => n.type === 'REVIEW_REPLIED')).toHaveLength(1);

  // Remover tira a resposta do público e deixa a avaliação, a nota e a média como estavam.
  await item.getByRole('button', { name: 'Remover resposta' }).click();
  await page
    .getByRole('dialog', { name: 'Remover a resposta?' })
    .getByRole('button', { name: 'Remover' })
    .click();
  await expect(page.getByText('Resposta removida')).toBeVisible();
  const removed = (await publicList()).find((r) => r.id === state.mariana);
  expect(removed).toMatchObject({ rating: 5, reply: null });
  expect(await publicSummary(playwright)).toMatchObject({ count: 6, average: 4.2 });
  await pubContext.close();
});

test('Professor só lê o painel de avaliações: sem responder, editar, remover nem denunciar (RF-REVIEW-06)', async ({
  page,
  playwright,
}) => {
  await login(page, USERS.teacher, /\/painel/);
  await page.goto('/painel/avaliacoes');
  await expect(
    page.getByText('Você vê as avaliações do espaço. Só o Dono e os Administradores respondem.'),
  ).toBeVisible();
  await expect(page.getByTestId(`avaliacao-item-${state.mariana}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Responder' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Editar resposta' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remover resposta' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Mais opções da avaliação/ })).toHaveCount(0);
  // A resposta existente (do Rafael) segue visível, só para leitura.
  await expect(page.locator('[data-testid^="painel-avaliacoes-responder-"]')).toHaveCount(0);
  await expect(page.getByRole('group', { name: /Resposta do/ })).toHaveCount(1);

  // O servidor também recusa: o Professor não responde, não remove e não denuncia pela API.
  const teacher = await apiAs(playwright, USERS.teacher);
  const base = `/v1/manage/spaces/${state.spaceId}/reviews`;
  expect((await teacher.get(base)).status()).toBe(200);
  for (const res of [
    await teacher.put(`${base}/${state.mariana}/reply`, { data: { body: 'Invasão' } }),
    await teacher.delete(`${base}/${state.mariana}/reply`),
    await teacher.post(`${base}/${state.mariana}/reports`, { data: { reason: 'SPAM' } }),
  ]) {
    expect(res.status()).toBe(403);
  }
  // Nada mudou na página pública.
  const anon = await anonymous(playwright);
  const list = await body(await anon.get(`/v1/spaces/${state.spaceId}/reviews?limit=50`));
  const mariana = (list.items as PublicReview[]).find((item) => item.id === state.mariana);
  expect(mariana?.reply).toBeNull();
});

test('Super modera: a denúncia entra na fila, o comentário é ocultado e a nota continua na média (RF-REVIEW-07, RN-REVIEW-04)', async ({
  page,
  browser,
  playwright,
}) => {
  test.setTimeout(300_000);
  const before = await publicSummary(playwright);
  expect(before).toMatchObject({ count: 6, average: 4.2 });

  // O jogador denuncia a avaliação da Larissa pela API (uma vez; a segunda é recusada).
  const player = await apiAs(playwright, USERS.player);
  const report = await player.post(`/v1/reviews/${state.larissa}/reports`, {
    data: { reason: 'FALSE_INFO', details: 'Ela nunca foi aluna.' },
  });
  expect(report.status()).toBe(204);
  const again = await player.post(`/v1/reviews/${state.larissa}/reports`, {
    data: { reason: 'SPAM' },
  });
  expect(again.status()).toBe(409);
  expect((await errorOf(again)).code).toBe('REVIEW_ALREADY_REPORTED');

  const superApi = await apiAs(playwright, USERS.super);
  const queue = await body(await superApi.get('/v1/super/reviews/reports?status=OPEN'));
  const reportRow = (queue.items as Json[]).find((r) => r.reviewId === state.larissa);
  expect(reportRow, 'denúncia da Larissa na fila').toBeDefined();

  const pubContext = await browser.newContext();
  const pub = await pubContext.newPage();
  await expectPublicPage(pub, `/espacos/${SLUG}`, async () => {
    await expect(publicItem(pub, 'Larissa T.')).toContainText('Melhor custo-benefício da região.');
  });

  // Fila do Super → avaliação → ocultar com motivo.
  await login(page, USERS.super, /\/super$/);
  await page.goto('/super/avaliacoes');
  await expect(page.getByRole('tab', { name: 'Abertas', selected: true })).toBeVisible();
  const row = page.getByTestId(`denuncia-${reportRow?.id}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('Melhor custo-benefício da região.');
  await expect(row).toContainText('Informação falsa');
  await row.getByText('Melhor custo-benefício da região.').click();
  await expect(page).toHaveURL(new RegExp(`/super/avaliacoes/${state.larissa}$`));

  await page.getByTestId('super-avaliacao-ocultar').click();
  const hide = page.getByRole('dialog', { name: 'Ocultar o comentário?' });
  await hide.getByRole('button', { name: 'Ocultar comentário' }).click();
  await expect(hide.getByText('Escreva o motivo')).toBeVisible();
  await hide.getByLabel('Motivo').fill('Informação falsa confirmada');
  await hide.getByRole('button', { name: 'Ocultar comentário' }).click();
  await expect(page.getByText('Comentário ocultado')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reexibir comentário' })).toBeVisible();
  await expect(page.getByTestId('historico-moderacao')).toContainText('Ocultado por');
  // A denúncia aberta daquela avaliação foi resolvida pela moderação.
  await expect(page.getByTestId(`denuncia-${reportRow?.id}`)).toContainText('Resolvida');

  // A API já entrega o comentário oculto, com a nota na média: nada mudou nos números.
  const anon = await anonymous(playwright);
  const listed = (await body(await anon.get(`/v1/spaces/${state.spaceId}/reviews?limit=50`)))
    .items as PublicReview[];
  expect(listed.find((r) => r.id === state.larissa)).toMatchObject({
    rating: 5,
    comment: null,
    commentHidden: true,
  });
  const hiddenState = await publicSummary(playwright);
  expect(hiddenState).toMatchObject({ count: 6, average: 4.2 });
  expect(hiddenState.distribution).toEqual(before.distribution);
  expect(hiddenState.recent.map((r: PublicReview) => r.id)).not.toContain(state.larissa);

  // A página pública (cache de 60 s do servidor): o texto some, a avaliação e a nota ficam, e a
  // média e o total (JSON-LD inclusive) seguem os mesmos.
  await expectPublicPage(pub, `/espacos/${SLUG}`, async () => {
    await expect(pub.getByText('Melhor custo-benefício da região.')).toHaveCount(0);
    await expect(pub.getByRole('group', { name: 'Nota 4,2 de 5, 6 avaliações' })).toBeVisible();
    const ld = await jsonLd(pub);
    expect(ld.aggregateRating).toMatchObject({ ratingValue: 4.2, reviewCount: 6 });
    expect(JSON.stringify(ld)).not.toContain('Melhor custo-benefício');
  });
  await expectPublicPage(pub, `/espacos/${SLUG}/avaliacoes`, async () => {
    await expect(publicItem(pub, 'Larissa T.')).toContainText('Comentário oculto pela moderação.');
    await expect(pub.getByTestId('avaliacoes-lista').locator('article')).toHaveCount(6);
  });

  // Reexibir devolve o comentário (a API, na hora) e deixa as duas ações no histórico.
  await page.getByRole('button', { name: 'Reexibir comentário' }).click();
  const unhide = page.getByRole('dialog', { name: 'Reexibir o comentário?' });
  await unhide.getByLabel('Motivo').fill('Revisado');
  await unhide.getByRole('button', { name: 'Reexibir comentário' }).click();
  await expect(page.getByText('Comentário reexibido')).toBeVisible();
  await expect(page.getByTestId('super-avaliacao-ocultar')).toBeVisible();
  const restored = (await body(await anon.get(`/v1/spaces/${state.spaceId}/reviews?limit=50`)))
    .items as PublicReview[];
  expect(restored.find((r) => r.id === state.larissa)).toMatchObject({
    comment: 'Melhor custo-benefício da região.',
    commentHidden: false,
  });
  expect(await publicSummary(playwright)).toMatchObject({ count: 6, average: 4.2 });
  await pubContext.close();
});

test('o Dono não acessa a moderação do Super (RN-REVIEW-04): nem a tela, nem a API', async ({
  page,
  playwright,
}) => {
  const owner = await apiAs(playwright, USERS.owner);
  for (const path of ['/v1/super/reviews/reports', `/v1/super/reviews/${state.larissa}`]) {
    const res = await owner.get(path);
    expect(res.status(), path).toBe(403);
    expect((await errorOf(res)).code).toBe('SUPER_REQUIRED');
  }
  const hide = await owner.post(`/v1/super/reviews/${state.larissa}/hide`, {
    data: { reason: 'Quero esconder' },
  });
  expect(hide.status()).toBe(403);
  await login(page, USERS.owner, /\/painel/);
  await page.goto('/super/avaliacoes');
  await expect(page.getByTestId('super-avaliacao-ocultar')).toHaveCount(0);
  await expect(page.locator('[data-testid^="denuncia-"]')).toHaveCount(0);
  const summary = await publicSummary(playwright);
  expect(summary.count).toBe(6);
});
