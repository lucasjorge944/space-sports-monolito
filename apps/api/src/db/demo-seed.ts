import { readFile } from 'node:fs/promises';
import type { LogoUpload, SpaceRole } from '@space-sports/shared';
import { verifyPassword } from 'better-auth/crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { SpaceContextService } from '../bookings/space-context.js';
import { ClassSessionsService } from '../classes/class-sessions.service.js';
import { assertTeachers, setGroupTeachers } from '../classes/class-teachers.js';
import { SpaceLogoService } from '../spaces/space-logo.service.js';
import { lockSpace } from '../spaces/space-uploads.js';
import type { PhotoStorage } from '../storage/photo-storage.js';
import { normalizeEmail } from '../users/normalize.js';
import type { Database } from './client.js';
import { type DemoAdsReport, seedDemoAds } from './demo-ads.js';
import { type PaymentScenarioReport, seedPaymentScenario } from './demo-payments.js';
import {
  cities,
  classGroups,
  courtSports,
  courts,
  spaceMembers,
  spaceOpeningHours,
  spacePhotos,
  spaceSettings,
  spaces,
  sports,
  users,
} from './schema/index.js';
import {
  credentialHash,
  insertCredential,
  SEED_CITY,
  SEED_PARTNER_SPACES,
  type SeedOptions,
  seed,
  type Transaction,
} from './seed.js';

/**
 * Contas do seed de demonstração (dev/staging), no domínio reservado exemplo.com. Goiano (Dono)
 * e os professores Bruno, Galantine e Potenza são da Astral Beach Sports (docs/08). Os
 * professores da Arena Errejota e da Duna Sports são **fictícios**: os nomes reais ainda estão
 * "a levantar" no docs/08.
 */
export const DEMO_ACCOUNTS = [
  { space: 'astral-beach-sports', name: 'Goiano', email: 'goiano.astral', role: 'OWNER' },
  { space: 'astral-beach-sports', name: 'Bruno', email: 'bruno.astral', role: 'TEACHER' },
  { space: 'astral-beach-sports', name: 'Galantine', email: 'galantine.astral', role: 'TEACHER' },
  { space: 'astral-beach-sports', name: 'Potenza', email: 'potenza.astral', role: 'TEACHER' },
  // Fictícios.
  { space: 'arena-errejota', name: 'Marcos Oliveira', email: 'marcos.errejota', role: 'TEACHER' },
  { space: 'arena-errejota', name: 'Juliana Costa', email: 'juliana.errejota', role: 'TEACHER' },
  { space: 'duna-sports', name: 'Thiago Almeida', email: 'thiago.duna', role: 'TEACHER' },
  { space: 'duna-sports', name: 'Patrícia Lima', email: 'patricia.duna', role: 'TEACHER' },
] as const satisfies readonly {
  space: (typeof SEED_PARTNER_SPACES)[number]['slug'];
  name: string;
  email: string;
  role: SpaceRole;
}[];

export const DEMO_EMAIL_DOMAIN = 'exemplo.com';
export const demoEmail = (account: { email: string }) => `${account.email}@${DEMO_EMAIL_DOMAIN}`;

/**
 * Telefone fictício e não verificado das contas de demonstração (decisão 64: todo usuário tem
 * telefone), na faixa `(31) 90000-00NN`: celular com 9, prefixo que as operadoras não usam. Não
 * recebe nada (sem SMS nem WhatsApp) e não serve para login.
 */
export const demoPhone = (index: number) => `+55319000000${String(index + 1).padStart(2, '0')}`;

/** Turma de demonstração com dois professores (decisão 47): horário e capacidade fictícios. */
export const DEMO_CLASS_GROUP = {
  space: 'astral-beach-sports',
  court: 'Quadra 1',
  sport: 'beach-tennis',
  name: 'Beach tennis em dupla de professores',
  teachers: ['bruno.astral', 'galantine.astral'],
  weekday: 3,
  startTime: '19:00',
  durationMin: 60,
  capacity: 8,
} as const;

/**
 * Espaço **fictício** do pagamento online (decisões 80 a 96), só com o gateway fake: não é parceiro
 * (docs/08 não é tocado). Preço, horário, quadras, contas e documento de teste são inventados e
 * marcados como tal; o CNPJ é um número de teste válido que o fake aprova.
 */
