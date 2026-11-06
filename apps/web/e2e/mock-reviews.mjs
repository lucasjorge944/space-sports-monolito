// Avaliações na API simulada (AV.3): rotas públicas (`/v1/spaces/:id/reviews*`, denúncia), da gestão
// (`/v1/manage/spaces/:id/reviews*`) e do Super (`/v1/super/reviews*`). O estado fica no escopo do
// teste (`scoped.reviews`), para responder, denunciar e moderar sem atrapalhar os testes em paralelo.
// As páginas públicas renderizadas no servidor leem o escopo `default` (o fetch do Next não leva o
// cookie de escopo), e nenhum teste muda o escopo `default`.
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAY = 86_400_000;
const ago = (days, hours = 0) =>
  new Date(Date.now() - days * DAY - hours * 3_600_000).toISOString();

/**
 * Espaço A (o do painel) é a "Arena Exemplo" da página pública; a Quadra Nova tem poucas avaliações;
 * o Espaço Exemplo C está fora da vitrine (sem preço/hora) e tem 2 avaliações: só o painel (perfil
 * `outside`) e o Super o veem, a rota pública responde 404; o Espaço Exemplo D está na vitrine com 5.
 *
 * `showcaseMissing` (os códigos de `showcase.missing`) é a fonte única de "fora da vitrine" para
 * esses espaços: a rota pública, o resumo da gestão, o `getManagedSpace` do painel
 * (e2e/mock-api.mjs) e o Super (e2e/mock-super.mjs) leem daqui.
 */
export const REVIEW_SPACES = {
  arena: { id: ID(101), slug: 'arena-exemplo', name: 'Arena Exemplo' },
  nova: { id: ID(103), slug: 'quadra-nova', name: 'Quadra Nova' },
  fora: {
    id: ID(104),
    slug: 'espaco-c',
    name: 'Espaço Exemplo C',
    showcaseMissing: ['PRICE_PER_HOUR'],
  },
  vitrine: { id: ID(105), slug: 'espaco-d', name: 'Espaço Exemplo D' },
};

/** `showcase.missing` do espaço (vazio = na vitrine). */
export function reviewShowcaseMissing(spaceId) {
  return Object.values(REVIEW_SPACES).find((s) => s.id === spaceId)?.showcaseMissing ?? [];
}
const inShowcase = (spaceId) => reviewShowcaseMissing(spaceId).length === 0;

function review(n, over) {
  return {
    id: ID(1000 + n),
    spaceId: REVIEW_SPACES.arena.id,
    userId: ID(2000 + n),
    authorName: `Jogador${n} Teste`,
    authorKind: 'PLAYER',
    blocked: false,
    rating: 5,
    tags: [],
    comment: null,
    hidden: null,
    reply: null,
    createdAt: ago(n * 4),
    updatedAt: ago(n * 4),
    ...over,
  };
}

