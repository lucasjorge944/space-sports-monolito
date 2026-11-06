import {
  deviceSchema,
  notificationPageSchema,
  notificationPreferencesSchema,
  notificationSchema,
  notificationsQuerySchema,
  readAllResultSchema,
  registerDeviceSchema,
  updateNotificationPreferencesSchema,
} from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI das notificações, a partir dos schemas de @space-sports/shared.

export const schemas = {
  registerDevice: openApiSchema(registerDeviceSchema, 'RegisterDevice', 'input'),
  device: openApiSchema(deviceSchema, 'Device', 'output'),
  notificationsQuery: notificationsQuerySchema,
  notification: openApiSchema(notificationSchema, 'Notification', 'output'),
  notificationPage: openApiSchema(notificationPageSchema, 'NotificationPage', 'output'),
  readAllResult: openApiSchema(readAllResultSchema, 'ReadAllResult', 'output'),
  notificationPreferences: openApiSchema(
    notificationPreferencesSchema,
    'NotificationPreferences',
    'output',
  ),
  updateNotificationPreferences: openApiSchema(
    updateNotificationPreferencesSchema,
    'UpdateNotificationPreferences',
    'input',
  ),
};