export const DEMO_PAYMENTS_SPACE = {
  name: 'Arena Demonstração (fictícia)',
  slug: 'arena-demonstracao',
  description:
    'Espaço fictício do ambiente de teste: mostra o pagamento online (Pix e cartão de teste), a carteira e os estornos. Não é um espaço real.',
  pricePerHourCents: 12_000,
  owner: { name: 'Dono Demonstração', email: 'dono.demo' },
  player: { name: 'Jogador Demonstração', email: 'jogador.demo' },
  merchant: {
    documentType: 'CNPJ' as const,
    document: '11222333000181',
    legalName: 'Arena Demonstração Ltda (fictícia)',
  },
};

/** Logos dos parceiros: cópia de docs/brand/parceiros/<slug>.jpg (quadradas, 150x150). */
const logoFile = (slug: string) => new URL(`./demo-assets/${slug}.jpg`, import.meta.url);

/**
 * Fotos **ilustrativas** dos parceiros, na ordem da galeria (a primeira, em paisagem, é a capa).
 * Não são fotos dos espaços: são do Unsplash (licença Unsplash, uso livre sem atribuição
 * obrigatória), escolhidas só para a vitrine, a página do espaço e o app terem imagens em
 * dev/staging. Ficam como links externos para o CDN do Unsplash, fora do storage. `rect` recorta a
 * original (sem a criança na borda).
 */
export const DEMO_PHOTOS = {
  'astral-beach-sports': [
    // Jonathan Borba, https://unsplash.com/photos/78xD673CVtQ (quadra de areia, rede e coqueiros)
    'https://images.unsplash.com/photo-1771526087461-7503279d6b16?w=1600&q=80&auto=format&fit=crop',
    // Nathaly R, https://unsplash.com/photos/IJFQiTd69bo (beach tennis ao entardecer)
    'https://images.unsplash.com/photo-1777206045038-b64484cee05d?w=1600&q=80&auto=format&fit=crop',
    // Robert V. Ruggiero, https://unsplash.com/photos/wn4ad4E5DV0 (rede de vôlei na praia, de dia)
    'https://images.unsplash.com/photo-1556732282-595ef530909c?w=1600&q=80&auto=format&fit=crop',
  ],
  'arena-errejota': [
    // Elizeu Dias, https://unsplash.com/photos/-Vae5P6v-aI (beach tennis em quadras na praia)
    'https://images.unsplash.com/photo-1519046947096-f43d6481532b?rect=760,507,4712,3141&w=1600&q=80&auto=format&fit=crop',
    // Ben Turnbull, https://unsplash.com/photos/2w8HuR5BXDs (vôlei de praia ao pôr do sol)
    'https://images.unsplash.com/photo-1562920618-af1f5f02f0be?w=1600&q=80&auto=format&fit=crop',
    // Marcos Paulo Prado, https://unsplash.com/photos/mTj_WuQ9bY0 (bola de futevôlei na areia)
    'https://images.unsplash.com/photo-1668195327624-06e596eb797c?w=1600&q=80&auto=format&fit=crop',
  ],
  'duna-sports': [
    // Jannes Glas, https://unsplash.com/photos/0NaQQsLWLkA (vôlei de praia ao pôr do sol)
    'https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?w=1600&q=80&auto=format&fit=crop',
    // Giusy Iaria, https://unsplash.com/photos/txAaCNtNGus (beach tennis em quadra de areia)
    'https://images.unsplash.com/photo-1754386738120-3244dcd72166?w=1600&q=80&auto=format&fit=crop',
    // Josep M Bové, https://unsplash.com/photos/R9FH9nCrUQQ (rede de vôlei na areia, frente ao mar)
    'https://images.unsplash.com/photo-1774632970201-9ec69e7bc0e7?w=1600&q=80&auto=format&fit=crop',
  ],
} as const satisfies Record<(typeof SEED_PARTNER_SPACES)[number]['slug'], readonly string[]>;

/** O seed de demonstração cria contas com senha conhecida: nunca em produção. */
export class DemoSeedInProductionError extends Error {
  constructor() {
    super('O seed de demonstração não roda com NODE_ENV=production.');
    this.name = 'DemoSeedInProductionError';
  }
}

