// Pagamento online na API simulada (PG.3): recebimentos online do painel (cadastro, modos,
// carteira, contestações, estorno), o detalhe da reserva com cobrança e o /super (taxas, receita,
// cadastros, simulador). Estado por escopo em `scoped.online`, montado por `/__online-setup`.

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SPACE_ID = ID(101);
const CHARGE_ID = ID(7001);
const CHARGEBACK_ID = ID(7101);

const sandbox = {
  label: 'Ambiente de teste',
  testCards: [
    {
      label: 'Aprova',
      number: '4111 1111 1111 1111',
      outcome: 'APPROVED',
      holderName: 'TESTE APROVADO',
      expiry: '12/30',
      cvc: '123',
      description: 'Pagamento aprovado.',
    },
  ],
  rejectedDocument: {
    hint: 'Documento terminado em 0000 é recusado.',
    examples: [{ type: 'CPF', document: '000.000.000-00' }],
  },
  notes: [],
};

function environment(online) {
  return online.disabled === '1'
    ? { provider: 'none', enabled: false, sandbox: null }
    : { provider: 'fake', enabled: true, sandbox };
}

/** Estado do cenário (cadastro, modos, estornos e respostas) guardado no escopo do teste. */
function stateOf(scoped) {
  scoped.online ??= {};
  const online = scoped.online;
  online.merchant ??= 'NOT_STARTED';
  online.bookingMode ??= 'ON_SITE';
  online.classMode ??= 'ON_SITE';
  online.refunds ??= [];
  online.disputed ??= false;
  online.fees ??= { pixFeeBps: 400, cardFeeBps: 600, minFeeCents: 100 };
  online.spaceFees ??= [];
  return online;
}

function merchantOf(online) {
  const status = online.merchant;
  const submitted = status !== 'NOT_STARTED';
  return {
    status,
    documentType: submitted ? 'CNPJ' : null,
    documentMasked: submitted ? '12.345.***/****-**' : null,
    legalName: submitted ? 'Arena Exemplo Ltda' : null,
    responsibleName: submitted ? 'Gestora Ana' : null,
    responsibleCpfMasked: submitted ? '***.982.247-**' : null,
    email: submitted ? 'financeiro@arena.exemplo' : null,
    payoutKind: submitted ? 'BANK_ACCOUNT' : null,
    payoutMasked: submitted ? '****-6' : null,
    rejectionReason:
      status === 'REJECTED'
        ? online.approved === '1'
          ? 'A conta não está no CNPJ do cadastro.'
          : 'Documento não confere com a razão social.'
        : null,
    submittedAt: submitted ? '2026-11-04T12:00:00.000Z' : null,
    // `approved=1`: o espaço já foi aprovado antes (troca de conta em análise ou recusada).
    approvedAt:
      status === 'APPROVED' || online.payoutsPaused || online.approved === '1'
        ? '2026-11-05T12:00:00.000Z'
        : null,
    rejectedAt: status === 'REJECTED' ? '2026-11-05T12:00:00.000Z' : null,
    payoutsPaused: Boolean(online.payoutsPaused),
    // `changeRejected=1`: a última troca de conta foi recusada (decisão 98, continua APPROVED).
    lastRejectedPayoutChange:
      online.changeRejected === '1'
        ? {
            payoutMasked: '****-9',
            reason: 'A conta não está no CNPJ do cadastro.',
            rejectedAt: '2026-11-06T12:00:00.000Z',
          }
        : null,
    paymentEnvironment: environment(online),
  };
}

function settingsOf(online) {
  // `onlineReady`, a regra da API: gateway ligado, espaço ativo e cadastro já aprovado alguma vez.
  // `ready=0` força o bloqueio (ex.: espaço fora de ACTIVE) mesmo com o cadastro aprovado.
  const onlineReady =
    merchantOf(online).approvedAt !== null &&
    online.merchant !== 'REJECTED' &&
    online.disabled !== '1' &&
    online.ready !== '0';
  return {
    paymentEnvironment: environment(online),
    merchantAccountStatus: online.merchant,
    bookingMode: online.bookingMode,
    classMode: online.classMode,
    onlineReady,
    effectiveBookingMode: onlineReady ? online.bookingMode : 'ON_SITE',
    effectiveClassMode: onlineReady ? online.classMode : 'ON_SITE',
    fee: { ...online.fees, feePayer: 'SPACE', custom: false },
  };
}

