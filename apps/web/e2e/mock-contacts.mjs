// Rotas da base de contatos na API simulada (A.11): convite público, descadastro, listas do espaço e
// do Super e vínculo da conta sugerida. O estado fica no escopo do teste (`scoped`), para os testes
// em paralelo não mexerem nos convites e contatos uns dos outros.
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const UNSUBSCRIBE_TOKEN = `${ID(1)}.assinatura_ok-1`;

const inFuture = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();

const booking = (over = {}) => ({
  space: { name: 'Arena Exemplo', slug: 'arena-exemplo', timeZone: 'America/Sao_Paulo' },
  court: { name: 'Quadra 1' },
  sport: { name: 'Futevôlei', slug: 'futevolei' },
  startsAt: inFuture(24),
  endsAt: inFuture(25),
  status: 'CONFIRMED',
  organizerFirstName: 'Marina',
  ...over,
});

/**
 * O token diz o cenário; qualquer outro é convite inexistente. `contact` é o contato que ficou com a
 * vaga: só ele repete a confirmação (A.14); outro recebe INVITE_SLOT_TAKEN. `lostTo`/`lostToAnon`:
 * outra pessoa (com conta / sem conta) confirma a vaga enquanto a página está aberta.
 */
const invites = () => ({
  aberto: { status: 'INVITED', userId: null },
  limite: { status: 'INVITED', userId: null },
  disputado: { status: 'INVITED', userId: null, lostTo: ID(77) },
  disputadoSemConta: {
    status: 'INVITED',
    userId: null,
    lostToAnon: { phone: '+5531911110000', email: null },
  },
  conta: { status: 'INVITED', userId: ID(77) },
  // Convite direto a quem entrou como `player`.
  direto: { status: 'INVITED', userId: ID(78), profile: 'player' },
  ocupada: { status: 'ACCEPTED', userId: ID(77) },
  respondido: {
    status: 'ACCEPTED',
    userId: null,
    contact: { phone: '+5531999990000', email: 'ja@exemplo.com' },
  },
  // Confirmado sem conta por alguém cujo contato não é o da sessão.
  alheio: { status: 'ACCEPTED', userId: null, foreignContact: true },
  // A prévia ainda diz que dá para trazer, mas o aceite descobre que a vaga é de outra pessoa.
  tomado: { status: 'ACCEPTED', userId: null, lostOnAccept: true },
  recusado: { status: 'DECLINED', userId: null },
  cancelado: { status: 'INVITED', userId: null, booking: { status: 'CANCELLED' } },
  expirado: { status: 'INVITED', userId: null, booking: { status: 'COMPLETED' } },
  terminado: {
    status: 'ACCEPTED',
    userId: null,
    booking: { startsAt: inFuture(-3), endsAt: inFuture(-2) },
  },
});

function preview(invite) {
  const data = booking(invite.booking);
  const open = data.status === 'CONFIRMED' && new Date(data.endsAt) > new Date();
  return {
    status: invite.status,
    canAnswer: invite.status === 'INVITED' && !invite.userId && open,
    accountRequired: invite.userId !== null,
    // Alguém já ficou com a vaga, com ou sem conta (a prévia é anônima, não diz quem).
    slotTaken: invite.status === 'ACCEPTED',
    shareCents: 6000,
    booking: data,
  };
}

/** Mesmo telefone ou mesmo e-mail do contato que ficou com a vaga. */
const sameContact = (contact, body) =>
  !!contact &&
  ((!!body.phone && body.phone === contact.phone) ||
    (!!body.email && body.email.toLowerCase() === contact.email?.toLowerCase()));

const AT = '2026-10-01T15:00:00.000Z';

const spaceContacts = () => [
  {
    id: ID(1),
    name: 'Bruna Lima',
    email: 'bruna@exemplo.com',
    phone: '+5531988887777',
    marketingConsentAt: AT,
    origins: ['BOOKING_INVITE_SELF'],
    firstTouchAt: AT,
    lastTouchAt: AT,
    unsubscribedAt: null,
  },
  {
    id: ID(2),
    name: null,
    email: 'semnome@exemplo.com',
    phone: null,
    marketingConsentAt: null,
    origins: ['DESK_BOOKING', 'RECURRING_DESK'],
    firstTouchAt: '2026-09-15T15:00:00.000Z',
    lastTouchAt: AT,
    unsubscribedAt: null,
  },
  {
    id: ID(3),
    name: 'Davi Reis',
    email: null,
    phone: '+5531977776666',
    marketingConsentAt: AT,
    origins: ['BOOKING_INVITE_ORGANIZER'],
    firstTouchAt: AT,
    lastTouchAt: AT,
    unsubscribedAt: AT,
  },
];