/** Sem a permissão explícita, o seed recusa em qualquer ambiente. */
export class DemoSeedNotAllowedError extends Error {
  constructor() {
    super('O seed de demonstração exige ALLOW_DEMO_SEED=true.');
    this.name = 'DemoSeedNotAllowedError';
  }
}

/**
 * As duas travas do seed de demonstração. O staging usa a imagem de produção e sobrescreve
 * NODE_ENV para rodar o seed, então NODE_ENV sozinho não separa os ambientes: a permissão
 * explícita é o que impede um NODE_ENV trocado por engano de criar contas com senha conhecida.
 * Só o valor exato `true` libera.
 */
export function assertDemoSeedAllowed(env: {
  nodeEnv: string | undefined;
  allowDemoSeed: string | undefined;
}): void {
  if (env.nodeEnv === 'production') throw new DemoSeedInProductionError();
  if (env.allowDemoSeed !== 'true') throw new DemoSeedNotAllowedError();
}

/** E-mail de demonstração já usado por uma conta que o seed não criou (mesma regra do Super). */
export class DemoAccountConflictError extends Error {
  constructor(email: string) {
    super(
      `${email} já pertence a uma conta que não foi criada pelo seed de demonstração (e-mail não ` +
        'verificado ou senha diferente de SEED_DEMO_PASSWORD). O seed não dá vínculos a contas ' +
        'existentes; remova a conta ou confira a senha.',
    );
    this.name = 'DemoAccountConflictError';
  }
}

export type DemoSeedOptions = {
  /** SEED_DEMO_PASSWORD: senha de todas as contas criadas (contas existentes não mudam). */
  password: string;
  /** `NODE_ENV`; `production` faz o seed recusar. */
  nodeEnv: string | undefined;
  /** `ALLOW_DEMO_SEED`; qualquer valor diferente de `true` faz o seed recusar. */
  allowDemoSeed: string | undefined;
  /** Storage das logos e das imagens dos anúncios; desligado (sem S3_BUCKET), são puladas. */
  storage: PhotoStorage;
  /** Repassado ao seed de produção (usuário Super). */
  seedOptions?: SeedOptions;
  /** Envio do arquivo na URL pré-assinada (padrão: `fetch` com PUT). */
  putObject?: (upload: LogoUpload, body: Uint8Array<ArrayBuffer>) => Promise<void>;
  /**
   * `PAYMENTS_PROVIDER`: o espaço de demonstração do pagamento online só é criado com `fake`
   * (sem a opção, ele fica de fora).
   */
  paymentsProvider?: string | undefined;
};

export type DemoSeedReport = {
  accounts: { email: string; created: boolean }[];
  /** Por slug: fotos ilustrativas gravadas agora ou mantidas as do espaço (já tinha alguma). */
  photos: Record<string, 'added' | 'kept'>;
  /** Por slug: enviada agora, mantida (o espaço já tinha logo) ou pulada (sem storage). */
  logos: Record<string, 'uploaded' | 'kept' | 'skipped'>;
  /** Criada agora, mantida (já existia) ou pulada (a quadra ou um professor não está mais lá). */
  classGroup: 'created' | 'kept' | 'skipped';
  /** Anúncios de demonstração (`DEMO_ADS`), por anunciante. */
  ads: DemoAdsReport;
  /** Espaço fictício do pagamento online (`DEMO_PAYMENTS_SPACE`); pulado sem o gateway fake. */
  payments: PaymentScenarioReport;
};

/**
 * Seed de demonstração (dev/staging): roda o seed de produção e acrescenta as contas de
 * `DEMO_ACCOUNTS` (e-mail verificado, telefone fictício não verificado, senha de
 * SEED_DEMO_PASSWORD) com os vínculos ACTIVE, as
 * fotos ilustrativas de `DEMO_PHOTOS`, as logos dos parceiros, enviadas pelo mesmo serviço do
 * upload do painel, a turma `DEMO_CLASS_GROUP` com as próximas aulas e os anúncios de `DEMO_ADS`
 * (anunciantes fictícios, campanhas no ar por 90 dias). Idempotente: só insere o
 * que falta; não troca senhas, não reativa vínculos removidos, não mexe na galeria de quem já tem
 * foto, não substitui uma logo já definida e não recria nem altera a turma. Não cria preço,
 * horário de funcionamento nem plano.
 */
