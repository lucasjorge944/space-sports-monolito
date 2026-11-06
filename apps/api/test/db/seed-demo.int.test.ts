import { BRAZILIAN_PHONE_REGEX } from '@space-sports/shared';
import { verifyPassword } from 'better-auth/crypto';
import { and, eq, getTableName, isNull, type Table } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_AD_DAYS, DEMO_ADS, demoCampaignName } from '../../src/db/demo-ads.js';
import {
  DEMO_ACCOUNTS,
  DEMO_CLASS_GROUP,
  DEMO_PAYMENTS_SPACE,
  DEMO_PHOTOS,
  DemoAccountConflictError,
  DemoSeedInProductionError,
  DemoSeedNotAllowedError,
  type DemoSeedOptions,
  seedDemo,
} from '../../src/db/demo-seed.js';
import {
  accounts,
  adCampaigns,
  adCreatives,
  advertisers,
  auditLogs,
  classGroups,
  classGroupTeachers,
  classSessions,
  classSessionTeachers,
  courts,
  merchantAccounts,
  onlineCharges,
  plans,
  spaceLedgerEntries,
  spaceMembers,
  spaceOpeningHours,
  spacePaymentSettings,
  spacePhotos,
  spaceSettings,
  spaces,
  users,
} from '../../src/db/schema/index.js';
import { SEED_PARTNER_SPACES, seed } from '../../src/db/seed.js';
import { FakeStorage } from '../spaces/fixtures.js';
import { createTestDatabase, first, type TestDatabase } from './helpers.js';

const PASSWORD = 'senha-da-demo-123';

function options(storage: FakeStorage, extra: Partial<DemoSeedOptions> = {}): DemoSeedOptions {
  return {
    password: PASSWORD,
    nodeEnv: 'development',
    allowDemoSeed: 'true',
    storage,
    // Simula o PUT na URL pré-assinada.
    putObject: async (upload, body) => storage.uploadBody(upload.key, body),
    ...extra,
  };
}

