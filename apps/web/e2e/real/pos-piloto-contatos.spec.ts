import { expect, test } from '@playwright/test';
import {
  anonymous,
  apiAs,
  body,
  courtsAndSport,
  disposeClients,
  errorOf,
  finishSignUp,
  type Json,
  linkIn,
  localDate,
  login,
  RUN,
  SIGN_UP_PHONE,
  saoPauloInstant,
  waitForMail,
} from './support/api';
import { PASSWORD, USERS, WEB } from './support/env';

// A.6, A.11, A.14 e decisão 48: o convite da reserva vira um link público (/r/<token>) que quem não
// tem conta confirma na hora; ao verificar o e-mail numa conta nova, a reserva passa para ela. Cada
// confirmação cria um contato, e a exportação só leva quem deu consentimento e não se descadastrou.
// Cobre RF-CONTACT-01/02/03/04/06/07/08 e RN-CONTACT. Reserva do jogador E2E no "Arena E2E".
test.describe.configure({ mode: 'serial' });

const DAY = localDate(8);
const at = (time: string) => saoPauloInstant(DAY, time).toISOString();

// Três pessoas de fora (a quadra comporta 4: organizador + 3): [0] não consente e cria conta depois;
// [1] consente com o WhatsApp; [2] consente por e-mail e depois se descadastra.
const GUESTS = [
  { name: 'Aline Visitante', email: `aline.${RUN}@exemplo.com`, consent: false },
  { name: 'Bruno Visitante', phone: '(31) 98888-1111', e164: '+5531988881111', consent: true },
  { name: 'Davi Visitante', email: `davi.${RUN}@exemplo.com`, consent: true },
] as const;

const state = {} as {
  spaceId: string;
  bookingId: string;
  tokens: string[];
  unsubscribeLink: string;
};

test.afterAll(disposeClients);

test.beforeAll(async ({ playwright }) => {
  const owner = await apiAs(playwright, USERS.owner);
  state.spaceId = (await body(await owner.get('/v1/me'))).memberships[0].space.id;
  const catalog = await courtsAndSport(owner, state.spaceId);

  const player = await apiAs(playwright, USERS.player);
  const created = await player.post('/v1/bookings', {
    data: {
      spaceId: state.spaceId,
      courtId: catalog.court('Quadra B'),
      sportId: catalog.sportId,
      startsAt: at('15:00'),
      durationMin: 60,
      peopleCount: 4,
    },
  });
  expect(created.status(), JSON.stringify(await created.json())).toBe(201);
  state.bookingId = (await body(created)).id;
});

const publicInvite = (token: string) => `/v1/public/invites/${token}`;

test('RF-CONTACT-01: o organizador convida por link — uma vaga aberta por pessoa, com URL https/web `/r/<token>`', async ({
  playwright,
}) => {
  const player = await apiAs(playwright, USERS.player);
  const res = await player.post(`/v1/bookings/${state.bookingId}/invites`, {
    data: { items: [{}, {}, {}] },
  });
  expect(res.status(), JSON.stringify(await res.json())).toBe(201);
  const open = (await body(res)).participants.filter((p: Json) => !p.isOrganizer);
  expect(open).toHaveLength(3);
  state.tokens = open.map((p: Json) => p.inviteToken);
  for (const [index, participant] of open.entries()) {
    expect(participant.inviteUrl).toBe(`${WEB}/r/${state.tokens[index]}`);
    expect(participant.status).toBe('INVITED');
  }
  // R$ 100 dividido por 4 (organizador + 3): R$ 25 cada.
  expect(open[0].shareCents).toBe(2_500);
});

test('RF-CONTACT-02: a prévia pública traz o mínimo — nada de telefone, e-mail, sobrenome ou ids internos', async ({
  playwright,
}) => {
  const anon = await anonymous(playwright);
  const preview = await body(await anon.get(publicInvite(state.tokens[0] ?? '')));
  expect(preview).toMatchObject({
    status: 'INVITED',
    canAnswer: true,
    accountRequired: false,
    slotTaken: false,
    shareCents: 2_500,
    booking: {
      space: { name: 'Arena E2E' },
      court: { name: 'Quadra B' },
      organizerFirstName: 'Jogador',
      status: 'CONFIRMED',
    },
  });
  const raw = JSON.stringify(preview);
  expect(raw).not.toContain('Jogador E2E'); // só o primeiro nome do organizador
  expect(raw).not.toContain(USERS.player);
  expect(raw).not.toMatch(/"(id|userId|phone|email|participants|inviteToken)"/);
  // Token que não existe.
  const missing = await anon.get(publicInvite('nao-existe'));
  expect(missing.status()).toBe(404);
  expect((await errorOf(missing)).code).toBe('INVITE_NOT_FOUND');
});

