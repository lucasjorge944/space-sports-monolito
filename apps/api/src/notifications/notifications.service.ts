import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type Device,
  NOTIFICATION_TYPES,
  type Notification,
  type NotificationPage,
  type NotificationPreferences,
  type NotificationsQuery,
  type NotificationType,
  type ReadAllResult,
  type RegisterDeviceInput,
  type UpdateNotificationPreferencesInput,
} from '@space-sports/shared';
import { and, count, desc, eq, isNull, lt } from 'drizzle-orm';
import { invalidCursor } from '../bookings/bookings.errors.js';
import type { Database } from '../db/client.js';
import { devices, notificationPreferences, notifications, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { NotificationQueue } from './notification-queue.js';
import { deviceNotFound, notificationNotFound } from './notifications.errors.js';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Dados para o deep link do app (ex.: `{ bookingId }`). */
  data?: Record<string, unknown>;
}

type NotificationRow = typeof notifications.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Notificações do usuário (RF-NOTIF-01, RF-NOTIF-04): `notify` grava na central e enfileira o
 * push conforme as preferências; o restante são as leituras/ações do próprio usuário. Toda
 * consulta filtra por `userId`: ninguém vê ou altera dados de outro usuário.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly queue: NotificationQueue,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Emissão

  /**
   * Respeita as preferências do tipo: `inApp` grava na central, `push` enfileira o envio. Conta
   * excluída não recebe nada. Devolve o id do item da central (nulo se não foi gravado).
   */
  async notify(input: NotifyInput): Promise<string | null> {
    const [row] = await this.db
      .select({
        deleted: users.deletedAt,
        push: notificationPreferences.pushEnabled,
        inApp: notificationPreferences.inAppEnabled,
      })
      .from(users)
      .leftJoin(
        notificationPreferences,
        and(
          eq(notificationPreferences.userId, users.id),
          eq(notificationPreferences.type, input.type),
        ),
      )
      .where(eq(users.id, input.userId));
    if (!row || row.deleted) return null;
    const push = row.push ?? true;
    const inApp = row.inApp ?? true;

    let data = input.data;
    let notificationId: string | null = null;
    if (inApp) {
      const [created] = await this.db
        .insert(notifications)
        .values({
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: input.data ?? null,
        })
        .returning({ id: notifications.id });
      if (created) {
        notificationId = created.id;
        data = { ...input.data, notificationId };
      }
    }
    if (push) {
      await this.queue.enqueuePush({
        id: randomUUID(),
        userId: input.userId,
        title: input.title,
        body: input.body,
        data: { ...data, type: input.type },
      });
    }
    return notificationId;
  }

  // -------------------------------------------------------------------------------------------
  // Central

  async list(userId: string, query: NotificationsQuery): Promise<NotificationPage> {
    const before = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          query.unread ? isNull(notifications.readAt) : undefined,
          before ? lt(notifications.id, before) : undefined,
        ),
      )
      .orderBy(desc(notifications.id))
      .limit(query.limit + 1);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map(toNotification),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.id) : null,
      unreadCount: await this.unreadCount(userId),
    };
  }

  private async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return row?.value ?? 0;
  }

  /** Idempotente: marcar de novo uma já lida devolve a notificação como está. */
  async markRead(userId: string, id: string): Promise<Notification> {
    const [updated] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .returning();
    if (updated) return toNotification(updated);
    const [existing] = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    if (!existing) throw notificationNotFound();
    return toNotification(existing);
  }

  async markAllRead(userId: string): Promise<ReadAllResult> {
    const updated = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return { updated: updated.length };
  }

  // -------------------------------------------------------------------------------------------
  // Preferências

  async preferences(userId: string): Promise<NotificationPreferences> {
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
    const byType = new Map(rows.map((row) => [row.type, row]));
    return {
      items: NOTIFICATION_TYPES.map((type) => ({
        type,
        push: byType.get(type)?.pushEnabled ?? true,
        inApp: byType.get(type)?.inAppEnabled ?? true,
      })),
    };
  }

  async updatePreferences(
    userId: string,
    input: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferences> {
    await this.db.transaction(async (tx) => {
      for (const item of input.items) {
        await tx
          .insert(notificationPreferences)
          .values({
            userId,
            type: item.type,
            pushEnabled: item.push ?? true,
            inAppEnabled: item.inApp ?? true,
          })
          .onConflictDoUpdate({
            target: [notificationPreferences.userId, notificationPreferences.type],
            set: {
              ...(item.push !== undefined ? { pushEnabled: item.push } : {}),
              ...(item.inApp !== undefined ? { inAppEnabled: item.inApp } : {}),
              updatedAt: new Date(),
            },
          });
      }
    });
    return this.preferences(userId);
  }

  // -------------------------------------------------------------------------------------------
  // Dispositivos

  /**
   * Idempotente por token. Se o aparelho já estava registrado para outra conta (logout e novo
   * login no mesmo celular), o token passa para o usuário atual: o push segue o login.
   */
  async registerDevice(userId: string, input: RegisterDeviceInput): Promise<Device> {
    const [device] = await this.db
      .insert(devices)
      .values({ userId, expoPushToken: input.expoPushToken, platform: input.platform })
      .onConflictDoUpdate({
        target: devices.expoPushToken,
        set: { userId, platform: input.platform, updatedAt: new Date() },
      })
      .returning();
    if (!device) throw new Error('Upsert de dispositivo sem retorno.');
    return toDevice(device);
  }

  async removeDevice(userId: string, id: string): Promise<void> {
    const removed = await this.db
      .delete(devices)
      .where(and(eq(devices.id, id), eq(devices.userId, userId)))
      .returning({ id: devices.id });
    if (!removed.length) throw deviceNotFound();
  }
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: row.data,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDevice(row: typeof devices.$inferSelect): Device {
  return { id: row.id, expoPushToken: row.expoPushToken, platform: row.platform };
}

/** O cursor é o id da última notificação da página (uuid v7: ordem de criação). */
function encodeCursor(id: string): string {
  return Buffer.from(id).toString('base64url');
}

function decodeCursor(value: string): string {
  const id = Buffer.from(value, 'base64url').toString('utf8');
  if (!UUID.test(id)) throw invalidCursor();
  return id;
}
