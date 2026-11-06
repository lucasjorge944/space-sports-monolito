import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../../src/db/schema/index.js';
import { bearer } from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';
import { createTestApp, PASSWORD, signUp, type TestApp } from './helpers.js';

// QA das decisões 64 e 65: formatos do telefone no cadastro, cadastros simultâneos com o mesmo
// número, telefone digitado que nunca vira prova de identidade e login por telefone fora do ar.

describe('telefone no cadastro e login por telefone (decisões 64 e 65)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  let n = 0;
  const nextEmail = () => {
    n += 1;
    return `qa-fone-${n}@exemplo.com`;
  };
  const signUpRaw = (body: object) => t.http().post('/v1/auth/sign-up/email').send(body);

  it.each([
    ['celular (9 dígitos)', '+5531988887777'],
    ['fixo (8 dígitos)', '+553133334444'],
    ['DDD 11', '+5511912345678'],
  ])('RF-AUTH-01: aceita %s e grava não verificado', async (_label, phone) => {
    const email = nextEmail();
    const res = await signUpRaw({ name: 'Formato Ok', email, password: PASSWORD, phone });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = first(await t.db.select().from(users).where(eq(users.email, email)));
    expect(row).toMatchObject({ phone, phoneVerified: false });
  });

  it.each([
    ['DDD com zero', '+5501988887777'],
    ['DDD com um dígito só', '+55988887777'],
    ['celular com 10 dígitos', '+55319888877770'],
    ['celular de 9 dígitos que não começa com 9', '+5531888887777'],
    ['fixo começando com 1', '+553113334444'],
    ['com espaço no fim', '+5531988887777 '],
    ['com quebra de linha no fim', '+5531988887777\n'],
    ['com letras', '+55319888877ab'],
    ['sem o +', '5531988887777'],
    ['em branco', ''],
    ['nulo', null],
    ['número em vez de texto', 5531988887777],
    ['lista', ['+5531988887777']],
  ])(
    'RF-AUTH-01: recusa telefone %s com INVALID_PHONE_NUMBER e não cria a conta',
    async (_l, phone) => {
      const email = nextEmail();
      const res = await signUpRaw({ name: 'Formato Ruim', email, password: PASSWORD, phone });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PHONE_NUMBER');
      expect(await t.db.$count(users, eq(users.email, email))).toBe(0);
    },
  );

  it('cadastros simultâneos com o mesmo telefone: todos entram (a unicidade vale só para verificados)', async () => {
    const phone = '+5531966660001';
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        signUpRaw({ name: `Simultâneo ${i}`, email: nextEmail(), password: PASSWORD, phone }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await t.db.$count(users, eq(users.phone, phone))).toBe(5);
  });

  it('digitar o telefone de uma conta verificada não dá acesso a ela nem a identifica', async () => {
    const owner = await signUp(t, nextEmail(), 'Dona do Número', '+5531966660002');
    await t.db.update(users).set({ phoneVerified: true }).where(eq(users.id, owner.id));

    const impostor = await signUp(t, nextEmail(), 'Impostor', '+5531966660002');
    expect(impostor.id).not.toBe(owner.id);
    const me = await t
      .http()
      .get('/v1/me')
      .set(...bearer(impostor))
      .expect(200);
    expect(me.body).toMatchObject({
      id: impostor.id,
      phone: '+5531966660002',
      phoneVerified: false,
    });
    // A dona segue verificada e intacta.
    expect(first(await t.db.select().from(users).where(eq(users.id, owner.id)))).toMatchObject({
      phone: '+5531966660002',
      phoneVerified: true,
    });
  });

  it('a mensagem de erro do cadastro não revela se o número já existe', async () => {
    const phone = '+5531966660003';
    await signUp(t, nextEmail(), 'Primeiro', phone);
    // Mesmo número, outro e-mail: sem diferença de resposta para um número inédito.
    const repeated = await signUpRaw({
      name: 'Segundo',
      email: nextEmail(),
      password: PASSWORD,
      phone,
    });
    const fresh = await signUpRaw({
      name: 'Terceiro',
      email: nextEmail(),
      password: PASSWORD,
      phone: '+5531966660004',
    });
    expect(repeated.status).toBe(fresh.status);
  });

  it('o telefone cadastrado não serve como identificador de login', async () => {
    const phone = '+5531966660005';
    await signUp(t, nextEmail(), 'Sem Login Por Telefone', phone);
    for (const body of [
      { email: phone, password: PASSWORD },
      { phoneNumber: phone, password: PASSWORD },
    ]) {
      const res = await t.http().post('/v1/auth/sign-in/email').send(body);
      expect(res.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
      expect(res.headers['set-auth-token']).toBeUndefined();
    }
  });

  it.each([
    ['POST', '/v1/auth/phone-number/send-otp', { phoneNumber: '+5531966660006' }],
    ['POST', '/v1/auth/phone-number/verify', { phoneNumber: '+5531966660006', code: '123456' }],
    [
      'POST',
      '/v1/auth/sign-in/phone-number',
      { phoneNumber: '+5531966660006', password: PASSWORD },
    ],
    ['POST', '/v1/auth/phone-number/request-password-reset', { phoneNumber: '+5531966660006' }],
    [
      'POST',
      '/v1/auth/phone-number/reset-password',
      { phoneNumber: '+5531966660006', otp: '123456', newPassword: PASSWORD },
    ],
  ])('RF-AUTH-01 (decisão 65): %s %s responde 404 e não envia SMS', async (_method, path, body) => {
    await t.http().post(path).send(body).expect(404);
    expect(t.sms.sent).toEqual([]);
    expect(await t.db.$count(users, eq(users.phone, '+5531966660006'))).toBe(0);
  });

  it('a documentação OpenAPI do Better Auth não anuncia as rotas do telefone', async () => {
    const res = await t.http().get('/v1/auth/reference');
    // A referência pode nem estar exposta (404); se estiver, não pode listar o plugin desligado.
    if (res.status === 200) expect(JSON.stringify(res.text)).not.toContain('phone-number');
  });

  it('update-user não grava telefone nem o marca como verificado', async () => {
    const user = await signUp(t, nextEmail(), 'Update User', '+5531966660007');
    for (const body of [
      { phoneNumberVerified: true },
      { phoneVerified: true },
      { phoneNumber: '+5531966660008' },
      { phone: '+5531966660008' },
    ]) {
      await t
        .http()
        .post('/v1/auth/update-user')
        .set(...bearer(user))
        .send(body);
      expect(first(await t.db.select().from(users).where(eq(users.id, user.id)))).toMatchObject({
        phone: '+5531966660007',
        phoneVerified: false,
      });
    }
  });
});
