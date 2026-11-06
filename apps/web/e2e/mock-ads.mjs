// Rotas `/v1/super/ads/*` da API simulada (contrato da tarefa AD.2, docs/12-anuncios.md, seção 6).
// O estado é zerado junto com o do Super (`/__super-reset`); as escritas entram no `/__super-calls`.
// `/__super-ads-fail?op=<operação>&status=<http>&code=<código>` faz a próxima chamada da operação
// (`advertiser-create`, `advertiser-update`, `campaign-create`, `creative-save`) responder o erro.
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAY = 24 * 60 * 60 * 1000;
const MOCK_PORT = Number(process.env.MOCK_API_PORT ?? 3334);
/** Imagem salva da peça: a logo servida pela própria API simulada. */
export const AD_IMAGE_URL = `http://localhost:${MOCK_PORT}/__assets/logo.svg`;
const FORBIDDEN = ['BETTING', 'ALCOHOL'];
const FORMATS = {
  EXPLORE_HERO: {
    aspectWidth: 2,
    aspectHeight: 1,
    minWidth: 960,
    minHeight: 480,
    maxBytes: 2097152,
  },
  EXPLORE_FEED: {
    aspectWidth: 4,
    aspectHeight: 5,
    minWidth: 480,
    minHeight: 600,
    maxBytes: 2097152,
  },
};

let ads;
let nextId;
let failures;

const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();

export function resetAds() {
  nextId = 1000;
  failures = {};
  const advertisers = [
    {
      id: ID(701),
      name: 'Rede Quadra',
      kind: 'COMPANY',
      category: 'SPORTING_GOODS',
      space: null,
      contactName: 'Marina Vendas',
      contactEmail: 'vendas@redequadra.exemplo',
      contactPhone: '+5531988887777',
      notes: null,
      active: true,
    },
    {
      id: ID(702),
      name: 'Espaço Exemplo A',
      kind: 'SPACE',
      category: 'SPORTS_SPACE',
      space: { id: ID(101), name: 'Espaço Exemplo A', slug: 'espaco-a' },
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      notes: null,
      active: true,
    },
    {
      id: ID(703),
      name: 'Loja Antiga',
      kind: 'COMPANY',
      category: 'APPAREL',
      space: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      notes: 'Contrato encerrado.',
      active: false,
    },
    {
      id: ID(704),
      name: 'Espaço Exemplo B',
      kind: 'SPACE',
      category: 'SPORTS_SPACE',
      space: { id: ID(102), name: 'Espaço Exemplo B', slug: 'espaco-b' },
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      notes: null,
      active: false,
    },
  ];
  const creative = (campaignId, n, extra = {}) => ({
    id: ID(800 + n),
    campaignId,
    imageUrl: AD_IMAGE_URL,
    title: `Peça ${n}`,
    body: 'Texto curto da peça.',
    ctaLabel: 'Ver ofertas',
    destination: { type: 'URL', url: 'https://redequadra.exemplo/ofertas' },
    active: true,
    position: n,
    ...extra,
  });
  const campaign = (n, advertiserId, name, placement, status, start, end, creatives) => ({
    id: ID(750 + n),
    advertiserId,
    name,
    placement,
    startsAt: iso(start),
    endsAt: iso(end),
    cityIds: [],
    sportIds: [],
    weight: 5,
    status,
    creatives: creatives(ID(750 + n)),
  });
  ads = {
    advertisers,
    campaigns: [
      campaign(1, ID(701), 'Verão Rede Quadra', 'EXPLORE_HERO', 'ACTIVE', -10, 30, (id) => [
        creative(id, 1, { title: 'Raquetes com 30% off' }),
        creative(id, 2, { title: 'Bolas de beach tennis', active: false }),
      ]),
      campaign(2, ID(701), 'Black Friday', 'EXPLORE_FEED', 'ACTIVE', 10, 20, (id) => [
        creative(id, 3),
      ]),
      campaign(3, ID(702), 'Destaque Espaço A', 'EXPLORE_FEED', 'PAUSED', -5, 60, (id) => [
        creative(id, 4, {
          imageUrl: null,
          destination: {
            type: 'SPACE',
            space: {
              id: ID(101),
              name: 'Espaço Exemplo A',
              slug: 'espaco-a',
              showcaseVisible: false,
            },
          },
        }),
      ]),
      campaign(4, ID(701), 'Inverno', 'EXPLORE_HERO', 'ACTIVE', -60, -30, (id) => [
        creative(id, 5),
      ]),
      campaign(5, ID(701), 'Lançamento sem peças', 'EXPLORE_HERO', 'ACTIVE', -1, 30, () => []),
      campaign(6, ID(703), 'Liquidação', 'EXPLORE_HERO', 'ACTIVE', -1, 30, (id) => [
        creative(id, 6),
      ]),
    ],
    uploads: new Set(),
  };
}
resetAds();