const superContacts = () => [
  {
    id: ID(1),
    name: 'Bruna Lima',
    email: 'bruna@exemplo.com',
    phone: '+5531988887777',
    userId: ID(8),
    marketingConsentAt: AT,
    unsubscribedAt: null,
    createdAt: AT,
    spaces: [
      {
        spaceId: ID(101),
        spaceName: 'Espaço Exemplo A',
        name: 'Bruninha',
        email: null,
        phone: '+5531988887777',
        marketingConsentAt: AT,
        origins: ['BOOKING_INVITE_SELF'],
        firstTouchAt: AT,
        lastTouchAt: AT,
      },
    ],
  },
  {
    id: ID(2),
    name: 'Caio Prado',
    email: 'caio@exemplo.com',
    phone: null,
    userId: null,
    marketingConsentAt: null,
    unsubscribedAt: null,
    createdAt: AT,
    spaces: [],
  },
];

function filtered(items, url) {
  const q = url.searchParams.get('q')?.toLowerCase();
  const consent = url.searchParams.get('consent');
  const origin = url.searchParams.get('origin');
  const hasAccount = url.searchParams.get('hasAccount');
  return items.filter((c) => {
    if (q && !`${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q)) return false;
    const active = c.marketingConsentAt !== null && c.unsubscribedAt === null;
    if (consent && String(active) !== consent) return false;
    if (origin && !c.origins?.includes(origin)) return false;
    if (hasAccount && String(c.userId !== null) !== hasAccount) return false;
    return true;
  });
}

const csv = (rows) =>
  `﻿nome,email,telefone,consentimento_em,origens,ultimo_contato_em,link_descadastro\r\n${rows.join('\r\n')}\r\n`;

function sendCsv(res) {
  res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
  res.end(
    csv([
      `Bruna Lima,bruna@exemplo.com,+5531988887777,01/10/2026,,01/10/2026,http://localhost:3100/descadastro/${UNSUBSCRIBE_TOKEN}`,
    ]),
  );
}

