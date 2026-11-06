import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts, users } from '../../src/db/schema/index.js';
import { first } from '../db/helpers.js';
import {
  API_URL,
  createTestApp,
  PASSWORD,
  PHONE,
  SESSION_COOKIE,
  sessionCookie,
  signUp,
  type TestApp,
  WEB_ORIGIN,
} from './helpers.js';

// RF-AUTH-01 (e-mail + senha + telefone, decisão 64) e RF-AUTH-04 (mesma conta no web e no app).

describe('cadastro e login por e-mail', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('cadastra com o e-mail normalizado, abre sessão e envia o e-mail de verificação', async () => {
    const res = await t
      .http()
      .post('/v1/auth/sign-up/email')
      .send({
        name: 'Maria Souza',
        email: 'Maria.Souza@Exemplo.COM',
        password: PASSWORD,
        phone: '+5531999998888',
      })
      .expect(200);

    expect(res.body.user).toMatchObject({
      name: 'Maria Souza',
      email: 'maria.souza@exemplo.com',
      emailVerified: false,
      phoneNumber: '+5531999998888',
      phoneNumberVerified: false,
    });
    expect(res.body.token).toEqual(expect.any(String));
    expect(sessionCookie(res)).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(res.headers['set-auth-token']).toEqual(expect.any(String));

    const row = first(await t.db.select().from(users).where(eq(users.id, res.body.user.id)));
    expect(row).toMatchObject({
      email: 'maria.souza@exemplo.com',
      platformRole: 'USER',
      status: 'ACTIVE',
      phone: '+5531999998888',
      phoneVerified: false,
    });
    // id do banco (uuid v7), não o gerado pelo Better Auth.
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    const credential = first(await t.db.select().from(accounts).where(eq(accounts.userId, row.id)));
    expect(credential).toMatchObject({ providerId: 'credential', accountId: row.id });
    expect(credential.password).not.toContain(PASSWORD);

    const mail = await t.mailer.lastTo('maria.souza@exemplo.com');
    expect(mail.subject).toBe('Confirme seu e-mail');
    expect(mail.text).toContain('Olá, Maria Souza!');
    expect(mail.text).toContain(`${API_URL}/v1/auth/verify-email?token=`);
  });

  it('o link do e-mail confirma o endereço', async () => {
    const mail = await t.mailer.lastTo('maria.souza@exemplo.com');
    const url = new URL(/(http\S+verify-email\S+)/.exec(mail.text)?.[1] ?? 'invalido:');
    expect(url.searchParams.get('token')).toBeTruthy();
    // Sem callbackURL no cadastro, o Better Auth redireciona para a raiz da API.
    await t.http().get(`${url.pathname}${url.search}`).expect(302);

    const [row] = await t.db
      .select({ emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, 'maria.souza@exemplo.com'));
    expect(row?.emailVerified).toBe(true);

    // RF-NOTIF-02: as boas-vindas saem depois da confirmação do e-mail, não no cadastro.
    const welcome = await t.mailer.lastTo('maria.souza@exemplo.com');
    expect(welcome.subject).toBe('Bem-vindo ao Space Sports');
    expect(welcome.text).toContain('Olá, Maria Souza!');
  });

  it('entra com o e-mail em qualquer caixa', async () => {
    const res = await t
      .http()
      .post('/v1/auth/sign-in/email')
      .send({ email: 'MARIA.SOUZA@exemplo.com', password: PASSWORD })
      .expect(200);
    expect(res.body.user.email).toBe('maria.souza@exemplo.com');
    expect(sessionCookie(res)).toBeDefined();
    expect(res.headers['set-auth-token']).toEqual(expect.any(String));
  });

  it('não aceita outro cadastro com o mesmo e-mail em outra caixa', async () => {
    const res = await t
      .http()
      .post('/v1/auth/sign-up/email')
      .send({ name: 'Outra', email: 'MARIA.SOUZA@EXEMPLO.COM', password: PASSWORD, phone: PHONE });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: { code: expect.stringMatching(/^USER_ALREADY_EXISTS/), message: expect.any(String) },
      requestId: expect.any(String),
    });
  });

  it('senha errada responde 401 no formato padrão de erro', async () => {
    const res = await t
      .http()
      .post('/v1/auth/sign-in/email')
      .set('x-request-id', 'trace-login')
      .send({ email: 'maria.souza@exemplo.com', password: 'senha-errada' })
      .expect(401);
    expect(res.body).toEqual({
      error: { code: 'INVALID_EMAIL_OR_PASSWORD', message: expect.any(String) },
      requestId: 'trace-login',
    });
  });

  it('rejeita senha curta', async () => {
    const res = await t
      .http()
      .post('/v1/auth/sign-up/email')
      .send({ name: 'Curta', email: 'curta@exemplo.com', password: '1234567', phone: PHONE })
      .expect(400);
    expect(res.body.error.code).toBe('PASSWORD_TOO_SHORT');
  });

  it('o cadastro ignora platform_role (a foto é recusada: avatar.int.test.ts)', async () => {
    const res = await t.http().post('/v1/auth/sign-up/email').send({
      name: 'Esperto',
      email: 'esperto@exemplo.com',
      password: PASSWORD,
      phone: PHONE,
      platformRole: 'SUPER',
    });
    expect(res.status).toBe(200);
    const [row] = await t.db.select().from(users).where(eq(users.id, res.body.user.id));
    expect(row).toMatchObject({ platformRole: 'USER', avatarUrl: null, phoneVerified: false });
  });

  it.each([
    ['sem telefone', undefined],
    ['telefone sem +55', '31999998888'],
    ['telefone de outro país', '+14155550123'],
    ['telefone com máscara', '(31) 99999-8888'],
    ['telefone incompleto', '+5531999'],
  ])('exige telefone brasileiro em E.164 (%s) e não cria a conta', async (_label, phone) => {
    const email = `sem-telefone-${Math.random().toString(36).slice(2)}@exemplo.com`;
    const res = await t
      .http()
      .post('/v1/auth/sign-up/email')
      .send({ name: 'Sem Telefone', email, password: PASSWORD, ...(phone ? { phone } : {}) })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_PHONE_NUMBER');
    expect(await t.db.$count(users, eq(users.email, email))).toBe(0);
  });

  it('o telefone não verificado pode se repetir entre cadastros (decisão 64)', async () => {
    const a = await signUp(t, 'mesmo-fone-a@exemplo.com', 'A', '+5531977771111');
    const b = await signUp(t, 'mesmo-fone-b@exemplo.com', 'B', '+5531977771111');
    const rows = await t.db.select().from(users).where(eq(users.phone, '+5531977771111'));
    expect(rows.map((row) => row.id).sort()).toEqual([a.id, b.id].sort());
    expect(rows.every((row) => !row.phoneVerified)).toBe(true);
  });

  it('o corpo não marca o telefone como verificado nem usa o campo do OTP', async () => {
    for (const extra of [{ phoneNumberVerified: true }, { phoneNumber: '+5531999990000' }]) {
      const email = `esperto-${Object.keys(extra)[0]}@exemplo.com`;
      const res = await t
        .http()
        .post('/v1/auth/sign-up/email')
        .send({ name: 'Esperto', email, password: PASSWORD, phone: PHONE, ...extra })
        .expect(400);
      expect(res.body.error.code).toBe('FIELD_NOT_ALLOWED');
      expect(await t.db.$count(users, eq(users.email, email))).toBe(0);
    }
  });

  it('esqueci a senha: e-mail com link, troca a senha e derruba as sessões antigas', async () => {
    const user = await signUp(t, 'esqueci@exemplo.com');
    await t
      .http()
      .post('/v1/auth/request-password-reset')
      .send({ email: 'Esqueci@Exemplo.com', redirectTo: `${WEB_ORIGIN}/redefinir-senha` })
      .expect(200);

    const mail = await t.mailer.lastTo('esqueci@exemplo.com');
    expect(mail.subject).toBe('Redefinir sua senha');
    const link = new URL(/(http\S+reset-password\S+)/.exec(mail.text)?.[1] ?? 'invalido:');
    // O link do e-mail redireciona para a tela do web com o token.
    const redirect = await t.http().get(`${link.pathname}${link.search}`).expect(302);
    const target = new URL(String(redirect.headers.location));
    expect(target.origin + target.pathname).toBe(`${WEB_ORIGIN}/redefinir-senha`);
    const token = target.searchParams.get('token');
    expect(token).toBeTruthy();

    await t
      .http()
      .post('/v1/auth/reset-password')
      .send({ token, newPassword: 'nova-senha-456' })
      .expect(200);

    await t
      .http()
      .post('/v1/auth/sign-in/email')
      .send({ email: 'esqueci@exemplo.com', password: PASSWORD })
      .expect(401);
    await t
      .http()
      .post('/v1/auth/sign-in/email')
      .send({ email: 'esqueci@exemplo.com', password: 'nova-senha-456' })
      .expect(200);
    await t.http().get('/v1/me').set('cookie', user.cookie).expect(401);
  });

  it('o redirect do reset só vai para origens confiáveis', async () => {
    const res = await t
      .http()
      .post('/v1/auth/request-password-reset')
      .send({ email: 'esqueci@exemplo.com', redirectTo: 'https://phishing.example/reset' })
      .expect(403);
    expect(res.body.error.code).toBe('INVALID_REDIRECT_URL');
  });

  it('conta bloqueada não entra', async () => {
    await signUp(t, 'bloqueado@exemplo.com');
    await t.db
      .update(users)
      .set({ status: 'BLOCKED' })
      .where(eq(users.email, 'bloqueado@exemplo.com'));
    const res = await t
      .http()
      .post('/v1/auth/sign-in/email')
      .send({ email: 'bloqueado@exemplo.com', password: PASSWORD })
      .expect(403);
    expect(res.body.error).toEqual({ code: 'USER_BLOCKED', message: 'Conta bloqueada.' });
  });
});
