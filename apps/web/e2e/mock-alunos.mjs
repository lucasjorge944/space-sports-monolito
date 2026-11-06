// Rotas de assinaturas, mensalidades e presença da API simulada (tarefa 2.12). Os dados são fixos:
// as escritas só registram a chamada em `calls` e devolvem o detalhe, para os testes que rodam em
// paralelo não interferirem uns nos outros. Cada cenário usa o próprio aluno.
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const SPORT = { id: ID(301), name: 'Futevôlei', slug: 'futevolei' };
const SPACE = {
  id: ID(101),
  name: 'Espaço Exemplo A',
  slug: 'espaco-a',
  timeZone: 'America/Sao_Paulo',
};
const COURT = { id: ID(201), name: 'Quadra 1' };

const PLAN_2X = {
  id: ID(1201),
  name: 'Futevôlei 2x por semana',
  sport: SPORT,
  weeklyFrequency: 2,
  billingDay: 10,
};
const PLAN_FREE = {
  id: ID(1202),
  name: 'Futevôlei livre',
  sport: SPORT,
  weeklyFrequency: null,
  billingDay: 5,
};

const TEACHER = { name: 'Paulo Professor', avatarUrl: null };
const SECOND_TEACHER = { name: 'Lia Admin', avatarUrl: null };
const GROUP_BEGINNER = {
  id: ID(1101),
  name: 'Futevôlei Iniciante',
  weekday: 2,
  startTime: '19:00',
  durationMin: 60,
  court: COURT,
  teachers: [TEACHER],
  active: true,
};
const GROUP_ADVANCED = {
  id: ID(1102),
  name: 'Futevôlei Avançado',
  weekday: 4,
  startTime: '20:00',
  durationMin: 90,
  court: COURT,
  teachers: [TEACHER, SECOND_TEACHER],
  active: true,
};

/** Turma pedida que já não está entre as ativas (a lista de turmas do mock não a devolve). */
const GROUP_INACTIVE = {
  id: ID(1103),
  name: 'Futevôlei Extinta',
  weekday: 1,
  startTime: '18:00',
  durationMin: 60,
  court: COURT,
  teachers: [TEACHER],
  active: false,
};

const enrollment = (n, status, classGroup) => ({
  id: ID(2500 + n),
  status,
  startedOn: '2026-09-01',
  endedOn: null,
  classGroup,
});

const student = (n, name) => ({ userId: ID(70 + n), name, avatarUrl: null });

const charge = (n, subscriptionId, over) => ({
  id: ID(3000 + n),
  subscriptionId,
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  dueDate: '2026-10-10',
  amountCents: 18000,
  paidCents: 0,
  dueCents: 18000,
  status: 'PENDING',
  waivedAt: null,
  waiveNotice: null,
  waiveReason: null,
  discountCents: 0,
  openOnlineCharge: null,
  payments: [],
  createdAt: '2026-10-01T09:00:00.000Z',
  ...over,
});

const subscription = (n, who, plan, status, over) => ({
  id: ID(2000 + n),
  space: SPACE,
  plan,
  student: student(n, who),
  status,
  priceCents: 18000,
  intendedPaymentMethod: null,
  startsOn: status === 'PENDING_APPROVAL' ? null : '2026-09-01',
  currentPeriodStart: status === 'PENDING_APPROVAL' ? null : '2026-10-01',
  currentPeriodEnd: status === 'PENDING_APPROVAL' ? null : '2026-10-31',
  cancelAtPeriodEnd: false,
  endsOn: null,
  accessUntil: null,
  accessUntilIfCancelled: status === 'ACTIVE' ? '2026-10-31' : null,
  rejected: false,
  statusReason: null,
  approvedAt: null,
  cancelledAt: null,
  createdAt: '2026-10-20T15:00:00.000Z',
  enrollments: [],
  nextCharge: null,
  overdueCents: 0,
  ...over,
});

// Marina: plano livre, ativa, só na turma Avançado (pode trocar, somar e desmatricular).
const marinaCharges = [
  charge(1, ID(2001), {
    dueDate: '2026-11-10',
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
  }),
  charge(2, ID(2001), {
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    dueDate: '2026-09-10',
    paidCents: 18000,
    dueCents: 0,
    status: 'PAID',
    payments: [
      // Pago pelo app (PG.2b): sem o "Estornar" manual, com a etiqueta "Online".
      {
        id: ID(3900),
        amountCents: 18000,
        method: 'PIX',
        channel: 'ONLINE',
        onlineChargeId: ID(7001),
        paidAt: '2026-09-09T15:00:00.000Z',
      },
    ],
  }),
];
const brunoCharges = [
  charge(3, ID(2005), {
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    dueDate: '2026-09-10',
    status: 'OVERDUE',
  }),
  charge(4, ID(2005), {
    paidCents: 5000,
    dueCents: 13000,
    status: 'OVERDUE',
    payments: [
      {
        id: ID(3901),
        amountCents: 5000,
        method: 'CASH',
        channel: 'ON_SITE',
        onlineChargeId: null,
        paidAt: '2026-10-12T15:00:00.000Z',
      },
    ],
  }),
];
const waivedCharge = charge(5, ID(2006), {
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  dueDate: '2026-08-10',
  status: 'WAIVED',
  dueCents: 0,
  waivedAt: '2026-08-12T15:00:00.000Z',
  waiveNotice: 'Dispensada pelo cancelamento do plano',
  waiveReason: 'Dispensada pelo cancelamento do plano',
});