test('RF-CONTACT-02: sem conta, a pessoa abre o link, vê a reserva e confirma com nome e e-mail (consentimento desmarcado)', async ({
  page,
  playwright,
}) => {
  const [guest] = GUESTS;
  await page.goto(`/r/${state.tokens[0]}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const summary = page.getByRole('list', { name: 'Reserva' });
  await expect(summary).toContainText('Arena E2E');
  await expect(summary).toContainText('Quadra B');
  await expect(summary).toContainText('Organizado por Jogador');
  await expect(summary).toContainText(/R\$\s*25,00/);
  await expect(summary).toContainText('15:00 às 16:00');
  await expect(summary).not.toContainText(USERS.player);

  await page.getByRole('button', { name: 'Confirmar presença' }).click();
  const consent = page.getByRole('checkbox', {
    name: 'Quero receber novidades e convites do Space Sports',
  });
  await expect(consent).not.toBeChecked();
  await page.getByLabel('Seu nome').fill(guest.name);
  await page.getByLabel('E-mail').fill(guest.email);
  await page.getByRole('button', { name: 'Confirmar presença' }).click();

  await expect(
    page.getByRole('heading', { name: 'Presença confirmada', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir no app' })).toHaveAttribute(
    'href',
    `spacesports://convite/${state.tokens[0]}`,
  );
  const signUp = await page.getByRole('link', { name: 'Criar conta' }).getAttribute('href');
  expect(new URLSearchParams(signUp?.split('?')[1]).get('next')).toBe(
    `/r/${state.tokens[0]}?aceitar=1`,
  );

  // O organizador vê a vaga confirmada, sem conta, com o nome digitado; e é avisado.
  const player = await apiAs(playwright, USERS.player);
  const detail = await body(await player.get(`/v1/bookings/${state.bookingId}`));
  const participant = detail.participants.find((p: Json) => p.name === guest.name);
  expect(participant).toMatchObject({ status: 'ACCEPTED' });
  await expect
    .poll(async () => {
      const { items } = await body(await player.get('/v1/me/notifications'));
      return items.some((n: Json) => n.type === 'BOOKING_INVITE_ANSWERED');
    })
    .toBe(true);
  // Digitar o e-mail num formulário público NÃO cria nem liga conta nenhuma.
  const anon = await anonymous(playwright);
  const signIn = await anon.post('/v1/auth/sign-in/email', {
    data: { email: guest.email, password: PASSWORD },
  });
  expect(signIn.ok()).toBe(false);
});

test('A.14 / RN-CONTACT-02: a vaga é de quem confirmou — repetir é idempotente, outra pessoa recebe INVITE_SLOT_TAKEN', async ({
  playwright,
  browser,
}) => {
  const [guest] = GUESTS;
  const anon = await anonymous(playwright);
  const confirm = (data: object) =>
    anon.post(`${publicInvite(state.tokens[0] ?? '')}/confirm`, { data });

  // A mesma pessoa de novo (mesmo e-mail, com maiúsculas): 200 e a mesma prévia.
  const again = await confirm({ name: guest.name, email: guest.email.toUpperCase() });
  expect(again.status()).toBe(200);
  expect(await body(again)).toMatchObject({ status: 'ACCEPTED', slotTaken: true });

  // Outra pessoa no mesmo link: 409, e nada é gravado para ela.
  const other = await confirm({ name: 'Intrusa', email: `intrusa.${RUN}@exemplo.com` });
  expect(other.status()).toBe(409);
  expect((await errorOf(other)).code).toBe('INVITE_SLOT_TAKEN');
  const owner = await apiAs(playwright, USERS.owner);
  const contacts = await body(await owner.get(`/v1/manage/spaces/${state.spaceId}/contacts`));
  expect(JSON.stringify(contacts)).not.toContain('Intrusa');

  // A prévia diz que a vaga está ocupada, e a tela de quem abre o link depois não oferece confirmar.
  expect(await body(await anon.get(publicInvite(state.tokens[0] ?? '')))).toMatchObject({
    slotTaken: true,
    canAnswer: false,
  });
  const context = await browser.newContext();
  const late = await context.newPage();
  await late.goto(`${WEB}/r/${state.tokens[0]}`);
  await expect(late.getByRole('heading', { name: 'Convite já respondido' })).toBeVisible();
  await expect(late.getByText(/Se não foi você, peça outro link a Jogador/)).toBeVisible();
  await expect(late.getByRole('button', { name: 'Confirmar presença' })).toHaveCount(0);
  await context.close();
});