describe('seed de demonstração', () => {
  let t: TestDatabase;
  const storage = new FakeStorage();

  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(() => t.drop());

  async function counts() {
    const tables: Table[] = [
      users,
      accounts,
      spaceMembers,
      spaces,
      courts,
      spacePhotos,
      auditLogs,
      classGroups,
      classSessions,
      advertisers,
      adCampaigns,
      adCreatives,
    ];
    const entries = await Promise.all(
      tables.map(async (table) => [getTableName(table), await t.db.$count(table)] as const),
    );
    return Object.fromEntries(entries);
  }

  it('recusa rodar com NODE_ENV=production, sem gravar nada', async () => {
    await expect(seedDemo(t.db, options(storage, { nodeEnv: 'production' }))).rejects.toThrow(
      DemoSeedInProductionError,
    );
    expect(await t.db.$count(spaces)).toBe(0);
    expect(await t.db.$count(users)).toBe(0);
    expect(await t.db.$count(spacePhotos)).toBe(0);
  });

  it('recusa rodar sem ALLOW_DEMO_SEED=true, sem gravar nada', async () => {
    await expect(seedDemo(t.db, options(storage, { allowDemoSeed: undefined }))).rejects.toThrow(
      DemoSeedNotAllowedError,
    );
    expect(await t.db.$count(spaces)).toBe(0);
    expect(await t.db.$count(users)).toBe(0);
    expect(await t.db.$count(spacePhotos)).toBe(0);
  });

  it('roda o seed de produção e cria as contas verificadas, com a senha de SEED_DEMO_PASSWORD', async () => {
    const report = await seedDemo(t.db, options(storage));
    expect(report.accounts.every((a) => a.created)).toBe(true);
    expect(report.photos).toEqual({
      'astral-beach-sports': 'added',
      'arena-errejota': 'added',
      'duna-sports': 'added',
    });
    expect(await t.db.$count(spaces)).toBe(SEED_PARTNER_SPACES.length);
    expect(await t.db.$count(courts)).toBe(7);

    const rows = await t.db.select().from(users).orderBy(users.email);
    expect(rows.map((u) => u.email)).toEqual(
      DEMO_ACCOUNTS.map((a) => `${a.email}@exemplo.com`).sort(),
    );
    for (const user of rows) {
      expect(user).toMatchObject({
        emailVerified: true,
        phone: expect.stringMatching(BRAZILIAN_PHONE_REGEX),
        phoneVerified: false,
        platformRole: 'USER',
        status: 'ACTIVE',
      });
      const credential = first(
        await t.db.select().from(accounts).where(eq(accounts.userId, user.id)),
      );
      expect(credential).toMatchObject({ providerId: 'credential', accountId: user.id });
      expect(await verifyPassword({ hash: credential.password ?? '', password: PASSWORD })).toBe(
        true,
      );
    }
    expect(first(rows.filter((u) => u.email === 'goiano.astral@exemplo.com')).name).toBe('Goiano');
  });

  it('vínculos ACTIVE: Goiano Dono da Astral; Bruno, Galantine e Potenza professores; 2 professores na Errejota e na Duna', async () => {
    const links = await t.db
      .select({
        name: users.name,
        slug: spaces.slug,
        role: spaceMembers.role,
        status: spaceMembers.status,
      })
      .from(spaceMembers)
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId));
    expect(links.every((l) => l.status === 'ACTIVE')).toBe(true);
    const by = (slug: string, role: string) =>
      links
        .filter((l) => l.slug === slug && l.role === role)
        .map((l) => l.name)
        .sort();
    expect(by('astral-beach-sports', 'OWNER')).toEqual(['Goiano']);
    expect(by('astral-beach-sports', 'TEACHER')).toEqual(['Bruno', 'Galantine', 'Potenza']);
    expect(by('arena-errejota', 'TEACHER')).toHaveLength(2);
    expect(by('duna-sports', 'TEACHER')).toHaveLength(2);
    expect(links).toHaveLength(DEMO_ACCOUNTS.length);
  });

  it('envia as logos dos parceiros pelo serviço do upload (auditado sem usuário)', async () => {
    const rows = await t.db.select().from(spaces);
    for (const space of rows) {
      expect(space.logoUrl).toMatch(
        // Chave publicada nova a cada registro: `<uuid do upload>-<uuid novo>.jpg`.
        new RegExp(
          `^https://fotos\\.test/spaces/${space.id}/logo/[0-9a-f-]{36}-[0-9a-f-]{36}\\.jpg$`,
        ),
      );
    }
    const logged = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'space.logo.update'), isNull(auditLogs.actorId)));
    expect(logged).toHaveLength(SEED_PARTNER_SPACES.length);
  });

  it('grava as fotos ilustrativas de DEMO_PHOTOS nos parceiros, na ordem (capa = posição 0)', async () => {
    const rows = await t.db
      .select({
        slug: spaces.slug,
        url: spacePhotos.url,
        position: spacePhotos.position,
        blurhash: spacePhotos.blurhash,
      })
      .from(spacePhotos)
      .innerJoin(spaces, eq(spaces.id, spacePhotos.spaceId))
      .orderBy(spaces.slug, spacePhotos.position);
    for (const { slug } of SEED_PARTNER_SPACES) {
      expect(rows.filter((row) => row.slug === slug)).toEqual(
        DEMO_PHOTOS[slug].map((url, position) => ({ slug, url, position, blurhash: null })),
      );
    }
    // Links externos: nada foi enviado ao storage nem é do bucket.
    expect(rows.every((row) => storage.keyFromUrl(row.url) === null)).toBe(true);
    expect(
      [...storage.objects.keys()].every((key) => key.includes('/logo/') || key.startsWith('ads/')),
    ).toBe(true);
  });

  it('não cria preço, horário de funcionamento nem plano', async () => {
    for (const settings of await t.db.select().from(spaceSettings)) {
      expect(settings.pricePerHourCents).toBeNull();
    }
    expect(await t.db.$count(spaceOpeningHours)).toBe(0);
    expect(await t.db.$count(plans)).toBe(0);
  });

  it('cria na Astral uma turma de dois professores, com as aulas na lista dos dois', async () => {
    const group = first(await t.db.select().from(classGroups));
    expect(await t.db.$count(classGroups)).toBe(1);
    expect(group.name).toBe(DEMO_CLASS_GROUP.name);
    const space = first(await t.db.select().from(spaces).where(eq(spaces.id, group.spaceId)));
    expect(space.slug).toBe('astral-beach-sports');

    const teachers = await t.db
      .select({ name: users.name })
      .from(classGroupTeachers)
      .innerJoin(spaceMembers, eq(spaceMembers.id, classGroupTeachers.teacherMemberId))
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .where(eq(classGroupTeachers.classGroupId, group.id))
      .orderBy(users.name);
    expect(teachers.map((teacher) => teacher.name)).toEqual(['Bruno', 'Galantine']);

    const sessions = await t.db
      .select()
      .from(classSessions)
      .where(eq(classSessions.classGroupId, group.id));
    expect(sessions.length).toBeGreaterThanOrEqual(4);
    for (const session of sessions) {
      expect(
        await t.db.$count(
          classSessionTeachers,
          eq(classSessionTeachers.classSessionId, session.id),
        ),
      ).toBe(2);
    }
  });

  it('cria os anúncios de demonstração no ar por 90 dias, pelo serviço do upload', async () => {
    const rows = await t.db
      .select({
        advertiser: advertisers.name,
        kind: advertisers.kind,
        spaceId: advertisers.spaceId,
        campaign: adCampaigns.name,
        placement: adCampaigns.placement,
        status: adCampaigns.status,
        startsAt: adCampaigns.startsAt,
        endsAt: adCampaigns.endsAt,
        cityIds: adCampaigns.cityIds,
        sportIds: adCampaigns.sportIds,
        campaignId: adCampaigns.id,
        title: adCreatives.title,
        imageUrl: adCreatives.imageUrl,
        destinationType: adCreatives.destinationType,
        destinationUrl: adCreatives.destinationUrl,
        destinationSpaceId: adCreatives.destinationSpaceId,
      })
      .from(adCreatives)
      .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
      .innerJoin(advertisers, eq(advertisers.id, adCampaigns.advertiserId));
    expect(rows).toHaveLength(DEMO_ADS.length);
    const astral = first(
      await t.db.select().from(spaces).where(eq(spaces.slug, 'astral-beach-sports')),
    );
    for (const ad of DEMO_ADS) {
      const row = first(rows.filter((r) => r.advertiser === ad.advertiser.name));
      expect(row).toMatchObject({
        campaign: demoCampaignName(ad),
        placement: ad.placement,
        status: 'ACTIVE',
        cityIds: [],
        sportIds: [],
        title: ad.title,
      });
      expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(
        DEMO_AD_DAYS * 24 * 60 * 60 * 1000,
      );
      if (ad.image) {
        expect(row.kind).toBe('COMPANY');
        expect(row.imageUrl).toMatch(
          new RegExp(
            `^https://fotos\\.test/ads/${row.campaignId}/[0-9a-f-]{36}-[0-9a-f-]{36}\\.jpg$`,
          ),
        );
      } else {
        // O destaque do parceiro: sem imagem, destino na página do espaço.
        expect(row).toMatchObject({
          kind: 'SPACE',
          spaceId: astral.id,
          imageUrl: null,
          destinationType: 'SPACE',
          destinationSpaceId: astral.id,
        });
      }
      if (row.destinationUrl) expect(new URL(row.destinationUrl).hostname).toBe('example.com');
    }
    // Uploads não sobram: só as cópias publicadas.
    expect([...storage.objects.keys()].some((key) => key.startsWith('uploads/'))).toBe(false);
    const logged = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'super.ad_creative.create'), isNull(auditLogs.actorId)));
    expect(logged).toHaveLength(DEMO_ADS.length);
    expect(logged.every((row) => !row.actingAsSuper)).toBe(true);
  });

  it('é idempotente: não duplica contas, vínculos nem logos, e não troca a senha', async () => {
    const before = await counts();
    const objects = storage.objects.size;
    const report = await seedDemo(t.db, options(storage));
    expect(await counts()).toEqual(before);
    expect(storage.objects.size).toBe(objects);
    expect(report.accounts.some((a) => a.created)).toBe(false);
    expect(report.classGroup).toBe('kept');
    expect(report.photos).toEqual({
      'astral-beach-sports': 'kept',
      'arena-errejota': 'kept',
      'duna-sports': 'kept',
    });
    expect(Object.values(report.logos)).toEqual(['kept', 'kept', 'kept']);
    expect(Object.values(report.ads)).toEqual(
      DEMO_ADS.map(() => ({ campaign: 'kept', creative: 'kept' })),
    );

    // Outra senha só falha a conferência da conta existente (não troca a senha).
    await expect(seedDemo(t.db, options(storage, { password: 'outra-senha-456' }))).rejects.toThrow(
      DemoAccountConflictError,
    );
  });

  it('não recria nem reativa o destaque do espaço que o Super desativou', async () => {
    const astral = first(
      await t.db.select().from(spaces).where(eq(spaces.slug, 'astral-beach-sports')),
    );
    const [before] = await t.db
      .update(advertisers)
      .set({ active: false })
      .where(eq(advertisers.spaceId, astral.id))
      .returning();
    const total = await t.db.$count(advertisers);

    const report = await seedDemo(t.db, options(storage));
    expect(report.ads['Astral Beach Sports']).toEqual({ campaign: 'kept', creative: 'kept' });
    expect(await t.db.$count(advertisers)).toBe(total);
    const rows = await t.db.select().from(advertisers).where(eq(advertisers.spaceId, astral.id));
    expect(rows).toEqual([expect.objectContaining({ id: before?.id, active: false })]);
  });
});