const SUBSCRIPTIONS = [
  subscription(1, 'Marina Lopes', PLAN_FREE, 'ACTIVE', {
    enrollments: [enrollment(1, 'ACTIVE', GROUP_ADVANCED)],
    nextCharge: {
      chargeId: ID(3001),
      dueDate: '2026-11-10',
      amountCents: 18000,
      status: 'PENDING',
    },
    approvedAt: '2026-09-01T12:00:00.000Z',
  }),
  subscription(2, 'Pedro Pendente', PLAN_FREE, 'PENDING_APPROVAL', {
    enrollments: [enrollment(2, 'PENDING', GROUP_ADVANCED)],
  }),
  subscription(3, 'Ana Aprovável', PLAN_FREE, 'PENDING_APPROVAL', {
    enrollments: [enrollment(3, 'PENDING', GROUP_BEGINNER)],
  }),
  subscription(4, 'Rita Recusável', PLAN_FREE, 'PENDING_APPROVAL', {
    enrollments: [enrollment(4, 'PENDING', GROUP_BEGINNER)],
  }),
  subscription(8, 'Lia Indisponível', PLAN_FREE, 'PENDING_APPROVAL', {
    enrollments: [enrollment(9, 'PENDING', GROUP_INACTIVE)],
  }),
  subscription(5, 'Bruno Atrasado', PLAN_2X, 'PAST_DUE', {
    enrollments: [enrollment(5, 'ACTIVE', GROUP_BEGINNER), enrollment(6, 'ACTIVE', GROUP_ADVANCED)],
    overdueCents: 31000,
    nextCharge: {
      chargeId: ID(3004),
      dueDate: '2026-10-10',
      amountCents: 18000,
      status: 'OVERDUE',
    },
  }),
  // Sara: cancelou com mês pago; segue com acesso e pode desfazer. Uma mensalidade foi dispensada.
  subscription(6, 'Sara Saindo', PLAN_2X, 'ACTIVE', {
    enrollments: [enrollment(7, 'ACTIVE', GROUP_BEGINNER)],
    cancelAtPeriodEnd: true,
    endsOn: '2099-11-30',
    accessUntil: '2099-11-30',
    accessUntilIfCancelled: null,
  }),
  // Otávio: ativo e na turma Avançado; trocar/somar turma esbarra no horário de outra turma dele.
  subscription(11, 'Otávio Choque', PLAN_FREE, 'ACTIVE', {
    enrollments: [enrollment(10, 'ACTIVE', GROUP_ADVANCED)],
  }),
  // Tânia: ativa e sem mês pago: cancelar encerra o acesso na hora.
  subscription(12, 'Tânia Sem Mês Pago', PLAN_FREE, 'ACTIVE', {
    enrollments: [enrollment(11, 'ACTIVE', GROUP_BEGINNER)],
    accessUntilIfCancelled: null,
  }),
  subscription(7, 'Caio Cancelado', PLAN_FREE, 'CANCELLED', {
    cancelAtPeriodEnd: true,
    endsOn: '2026-10-31',
    accessUntil: '2026-10-31',
    cancelledAt: '2026-10-05T12:00:00.000Z',
    enrollments: [{ ...enrollment(8, 'ENDED', GROUP_BEGINNER), endedOn: '2026-10-31' }],
  }),
];

const chargesOf = (subscriptionId) =>
  [...marinaCharges, ...brunoCharges, waivedCharge].filter(
    (c) => c.subscriptionId === subscriptionId,
  );

const CHARGE_ROWS = [...marinaCharges, ...brunoCharges, waivedCharge];
const withContext = (c) => {
  const sub = SUBSCRIPTIONS.find((s) => s.id === c.subscriptionId);
  return {
    ...c,
    student: sub.student,
    plan: { id: sub.plan.id, name: sub.plan.name },
    subscriptionStatus: sub.status,
  };
};

