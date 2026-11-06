// Rotas de aulas do painel (`/v1/manage/spaces/:id/class-sessions` e relatórios) da API simulada.
// Estado e log de chamadas próprios (`/__classes-calls`), como o mock do Super: os testes rodam em
// paralelo e cada um usa a sua sessão de aula, sem zerar o estado dos outros.
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Dia fixo dos dados (quarta-feira); os testes fixam o relógio do navegador em torno dele. */
export const DAY = '2026-11-04';
/** Instante UTC de `hh:mm` locais (America/Sao_Paulo = UTC-3) em `DAY`. */
const at = (hh, mm = 0) => new Date(Date.UTC(2026, 10, 4, hh + 3, mm)).toISOString();

const TEACHER_USER = ID(3); // perfil `teacher` do mock principal (3º em `profiles`)
const TEACHER = { memberId: ID(80), userId: TEACHER_USER, name: 'Professor Rafa', avatarUrl: null };
const OTHER_TEACHER = { memberId: ID(81), userId: ID(55), name: 'Professora Lia', avatarUrl: null };
const COURT = { id: ID(201), name: 'Quadra 1' };
const SPORT = { id: ID(301), slug: 'futevolei', name: 'Futevôlei' };
const GROUPS = [
  { id: ID(701), name: 'Futevôlei iniciante' },
  { id: ID(702), name: 'Futevôlei avançado' },
];

const person = (n, name) => ({ userId: ID(1000 + n), name, avatarUrl: null });
const ANA = person(1, 'Ana Souza');
const BRUNO = person(2, 'Bruno Lima');
const CAIO = person(3, 'Caio Mendes');
const DANI = person(4, 'Dani Rocha');
const EDU = person(5, 'Edu Prado');
const FABIO = person(6, 'Fábio Alves');
const GABI = person(7, 'Gabi Nunes');
const HUGO = person(8, 'Hugo Dias');
const IRIS = person(9, 'Íris Costa');
const JORGE = person(10, 'Jorge Teles');

const att = (p, status, extra = {}) => ({
  ...p,
  status,
  waitlistPosition: null,
  addedByStaff: false,
  ...extra,
});

let sessions;
const classesCalls = [];

/** Estado inicial: uma sessão por cenário de teste (ver `e2e/aulas-sessoes.spec.ts`). */
export function resetClasses() {
  classesCalls.length = 0;
  const base = (n, hour, group, status, capacity, attendances, overrides = {}) => ({
    id: ID(7000 + n),
    classGroup: GROUPS[group],
    sport: SPORT,
    level: null,
    court: COURT,
    teachers: [TEACHER],
    startsAt: at(hour),
    endsAt: at(hour + 1),
    capacity,
    status,
    cancelReason: null,
    openedAt: null,
    closedAt: null,
    cancelledAt: null,
    attendances,
    enrolledStudents: [
      { ...ANA, subscriptionStatus: 'ACTIVE' },
      { ...BRUNO, subscriptionStatus: 'ACTIVE' },
      { ...HUGO, subscriptionStatus: 'ACTIVE' },
      { ...IRIS, subscriptionStatus: 'PAST_DUE' },
    ],
    ...overrides,
  });
  sessions = [
    // 1: abrir, fechar e reabrir a lista.
    base(1, 8, 0, 'SCHEDULED', 4, []),
    // 2: leitura (ocupação, espera com posição) e permissões.
    base(2, 9, 0, 'OPEN', 2, [
      att(ANA, 'CONFIRMED'),
      att(BRUNO, 'CONFIRMED'),
      att(CAIO, 'WAITLIST', { waitlistPosition: 1 }),
      att(DANI, 'WAITLIST', { waitlistPosition: 2, addedByStaff: true }),
    ]),
    // 3: remover aluno (a espera é promovida).
    base(3, 10, 0, 'OPEN', 1, [
      att(ANA, 'CONFIRMED'),
      att(CAIO, 'WAITLIST', { waitlistPosition: 1 }),
    ]),
    // 4: quem já tem presença: outra pessoa marcou antes (409 PRESENCE_ALREADY_MARKED).
    base(4, 11, 0, 'CLOSED', 5, [att(EDU, 'CONFIRMED'), att(ANA, 'PRESENT')]),
    // 5: aula em andamento às 14:00 para marcar presença.
    base(5, 14, 1, 'CLOSED', 5, [att(FABIO, 'CONFIRMED'), att(GABI, 'CONFIRMED')]),
    // 6: cancelar.
    base(6, 15, 1, 'SCHEDULED', 5, [att(ANA, 'CONFIRMED')]),
    // 7: mudar os professores da aula.
    base(7, 16, 1, 'SCHEDULED', 5, []),
    // 8: adicionar aluno com busca.
    base(8, 17, 1, 'OPEN', 5, [att(ANA, 'CONFIRMED')]),
    // 9: cancelada.
    base(9, 18, 1, 'CANCELLED', 5, [att(ANA, 'CONFIRMED')], {
      cancelReason: 'Chuva forte',
      cancelledAt: at(7),
    }),
    // 10: de outro professor.
    base(10, 19, 1, 'SCHEDULED', 5, [], { teachers: [OTHER_TEACHER] }),
    // 11: realizada com presença lançada.
    base(11, 6, 1, 'DONE', 5, [att(ANA, 'PRESENT'), att(BRUNO, 'ABSENT')]),
    // 12: começa às 20:00 com a tela aberta (os botões de presença aparecem sem recarregar).
    base(12, 20, 1, 'CLOSED', 5, [att(FABIO, 'CONFIRMED')]),
  ];
}
resetClasses();