const advertiserOf = (campaign) => ads.advertisers.find((a) => a.id === campaign.advertiserId);

function delivery(campaign) {
  const now = Date.now();
  const reasons = [];
  if (campaign.status !== 'ACTIVE') reasons.push('NOT_ACTIVE');
  if (new Date(campaign.startsAt).getTime() > now) reasons.push('NOT_STARTED');
  if (new Date(campaign.endsAt).getTime() <= now) reasons.push('ENDED');
  if (!advertiserOf(campaign).active) reasons.push('ADVERTISER_INACTIVE');
  const deliverable = campaign.creatives.filter(
    (c) => c.active && (c.destination.type !== 'SPACE' || c.destination.space.showcaseVisible),
  );
  if (deliverable.length === 0) reasons.push('NO_CREATIVES');
  return { onAir: reasons.length === 0, reasons };
}

const advertiserView = (a) => ({
  ...a,
  campaignsCount: ads.campaigns.filter((c) => c.advertiserId === a.id).length,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
});

function campaignView(c, withCreatives = false) {
  const advertiser = advertiserOf(c);
  const { advertiserId: _, creatives, ...rest } = c;
  return {
    ...rest,
    advertiser: {
      id: advertiser.id,
      name: advertiser.name,
      kind: advertiser.kind,
      category: advertiser.category,
      active: advertiser.active,
    },
    creativesCount: creatives.length,
    activeCreativesCount: creatives.filter((x) => x.active).length,
    delivery: delivery(c),
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...(withCreatives
      ? {
          creatives: [...creatives]
            .sort((a, b) => a.position - b.position)
            .map((x) => ({
              ...x,
              createdAt: '2026-10-01T12:00:00.000Z',
              updatedAt: '2026-10-01T12:00:00.000Z',
            })),
        }
      : {}),
  };
}

const page = (items, q) => {
  const pageNumber = Number(q.get('page') ?? 1);
  const pageSize = Number(q.get('pageSize') ?? 20);
  return {
    items: items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
    page: pageNumber,
    pageSize,
    total: items.length,
  };
};

function error(send, res, status, code, message, details) {
  send(res, status, {
    error: { code, message, ...(details ? { details } : {}) },
    requestId: 'mock',
  });
  return true;
}

function forced(send, res, op) {
  const failure = failures[op];
  if (!failure) return false;
  delete failures[op];
  return error(send, res, failure.status, failure.code, 'Erro simulado.');
}

/** Dias de `from` a `to` (inclusive), com números fixos para conferir na tela e no CSV. */
function reportOf(campaign, from, to) {
  const days = [];
  for (
    let d = new Date(`${from}T12:00:00Z`);
    d <= new Date(`${to}T12:00:00Z`);
    d = new Date(d.getTime() + DAY)
  ) {
    const index = days.length;
    const impressions = 1000 + index * 100;
    const clicks = 20 + index * 5;
    days.push({
      day: d.toISOString().slice(0, 10),
      impressions,
      clicks,
      ctr: Math.round((clicks / impressions) * 10000) / 10000,
    });
  }
  const impressions = days.reduce((sum, d) => sum + d.impressions, 0);
  const clicks = days.reduce((sum, d) => sum + d.clicks, 0);
  return {
    campaignId: campaign.id,
    from,
    to,
    totals: {
      impressions,
      clicks,
      ctr: impressions ? Math.round((clicks / impressions) * 10000) / 10000 : 0,
    },
    days,
    creatives: campaign.creatives.map((c) => ({
      creativeId: c.id,
      title: c.title,
      impressions,
      clicks,
      ctr: 0.02,
    })),
  };
}