describe('DEMO_PHOTOS', () => {
  it('3 fotos por parceiro, do CDN do Unsplash com tamanho, sem repetir entre espaços', () => {
    expect(Object.keys(DEMO_PHOTOS).sort()).toEqual(SEED_PARTNER_SPACES.map((s) => s.slug).sort());
    const all = Object.values(DEMO_PHOTOS).flat();
    expect(all).toHaveLength(SEED_PARTNER_SPACES.length * 3);
    const photoIds = all.map((url) => new URL(url).pathname);
    expect(new Set(photoIds).size).toBe(all.length);
    for (const url of all) {
      expect(url).toMatch(/^https:\/\/images\.unsplash\.com\/photo-[0-9]+-[0-9a-f]+\?/);
      expect(new URL(url).searchParams.get('w')).toBe('1600');
    }
  });
});

describe('seed de demonstração: sem R2, parceiro com foto e conta que o seed não criou', () => {
  it('sem storage configurado, pula as logos e cria o resto', async () => {
    const t = await createTestDatabase();
    try {
      const storage = new FakeStorage();
      storage.enabled = false;
      const report = await seedDemo(t.db, options(storage));
      expect(Object.values(report.logos)).toEqual(['skipped', 'skipped', 'skipped']);
      for (const space of await t.db.select().from(spaces)) expect(space.logoUrl).toBeNull();
      // As fotos são links externos: não dependem do R2.
      expect(Object.values(report.photos)).toEqual(['added', 'added', 'added']);
      expect(await t.db.$count(spacePhotos)).toBe(9);
      expect(await t.db.$count(spaceMembers)).toBe(DEMO_ACCOUNTS.length);
      // Anúncios: as campanhas existem; só a peça sem imagem (o espaço) é criada.
      expect(report.ads['Astral Beach Sports']).toEqual({
        campaign: 'created',
        creative: 'created',
      });
      expect(Object.values(report.ads).filter((ad) => ad.creative === 'skipped')).toHaveLength(
        DEMO_ADS.filter((ad) => ad.image).length,
      );
      expect(await t.db.$count(adCampaigns)).toBe(DEMO_ADS.length);
      expect(await t.db.$count(adCreatives)).toBe(1);

      // Com o storage ligado, o próximo seed completa as peças que faltam.
      storage.enabled = true;
      const again = await seedDemo(t.db, options(storage));
      expect(again.ads['Astral Beach Sports']).toEqual({ campaign: 'kept', creative: 'kept' });
      expect(again.ads['Hidrata+']).toEqual({ campaign: 'kept', creative: 'uploaded' });
      expect(await t.db.$count(adCreatives)).toBe(DEMO_ADS.length);
    } finally {
      await t.drop();
    }
  });

  it('arquivo enviado mas registro da logo falhou: apaga o upload do storage', async () => {
    const t = await createTestDatabase();
    try {
      const storage = new FakeStorage();
      storage.failCopy = new Error('storage fora do ar');
      const sent: string[] = [];
      await expect(
        seedDemo(
          t.db,
          options(storage, {
            putObject: async (upload, body) => {
              sent.push(upload.key);
              storage.uploadBody(upload.key, body);
            },
          }),
        ),
      ).rejects.toThrow('storage fora do ar');
      expect(sent).toHaveLength(1);
      expect(storage.deleted).toEqual(sent);
      expect(storage.objects.size).toBe(0);
      for (const space of await t.db.select().from(spaces)) expect(space.logoUrl).toBeNull();
    } finally {
      await t.drop();
    }
  });

  it('parceiro que já tem foto fica com as dele; os outros recebem as ilustrativas', async () => {
    const t = await createTestDatabase();
    try {
      await seed(t.db);
      const astral = first(
        await t.db.select().from(spaces).where(eq(spaces.slug, 'astral-beach-sports')),
      );
      const own = 'https://fotos.test/spaces/astral/photos/da-implantacao.jpg';
      await t.db.insert(spacePhotos).values({ spaceId: astral.id, url: own, position: 0 });

      const report = await seedDemo(t.db, options(new FakeStorage()));
      expect(report.photos).toEqual({
        'astral-beach-sports': 'kept',
        'arena-errejota': 'added',
        'duna-sports': 'added',
      });
      const photosOf = async (spaceId: string) =>
        (
          await t.db
            .select({ url: spacePhotos.url })
            .from(spacePhotos)
            .where(eq(spacePhotos.spaceId, spaceId))
            .orderBy(spacePhotos.position)
        ).map((photo) => photo.url);
      expect(await photosOf(astral.id)).toEqual([own]);
      for (const slug of ['arena-errejota', 'duna-sports'] as const) {
        const space = first(await t.db.select().from(spaces).where(eq(spaces.slug, slug)));
        expect(await photosOf(space.id)).toEqual([...DEMO_PHOTOS[slug]]);
      }
    } finally {
      await t.drop();
    }
  });

  it('e-mail de demonstração já cadastrado por outra pessoa (não verificado): recusa sem dar vínculo', async () => {
    const t = await createTestDatabase();
    try {
      await t.db
        .insert(users)
        .values({ email: 'goiano.astral@exemplo.com', name: 'Quem chegou antes' });
      await expect(seedDemo(t.db, options(new FakeStorage()))).rejects.toThrow(
        DemoAccountConflictError,
      );
      expect(await t.db.$count(spaceMembers)).toBe(0);
    } finally {
      await t.drop();
    }
  });
});