function seed() {
  const reviews = [
    review(1, {
      authorName: 'Ana Paula Souza',
      tags: ['GOOD_COURT', 'CLEAN'],
      comment: 'A quadra estava ótima e o pessoal foi super atencioso. Voltaremos!',
      createdAt: ago(1),
      updatedAt: ago(1),
    }),
    review(2, {
      authorName: 'Bruno Lima',
      authorKind: 'STUDENT',
      rating: 4,
      tags: ['GOOD_SERVICE'],
      comment: 'Aula muito boa, professor paciente.',
      // Editada depois da resposta do espaço: marca "editada".
      reply: { body: 'Valeu, Bruno! Até a próxima aula.', repliedAt: ago(2), updatedAt: null },
      createdAt: ago(3),
      updatedAt: ago(1, 2),
    }),
    review(3, {
      authorName: 'Carla Dias',
      rating: 1,
      tags: ['DIRTY'],
      comment: 'Texto ofensivo de exemplo.',
      hidden: { at: ago(3), byName: 'Super Admin', reason: 'Ofensivo' },
      createdAt: ago(4),
      updatedAt: ago(4),
    }),
    review(4, {
      userId: null,
      authorName: null,
      rating: 5,
      tags: ['GOOD_VALUE'],
      createdAt: ago(5),
      updatedAt: ago(5),
    }),
    review(5, {
      authorName: 'Dani Rocha',
      rating: 2,
      tags: ['EXPENSIVE'],
      comment: 'Achei caro pelo que oferece.',
      createdAt: ago(6),
      updatedAt: ago(6),
    }),
    review(6, {
      authorName: 'Edu Melo',
      comment: 'Ótimo lugar para jogar futevôlei.',
      tags: ['GOOD_COURT', 'GOOD_LIGHTING', 'ON_TIME'],
      createdAt: ago(8),
      updatedAt: ago(8),
    }),
  ];
  // Mais 17, para a lista ter duas páginas (23 visíveis, 20 por página).
  for (let n = 7; n <= 23; n += 1) {
    reviews.push(
      review(n, {
        rating: n % 4 === 0 ? 4 : 5,
        tags: n % 3 === 0 ? ['CLEAN'] : [],
        comment: n % 2 === 0 ? `Comentário de teste ${n}.` : null,
        createdAt: ago(n * 4),
        updatedAt: ago(n * 4),
      }),
    );
  }
  // Autor bloqueado: fora da média e das listas do público e da gestão; só o Super vê.
  reviews.push(
    review(24, {
      authorName: 'Fábio Bloqueado',
      blocked: true,
      rating: 1,
      comment: 'Nota de autor bloqueado.',
      createdAt: ago(2),
      updatedAt: ago(2),
    }),
  );
  // Espaço com poucas avaliações: selo "Novo".
  reviews.push(
    review(31, {
      spaceId: REVIEW_SPACES.nova.id,
      authorName: 'Gabi Nunes',
      comment: 'Lugar novo e bem cuidado.',
      tags: ['GOOD_FACILITIES'],
      createdAt: ago(2),
      updatedAt: ago(2),
    }),
    review(32, {
      spaceId: REVIEW_SPACES.nova.id,
      authorName: 'Hugo Alves',
      rating: 4,
      createdAt: ago(9),
      updatedAt: ago(9),
    }),
  );
  // Espaço fora da vitrine com avaliações (menos de 5): o público não veria a nota nem com 5.
  reviews.push(
    review(41, {
      spaceId: REVIEW_SPACES.fora.id,
      authorName: 'Iara Costa',
      rating: 4,
      comment: 'Boa quadra, pena que fechou.',
      tags: ['GOOD_COURT'],
      createdAt: ago(20),
      updatedAt: ago(20),
    }),
    review(42, {
      spaceId: REVIEW_SPACES.fora.id,
      authorName: 'João Pires',
      rating: 3,
      createdAt: ago(30),
      updatedAt: ago(30),
    }),
  );
  // Espaço na vitrine com exatamente 5 avaliações: o público já vê a média (4,4).
  [5, 5, 4, 4, 4].forEach((rating, i) => {
    reviews.push(
      review(51 + i, {
        spaceId: REVIEW_SPACES.vitrine.id,
        authorName: `Jogadora${51 + i} Vitrine`,
        rating,
        createdAt: ago(10 + i),
        updatedAt: ago(10 + i),
      }),
    );
  });

  const reports = [
    {
      id: ID(3001),
      reviewId: ID(1005),
      reason: 'OFFENSIVE',
      details: 'Fala mal do dono.',
      status: 'OPEN',
      reporter: { userId: ID(8), name: 'Jogador Caio', spaceId: null },
      createdAt: ago(5),
      resolvedAt: null,
      resolvedByName: null,
      resolutionReason: null,
    },
    {
      id: ID(3002),
      reviewId: ID(1024),
      reason: 'SPAM',
      details: null,
      status: 'OPEN',
      reporter: { userId: null, name: null, spaceId: REVIEW_SPACES.arena.id },
      createdAt: ago(1),
      resolvedAt: null,
      resolvedByName: null,
      resolutionReason: null,
    },
    {
      id: ID(3003),
      reviewId: ID(1003),
      reason: 'OFFENSIVE',
      details: null,
      status: 'RESOLVED',
      reporter: { userId: ID(9), name: 'Jogadora Dani', spaceId: null },
      createdAt: ago(4),
      resolvedAt: ago(3),
      resolvedByName: 'Super Admin',
      resolutionReason: 'Ofensivo',
    },
  ];
  const history = {
    [ID(1003)]: [
      {
        id: ID(4001),
        action: 'review.hide',
        actorName: 'Super Admin',
        actingAsSuper: true,
        diff: { reason: 'Ofensivo' },
        createdAt: ago(3),
      },
    ],
  };
  return { reviews, reports, history, userReports: new Set() };
}

