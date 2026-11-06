// Seed de teste dos E2E (Playwright no web, Maestro no app). Não é o seed de produção: cria um
// espaço FICTÍCIO ("Arena E2E") com quadras, preço, horário, professor, turma e plano próprios. Os
// espaços parceiros (docs/08-espacos-parceiros.md) não são usados nem inventados aqui.
// Uso: DATABASE_URL=postgres://.../<nome>_e2e pnpm exec tsx test/e2e-seed/seed.ts
import { deflateSync } from 'node:zlib';
import { hashPassword } from 'better-auth/crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { createDatabase } from '../../src/db/client.js';
import { seedPaymentScenario } from '../../src/db/demo-payments.js';
import { seedDemoReviews } from '../../src/db/demo-reviews.js';
import {
  accounts,
  adCampaigns,
  adCreatives,
  advertisers,
  attendances,
  bookings,
  cities,
  classGroups,
  classGroupTeachers,
  classSessions,
  classSessionTeachers,
  courtOccupations,
  courtSports,
  courts,
  enrollments,
  plans,
  spaceMembers,
  spaceOpeningHours,
  spaceSettings,
  spaces,
  sports,
  subscriptionCharges,
  subscriptions,
  teacherOccupations,
  users,
} from '../../src/db/schema/index.js';
import { seed } from '../../src/db/seed.js';

export const E2E_PASSWORD = 'senha-e2e-1234';
export const E2E_OWNER_EMAIL = 'dono.e2e@exemplo.com';
export const E2E_PLAYER_EMAIL = 'jogador.e2e@exemplo.com';
export const E2E_PLAYER2_EMAIL = 'jogador2.e2e@exemplo.com';
export const E2E_PLAYER3_EMAIL = 'jogador3.e2e@exemplo.com';
export const E2E_TEACHER_EMAIL = 'professor.e2e@exemplo.com';
export const E2E_SPACE_SLUG = 'arena-e2e';
// Ajustes pós-piloto (e2e/real/pos-piloto-*.spec.ts): segundo espaço, Super e alunos do cancelamento.
export const E2E_SUPER_EMAIL = 'super.e2e@exemplo.com';
// Contas antigas, sem telefone (decisão 66): levadas ao "completar cadastro" antes de usar o painel
// (web) ou o app. Não entram em nenhuma outra regra do seed.
export const E2E_SUPER_NO_PHONE_EMAIL = 'super.semfone.e2e@exemplo.com';
export const E2E_PLAYER_NO_PHONE_EMAIL = 'jogador.semfone.e2e@exemplo.com';
export const E2E_NORTH_OWNER_EMAIL = 'dono.norte.e2e@exemplo.com';
export const E2E_NORTH_SPACE_NAME = 'Arena E2E Norte';
export const E2E_MULTI_TEACHER_EMAIL = 'professor.multi.e2e@exemplo.com';
export const E2E_PAID_STUDENT_EMAIL = 'aluno.pago.e2e@exemplo.com';
export const E2E_UNPAID_STUDENT_EMAIL = 'aluno.sempago.e2e@exemplo.com';
export const E2E_LATE_STUDENT_EMAIL = 'aluno.atrasado.e2e@exemplo.com';
export const E2E_SPACE_NAME = 'Arena E2E';
export const E2E_PRICE_PER_HOUR_CENTS = 10_000;

// Anúncios no ar (AD.5; RF-ADS-04 a 08): o carrossel e o card patrocinado do Explorar do app (Maestro)
// e as listas do /super (Playwright) precisam de dado. Anunciantes FICTÍCIOS, destinos em
// `example.com` (domínio reservado), imagens geradas aqui (data URI) para não depender de storage.
// Os nomes são exportados para os specs.
export const E2E_AD_COMPANY_NAME = 'Loja E2E Esportes';
export const E2E_AD_COMPANY_FEED_NAME = 'Suplementos E2E';
export const E2E_AD_HERO_TITLE = 'Raquetes E2E em oferta';
export const E2E_AD_FEED_TITLE = 'Whey E2E para o jogo';
/** Anunciante do tipo SPACE (Arena E2E Norte): peças sem imagem, destino no próprio espaço. */
export const E2E_AD_SPACE_HERO_TITLE = 'Arena E2E Norte no destaque';
export const E2E_AD_SPACE_FEED_TITLE = 'Arena E2E Norte na lista';

