import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../../src/db/schema/index.js';
import { createTestApp, PASSWORD, signUp, type TestApp } from './helpers.js';

// RF-AUTH-01: login pelo telefone (OTP). Decisão 65: desligado em todos os ambientes; só liga com
// AUTH_PHONE_LOGIN_ENABLED=true e um SMS_PROVIDER que envie. O código do plugin continua testado
// com ele ligado (SMS falso).

const PHONE = '+5531999998888';

describe('login por telefone desligado por padrão (decisão 65)', () => {
  it.each([
    ['padrão (SMS_PROVIDER=console)', {}],
    ['ligado sem provedor de SMS', { AUTH_PHONE_LOGIN_ENABLED: 'true', SMS_PROVIDER: 'none' }],
  ])('%s: as rotas do OTP não existem', async (_label, env) => {
    const t = await createTestApp({ env });
    try {
      await t
        .http()
        .post('/v1/auth/phone-number/send-otp')
        .send({ phoneNumber: PHONE })
        .expect(404);
      await t
        .http()
        .post('/v1/auth/phone-number/verify')
        .send({ phoneNumber: PHONE, code: '123456' })
        .expect(404);
      expect(t.sms.sent).toEqual([]);
    } finally {
      await t.close();
    }
  });
});

describe('login por OTP no telefone (AUTH_PHONE_LOGIN_ENABLED=true)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ env: { AUTH_PHONE_LOGIN_ENABLED: 'true' } });
  });
  afterAll(() => t.close());

  async function requestCode(phoneNumber: string) {
    await t.http().post('/v1/auth/phone-number/send-otp').send({ phoneNumber }).expect(200);
    return t.sms.lastCode(phoneNumber);
  }

  it('cria a conta só com telefone (sem e-mail) e devolve a sessão', async () => {
    const code = await requestCode(PHONE);
    expect(code).toMatch(/^\d{6}$/);

    const res = await t
      .http()
      .post('/v1/auth/phone-number/verify')
      .send({ phoneNumber: PHONE, code })
      .expect(200);
    expect(res.body.token).toEqual(expect.any(String));

    const [row] = await t.db.select().from(users).where(eq(users.phone, PHONE));
    expect(row).toMatchObject({ email: null, phone: PHONE, phoneVerified: true, name: '' });

    const me = await t
      .http()
      .get('/v1/me')
      .set('authorization', `Bearer ${res.headers['set-auth-token']}`)
      .expect(200);
    expect(me.body).toMatchObject({
      id: row?.id,
      email: null,
      phone: PHONE,
      phoneVerified: true,
      access: { super: false, management: false },
    });
  });

  it('o segundo login pelo mesmo telefone entra na mesma conta', async () => {
    const code = await requestCode(PHONE);
    await t
      .http()
      .post('/v1/auth/phone-number/verify')
      .send({ phoneNumber: PHONE, code })
      .expect(200);
    expect(await t.db.$count(users, eq(users.phone, PHONE))).toBe(1);
  });

  it('código errado não entra', async () => {
    await requestCode('+5531988887777');
    const res = await t
      .http()
      .post('/v1/auth/phone-number/verify')
      .send({ phoneNumber: '+5531988887777', code: '000000' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_OTP');
    expect(await t.db.$count(users, eq(users.phone, '+5531988887777'))).toBe(0);
  });

  it('exige telefone em E.164', async () => {
    const res = await t
      .http()
      .post('/v1/auth/phone-number/send-otp')
      .send({ phoneNumber: '31 99999-8888' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_PHONE_NUMBER');
  });

  it('com o plugin ligado, o cadastro por e-mail continua gravando o telefone sem verificar', async () => {
    const res = await t.http().post('/v1/auth/sign-up/email').send({
      name: 'Com Plugin',
      email: 'com-plugin@exemplo.com',
      password: PASSWORD,
      phone: '+5531977776666',
      phoneNumber: '+5531911110000',
    });
    expect(res.status).toBe(200);
    const [row] = await t.db.select().from(users).where(eq(users.id, res.body.user.id));
    expect(row).toMatchObject({ phone: '+5531977776666', phoneVerified: false });
  });

  it('usuário de e-mail pode verificar e vincular o telefone à própria conta', async () => {
    const user = await signUp(t, 'com-telefone@exemplo.com');
    const code = await requestCode('+5531966665555');
    await t
      .http()
      .post('/v1/auth/phone-number/verify')
      .set('authorization', `Bearer ${user.token}`)
      .send({ phoneNumber: '+5531966665555', code, updatePhoneNumber: true })
      .expect(200);
    const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({
      email: 'com-telefone@exemplo.com',
      phone: '+5531966665555',
      phoneVerified: true,
    });
  });
});