const capitalize = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);
function publicName(name) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'Usuário removido';
  const last = words.length > 1 ? ` ${words.at(-1).charAt(0).toUpperCase()}.` : '';
  return `${capitalize(words[0])}${last}`;
}

const counted = (r) => !r.blocked;
const isHidden = (r) => r.hidden !== null;

function publicView(r) {
  return {
    id: r.id,
    author: { name: publicName(r.authorName), avatarUrl: null, kind: r.authorKind },
    rating: r.rating,
    tags: r.tags,
    comment: isHidden(r) ? null : r.comment,
    commentHidden: isHidden(r),
    reply: r.reply,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function superView(state, r) {
  const { id, slug, name } = Object.values(REVIEW_SPACES).find((s) => s.id === r.spaceId);
  return {
    id: r.id,
    space: { id, slug, name },
    author: {
      userId: r.userId,
      name: r.authorName ?? 'Usuário removido',
      blocked: r.blocked,
    },
    rating: r.rating,
    tags: r.tags,
    comment: r.comment,
    authorKind: r.authorKind,
    counted: counted(r),
    hidden: r.hidden,
    reply: r.reply,
    openReports: state.reports.filter((p) => p.reviewId === r.id && p.status === 'OPEN').length,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function superDetail(state, r) {
  return {
    ...superView(state, r),
    reports: state.reports.filter((p) => p.reviewId === r.id),
    history: state.history[r.id] ?? [],
  };
}

function addHistory(state, reviewId, entry) {
  state.history[reviewId] = [...(state.history[reviewId] ?? []), entry];
}

const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt);
const visibleOf = (state, spaceId) =>
  state.reviews.filter((r) => r.spaceId === spaceId && counted(r)).sort(byNewest);

function distribution(list) {
  return [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: list.filter((r) => r.rating === rating).length,
  }));
}

function topTags(list, max) {
  const counts = new Map();
  for (const r of list) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([tag, count]) => ({ tag, count }));
}

// Ordem do catálogo (AV.1): pares positivo/negativo; os positivos nas posições pares.
const TAG_ORDER = [
  'GOOD_COURT',
  'BAD_COURT',
  'GOOD_SERVICE',
  'BAD_SERVICE',
  'CLEAN',
  'DIRTY',
  'GOOD_VALUE',
  'EXPENSIVE',
  'EASY_BOOKING',
  'HARD_BOOKING',
  'GOOD_LIGHTING',
  'BAD_LIGHTING',
  'ON_TIME',
  'DELAYS',
  'GOOD_FACILITIES',
  'POOR_FACILITIES',
];
const isPositive = (tag) => TAG_ORDER.indexOf(tag) % 2 === 0;

/** `highlights` do painel e do Super: até 5 por grupo, mais citado primeiro, empate no catálogo. */
function highlights(list) {
  const counts = new Map();
  for (const r of list) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || TAG_ORDER.indexOf(a[0]) - TAG_ORDER.indexOf(b[0]))
    .map(([tag, count]) => ({ tag, count }));
  return {
    positive: sorted.filter((t) => isPositive(t.tag)).slice(0, 5),
    negative: sorted.filter((t) => !isPositive(t.tag)).slice(0, 5),
  };
}

const average = (list) =>
  list.length === 0
    ? null
    : Math.round((list.reduce((s, r) => s + r.rating, 0) * 10) / list.length) / 10;

function publicSummary(state, spaceId) {
  const list = visibleOf(state, spaceId);
  return {
    count: list.length,
    average: list.length >= 5 ? average(list) : null,
    distribution: list.length >= 5 ? distribution(list) : [],
    topTags: list.length >= 5 ? topTags(list, 3) : [],
    recent: list
      .filter((r) => r.comment && !isHidden(r))
      .slice(0, 3)
      .map(publicView),
  };
}

