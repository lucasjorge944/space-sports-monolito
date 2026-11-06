import { Controller, Get, Module, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser, SpaceAccess } from '../../src/auth/auth-context.js';
import {
  CurrentSpaceAccess,
  CurrentUser,
  Public,
  SpacePermission,
  SpaceRoles,
  SuperOnly,
} from '../../src/auth/decorators.js';
import { cities, spaceMembers, spaces, users } from '../../src/db/schema/index.js';
import { first } from '../db/helpers.js';
import { createTestApp, makeSuper, type SignedUp, signUp, type TestApp } from './helpers.js';

// Rotas só de teste, com os decorators de autorização como as rotas reais vão usá-los.

@Controller('test/super')
class SuperTestController {
  @Get()
  @SuperOnly()
  ok(@CurrentUser() user: AuthUser) {
    return { userId: user.id };
  }
}

@Controller('test/spaces/:spaceId')
class SpaceTestController {
  @Post('desk-bookings')
  @SpacePermission('booking.create')
  createDeskBooking(@CurrentSpaceAccess() access: SpaceAccess) {
    return access;
  }

  @Get('reports')
  @SpaceRoles('OWNER', 'ADMIN')
  reports(@CurrentSpaceAccess() access: SpaceAccess) {
    return access;
  }

  @Get('schedule')
  @SpacePermission('schedule.view')
  schedule(@CurrentSpaceAccess() access: SpaceAccess) {
    return access;
  }
}

@Public()
@Controller('test/public')
class PublicTestController {
  @Get()
  ok(@CurrentUser() user: AuthUser | undefined) {
    return { user: user ?? null };
  }
}

@Module({ controllers: [SuperTestController, SpaceTestController, PublicTestController] })
class GuardsTestModule {}