const ATTENDANCES = [
  ['PRESENT', 'DONE', '2026-10-27T22:00:00.000Z'],
  ['ABSENT', 'DONE', '2026-10-22T23:00:00.000Z'],
  ['CONFIRMED', 'DONE', '2026-10-20T22:00:00.000Z'],
  ['CONFIRMED', 'OPEN', '2026-10-29T22:00:00.000Z'],
].map(([status, sessionStatus, startsAt], i) => ({
  id: ID(4000 + i),
  student: student(1, 'Marina Lopes'),
  session: {
    id: ID(4100 + i),
    classGroup: { id: GROUP_ADVANCED.id, name: GROUP_ADVANCED.name },
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 90 * 60_000).toISOString(),
    status: sessionStatus,
  },
  status,
  waitlistPosition: null,
  addedByStaff: false,
  updatedAt: startsAt,
}));

/** Rotas da gestão (`sub` = caminho depois de `/v1/manage/spaces/:id`). Devolve `true` se respondeu. */
export async function handleAlunos({
  req,
  res,
  url,
  sub,
  method,
  send,
  fail,
  readJson,
  calls,
  path,
  profile,
}) {
  const reply = (status, body) => {
    send(res, status, body);
    return true;
  };
  const error = (status, code, message, details) => {
    send(res, status, { error: { code, message, details }, requestId: 'mock' });
    return true;
  };
  const record = async () => {
    const body = await readJson(req);
    calls.push({ path: `${method} ${path}`, body });
    return body;
  };
  const detail = (id) => {
    const s = SUBSCRIPTIONS.find((x) => x.id === id);
    return s ? { ...s, charges: chargesOf(id) } : null;
  };
  // A turma tem o mesmo dia e horário de outra turma do aluno, em outro espaço (decisão 37).
  const scheduleOverlap = () =>
    error(409, 'CLASS_SCHEDULE_OVERLAP', 'O aluno já tem a turma neste horário.', {
      classGroupId: GROUP_BEGINNER.id,
      conflict: {
        classGroupName: 'Vôlei Misto',
        spaceName: 'Arena Beira-Mar',
        weekday: 2,
        startTime: '19:00',
        durationMin: 60,
        timeZone: 'America/Sao_Paulo',
      },
    });
  const noPermission = () => fail(res, 403, 'SPACE_FORBIDDEN', 'Sem permissão.') || true;

  if (method === 'GET' && sub === '/subscriptions') {
    if (profile === 'teacher') return noPermission();
    const statuses = url.searchParams.getAll('status');
    const planId = url.searchParams.get('planId');
    const items = SUBSCRIPTIONS.filter(
      (s) =>
        (statuses.length === 0 || statuses.includes(s.status)) && (!planId || s.plan.id === planId),
    );
    return reply(200, { items, nextCursor: null });
  }
  const one = /^\/subscriptions\/([^/]+)$/.exec(sub);
  if (method === 'GET' && one) {
    const found = detail(one[1]);
    return found
      ? reply(200, found)
      : error(404, 'SUBSCRIPTION_NOT_FOUND', 'Assinatura não encontrada.');
  }

  if (method === 'GET' && sub === '/subscription-charges') {
    const statuses = url.searchParams.getAll('status');
    const overdue = url.searchParams.get('overdue');
    const subscriptionId = url.searchParams.get('subscriptionId');
    const dueFrom = url.searchParams.get('dueFrom');
    const dueTo = url.searchParams.get('dueTo');
    const items = CHARGE_ROWS.filter(
      (c) =>
        (statuses.length === 0 || statuses.includes(c.status)) &&
        (overdue !== 'true' || c.status === 'OVERDUE') &&
        (!subscriptionId || c.subscriptionId === subscriptionId) &&
        (!dueFrom || c.dueDate >= dueFrom) &&
        (!dueTo || c.dueDate <= dueTo),
    ).map(withContext);
    const totalDueCents = items
      .filter((c) => c.status === 'PENDING' || c.status === 'OVERDUE')
      .reduce((sum, c) => sum + c.dueCents, 0);
    return reply(200, { items, nextCursor: null, totalDueCents });
  }
  if (method === 'GET' && sub === '/subscription-charges/delinquents') {
    const bruno = SUBSCRIPTIONS.find((s) => s.id === ID(2005));
    return reply(200, {
      date: '2026-10-28',
      totalOverdueCents: 31000,
      items: [
        {
          subscriptionId: bruno.id,
          subscriptionStatus: 'PAST_DUE',
          student: bruno.student,
          plan: { id: bruno.plan.id, name: bruno.plan.name },
          overdueCount: 2,
          overdueCents: 31000,
          oldestDueDate: '2026-09-10',
          daysOverdue: 48,
        },
      ],
    });
  }

  if (method === 'GET' && sub === '/class-attendances') {
    const userId = url.searchParams.get('userId');
    const items = userId === ID(71) ? ATTENDANCES : [];
    return reply(200, {
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      items,
      summary: {
        present: items.length ? 1 : 0,
        absent: items.length ? 1 : 0,
        unmarked: items.length ? 1 : 0,
        attendanceRate: items.length ? 0.5 : null,
      },
    });
  }
  const frequency = /^\/class-groups\/([^/]+)\/frequency$/.exec(sub);
  if (method === 'GET' && frequency) {
    if (frequency[1] === GROUP_ADVANCED.id) {
      return reply(200, {
        classGroup: { id: GROUP_ADVANCED.id, name: GROUP_ADVANCED.name },
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        sessionsDone: 0,
        sessionsCancelled: 0,
        totals: { present: 0, absent: 0, unmarked: 0, attendanceRate: null },
        students: [],
      });
    }
    return reply(200, {
      classGroup: { id: frequency[1], name: GROUP_BEGINNER.name },
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      sessionsDone: 8,
      sessionsCancelled: 1,
      totals: { present: 20, absent: 4, unmarked: 2, attendanceRate: 0.7692 },
      students: [
        {
          userId: ID(71),
          name: 'Marina Lopes',
          avatarUrl: null,
          enrolled: true,
          present: 7,
          absent: 1,
          unmarked: 0,
          attendanceRate: 0.875,
        },
        {
          userId: ID(79),
          name: 'Tiago Ex-aluno',
          avatarUrl: null,
          enrolled: false,
          present: 3,
          absent: 0,
          unmarked: 0,
          attendanceRate: 1,
        },
      ],
    });
  }

  // Extrato só das mensalidades de aula (o resto do extrato é da API simulada principal).
  if (method === 'GET' && sub === '/statement' && url.searchParams.get('service') === 'CLASS') {
    const entry = {
      id: ID(5000),
      payableType: 'SUBSCRIPTION_CHARGE',
      payableId: ID(3002),
      payerUserId: ID(71),
      amountCents: 18000,
      method: 'PIX',
      paidAt: '2026-10-09T15:00:00.000Z',
      channel: 'ON_SITE',
      onlineChargeId: null,
      recordedBy: ID(1),
      note: null,
      reversedAt: null,
      reversedBy: null,
      service: 'CLASS',
      payerName: 'Marina Lopes',
      recordedByName: 'Gestora Ana',
      bookingId: null,
      bookingStartsAt: null,
      recurringBookingId: null,
      subscriptionId: ID(2001),
      planName: PLAN_FREE.name,
      chargePeriodStart: '2026-10-01',
      courtName: null,
    };
    return reply(200, {
      period: { from: url.searchParams.get('from'), to: url.searchParams.get('to') },
      timeZone: 'America/Sao_Paulo',
      totals: { receivedCents: 36000, paymentsCount: 2, reversedCents: 18000 },
      byMethod: [
        { method: 'PIX', receivedCents: 18000, paymentsCount: 1 },
        { method: 'CASH', receivedCents: 18000, paymentsCount: 1 },
      ],
      byChannel: [{ channel: 'ON_SITE', receivedCents: 36000, paymentsCount: 2 }],
      items: [entry],
      nextCursor: null,
    });
  }

  if (method === 'POST' || method === 'DELETE') {
    const action =
      /^\/subscriptions\/([^/]+)\/(approve|reject|swap-class-group|enrollments|resume-cancel|cancel)(?:\/([^/]+))?$/.exec(
        sub,
      );
    if (action) {
      const body = await record();
      const [, id, name] = action;
      if (name === 'approve' && id === ID(2002) && !body.classGroupIds) {
        return error(409, 'CLASS_GROUP_FULL', 'A turma não tem vagas.', {
          classGroupId: GROUP_ADVANCED.id,
        });
      }
      if (name === 'approve' && id === ID(2004)) return scheduleOverlap();
      if ((name === 'swap-class-group' || name === 'enrollments') && id === ID(2011)) {
        return scheduleOverlap();
      }
      const found = detail(id);
      return found
        ? reply(name === 'enrollments' && method === 'POST' ? 201 : 200, found)
        : error(404, 'SUBSCRIPTION_NOT_FOUND', 'Assinatura não encontrada.');
    }
    const waive = /^\/subscription-charges\/([^/]+)\/waive$/.exec(sub);
    if (waive) {
      const body = await record();
      const found = CHARGE_ROWS.find((c) => c.id === waive[1]);
      if (!found) return error(404, 'SUBSCRIPTION_CHARGE_NOT_FOUND', 'Mensalidade não encontrada.');
      if (found.payments.length > 0) {
        return error(409, 'CHARGE_HAS_PAYMENTS', 'Estorne o pagamento antes.');
      }
      void body;
      return reply(200, {
        ...found,
        status: 'WAIVED',
        dueCents: 0,
        waivedAt: new Date().toISOString(),
      });
    }
  }
  return false;
}