function weeklyTrend(list) {
  const points = [];
  for (let k = 12; k >= 0; k -= 1) {
    const start = Date.now() - (k + 1) * 7 * DAY;
    const end = Date.now() - k * 7 * DAY;
    const inWeek = list.filter((r) => {
      const t = new Date(r.createdAt).getTime();
      return t >= start && t < end;
    });
    const upToEnd = list.filter((r) => new Date(r.createdAt).getTime() < end);
    points.push({
      date: new Date(start).toISOString().slice(0, 10),
      count: inWeek.length,
      average: average(inWeek),
      cumulativeAverage: average(upToEnd),
    });
  }
  return points;
}

function manageSummary(state, spaceId) {
  const list = visibleOf(state, spaceId);
  // Agregado dos 90 dias da soma e da contagem (não das médias semanais), como a API.
  const last90 = list.filter((r) => Date.now() - new Date(r.createdAt).getTime() < 90 * DAY);
  return {
    count: list.length,
    average: average(list),
    publicSummaryVisible: inShowcase(spaceId) && list.length >= 5,
    unansweredCount: list.filter((r) => !r.reply).length,
    distribution: distribution(list),
    highlights: highlights(list),
    trend: {
      granularity: 'WEEK',
      count: last90.length,
      average: average(last90),
      points: weeklyTrend(list),
    },
  };
}

/**
 * GET /v1/super/reviews/summary: qualquer espaço, com as fora da média (autor bloqueado).
 * `publicSummaryVisible` segue a vitrine do estado do Super (`showcaseVisible`), como a API.
 */
function superSummary(state, spaceId, showcaseVisible) {
  const list = visibleOf(state, spaceId);
  return {
    count: list.length,
    average: average(list),
    publicSummaryVisible: showcaseVisible(spaceId) && list.length >= 5,
    uncountedCount: state.reviews.filter((r) => r.spaceId === spaceId && !counted(r)).length,
    distribution: distribution(list),
    highlights: highlights(list),
  };
}

/** Cursor = posição na lista (texto opaco para o web). */
function page(list, url, map) {
  const limit = Number(url.searchParams.get('limit') ?? 20);
  const cursor = url.searchParams.get('cursor');
  const offset = cursor ? Number(cursor.replace(/^c/, '')) : 0;
  const items = list.slice(offset, offset + limit).map(map);
  const next = offset + limit < list.length ? `c${offset + limit}` : null;
  return { items, nextCursor: next };
}

const ratingParam = (url) => {
  const raw = url.searchParams.get('rating');
  return raw ? Number(raw) : null;
};