export async function seedDemo(db: Database, options: DemoSeedOptions): Promise<DemoSeedReport> {
  assertDemoSeedAllowed(options);
  await seed(db, options.seedOptions);

  const accounts = await db.transaction(async (tx) => {
    const partnerIds = await partnerSpaceIds(tx);
    const created: DemoSeedReport['accounts'] = [];
    for (const [index, account] of DEMO_ACCOUNTS.entries()) {
      const email = demoEmail(account);
      const { userId, isNew } = await demoUser(tx, {
        email,
        name: account.name,
        phone: demoPhone(index),
        password: options.password,
      });
      created.push({ email, created: isNew });
      const spaceId = partnerIds.get(account.space);
      if (!spaceId) throw new Error(`Espaço parceiro ${account.space} não encontrado.`);
      await tx
        .insert(spaceMembers)
        .values({ userId, spaceId, role: account.role, status: 'ACTIVE' })
        .onConflictDoNothing({
          target: [spaceMembers.userId, spaceMembers.spaceId, spaceMembers.role],
        });
    }
    return created;
  });

  const photos = await seedPhotos(db);
  const logos = await seedLogos(db, options);
  const classGroup = await seedClassGroup(db);
  const ads = await seedDemoAds(db, options.storage, options.putObject ?? putWithFetch);
  const payments =
    options.paymentsProvider === 'fake'
      ? await seedDemoPaymentsSpace(db, options.password, accounts)
      : 'skipped';
  return { accounts, photos, logos, classGroup, ads, payments };
}

/**
 * O espaço fictício do pagamento online com as contas de demonstração (Dono e jogador) e o cenário
 * de `seedPaymentScenario`. Idempotente: espaço e contas existentes são reaproveitados.
 */
async function seedDemoPaymentsSpace(
  db: Database,
  password: string,
  report: DemoSeedReport['accounts'],
): Promise<PaymentScenarioReport> {
  const demo = DEMO_PAYMENTS_SPACE;
  const setup = await db.transaction(async (tx) => {
    const [city] = await tx
      .select({ id: cities.id, timeZone: cities.timezone })
      .from(cities)
      .where(and(eq(cities.name, SEED_CITY.name), eq(cities.state, SEED_CITY.state)));
    const sportRows = await tx
      .select({ id: sports.id, slug: sports.slug })
      .from(sports)
      .where(inArray(sports.slug, ['futevolei', 'beach-tennis']));
    if (!city || !sportRows.length) return null;
    const owner = await demoUser(tx, {
      email: demoEmail(demo.owner),
      name: demo.owner.name,
      phone: demoPhone(DEMO_ACCOUNTS.length),
      password,
    });
    const player = await demoUser(tx, {
      email: demoEmail(demo.player),
      name: demo.player.name,
      phone: demoPhone(DEMO_ACCOUNTS.length + 1),
      password,
    });
    report.push(
      { email: demoEmail(demo.owner), created: owner.isNew },
      { email: demoEmail(demo.player), created: player.isNew },
    );
    await tx
      .insert(spaces)
      .values({
        name: demo.name,
        slug: demo.slug,
        description: demo.description,
        cityId: city.id,
        status: 'ACTIVE',
      })
      .onConflictDoNothing({ target: spaces.slug });
    const [space] = await tx
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.slug, demo.slug));
    if (!space) throw new Error('Espaço de demonstração não encontrado após o insert.');
    await tx
      .insert(spaceMembers)
      .values({ userId: owner.userId, spaceId: space.id, role: 'OWNER', status: 'ACTIVE' })
      .onConflictDoNothing({
        target: [spaceMembers.userId, spaceMembers.spaceId, spaceMembers.role],
      });
    const inserted = await tx
      .insert(spaceSettings)
      .values({
        spaceId: space.id,
        pricePerHourCents: demo.pricePerHourCents,
        bookingMinDurationMin: 60,
        bookingMaxDurationMin: 180,
        bookingMinAdvanceMin: 60,
        bookingWindowDays: 30,
        cancellationDeadlineMin: 120,
        acceptedPaymentMethods: ['PIX', 'CARD', 'CASH'],
      })
      .onConflictDoNothing({ target: spaceSettings.spaceId })
      .returning({ id: spaceSettings.id });
    if (inserted.length) {
      await tx.insert(spaceOpeningHours).values(
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          spaceId: space.id,
          weekday,
          opensAt: '06:00',
          closesAt: '23:00',
        })),
      );
    }
    let [court] = await tx
      .select({ id: courts.id })
      .from(courts)
      .where(eq(courts.spaceId, space.id))
      .limit(1);
    if (!court) {
      [court] = await tx
        .insert(courts)
        .values({ spaceId: space.id, name: 'Quadra Demo' })
        .returning({ id: courts.id });
      if (!court) throw new Error('Quadra de demonstração não criada.');
      await tx.insert(courtSports).values(
        sportRows.map((sport) => ({
          courtId: court?.id as string,
          sportId: sport.id,
          maxPlayers: 4,
        })),
      );
    }
    const sportId = (sportRows.find((s) => s.slug === 'futevolei') ?? sportRows[0])?.id as string;
    return {
      spaceId: space.id,
      ownerId: owner.userId,
      playerId: player.userId,
      courtId: court.id,
      sportId,
      timeZone: city.timeZone || 'America/Sao_Paulo',
    };
  });
  if (!setup) return 'skipped';
  return seedPaymentScenario(db, {
    ...setup,
    merchant: {
      ...demo.merchant,
      responsibleName: demo.owner.name,
      email: demoEmail(demo.owner),
      phone: demoPhone(DEMO_ACCOUNTS.length),
    },
    minuteOfDay: 9 * 60,
  });
}