test('RF-CONTACT-02/03: as outras duas pessoas confirmam — WhatsApp com consentimento (pela tela) e e-mail com consentimento (pela API)', async ({
  page,
  playwright,
}) => {
  // Bruno pela tela, com WhatsApp e a caixa de consentimento marcada.
  const bruno = GUESTS[1];
  await page.goto(`/r/${state.tokens[1]}`);
  await page.getByRole('button', { name: 'Confirmar presença' }).click();
  await page.getByLabel('Seu nome').fill(bruno.name);
  await page.getByLabel('WhatsApp').pressSequentially(bruno.phone.replace(/\D/g, ''));
  await expect(page.getByLabel('WhatsApp')).toHaveValue(bruno.phone);
  await page
    .getByRole('checkbox', { name: 'Quero receber novidades e convites do Space Sports' })
    .check();
  await page.getByRole('button', { name: 'Confirmar presença' }).click();
  await expect(
    page.getByRole('heading', { name: 'Presença confirmada', exact: true }),
  ).toBeVisible();

  // Davi pela API pública (a mesma que a tela chama).
  const anon = await anonymous(playwright);
  const davi = GUESTS[2];
  const res = await anon.post(`${publicInvite(state.tokens[2] ?? '')}/confirm`, {
    data: { name: davi.name, email: davi.email, marketingConsent: davi.consent },
  });
  expect(res.status()).toBe(200);

  const player = await apiAs(playwright, USERS.player);
  const detail = await body(await player.get(`/v1/bookings/${state.bookingId}`));
  const accepted = detail.participants.filter(
    (p: Json) => p.status === 'ACCEPTED' && !p.isOrganizer,
  );
  expect(accepted.map((p: Json) => p.name).sort()).toEqual(GUESTS.map((g) => g.name).sort());
});