/** Pix de R$ 120,00 pago em 08/11 18:42, taxa de 4% (R$ 4,80), com os estornos do cenário. */
function chargeOf(online, bookingId) {
  const base = [
    {
      id: ID(7201),
      chargeId: CHARGE_ID,
      kind: 'REFUND',
      status: 'SUCCEEDED',
      amountCents: 4000,
      feeRefundCents: 160,
      reason: 'Quadra sem iluminação',
      reasonCode: 'MANUAL',
      chargeAgain: false,
      itemDiscountCents: 4000,
      requestedBy: ID(1),
      requestedByName: 'Gestora Ana',
      createdAt: '2026-11-09T15:00:00.000Z',
      dispute: null,
    },
  ];
  const refunds = [...base, ...online.refunds];
  const refunded = refunds
    .filter((r) => r.status === 'SUCCEEDED')
    .reduce((sum, r) => sum + r.amountCents, 0);
  const pending = refunds
    .filter((r) => r.status === 'PENDING')
    .reduce((sum, r) => sum + r.amountCents, 0);
  const feeRefunded = refunds
    .filter((r) => r.status === 'SUCCEEDED')
    .reduce((sum, r) => sum + r.feeRefundCents, 0);
  return {
    id: CHARGE_ID,
    spaceId: SPACE_ID,
    payableType: 'BOOKING',
    payableId: bookingId,
    payer: { userId: ID(90), name: 'Maria Oliveira' },
    method: 'PIX',
    status: refunded >= 12000 ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    amountCents: 12000,
    serviceAmountCents: 12000,
    platformFeeCents: 480,
    spaceNetCents: 11520,
    feePayer: 'SPACE',
    feeBps: 400,
    minFeeCents: 100,
    minFeeApplied: false,
    refundedCents: refunded,
    feeRefundedCents: feeRefunded,
    refundableCents: Math.max(12000 - refunded - pending, 0),
    cardBrand: null,
    cardLast4: null,
    expiresAt: null,
    paidAt: '2026-11-08T21:42:00.000Z',
    availableAt: '2026-11-09T03:00:00.000Z',
    transactionId: 'fake_tx_a8f3c0de91c2',
    failureCode: null,
    failureReason: null,
    paymentEnvironment: environment(online),
    createdAt: '2026-11-08T21:40:00.000Z',
    refunds,
  };
}

function openChargeOf(booking) {
  return {
    id: ID(7002),
    method: 'PIX',
    expiresAt: new Date(new Date(booking.startsAt).getTime() - 60 * 60_000).toISOString(),
    createdAt: booking.createdAt,
  };
}

/** A reserva de hoje com o cenário do pagamento online aplicado. */
function bookingOf(online, todayBooking) {
  const b = todayBooking();
  if (online.booking === 'pending') {
    return {
      ...b,
      source: 'APP',
      status: 'PENDING_PAYMENT',
      paymentDueAt: new Date(new Date(b.startsAt).getTime() - 30 * 60_000).toISOString(),
      openOnlineCharge: openChargeOf(b),
    };
  }
  if (online.booking === 'open') return { ...b, source: 'APP', openOnlineCharge: openChargeOf(b) };
  if (online.booking === 'paid') {
    const charge = chargeOf(online, b.id);
    return {
      ...b,
      source: 'APP',
      paidCents: 12000 - charge.refundedCents,
      discountCents: 4000,
      paymentStatus: 'PAID',
    };
  }
  return b;
}

function detailOf(online, todayBooking) {
  const b = bookingOf(online, todayBooking);
  const charge = online.booking === 'paid' ? chargeOf(online, b.id) : null;
  return {
    ...b,
    organizer: { userId: ID(90), name: 'Maria Oliveira', phone: '+5531999998888' },
    suggestedUser: null,
    participants: [],
    payments: charge
      ? [
          {
            id: ID(7301),
            payableType: 'BOOKING',
            payableId: b.id,
            payerUserId: ID(90),
            amountCents: 12000 - charge.refundedCents,
            method: 'PIX',
            channel: 'ONLINE',
            onlineChargeId: CHARGE_ID,
            paidAt: charge.paidAt,
            recordedBy: null,
            note: null,
            reversedAt: null,
            reversedBy: null,
          },
        ]
      : [],
    onlineCharges: charge ? [charge] : online.booking === 'pending' ? [] : [],
  };
}

