import { eq, getTableName, type Table } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '../../src/auth/auth.js';
import { loadEnv } from '../../src/config/env.js';
import type { Database } from '../../src/db/client.js';
import {
  accounts,
  amenities,
  cities,
  courtSports,
  courts,
  spaceOpeningHours,
  spacePhotos,
  spaceSettings,
  spaces,
  sports,
  users,
} from '../../src/db/schema/index.js';
import {
  SEED_AMENITIES,
  SEED_PARTNER_SPACES,
  SEED_SPORTS,
  SeedSuperUserConflictError,
  seed,
} from '../../src/db/seed.js';
import { InProcessDomainEvents } from '../../src/events/domain-events.js';
import type { Mailer } from '../../src/mail/mailer.js';
import { DisabledPhotoStorage } from '../../src/storage/photo-storage.js';
import { createTestDatabase, first, type TestDatabase } from './helpers.js';

const superUser = {
  email: ' Super@SpaceSports.dev ',
  name: 'Super Admin',
  password: 'senha-do-super-123',
};

// O rate limit fica desligado em NODE_ENV=test: o Redis (lazy) nunca conecta.
const redis = new Redis({ lazyConnect: true });
afterAll(() => redis.disconnect());

/** Better Auth sobre o banco do teste (sem subir a app). */
function authFor(db: Database) {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    BETTER_AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  });
  const mailer = { send: async () => undefined } as unknown as Mailer;
  return createAuth({
    env,
    db,
    mailer,
    sms: null,
    redis,
    events: new InProcessDomainEvents(),
    storage: new DisabledPhotoStorage(),
  });
}

/** Login por e-mail + senha direto no Better Auth. */
function signIn(db: Database, email: string, password: string) {
  return authFor(db).api.signInEmail({ body: { email, password }, asResponse: true });
}