describe('autorização', () => {
  let t: TestApp;
  let spaceA: string;
  let spaceB: string;
  let anyone: SignedUp;
  let superUser: SignedUp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [GuardsTestModule] });
    const city = first(
      await t.db
        .insert(cities)
        .values({ name: 'Belo Horizonte', state: 'MG', timezone: 'America/Sao_Paulo' })
        .returning(),
    );
    [spaceA, spaceB] = (
      await t.db
        .insert(spaces)
        .values([
          { name: 'Espaço A', slug: 'espaco-a', cityId: city.id },
          { name: 'Espaço B', slug: 'espaco-b', cityId: city.id },
        ])
        .returning()
    ).map((space) => space.id) as [string, string];
    anyone = await signUp(t, 'jogador@exemplo.com');
    superUser = await signUp(t, 'super@exemplo.com');
    await makeSuper(t.db, superUser.id);
  });
  afterAll(() => t.close());

  async function member(
    email: string,
    roles: {
      spaceId: string;
      role: 'OWNER' | 'ADMIN' | 'TEACHER';
      status?: 'INVITED' | 'ACTIVE' | 'REMOVED';
    }[],
  ) {
    const user = await signUp(t, email);
    await t.db
      .insert(spaceMembers)
      .values(roles.map((r) => ({ userId: user.id, status: 'ACTIVE' as const, ...r })));
    return user;
  }

  describe('guard de plataforma (RN-AUTH-02)', () => {
    it('permite o SUPER', async () => {
      const res = await t.http().get('/v1/test/super').set('cookie', superUser.cookie).expect(200);
      expect(res.body).toEqual({ userId: superUser.id });
    });

    it('nega quem não é SUPER, mesmo dono de espaço', async () => {
      const owner = await member('dono-nao-super@exemplo.com', [
        { spaceId: spaceA, role: 'OWNER' },
      ]);
      for (const user of [anyone, owner]) {
        const res = await t
          .http()
          .get('/v1/test/super')
          .set('authorization', `Bearer ${user.token}`)
          .expect(403);
        expect(res.body.error.code).toBe('SUPER_REQUIRED');
      }
    });

    it('sem sessão responde 401', async () => {
      await t.http().get('/v1/test/super').expect(401);
    });

    it('o papel é relido a cada requisição: rebaixado, perde o acesso na hora', async () => {
      const user = await signUp(t, 'ex-super@exemplo.com');
      await makeSuper(t.db, user.id);
      await t.http().get('/v1/test/super').set('cookie', user.cookie).expect(200);
      await t.db.update(users).set({ platformRole: 'USER' }).where(eq(users.id, user.id));
      await t.http().get('/v1/test/super').set('cookie', user.cookie).expect(403);
    });
  });

  describe('guard de espaço (RN-AUTH-01, RN-AUTH-03)', () => {
    it('papel certo no espaço certo: permite e entrega os papéis do espaço', async () => {
      const manager = await member('gestor@exemplo.com', [
        { spaceId: spaceA, role: 'ADMIN' },
        { spaceId: spaceA, role: 'TEACHER' },
      ]);
      const res = await t
        .http()
        .post(`/v1/test/spaces/${spaceA}/desk-bookings`)
        .set('cookie', manager.cookie)
        .expect(201);
      expect(res.body).toEqual({
        spaceId: spaceA,
        roles: ['ADMIN', 'TEACHER'],
        spaceStatus: 'ACTIVE',
      });
    });

    it('papel em outro espaço não vale', async () => {
      const ownerOfB = await member('dono-b@exemplo.com', [{ spaceId: spaceB, role: 'OWNER' }]);
      await t
        .http()
        .get(`/v1/test/spaces/${spaceB}/reports`)
        .set('cookie', ownerOfB.cookie)
        .expect(200);
      const res = await t
        .http()
        .get(`/v1/test/spaces/${spaceA}/reports`)
        .set('cookie', ownerOfB.cookie)
        .expect(403);
      expect(res.body.error).toEqual({
        code: 'SPACE_FORBIDDEN',
        message: 'Você não tem permissão para esta ação neste espaço.',
      });
    });

    it('papéis diferentes em espaços diferentes (professor em A, admin em B)', async () => {
      const user = await member('multi@exemplo.com', [
        { spaceId: spaceA, role: 'TEACHER' },
        { spaceId: spaceB, role: 'ADMIN' },
      ]);
      // Professor vê a agenda, mas não cria reserva de balcão (matriz de docs/02).
      await t
        .http()
        .get(`/v1/test/spaces/${spaceA}/schedule`)
        .set('cookie', user.cookie)
        .expect(200);
      await t
        .http()
        .post(`/v1/test/spaces/${spaceA}/desk-bookings`)
        .set('cookie', user.cookie)
        .expect(403);
      await t
        .http()
        .post(`/v1/test/spaces/${spaceB}/desk-bookings`)
        .set('cookie', user.cookie)
        .expect(201);
      // Admin em B vê os relatórios; o papel de Professor em A não dá esse acesso.
      await t
        .http()
        .get(`/v1/test/spaces/${spaceB}/reports`)
        .set('cookie', user.cookie)
        .expect(200);
      await t
        .http()
        .get(`/v1/test/spaces/${spaceA}/reports`)
        .set('cookie', user.cookie)
        .expect(403);
    });

    it('vínculo convidado ou removido não dá acesso', async () => {
      const user = await member('pendente@exemplo.com', [
        { spaceId: spaceA, role: 'ADMIN', status: 'INVITED' },
        { spaceId: spaceB, role: 'ADMIN', status: 'REMOVED' },
      ]);
      for (const spaceId of [spaceA, spaceB]) {
        await t
          .http()
          .get(`/v1/test/spaces/${spaceId}/reports`)
          .set('cookie', user.cookie)
          .expect(403);
      }
    });

    it('o SUPER não tem acesso automático aos espaços (modo suporte é da Fase 1)', async () => {
      await t
        .http()
        .get(`/v1/test/spaces/${spaceA}/schedule`)
        .set('cookie', superUser.cookie)
        .expect(403);
    });

    it('jogador sem vínculo, id malformado ou espaço inexistente: 403; sem sessão: 401', async () => {
      for (const spaceId of [spaceA, 'nao-e-uuid', '0192f3a4-5b6c-7d8e-9f01-23456789abcd']) {
        await t
          .http()
          .get(`/v1/test/spaces/${spaceId}/schedule`)
          .set('cookie', anyone.cookie)
          .expect(403);
      }
      await t.http().get(`/v1/test/spaces/${spaceA}/schedule`).expect(401);
    });
  });

  it('rota @Public() não exige nem lê a sessão', async () => {
    await t.http().get('/v1/test/public').expect(200, { user: null });
    await t.http().get('/v1/test/public').set('cookie', anyone.cookie).expect(200, { user: null });
  });
});
