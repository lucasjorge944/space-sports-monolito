import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './columns.js';
import { deletionRequestSource, deletionRequestStatus } from './enums.js';
import { users } from './identity.js';
import { spaces } from './spaces.js';

/** Checklist da implantação assistida (RF-SUPER-02). */
export const onboardingChecklists = pgTable('onboarding_checklists', {
  id: id(),
  spaceId: uuid()
    .notNull()
    .unique('onboarding_checklists_space_id_unique')
    .references(() => spaces.id, { onDelete: 'cascade' }),
  /** Itens: dados, fotos, quadras, preço, equipe, turmas, planos. */
  items: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  completedAt: tstz(),
  ...timestamps,
});

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>(),
    readAt: tstz(),
    ...timestamps,
  },
  // A central pagina por id (uuid v7 = ordem de criação, sem empate), não por created_at.
  (t) => [index('notifications_user_id_id_idx').on(t.userId, t.id)],
);

/**
 * Pushes já enviados ao Expo, pela chave do job (RF-NOTIF-01). O worker grava a chave antes de
 * enviar: se o job rodar de novo (retry depois de uma falha do Redis, job travado devolvido à
 * fila), a chave existente impede o push duplicado. Linhas antigas são apagadas pelo job de
 * manutenção da fila.
 */
export const pushDeliveries = pgTable(
  'push_deliveries',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [index('push_deliveries_created_at_idx').on(t.createdAt)],
);

/**
 * Preferências por tipo de notificação (RF-NOTIF-04). Sem linha para o tipo, os dois canais
 * ficam ligados; `type` usa os valores de NOTIFICATION_TYPES (packages/shared).
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text().notNull(),
    pushEnabled: boolean().notNull().default(true),
    inAppEnabled: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [unique('notification_preferences_user_type_unique').on(t.userId, t.type)],
);

/** Auditoria de ações sensíveis (pagamentos, cancelamentos, modo suporte do Super…). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    /** Nulo em ações do sistema (jobs). */
    actorId: uuid().references(() => users.id),
    actingAsSuper: boolean().notNull().default(false),
    spaceId: uuid().references(() => spaces.id),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: uuid(),
    diff: jsonb().$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [
    index('audit_logs_space_id_created_at_idx').on(t.spaceId, t.createdAt.desc()),
    index('audit_logs_entity_idx').on(t.entity, t.entityId),
    index('audit_logs_actor_id_idx').on(t.actorId),
  ],
);

/**
 * Sessões do modo suporte do Super (RF-SUPER-04): a impersonação é limitada a um espaço, tem
 * motivo, validade e fim registrados (`created_at` = início). Cada requisição feita nela vai
 * para `audit_logs` (RN-SUPER-01).
 */
export const supportSessions = pgTable(
  'support_sessions',
  {
    id: id(),
    superUserId: uuid()
      .notNull()
      .references(() => users.id),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    reason: text().notNull(),
    expiresAt: tstz().notNull(),
    endedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    index('support_sessions_super_user_id_idx').on(t.superUserId),
    index('support_sessions_space_id_idx').on(t.spaceId),
  ],
);

/**
 * Pedidos de exclusão de conta (LGPD) atendidos pelo Super (RF-SUPER-07, RF-AUTH-03). O prazo de
 * resposta (decisão 40) é `created_at` + 15 dias, calculado na leitura.
 */
export const accountDeletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    status: deletionRequestStatus().notNull().default('PENDING'),
    source: deletionRequestSource().notNull(),
    resolvedAt: tstz(),
    resolvedBy: uuid().references(() => users.id),
    /** Motivo informado pelo titular ao pedir (opcional). */
    reason: text(),
    /** Observação da equipe; na recusa, o motivo. */
    note: text(),
    ...timestamps,
  },
  (t) => [
    index('account_deletion_requests_status_created_at_idx').on(t.status, t.createdAt),
    index('account_deletion_requests_resolved_by_idx').on(t.resolvedBy),
    // Um pedido pendente por usuário.
    uniqueIndex('account_deletion_requests_user_pending_unique')
      .on(t.userId)
      .where(sql`${t.status} = 'PENDING'`),
  ],
);