describe('seed', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(() => t.drop());

  async function counts() {
    const tables: Table[] = [
      sports,
      amenities,
      cities,
      spaces,
      spaceSettings,
      users,
      accounts,
      courts,
      courtSports,
    ];
    const entries = await Promise.all(
      tables.map(async (table) => [getTableName(table), await t.db.$count(table)] as const),
    );
    return Object.fromEntries(entries);
  }

  it('roda duas vezes sem duplicar nada', async () => {
    await seed(t.db, { superUser });
    const first = await counts();
    await seed(t.db, { superUser });
    expect(await counts()).toEqual(first);

    expect(first).toEqual({
      sports: SEED_SPORTS.length,
      amenities: SEED_AMENITIES.length,
      cities: 1,
      spaces: SEED_PARTNER_SPACES.length,
      space_settings: SEED_PARTNER_SPACES.length,
      users: 1,
      accounts: 1,
      courts: 7,
      court_sports: 7 * SEED_SPORTS.length,
    });
  });

  it('cria os esportes e Belo Horizonte/MG', async () => {
    const slugs = (await t.db.select({ slug: sports.slug }).from(sports)).map((s) => s.slug);
    expect(slugs.sort()).toEqual(['beach-tennis', 'futevolei', 'volei-praia']);

    const [bh] = await t.db.select().from(cities);
    expect(bh).toMatchObject({
      name: 'Belo Horizonte',
      state: 'MG',
      timezone: 'America/Sao_Paulo',
      active: true,
    });
  });

  it('cria os 3 espaços parceiros só com nome, slug, cidade e status, sem dados inventados', async () => {
    const bh = first(await t.db.select().from(cities));
    const rows = await t.db.select().from(spaces).orderBy(spaces.slug);

    // Decisão 43: a Duna Sports substituiu a Arena 7.
    expect(rows.map((s) => [s.name, s.slug])).toEqual([
      ['Arena Errejota', 'arena-errejota'],
      ['Astral Beach Sports', 'astral-beach-sports'],
      ['Duna Sports', 'duna-sports'],
    ]);
    for (const space of rows) {
      expect(space).toMatchObject({
        cityId: bh.id,
        status: 'ACTIVE',
        description: null,
        addressStreet: null,
        addressNumber: null,
        addressNeighborhood: null,
        addressPostalCode: null,
        location: null,
        phone: null,
        whatsapp: null,
        instagram: null,
        logoUrl: null,
      });
    }
    expect(await t.db.$count(spaceOpeningHours)).toBe(0);
    // As fotos ilustrativas são só do seed de demonstração.
    expect(await t.db.$count(spacePhotos)).toBe(0);
  });

  it('cria as quadras dos parceiros: Quadra 1..N, descobertas, ativas, com os três esportes', async () => {
    const catalog = await t.db.select().from(sports);
    const rows = await t.db
      .select({ slug: spaces.slug, court: courts })
      .from(courts)
      .innerJoin(spaces, eq(spaces.id, courts.spaceId))
      .orderBy(spaces.slug, courts.name);
    expect(rows.map((r) => [r.slug, r.court.name])).toEqual([
      ['arena-errejota', 'Quadra 1'],
      ['arena-errejota', 'Quadra 2'],
      ['astral-beach-sports', 'Quadra 1'],
      ['astral-beach-sports', 'Quadra 2'],
      ['astral-beach-sports', 'Quadra 3'],
      ['duna-sports', 'Quadra 1'],
      ['duna-sports', 'Quadra 2'],
    ]);
    for (const { court } of rows) {
      expect(court).toMatchObject({ covered: false, status: 'ACTIVE' });
      const links = await t.db.select().from(courtSports).where(eq(courtSports.courtId, court.id));
      expect(links.map((l) => [l.sportId, l.maxPlayers]).sort()).toEqual(
        catalog.map((sport) => [sport.id, sport.defaultMaxPlayers]).sort(),
      );
    }
  });

  it('cria space_settings com todos os valores nulos', async () => {
    const rows = await t.db.select().from(spaceSettings);
    for (const settings of rows) {
      const { id, spaceId, createdAt, updatedAt, acceptedPaymentMethods, ...values } = settings;
      expect(acceptedPaymentMethods).toEqual([]);
      for (const value of Object.values(values)) expect(value).toBeNull();
    }
  });

  it('cria o usuário Super com e-mail normalizado e verificado, e a senha de SEED_SUPER_PASSWORD', async () => {
    const [user] = await t.db.select().from(users);
    expect(user).toMatchObject({
      email: 'super@spacesports.dev',
      emailVerified: true,
      name: 'Super Admin',
      platformRole: 'SUPER',
      status: 'ACTIVE',
    });
    const [credential] = await t.db.select().from(accounts);
    expect(credential).toMatchObject({ providerId: 'credential', accountId: user?.id });
    expect(credential?.password).not.toContain(superUser.password);

    const res = await signIn(t.db, 'super@spacesports.dev', superUser.password);
    expect(res.status).toBe(200);
  });

  it('não troca a senha existente ao rodar de novo com outra SEED_SUPER_PASSWORD', async () => {
    await seed(t.db, { superUser: { ...superUser, password: 'outra-senha-456' } });
    expect((await signIn(t.db, 'super@spacesports.dev', superUser.password)).status).toBe(200);
    expect((await signIn(t.db, 'super@spacesports.dev', 'outra-senha-456')).status).toBe(401);
  });

  it('não sobrescreve dados preenchidos depois; o Super rebaixado volta a SUPER (verificado e com a senha do seed)', async () => {
    await t.db
      .update(spaces)
      .set({ description: 'Preenchido na implantação', status: 'SUSPENDED' })
      .where(eq(spaces.slug, 'duna-sports'));
    const dunaId = first(
      await t.db.select({ id: spaces.id }).from(spaces).where(eq(spaces.slug, 'duna-sports')),
    ).id;
    await t.db
      .update(spaceSettings)
      .set({ pricePerHourCents: 12_000 })
      .where(eq(spaceSettings.spaceId, dunaId));
    await t.db
      .update(users)
      .set({ name: 'Nome editado', platformRole: 'USER' })
      .where(eq(users.email, 'super@spacesports.dev'));

    await seed(t.db, { superUser });

    const duna = first(await t.db.select().from(spaces).where(eq(spaces.id, dunaId)));
    expect(duna).toMatchObject({ description: 'Preenchido na implantação', status: 'SUSPENDED' });
    const settings = first(
      await t.db.select().from(spaceSettings).where(eq(spaceSettings.spaceId, dunaId)),
    );
    expect(settings.pricePerHourCents).toBe(12_000);
    const [user] = await t.db.select().from(users);
    expect(user).toMatchObject({ name: 'Nome editado', platformRole: 'SUPER' });
  });

  it('sem SEED_SUPER_PASSWORD, cria o Super sem credencial', async () => {
    const other = await createTestDatabase();
    try {
      await seed(other.db, { superUser: { email: superUser.email, name: superUser.name } });
      expect(await other.db.$count(users)).toBe(1);
      expect(await other.db.$count(accounts)).toBe(0);
    } finally {
      await other.drop();
    }
  });

  it('sem usuário Super configurado, só pula esse passo', async () => {
    const other = await createTestDatabase();
    try {
      await seed(other.db);
      expect(await other.db.$count(users)).toBe(0);
      expect(await other.db.$count(spaces)).toBe(SEED_PARTNER_SPACES.length);
    } finally {
      await other.drop();
    }
  });
});