/** A turma pela mesma geração do painel; quem já mexeu no espaço não ganha turma pela metade. */
async function seedClassGroup(db: Database): Promise<DemoSeedReport['classGroup']> {
  const { space: slug, court, sport, teachers: emails, ...fields } = DEMO_CLASS_GROUP;
  const spaceContext = new SpaceContextService(db);
  const sessions = new ClassSessionsService(db, spaceContext);
  return db.transaction(async (tx) => {
    const spaceId = (await partnerSpaceIds(tx)).get(slug);
    if (!spaceId) throw new Error(`Espaço parceiro ${slug} não encontrado.`);
    const [existing] = await tx
      .select({ id: classGroups.id })
      .from(classGroups)
      .where(and(eq(classGroups.spaceId, spaceId), eq(classGroups.name, fields.name)));
    if (existing) return 'kept';

    const [courtRow] = await tx
      .select({ id: courts.id })
      .from(courts)
      .where(and(eq(courts.spaceId, spaceId), eq(courts.name, court)));
    const [sportRow] = await tx
      .select({ id: sports.id })
      .from(sports)
      .where(eq(sports.slug, sport));
    const members = await tx
      .select({ id: spaceMembers.id })
      .from(spaceMembers)
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.role, 'TEACHER'),
          eq(spaceMembers.status, 'ACTIVE'),
          inArray(
            users.email,
            emails.map((email) => demoEmail({ email })),
          ),
        ),
      );
    if (!courtRow || !sportRow || members.length !== emails.length) return 'skipped';

    const teachers = await assertTeachers(
      tx,
      spaceId,
      members.map((member) => member.id),
    );
    const [group] = await tx
      .insert(classGroups)
      .values({ ...fields, spaceId, courtId: courtRow.id, sportId: sportRow.id })
      .returning();
    if (!group) throw new Error('Insert de turma sem retorno.');
    await setGroupTeachers(tx, group, [], teachers);
    // `FLAG`: uma reserva no horário vira aviso à gestão, sem derrubar o seed.
    await sessions.generateFor(tx, group, await spaceContext.load(spaceId, tx), 'FLAG');
    return 'created';
  });
}

async function partnerSpaceIds(db: Database | Transaction): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: spaces.id, slug: spaces.slug })
    .from(spaces)
    .where(
      inArray(
        spaces.slug,
        SEED_PARTNER_SPACES.map((space) => space.slug),
      ),
    );
  return new Map(rows.map((row) => [row.slug, row.id]));
}