const localDate = (iso) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

const summary = (s) => ({
  id: s.id,
  classGroup: s.classGroup,
  sport: s.sport,
  level: s.level,
  court: s.court,
  teachers: s.teachers,
  startsAt: s.startsAt,
  endsAt: s.endsAt,
  capacity: s.capacity,
  status: s.status,
  confirmedCount: s.attendances.filter((a) => ['CONFIRMED', 'PRESENT', 'ABSENT'].includes(a.status))
    .length,
  waitlistCount: s.attendances.filter((a) => a.status === 'WAITLIST').length,
  cancelReason: s.cancelReason,
});
const detail = (s) => ({
  ...summary(s),
  openedAt: s.openedAt,
  closedAt: s.closedAt,
  cancelledAt: s.cancelledAt,
  attendances: s.attendances,
  enrolledStudents: s.enrolledStudents,
});

function renumber(s) {
  let position = 0;
  for (const a of s.attendances) {
    if (a.status === 'WAITLIST') a.waitlistPosition = ++position;
  }
}
function promote(s) {
  const occupied = s.attendances.filter((a) =>
    ['CONFIRMED', 'PRESENT', 'ABSENT'].includes(a.status),
  ).length;
  const first = s.attendances.find((a) => a.status === 'WAITLIST');
  if (first && occupied < s.capacity) {
    first.status = 'CONFIRMED';
    first.waitlistPosition = null;
  }
  renumber(s);
}

const GROUP_ROWS = GROUPS.map((g, i) => ({
  id: g.id,
  name: g.name,
  sport: SPORT,
  level: null,
  teachers: [TEACHER],
  court: COURT,
  weekday: 3,
  startTime: '08:00',
  durationMin: 60,
  capacity: 5,
  active: true,
  enrolledCount: 4 - i,
  availableSpots: 1 + i,
  createdAt: '2026-10-01T12:00:00.000Z',
}));

const STUDENTS = [ANA, BRUNO, HUGO, IRIS, JORGE];

/**
 * Trata as rotas de aulas do espaço. `roles` são os papéis do perfil na sessão; `userId` é o id do
 * perfil. Devolve `true` se respondeu.
 */