describe('seed: quadras dos parceiros e espaços que já existiam', () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(() => t.drop());

  const courtsOf = async (slug: string) =>
    (
      await t.db
        .select({ name: courts.name, covered: courts.covered, status: courts.status })
        .from(courts)
        .innerJoin(spaces, eq(spaces.id, courts.spaceId))
        .where(eq(spaces.slug, slug))
        .orderBy(courts.name)
    ).map((court) => `${court.name}${court.covered ? ' (coberta)' : ''} ${court.status}`);

  it('não apaga a Arena 7 nem mexe nas quadras de quem já tem alguma; completa só os outros', async () => {
    const city = first(
      await t.db
        .insert(cities)
        .values({ name: 'Belo Horizonte', state: 'MG', timezone: 'America/Sao_Paulo' })
        .returning(),
    );
    const [arena7, astral] = await t.db
      .insert(spaces)
      .values([
        { name: 'Arena 7', slug: 'arena-7', cityId: city.id },
        { name: 'Astral Beach Sports', slug: 'astral-beach-sports', cityId: city.id },
      ])
      .returning();
    // Quadra cadastrada na implantação, antes do seed das quadras.
    await t.db
      .insert(courts)
      .values({ spaceId: astral?.id ?? '', name: 'Quadra Central', covered: true });

    await seed(t.db);

    expect(first(await t.db.select().from(spaces).where(eq(spaces.slug, 'arena-7'))).id).toBe(
      arena7?.id,
    );
    expect(await courtsOf('arena-7')).toEqual([]);
    expect(await courtsOf('astral-beach-sports')).toEqual(['Quadra Central (coberta) ACTIVE']);
    expect(await courtsOf('arena-errejota')).toEqual(['Quadra 1 ACTIVE', 'Quadra 2 ACTIVE']);
    expect(await courtsOf('duna-sports')).toEqual(['Quadra 1 ACTIVE', 'Quadra 2 ACTIVE']);
  });

  it('roda de novo sem duplicar; quadra editada ou inativada pela implantação continua como está', async () => {
    const before = await t.db.$count(courts);
    await t.db
      .update(courts)
      .set({ name: 'Quadra da Praia', status: 'INACTIVE' })
      .where(eq(courts.name, 'Quadra 2'));

    await seed(t.db);
    await seed(t.db);

    expect(await t.db.$count(courts)).toBe(before);
    expect(await courtsOf('duna-sports')).toEqual(['Quadra 1 ACTIVE', 'Quadra da Praia INACTIVE']);
    expect(await t.db.$count(courtSports)).toBe(4 * SEED_SPORTS.length);
  });
});

describe('seed: SEED_SUPER_EMAIL já usado por outra conta', () => {
  let t: TestDatabase;
  beforeEach(async () => {
    t = await createTestDatabase();
  });
  afterEach(() => t.drop());

  async function publicSignUp(password: string) {
    // `phone` (decisão 64) é lido do corpo pelo hook do Better Auth, fora do tipo da rota.
    const body = {
      name: 'Quem chegou antes',
      email: 'super@spacesports.dev',
      password,
      phone: '+5531999998888',
    };
    const res = await authFor(t.db).api.signUpEmail({ body, asResponse: true });
    expect(res.status).toBe(200);
  }

  it('cadastro público não verificado com o e-mail do Super: o seed recusa e não promove', async () => {
    await publicSignUp('senha-de-quem-cadastrou');

    await expect(seed(t.db, { superUser })).rejects.toThrow(SeedSuperUserConflictError);

    const user = first(await t.db.select().from(users));
    expect(user).toMatchObject({ platformRole: 'USER', emailVerified: false });
    // A conta segue com a senha de quem cadastrou, e a do seed não entra.
    expect((await signIn(t.db, 'super@spacesports.dev', 'senha-de-quem-cadastrou')).status).toBe(
      200,
    );
    expect((await signIn(t.db, 'super@spacesports.dev', superUser.password)).status).toBe(401);
    // O seed roda numa transação: nada foi aplicado.
    expect(await t.db.$count(spaces)).toBe(0);
  });

  it('recusa também a conta verificada com outra senha, ou sem SEED_SUPER_PASSWORD', async () => {
    await publicSignUp('senha-de-quem-cadastrou');
    await t.db.update(users).set({ emailVerified: true });

    await expect(seed(t.db, { superUser })).rejects.toThrow(SeedSuperUserConflictError);
    await expect(
      seed(t.db, { superUser: { email: superUser.email, name: superUser.name } }),
    ).rejects.toThrow(SeedSuperUserConflictError);
    expect(first(await t.db.select().from(users)).platformRole).toBe('USER');
  });

  it('a mensagem diz o que fazer', async () => {
    await publicSignUp('senha-de-quem-cadastrou');
    await expect(seed(t.db, { superUser })).rejects.toThrow(
      /super@spacesports\.dev.*não promove contas existentes/,
    );
  });
});