function walletOf(online) {
  return {
    merchantAccountStatus: online.merchant,
    payoutsPaused: Boolean(online.payoutsPaused),
    paymentEnvironment: environment(online),
    openDisputes: online.disputed
      ? { count: 0, nextRespondBy: null }
      : { count: 1, nextRespondBy: '2030-11-12T23:59:00.000Z' },
    failedPayouts: { count: 0, lastAmountCents: null, lastAt: null },
    timeZone: 'America/Sao_Paulo',
    availableCents: 128440,
    pendingCents: 391200,
    balanceCents: 519640,
    paidOutCents: 1842075,
    upcoming: [
      { date: '2030-11-05', amountCents: 123000 },
      { date: '2030-11-06', amountCents: 46000 },
      { date: '2030-11-07', amountCents: 24000 },
    ],
  };
}

const ledger = [
  {
    id: ID(7401),
    kind: 'SALE',
    amountCents: 12000,
    availableAt: '2030-11-05T03:00:00.000Z',
    available: false,
    chargeId: CHARGE_ID,
    refundId: null,
    payoutId: null,
    method: 'PIX',
    payableType: 'BOOKING',
    payableId: ID(501),
    payerName: 'Maria O.',
    description: 'Reserva · Maria O. · 08/11 18:00',
    createdAt: '2026-11-04T21:42:00.000Z',
  },
  {
    id: ID(7402),
    kind: 'PLATFORM_FEE',
    amountCents: -480,
    availableAt: '2030-11-05T03:00:00.000Z',
    available: false,
    chargeId: CHARGE_ID,
    refundId: null,
    payoutId: null,
    method: 'PIX',
    payableType: 'BOOKING',
    payableId: ID(501),
    payerName: 'Maria O.',
    description: 'Reserva · Maria O. · 08/11 18:00',
    createdAt: '2026-11-04T21:42:00.000Z',
  },
  {
    id: ID(7404),
    kind: 'SALE',
    amountCents: 9000,
    availableAt: '2030-12-04T03:00:00.000Z',
    available: false,
    chargeId: ID(7002),
    refundId: null,
    payoutId: null,
    method: 'CARD',
    payableType: 'SUBSCRIPTION_CHARGE',
    payableId: ID(3001),
    payerName: 'Marina L.',
    description: 'Mensalidade · Marina L. · 11/2026',
    createdAt: '2026-11-04T22:10:00.000Z',
  },
  {
    id: ID(7403),
    kind: 'PAYOUT',
    amountCents: -98000,
    availableAt: '2026-11-03T09:00:00.000Z',
    available: true,
    chargeId: null,
    refundId: null,
    payoutId: ID(7501),
    method: null,
    payableType: null,
    payableId: null,
    payerName: null,
    description: 'Para a conta ****-6',
    createdAt: '2026-11-03T09:00:00.000Z',
  },
];

function chargebackOf(online) {
  const charge = { ...chargeOf(online, ID(501)), method: 'CARD', cardLast4: '0259' };
  delete charge.refunds;
  return {
    id: CHARGEBACK_ID,
    chargeId: CHARGE_ID,
    kind: 'CHARGEBACK',
    status: 'SUCCEEDED',
    amountCents: 12000,
    feeRefundCents: 480,
    reason: null,
    reasonCode: 'CHARGEBACK',
    chargeAgain: false,
    itemDiscountCents: 0,
    requestedBy: null,
    requestedByName: null,
    createdAt: '2026-11-04T12:00:00.000Z',
    itemStartsAt: '2026-11-08T21:00:00.000Z',
    itemPeriodStart: null,
    charge,
    dispute: online.disputed
      ? {
          status: 'RESPONDED',
          respondBy: '2030-11-12T23:59:00.000Z',
          responseText: online.disputed,
          attachmentUrls: [],
          respondedAt: '2026-11-05T12:00:00.000Z',
          resolvedAt: null,
        }
      : {
          status: 'AWAITING_RESPONSE',
          respondBy: '2030-11-12T23:59:00.000Z',
          responseText: null,
          attachmentUrls: [],
          respondedAt: null,
          resolvedAt: null,
        },
  };
}

