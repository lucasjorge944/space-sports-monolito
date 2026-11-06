import { NOTIFICATION_TYPES } from '@space-sports/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifications } from '../../src/db/schema/index.js';
import { NotificationsService } from '../../src/notifications/notifications.service.js';
import { anonymizeUser } from '../../src/users/anonymize.js';
import { type SignedUp, signUp } from '../auth/helpers.js';
import { bearer } from '../bookings/fixtures.js';
import { createNotificationsApp, type NotificationsTestApp } from './fakes.js';
import { inbox, registerDevice } from './helpers.js';

describe('central, preferências e dispositivos (RF-NOTIF-04)', () => {
  let t: NotificationsTestApp;
  let ana: SignedUp;
  let bia: SignedUp;
  let service: NotificationsService;

  const notify = (user: SignedUp, type: 'BOOKING_CONFIRMED' | 'BOOKING_REMINDER', title = 'Oi') =>
    service.notify({ userId: user.id, type, title, body: 'corpo', data: { n: title } });
  const api = (user: SignedUp) => ({
    get: (path: string) =>
      t
        .http()
        .get(path)
        .set(...bearer(user)),
    post: (path: string) =>
      t
        .http()
        .post(path)
        .set(...bearer(user)),
    patch: (path: string, body: unknown) =>
      t
        .http()
        .patch(path)
        .set(...bearer(user))
        .send(body as object),
    delete: (path: string) =>
      t
        .http()
        .delete(path)
        .set(...bearer(user)),
  });

  beforeAll(async () => {
    t = await createNotificationsApp();
    service = t.app.get(NotificationsService);
    ana = await signUp(t, 'ana@exemplo.com', 'Ana');
    bia = await signUp(t, 'bia@exemplo.com', 'Bia');
    await registerDevice(t, ana, 'ExponentPushToken[ana]');
  });
  afterAll(() => t.close());

  describe('lista e leitura', () => {
    it('exige autenticação', async () => {
      await t.http().get('/v1/me/notifications').expect(401);
      await t.http().get('/v1/me/notification-preferences').expect(401);
      await t.http().put('/v1/me/devices').send({}).expect(401);
    });

    it('lista as mais recentes primeiro, com paginação por cursor e total de não lidas', async () => {
      for (const title of ['1', '2', '3', '4', '5']) await notify(ana, 'BOOKING_REMINDER', title);

      const page1 = await inbox(t, ana, '?limit=2');
      expect(page1.items.map((i) => i.title)).toEqual(['5', '4']);
      expect(page1.unreadCount).toBe(5);
      expect(page1.nextCursor).toEqual(expect.any(String));

      const page2 = await inbox(t, ana, `?limit=2&cursor=${page1.nextCursor}`);
      expect(page2.items.map((i) => i.title)).toEqual(['3', '2']);
      const page3 = await inbox(t, ana, `?limit=2&cursor=${page2.nextCursor}`);
      expect(page3.items.map((i) => i.title)).toEqual(['1']);
      expect(page3.nextCursor).toBeNull();
    });

    it('cursor inválido responde 400', async () => {
      const res = await api(ana).get('/v1/me/notifications?cursor=lixo').expect(400);
      expect(res.body.error.code).toBe('INVALID_CURSOR');
    });

    it('marcar como lida é idempotente e atualiza o total de não lidas', async () => {
      const { items } = await inbox(t, ana, '?limit=1');
      const id = items[0]?.id;
      const first = await api(ana).post(`/v1/me/notifications/${id}/read`).expect(200);
      expect(first.body.readAt).toEqual(expect.any(String));
      const again = await api(ana).post(`/v1/me/notifications/${id}/read`).expect(200);
      expect(again.body.readAt).toBe(first.body.readAt);

      expect((await inbox(t, ana)).unreadCount).toBe(4);
      const unread = await inbox(t, ana, '?unread=true&limit=100');
      expect(unread.items).toHaveLength(4);
      expect(unread.items.every((i) => i.readAt === null)).toBe(true);
    });

    it('notificação inexistente ou id malformado responde 404', async () => {
      const unknown = '019a0000-0000-7000-8000-000000000000';
      for (const id of [unknown, 'nao-e-uuid']) {
        const res = await api(ana).post(`/v1/me/notifications/${id}/read`).expect(404);
        expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
      }
    });

    it('marcar todas como lidas', async () => {
      const res = await api(ana).post('/v1/me/notifications/read-all').expect(200);
      expect(res.body).toEqual({ updated: 4 });
      expect((await inbox(t, ana)).unreadCount).toBe(0);
      expect((await api(ana).post('/v1/me/notifications/read-all').expect(200)).body).toEqual({
        updated: 0,
      });
    });
  });

  describe('isolamento entre usuários', () => {
    it('não vê, não lê e não marca como lida a notificação de outro usuário', async () => {
      await notify(bia, 'BOOKING_CONFIRMED', 'da Bia');
      const [mine] = (await inbox(t, bia)).items;

      expect((await inbox(t, ana, '?limit=100')).items.map((i) => i.title)).not.toContain('da Bia');
      const res = await api(ana).post(`/v1/me/notifications/${mine?.id}/read`).expect(404);
      expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
      expect((await inbox(t, bia)).items[0]?.readAt).toBeNull();
    });

    it('"ler todas" só mexe nas notificações de quem pediu', async () => {
      await notify(ana, 'BOOKING_CONFIRMED', 'nova da Ana');
      await api(ana).post('/v1/me/notifications/read-all').expect(200);
      expect((await inbox(t, bia)).unreadCount).toBe(1);
    });

    it('não remove o dispositivo de outro usuário', async () => {
      const device = await registerDevice(t, bia, 'ExponentPushToken[bia]');
      const res = await api(ana).delete(`/v1/me/devices/${device.id}`).expect(404);
      expect(res.body.error.code).toBe('DEVICE_NOT_FOUND');
      await api(bia).delete(`/v1/me/devices/${device.id}`).expect(204);
    });

    it('cada usuário tem as próprias preferências', async () => {
      await api(bia).patch('/v1/me/notification-preferences', {
        items: [{ type: 'BOOKING_REMINDER', push: false }],
      });
      const ana$ = await api(ana).get('/v1/me/notification-preferences').expect(200);
      expect(ana$.body.items.find((i: { type: string }) => i.type === 'BOOKING_REMINDER')).toEqual({
        type: 'BOOKING_REMINDER',
        push: true,
        inApp: true,
      });
    });

    it('o push só vai para os aparelhos do próprio usuário', async () => {
      await registerDevice(t, bia, 'ExponentPushToken[bia]');
      t.queue.pushes.length = 0;
      t.push.sent.length = 0;
      await notify(ana, 'BOOKING_CONFIRMED', 'só da Ana');
      await t.flush();
      expect(t.push.sent.map((m) => m.to)).toEqual(['ExponentPushToken[ana]']);
    });
  });

  describe('preferências', () => {
    it('lista todos os tipos, com tudo ligado por padrão', async () => {
      const res = await api(ana).get('/v1/me/notification-preferences').expect(200);
      expect(res.body.items).toHaveLength(NOTIFICATION_TYPES.length);
      expect(res.body.items).toContainEqual({ type: 'BOOKING_REMINDER', push: true, inApp: true });
      expect(
        res.body.items.every((i: { push: boolean; inApp: boolean }) => i.push && i.inApp),
      ).toBe(true);
    });

    it('altera só o que foi enviado e mantém o resto', async () => {
      await api(ana)
        .patch('/v1/me/notification-preferences', {
          items: [{ type: 'BOOKING_REMINDER', push: false }],
        })
        .expect(200);
      const res = await api(ana)
        .patch('/v1/me/notification-preferences', {
          items: [{ type: 'BOOKING_REMINDER', inApp: false }],
        })
        .expect(200);
      expect(res.body.items).toContainEqual({
        type: 'BOOKING_REMINDER',
        push: false,
        inApp: false,
      });
      expect(res.body.items).toContainEqual({ type: 'BOOKING_CONFIRMED', push: true, inApp: true });
      await api(ana)
        .patch('/v1/me/notification-preferences', {
          items: [{ type: 'BOOKING_REMINDER', push: true, inApp: true }],
        })
        .expect(200);
    });

    it('valida o corpo', async () => {
      for (const body of [
        { items: [] },
        { items: [{ type: 'NAO_EXISTE', push: true }] },
        { items: [{ type: 'BOOKING_REMINDER' }] },
        {
          items: [
            { type: 'BOOKING_REMINDER', push: true },
            { type: 'BOOKING_REMINDER', push: false },
          ],
        },
      ]) {
        await api(ana).patch('/v1/me/notification-preferences', body).expect(400);
      }
    });

    it('push desligado: grava na central e não envia', async () => {
      await api(ana).patch('/v1/me/notification-preferences', {
        items: [{ type: 'BOOKING_REMINDER', push: false }],
      });
      const before = (await inbox(t, ana)).items.length;
      t.push.sent.length = 0;
      await notify(ana, 'BOOKING_REMINDER', 'sem push');
      await t.flush();

      expect(t.push.sent).toHaveLength(0);
      expect((await inbox(t, ana)).items).toHaveLength(before + 1);
    });

    it('central desligada: envia o push e não grava na central', async () => {
      await api(ana).patch('/v1/me/notification-preferences', {
        items: [{ type: 'BOOKING_REMINDER', push: true, inApp: false }],
      });
      const before = (await inbox(t, ana)).items.length;
      t.push.sent.length = 0;
      await notify(ana, 'BOOKING_REMINDER', 'só push');
      await t.flush();

      expect(t.push.sent).toEqual([expect.objectContaining({ title: 'só push' })]);
      expect(t.push.sent[0]?.data).not.toHaveProperty('notificationId');
      expect((await inbox(t, ana)).items).toHaveLength(before);
    });

    it('tudo desligado: não faz nada; outros tipos seguem normais', async () => {
      await api(ana).patch('/v1/me/notification-preferences', {
        items: [{ type: 'BOOKING_REMINDER', push: false, inApp: false }],
      });
      const rows = async () => (await t.db.select().from(notifications)).length;
      const before = await rows();
      t.push.sent.length = 0;
      await notify(ana, 'BOOKING_REMINDER', 'mudo');
      await t.flush();
      expect(await rows()).toBe(before);
      expect(t.push.sent).toHaveLength(0);

      await notify(ana, 'BOOKING_CONFIRMED', 'normal');
      await t.flush();
      expect(await rows()).toBe(before + 1);
      expect(t.push.sent).toHaveLength(1);
    });
  });

  describe('dispositivos', () => {
    it('registrar é idempotente por token', async () => {
      const first = await registerDevice(t, bia, 'ExponentPushToken[bia-2]', 'ANDROID');
      const again = await registerDevice(t, bia, 'ExponentPushToken[bia-2]', 'ANDROID');
      expect(again.id).toBe(first.id);
    });

    it('o token passa para quem logou depois no mesmo aparelho', async () => {
      const device = await registerDevice(t, ana, 'ExponentPushToken[compartilhado]');
      const moved = await registerDevice(t, bia, 'ExponentPushToken[compartilhado]');
      expect(moved.id).toBe(device.id);

      t.push.sent.length = 0;
      await notify(ana, 'BOOKING_CONFIRMED', 'para a Ana');
      await t.flush();
      expect(t.push.sent.map((m) => m.to)).not.toContain('ExponentPushToken[compartilhado]');
      await notify(bia, 'BOOKING_CONFIRMED', 'para a Bia');
      await t.flush();
      expect(t.push.sent.map((m) => m.to)).toContain('ExponentPushToken[compartilhado]');
    });

    it('rejeita token que não é do Expo', async () => {
      const res = await t
        .http()
        .put('/v1/me/devices')
        .set(...bearer(ana))
        .send({ expoPushToken: 'fcm-token-cru', platform: 'ANDROID' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('conta excluída não recebe notificação e perde tokens e central', async () => {
      const carla = await signUp(t, 'carla@exemplo.com', 'Carla');
      await registerDevice(t, carla, 'ExponentPushToken[carla]');
      await notify(carla, 'BOOKING_CONFIRMED', 'antes');
      await anonymizeUser(t.db, carla.id);

      t.queue.pushes.length = 0;
      await notify(carla, 'BOOKING_CONFIRMED', 'depois');
      expect(t.queue.pushes).toHaveLength(0);
      const left = await t.db.select().from(notifications);
      expect(left.filter((n) => n.userId === carla.id)).toHaveLength(0);
    });
  });
});