export async function handleClasses({ req, res, path, url, send, fail, readJson, roles, userId }) {
  if (path === '/__classes-calls') {
    send(res, 200, classesCalls);
    return true;
  }
  const m = /^\/v1\/manage\/spaces\/[^/]+(\/.*)$/.exec(path);
  if (!m) return false;
  const sub = m[1];
  const method = req.method ?? 'GET';
  const teacherOnly =
    roles.includes('TEACHER') && !roles.some((r) => r === 'OWNER' || r === 'ADMIN');
  const canManage = roles.includes('OWNER') || roles.includes('ADMIN');
  const own = (s) => !teacherOnly || s.teachers.some((t) => t.userId === userId);

  if (method === 'GET' && sub === '/teachers') {
    send(res, 200, {
      items: [TEACHER, OTHER_TEACHER].map((t) => ({ ...t, activeClassGroupCount: 1 })),
    });
    return true;
  }
  if (method === 'GET' && sub === '/class-groups') {
    send(res, 200, { items: GROUP_ROWS });
    return true;
  }
  if (method === 'GET' && sub === '/subscriptions') {
    send(res, 200, {
      items: [
        { id: ID(3001), student: JORGE, status: 'ACTIVE' },
        { id: ID(3002), student: ANA, status: 'ACTIVE' },
      ],
      nextCursor: null,
    });
    return true;
  }

  if (method === 'GET' && sub === '/class-sessions') {
    const from = url.searchParams.get('from') ?? DAY;
    const to = url.searchParams.get('to') ?? DAY;
    const group = url.searchParams.get('classGroupId');
    const teacher = url.searchParams.get('teacherMemberId');
    const statuses = url.searchParams.getAll('status');
    const items = sessions
      .filter((s) => own(s))
      .filter((s) => localDate(s.startsAt) >= from && localDate(s.startsAt) <= to)
      .filter((s) => !group || s.classGroup.id === group)
      .filter((s) => !teacher || s.teachers.some((t) => t.memberId === teacher))
      .filter((s) => statuses.length === 0 || statuses.includes(s.status))
      .map(summary);
    send(res, 200, { from, to, timeZone: 'America/Sao_Paulo', items });
    return true;
  }

  if (method === 'GET' && sub === '/class-attendances') {
    const group = url.searchParams.get('classGroupId');
    const student = url.searchParams.get('userId');
    if (!group && !student) {
      fail(res, 422, 'ATTENDANCE_FILTER_REQUIRED', 'Informe turma ou aluno.');
      return true;
    }
    const items = [];
    for (const s of sessions.filter(own)) {
      if (group && s.classGroup.id !== group) continue;
      for (const a of s.attendances) {
        if (student && a.userId !== student) continue;
        if (a.status === 'WAITLIST' || a.status === 'CANCELLED') continue;
        items.push({
          id: `${s.id}-${a.userId}`,
          student: { userId: a.userId, name: a.name, avatarUrl: null },
          session: {
            id: s.id,
            classGroup: s.classGroup,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            status: s.status,
          },
          status: a.status,
          waitlistPosition: null,
          addedByStaff: a.addedByStaff,
          updatedAt: at(12),
        });
      }
    }
    const count = (st) => items.filter((i) => i.status === st).length;
    send(res, 200, {
      from: url.searchParams.get('from') ?? DAY,
      to: url.searchParams.get('to') ?? DAY,
      items,
      summary: {
        present: count('PRESENT'),
        absent: count('ABSENT'),
        unmarked: 0,
        attendanceRate: 0.5,
      },
    });
    return true;
  }

  const freq = /^\/class-groups\/([^/]+)\/frequency$/.exec(sub);
  if (method === 'GET' && freq) {
    const group = GROUPS.find((g) => g.id === freq[1]);
    if (!group) {
      fail(res, 404, 'CLASS_GROUP_NOT_FOUND', 'Turma não encontrada.');
      return true;
    }
    send(res, 200, {
      classGroup: group,
      from: url.searchParams.get('from') ?? DAY,
      to: url.searchParams.get('to') ?? DAY,
      sessionsDone: 8,
      sessionsCancelled: 1,
      totals: { present: 14, absent: 4, unmarked: 2, attendanceRate: 0.7 },
      students: [
        { ...ANA, enrolled: true, present: 8, absent: 0, unmarked: 0, attendanceRate: 1 },
        { ...BRUNO, enrolled: true, present: 6, absent: 4, unmarked: 2, attendanceRate: 0.6 },
      ],
    });
    return true;
  }

  const route =
    /^\/class-sessions\/([^/]+)(?:\/(open|close|cancel|attendances|presence)(?:\/([^/]+))?)?$/.exec(
      sub,
    );
  if (!route) return false;
  const session = sessions.find((s) => s.id === route[1]);
  if (!session || !own(session)) {
    fail(res, 404, 'CLASS_SESSION_NOT_FOUND', 'Aula não encontrada.');
    return true;
  }
  const action = route[2];

  if (method === 'GET' && !action) {
    send(res, 200, detail(session));
    return true;
  }

  const body = method === 'DELETE' ? {} : await readJson(req);
  classesCalls.push({ method, path, body });
  const operate =
    canManage || (roles.includes('TEACHER') && session.teachers.some((t) => t.userId === userId));
  const needsManage = (method === 'PATCH' && !action) || action === 'cancel';
  if (needsManage ? !canManage : !operate) {
    fail(res, 403, 'FORBIDDEN', 'Sem permissão.');
    return true;
  }

  if (method === 'PATCH' && !action) {
    if (body.teacherMemberIds) {
      const teachers = [TEACHER, OTHER_TEACHER].filter((t) =>
        body.teacherMemberIds.includes(t.memberId),
      );
      if (teachers.length !== body.teacherMemberIds.length) {
        fail(res, 422, 'TEACHER_NOT_FOUND', 'Professor não encontrado.');
        return true;
      }
      session.teachers = teachers;
    }
    if (body.capacity) session.capacity = body.capacity;
    send(res, 200, detail(session));
    return true;
  }
  if (action === 'open') {
    session.status = 'OPEN';
    session.openedAt = new Date().toISOString();
    send(res, 200, detail(session));
    return true;
  }
  if (action === 'close') {
    session.status = 'CLOSED';
    session.closedAt = new Date().toISOString();
    send(res, 200, detail(session));
    return true;
  }
  if (action === 'cancel') {
    session.status = 'CANCELLED';
    session.cancelReason = body.reason;
    session.cancelledAt = new Date().toISOString();
    send(res, 200, detail(session));
    return true;
  }
  if (action === 'attendances' && method === 'POST') {
    const who = [...STUDENTS].find((p) => p.userId === body.userId);
    if (!who) {
      fail(res, 422, 'USER_NOT_FOUND', 'Aluno não encontrado.');
      return true;
    }
    if (session.attendances.some((a) => a.userId === who.userId)) {
      fail(res, 409, 'ALREADY_IN_SESSION', 'Já está na aula.');
      return true;
    }
    // Jorge já está na lista de outra aula, em outro espaço, no mesmo horário (decisão 37).
    if (who.userId === JORGE.userId) {
      send(res, 409, {
        error: {
          code: 'CLASS_SESSION_OVERLAP',
          message: 'O aluno já está na lista de outra aula no mesmo horário.',
          details: {
            conflict: {
              classGroupName: 'Vôlei Misto',
              spaceName: 'Arena Beira-Mar',
              startsAt: session.startsAt,
              endsAt: session.endsAt,
              status: 'CONFIRMED',
            },
          },
        },
        requestId: 'mock',
      });
      return true;
    }
    const occupied = session.attendances.filter((a) =>
      ['CONFIRMED', 'PRESENT', 'ABSENT'].includes(a.status),
    ).length;
    session.attendances.push(
      att(who, occupied >= session.capacity ? 'WAITLIST' : 'CONFIRMED', { addedByStaff: true }),
    );
    renumber(session);
    send(res, 201, detail(session));
    return true;
  }
  if (action === 'attendances' && method === 'DELETE') {
    const target = session.attendances.find((a) => a.userId === route[3]);
    if (!target) {
      fail(res, 409, 'NOT_IN_SESSION', 'Não está na aula.');
      return true;
    }
    // Cenário da sessão 4: a presença foi marcada por outra pessoa enquanto a tela estava aberta.
    if (session.id === ID(7004) && target.userId === EDU.userId) target.status = 'PRESENT';
    if (target.status === 'PRESENT' || target.status === 'ABSENT') {
      fail(res, 409, 'PRESENCE_ALREADY_MARKED', 'Presença já marcada.');
      return true;
    }
    session.attendances = session.attendances.filter((a) => a !== target);
    promote(session);
    send(res, 200, detail(session));
    return true;
  }
  if (action === 'presence') {
    for (const item of body.items ?? []) {
      let entry = session.attendances.find((a) => a.userId === item.userId);
      if (!entry) {
        const enrolled = session.enrolledStudents.find((s) => s.userId === item.userId);
        if (!enrolled) {
          fail(res, 422, 'STUDENT_NOT_IN_SESSION', 'Aluno fora da aula.');
          return true;
        }
        entry = att(enrolled, 'CONFIRMED');
        session.attendances.push(entry);
      }
      entry.status = item.status;
    }
    send(res, 200, detail(session));
    return true;
  }
  return false;
}