// --- Super ------------------------------------------------------------------------------------

const figures = (n) => ({
  chargesCount: 402 * n,
  volumeCents: 4_821_000 * n,
  grossFeeCents: 234_460 * n,
  gatewayCostCents: 61_120 * n,
  feeRefundedCents: 9_640 * n,
  feeRechargedCents: 480 * n,
  netRevenueCents: (234_460 - 61_120 - 9_640 + 480) * n,
});

function feesOf(online) {
  return {
    defaults: {
      ...online.fees,
      feePayer: 'SPACE',
      updatedAt: '2026-11-04T12:00:00.000Z',
      updatedByName: 'Super Admin',
    },
    paymentEnvironment: environment(online),
    spaces: online.spaceFees,
  };
}

const superMerchants = [
  {
    ...merchantOf({ merchant: 'PENDING' }),
    spaceId: ID(101),
    spaceName: 'Espaço Exemplo A',
    spaceSlug: 'espaco-a',
  },
  {
    ...merchantOf({ merchant: 'REJECTED' }),
    spaceId: ID(102),
    spaceName: 'Espaço Exemplo B',
    spaceSlug: 'espaco-b',
  },
];

/**
 * Responde as rotas do pagamento online (`sub` é o resto de `/v1/manage/spaces/:id` no painel ou
 * o caminho inteiro no /super). Devolve `true` se respondeu.
 */
