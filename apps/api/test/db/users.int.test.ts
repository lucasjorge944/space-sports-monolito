import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accounts,
  devices,
  sessions,
  sports,
  userSportProfiles,
  users,
} from '../../src/db/schema/index.js';
import { anonymizeUser, DELETED_USER_NAME } from '../../src/users/anonymize.js';
import { createTestDatabase, expectPgError, first, type TestDatabase } from './helpers.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

describe('users: e-mail, telefone e exclusão lógica', () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(() => t.drop());

  it('só aceita e-mail normalizado (minúsculas, sem espaços)', async () => {
    for (const email of ['Maria@Exemplo.com', ' maria@exemplo.com']) {
      const err = await expectPgError(t.db.insert(users).values({ name: 'Maria', email }));
      expect(err, email).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'users_email_normalized',
      });
    }
  });

  it('e-mail único: com a normalização, a caixa não cria duplicata', async () => {
    await t.db.insert(users).values({ name: 'Ana', email: 'ana@exemplo.com' });
    const err = await expectPgError(
      t.db.insert(users).values({ name: 'Outra Ana', email: 'ana@exemplo.com' }),
    );
    expect(err).toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'users_email_unique' });
  });

  it('e-mail é opcional para quem tem telefone; vários sem e-mail convivem', async () => {
    await t.db.insert(users).values([
      { name: 'Só telefone 1', phone: '+5531911112222' },
      { name: 'Só telefone 2', phone: '+5531933334444' },
    ]);
    expect(await t.db.$count(users, eq(users.name, 'Só telefone 1'))).toBe(1);
  });

  it('exige e-mail ou telefone', async () => {
    const err = await expectPgError(t.db.insert(users).values({ name: 'Sem contato' }));
    expect(err).toMatchObject({ code: CHECK_VIOLATION, constraint: 'users_email_or_phone' });
  });

  it('telefone em E.164; o não verificado pode se repetir, o verificado é único (decisão 64)', async () => {
    const invalid = await expectPgError(
      t.db.insert(users).values({ name: 'Fone', phone: '31 99999-0000' }),
    );
    expect(invalid).toMatchObject({ code: CHECK_VIOLATION, constraint: 'users_phone_e164' });

    // Digitado (não verificado): repete sem erro, inclusive o número de uma conta verificada.
    await t.db.insert(users).values([
      { name: 'Fone repetido', phone: '+5531911112222' },
      { name: 'Verificado', phone: '+5531922223333', phoneVerified: true },
      { name: 'Digitou o do verificado', phone: '+5531922223333' },
    ]);
    expect(await t.db.$count(users, eq(users.phone, '+5531911112222'))).toBe(2);

    const duplicated = await expectPgError(
      t.db
        .insert(users)
        .values({ name: 'Outro verificado', phone: '+5531922223333', phoneVerified: true }),
    );
    expect(duplicated).toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'users_phone_verified_unique',
    });
  });

  it('anonimizar libera e-mail e telefone, limpa o perfil e apaga o acesso', async () => {
    const user = first(
      await t.db
        .insert(users)
        .values({
          name: 'Carlos Lima',
          email: 'carlos@exemplo.com',
          emailVerified: true,
          phone: '+5531955556666',
          phoneVerified: true,
          avatarUrl: 'https://cdn.exemplo.com/carlos.jpg',
          birthDate: '1990-05-10',
          gender: 'MALE',
        })
        .returning(),
    );
    const sport = first(
      await t.db.insert(sports).values({ slug: 'esporte-carlos', name: 'Esporte' }).returning(),
    );
    await t.db
      .insert(userSportProfiles)
      .values({ userId: user.id, sportId: sport.id, level: null });
    await t.db.insert(sessions).values({
      userId: user.id,
      token: 'token-carlos',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await t.db
      .insert(accounts)
      .values({ userId: user.id, providerId: 'credential', accountId: user.id, password: 'hash' });
    await t.db
      .insert(devices)
      .values({ userId: user.id, expoPushToken: 'ExponentPushToken[x]', platform: 'IOS' });

    const now = new Date('2026-11-02T12:00:00Z');
    expect(await anonymizeUser(t.db, user.id, now)).toBe(true);

    const [anonymized] = await t.db.select().from(users).where(eq(users.id, user.id));
    expect(anonymized).toMatchObject({
      name: DELETED_USER_NAME,
      email: null,
      emailVerified: false,
      phone: null,
      phoneVerified: false,
      avatarUrl: null,
      birthDate: null,
      gender: null,
      deletedAt: now,
    });
    expect(await t.db.$count(sessions, eq(sessions.userId, user.id))).toBe(0);
    expect(await t.db.$count(accounts, eq(accounts.userId, user.id))).toBe(0);
    expect(await t.db.$count(devices, eq(devices.userId, user.id))).toBe(0);
    expect(await t.db.$count(userSportProfiles, eq(userSportProfiles.userId, user.id))).toBe(0);

    // Recadastro com o mesmo e-mail e telefone.
    await t.db
      .insert(users)
      .values({ name: 'Carlos de novo', email: 'carlos@exemplo.com', phone: '+5531955556666' });

    // Segunda chamada não faz nada.
    expect(await anonymizeUser(t.db, user.id)).toBe(false);
  });
});