test('RF-CONTACT-03: cadastro com o e-mail digitado só vincula a reserva depois de VERIFICAR o e-mail', async ({
  page,
  playwright,
  request,
}) => {
  const [guest] = GUESTS;
  const since = new Date();
  await page.goto(`/r/${state.tokens[0]}`);
  // Já respondido: a página oferece "Criar conta" levando o token.
  await page.getByRole('link', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/cadastro\?next=/);
  await page.getByLabel('Nome').fill('Aline Cadastrada');
  await page.getByLabel('E-mail').fill(guest.email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirmar senha').fill(PASSWORD);
  await finishSignUp(page);
  await expect(page).toHaveURL(/\/verificar-email/);

  // Cadastrada, mas com o e-mail ainda não verificado: a reserva NÃO aparece para ela.
  const before = await page.request.get('/v1/bookings');
  expect(before.status()).toBe(200);
  expect((await body(before)).items).toHaveLength(0);

  // Verifica pelo link do e-mail.
  const mail = await waitForMail(request, guest.email, /Confirme seu e-mail/, { since });
  await page.goto(linkIn(mail, '/v1/auth/verify-email'));
  await expect(page.getByRole('heading', { name: 'E-mail confirmado' })).toBeVisible();

  // Agora a reserva é dela, em Minhas reservas, e a conta recebeu o aviso.
  const mineAfter = await body(await page.request.get('/v1/bookings'));
  expect(mineAfter.items.map((b: Json) => b.id)).toEqual([state.bookingId]);
  const detail = await body(await page.request.get(`/v1/bookings/${state.bookingId}`));
  const me = detail.participants.find((p: Json) => p.isMe);
  expect(me).toMatchObject({ status: 'ACCEPTED', isOrganizer: false });
  await expect
    .poll(async () => {
      const { items } = await body(await page.request.get('/v1/me/notifications'));
      return items.map((n: Json) => n.type);
    })
    .toContain('BOOKING_LINKED');

  // O organizador vê o participante ligado à conta (sem o rótulo de convite aberto).
  const player = await apiAs(playwright, USERS.player);
  const organizerView = await body(await player.get(`/v1/bookings/${state.bookingId}`));
  const accepted = organizerView.participants.filter(
    (p: Json) => p.status === 'ACCEPTED' && !p.isOrganizer,
  );
  expect(accepted).toHaveLength(3);
  expect(accepted.map((p: Json) => p.name)).toContain('Aline Cadastrada');

  // "Continuar" volta ao convite com ?aceitar=1: a reserva já está na conta.
  await page.getByRole('link', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${state.tokens[0]}\\?aceitar=1`));
  await expect(
    page.getByRole('heading', { name: 'Presença confirmada', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('A reserva está na sua conta')).toBeVisible();
});

test('RF-CONTACT-03: conta com e-mail diferente do digitado no convite não recebe a reserva', async ({
  playwright,
  request,
}) => {
  const email = `outra.${RUN}@exemplo.com`;
  const since = new Date();
  const ctx = await anonymous(playwright);
  const signUp = await ctx.post('/v1/auth/sign-up/email', {
    data: { email, name: 'Outra Pessoa', password: PASSWORD, phone: SIGN_UP_PHONE },
  });
  expect(signUp.ok()).toBe(true);
  const mail = await waitForMail(request, email, /Confirme seu e-mail/, { since });
  await ctx.get(linkIn(mail, '/v1/auth/verify-email').replace(WEB, ''), { maxRedirects: 0 });
  const mine = await body(await ctx.get('/v1/bookings'));
  expect(mine.items).toHaveLength(0);
});

// A.16 / RF-CONTACT-03: a vaga confirmada sem conta só vem para a conta com e-mail verificado (ou
// telefone) igual ao contato do participante. Outra conta que tenha o link recebe INVITE_SLOT_TAKEN.
test('A.16 / RF-CONTACT-03: conta de outra pessoa (verificada ou não) com o link NÃO toma a vaga já confirmada', async ({
  playwright,
  request,
}) => {
  const player = await apiAs(playwright, USERS.player);
  const before = await body(await player.get(`/v1/bookings/${state.bookingId}`));
  const bruno = before.participants.find((p: Json) => p.name === 'Bruno Visitante');
  expect(bruno).toMatchObject({ status: 'ACCEPTED' });

  // Conta com e-mail verificado, mas que não é o contato do Bruno.
  const verified = await anonymous(playwright);
  const email = `curiosa.${RUN}@exemplo.com`;
  const since = new Date();
  await verified.post('/v1/auth/sign-up/email', {
    data: { email, name: 'Curiosa Verificada', password: PASSWORD, phone: SIGN_UP_PHONE },
  });
  const mail = await waitForMail(request, email, /Confirme seu e-mail/, { since });
  await verified.get(linkIn(mail, '/v1/auth/verify-email').replace(WEB, ''), { maxRedirects: 0 });
  // E uma conta sem e-mail verificado.
  const unverified = await anonymous(playwright);
  await unverified.post('/v1/auth/sign-up/email', {
    data: {
      email: `curiosa2.${RUN}@exemplo.com`,
      name: 'Curiosa Sem Verificar',
      password: PASSWORD,
      phone: SIGN_UP_PHONE,
    },
  });

  for (const [label, ctx] of [
    ['verificada', verified],
    ['sem verificar', unverified],
  ] as const) {
    const grab = await ctx.post(`/v1/invites/${state.tokens[1]}/accept`);
    expect(grab.status(), label).toBe(409);
    expect((await errorOf(grab)).code, label).toBe('INVITE_SLOT_TAKEN');
    expect((await body(await ctx.get('/v1/bookings'))).items, label).toHaveLength(0);
  }

  // A vaga continua do Bruno, sem conta, e o contato dele não foi ligado a ninguém.
  const after = await body(await player.get(`/v1/bookings/${state.bookingId}`));
  expect(after.participants.find((p: Json) => p.id === bruno.id)).toMatchObject({
    name: 'Bruno Visitante',
    status: 'ACCEPTED',
  });
  const superUser = await apiAs(playwright, USERS.super);
  const contacts = await body(
    await superUser.get('/v1/super/contacts', { params: { q: 'Bruno' } }),
  );
  expect(contacts.items).toHaveLength(1);
  expect(contacts.items[0].userId).toBeNull();
});

test('A.16 / RF-CONTACT-03: a conta com o e-mail verificado do contato traz a vaga para si (aceite idempotente)', async ({
  playwright,
  request,
}) => {
  const davi = GUESTS[2];
  const since = new Date();
  const ctx = await anonymous(playwright);
  await ctx.post('/v1/auth/sign-up/email', {
    data: { email: davi.email, name: davi.name, password: PASSWORD, phone: SIGN_UP_PHONE },
  });
  // Antes de verificar, o e-mail digitado num formulário público não vale como prova.
  const early = await ctx.post(`/v1/invites/${state.tokens[2]}/accept`);
  expect(early.status()).toBe(409);
  expect((await errorOf(early)).code).toBe('INVITE_SLOT_TAKEN');

  const mail = await waitForMail(request, davi.email, /Confirme seu e-mail/, { since });
  await ctx.get(linkIn(mail, '/v1/auth/verify-email').replace(WEB, ''), { maxRedirects: 0 });
  // A verificação já ligou a reserva à conta; o aceite pelo link confirma, sem mudar nada.
  expect((await body(await ctx.get('/v1/bookings'))).items.map((b: Json) => b.id)).toEqual([
    state.bookingId,
  ]);
  const accept = await ctx.post(`/v1/invites/${state.tokens[2]}/accept`);
  expect(accept.status()).toBe(200);
  expect(await body(accept)).toMatchObject({ status: 'ACCEPTED', acceptedByMe: true });
});

test('RF-CONTACT-07: a gestão do espaço vê os contatos da reserva — nome, e-mail/telefone, consentimento e origem', async ({
  page,
  playwright,
}) => {
  const owner = await apiAs(playwright, USERS.owner);
  const { items } = await body(await owner.get(`/v1/manage/spaces/${state.spaceId}/contacts`));
  const byName = Object.fromEntries(items.map((c: Json) => [c.name, c]));
  for (const guest of GUESTS) {
    expect(byName[guest.name], guest.name).toBeTruthy();
    expect(byName[guest.name].origins).toContain('BOOKING_INVITE_SELF');
    expect(Boolean(byName[guest.name].marketingConsentAt), guest.name).toBe(guest.consent);
  }
  expect(byName['Bruno Visitante'].phone).toBe('+5531988881111');
  // Na lista do espaço não há conta vinculada nem id de usuário.
  expect(JSON.stringify(items)).not.toContain('userId');

  // Na tela do painel.
  await login(page, USERS.owner);
  await page.goto('/painel/contatos');
  await expect(page.getByRole('heading', { name: 'Contatos' })).toBeVisible();
  await expect(page.getByText('Bruno Visitante')).toBeVisible();
  await expect(page.getByText('Aline Visitante')).toBeVisible();
});

test('RF-CONTACT-07: a exportação do espaço leva SÓ quem consentiu e não se descadastrou', async ({
  page,
  playwright,
}) => {
  const owner = await apiAs(playwright, USERS.owner);
  const res = await owner.get(`/v1/manage/spaces/${state.spaceId}/contacts/export.csv`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  const csv = await res.text();
  expect(csv).toContain(
    'nome,email,telefone,consentimento_em,origens,ultimo_contato_em,link_descadastro',
  );
  expect(csv).toContain('Bruno Visitante');
  expect(csv).toContain('Davi Visitante');
  // Quem não deu consentimento fica de fora, mesmo tendo confirmado presença.
  expect(csv).not.toContain('Aline');
  expect(csv).not.toContain(`aline.${RUN}`);
  // Cada linha leva o link de descadastro.
  const davi = csv.split('\r\n').find((line) => line.includes('Davi Visitante')) ?? '';
  state.unsubscribeLink = davi.slice(davi.lastIndexOf('http'));
  expect(state.unsubscribeLink).toContain(`${WEB}/descadastro/`);

  // Pela tela: o botão baixa o mesmo conteúdo.
  await login(page, USERS.owner);
  await page.goto('/painel/contatos');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  const path = await file.path();
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(path, 'utf8');
  expect(content).toContain('Bruno Visitante');
  expect(content).not.toContain('Aline');
});

test('RF-CONTACT-08: o descadastro exige o clique, e depois a pessoa sai da exportação (mas segue na lista)', async ({
  page,
  playwright,
}) => {
  // Abrir o link, sozinho, não descadastra (leitores de e-mail visitam links).
  await page.goto(state.unsubscribeLink.replace(WEB, ''));
  await expect(page.getByRole('heading', { name: 'Parar de receber novidades' })).toBeVisible();
  const owner = await apiAs(playwright, USERS.owner);
  const stillThere = await (
    await owner.get(`/v1/manage/spaces/${state.spaceId}/contacts/export.csv`)
  ).text();
  expect(stillThere).toContain('Davi Visitante');

  await page.getByRole('button', { name: 'Confirmar descadastro' }).click();
  await expect(page.getByRole('heading', { name: 'Descadastro feito' })).toBeVisible();

  const csv = await (
    await owner.get(`/v1/manage/spaces/${state.spaceId}/contacts/export.csv`)
  ).text();
  expect(csv).not.toContain('Davi Visitante');
  expect(csv).toContain('Bruno Visitante');
  const { items } = await body(await owner.get(`/v1/manage/spaces/${state.spaceId}/contacts`));
  const davi = items.find((c: Json) => c.name === 'Davi Visitante');
  expect(davi.unsubscribedAt).not.toBeNull();

  // Token adulterado é recusado.
  const anon = await anonymous(playwright);
  const bad = await anon.post('/v1/public/contacts/unsubscribe', { data: { token: 'x.y' } });
  expect(bad.status()).toBe(422);
  expect((await errorOf(bad)).code).toBe('UNSUBSCRIBE_TOKEN_INVALID');
});

test('RF-CONTACT-06: o Super exporta só com consentimento vigente e lista a conta vinculada', async ({
  playwright,
}) => {
  const superUser = await apiAs(playwright, USERS.super);
  const csv = await (await superUser.get('/v1/super/contacts/export.csv')).text();
  expect(csv).toContain('Bruno Visitante');
  for (const hidden of ['Aline', 'Davi Visitante']) expect(csv, hidden).not.toContain(hidden);

  const list = await body(
    await superUser.get('/v1/super/contacts', { params: { hasAccount: 'true', q: 'aline' } }),
  );
  expect(list.items).toHaveLength(1);
  expect(list.items[0]).toMatchObject({ email: GUESTS[0].email });
  expect(list.items[0].userId).not.toBeNull();
  const consenting = await body(
    await superUser.get('/v1/super/contacts', { params: { consent: 'true' } }),
  );
  expect(consenting.items.map((c: Json) => c.name)).toEqual(['Bruno Visitante']);
});

test('multi-tenancy e permissões: o outro espaço e o Professor não veem nem exportam os contatos deste espaço', async ({
  playwright,
}) => {
  const north = await apiAs(playwright, USERS.northOwner);
  const northSpace = (await body(await north.get('/v1/me'))).memberships[0].space.id;
  const own = await body(await north.get(`/v1/manage/spaces/${northSpace}/contacts`));
  expect(JSON.stringify(own)).not.toContain('Visitante');
  const exportOwn = await (
    await north.get(`/v1/manage/spaces/${northSpace}/contacts/export.csv`)
  ).text();
  expect(exportOwn).not.toContain('Visitante');
  // Tentar ler o espaço de outro: sem acesso.
  const foreign = await north.get(`/v1/manage/spaces/${state.spaceId}/contacts`);
  expect([403, 404]).toContain(foreign.status());
  const foreignCsv = await north.get(`/v1/manage/spaces/${state.spaceId}/contacts/export.csv`);
  expect([403, 404]).toContain(foreignCsv.status());

  // Professor do próprio espaço: sem a permissão de contatos.
  const teacher = await apiAs(playwright, USERS.teacher);
  const denied = await teacher.get(`/v1/manage/spaces/${state.spaceId}/contacts`);
  expect(denied.status()).toBe(403);
  // E a base do Super é só do Super.
  const notSuper = await apiAs(playwright, USERS.owner);
  expect((await notSuper.get('/v1/super/contacts')).status()).toBe(403);
});
