import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditLogs, sports, userSportProfiles, users } from '../../src/db/schema/index.js';
import { createTestApp, PASSWORD, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer } from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';
import { superUser } from '../super/fixtures.js';

// QA das decisões 66 a 70 (RF-AUTH-02): bordas do PATCH /v1/me/profile (fuso da data de
// nascimento, limites, concorrência) e a anonimização pelo fluxo completo de exclusão (LGPD).

describe('perfil: bordas, concorrência e LGPD (QA)', () => {
  let t: TestApp;
  let beach: string;
  let futevolei: string;

  beforeAll(async () => {
    t = await createTestApp();
    const rows = await t.db
      .insert(sports)
      .values([
        { slug: 'qa-beach-tennis', name: 'QA Beach Tennis' },
        { slug: 'qa-futevolei', name: 'QA Futevôlei' },
      ])
      .returning({ id: sports.id });
    [beach, futevolei] = rows.map((r) => r.id) as [string, string];
  });
  afterAll(() => t.close());
  afterEach(() => vi.useRealTimers());

  let n = 0;
  const newUser = () => {
    n += 1;
    return signUp(t, `qa-perfil-${n}@exemplo.com`, `QA Perfil ${n}`);
  };
  const patch = (user: SignedUp, body: unknown) =>
    t
      .http()
      .patch('/v1/me/profile')
      .set(...bearer(user))
      .send(body as object);
  const me = (user: SignedUp) =>
    t
      .http()
      .get('/v1/me')
      .set(...bearer(user));
  const row = async (id: string) => first(await t.db.select().from(users).where(eq(users.id, id)));

  describe('data de nascimento (RN: sem bloqueio de idade, nunca futura, fuso America/Sao_Paulo)', () => {
    it('limites: 1900-01-01 e 29/02 de ano bissexto valem; 1899-12-31 e 29/02 de ano comum não', async () => {
      const user = await newUser();
      await patch(user, { birthDate: '1900-01-01' }).expect(200);
      await patch(user, { birthDate: '2000-02-29' }).expect(200);
      expect((await row(user.id)).birthDate).toBe('2000-02-29');
      await patch(user, { birthDate: '1899-12-31' }).expect(400);
      await patch(user, { birthDate: '1900-02-29' }).expect(400); // 1900 não foi bissexto
      expect((await row(user.id)).birthDate).toBe('2000-02-29');
    });

    it('formatos fora de AAAA-MM-DD são recusados (sem horário, sem barra, sem número)', async () => {
      const user = await newUser();
      for (const birthDate of [
        '17/05/1990',
        '1990-5-17',
        '1990-05-17T00:00:00Z',
        '19900517',
        641_088_000,
        '',
      ]) {
        const res = await patch(user, { birthDate });
        expect(res.status, String(birthDate)).toBe(400);
      }
      expect((await row(user.id)).birthDate).toBeNull();
    });

    it('"hoje" é o dia de Sao_Paulo: às 23h30 em SP (02h30 UTC do dia seguinte) o dia UTC já é futuro', async () => {
      const user = await newUser();
      const now = new Date();
      // 02:30 UTC do dia seguinte ao dia UTC de hoje = 23:30 de "hoje UTC" em Sao_Paulo (UTC-3).
      const fake = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 2, 30),
      );
      const spToday = now.toISOString().slice(0, 10);
      const utcToday = fake.toISOString().slice(0, 10);
      expect(utcToday).not.toBe(spToday);

      vi.useFakeTimers({ toFake: ['Date'], now: fake });
      try {
        await patch(user, { birthDate: spToday }).expect(200);
        const future = await patch(user, { birthDate: utcToday });
        expect(future.status, 'o dia UTC ainda é futuro em Sao_Paulo').toBe(400);
      } finally {
        vi.useRealTimers();
      }
      expect((await row(user.id)).birthDate).toBe(spToday);
    });
  });

  describe('campos e limites', () => {
    it('corpo vazio: 200, nada muda e sem entrada de auditoria', async () => {
      const user = await newUser();
      const before = await row(user.id);
      const res = await patch(user, {}).expect(200);
      expect(res.body).toMatchObject({ name: before.name, phone: before.phone });
      expect(
        await t.db.$count(
          auditLogs,
          and(eq(auditLogs.entityId, user.id), eq(auditLogs.action, 'user.profile.update')),
        ),
      ).toBe(0);
    });

    it('campos desconhecidos ou protegidos são recusados (platformRole, status, emailVerified, phoneVerified)', async () => {
      const user = await newUser();
      for (const body of [
        { platformRole: 'SUPER' },
        { status: 'BLOCKED' },
        { emailVerified: true },
        { phoneVerified: true },
        { id: '00000000-0000-4000-8000-000000000000' },
      ]) {
        expect((await patch(user, body)).status, JSON.stringify(body)).toBe(400);
      }
      expect(await row(user.id)).toMatchObject({
        platformRole: 'USER',
        phoneVerified: false,
        emailVerified: false,
      });
    });

    it('nome: aparado, no máximo 120 caracteres', async () => {
      const user = await newUser();
      const res = await patch(user, { name: '   Nome Aparado   ' }).expect(200);
      expect(res.body.name).toBe('Nome Aparado');
      await patch(user, { name: 'a'.repeat(120) }).expect(200);
      await patch(user, { name: 'a'.repeat(121) }).expect(400);
    });

    it('nível nulo explícito e ausente valem o mesmo; trocar o nível de um esporte mantém um registro só', async () => {
      const user = await newUser();
      await patch(user, {
        favoriteSports: [{ sportId: beach, level: null }, { sportId: futevolei }],
      }).expect(200);
      let list = (await me(user).expect(200)).body.favoriteSports;
      expect(list.map((i: { level: unknown }) => i.level)).toEqual([null, null]);

      await patch(user, { favoriteSports: [{ sportId: beach, level: 'PRO' }] }).expect(200);
      list = (await me(user).expect(200)).body.favoriteSports;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ level: 'PRO' });
      expect(await t.db.$count(userSportProfiles, eq(userSportProfiles.userId, user.id))).toBe(1);
    });

    it('esportes favoritos: no máximo 20 (21 é 400 e não grava nada)', async () => {
      const user = await newUser();
      const extra = await t.db
        .insert(sports)
        .values(
          Array.from({ length: 21 }, (_, i) => ({ slug: `qa-lote-${n}-${i}`, name: `Lote ${i}` })),
        )
        .returning({ id: sports.id });
      await patch(user, {
        favoriteSports: extra.slice(0, 20).map((s) => ({ sportId: s.id })),
      }).expect(200);
      await patch(user, { favoriteSports: extra.map((s) => ({ sportId: s.id })) }).expect(400);
      expect(await t.db.$count(userSportProfiles, eq(userSportProfiles.userId, user.id))).toBe(20);
    });

    it('a lista de esportes é do próprio usuário: o PATCH de um não mexe nos favoritos do outro', async () => {
      const a = await newUser();
      const b = await newUser();
      await patch(a, { favoriteSports: [{ sportId: beach, level: 'ADVANCED' }] }).expect(200);
      await patch(b, { favoriteSports: [{ sportId: futevolei }] }).expect(200);
      await patch(b, { favoriteSports: [] }).expect(200);
      expect((await me(a).expect(200)).body.favoriteSports).toHaveLength(1);
    });

    it('trocar o telefone devolve phoneVerified=false mesmo quando o novo número é o de outra conta verificada', async () => {
      const owner = await newUser();
      await t.db
        .update(users)
        .set({ phone: '+5531955550001', phoneVerified: true })
        .where(eq(users.id, owner.id));
      const user = await newUser();
      const res = await patch(user, { phone: '+5531955550001' }).expect(200);
      expect(res.body).toMatchObject({ phone: '+5531955550001', phoneVerified: false });
    });

    it('conta bloqueada ou inativa não edita o perfil', async () => {
      const user = await newUser();
      await t.db.update(users).set({ status: 'BLOCKED' }).where(eq(users.id, user.id));
      const res = await patch(user, { name: 'Bloqueado Edita' });
      expect(res.status).toBeGreaterThanOrEqual(401);
      expect(res.status).toBeLessThanOrEqual(403);
      expect((await row(user.id)).name).toBe(`QA Perfil ${n}`);
    });
  });

  describe('concorrência', () => {
    it('dois PATCH simultâneos da lista de esportes: um vence, sem 500 e sem registros duplicados', async () => {
      const user = await newUser();
      const results = await Promise.all([
        patch(user, {
          favoriteSports: [{ sportId: beach, level: 'BEGINNER' }, { sportId: futevolei }],
        }),
        patch(user, { favoriteSports: [{ sportId: beach, level: 'PRO' }, { sportId: futevolei }] }),
        patch(user, { favoriteSports: [{ sportId: futevolei, level: 'ADVANCED' }] }),
      ]);
      expect(
        results.map((r) => r.status),
        JSON.stringify(results.map((r) => r.body)),
      ).not.toContain(500);
      const rows = await t.db
        .select()
        .from(userSportProfiles)
        .where(eq(userSportProfiles.userId, user.id));
      // Nunca duas linhas para o mesmo esporte.
      expect(new Set(rows.map((r) => r.sportId)).size).toBe(rows.length);
    });
  });

  describe('anonimização pelo fluxo completo (LGPD, decisões 67 a 69)', () => {
    it('pedido de exclusão atendido limpa nascimento, gênero, esportes e telefone; a auditoria não guarda dado pessoal', async () => {
      const admin = await superUser(t, 'qa-super-lgpd@exemplo.com');
      const user = await newUser();
      await patch(user, {
        birthDate: '1991-03-04',
        gender: 'FEMALE',
        phone: '+5531944440001',
        favoriteSports: [{ sportId: beach, level: 'PRO' }],
      }).expect(200);
      expect(await row(user.id)).toMatchObject({ birthDate: '1991-03-04', gender: 'FEMALE' });

      const { requestId } = (
        await t
          .http()
          .post('/v1/me/deletion-request')
          .set(...bearer(user))
          .send({ password: PASSWORD })
          .expect(201)
      ).body;
      await t
        .http()
        .post(`/v1/super/deletion-requests/${requestId}/fulfill`)
        .set(...bearer(admin))
        .send({})
        .expect(200);

      expect(await row(user.id)).toMatchObject({
        email: null,
        phone: null,
        phoneVerified: false,
        avatarUrl: null,
        birthDate: null,
        gender: null,
        deletedAt: expect.any(Date),
      });
      expect(await t.db.$count(userSportProfiles, eq(userSportProfiles.userId, user.id))).toBe(0);

      const audit = await t.db.select().from(auditLogs).where(eq(auditLogs.entityId, user.id));
      const dump = JSON.stringify(audit);
      for (const secret of ['1991-03-04', '5531944440001', 'FEMALE']) {
        expect(dump, `auditoria vazou ${secret}`).not.toContain(secret);
      }
    });

    it('o telefone da conta excluída pode ser digitado de novo em outro cadastro', async () => {
      const phone = '+5531944440002';
      const admin = await superUser(t, 'qa-super-lgpd2@exemplo.com');
      const user = await signUp(t, `qa-lgpd-reuso@exemplo.com`, 'Reuso', phone);
      const { requestId } = (
        await t
          .http()
          .post('/v1/me/deletion-request')
          .set(...bearer(user))
          .send({ password: PASSWORD })
          .expect(201)
      ).body;
      await t
        .http()
        .post(`/v1/super/deletion-requests/${requestId}/fulfill`)
        .set(...bearer(admin))
        .send({})
        .expect(200);
      await signUp(t, `qa-lgpd-reuso-2@exemplo.com`, 'Reuso 2', phone);
      await signUp(t, `qa-lgpd-reuso@exemplo.com`, 'Reuso 3', phone); // mesmo e-mail liberado
    });
  });
});
