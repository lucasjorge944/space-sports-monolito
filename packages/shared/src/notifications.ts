import { z } from 'zod';

/**
 * Tipos de notificação (RF-NOTIF-01). Cada tipo tem preferência própria (RF-NOTIF-04); os da
 * lista do RF que dependem de módulos futuros (aulas, torneios, mensalidades) entram junto
 * com eles.
 */
export const NOTIFICATION_TYPES = [
  'BOOKING_CONFIRMED',
  'BOOKING_CANCELLED',
  'BOOKING_UPDATED',
  'BOOKING_REMINDER',
  'BOOKING_INVITE',
  'BOOKING_INVITE_ANSWERED',
  'BOOKING_LINKED',
  'RECURRING_APPROVED',
  'RECURRING_REJECTED',
  'SUBSCRIPTION_APPROVED',
  'SUBSCRIPTION_REJECTED',
  'SUBSCRIPTION_CANCELLED',
  'SUBSCRIPTION_CANCEL_RESUMED',
  'SUBSCRIPTION_CHARGE_DUE_SOON',
  'SUBSCRIPTION_CHARGE_OVERDUE',
  'CLASS_LIST_OPEN',
  'CLASS_WAITLIST_PROMOTED',
  'CLASS_SESSION_CANCELLED',
  'SPACE_BOOKING_UPDATED',
  // Pagamento online (RF-ONPAY; docs/13). Jogador: confirmado, Pix vencido, estorno.
  'PAYMENT_CONFIRMED',
  'PAYMENT_EXPIRED',
  'PAYMENT_REFUNDED',
  // Gestão (Dono e Admin): chargeback com prazo, cadastro aprovado ou recusado, repasse que falhou;
  // Donos: troca da conta de recebimento (decisão 95) e a troca recusada (decisão 98).
  'PAYMENT_CHARGEBACK',
  'MERCHANT_ACCOUNT_APPROVED',
  'MERCHANT_ACCOUNT_REJECTED',
  'MERCHANT_PAYOUT_ACCOUNT_CHANGED',
  'MERCHANT_PAYOUT_CHANGE_REJECTED',
  'PAYOUT_FAILED',
  // Avaliações (RF-REVIEW-02, RF-REVIEW-09): pedido ao jogador ~2 h depois do uso; avaliação nova
  // para Dono e Admin; resposta do espaço para o autor.
  'REVIEW_REQUEST',
  'REVIEW_CREATED',
  'REVIEW_REPLIED',
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const DEVICE_PLATFORMS = ['IOS', 'ANDROID'] as const;
export const devicePlatformSchema = z.enum(DEVICE_PLATFORMS);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

/** `ExponentPushToken[xxxx]` (ou `ExpoPushToken[xxxx]`), como o expo-notifications devolve. */
export const expoPushTokenSchema = z
  .string()
  .max(255)
  .regex(/^Expo(nent)?PushToken\[[^\]\s]+\]$/, 'Token de push do Expo inválido.');

// ---------------------------------------------------------------------------------------------
// Dispositivos

/** PUT /v1/me/devices: registra (ou reaproveita) o token do aparelho para o usuário da sessão. */
export const registerDeviceSchema = z.object({
  expoPushToken: expoPushTokenSchema,
  platform: devicePlatformSchema,
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const deviceSchema = z.object({
  id: z.uuid(),
  expoPushToken: z.string(),
  platform: devicePlatformSchema,
});
export type Device = z.infer<typeof deviceSchema>;

// ---------------------------------------------------------------------------------------------
// Central de notificações

/** GET /v1/me/notifications */
export const notificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** `nextCursor` da página anterior. */
  cursor: z.string().min(1).optional(),
  /** `true`: só as não lidas. */
  unread: z.stringbool().optional().describe('`true`: só as não lidas.'),
});
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;

export const notificationSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  /** Dados para o deep link (ex.: `{ bookingId }`). */
  data: z.record(z.string(), z.unknown()).nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationPageSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
  /** Total de não lidas do usuário (para o selo do app), independente da página. */
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationPage = z.infer<typeof notificationPageSchema>;

/** POST /v1/me/notifications/read-all */
export const readAllResultSchema = z.object({ updated: z.number().int().nonnegative() });
export type ReadAllResult = z.infer<typeof readAllResultSchema>;

// ---------------------------------------------------------------------------------------------
// Preferências

/** Por tipo e canal; sem registro, os dois canais ficam ligados. */
export const notificationPreferenceSchema = z.object({
  type: notificationTypeSchema,
  /** Push no aparelho. */
  push: z.boolean(),
  /** Aparece na central de notificações do app. */
  inApp: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const notificationPreferencesSchema = z.object({
  items: z.array(notificationPreferenceSchema),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

/** PATCH /v1/me/notification-preferences: só os tipos/canais enviados mudam. */
export const updateNotificationPreferencesSchema = z.object({
  items: z
    .array(
      z
        .object({
          type: notificationTypeSchema,
          push: z.boolean().optional(),
          inApp: z.boolean().optional(),
        })
        .refine((item) => item.push !== undefined || item.inApp !== undefined, {
          message: 'Informe push e/ou inApp.',
        }),
    )
    .min(1)
    .max(NOTIFICATION_TYPES.length)
    .refine((items) => new Set(items.map((item) => item.type)).size === items.length, {
      message: 'Tipo repetido.',
    }),
});
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;