describe('seed de demonstração: pagamento online (só com o gateway fake)', () => {
  it('cria o espaço fictício com cadastro aprovado, modos ativos e a carteira com movimento; idempotente', async () => {
    const t = await createTestDatabase();
    try {
      const report = await seedDemo(t.db, options(new FakeStorage(), { paymentsProvider: 'fake' }));
      expect(report.payments).toBe('created');
      const space = first(
        await t.db.select().from(spaces).where(eq(spaces.slug, DEMO_PAYMENTS_SPACE.slug)),
      );
      // Não é um parceiro de docs/08.
      expect(SEED_PARTNER_SPACES.map((s) => s.slug)).not.toContain(space.slug);
      const merchant = first(
        await t.db.select().from(merchantAccounts).where(eq(merchantAccounts.spaceId, space.id)),
      );
      expect(merchant).toMatchObject({ status: 'APPROVED', provider: 'fake' });
      const settings = first(
        await t.db
          .select()
          .from(spacePaymentSettings)
          .where(eq(spacePaymentSettings.spaceId, space.id)),
      );
      expect(settings).toMatchObject({
        bookingMode: 'ONLINE_OPTIONAL',
        classMode: 'ONLINE_OPTIONAL',
      });
      const charges = await t.db
        .select()
        .from(onlineCharges)
        .where(eq(onlineCharges.spaceId, space.id));
      expect(charges.map((c) => c.status).sort()).toEqual(['PAID', 'PAID', 'PARTIALLY_REFUNDED']);
      const kinds = new Set(
        (
          await t.db
            .select({ kind: spaceLedgerEntries.kind })
            .from(spaceLedgerEntries)
            .where(eq(spaceLedgerEntries.spaceId, space.id))
        ).map((e) => e.kind),
      );
      expect([...kinds].sort()).toEqual(['FEE_REFUND', 'PAYOUT', 'PLATFORM_FEE', 'REFUND', 'SALE']);

      const again = await seedDemo(t.db, options(new FakeStorage(), { paymentsProvider: 'fake' }));
      expect(again.payments).toBe('kept');
      expect(await t.db.$count(onlineCharges)).toBe(3);
      // Sem o fake, nada de pagamento.
      const none = await seedDemo(t.db, options(new FakeStorage(), { paymentsProvider: 'none' }));
      expect(none.payments).toBe('skipped');
    } finally {
      await t.drop();
    }
  });
});