function creativeFrom(campaign, body, current) {
  const advertiser = advertiserOf(campaign);
  const destination = body.destination ?? current?.destination;
  let view = destination;
  if (destination?.type === 'SPACE' && destination.spaceId) {
    const own = advertiser.space?.id === destination.spaceId;
    view = {
      type: 'SPACE',
      space: {
        id: destination.spaceId,
        name: own ? advertiser.space.name : 'Espaço Exemplo A',
        slug: own ? advertiser.space.slug : 'espaco-a',
        showcaseVisible: true,
      },
    };
  }
  let imageUrl = current?.imageUrl ?? null;
  if (body.imageKey === null) imageUrl = null;
  if (typeof body.imageKey === 'string') imageUrl = AD_IMAGE_URL;
  return { view, imageUrl };
}

/** Devolve `true` se tratou a requisição. `body` já vem lido; `log` registra as escritas. */
export async function handleAds({ req, res, path, url, send, body }) {
  const method = req.method ?? 'GET';
  const q = url.searchParams;

  if (path === '/__super-ads-fail') {
    failures[q.get('op')] = { status: Number(q.get('status')), code: q.get('code') };
    send(res, 200, {});
    return true;
  }

  if (path === '/v1/super/ads/advertisers' && method === 'GET') {
    let items = ads.advertisers;
    if (q.get('q'))
      items = items.filter((a) => a.name.toLowerCase().includes(q.get('q').toLowerCase()));
    if (q.get('kind')) items = items.filter((a) => a.kind === q.get('kind'));
    if (q.get('category')) items = items.filter((a) => a.category === q.get('category'));
    if (q.get('active')) items = items.filter((a) => String(a.active) === q.get('active'));
    send(res, 200, page(items.map(advertiserView), q));
    return true;
  }
  if (path === '/v1/super/ads/advertisers' && method === 'POST') {
    if (forced(send, res, 'advertiser-create')) return true;
    if (FORBIDDEN.includes(body.category)) {
      return error(send, res, 422, 'AD_CATEGORY_FORBIDDEN', 'Apostas e álcool não anunciam.');
    }
    let space = null;
    if (body.kind === 'SPACE') {
      space =
        body.spaceId === ID(101)
          ? { id: ID(101), name: 'Espaço Exemplo A', slug: 'espaco-a' }
          : null;
      if (!space) return error(send, res, 422, 'AD_SPACE_NOT_FOUND', 'Espaço inativo.');
      if (ads.advertisers.some((a) => a.active && a.space?.id === space.id)) {
        return error(send, res, 409, 'ADVERTISER_SPACE_TAKEN', 'Espaço já tem anunciante.');
      }
    }
    const advertiser = {
      id: ID(nextId++),
      name: body.name,
      kind: body.kind,
      category: body.category,
      space,
      contactName: body.contactName ?? null,
      contactEmail: body.contactEmail ?? null,
      contactPhone: body.contactPhone ?? null,
      notes: body.notes ?? null,
      active: true,
    };
    ads.advertisers.unshift(advertiser);
    send(res, 201, advertiserView(advertiser));
    return true;
  }
  const advertiserMatch = path.match(/^\/v1\/super\/ads\/advertisers\/([^/]+)$/);
  if (advertiserMatch) {
    const advertiser = ads.advertisers.find((a) => a.id === advertiserMatch[1]);
    if (!advertiser)
      return error(send, res, 404, 'ADVERTISER_NOT_FOUND', 'Anunciante não encontrado.');
    if (method === 'GET') {
      send(res, 200, advertiserView(advertiser));
      return true;
    }
    if (forced(send, res, 'advertiser-update')) return true;
    // Reativar anunciante de espaço exige o espaço ativo (o B está suspenso no mock do Super).
    if (body.active === true && advertiser.space && advertiser.space.id !== ID(101)) {
      return error(send, res, 422, 'AD_SPACE_NOT_FOUND', 'Espaço inativo.');
    }
    Object.assign(advertiser, body);
    send(res, 200, advertiserView(advertiser));
    return true;
  }

  if (path === '/v1/super/ads/campaigns' && method === 'GET') {
    let items = ads.campaigns;
    if (q.get('q')) {
      const term = q.get('q').toLowerCase();
      items = items.filter(
        (c) =>
          c.name.toLowerCase().includes(term) || advertiserOf(c).name.toLowerCase().includes(term),
      );
    }
    if (q.get('advertiserId'))
      items = items.filter((c) => c.advertiserId === q.get('advertiserId'));
    if (q.get('placement')) items = items.filter((c) => c.placement === q.get('placement'));
    if (q.get('status')) items = items.filter((c) => c.status === q.get('status'));
    if (q.get('onAir')) items = items.filter((c) => String(delivery(c).onAir) === q.get('onAir'));
    send(
      res,
      200,
      page(
        items.map((c) => campaignView(c)),
        q,
      ),
    );
    return true;
  }
  if (path === '/v1/super/ads/campaigns' && method === 'POST') {
    if (forced(send, res, 'campaign-create')) return true;
    if (new Date(body.endsAt) <= new Date(body.startsAt)) {
      return error(send, res, 422, 'AD_INVALID_PERIOD', 'Período inválido.');
    }
    const campaign = {
      id: ID(nextId++),
      advertiserId: body.advertiserId,
      name: body.name,
      placement: body.placement,
      startsAt: new Date(body.startsAt).toISOString(),
      endsAt: new Date(body.endsAt).toISOString(),
      cityIds: body.cityIds ?? [],
      sportIds: body.sportIds ?? [],
      weight: body.weight ?? 5,
      status: body.status ?? 'DRAFT',
      creatives: [],
    };
    ads.campaigns.unshift(campaign);
    send(res, 201, campaignView(campaign));
    return true;
  }
  if (path === '/v1/super/ads/creatives/uploads' && method === 'POST') {
    if (forced(send, res, 'upload')) return true;
    const ext =
      body.contentType === 'image/png' ? 'png' : body.contentType === 'image/webp' ? 'webp' : 'jpg';
    const key = `uploads/ads/${body.placement}/${ID(nextId++)}.${ext}`;
    ads.uploads.add(key);
    send(res, 200, {
      uploadUrl: `http://storage.exemplo.test/${key}`,
      method: 'PUT',
      headers: { 'Content-Type': body.contentType },
      key,
      expiresAt: iso(1 / 288),
      format: FORMATS[body.placement],
    });
    return true;
  }

  const campaignMatch = path.match(
    /^\/v1\/super\/ads\/campaigns\/([^/]+)(?:\/(status|duplicate|creatives|creatives\/order|creatives\/[^/]+|report|report\.csv))?$/,
  );
  if (!campaignMatch) return false;
  const campaign = ads.campaigns.find((c) => c.id === campaignMatch[1]);
  if (!campaign) return error(send, res, 404, 'AD_CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
  const action = campaignMatch[2];

  if (!action && method === 'GET') {
    send(res, 200, campaignView(campaign, true));
    return true;
  }
  if (!action && method === 'PATCH') {
    if (body.placement && body.placement !== campaign.placement && campaign.creatives.length > 0) {
      return error(send, res, 409, 'AD_PLACEMENT_LOCKED', 'Vaga travada.');
    }
    Object.assign(campaign, body);
    send(res, 200, campaignView(campaign));
    return true;
  }
  if (action === 'status') {
    campaign.status = body.status;
    send(res, 200, campaignView(campaign));
    return true;
  }
  if (action === 'duplicate') {
    const copy = {
      ...campaign,
      id: ID(nextId++),
      name: `${campaign.name} (cópia)`,
      status: 'DRAFT',
      creatives: campaign.creatives.map((c) => ({ ...c, id: ID(nextId++) })),
    };
    copy.creatives.forEach((c) => {
      c.campaignId = copy.id;
    });
    ads.campaigns.unshift(copy);
    send(res, 201, campaignView(copy, true));
    return true;
  }
  if (action === 'creatives' && method === 'POST') {
    if (forced(send, res, 'creative-save')) return true;
    if (typeof body.imageKey === 'string' && !ads.uploads.has(body.imageKey)) {
      return error(send, res, 422, 'AD_IMAGE_NOT_UPLOADED', 'Imagem não enviada.');
    }
    const advertiser = advertiserOf(campaign);
    const ownSpace =
      advertiser.kind === 'SPACE' &&
      body.destination?.type === 'SPACE' &&
      body.destination.spaceId === advertiser.space?.id;
    if (!body.imageKey && !ownSpace)
      return error(send, res, 422, 'AD_IMAGE_REQUIRED', 'Imagem obrigatória.');
    if (body.destination?.type === 'URL' && !/^https:\/\/\S+$/.test(body.destination.url)) {
      return error(send, res, 422, 'AD_CREATIVE_INVALID', 'Destino inválido.');
    }
    const { view, imageUrl } = creativeFrom(campaign, body);
    const creative = {
      id: ID(nextId++),
      campaignId: campaign.id,
      imageUrl,
      title: body.title,
      body: body.body ?? null,
      ctaLabel: body.ctaLabel,
      destination: view,
      active: body.active ?? true,
      position: campaign.creatives.length + 1,
    };
    campaign.creatives.push(creative);
    send(res, 201, { ...creative, createdAt: iso(0), updatedAt: iso(0) });
    return true;
  }
  if (action === 'creatives/order' && method === 'PUT') {
    body.creativeIds.forEach((id, index) => {
      const creative = campaign.creatives.find((c) => c.id === id);
      if (creative) creative.position = index + 1;
    });
    send(res, 200, campaignView(campaign, true));
    return true;
  }
  const creativeMatch = action?.match(/^creatives\/([^/]+)$/);
  if (creativeMatch && method === 'PATCH') {
    if (forced(send, res, 'creative-save')) return true;
    const creative = campaign.creatives.find((c) => c.id === creativeMatch[1]);
    if (!creative) return error(send, res, 404, 'AD_CREATIVE_NOT_FOUND', 'Peça não encontrada.');
    const { view, imageUrl } = creativeFrom(campaign, body, creative);
    const { imageKey: _, destination: __, ...rest } = body;
    Object.assign(creative, rest, { destination: view, imageUrl });
    send(res, 200, { ...creative, createdAt: iso(0), updatedAt: iso(0) });
    return true;
  }
  if (action === 'report' || action === 'report.csv') {
    const from = q.get('from') ?? '2026-10-01';
    const to = q.get('to') ?? '2026-10-03';
    const report = reportOf(campaign, from, to);
    if (action === 'report') {
      send(res, 200, report);
      return true;
    }
    const pct = (ctr) => (ctr * 100).toFixed(2).replace('.', ',');
    const br = (day) => day.split('-').reverse().join('/');
    const lines = [
      'dia,impressoes,cliques,ctr_percentual',
      ...report.days.map((d) => `${br(d.day)},${d.impressions},${d.clicks},"${pct(d.ctr)}"`),
      `total,${report.totals.impressions},${report.totals.clicks},"${pct(report.totals.ctr)}"`,
    ];
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
    res.end(`﻿${lines.join('\r\n')}\r\n`);
    return true;
  }
  return false;
}