/**
 * Cria a conta (e-mail verificado, telefone fictício não verificado e senha) ou reaproveita a
 * existente, se for do seed: e-mail verificado e senha igual a SEED_DEMO_PASSWORD. A conta do seed
 * criada antes do telefone obrigatório ganha o telefone. Um cadastro público com o mesmo e-mail
 * falha aqui, sem ganhar vínculo com o espaço.
 */
async function demoUser(
  tx: Transaction,
  {
    email,
    name,
    phone,
    password,
  }: { email: string; name: string; phone: string; password: string },
) {
  const [existing] = await tx
    .select({ id: users.id, emailVerified: users.emailVerified, phone: users.phone })
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .for('update');
  if (existing) {
    const hash = await credentialHash(tx, existing.id);
    const owned =
      existing.emailVerified && hash !== null && (await verifyPassword({ hash, password }));
    if (!owned) throw new DemoAccountConflictError(email);
    if (!existing.phone) {
      await tx.update(users).set({ phone, phoneVerified: false }).where(eq(users.id, existing.id));
    }
    return { userId: existing.id, isNew: false };
  }
  const [created] = await tx
    .insert(users)
    .values({
      email: normalizeEmail(email),
      emailVerified: true,
      emailVerifiedAt: new Date(),
      name,
      phone,
      phoneVerified: false,
    })
    .returning({ id: users.id });
  if (!created) throw new Error('Conta de demonstração não encontrada após o insert.');
  await insertCredential(tx, created.id, password);
  return { userId: created.id, isNew: true };
}

/**
 * Grava `DEMO_PHOTOS` (URL e posição, sem blurhash) nos parceiros que ainda não têm nenhuma foto,
 * sob o mesmo lock do upload do painel. Quem já tem foto (implantação ou painel) fica com as dele.
 * São links externos: nada passa pelo storage.
 */
async function seedPhotos(db: Database): Promise<DemoSeedReport['photos']> {
  return db.transaction(async (tx) => {
    const partnerIds = await partnerSpaceIds(tx);
    const photos: DemoSeedReport['photos'] = {};
    for (const { slug } of SEED_PARTNER_SPACES) {
      const spaceId = partnerIds.get(slug);
      if (!spaceId) throw new Error(`Espaço parceiro ${slug} não encontrado.`);
      await lockSpace(tx, spaceId);
      if ((await tx.$count(spacePhotos, eq(spacePhotos.spaceId, spaceId))) > 0) {
        photos[slug] = 'kept';
        continue;
      }
      await tx
        .insert(spacePhotos)
        .values(DEMO_PHOTOS[slug].map((url, position) => ({ spaceId, url, position })));
      photos[slug] = 'added';
    }
    return photos;
  });
}

async function seedLogos(db: Database, options: DemoSeedOptions): Promise<DemoSeedReport['logos']> {
  const logos: DemoSeedReport['logos'] = {};
  const rows = await db
    .select({ id: spaces.id, slug: spaces.slug, logoUrl: spaces.logoUrl })
    .from(spaces)
    .where(
      inArray(
        spaces.slug,
        SEED_PARTNER_SPACES.map((space) => space.slug),
      ),
    );
  const service = new SpaceLogoService(db, options.storage);
  const putObject = options.putObject ?? putWithFetch;
  for (const space of rows) {
    if (space.logoUrl) {
      logos[space.slug] = 'kept';
      continue;
    }
    if (!options.storage.enabled) {
      logos[space.slug] = 'skipped';
      continue;
    }
    const body = new Uint8Array(await readFile(logoFile(space.slug)));
    const upload = await service.createUpload(space.id, {
      contentType: 'image/jpeg',
      size: body.length,
    });
    await putObject(upload, body);
    try {
      // Sem usuário: a auditoria (space.logo.update) sai com actor nulo.
      await service.set(space.id, null, { key: upload.key });
    } catch (err) {
      // Enviado mas não registrado: não deixa o arquivo órfão no bucket.
      await options.storage.delete(upload.key);
      throw err;
    }
    logos[space.slug] = 'uploaded';
  }
  return logos;
}

async function putWithFetch(upload: LogoUpload, body: Uint8Array<ArrayBuffer>): Promise<void> {
  const res = await fetch(upload.uploadUrl, {
    method: upload.method,
    headers: upload.headers,
    body,
  });
  if (!res.ok) throw new Error(`Upload da imagem falhou: HTTP ${res.status}`);
}