export async function handleOnlinePayments({
  req,
  res,
  url,
  sub,
  method,
  send,
  fail,
  readJson,
  calls,
  scoped,
  profile,
  todayBooking,
  withoutMoney,
}) {
  const online = stateOf(scoped);
  const record = async () => {
    const body = await readJson(req);
    calls.push({ path: `${method} ${sub}`, body });
    return body;
  };
  const reply = (status, body) => {
    send(res, status, body);
    return true;
  };

  // Reserva com o cenário do pagamento online (lista, detalhe e registro no local).
  if (online.booking) {
    if (method === 'GET' && sub === '/bookings') {
      const b = bookingOf(online, todayBooking);
      return reply(200, { items: [profile === 'teacher' ? withoutMoney(b) : b], nextCursor: null });
    }
    if (method === 'GET' && sub.startsWith('/bookings/')) {
      const detail = detailOf(online, todayBooking);
      // Professor: sem valores nem cobranças (decisão 53).
      return reply(
        200,
        profile === 'teacher'
          ? { ...withoutMoney(detail), payments: [], onlineCharges: [] }
          : detail,
      );
    }
    if (method === 'POST' && sub === '/payments' && online.booking === 'open') {
      await record();
      send(res, 409, {
        error: { code: 'ONLINE_CHARGE_ALREADY_PAID', message: 'Já pago.' },
        requestId: 'mock',
      });
      return true;
    }
  }

  // --- Painel ---------------------------------------------------------------------------------
  if (sub.startsWith('/online-payments')) {
    if (profile === 'teacher') {
      fail(res, 403, 'SPACE_FORBIDDEN', 'Sem permissão.');
      return true;
    }
    const path = sub.replace('/online-payments', '');
    if (path === '/merchant-account' && method === 'GET') return reply(200, merchantOf(online));
    if (path === '/merchant-account' && method === 'PUT') {
      await record();
      if (profile !== 'manager') {
        fail(res, 403, 'SPACE_FORBIDDEN', 'Sem permissão.');
        return true;
      }
      online.merchant = 'PENDING';
      return reply(200, merchantOf(online));
    }
    if (path === '/merchant-account/payout' && method === 'PUT') {
      await record();
      online.merchant = 'PENDING';
      online.payoutsPaused = true;
      online.changeRejected = undefined;
      return reply(200, merchantOf(online));
    }
    if (path === '/settings' && method === 'GET') return reply(200, settingsOf(online));
    if (path === '/settings' && method === 'PUT') {
      const body = await record();
      if (online.merchant !== 'APPROVED') {
        fail(res, 422, 'MERCHANT_NOT_APPROVED', 'Cadastro não aprovado.');
        return true;
      }
      online.bookingMode = body.bookingMode;
      online.classMode = body.classMode;
      return reply(200, settingsOf(online));
    }
    if (path === '/wallet' && method === 'GET') return reply(200, walletOf(online));
    if (path === '/wallet/entries' && method === 'GET') {
      calls.push({ path: `GET ${sub}`, body: Object.fromEntries(url.searchParams.entries()) });
      const kinds = url.searchParams.getAll('kind');
      const byMethod = url.searchParams.get('method');
      if (kinds.length > 0 || byMethod) {
        const items = ledger.filter(
          (e) =>
            (kinds.length === 0 || kinds.includes(e.kind)) && (!byMethod || e.method === byMethod),
        );
        return reply(200, { items, nextCursor: null, total: items.length });
      }
      // Sem filtro, duas páginas: as vendas na primeira e o resto na segunda. O total finge 30
      // lançamentos, para a tela (25 por página) mostrar "Página 1 de 2".
      return url.searchParams.get('cursor') === 'p2'
        ? reply(200, { items: ledger.slice(2), nextCursor: null, total: 30 })
        : reply(200, { items: ledger.slice(0, 2), nextCursor: 'p2', total: 30 });
    }
    if (path === '/wallet/entries.csv' && method === 'GET') {
      calls.push({ path: `GET ${sub}`, body: Object.fromEntries(url.searchParams.entries()) });
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
      res.end('data;tipo;valor\r\n04/11/2026;Venda;120,00\r\n');
      return true;
    }
    if (path === '/wallet/payouts' && method === 'GET') {
      return reply(200, {
        items: [
          {
            id: ID(7501),
            amountCents: 98000,
            status: 'PAID',
            scheduledFor: '2026-11-03T09:00:00.000Z',
            paidAt: '2026-11-03T09:00:00.000Z',
            failureReason: null,
            createdAt: '2026-11-03T09:00:00.000Z',
          },
        ],
        nextCursor: null,
      });
    }
    if (path === '/charges' && method === 'GET') return reply(200, { items: [], nextCursor: null });
    const refund = /^\/charges\/([^/]+)\/refunds$/.exec(path);
    if (refund && method === 'POST') {
      const body = await record();
      // `stale=1`: outro estorno de R$ 30,00 entrou antes deste (o reembolsável caiu).
      if (online.stale === '1' && !online.staleApplied) {
        online.staleApplied = true;
        online.refunds.push({
          id: ID(7299),
          chargeId: CHARGE_ID,
          kind: 'REFUND',
          status: 'PENDING',
          amountCents: 3000,
          feeRefundCents: 0,
          reason: 'Outro estorno',
          reasonCode: 'MANUAL',
          chargeAgain: false,
          itemDiscountCents: 0,
          requestedBy: ID(50),
          requestedByName: 'Rafa Admin',
          createdAt: new Date().toISOString(),
          dispute: null,
        });
      }
      const charge = chargeOf(online, ID(501));
      const amount = body.amountCents;
      if (amount > charge.refundableCents) {
        send(res, 422, {
          error: {
            code: 'REFUND_EXCEEDS_BALANCE',
            message: 'Acima do saldo.',
            details: { refundableCents: charge.refundableCents },
          },
          requestId: 'mock',
        });
        return true;
      }
      online.refunds.push({
        id: ID(7210 + online.refunds.length),
        chargeId: CHARGE_ID,
        kind: 'REFUND',
        status: 'PENDING',
        amountCents: amount,
        feeRefundCents: 0,
        reason: body.reason,
        reasonCode: 'MANUAL',
        chargeAgain: Boolean(body.chargeAgain),
        itemDiscountCents: 0,
        requestedBy: ID(1),
        requestedByName: profile === 'admin' ? 'Rafa Admin' : 'Gestora Ana',
        createdAt: new Date().toISOString(),
        dispute: null,
      });
      // A API devolve o estorno criado (OnlineRefund).
      return reply(201, online.refunds.at(-1));
    }
    if (path === '/chargebacks' && method === 'GET') {
      return reply(200, { items: [chargebackOf(online)] });
    }
    if (path === `/chargebacks/${CHARGEBACK_ID}/dispute` && method === 'POST') {
      const body = await record();
      online.disputed = body.text;
      return reply(200, chargebackOf(online));
    }
    fail(res, 404, 'NOT_FOUND', 'Rota não encontrada.');
    return true;
  }

  // --- Super ----------------------------------------------------------------------------------
  if (!sub.startsWith('/v1/super/online-payments')) return false;
  const path = sub.replace('/v1/super/online-payments', '');

  if (path.startsWith('/simulator')) {
    if (online.simulator === '0' || online.disabled === '1') {
      fail(res, 404, 'NOT_FOUND', 'Rota não encontrada.');
      return true;
    }
    if (path === '/simulator/charges' && method === 'GET') {
      const status = url.searchParams.get('status');
      const charge = {
        ...chargeOf(online, ID(501)),
        status: 'PENDING',
        paidAt: null,
        expiresAt: '2030-11-08T21:47:00.000Z',
        spaceName: 'Espaço Exemplo A',
      };
      delete charge.refunds;
      return reply(200, { items: !status || status === 'PENDING' ? [charge] : [] });
    }
    if (method === 'POST') {
      await record();
      return reply(200, { events: 1 });
    }
  }
  if (path === '/fees' && method === 'GET') return reply(200, feesOf(online));
  if (path === '/fees' && method === 'PUT') {
    const body = await record();
    online.fees = {
      pixFeeBps: body.pixFeeBps,
      cardFeeBps: body.cardFeeBps,
      minFeeCents: body.minFeeCents,
    };
    return reply(200, feesOf(online));
  }
  const spaceFee = /^\/fees\/spaces\/([^/]+)$/.exec(path);
  if (spaceFee && method === 'PUT') {
    const body = await record();
    online.spaceFees = [
      ...online.spaceFees.filter((s) => s.spaceId !== spaceFee[1]),
      {
        spaceId: spaceFee[1],
        spaceName: 'Espaço Exemplo A',
        pixFeeBps: body.pixFeeBps,
        cardFeeBps: body.cardFeeBps,
        minFeeCents: body.minFeeCents,
        feePayer: null,
        effective: { ...online.fees, feePayer: 'SPACE' },
        updatedAt: '2026-11-04T12:00:00.000Z',
      },
    ];
    return reply(200, feesOf(online));
  }
  if (spaceFee && method === 'DELETE') {
    await record();
    online.spaceFees = online.spaceFees.filter((s) => s.spaceId !== spaceFee[1]);
    return reply(200, feesOf(online));
  }
  if (path === '/merchant-accounts' && method === 'GET') {
    const status = url.searchParams.get('status');
    const items = status ? superMerchants.filter((m) => m.status === status) : superMerchants;
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    return reply(200, { items: items.slice(0, pageSize), page: 1, pageSize, total: items.length });
  }
  if (path === '/revenue' && method === 'GET') {
    return reply(200, {
      period: {
        from: url.searchParams.get('from') ?? '2026-11-01',
        to: url.searchParams.get('to') ?? '2026-11-04',
      },
      totals: figures(1),
      bySpace: [{ ...figures(1), spaceId: ID(101), spaceName: 'Espaço Exemplo A' }],
      byMethod: [{ ...figures(1), method: 'PIX' }],
      byMonth: [{ ...figures(1), month: '2026-11' }],
    });
  }
  if ((path === '/revenue.csv' || path === '/reports/monthly.csv') && method === 'GET') {
    calls.push({ path: `GET ${sub}`, body: Object.fromEntries(url.searchParams.entries()) });
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
    res.end('espaco;valor\r\nEspaço Exemplo A;100,00\r\n');
    return true;
  }
  if (path === '/reports/monthly' && method === 'GET') {
    calls.push({ path: `GET ${sub}`, body: Object.fromEntries(url.searchParams.entries()) });
    return reply(200, {
      month: url.searchParams.get('month'),
      items: [
        {
          ...figures(1),
          spaceId: ID(101),
          spaceName: 'Espaço Exemplo A',
          documentType: 'CNPJ',
          document: '12345678000195',
          legalName: 'Arena Exemplo Ltda',
          invoiceBaseCents: 234_460 - 9_640 + 480,
        },
      ],
      totals: figures(1),
    });
  }
  return false;
}