/** Devolve `true` se a rota é de avaliações (e já respondeu). */
export async function handleReviews({
  req,
  res,
  path,
  url,
  send,
  fail,
  readJson,
  scoped,
  calls,
  session,
  // Vitrine do espaço no estado do Super (e2e/mock-super.mjs, que lê `showcaseMissing` daqui e
  // acrescenta o Espaço A fora da vitrine, só no Super). Sem ele, a mesma regra do resto do mock.
  superShowcaseVisible = inShowcase,
}) {
  const method = req.method ?? 'GET';
  const isReviewPath =
    /^\/v1\/spaces\/[^/]+\/reviews/.test(path) ||
    /^\/v1\/reviews\//.test(path) ||
    /^\/v1\/manage\/spaces\/[^/]+\/reviews/.test(path) ||
    path.startsWith('/v1/super/reviews');
  if (!isReviewPath) return false;
  scoped.reviews ??= seed();
  const state = scoped.reviews;
  const findReview = (id) => state.reviews.find((r) => r.id === id);
  const record = async () => {
    const body = method === 'GET' ? {} : await readJson(req);
    calls.push({ path: `${method} ${path}`, body });
    return body;
  };

  // --- Público ----------------------------------------------------------------------------------
  const pub = /^\/v1\/spaces\/([^/]+)\/reviews(\/summary)?$/.exec(path);
  if (pub && method === 'GET') {
    const [, spaceId, summary] = pub;
    if (!Object.values(REVIEW_SPACES).some((s) => s.id === spaceId) || !inShowcase(spaceId)) {
      fail(res, 404, 'SPACE_NOT_FOUND', 'Espaço não encontrado.');
      return true;
    }
    if (summary) {
      send(res, 200, publicSummary(state, spaceId));
      return true;
    }
    const rating = ratingParam(url);
    const list = visibleOf(state, spaceId).filter((r) => !rating || r.rating === rating);
    send(res, 200, page(list, url, publicView));
    return true;
  }

  const report = /^\/v1\/reviews\/([^/]+)\/reports$/.exec(path);
  if (report && method === 'POST') {
    const body = await record();
    if (!session) {
      fail(res, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
      return true;
    }
    if (!body.reason) {
      fail(res, 400, 'VALIDATION_ERROR', 'Motivo obrigatório.');
      return true;
    }
    const key = `${session.id}:${report[1]}`;
    if (state.userReports.has(key)) {
      fail(res, 409, 'REVIEW_ALREADY_REPORTED', 'Already reported.');
      return true;
    }
    state.userReports.add(key);
    res.writeHead(204);
    res.end();
    return true;
  }

  // --- Gestão -----------------------------------------------------------------------------------
  const manage =
    /^\/v1\/manage\/spaces\/([^/]+)\/reviews(?:\/(summary|[^/]+\/reply|[^/]+\/reports))?$/.exec(
      path,
    );
  if (manage) {
    if (!session) {
      fail(res, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
      return true;
    }
    const [, spaceId, sub] = manage;
    const canReply = session.roles.includes('OWNER') || session.roles.includes('ADMIN');
    if (!sub && method === 'GET') {
      const rating = ratingParam(url);
      const unanswered = url.searchParams.get('unanswered') === 'true';
      const list = visibleOf(state, spaceId).filter(
        (r) => (!rating || r.rating === rating) && (!unanswered || !r.reply),
      );
      send(
        res,
        200,
        page(list, url, (r) => ({
          ...publicView(r),
          reportedBySpace: state.reports.some(
            (p) => p.reviewId === r.id && p.reporter.spaceId === spaceId,
          ),
        })),
      );
      return true;
    }
    if (sub === 'summary') {
      send(res, 200, manageSummary(state, spaceId));
      return true;
    }
    const reviewId = sub.split('/')[0];
    const target = findReview(reviewId);
    if (!canReply) {
      await record();
      fail(res, 403, 'SPACE_FORBIDDEN', 'Sem permissão.');
      return true;
    }
    if (!target || target.spaceId !== spaceId) {
      await record();
      fail(res, 404, 'REVIEW_NOT_FOUND', 'Avaliação não encontrada.');
      return true;
    }
    if (sub.endsWith('/reply') && method === 'PUT') {
      const body = await record();
      const now = new Date().toISOString();
      target.reply = target.reply
        ? { ...target.reply, body: body.body, updatedAt: now }
        : { body: body.body, repliedAt: now, updatedAt: null };
      send(res, 200, { ...publicView(target), reportedBySpace: false });
      return true;
    }
    if (sub.endsWith('/reply') && method === 'DELETE') {
      await record();
      if (!target.reply) {
        fail(res, 404, 'REVIEW_REPLY_NOT_FOUND', 'Sem resposta.');
        return true;
      }
      target.reply = null;
      res.writeHead(204);
      res.end();
      return true;
    }
    if (sub.endsWith('/reports') && method === 'POST') {
      const body = await record();
      if (state.reports.some((p) => p.reviewId === reviewId && p.reporter.spaceId === spaceId)) {
        fail(res, 409, 'REVIEW_ALREADY_REPORTED', 'Already reported.');
        return true;
      }
      state.reports.push({
        id: ID(3100 + state.reports.length),
        reviewId,
        reason: body.reason,
        details: body.details ?? null,
        status: 'OPEN',
        reporter: { userId: session.id, name: null, spaceId },
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        resolvedByName: null,
        resolutionReason: null,
      });
      res.writeHead(204);
      res.end();
      return true;
    }
    fail(res, 404, 'NOT_FOUND', 'Rota não encontrada.');
    return true;
  }

  // --- Super ------------------------------------------------------------------------------------
  if (!session?.super) {
    fail(res, 403, 'FORBIDDEN', 'Acesso restrito.');
    return true;
  }
  if (path === '/v1/super/reviews/reports' && method === 'GET') {
    const status = url.searchParams.get('status') ?? 'OPEN';
    const list = state.reports
      .filter((p) => p.status === status)
      .sort((a, b) =>
        status === 'OPEN'
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt),
      );
    send(
      res,
      200,
      page(list, url, (p) => ({ ...p, review: superView(state, findReview(p.reviewId)) })),
    );
    return true;
  }
  const dismiss = /^\/v1\/super\/reviews\/reports\/([^/]+)\/dismiss$/.exec(path);
  if (dismiss && method === 'POST') {
    const body = await record();
    const target = state.reports.find((p) => p.id === dismiss[1]);
    if (!target) {
      fail(res, 404, 'REVIEW_REPORT_NOT_FOUND', 'Denúncia não encontrada.');
      return true;
    }
    if (target.status !== 'OPEN') {
      fail(res, 409, 'REVIEW_REPORT_RESOLVED', 'Já resolvida.');
      return true;
    }
    const now = new Date().toISOString();
    const reason = body?.reason ?? null;
    Object.assign(target, {
      status: 'DISMISSED',
      resolvedAt: now,
      resolvedByName: 'Super Admin',
      resolutionReason: reason,
    });
    addHistory(state, target.reviewId, {
      id: ID(4100 + Object.keys(state.history).length),
      action: 'review.report_dismiss',
      actorName: 'Super Admin',
      actingAsSuper: true,
      diff: reason ? { reason } : null,
      createdAt: now,
    });
    send(res, 200, superDetail(state, findReview(target.reviewId)));
    return true;
  }
  if (path === '/v1/super/reviews/summary' && method === 'GET') {
    send(res, 200, superSummary(state, url.searchParams.get('spaceId'), superShowcaseVisible));
    return true;
  }
  if (path === '/v1/super/reviews' && method === 'GET') {
    const spaceId = url.searchParams.get('spaceId');
    const rating = ratingParam(url);
    const hidden = url.searchParams.get('hidden') === 'true';
    const reported = url.searchParams.get('reported') === 'true';
    const list = state.reviews
      .filter(
        (r) =>
          r.spaceId === spaceId &&
          (!rating || r.rating === rating) &&
          (!hidden || isHidden(r)) &&
          (!reported || state.reports.some((p) => p.reviewId === r.id && p.status === 'OPEN')),
      )
      .sort(byNewest);
    send(
      res,
      200,
      page(list, url, (r) => superView(state, r)),
    );
    return true;
  }
  const one = /^\/v1\/super\/reviews\/([^/]+)(?:\/(hide|unhide))?$/.exec(path);
  if (one) {
    const target = findReview(one[1]);
    if (!target) {
      fail(res, 404, 'REVIEW_NOT_FOUND', 'Avaliação não encontrada.');
      return true;
    }
    if (!one[2] && method === 'GET') {
      send(res, 200, superDetail(state, target));
      return true;
    }
    if (method === 'POST') {
      const body = await record();
      const now = new Date().toISOString();
      if (one[2] === 'hide') {
        if (!target.comment) {
          fail(res, 409, 'REVIEW_NO_COMMENT', 'Sem comentário.');
          return true;
        }
        if (isHidden(target)) {
          fail(res, 409, 'REVIEW_COMMENT_HIDDEN', 'Já oculto.');
          return true;
        }
        target.hidden = { at: now, byName: 'Super Admin', reason: body.reason };
        for (const p of state.reports) {
          if (p.reviewId === target.id && p.status === 'OPEN') {
            Object.assign(p, {
              status: 'RESOLVED',
              resolvedAt: now,
              resolvedByName: 'Super Admin',
              resolutionReason: body.reason,
            });
          }
        }
      } else {
        if (!isHidden(target)) {
          fail(res, 409, 'REVIEW_COMMENT_NOT_HIDDEN', 'Já visível.');
          return true;
        }
        target.hidden = null;
      }
      addHistory(state, target.id, {
        id: ID(4200 + (state.history[target.id]?.length ?? 0)),
        action: `review.${one[2]}`,
        actorName: 'Super Admin',
        actingAsSuper: true,
        diff: { reason: body.reason },
        createdAt: now,
      });
      send(res, 200, superDetail(state, target));
      return true;
    }
  }
  fail(res, 404, 'NOT_FOUND', 'Rota não encontrada.');
  return true;
}

/** `rating` do detalhe e dos cards a partir das avaliações do escopo `default` (as do seed). */
export function spaceRating(spaceId) {
  const list = seed().reviews.filter((r) => r.spaceId === spaceId && counted(r));
  return { count: list.length, average: list.length >= 5 ? average(list) : null };
}