export async function handleContacts({
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
}) {
  const method = req.method;
  scoped.invites ??= invites();
  scoped.superContacts ??= superContacts();

  const pub = /^\/v1\/public\/invites\/([^/]+)(\/confirm|\/decline)?$/.exec(path);
  if (pub) {
    const [, token, action] = pub;
    const invite = scoped.invites[token];
    if (!invite) {
      fail(res, 404, 'INVITE_NOT_FOUND', 'Convite não encontrado.');
      return true;
    }
    if (!action) {
      send(res, 200, preview(invite));
      return true;
    }
    const body = await readJson(req);
    calls.push({ path: `POST /public/invites/${token}${action}`, body });
    if (token === 'limite') {
      fail(res, 429, 'TOO_MANY_REQUESTS', 'Muitas tentativas.');
      return true;
    }
    if (action === '/confirm') {
      // Outra pessoa confirmou primeiro, depois de a página carregar a prévia.
      if (invite.lostTo) {
        Object.assign(invite, { status: 'ACCEPTED', userId: invite.lostTo, lostTo: undefined });
      } else if (invite.lostToAnon) {
        Object.assign(invite, {
          status: 'ACCEPTED',
          contact: invite.lostToAnon,
          lostToAnon: undefined,
        });
      }
      if (invite.status === 'ACCEPTED') {
        // A mesma pessoa repete sem mudar nada; outra perde a vaga (A.14).
        if (!invite.userId && sameContact(invite.contact, body)) {
          send(res, 200, preview(invite));
          return true;
        }
        fail(res, 409, 'INVITE_SLOT_TAKEN', 'Esta vaga já foi preenchida por outra pessoa.');
        return true;
      }
      invite.status = 'ACCEPTED';
      invite.contact = { phone: body.phone ?? null, email: body.email ?? null };
      send(res, 200, preview(invite));
      return true;
    }
    if (invite.status !== 'INVITED' || invite.userId) {
      fail(res, 409, 'INVITE_UNAVAILABLE', 'Este convite não está mais disponível.');
      return true;
    }
    invite.status = 'DECLINED';
    send(res, 200, preview(invite));
    return true;
  }

  const account = /^\/v1\/invites\/([^/]+)(\/accept|\/decline)?$/.exec(path);
  if (account) {
    const [, token, action] = account;
    const invite = scoped.invites[token];
    if (!session) {
      fail(res, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
      return true;
    }
    if (!invite) {
      fail(res, 404, 'INVITE_NOT_FOUND', 'Convite não encontrado.');
      return true;
    }
    const mine = () => invite.userId === session.id || invite.profile === session.profile;
    const authPreview = () => ({
      participantId: ID(801),
      status: invite.status,
      shareCents: 6000,
      acceptedByMe: invite.status === 'ACCEPTED' && mine(),
      slotTaken:
        invite.status === 'ACCEPTED' &&
        !mine() &&
        (invite.userId !== null || invite.foreignContact === true),
      forAnotherAccount: invite.status === 'INVITED' && invite.userId !== null && !mine(),
      booking: booking(invite.booking),
    });
    if (action) {
      calls.push({ path: `POST /invites/${token}${action}`, body: {} });
      if (invite.userId && !mine()) {
        fail(res, 409, 'INVITE_UNAVAILABLE', 'Este convite não está mais disponível.');
        return true;
      }
      if (invite.foreignContact || invite.lostOnAccept) {
        Object.assign(invite, { foreignContact: true, lostOnAccept: false });
        fail(res, 409, 'INVITE_SLOT_TAKEN', 'Esta vaga já foi preenchida por outra pessoa.');
        return true;
      }
      if (action === '/accept') Object.assign(invite, { status: 'ACCEPTED', userId: session.id });
      else invite.status = 'DECLINED';
    }
    send(res, 200, authPreview());
    return true;
  }

  if (path === '/v1/public/contacts/unsubscribe' && method === 'POST') {
    const body = await readJson(req);
    calls.push({ path: 'POST /public/contacts/unsubscribe', body });
    if (body.token !== UNSUBSCRIBE_TOKEN) {
      fail(res, 422, 'UNSUBSCRIBE_TOKEN_INVALID', 'Link de descadastro inválido.');
      return true;
    }
    send(res, 200, { unsubscribed: true });
    return true;
  }

  if (/^\/v1\/manage\/spaces\/[^/]+\/contacts\/export\.csv$/.test(path)) {
    calls.push({ path: 'GET /contacts/export.csv', body: Object.fromEntries(url.searchParams) });
    sendCsv(res);
    return true;
  }
  if (/^\/v1\/manage\/spaces\/[^/]+\/contacts$/.test(path)) {
    const items = filtered(spaceContacts(), url);
    send(res, 200, { items, page: 1, pageSize: 20, total: items.length });
    return true;
  }

  const link = /^\/v1\/manage\/spaces\/[^/]+\/bookings\/([^/]+)\/confirm-link$/.exec(path);
  if (link && method === 'POST') {
    const body = await readJson(req);
    calls.push({ path: 'POST /bookings/confirm-link', body });
    if ((req.headers.cookie ?? '').includes('e2e-stale-link=1')) {
      fail(res, 409, 'SUGGESTED_USER_MISMATCH', 'A sugestão mudou.');
      return true;
    }
    scoped.linked = true;
    send(res, 200, {});
    return true;
  }

  if (path === '/v1/super/contacts/export.csv') {
    if (!session?.super) return false;
    calls.push({
      path: 'GET /super/contacts/export.csv',
      body: Object.fromEntries(url.searchParams),
    });
    sendCsv(res);
    return true;
  }
  if (path === '/v1/super/contacts') {
    if (!session?.super) return false;
    let items = filtered(scoped.superContacts, url);
    const spaceId = url.searchParams.get('spaceId');
    if (spaceId) items = items.filter((c) => c.spaces.some((s) => s.spaceId === spaceId));
    send(res, 200, { items, page: 1, pageSize: 20, total: items.length });
    return true;
  }
  const remove = /^\/v1\/super\/contacts\/([^/]+)$/.exec(path);
  if (remove && method === 'DELETE') {
    if (!session?.super) return false;
    calls.push({ path: `DELETE /super/contacts/${remove[1]}`, body: {} });
    scoped.superContacts = scoped.superContacts.filter((c) => c.id !== remove[1]);
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}