// Avaliações (AV.2; RF-REVIEW-03/04/06/07): autores FICTÍCIOS. A Arena E2E tem 6 (resumo com média
// visível), com uma resposta do Dono e um comentário oculto pelo Super; a Arena E2E Norte tem 2
// (selo "Novo"). Nenhum jogador de teste acima avalia: os fluxos de avaliar partem do zero. Para
// esses fluxos, o jogador.e2e tem uma reserva PASSADA elegível na Arena E2E (terminou há 2 dias, sem
// avaliação): é o que o card "Avalie sua experiência" do app e `.maestro/scripts/past-booking.js`
// procuram (RN-REVIEW-01).
//
// Busca por nota (decisão 109; Maestro `explorar-filtro-nota`): a lista do Explorar precisa de espaços
// que o "4+ estrelas" e o "Melhor avaliados" separem. Sem localização, a ordem padrão é por nome:
//   Arena E2E (4,2, 6 avaliações) · Arena E2E Norte (Novo, 2) · Arena E2E Oeste (3,4, 5) · Arena E2E Sul (4,8, 5)
// e "Melhor avaliados" a muda para Sul, Arena E2E, Oeste e, por último, Norte (o "Novo"). O "4+ estrelas"
// deixa só Arena E2E e Sul. Oeste e Sul são só vitrine (quadra ativa e preço): sem equipe, aulas nem reservas.
export const E2E_SOUTH_SPACE_NAME = 'Arena E2E Sul';
export const E2E_SOUTH_SPACE_SLUG = 'arena-e2e-sul';
export const E2E_WEST_SPACE_NAME = 'Arena E2E Oeste';
export const E2E_WEST_SPACE_SLUG = 'arena-e2e-oeste';
export const E2E_REVIEW_REPLY = 'Obrigado pela visita! Já trocamos a rede da quadra 2.';
export const E2E_REVIEW_HIDDEN_REASON = 'Linguagem ofensiva (seed)';

/** PNG RGB de uma cor só (poucos KB depois do deflate), para a peça com imagem na proporção da vaga. */
function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
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
  header[8] = 8; // 8 bits por canal
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const pngDataUri = (width: number, height: number, rgb: [number, number, number]) =>
  `data:image/png;base64,${solidPng(width, height, rgb).toString('base64')}`;

/** Arredonda `HH:MM` para baixo, para a hora cheia ou meia hora. */
const alignedStart = (time: string) => {
  const [h = '00', m = '00'] = time.split(':');
  return `${h}:${Number(m) >= 30 ? '30' : '00'}`;
};

const url = process.env.DATABASE_URL;
// Apaga as tabelas: só roda em banco de e2e.
if (!url || !/_e2e(\?|$)/.test(url)) {
  console.error('DATABASE_URL precisa apontar para um banco terminado em "_e2e".');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });
const db = createDatabase(pool);
try {
  await db.execute(
    sql`truncate table users, spaces, cities, sports, amenities, advertisers, fake_gateway_objects restart identity cascade`,
  );
  await seed(db);

  const [city] = await db.select().from(cities).limit(1);
  const [sport] = await db.select().from(sports).where(sql`${sports.slug} = 'futevolei'`);
  if (!city || !sport) throw new Error('Cidade/esporte do seed base não encontrados.');

  const password = await hashPassword(E2E_PASSWORD);
  // Decisão 64: todo usuário tem telefone (fictício e não verificado, como o do cadastro). Sem ele,
  // o web e o app pediriam o "completar cadastro" antes de seguir.
  let phones = 0;
  const nextPhone = () => {
    phones += 1;
    return `+55319000001${String(phones).padStart(2, '0')}`;
  };
  const makeUser = async (
    email: string,
    name: string,
    { platformRole, withPhone = true }: { platformRole?: 'SUPER'; withPhone?: boolean } = {},
  ) => {
    const [user] = await db
      .insert(users)
      .values({
        email,
        name,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        phone: withPhone ? nextPhone() : null,
        phoneVerified: false,
        ...(platformRole ? { platformRole } : {}),
      })
      .returning({ id: users.id });
    if (!user) throw new Error('Usuário não criado.');
    await db
      .insert(accounts)
      .values({ userId: user.id, providerId: 'credential', accountId: user.id, password });
    return user.id;
  };
  const ownerId = await makeUser(E2E_OWNER_EMAIL, 'Dono E2E');
  const player1Id = await makeUser(E2E_PLAYER_EMAIL, 'Jogador E2E');
  const player2Id = await makeUser(E2E_PLAYER2_EMAIL, 'Jogador Dois E2E');
  const player3Id = await makeUser(E2E_PLAYER3_EMAIL, 'Jogador Três E2E');
  const teacherId = await makeUser(E2E_TEACHER_EMAIL, 'Professor E2E');
  const teacher2Id = await makeUser('professor2.e2e@exemplo.com', 'Professor Dois E2E');

  const [space] = await db
    .insert(spaces)
    .values({ name: E2E_SPACE_NAME, slug: E2E_SPACE_SLUG, cityId: city.id, status: 'ACTIVE' })
    .returning({ id: spaces.id });
  if (!space) throw new Error('Espaço não criado.');
  await db.insert(spaceMembers).values({
    userId: ownerId,
    spaceId: space.id,
    role: 'OWNER',
    status: 'ACTIVE',
  });
  const [teacher] = await db
    .insert(spaceMembers)
    .values({ userId: teacherId, spaceId: space.id, role: 'TEACHER', status: 'ACTIVE' })
    .returning({ id: spaceMembers.id });
  if (!teacher) throw new Error('Professor não criado.');
  const [teacher2] = await db
    .insert(spaceMembers)
    .values({ userId: teacher2Id, spaceId: space.id, role: 'TEACHER', status: 'ACTIVE' })
    .returning({ id: spaceMembers.id });
  if (!teacher2) throw new Error('Segundo professor não criado.');
  await db.insert(spaceSettings).values({
    spaceId: space.id,
    pricePerHourCents: E2E_PRICE_PER_HOUR_CENTS,
    bookingMinDurationMin: 60,
    bookingMaxDurationMin: 180,
    bookingMinAdvanceMin: 60,
    bookingWindowDays: 30,
    cancellationDeadlineMin: 60,
    acceptedPaymentMethods: ['PIX', 'CASH'],
    // Aulas (RN-CLASS-06/07).
    // Lista de presença aberta/fechada pela gestão (RN-CLASS-04): o e2e de aulas não depende de job.
    attendanceMode: 'MANUAL',
    pastDueBlockEnabled: true,
    pastDueBlockDays: 7,
  });
  // 00:00 → 00:00 = aberto 24h todos os dias: os testes não dependem da hora em que rodam.
  await db.insert(spaceOpeningHours).values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      spaceId: space.id,
      weekday,
      opensAt: '00:00',
      closesAt: '00:00',
    })),
  );
  const [courtA, courtB] = await db
    .insert(courts)
    .values([
      { spaceId: space.id, name: 'Quadra A' },
      { spaceId: space.id, name: 'Quadra B' },
    ])
    .returning({ id: courts.id });
  if (!courtA || !courtB) throw new Error('Quadras não criadas.');
  await db.insert(courtSports).values([
    { courtId: courtA.id, sportId: sport.id, maxPlayers: 4 },
    { courtId: courtB.id, sportId: sport.id, maxPlayers: 4 },
  ]);
  // Aulas (RF-CLASS-02/03): uma turma aos sábados às 07:00 na Quadra A (fora dos horários que os
  // E2E de reserva usam) e um plano 1x/semana. Sem JOBS_ENABLED o job de geração não roda: esta
  // turma fica sem sessões (os testes de aulas criam a própria turma, que gera sessões na criação).
  const [beginner] = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(classGroups)
      .values({
        spaceId: space.id,
        sportId: sport.id,
        name: 'Futevôlei iniciante',
        level: 'BEGINNER',
        courtId: courtA.id,
        weekday: 6,
        startTime: '07:00',
        durationMin: 60,
        capacity: 8,
      })
      .returning({ id: classGroups.id });
    const [row] = rows;
    if (!row) throw new Error('Turma não criada.');
    await tx
      .insert(classGroupTeachers)
      .values({ classGroupId: row.id, spaceId: space.id, teacherMemberId: teacher.id });
    return rows;
  });
  const [basicPlan] = await db
    .insert(plans)
    .values({
      spaceId: space.id,
      sportId: sport.id,
      name: 'Futevôlei 1x/semana',
      weeklyFrequency: 1,
      priceCents: 15_000,
      billingDay: 10,
    })
    .returning({ id: plans.id });
  if (!beginner || !basicPlan) throw new Error('Turma/plano do seed não criados.');
  // O jogador 3 já é aluno ATIVO do espaço (turma de sábado): o painel o oferece como "outro aluno"
  // para reposição numa aula. O pedido dele na turma do e2e de aulas é de outro plano.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
  // Período = mês do calendário em São Paulo (início e fim do mês, pergunta 12 de docs/07).
  const [year = 0, month = 0] = today.split('-').map(Number);
  const periodStart = `${today.slice(0, 8)}01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEnd = `${today.slice(0, 8)}${String(lastDay).padStart(2, '0')}`;
  const [existing] = await db
    .insert(subscriptions)
    .values({
      userId: player3Id,
      planId: basicPlan.id,
      spaceId: space.id,
      status: 'ACTIVE',
      priceCents: 15_000,
      startsOn: today,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    })
    .returning({ id: subscriptions.id });
  if (!existing) throw new Error('Assinatura do jogador 3 não criada.');
  await db
    .insert(enrollments)
    .values({ subscriptionId: existing.id, classGroupId: beginner.id, startedOn: today });

  // Aula do segundo professor que JÁ COMEÇOU (sem job, o servidor não gera sessão de hoje que passou
  // do horário): é a única forma de provar a presença real (RF-CLASS-09) sem controlar o relógio do
  // servidor. Quadra A, com os dois primeiros jogadores confirmados.
  const now = new Date();
  const startsAt = new Date(now.getTime() - 10 * 60_000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
  const local = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', ...options });
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    local({ weekday: 'short' }).format(startsAt),
  );
  const ongoingSession = await db.transaction(async (tx) => {
    const [group] = await tx
      .insert(classGroups)
      .values({
        spaceId: space.id,
        sportId: sport.id,
        name: 'Aula em andamento',
        level: 'BEGINNER',
        courtId: courtA.id,
        weekday,
        // A turma exige hora cheia ou meia hora; a sessão começou há 10 min, a hora é só rótulo.
        startTime: alignedStart(
          local({ hour: '2-digit', minute: '2-digit', hour12: false }).format(startsAt),
        ),
        durationMin: 60,
        capacity: 2,
      })
      .returning({ id: classGroups.id });
    if (!group) throw new Error('Turma em andamento não criada.');
    const [session] = await tx
      .insert(classSessions)
      .values({
        classGroupId: group.id,
        spaceId: space.id,
        courtId: courtA.id,
        startsAt,
        endsAt,
        capacity: 2,
        status: 'CLOSED',
      })
      .returning({ id: classSessions.id });
    if (!session) throw new Error('Sessão em andamento não criada.');
    await tx
      .insert(classGroupTeachers)
      .values({ classGroupId: group.id, spaceId: space.id, teacherMemberId: teacher2.id });
    await tx
      .insert(classSessionTeachers)
      .values({ classSessionId: session.id, spaceId: space.id, teacherMemberId: teacher2.id });
    await tx.insert(teacherOccupations).values({
      userId: teacher2Id,
      spaceId: space.id,
      classSessionId: session.id,
      period: { start: startsAt, end: endsAt },
    });
    return session;
  });
  await db.insert(courtOccupations).values({
    courtId: courtA.id,
    period: { start: startsAt, end: endsAt },
    kind: 'CLASS',
    refId: ongoingSession.id,
  });
  await db.insert(attendances).values(
    [player1Id, player2Id].map((userId) => ({
      sessionId: ongoingSession.id,
      userId,
      status: 'CONFIRMED' as const,
    })),
  );

  // -------------------------------------------------------------------------------------------
  // Ajustes pós-piloto. Tudo num segundo espaço ("Arena E2E Norte"), para não mexer nas listas e
  // contagens do espaço acima, de que os e2e de agenda e aulas dependem.
  // -------------------------------------------------------------------------------------------
  const [superUser] = await db
    .insert(users)
    .values({
      email: E2E_SUPER_EMAIL,
      name: 'Super E2E',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      phone: nextPhone(),
      phoneVerified: false,
      platformRole: 'SUPER',
    })
    .returning({ id: users.id });
  if (!superUser) throw new Error('Usuário Super não criado.');
  await db
    .insert(accounts)
    .values({ userId: superUser.id, providerId: 'credential', accountId: superUser.id, password });

  await makeUser(E2E_SUPER_NO_PHONE_EMAIL, 'Super Sem Telefone E2E', {
    platformRole: 'SUPER',
    withPhone: false,
  });
  await makeUser(E2E_PLAYER_NO_PHONE_EMAIL, 'Jogador Sem Telefone E2E', { withPhone: false });

  const northOwnerId = await makeUser(E2E_NORTH_OWNER_EMAIL, 'Dono Norte E2E');
  const multiTeacherId = await makeUser(E2E_MULTI_TEACHER_EMAIL, 'Professor Multi E2E');
  const paidStudentId = await makeUser(E2E_PAID_STUDENT_EMAIL, 'Aluno Pago E2E');
  const unpaidStudentId = await makeUser(E2E_UNPAID_STUDENT_EMAIL, 'Aluno Sem Mês Pago E2E');
  const lateStudentId = await makeUser(E2E_LATE_STUDENT_EMAIL, 'Aluno Atrasado E2E');

  const [north] = await db
    .insert(spaces)
    .values({
      name: E2E_NORTH_SPACE_NAME,
      slug: 'arena-e2e-norte',
      cityId: city.id,
      status: 'ACTIVE',
    })
    .returning({ id: spaces.id });
  if (!north) throw new Error('Espaço Norte não criado.');
  await db.insert(spaceMembers).values({
    userId: northOwnerId,
    spaceId: north.id,
    role: 'OWNER',
    status: 'ACTIVE',
  });
  const [multiTeacher] = await db
    .insert(spaceMembers)
    .values({ userId: multiTeacherId, spaceId: north.id, role: 'TEACHER', status: 'ACTIVE' })
    .returning({ id: spaceMembers.id });
  if (!multiTeacher) throw new Error('Professor do espaço Norte não criado.');
  await db.insert(spaceSettings).values({
    spaceId: north.id,
    pricePerHourCents: E2E_PRICE_PER_HOUR_CENTS,
    bookingMinDurationMin: 60,
    bookingMaxDurationMin: 180,
    bookingMinAdvanceMin: 60,
    bookingWindowDays: 30,
    cancellationDeadlineMin: 60,
    acceptedPaymentMethods: ['PIX', 'CASH'],
    attendanceMode: 'MANUAL',
    pastDueBlockEnabled: true,
    pastDueBlockDays: 7,
  });
  await db.insert(spaceOpeningHours).values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      spaceId: north.id,
      weekday,
      opensAt: '00:00',
      closesAt: '00:00',
    })),
  );
  const [northCourt] = await db
    .insert(courts)
    .values({ spaceId: north.id, name: 'Quadra Norte' })
    .returning({ id: courts.id });
  if (!northCourt) throw new Error('Quadra Norte não criada.');
  await db.insert(courtSports).values({ courtId: northCourt.id, sportId: sport.id, maxPlayers: 4 });
  const [northGroup] = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(classGroups)
      .values({
        spaceId: north.id,
        sportId: sport.id,
        name: 'Futevôlei Norte terça',
        level: 'BEGINNER',
        courtId: northCourt.id,
        weekday: 2,
        startTime: '19:00',
        durationMin: 60,
        capacity: 10,
      })
      .returning({ id: classGroups.id });
    const [row] = rows;
    if (!row) throw new Error('Turma Norte não criada.');
    await tx
      .insert(classGroupTeachers)
      .values({ classGroupId: row.id, spaceId: north.id, teacherMemberId: multiTeacher.id });
    return rows;
  });
  const [northPlan] = await db
    .insert(plans)
    .values({
      spaceId: north.id,
      sportId: sport.id,
      name: 'Futevôlei Norte 1x',
      weeklyFrequency: 1,
      priceCents: 15_000,
      billingDay: 10,
    })
    .returning({ id: plans.id });
  if (!northGroup || !northPlan) throw new Error('Turma/plano Norte não criados.');

  // Alunos ATIVOS desde o dia 1 do mês, com a mensalidade do mês corrente em aberto e vencendo no
  // último dia do mês (sempre "não vencida", em qualquer dia em que o teste rode): o cancelamento
  // (RN-CLASS-08) depende de a mensalidade do mês estar paga ou não. O aluno atrasado também deve a
  // do mês anterior (VENCIDA).
  const monthOf = (offset: number) => {
    const d = new Date(Date.UTC(year, month - 1 + offset, 1));
    const start = d.toISOString().slice(0, 10);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
    return { start, end };
  };
  const current = monthOf(0);
  const previous = monthOf(-1);
  const northStudents = [
    { userId: paidStudentId, startsOn: current.start, overdue: false },
    { userId: unpaidStudentId, startsOn: current.start, overdue: false },
    { userId: lateStudentId, startsOn: previous.start, overdue: true },
  ];
  for (const student of northStudents) {
    const [sub] = await db
      .insert(subscriptions)
      .values({
        userId: student.userId,
        planId: northPlan.id,
        spaceId: north.id,
        status: 'ACTIVE',
        priceCents: 15_000,
        startsOn: student.startsOn,
        currentPeriodStart: current.start,
        currentPeriodEnd: current.end,
      })
      .returning({ id: subscriptions.id });
    if (!sub) throw new Error('Assinatura Norte não criada.');
    await db
      .insert(enrollments)
      .values({ subscriptionId: sub.id, classGroupId: northGroup.id, startedOn: student.startsOn });
    await db.insert(subscriptionCharges).values({
      subscriptionId: sub.id,
      periodStart: current.start,
      periodEnd: current.end,
      dueDate: current.end,
      amountCents: 15_000,
      status: 'PENDING',
    });
    if (student.overdue) {
      await db.insert(subscriptionCharges).values({
        subscriptionId: sub.id,
        periodStart: previous.start,
        periodEnd: previous.end,
        dueDate: previous.start,
        amountCents: 15_000,
        status: 'OVERDUE',
      });
    }
  }

  // Anúncios no ar nas duas vagas (RF-ADS-04 e 05), por 1 ano, sem filtro de cidade nem de esporte:
  // - carrossel (EXPLORE_HERO): 1 peça de empresa com imagem 2:1 e 1 de anunciante SPACE sem imagem;
  // - lista (EXPLORE_FEED): 1 peça de empresa com imagem 4:5 e 1 de anunciante SPACE sem imagem
  //   (vira o card do espaço com o selo "Patrocinado").
  // Com os 2 espaços do seed na vitrine, o card patrocinado entra depois do 2º espaço da lista.
  const adStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const adEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const insertAd = async (
    advertiserId: string,
    placement: 'EXPLORE_HERO' | 'EXPLORE_FEED',
    creative: Omit<typeof adCreatives.$inferInsert, 'campaignId'>,
  ) => {
    const [campaign] = await db
      .insert(adCampaigns)
      .values({
        advertiserId,
        name: `E2E · ${creative.title}`,
        placement,
        startsAt: adStart,
        endsAt: adEnd,
        weight: 5,
        status: 'ACTIVE',
      })
      .returning({ id: adCampaigns.id });
    if (!campaign) throw new Error('Campanha E2E não criada.');
    await db.insert(adCreatives).values({ ...creative, campaignId: campaign.id });
  };
  const [shop, supplements, northAdvertiser] = await db
    .insert(advertisers)
    .values([
      { name: E2E_AD_COMPANY_NAME, kind: 'COMPANY', category: 'SPORTING_GOODS' },
      { name: E2E_AD_COMPANY_FEED_NAME, kind: 'COMPANY', category: 'SUPPLEMENTS' },
      { name: E2E_NORTH_SPACE_NAME, kind: 'SPACE', spaceId: north.id, category: 'SPORTS_SPACE' },
    ])
    .returning({ id: advertisers.id });
  if (!shop || !supplements || !northAdvertiser) throw new Error('Anunciantes E2E não criados.');
  await insertAd(shop.id, 'EXPLORE_HERO', {
    title: E2E_AD_HERO_TITLE,
    body: 'Raquetes e bolas de beach tennis para a sua partida.',
    ctaLabel: 'Ver ofertas',
    imageUrl: pngDataUri(480, 240, [3, 84, 125]),
    destinationType: 'URL',
    destinationUrl: 'https://example.com/e2e-loja',
  });
  await insertAd(northAdvertiser.id, 'EXPLORE_HERO', {
    title: E2E_AD_SPACE_HERO_TITLE,
    body: null,
    ctaLabel: 'Ver espaço',
    imageUrl: null,
    destinationType: 'SPACE',
    destinationSpaceId: north.id,
  });
  await insertAd(supplements.id, 'EXPLORE_FEED', {
    title: E2E_AD_FEED_TITLE,
    body: 'Suplementos para ter energia antes e se recuperar depois do jogo.',
    ctaLabel: 'Comprar',
    imageUrl: pngDataUri(256, 320, [217, 119, 6]),
    destinationType: 'WHATSAPP',
    whatsappPhone: '+5531900000090',
    whatsappMessage: 'Olá! Vi o anúncio no Space Sports.',
  });
  await insertAd(northAdvertiser.id, 'EXPLORE_FEED', {
    title: E2E_AD_SPACE_FEED_TITLE,
    body: null,
    ctaLabel: 'Ver espaço',
    imageUrl: null,
    destinationType: 'SPACE',
    destinationSpaceId: north.id,
  });

  // Reserva passada elegível para avaliar (RN-REVIEW-01): o jogador.e2e jogou na Quadra B da Arena
  // E2E há 2 dias (terminou há ~47 h, dentro dos 6 meses), confirmada e sem avaliação. Fica no
  // passado e na Quadra B, longe das datas e quadras que os e2e de agenda e reserva usam.
  const pastStart = new Date(
    Math.floor((Date.now() - 2 * 24 * 60 * 60 * 1000) / 3_600_000) * 3_600_000,
  );
  const pastEnd = new Date(pastStart.getTime() + 60 * 60_000);
  const [pastBooking] = await db
    .insert(bookings)
    .values({
      spaceId: space.id,
      courtId: courtB.id,
      organizerUserId: player1Id,
      sportId: sport.id,
      startsAt: pastStart,
      endsAt: pastEnd,
      durationMin: 60,
      peopleCount: 2,
      pricePerHourCents: E2E_PRICE_PER_HOUR_CENTS,
      priceCents: E2E_PRICE_PER_HOUR_CENTS,
      status: 'CONFIRMED',
      source: 'APP',
    })
    .returning({ id: bookings.id });
  if (!pastBooking) throw new Error('Reserva passada do seed não criada.');
  await db.insert(courtOccupations).values({
    courtId: courtB.id,
    period: { start: pastStart, end: pastEnd },
    kind: 'BOOKING',
    refId: pastBooking.id,
  });

  // Avaliações de demonstração (autores fictícios; ver E2E_REVIEW_*).
  const reviewer = (i: number, name: string) => makeUser(`avaliador${i}.e2e@exemplo.com`, name);
  const reviewers = [
    await reviewer(1, 'Mariana Duarte'),
    await reviewer(2, 'Rafael Nogueira'),
    await reviewer(3, 'Camila Rocha'),
    await reviewer(4, 'Diego Fernandes'),
    await reviewer(5, 'Larissa Teixeira'),
    await reviewer(6, 'Felipe Andrade'),
    await reviewer(7, 'Beatriz Lopes'),
    await reviewer(8, 'Gustavo Pires'),
  ] as const;
  await seedDemoReviews(db, space.id, [
    {
      userId: reviewers[0],
      rating: 5,
      tags: ['GOOD_COURT', 'GOOD_SERVICE'],
      comment: 'Quadra impecável e atendimento rápido. Voltamos semana que vem!',
      daysAgo: 2,
    },
    {
      userId: reviewers[1],
      rating: 4,
      tags: ['GOOD_LIGHTING'],
      comment: 'Boa iluminação à noite. A rede da quadra 2 estava um pouco baixa.',
      daysAgo: 5,
      reply: { body: E2E_REVIEW_REPLY, byUserId: ownerId },
    },
    { userId: reviewers[2], rating: 5, tags: ['CLEAN', 'ON_TIME'], daysAgo: 9 },
    {
      userId: reviewers[3],
      rating: 2,
      tags: ['DELAYS'],
      comment: 'Comentário ofensivo de exemplo, oculto pela moderação.',
      daysAgo: 14,
      hidden: { reason: E2E_REVIEW_HIDDEN_REASON, byUserId: superUser.id },
    },
    {
      userId: reviewers[4],
      rating: 5,
      tags: ['GOOD_VALUE'],
      comment: 'Melhor custo-benefício da região.',
      authorKind: 'STUDENT',
      daysAgo: 21,
    },
    { userId: reviewers[5], rating: 4, daysAgo: 40 },
  ]);
  await seedDemoReviews(db, north.id, [
    {
      userId: reviewers[6],
      rating: 4,
      tags: ['EASY_BOOKING'],
      comment: 'Reservei pelo app em um minuto.',
      daysAgo: 3,
    },
    { userId: reviewers[7], rating: 3, tags: ['EXPENSIVE'], daysAgo: 12 },
  ]);

  // Busca por nota (decisão 109): um espaço de vitrine com nota pública alta (Sul, 4,8) e outro com
  // nota pública abaixo de 4 (Oeste, 3,4). Autores novos e fictícios (nenhuma outra regra os usa).
  const showcaseSpace = async (name: string, slug: string) => {
    const [row] = await db
      .insert(spaces)
      .values({ name, slug, cityId: city.id, status: 'ACTIVE' })
      .returning({ id: spaces.id });
    if (!row) throw new Error(`Espaço ${name} não criado.`);
    await db.insert(spaceSettings).values({
      spaceId: row.id,
      pricePerHourCents: E2E_PRICE_PER_HOUR_CENTS,
      bookingMinDurationMin: 60,
      bookingMaxDurationMin: 180,
      bookingMinAdvanceMin: 60,
      bookingWindowDays: 30,
      cancellationDeadlineMin: 60,
      acceptedPaymentMethods: ['PIX', 'CASH'],
      attendanceMode: 'MANUAL',
    });
    const [court] = await db
      .insert(courts)
      .values({ spaceId: row.id, name: 'Quadra Única' })
      .returning({ id: courts.id });
    if (!court) throw new Error(`Quadra de ${name} não criada.`);
    await db.insert(courtSports).values({ courtId: court.id, sportId: sport.id, maxPlayers: 4 });
    return row.id;
  };
  const rater = (i: number, name: string) => makeUser(`avaliador${i}.e2e@exemplo.com`, name);
  const raters = [
    await rater(9, 'Helena Barbosa'),
    await rater(10, 'Igor Moreira'),
    await rater(11, 'Júlia Cardoso'),
    await rater(12, 'Leandro Freitas'),
    await rater(13, 'Marcela Ribeiro'),
  ] as const;
  const southId = await showcaseSpace(E2E_SOUTH_SPACE_NAME, E2E_SOUTH_SPACE_SLUG);
  await seedDemoReviews(
    db,
    southId,
    [5, 5, 5, 5, 4].map((rating, i) => ({
      userId: raters[i] as string,
      rating,
      daysAgo: 3 + i,
    })),
  );
  const westId = await showcaseSpace(E2E_WEST_SPACE_NAME, E2E_WEST_SPACE_SLUG);
  await seedDemoReviews(
    db,
    westId,
    [4, 3, 4, 3, 3].map((rating, i) => ({
      userId: raters[i] as string,
      rating,
      daysAgo: 4 + i,
    })),
  );

  // Pagamento online (RF-ONPAY; decisões 80 a 96): a Arena E2E Norte já tem o cadastro aprovado no
  // gateway fake, os modos opcionais ativos e cobranças pagas (Pix e cartão) e uma estornada; a
  // Arena E2E fica sem cadastro, para os testes do cadastro e dos modos.
  await seedPaymentScenario(db, {
    spaceId: north.id,
    ownerId: northOwnerId,
    playerId: player2Id,
    courtId: northCourt.id,
    sportId: sport.id,
    timeZone: 'America/Sao_Paulo',
    merchant: {
      documentType: 'CNPJ',
      document: '11222333000181',
      legalName: 'Arena E2E Norte Ltda (fictícia)',
      responsibleName: 'Dono Norte E2E',
      email: E2E_NORTH_OWNER_EMAIL,
      phone: '+5531900000199',
    },
    minuteOfDay: 5 * 60,
  });

  console.log('Seed E2E aplicado.');
} finally {
  await pool.end();
}
